// NetworkModule.mjs
// network module for the Attitude Control 2.A app
// copyright 2024 Drew Shipps, J Squared Systems


// this module creates a single instance of the NetworkModule javascript object,
// which processes all requests to the Attitude Lighting server



// import modules
import fs from 'fs';
import eventHub from './EventHub.mjs';
import fetch from 'node-fetch';

import Logger from './Logger.mjs';
const logger = new Logger('NetworkModule');

import configManager from './ConfigManager.mjs';
import idManager from './IdManager.mjs';



// variables
// const API_URL = 'http://attitudelighting.test/api/v1/device/sync'; 
const API_URL = 'https://attitude.lighting/api/v1/device/sync';  // URL to hit with a POST request
const PING_INTERVAL = 1000;  // interval in ms to ping the server (should be 1000ms)
const MAX_ERROR_COUNT = 5;

const VERBOSE_LOGGING = false;

const MISSED_MESSAGES_FILE_PATH = './';  // path to save the config JSON file to
const MAX_MESSAGES_TO_RESEND_AT_ONCE = 250;



// Define the NetworkModule class to handle network communication
class NetworkModule {

	// constructor
    constructor(url, interval) {
        // Initialize the URL endpoint and request interval
        this.url = url;
        this.interval = interval;

        // Initialize queue of objects that are pending to be sent to the server
        // these objects might be logs, current status objects, data from external devices, etc.
        this.queue = [];

        // queue object structure
        /*
        {
		    type: 'log',
		    timestamp: '2024-06-30T12:00:00',
		    data: {
		        message: 'An error occurred in Module X',
		        severity: 'error'
		    }
		}
		*/

		// Init missed messages system
		this.errorCounter = 0;
		this.filePath = MISSED_MESSAGES_FILE_PATH + 'missedNetworkMessages.json';
		this.loadMissedNetworkMessagesFlag = true; 
		// this has to be true. we have to assume, upon app start, that there have been missed messages, 
		// and that the device was power cycled or something
    }


    // init function
    init() {
    	// log the initialization
    	logger.info('Initializing network module...');

    	// emit initializing event
    	eventHub.emit('moduleStatus', { 
			name: 'NetworkModule', 
			status: 'initializing',
			data: '',
		});

        // start the interval for sending network requests
        this.startInterval();

        // bind event listeners for logging and status updates
        eventHub.on('log', this.logListener.bind(this));
        eventHub.on('systemStatusUpdate', this.systemStatusUpdateListener.bind(this));
        eventHub.on('moduleStatusUpdate', this.moduleStatusUpdateListener.bind(this));
        eventHub.on('macrosStatus', this.macrosStatusListener.bind(this));

        // add some initial log message to the queue to show that we are initializing the system
        this.queue.push({
        	type: 'log',
        	timestamp: new Date(),
        	data: {
				timestamp: new Date().toISOString(),
				module: 'RESTART',
				type: 'warn',
				message: '--------------------------------------------------',
		    },
        });

        this.queue.push({
        	type: 'log',
        	timestamp: new Date(),
        	data: {
				timestamp: new Date().toISOString(),
				module: 'AttitudeControl2A',
				type: 'info',
				message: 'Attitude Control Device Firmware (2nd gen) v2.A',
		    },
        });

        this.queue.push({
        	type: 'log',
        	timestamp: new Date(),
        	data: {
				timestamp: new Date().toISOString(),
				module: 'AttitudeControl2A',
				type: 'info',
				message: 'Copyright 2024 Drew Shipps, J Squared Systems',
		    },
        });

        this.queue.push({
        	type: 'log',
        	timestamp: new Date(),
        	data: {
				timestamp: new Date().toISOString(),
				module: 'AttitudeControl2A',
				type: 'info',
				message: 'System initializing at time ' + new Date(),
		    },
        });

    	// log the initialization
    	logger.info('Network module initialization complete!');
    }


    // method to start the interval for sending network requests
    startInterval() {
    	// log the start of the interval
    	logger.info(`Starting network request interval at ${this.interval}ms...`);

        setInterval(() => {
            this.performNetworkRequest();
        }, this.interval);
    }


