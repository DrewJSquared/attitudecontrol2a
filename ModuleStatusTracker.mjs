// ModuleStatusTracker.mjs
// this single-instance module tracks statuses of other modules for the Attitude Control 2.A app
// it also handles updating the color of the LED board
// copyright 2024 Drew Shipps, J Squared Systems



// import modules
import eventHub from './EventHub.mjs';
import attitudeLED from './AttitudeLED2A.mjs';
import attitudeSACN from './AttitudeSACN2A.mjs';

import Logger from './Logger.mjs';
const logger = new Logger('StatusTracker');



// variables
const SAMPLE_INTERVAL = 2000;  // interval for how often to check system status (should be 2000ms)
const UNRESPONSIVE_THRESHOLD = 10;  // number of seconds before considering a module unresponsive



// Define the ModuleStatusTracker class
class ModuleStatusTracker {

    // constructor
    constructor() {
        // minimum and maximum interval to send a status update
        this.sampleInterval = SAMPLE_INTERVAL;

        // variable to hold on to each module's current status
        this.modules = [];

        // variable to hold the overall status
        this.overallStatus = 'initializing';

        // bind an event listener for each moduleStatus event
        eventHub.on('moduleStatus', this.moduleStatusListener.bind(this));
    }


    // initialization function
    init() {
        // start the interval for status sampling
        setInterval(() => {
            this.processAllModulesStatus();
        }, this.sampleInterval);

        // run once immediately
        this.processAllModulesStatus();
    }


    // process the status of all modules
    processAllModulesStatus() {
        // wrap the system status processing in a try catch, in case there's errors with os
        try {
            logger.info(`Processing current status of all modules at ${ new Date().toLocaleTimeString() }`);

            // iterate over each module to check if any modules are unresponsive
            const currentTime = Date.now();
            this.modules.forEach(module => {
                const timeElapsed = (currentTime - module.timestamp) / 1000; // Time elapsed in seconds
                
                // check if this module is a one time status module
                // meaning that it's not going to be unresponsive because it only runs when needed
                let isAOneTimeStatusModule = module.oneTimeEvent === true ? true : false;

                if (timeElapsed > UNRESPONSIVE_THRESHOLD && !isAOneTimeStatusModule) {
                    module.status = 'unresponsive';
                    module.data = `Unresponsive for last ${this.timeAgoStringOnly(timeElapsed)}`;
                }
            });

            // copy the modules list, but without any oneTimeEvent properties
            const copyOfModulesToSend = this.modules.map(obj => {
                // Create a shallow copy of the object
                let newObj = { ...obj };
                
                // Remove the oneTimeEvent property if it exists
                if (newObj.hasOwnProperty('oneTimeEvent')) {
                    delete newObj.oneTimeEvent;
                }
                
                return newObj;
            });

            // process module statuses: update led panel, activate white backup, and set overall status
            this.processModuleStatuses();

            // create an object with each module's current status in it (for final network send)
            const currentModuleStatus = {
                timestamp: new Date(),
                overallStatus: this.overallStatus,
                modules: copyOfModulesToSend,
            };

            // TEMP log the current module status object
            // console.log('currentModuleStatus', currentModuleStatus);

            // emit an event that the current system status has been processed (which should then be picked up by network module)
            eventHub.emit('moduleStatusUpdate', currentModuleStatus);
        } catch (error) {
            logger.error(`Error processing status of all modules: ${error}`);
        }
    }


