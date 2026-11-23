// AttitudeSenseManager.mjs
// Attitude sense communication module for the Attitude Control 2.A app
// copyright 2024 Drew Shipps, J Squared Systems


// this module creates a single instance of the AttitudeSenseManager javascript object,
// which controls the attitude sense units connected to this system



// ==================== IMPORT ====================
import eventHub from './EventHub.mjs';
import dgram from 'dgram';
import configManager from './ConfigManager.mjs';

import Logger from './Logger.mjs';
const logger = new Logger('AttitudeSenseManager');



// ==================== VARIABLES ====================
const LAPTOP_MODE = (process.platform == 'darwin');

// How long a sense packet stays valid before the unit is treated as absent.
//
// mostRecentPacketFromEachSense had no expiry at all: set, has, get, and nothing else. A sense
// that had EVER been heard from was always "found", however long ago. So a unit powered down or
// unplugged while a port was asserted latched that port active FOREVER - a toggle-mode override
// stayed layered on every pass, for days, outranking both the weekly schedule and custom blocks,
// with no way to dislodge it. Pulse mode was worse: its self-expiry is defeated because the port
// still reads active, so activeUntil is refreshed on every tick and the pulse re-arms forever.
//
// The comment on getSensePortDataById already promised the correct behaviour ("default response
// if ID is not found is array of zeroes so that no ports will be active"); it just never applied
// to a stale unit. AttitudeEmitManager has exactly this TTL, with a written rationale.
//
// SET THIS AGAINST THE SENSE FIRMWARE'S REAL ANNOUNCE INTERVAL. Too short and live triggers get
// dropped. 60s matches EMIT_ADDRESS_TTL_MS and is comfortably longer than the observed rate.
const SENSE_PACKET_TTL_MS = 60000;

// A Sense reports its inputs as a comma-separated string of 0s and 1s. (2.A.27)
//
// Two hardware lines are in the field. The original Attitude Sense sends 16 values. The Flair
// Sense (Mark VII) sends 19: its 15 car-wash inputs and 4 relay inputs. Until 2.A.27 this box
// accepted 16 only, so every Flair Sense packet was rejected ("Invalid DATA property") and that
// unit's triggers never fired - first seen on the bench with AC-0020180, 2026-11-20.
//
// Ruling (John, 2026-10-05, the same fix made in FlairNode): inputs 1-16 are the same inputs in
// the same order on both lines. So a 19-value packet is accepted and trimmed to its first 16 -
// the website configures 16 ports per Sense, and every consumer downstream (scheduler, server
// relay) expects 16. Inputs 17-19 are ignored here until the website can configure them.
// Any other count is still refused.
const SENSE_PORTS_USED = 16;
const SENSE_ACCEPTED_PORT_COUNTS = [16, 19];
const SENSE_DATA_PATTERN = /^[01](,[01])*$/;

// How often a Flair Sense that is not on this location's records is reported to the server so it
// can be auto-connected (2.A.28). The first sighting is reported at once.
const UNASSIGNED_REPORT_MS = 10000;





// ==================== CLASS DEFINITION ====================
class AttitudeSenseManager {

	// constructor
	constructor() {
		// create an array to hold the most recent packet from each sense
		this.mostRecentPacketFromEachSense = new Map();

		// Sense IDs already logged as sending more than 16 inputs, so the note appears once per
		// unit per boot instead of once per packet
		this.trimmedSenseIds = new Set();

		// FLAIR SENSE SERIAL NUMBERS. (2.A.27)
		//
		// A Flair Sense identifies itself by SERIAL ("SENS-87734C2D", derived from its board id),
		// and its ID field cannot be trusted: the firmware ships with ID "11" written in, and 11 is
		// a live field Sense. So a packet that carries a SERIAL is never filed under its ID.
		//
		//   mostRecentPacketFromEachSense  ID -> packet, for packets WITHOUT a serial (the original
		//                                  16-input Attitude Sense, matched by ID as it always was)
		//   mostRecentPacketBySerial       SERIAL -> packet, for packets WITH one
		//   serialPacketByAnnouncedId      announced ID -> serial packet, used ONLY for a website
		//                                  Sense record that carries no serial number at all, so a
		//                                  site whose config has no serials behaves as before
		this.mostRecentPacketBySerial = new Map();
		this.serialPacketByAnnouncedId = new Map();

		// serials already logged as not belonging to this location (once per unit per boot)
		this.unassignedSerialsLogged = new Set();

		// serial -> when it was last reported to the server while unassigned (see relayDecision)
		this.unassignedSerialLastReport = new Map();

        // Bind the handleNewSenseData function to the current instance
        // this fixes the issues with calling this.validateSenseDataObject() inside handleNewSenseData
        this.handleNewSenseData = this.handleNewSenseData.bind(this);
	}