    // perform a network request to send queued data to the server
    performNetworkRequest() {
    	// log that we're performing a request
    	if (configManager.checkLogLevel('interval')) {
    		logger.info(`Performing network request at ${ new Date().toLocaleTimeString() }`);
    	}

    	// grab the entire current queue into a payload for this particular request (this clears the queue)
    	const payload = this.queue.splice(0, this.queue.length);
    	// console.log('PAYLOAD', payload);

    	// if necesary, add missed messages to the queue
    	if (this.loadMissedNetworkMessagesFlag) {
    		this.loadMissedNetworkMessages();
    	}

    	// create an object for the actual request
    	const requestObject = {
    		device_id: idManager.getId(),
    		serialnumber: idManager.getSerialNumber(),
    		payload: payload,
    	};

    	// log the entire request object
    	// console.log(JSON.stringify(requestObject));

    	// Make a POST request to the API endpoint with the request data
		fetch(this.url, {
		    method: 'POST',
		    headers: {
		        'Content-Type': 'application/json', // Set the Content-Type header to indicate JSON data
		    },
		    body: JSON.stringify(requestObject), // Convert the request object to a JSON string and set as the request body
		})

		// handle the response asynchronously
		.then(response => {
			// check response status (response.ok will return true if the HTTP code is anything 200-299)
		    if (!response.ok) {
		    	// if not ok, throw an error
		        throw new Error(`Request failed with status ${response.status}`);
		    }

			// log a success message
			if (configManager.checkLogLevel('interval')) {
	    		logger.info(`${response.status} ${response.statusText} request successful! Connected to attitude.lighting server!`);
	    	}

    		// if there had previously been errors, then flag that we need to grab the missed messages out of local file storage
    		if (this.errorCounter > MAX_ERROR_COUNT) {
    			this.loadMissedNetworkMessagesFlag = true;

    			if (configManager.checkLogLevel('detail')) {
	    			logger.info('Successfully reconnected to the attitude.lighting server! Begin restoring missed network messages.');
	    		}

    			// emit a moduleStatus event since we just reconnected
	    		eventHub.emit('moduleStatus', { 
	    			name: 'NetworkModule', 
	    			status: 'reconnected',
	    			data: '',
	    		});
    		} else {
    			// otherwise, we've been online, so emit a moduleStatus event that we are online
	    		eventHub.emit('moduleStatus', { 
	    			name: 'NetworkModule', 
	    			status: 'online',
	    			data: '',
	    		});
    		}

    		// reset the error counter
    		this.errorCounter = 0;

		    // return the body text of the response
		    return response.text();
		})

		// then handle the data from the response
		.then(data => {

    		// handle the response data
    		this.handleResponse(data);

		    // NOTE: because of the error handling logic below, 
		    // errors here in processing of received data will cause a re-transfer of previous data.
		    // So it's important to try to avoid errors here in this function when processing response data
		    // after data is succesfully sent to server.
		})

		// and catch any errors that occur
		.catch(error => {
			// log error to logger, which will show in console and queue log to be sent to server
    		logger.error(`Error during network request: ${error.message}`);

			// emit an event because we are currently offline
    		eventHub.emit('moduleStatus', { 
    			name: 'NetworkModule', 
    			status: 'offline',
    			data: `Error during network request: ${error.message}`,
    		});

    		// add this error to the counter
    		this.errorCounter++;

    		// if error count is greater than the max, then we need to start saving the missed data to a file, 
    		// instead of just to the queue, so that it can be re-sent later
    		if (this.errorCounter > MAX_ERROR_COUNT) {
    			this.savePayloadToFile(payload);
    		} else {
    			// otherwise, these messages should just be added back to the queue and re-sent to server.
	    		// unshift the queue by adding this payload (which failed) to the front
	    		this.queue.unshift(...payload);
    		}
		});
    }


    // Handle the response data from the server
    handleResponse(rawData) {
    	// wrap this logic in a try/catch, so that errors here will be caught instead of causing us to resend data in the fetch function
    	try {
    		// actually process the response data from the server here
			if (configManager.checkLogLevel('detail')) {
    			logger.info('Processing response data from server...');
    		}

    		// JSON parse the raw data from the server
    		let data = JSON.parse(rawData);

    		// update the config manager with the new data
    		configManager.update(data);

    		// log success
    		if (configManager.checkLogLevel('detail')) {
    			logger.info('Successfully processed response data from server!');
    		}
    	} catch (error) {
			// log error to logger, which will show in console and queue log to be sent to server
    		logger.error(`Error during response handling: ${error.message}`);

			// emit an event because we had an error handling this response
    		eventHub.emit('moduleStatus', { 
    			name: 'NetworkModule', 
    			status: 'errored',
    			data: `Error during response handling: ${error.message}`,
    		});
    	}
    }


    // add data into the queue for sending to the server
    // takes the type (a string such as 'log') and the data payload, creates an object, and adds it to queue
    enqueueData(type, data) {
        this.queue.push({
        	type: type,
        	timestamp: new Date(),
        	data: data,
        });
    }


