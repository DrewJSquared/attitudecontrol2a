// Logger.mjs
// a logger module for the Attitude Control 2.A app
// copyright 2024 Drew Shipps, J Squared Systems


// import modules
import npmlog from 'npmlog';
import eventHub from './EventHub.mjs';


// variables & options
const LAPTOP_MODE = (process.platform == 'darwin');
const MAX_TIME_SINCE_DUPLICATE_LOG_SHOWN = 5000; // max interval in ms to ensure duplicate logs are still shown at some point


// create the class
class Logger {

	// constructor
	constructor(moduleName) {
		// moduleName: the name of the module using this instance of logger
		this.moduleName = moduleName;

		// hold on to the previous logEntry
	    this.lastLogEntry = null;

	    // hold on to the # of duplicate logs in a row
	    this.duplicateLogCount = 0;

	    // hold on to the timestamp since the last duplicate log was shown
    	this.duplicateLogTimestamp = null;
	}


	// log - primary method for logging data through logger
	log(type, message) {
		// clean up the type parameter (trim & lowercase)
		type = type.trim().toLowerCase();

		// create a logEntry object for this log
		const logEntry = {
			timestamp: new Date().toISOString(),
			module: this.moduleName,
			type,
			message,
		};

		// if this log is the exact same as the last one, simply increase the duplicate count
		if (this.lastLogEntry && this.lastLogEntry.message === message && this.lastLogEntry.type === type) {
			// increment the duplicate counter
			this.duplicateLogCount++;

			// calculate the time since the last duplicate was shown
			const now = new Date();
	     	const diff = now - this.duplicateLogTimestamp;

			// if it's been longer than the max time variable, then go ahead and log the current duplicates count 
			// (or if it's only one of the first two logs shown)
			if (diff > MAX_TIME_SINCE_DUPLICATE_LOG_SHOWN || this.duplicateLogCount < 2) {
				// print the duplicate log to console
				this.printDuplicateLogsToConsole();

				// update the timestamp so that the diff will reset and we only log every 10 sec
	      		this.duplicateLogTimestamp = new Date();
			}
		} else {
			// if there were any duplicates, log that there were duplicates
			if (this.duplicateLogCount > 0) {
				this.printDuplicateLogsToConsole();
			}

			// now log the new message
			this.printLogToConsole(logEntry);

			// save this log as the last log
			this.lastLogEntry = logEntry;

			// update the timestamp
      		this.duplicateLogTimestamp = new Date();

			// reset the duplicate log count
			this.duplicateLogCount = 0;
		}
	}


	// grab any duplicate logs and print them to console
	printDuplicateLogsToConsole() {
		// grab the last log
		var duplicateLogEntry = JSON.parse(JSON.stringify(this.lastLogEntry));

		// change the message on it to note the duplicates
		duplicateLogEntry.message = `${this.duplicateLogCount + 1} DUPLICATES | ${duplicateLogEntry.message}`;

		// actually print the log to console
		this.printLogToConsole(duplicateLogEntry);
	}


	// printLogToConsole - actually take a log entry and print it to console
	printLogToConsole(logEntry) {
		// clean up the type parameter (trim & lowercase)
		logEntry.type = logEntry.type.trim().toLowerCase();

		// switch case for the different types of logs
		switch (logEntry.type) {
			// for standard info logs
			case 'info':
				// check if in laptop mode to use pretty npmlog, else use console (for raspi & PM2)
				if (LAPTOP_MODE) {
					npmlog.info(logEntry.module, logEntry.message);
				} else {
					console.warn(`INFO | ${logEntry.module} | ${logEntry.message}`);
				}

				break;

			// for warning logs
			case 'warn':
				if (LAPTOP_MODE) {
					npmlog.warn(logEntry.module, logEntry.message);
				} else {
					console.warn(`WARN | ${logEntry.module} | ${logEntry.message}`);
				}

				break;

			// for error logs
			case 'error':
				if (LAPTOP_MODE) {
					npmlog.error(logEntry.module, logEntry.message);
				} else {
					console.error(`ERR! | ${logEntry.module} | ${logEntry.message}`);
				}

				break;

			// default fallback behavior
			default:
				if (LAPTOP_MODE) {
					npmlog.warn(logEntry.module, `UNKNOWN LOG TYPE "${logEntry.type}" WITH MESSAGE: ${logEntry.message}`);
				} else {
					console.warn(`UNKNOWN LOG TYPE "${logEntry.type}" | ${logEntry.module} | ${logEntry.message}`);
				}
		}


		// emit 'log' event to the eventHub, which can then be picked up by the network module to send to server
		eventHub.emit('log', logEntry);
	}


	// provide a method for info logs directly to simplify code to logger.info(message) instead of logger.log('info', message)
	info(message) {
		this.log('INFO', message);
	}

	// provide a method for warn logs
	warn(message) {
		this.log('WARN', message);
	}

	// provide a method for error logs
	error(message) {
		this.log('ERROR', message);
	}
}


// export the Logger class
export default Logger;