	// initialize the client for receiving data from attitude sense units
	init() {
		try {
			// log that we are initializing the client (optional)
			// logger.info(`Initializing Attitude Sense Manager...`);

			// attach a hanlder function to the message received function
			eventHub.on('receivedUDP', this.handleNewSenseData);

			// log that we completed the initialization process
	        logger.info('Completed initialization of Attitude Sense Manager for listening to Attitude Sense devices.');

			// emit an event that we initialized the client for UDP
	        eventHub.emit('moduleStatus', { 
	            name: 'AttitudeSenseManager', 
	            status: 'operational',
	            data: '',
	        });
	    } catch (error) {
			// log that we failed to initialize
	        logger.error(`Failed to initialize UDP client! ${error}`);

			// emit an event that we initialized the client for UDP
	        eventHub.emit('moduleStatus', { 
	            name: 'AttitudeSenseManager', 
	            status: 'errored',
	            data: `Failed to initialize UDP client! ${error}`,
	        });
	    }
	}


	// handleNewSenseData - function to handle the data packet received from the sense
	handleNewSenseData(object) {
		// wrap the processing logic in a try catch in case of errors
		try {
			// skip packets that are not from TYPE 1 devices (i.e. not from Attitude Sense units)
			if (object?.TYPE !== 1) {
				if (configManager.checkLogLevel('detail')) {
					logger.info(`Skipped non-sense UDP packet or invalid TYPE: ${object?.TYPE}`);
				}
				return;
			}

			// validate the packet
			this.validateSenseDataObject(object);

			// a Flair Sense sends 19 inputs; keep 1-16 (see SENSE_ACCEPTED_PORT_COUNTS)
			object = this.normalizeSenseData(object);

    		// if detail log level, log that we just got a status packet
			if (configManager.checkLogLevel('detail')) {
    			logger.info(`New packet of TYPE=1 from sense ID: ${object.ID} with data ${object.DATA}`);
    		}

    		// console.log(`New packet from sense ID: ${object.ID} with data ${object.DATA}`);

    		// file the packet by serial if it has one, by ID if it does not (see the constructor).
            // stamp arrival time so a unit that goes quiet can age out (see SENSE_PACKET_TTL_MS)
            const stamped = { ...object, receivedAt: Date.now() };
            const serial = this.normalizeSerial(object.SERIAL);
            if (serial) {
            	this.mostRecentPacketBySerial.set(serial, stamped);
            	this.serialPacketByAnnouncedId.set(object.ID, stamped);
            } else {
            	this.mostRecentPacketFromEachSense.set(object.ID, stamped);
            }

            // Which website Sense record is this? The server files relayed Sense data by id, so a
            // Flair Sense announcing a borrowed ID would overwrite that other Sense's status. A
            // serial packet is relayed under the id of the record whose serial number matches.
            const relay = this.relayDecision(object, serial);
            if (relay === null) {
            	return;   // an unassigned unit already reported in the last UNASSIGNED_REPORT_MS
            }
            const relayId = relay.id;

            // process the data array from the sense's ports (string to array)
            const processedDataArrray = this.processSensePortData(object.DATA);

            // create a packet for sending to the server with all data about this sense packet
            const senseDataPacket = {
				timestamp: new Date().toISOString(),
				name: object.NAME,
				type: object.TYPE,
				id: relayId,
				// THE SERIAL GOES TO THE SERVER (2.A.28). It is how the server auto-connects a Flair
				// Sense to the site whose box hears it, and moves it when it is moved - id is null
				// for a unit not yet on this location's records. Absent for the original Sense.
				...(serial ? { serial } : {}),
				version: object.VERSION,
				packet_no: object.PACKET_NO,
				data: processedDataArrray,
			};

			// emit an event with the new sense data packet
			// network module will pick this up and send it to the server
			eventHub.emit('senseData', senseDataPacket);

    		// if interval log level, log that we finished processing the packet
			if (configManager.checkLogLevel('interval')) {
    			logger.info(`Processed packet from sense ID: ${object.ID} with data ${object.DATA}`);
    		}

    		// always emit a module status event
	        eventHub.emit('moduleStatus', { 
	            name: 'AttitudeSenseManager', 
	            status: 'operational',
	            data: '',
	        });
		} catch (error) {
    		// else log error
            logger.error(`Error processing client message: ${error}`);

			// emit an event that there was an error
	        eventHub.emit('moduleStatus', { 
	            name: 'AttitudeSenseManager', 
	            status: 'errored',
	            data: `Error processing client message: ${error}`,
	        });
        }
	}