    // event listener for log events
    // this function is bound to the event that's triggered when a 'log' is fired from the eventHub
    // it then grabs that log and adds it to the queue
    logListener(log) {
        this.enqueueData('log', log);
    }


    // systemStatusUpdateListener for systemStatus updated events
    systemStatusUpdateListener(currentSystemStatus) {
    	this.enqueueData('systemStatus', currentSystemStatus);
    }


    // moduleStatusUpdateListener for moduleStatus updated events
    moduleStatusUpdateListener(currentModuleStatus) {
    	this.enqueueData('moduleStatus', currentModuleStatus);
    }


    // macrosStatusListener for macrosStatus events
    macrosStatusListener(currentMacrosStatus) {
    	this.enqueueData('macrosStatus', currentMacrosStatus);
    }


    // savePayloadToFile - takes the current payload and adds it to the file missedNetworkMessages.json
    savePayloadToFile(payload) {
    	// variable to hold the parsed data from the missed messages file
    	let parsedData = this.loadMissedNetworkMessagesJSONFromFile();

    	// collect the queueToSaveToFile: the array of the previous data in the queue, plus the new payload added at the end
    	let queueToSaveToFile = parsedData;
    	queueToSaveToFile.push(...payload);

    	// save to file
    	this.saveMissedNetworkMessagesJSONToFile(queueToSaveToFile);
    }


    // loadMissedNetworkMessages - load the messages that we missed out of the JSON and add them to the queue
    loadMissedNetworkMessages() {
    	// quick log that we are loading missed messages
    	if (configManager.checkLogLevel('detail')) {
			logger.info('Loading missed messages from local JSON file...');
		}

    	// variable to hold the parsed data from the missed messages file
    	let parsedData = this.loadMissedNetworkMessagesJSONFromFile();

    	// if there's no data
    	if (parsedData.length == 0) {
    		// log that all missed messages have been resent
    		if (configManager.checkLogLevel('detail')) {
    			logger.info('No missed messages left to resend!');
    		}

    		// change this flag to false since we're done resending missed messages
    		this.loadMissedNetworkMessagesFlag = false;

    		return;
    	}

    	// hold the current set of items that should be added to queue
    	let currentMessagesToResend = this.grabAndRemoveFirstItems(parsedData, MAX_MESSAGES_TO_RESEND_AT_ONCE);

    	// add them to the queue
    	this.queue.push(...currentMessagesToResend);

    	// save whatever was left and can't be sent this round back to the JSON file
    	// this might be an empty array, which is fine, because that will then ensure that we're done.
    	this.saveMissedNetworkMessagesJSONToFile(parsedData);
    }


    // loadMissedNetworkMessagesJSONFromFile - actually load and process the JSON file, with appropriate error checking & logging
    loadMissedNetworkMessagesJSONFromFile() {
    	// variable to hold the raw data string from the missed messages file
    	let rawData = '[]';

    	// try to load the raw data as a string from the file at this path
    	try {
			rawData = fs.readFileSync(this.filePath);
    	} catch (error) {
    		// log a warning that no file was found
    		logger.warn('No file found at ' + this.filePath + ' (error: ' + error.message + ')');
    	}

    	// variable to hold the parsed data
    	let parsedData = [];

    	// try to parse the JSON
    	try {
			parsedData = JSON.parse(rawData);
    	} catch (error) {
    		// log a warning that JSON couldnt be parsed
    		logger.warn('Unable to parse JSON data, error: ' + error.message);
    	}

    	return parsedData;
    }


    // loadMissedNetworkMessagesJSONFromFile - actually load and process the JSON file, with appropriate error checking & logging
    saveMissedNetworkMessagesJSONToFile(data) {
    	// now try to save this to a file
    	try {
    		fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));

    		if (configManager.checkLogLevel('detail')) {
	    		logger.info('Saved the current payload to the missedNetworkMessages.json file!');
	    	}
    	} catch (error) {
    		// log a warning that the file couldn't be saved
    		logger.error('Unable to save the network queue to a file, error: ' + error.message);
    	}
    }


    // grab the first count number of items from an array
	grabAndRemoveFirstItems(arr, count) {
		// Handle the case where count is greater than the length of the array
		if (count >= arr.length) {
			const allItems = arr.slice(); // Make a copy of the array
			arr.length = 0; // Clear the array
			return allItems;
		}

		// Grab the first 'count' items
		const items = arr.slice(0, count);

		// Remove the first 'count' items from the array
		arr.splice(0, count);

		return items;
	}
}



// Create an instance of the NetworkModule and initialize it with the config variables at the top of this file
const networkModule = new NetworkModule(API_URL, PING_INTERVAL);

// Export the network module instance for use in other modules
export default networkModule;