    // processModuleStatuses - check on the status of important modules. set led panel, white backup, and overall status accordingly
    processModuleStatuses() {
        // if SACN is errored, then go full red on the LED panel
        if (this.getModuleStatusByName('AttitudeSACN') == 'errored') {
            // E is just solid red no flash
            attitudeLED.setColor('E');

            // set the overall condition of the device to send to network
            this.overallStatus = 'errored';

            return;
        }


        // check if these modules have errored. if so, we need to go to white backup mode
        if (this.getModuleStatusByName('AttitudeScheduler') == 'errored'
            || this.getModuleStatusByName('AttitudeFixtureManager') == 'errored') {

            // set LED to cyan for white backup mode
            attitudeLED.setColor('C');

            // activate white backup mode
            attitudeSACN.setWhiteBackupMode(true);

            // set the overall condition of the device to send to network
            this.overallStatus = 'white';

            return;
        } else {
            // unless these modules have errored, then we should ensure white backup mode is disabled
            attitudeSACN.setWhiteBackupMode(false);
        }


        // if these modules are degraded or offline, there's an issue, but not a full on crash
        if (this.getModuleStatusByName('AttitudeScheduler') == 'degraded'
            || this.getModuleStatusByName('AttitudeFixtureManager') == 'degraded'
            || this.getModuleStatusByName('ConfigManager') == 'errored'
            || this.getModuleStatusByName('StatusTracker') == 'errored'
            || this.getModuleStatusByName('NetworkModule') == 'errored') {

            // set LED to blue (F) since we have an issue of some sort
            attitudeLED.setColor('F');

            // set the overall condition of the device to send to network
            this.overallStatus = 'degraded';

            return;
        }


        // if none are degraded and none are errored, then we can check network
        if (this.getModuleStatusByName('NetworkModule') == 'online') {
            // online is rainbow (A)
            attitudeLED.setColor('A');

            // set the overall condition of the device to send to network
            this.overallStatus = 'online';

            return;
        }

        if (this.getModuleStatusByName('NetworkModule') == 'offline') {
            // offline is purple (B)
            attitudeLED.setColor('B');

            // set the overall condition of the device to send to network
            this.overallStatus = 'offline';

            return;
        }
    }


    // moduleStatusListener - handler for moduleStatus events
    moduleStatusListener(newModuleStatus) {
        // add a timestamp to the new object
        newModuleStatus.timestamp = new Date();

        // Find the index of the module with the given name
        const index = this.modules.findIndex(module => module.name === newModuleStatus.name);

        if (index !== -1) {
            // If found, update the existing entry  

            // check to make sure the existing one isnt an error, and we're within 1 second of it
            if (newModuleStatus.status == 'operational' 
                && (this.modules[index].status == 'degraded' || this.modules[index].status == 'errored')
                && ((newModuleStatus.timestamp - this.modules[index].timestamp) < 5)) {
                // console.log('tried to add a new status that was operational within 5 sec of a non operational status');

                // console.log('new one was ', newModuleStatus)
                // console.log('old one was ', this.modules[index])
            } else {
                this.modules[index] = newModuleStatus;
            }
        } else {
            // If not found, add a new entry
            this.modules.push(newModuleStatus);
        }
    }


    // get a module's status by name
    getModuleStatusByName(name) {
        return this.findModuleByName(name)?.status ?? '';
    }


    // find a module by name
    findModuleByName(moduleName) {
        return this.modules.find(module => module.name === moduleName);
    }


    // timeAgo - gives a human readable, single unit of time
    timeAgoStringOnly(timeElapsed) {
        const timeDifference = timeElapsed; // Time elapsed in seconds

        const units = [
            // { name: 'year', seconds: 31536000 },
            // { name: 'month', seconds: 2592000 },
            // { name: 'week', seconds: 604800 },
            // { name: 'day', seconds: 86400 },
            { name: 'hour', seconds: 3600 },
            { name: 'minute', seconds: 60 },
            { name: 'second', seconds: 1 }
        ];

        for (const unit of units) {
            const interval = Math.floor(timeDifference / unit.seconds);
            if (interval >= 1) {
                return `${interval} ${unit.name}${interval > 1 ? 's' : ''}`;
            }
        }
    }
}



// Create an instance of ModuleStatusTracker
const moduleStatusTracker = new ModuleStatusTracker();

// Export the moduleStatusTracker instance for use in other modules
export default moduleStatusTracker;
