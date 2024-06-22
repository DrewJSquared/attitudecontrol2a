// NetworkModule.mjs
// network module for the Attitude Control 2.A app
// copyright 2024 Drew Shipps, J Squared Systems


// this module creates a single instance of the NetworkModule javascript object,
// which processes all requests to the Attitude Lighting server



// import modules
import eventHub from './eventHub.mjs';
import fetch from 'node-fetch';

import Logger from './Logger.mjs';
const logger = new Logger('NetworkModule.mjs');


// *** havent created these modules yet
// import { configManager } from './ConfigManager.mjs';
// import { deviceManager } from './DeviceManager.mjs';



// variables
const API_URL = 'https://attitude.lighting/api/v1/device/sync';  // URL to hit with a POST request
const PING_INTERVAL = 5000;  // interval in ms to ping the server




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
    }


    // init function
    init() {
    	// log the initialization
    	logger.info('Initializing network module...');

        // start the interval for sending network requests
        this.startInterval();

        // bind event listeners for logging and status updates
        eventHub.on('log', this.logListener.bind(this));
        // eventHub.on('statusUpdate', this.statusUpdateListener.bind(this));

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
    	logger.info(`Performing network request at ${ new Date().toLocaleTimeString() }`);

    	// grab the entire current queue into a payload for this particular request (this clears the queue)
    	const payload = this.queue.splice(0, this.queue.length);
    	console.log('PAYLOAD', payload);

    	// Make a POST request to the API endpoint with the request data
		fetch(this.url, {
		    method: 'POST',
		    headers: {
		        'Content-Type': 'application/json', // Set the Content-Type header to indicate JSON data
		    },
		    body: JSON.stringify(payload), // Convert the payload JSON to a string and set as the request body
		})

		// handle the response asynchronously
		.then(response => {
			// check response status (response.ok will return true if the HTTP code is anything 200-299)
		    if (!response.ok) {
		    	// if not ok, throw an error
		        throw new Error(`Request failed with status ${response.status}`);
		    }

		    // Parse the JSON response body and return it
		    return response.json();
		})

		// then handle the data from the response
		.then(data => {
			// log a success message
    		logger.info(`Network request was successful! Connected to attitude.lighting server!`);

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
    		logger.error(`Error during network request or response handling: ${error.message}`);

    		// since there was an error of some sort, these messages should be added back to the queue and re-sent to server
    		// unshift the queue by adding this payload (which failed) to the front
    		this.queue.unshift(...payload);
		});
    }


    // Handle the response data from the server
    handleResponse(data) {
        // Update the device configuration if provided in the response
        if (data.configUpdate) {
            configManager.updateConfig(data.configUpdate);
        }

        // Update the device status if provided in the response
        if (data.deviceStatus) {
            deviceManager.updateStatus(data.deviceStatus);
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
}



// Create an instance of the NetworkModule and initialize it with the config variables at the top of this file
const networkModule = new NetworkModule(API_URL, PING_INTERVAL);
networkModule.init();

// Export the network module instance for use in other modules
export default networkModule;
