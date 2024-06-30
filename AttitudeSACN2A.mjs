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

		// If debugging FPS, set an interval to log FPS every second
		if (DEBUG_FPS) {
			setInterval(() => {
				logger.info(`DMX over sACN status fps: ${this.fps}`);
				this.fps = 0;
			}, 1000);
		}
	}


	// Method to initialize the sACN system with a given number of universes
	initialize(univ) {
		// Set the number of universes
		this.universes = univ;

		// Log initialization info
		logger.info(`Initializing with ${this.universes} universes at a ${DMX_INTERVAL_SPEED}ms interval...`);

		// Loop through each universe to set up clients and packets
		for (let i = 0; i < this.universes + 1; i++) {
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
		}

		// Set all channels in the last universe to white
		for (let c = 0; c < 512; c++) {
			this.slotsDatas[this.universes][c] = 255;
		}

		// Set up DMX interval for sending packets out via client.send()
		this.dmxIntervalActive = true;
		this.dmxInterval = setInterval(() => {
			// Increment FPS counter
			this.fps++;

			// Loop through each universe to send packets
			for (let u = 0; u < this.universes; u++) {
				// Send packet over sACN
				this.clients[u].send(this.packets[u], () => {
					// Sent callback
				});
			}

			// Send the last universe as permanently white
			this.clients[this.universes].send(this.packets[this.universes]);
		}, DMX_INTERVAL_SPEED);

		// Log that the system is initialized
		logger.info(`System initialized, now outputting DMX over sACN!`);
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
}



// ==================== EXPORT ====================
const attitudeSACN = new AttitudeSACN();
export default attitudeSACN;
