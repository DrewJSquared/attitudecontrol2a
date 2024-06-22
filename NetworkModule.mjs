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
const PING_INTERVAL = 1000;  // interval in ms to ping the server




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

        // Start the interval for sending network requests
        this.startInterval();

        // Register event listeners for logging and status updates
        eventHub.on('log', this.logEventListener.bind(this));
        eventHub.on('statusUpdate', this.statusUpdateListener.bind(this));

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
    	logger.info(`Performing network request at ${ new Date().toLocaleTimeString() }`);


    	// consolidate the current queue into a payload
    	const payload = this.queue.splice(0, this.queue.length);
    	console.log('PAYLOAD: ', payload);


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
			// TEMP log data to console
		    console.log('Response:', data);

		    // throw new Error(`Manualy thrown error in data parse....`);
		})

		// and catch any errors that occur
		.catch(error => {
			// log error to logger, which will show in console and queue log to be sent to server
    		logger.error(`Error during network request or response handling: ${error.message}`);
		});



/*



        if (this.queue.length === 0) return;

        const dataToSend = this.dequeueData();

        try {
            // Send a POST request to the server with the queued data
            const response = await fetch(this.url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(dataToSend)
            });

            // Check if the response is successful
            if (response.ok) {
                // Parse the response data and handle it
                const responseData = await response.json();
                this.handleResponse(responseData);
            } else {
                // Throw an error if the network request fails
                throw new Error(`Network request failed with status ${response.status}`);
            }
        } catch (error) {
            // Handle errors encountered during the network request
            this.handleError(error, dataToSend);
        }

        */
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

    // Enqueue data for sending to the server
    enqueueData(data) {
        this.queue.push(data);
    }

    // Dequeue data from the queue for sending to the server
    dequeueData() {
        return this.queue.shift();
    }

/*
    // Start the interval for retrying failed requests
    startRetryInterval() {
        setInterval(() => {
            // Check if there are failed requests to retry
            if (this.failedRequests.length > 0) {
                // Retrieve the first failed request and enqueue it for retry
                const failedRequest = this.failedRequests.shift();
                this.enqueueData(failedRequest);
            }
        }, this.retryInterval);
    }
    */

    // Handle errors encountered during the network request
    handleError(error, data) {
        console.error('Network request failed:', error);

        // Add the failed request data to the queue for retry
        this.failedRequests.push(data);
    }

    // Event listener for logging events
    logEventListener(log) {
        this.enqueueData({ type: 'log', data: log });
    }

    // Event listener for status update events
    statusUpdateListener(statusUpdate) {
        this.enqueueData({ type: 'statusUpdate', data: statusUpdate });
    }
}


// Create an instance of the NetworkModule and initialize it with the config variables at the top of this file
const networkModule = new NetworkModule(API_URL, PING_INTERVAL);
networkModule.init();

// Export the network module instance for use in other modules
export default networkModule;
