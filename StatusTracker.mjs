// StatusTracker.mjs
// status tracking module for the Attitude Control 2.A app
// copyright 2024 Drew Shipps, J Squared Systems


// this module creates a single instance of the StatusTracker javascript object,
// which dynamically tracks the current OS-level system status and sends it to the network module



// import modules
import os from 'os';
import eventHub from './EventHub.mjs';

import Logger from './Logger.mjs';
const logger = new Logger('NetworkModule.mjs');



// variables
const MIN_SAMPLE_INTERVAL = 1000;  // minimum interval to check status
const MAX_SAMPLE_INTERVAL = 5000;  // maximium interval before am update will be sent anyway



// Define the StatusTracker class to handle network communication
class StatusTracker {

    // constructor
    constructor() {
        // minimum and maximum interval to send a status update
        this.minSampleInterval = MIN_SAMPLE_INTERVAL;
        this.maxSampleInterval = MAX_SAMPLE_INTERVAL;

        // hold the last status
        this.lastStatus = null;
        this.lastStatusTimestamp = null;

        // start the interval for status sampling
        this.startSampling();
    }


    // start adaptive sampling on minimum interval
    startSampling() {
        setInterval(() => {
            // process system status
            this.processSystemStatus();
        }, this.minSampleInterval);
    }


    // process system status
    processSystemStatus() {
        const currentStatusMetrics = this.getSystemStatus();

        // if the current status metrics are the same as previously AND it's been less than this.maxSampleInterval ms since last update
        // then just return true because system is unchanged
        if (JSON.stringify(currentStatusMetrics) === this.lastStatus 
            && (Date.now() - this.lastStatusTimestamp) > this.maxSampleInterval) {

            console.log('System unchanged'); // TEMP
            return;
        }

        // update last status to current & update timestamp
        this.lastStatus = JSON.stringify(currentStatusMetrics);
        this.lastStatusTimestamp = Date.now();

        console.log('system has changed!');

    }


    // get system status data
    getSystemStatus() {
        const statusMetrics = {
            cpuUsage: os.loadavg()[0], // Get CPU usage
            memoryUsage: os.totalmem() - os.freemem(), // Get memory usage
            diskUsage: "TODO", // Get disk usage (you can implement this)
            cpuTemp: "TODO", // Get CPU temperature (you can implement this)
            networkStatus: "TODO" // Get network status (you can implement this)
        };

        console.log('statusMetrics', statusMetrics);

        return statusMetrics;
    }


    // Emit status update event to the eventHub
    // emitStatusUpdate(status) {
    //     this.lastStatus = status; // Update last status
    //     eventHub.emit('statusUpdate', status); // Emit status update event
    // }
}



// Create an instance of StatusTracker
const statusTracker = new StatusTracker();

// Export the statusTracker instance for use in other modules
export default statusTracker;