	// validateSenseDataObject - validate that the sense data object includes all of the necesary parameters
	validateSenseDataObject(obj) {
		// Check if TYPE property exists and is equal to 1
		if (obj.TYPE !== 1) {
			throw new Error("Invalid TYPE property. It must be equal to 1.");
		}

		// Check if ID property exists and is an integer
		if (!Number.isInteger(obj.ID)) {
			throw new Error("Invalid ID property. It must be an integer.");
		}

		// Check if DATA property exists and follows the specified format: 16 values (Attitude
		// Sense) or 19 values (Flair Sense), each 0 or 1, comma-separated, nothing else
		if (typeof obj.DATA !== 'string' || !SENSE_DATA_PATTERN.test(obj.DATA)
			|| !SENSE_ACCEPTED_PORT_COUNTS.includes(obj.DATA.split(',').length)) {
			throw new Error("Invalid DATA property. It must be a string of 16 or 19 numbers (0 or 1) separated by commas.");
		}

        // Check if NAME property exists and is a string
        if (typeof obj.NAME !== 'string') {
            throw new Error("Invalid NAME property. It must exist and be a string.");
        }

        // Check if VERSION property exists
        if (typeof obj.VERSION === 'undefined') {
            throw new Error("Invalid VERSION property. It must exist.");
        }

        // Check if PACKET_NO property exists
        if (typeof obj.PACKET_NO === 'undefined') {
            throw new Error("Invalid PACKET_NO property. It must exist.");
        }

		return true;
	}


	// processSensePortData and turn it into an array of integers
	processSensePortData(dataString) {
	    // Split the string by commas and convert each item to an integer
	    return dataString.split(',').map(Number);
	}


	// normalizeSerial - a usable serial in one canonical form, or null. Uppercase and trimmed so
	// "sens-87734c2d " matches "SENS-87734C2D". The firmware placeholder ("SENS-00200xx") is not
	// a real serial; a unit still announcing it is treated as having none.
	normalizeSerial(value) {
		if (typeof value !== 'string') return null;
		const serial = value.trim().toUpperCase();
		if (serial.length === 0 || serial.endsWith('XX')) return null;
		return serial;
	}


	// configuredSenses - the website's Sense records for this location
	configuredSenses() {
		const senses = configManager.getAttitudeSenses();
		return Array.isArray(senses) ? senses : [];
	}


	// relayDecision - how a packet is reported to the server: { id } or null to send nothing now.
	//
	// AUTO-CONNECT (2.A.28). A Flair Sense this location does not have on its records is no longer
	// dropped: it is reported with its serial and `id: null`, so the server can create its record
	// here, or move it here if it has left another site (the server holds the rules - it is the only
	// place that sees which boxes hear which unit). Locally it is still NOT acted on until that record
	// arrives in this box's config, normally within a few seconds - acting on it first would let a
	// unit this site does not own drive its overrides.
	//
	// Reported at once the first time, then every UNASSIGNED_REPORT_MS: enough for the server to
	// claim it promptly and to notice when its old site stops hearing it, without a database write
	// per heartbeat for a unit that belongs to the site next door.
	relayDecision(object, serial) {
		// no serial: the original Attitude Sense, reported under the ID it announces, as always
		if (!serial) return { id: object.ID };

		const senses = this.configuredSenses();
		const match = senses.find(s => this.normalizeSerial(s?.serialnumber) === serial);
		if (match) return { id: match.id };

		// Records exist but none carries a serial number: a server that does not send them, so
		// there is nothing to match against - fall back to the announced ID (the pre-2.A.27
		// behaviour). An EMPTY list is not this case: a location with no Senses yet is exactly
		// where a new unit must auto-connect, and the ID a Flair Sense announces (11 on every
		// unflashed unit) is some other site's live Sense.
		if (senses.length > 0 && !senses.some(s => this.normalizeSerial(s?.serialnumber))) return { id: object.ID };

		const now = Date.now();
		const last = this.unassignedSerialLastReport.get(serial);
		if (last !== undefined && (now - last) < UNASSIGNED_REPORT_MS) return null;
		this.unassignedSerialLastReport.set(serial, now);

		if (!this.unassignedSerialsLogged.has(serial)) {
			this.unassignedSerialsLogged.add(serial);
			logger.info(`Sense ${serial} (announcing ID ${object.ID}) is not on this location's records yet - reporting it to the server to connect it here. Its inputs are used once its record arrives.`);
		}
		return { id: null };
	}


