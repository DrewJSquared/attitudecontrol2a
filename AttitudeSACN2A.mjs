// AttitudeSACN2A.mjs
// sACN communication module for the Attitude Control 2.A app
// copyright 2024 Drew Shipps, J Squared Systems


// this module creates a single instance of the AttitudeSACN javascript object,
// which is responsible for sending sACN data out to lighting fixtures



// ==================== IMPORT ====================
import eventHub from './EventHub.mjs';
import e131 from 'e131';

import Logger from './Logger.mjs';
const logger = new Logger('AttitudeSACN');



// ==================== VARIABLES ====================
const DMX_INTERVAL_SPEED = 24;  // interval speed for DMX in milliseconds 
const DEBUG_FPS = false;  // enable or disable FPS debugging



// ==================== CLASS DEFINITION ====================
class AttitudeSACN {

	// constructor
	constructor() {
		// Initialize arrays to hold clients, packets, and slot data
		this.clients = [];
		this.packets = [];
		this.slotsDatas = [];
		
		// Default number of universes, can be changed in initialize
		this.universes = 4;
		
		// Frames per second counter
		this.fps = 0;
		
		// Variables to control DMX interval
		this.dmxIntervalActive = false;
		this.dmxInterval = null;

		// variable to track errored or not
		this.errored = false;

		// variable to track white backup mode
		this.whiteBackupMode = false;

		// set an interval for FPS once per second
		setInterval(() => {
			if (DEBUG_FPS) {
				// if debugging FPS, actually log the FPS to console
				logger.info(`DMX over sACN status fps: ${this.fps}`);
			}

			// emit an event that the module is operational and note the FPS
			if (!this.errored) {
		        eventHub.emit('moduleStatus', { 
		            name: 'AttitudeSACN', 
		            status: 'operational',
		            data: 'FPS: ' + this.fps,
		        });
			}

			// reset fps counter
			this.fps = 0;
		}, 1000);
	}


	// Method to initialize the sACN system with a given number of universes
	initialize(univ) {
		// try catch errors
		try {
			// Set the number of universes
			this.universes = univ;

			// Log initialization info
			logger.info(`Initializing with ${this.universes} universes at a ${DMX_INTERVAL_SPEED}ms interval...`);

			// Loop through each universe to set up clients and packets
			for (let i = 0; i < this.universes; i++) {
				// Create a new client for each universe
				this.clients[i] = new e131.Client(i + 1);
				
				// Create a packet for each client
				this.packets[i] = this.clients[i].createPacket(512);
				
				// Get slots data from the packet
				this.slotsDatas[i] = this.packets[i].getSlotsData();

				// Set source name, universe, and options for each packet
				this.packets[i].setSourceName('Attitude sACN Client');
				this.packets[i].setUniverse(i + 1);
				this.packets[i].setOption(this.packets[i].Options.PREVIEW, false);
				this.packets[i].setPriority(this.packets[i].DEFAULT_PRIORITY);

				// initialize slotsData to white
				for (let c = 0; c < 512; c++) {
					this.slotsDatas[i][c] = 255;
				}
			}

			// start DMX interval for sending packets out via client.send()
			this.dmxIntervalActive = true;
			this.dmxInterval = setInterval(() => {
	            this.processDMX();
	        }, DMX_INTERVAL_SPEED);

			// Log that the system is initialized
			logger.info(`System initialized, now outputting DMX over sACN!`);

			// emit an event that the system is initialized
	        eventHub.emit('moduleStatus', { 
	            name: 'AttitudeSACN', 
	            status: 'initialized',
	            data: '',
	        });
		} catch (error) {
			// Log the error!
			logger.error(`Error while initializing AttitudeSACN! ${error}`);

			// emit an event that the system had an error while initializing
	        eventHub.emit('moduleStatus', { 
	            name: 'AttitudeSACN', 
	            status: 'errored',
	            data: `Error while initializing AttitudeSACN! ${error}`,
	        });
		}
	}


	// Method to set DMX values for specific channels in specific universes
	set(u, c, v) {
		// Ensure universe, channel, and value are within valid ranges
		if (u > 0 && u <= this.universes) {
			if (c > 0 && c <= 512) {
				if (v >= 0 && v <= 255) {
					// Set the slot data value
					this.slotsDatas[u - 1][c - 1] = v;
				}
			}
		}
	}


	// processDMX - function to process a frame of DMX and send it to sACN
	processDMX() {
		try {
			// Increment FPS counter
			this.fps++;

			// Loop through each universe to send packets
			for (let u = 0; u < this.universes; u++) {
				// if we're in white backup mode, set all channels on this universe to 255
				if (this.whiteBackupMode) {
					for (let c = 0; c < 512; c++) {
						this.slotsDatas[u][c] = 255;
					}
				}

				// Send packet over sACN
				this.clients[u].send(this.packets[u], () => {
					// Sent callback
				});
			}

			// disable errored flag so that FPS counter starts
			this.errored = false;
		} catch (error) {
			// note the error so the FPS counter will stop
			this.errored = true;

			// Log the error
			logger.error(`Error while processing DMX: ${error}`);

			// emit an event that the system had an error
	        eventHub.emit('moduleStatus', { 
	            name: 'AttitudeSACN', 
	            status: 'errored',
	            data: `Error while processing DMX: ${error}`,
	        });

		}
	}


	// enable or disable white backup mode
	setWhiteBackupMode(value) {
		if (value == true) {
			// set white backup mode to true
			this.whiteBackupMode = true;

			// log a warning that we are in white backup mode
			logger.warn('White Backup Mode is now ENABLED! All fixtures will be white!');
		} else if (value == false) {
			// if we were previously in white backup mode, log a message that we are out of white backup mode
			if (this.whiteBackupMode) {
				logger.warn('White Backup Mode is now disabled. Fixtures will return to standard shows.');
			}

			// set white backup mode to false
			this.whiteBackupMode = false;
		} else {
			logger.error('Unknown white backup mode setting.')
		}
	}
}



// ==================== EXPORT ====================
const attitudeSACN = new AttitudeSACN();
export default attitudeSACN;
