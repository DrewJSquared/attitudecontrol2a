// AttitudeLED2A.mjs
// LED panel communication and control module for the Attitude Control 2.A app
// copyright 2024 Drew Shipps, J Squared Systems


// this module creates a single instance of the AttitudeLED javascript object,
// which controls the LED status displayed on the LED panel



// ==================== IMPORT ====================
import eventHub from './EventHub.mjs';
import { SerialPort } from 'serialport';

import Logger from './Logger.mjs';
const logger = new Logger('AttitudeLED');



// ==================== VARIABLES ====================
const LAPTOP_MODE = (process.platform == 'darwin');
const WRITE_COLOR_TO_PORT_INTERVAL = 500; // interval to write the current color to the port



// ==================== CLASS DEFINITION ====================
class AttitudeLED {

	// constructor
	constructor() {
		// store the path to this port
		this.portPath = LAPTOP_MODE ? '/dev/cu.usbmodem1301' : '/dev/ttyACM0';

		// store the current color
		this.color = 'A';

		// create the port
		this.port = new SerialPort({ path: this.portPath, baudRate: 115200, autoOpen: false });

		// Set up event listeners for the port
	    this.port.on('error', (err) => this.handleError(err));
	    this.port.on('close', () => this.handleClose());

	    // Attempt to open the port on initialization
	    this.initialize();
	}


	// Handle port errors
	handleError(error) {
		// log an error message
		logger.error(`Error connecting to Attitude LED panel: ${error.message}`);
	}


	// Handle port close events
	handleClose() {
		// log an error message
		logger.error(`Attitude LED panel disconnected!`);

		// attempt to reconnect
		this.reconnect();
	}


	// Attempt to reconnect to the port
	reconnect() {
		this.port.open((error) => {
			if (error) {
				// use the error handler function we already made to handle this error in reconnect functin
				this.handleError(error);
			} else {
				// else log that we reconnected
				logger.info(`Reconnected to Attitude LED Panel (Raspberry Pi Pico)!`);
			}
		});
	}


	// Initialize the connection and start the interval for writing color
	initialize() {
		// log that we are Initializing the connection
		logger.info(`Initializing connection to Attitude LED Panel (Raspberry Pi Pico)...`);

		// attempt to open the port
		this.port.open((err) => {
			if (err) {
				// use the error handler function we already made to handle this error
				this.handleError(err);
			} else {
				// else log that we reconnected
				logger.info(`Reconnected to Attitude LED Panel (Raspberry Pi Pico)!`);

				// write the current color to the port immediately
				this.writeColor();
			}
		});

		// Periodically write the current color to the port
		setInterval(() => this.writeColor(), WRITE_COLOR_TO_PORT_INTERVAL);
	}


	// Write the current color to the port
	writeColor() {
		// if the port is open then write
		if (this.port.isOpen) {
			// write the current color to the port
			this.port.write(this.color, (err) => {
				// if there's an error handle the error using the handler we already built
				if (err) {
					this.handleError(err);
				}
			});
		} else {
			// log that the port is not open and we are attempting to reconnect
			logger.error(`Port is not open. Attempting to reconnect...`);

			// attempt to reconnect
			this.reconnect();
		}
	}


	// Set a new color
	setColor(theColor) {
		this.color = theColor;
	}
}



// Create an instance of AttitudeLED and initialize it
const attitudeLED = new AttitudeLED();

// Export the attitudeLED instance for use in other modules
export default attitudeLED;