	// freshPacket - the entry in a map if it is younger than the TTL; a stale one is deleted
	freshPacket(map, key) {
		const packet = map.get(key);
		if (packet && typeof packet.receivedAt === 'number' && (Date.now() - packet.receivedAt) < SENSE_PACKET_TTL_MS) {
			return packet;
		}
		if (packet) {
			map.delete(key);
			logger.warn(`Sense ${key} has not reported within ${SENSE_PACKET_TTL_MS}ms - treating its ports as inactive.`);
		}
		return null;
	}


	// getSensePortData - the current port data for one website Sense record. (2.A.27)
	// Matches by serial number when the record has one, then by ID for the original 16-input
	// Sense (whose packets carry no serial). Sixteen zeroes when nothing fresh matches.
	getSensePortData(attitudeSense) {
		const configSerial = this.normalizeSerial(attitudeSense?.serialnumber);
		const intId = parseInt(attitudeSense?.id);

		if (configSerial) {
			const bySerial = this.freshPacket(this.mostRecentPacketBySerial, configSerial);
			if (bySerial) return this.processSensePortData(bySerial.DATA);
		}

		const byId = this.freshPacket(this.mostRecentPacketFromEachSense, intId);
		if (byId) return this.processSensePortData(byId.DATA);

		// a record with no serial number cannot be matched by serial, so a serial unit announcing
		// this ID is accepted for it - how every Sense was matched before 2.A.27
		if (!configSerial) {
			const byAnnounced = this.freshPacket(this.serialPacketByAnnouncedId, intId);
			if (byAnnounced) return this.processSensePortData(byAnnounced.DATA);
		}

		if (configManager.checkLogLevel('detail')) {
			logger.warn(`getSensePortData: Sense ID ${attitudeSense?.id}${configSerial ? ' / ' + configSerial : ''} couldn't be found!`);
		}
		return Array(SENSE_PORTS_USED).fill(0);
	}


	// normalizeSenseData - trim a validated packet to the 16 inputs this box uses. A 16-value
	// packet comes back unchanged. A 19-value packet (Flair Sense) comes back as a copy with its
	// first 16 values; the first time each Sense ID does this, it is logged once, not per packet.
	normalizeSenseData(obj) {
		const values = obj.DATA.split(',');
		if (values.length === SENSE_PORTS_USED) {
			return obj;
		}

		if (!this.trimmedSenseIds.has(obj.ID)) {
			this.trimmedSenseIds.add(obj.ID);
			logger.info(`Sense ID ${obj.ID} sends ${values.length} inputs - using inputs 1-${SENSE_PORTS_USED}, ignoring ${SENSE_PORTS_USED + 1}-${values.length}.`);
		}

		return { ...obj, DATA: values.slice(0, SENSE_PORTS_USED).join(',') };
	}


	// getSensePortDataById - get the most recent port data for a sense unit based on ID
	// default response if ID is not found is array of zeroes so that no ports will be active
	getSensePortDataById(id) {
		// Convert the ID to an integer
	    const intId = parseInt(id);

		// Check if the ID exists in the map AND is still fresh. A packet older than the TTL
		// means the unit has gone quiet, and a silent sense must read as "no ports active"
		// rather than holding whatever it last reported - see SENSE_PACKET_TTL_MS.
	    const dataPacket = this.mostRecentPacketFromEachSense.get(intId);
	    const isFresh = dataPacket
	        && typeof dataPacket.receivedAt === 'number'
	        && (Date.now() - dataPacket.receivedAt) < SENSE_PACKET_TTL_MS;

	    if (isFresh) {
	        // Convert the DATA string to an array
	        return this.processSensePortData(dataPacket.DATA);
	    } else {
	    	// a stale entry is dropped so it cannot be served again, and so a returning unit
	    	// starts clean rather than inheriting its own pre-outage state
	    	if (dataPacket) {
	    		this.mostRecentPacketFromEachSense.delete(intId);
	    		logger.warn(`Sense ID ${id} has not reported within ${SENSE_PACKET_TTL_MS}ms - treating its ports as inactive.`);
	    	}

    		// if detail log level, log that this sense couldn't be found
			if (configManager.checkLogLevel('detail')) {
    			logger.warn(`getSensePortDataById: Sense ID ${id} couldn't be found!`);
    		}

	        // Return an array of 16 zeroes if the ID is not found
	        return Array(16).fill(0);
	    }
	}
}



// Create an instance of AttitudeSenseManager and initialize it
const attitudeSenseManager = new AttitudeSenseManager();

// Export the attitudeLED instance for use in other modules
export default attitudeSenseManager;