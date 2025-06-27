// AttitudeEmitManager.mjs
// Attitude emit management & communication module for the Attitude Control 2.A app
// copyright 2025 Drew Shipps, J Squared Systems

// this module creates a single instance of the AttitudeEmitManager javascript object,
// which controls the attitude emit units connected to this system



// ==================== IMPORT ====================
import eventHub from './EventHub.mjs';
import configManager from './ConfigManager.mjs';
import udpManager from './UDPManager.mjs';

import Logger from './Logger.mjs';
const logger = new Logger('AttitudeEmitManager');



// ==================== VARIABLES ====================
const LAPTOP_MODE = (process.platform == 'darwin');
const BROADCAST_EMIT_ASSIGNMENTS_DELAY = 1000;




// ==================== CLASS DEFINITION ====================
class AttitudeEmitManager {

	// constructor
	constructor() {
		// bind functions
		this.handleNewEmitData = this.handleNewEmitData.bind(this);
	}


	// initialize the emit manager
	init() {
		try {
			// attach a listener for relevant UDP packets
			eventHub.on('receivedUDP', this.handleNewEmitData);

			// Start loop to send updates once per second
			setInterval(() => {
				this.broadcastEmitAssignments();
			}, BROADCAST_EMIT_ASSIGNMENTS_DELAY);

			// set interval to send test packets every 3 seconds
			// setInterval(() => {
			// 	const testPacket = {
			// 		DEST_TYPE: 2,
			// 		DEST_ID: 1,
			// 		UNIVERSE_SET: Math.floor(Math.random() * 4) + 1,
			// 		IDENTIFY: Math.random() < 0.5
			// 	};

			// 	udpManager.send(testPacket);
			// }, 3000);

			// log success
			logger.info('Completed initialization of Attitude Emit Manager.');

			// emit status event
	        eventHub.emit('moduleStatus', { 
	            name: 'AttitudeEmitManager', 
	            status: 'operational',
	            data: '',
	        });
		} catch (error) {
			// log failure
			logger.error(`Failed to initialize Attitude Emit Manager! ${error}`);

			// emit status error event
			eventHub.emit('moduleStatus', {
				name: 'AttitudeEmitManager',
				status: 'errored',
				data: `Failed to initialize: ${error}`,
			});
		}
	}


	// handleNewEmitData - function to handle the data packet received from an Attitude Emit device
	handleNewEmitData(object) {
		try {
			// skip if not TYPE 2
			if (object?.TYPE !== 2) {
				if (configManager.checkLogLevel('detail')) {
					logger.info(`Skipped non-emit UDP packet or invalid TYPE: ${object?.TYPE}`);
				}
				return;
			}

			// validate the packet
			if (!this.validateEmitDataObject(object)) return;

			// log the incoming emit packet
			if (configManager.checkLogLevel('detail')) {
				logger.info(`New packet of TYPE=2 from emit ID: ${object.ID} with universe ${object.UNIVERSE}`);
			}

			// log any reported errors
			if (typeof object.ERRORS === 'string' && object.ERRORS.length > 0) {
				logger.error(`Emit device ID ${object.ID} reported error: ${object.ERRORS}`);
			}

			// construct packet
			const emitDataPacket = {
				timestamp: new Date().toISOString(),
				name: object.NAME,
				type: object.TYPE,
				id: object.ID,
				version: object.VERSION,
				packet_no: object.PACKET_NO,
				universe: object.UNIVERSE,
				errors: object.ERRORS || '',
			};

			// emit to the system
			eventHub.emit('attitudeEmitDataReceived', emitDataPacket);

			// update module status
			eventHub.emit('moduleStatus', { 
				name: 'AttitudeEmitManager', 
				status: 'operational',
				data: '',
			});
		} catch (error) {
			logger.error(`Error processing emit packet: ${error}`);
			eventHub.emit('moduleStatus', { 
				name: 'AttitudeEmitManager', 
				status: 'errored',
				data: `Error processing emit packet: ${error}`,
			});
		}
	}



	// validateEmitDataObject - validate that the emit data object includes all required parameters
	validateEmitDataObject(obj) {
		// Validate TYPE is 2 (Emit)
		if (obj.TYPE !== 2) {
			logger.warn(`Rejected emit packet: TYPE must be 2 but got ${obj?.TYPE}`);
			return false;
		}

		// Validate ID is integer ≥ 1
		if (!Number.isInteger(obj.ID) || obj.ID < 1) {
			logger.warn(`Rejected emit packet: ID must be an integer ≥ 1 but got ${obj?.ID}`);
			return false;
		}

		// Validate UNIVERSE is integer ≥ 1
		if (!Number.isInteger(obj.UNIVERSE) || obj.UNIVERSE < 1) {
			logger.warn(`Rejected emit packet: UNIVERSE must be an integer ≥ 1 but got ${obj?.UNIVERSE}`);
			return false;
		}

		// Validate NAME, VERSION, and PACKET_NO exist
		const requiredKeys = ['NAME', 'VERSION', 'PACKET_NO'];
		for (const key of requiredKeys) {
			if (typeof obj[key] === 'undefined') {
				logger.warn(`Rejected emit packet: missing required key '${key}'`);
				return false;
			}
		}

		// Passed all validation checks
		return true;
	}



	// broadcastEmitAssignments - broadcast universe and identify assignments to all known Attitude Emit devices
	broadcastEmitAssignments() {
		try {
			// grab the list of emit devices from the config manager
			const emitList = configManager.getAttitudeEmits();

			// loop through each emit device in the list
			for (const emit of emitList) {
				const id = emit.id;
				const universe = emit.assigned_universe;
				const identify = emit.assigned_identify_mode;

				// validate ID
				if (!Number.isInteger(id) || id < 1) {
					logger.warn(`Skipping emit with invalid ID: ${id}`);
					continue;
				}

				// validate universe number
				if (!Number.isInteger(universe) || universe < 1) {
					logger.warn(`Skipping emit ID ${id}: invalid universe: ${universe}`);
					continue;
				}

				// validate identify flag
				if (typeof identify !== 'boolean') {
					logger.warn(`Skipping emit ID ${id}: invalid identify flag: ${identify}`);
					continue;
				}

				// construct UDP packet for this emit device
				const packet = {
					DEST_TYPE: 2,
					DEST_ID: id,
					UNIVERSE_SET: universe,
					IDENTIFY: identify,
				};

				// send the packet via the UDP manager
				udpManager.send(packet);

				// optionally log the sent packet
				if (configManager.checkLogLevel('detail')) {
					logger.info(`Sent assignment to emit ID ${id}: ${JSON.stringify(packet)}`);
				}
			}

			// emit success module status
			eventHub.emit('moduleStatus', { 
				name: 'AttitudeEmitManager', 
				status: 'operational',
				data: '',
			});
		} catch (error) {
			// catch and report any internal error
			logger.error(`Error broadcasting emit assignments: ${error}`);
			eventHub.emit('moduleStatus', { 
				name: 'AttitudeEmitManager', 
				status: 'errored',
				data: `Error broadcasting emit assignments: ${error}`,
			});
		}
	}

}



// Create an instance of AttitudeEmitManager and initialize it
const attitudeEmitManager = new AttitudeEmitManager();

// Export the instance for use in other modules
export default attitudeEmitManager;
