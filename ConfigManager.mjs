// ConfigManager.mjs
// configuration data module for the Attitude Control 2.A app
// copyright 2024 Drew Shipps, J Squared Systems


// this module creates a single instance of the ConfigManager javascript object,
// which coordinates the configuration data across all other modules



// import modules
import fs from 'fs';
import eventHub from './EventHub.mjs';

import Logger from './Logger.mjs';
const logger = new Logger('ConfigManager');



// variables
const CONFIG_FILE_PATH = './';  // path to save the config JSON file to
const VERBOSE_LOGGING = false;



// Define the ConfigManager class to handle everything about the device's configuration
class ConfigManager {

	// constructor
	constructor() {
		// create the this.config property for all config to be stored in
		this.config = {};
		this.filePath = CONFIG_FILE_PATH + 'config.json';
	}


	// initialization function 
	init() {
		this.loadFromFile();
	}


	// load configuration from file
	loadFromFile() {
		// try to load the configuration data from the saved JSON file
		try {
			// load the raw data as a string from the file at this path
			const rawData = fs.readFileSync(this.filePath);

			// parse JSON data
			const parsedData = JSON.parse(rawData);

			// replace current config with the data from the file
			this.config = JSON.parse(rawData);

			// log success
			logger.info('Successfully loaded configuration data from local JSON file!');

			// log config to console for debugging
			// console.log(this.config);
		} catch (error) {
			// log the error
			logger.error(`Error loading configuration: ${error.message}`);
		}
	}


	// save configuration to file
	saveToFile() {
		// try to save the config to a file
		try {
			// log that we're trying
			if (VERBOSE_LOGGING) {
				logger.info('Saving configuration to file...');
			}

			// actually write the config to a file
			fs.writeFileSync('config.json', JSON.stringify(this.config, null, 2));

			// log success
			if (VERBOSE_LOGGING) {
				logger.info('Configuration saved successfully.');
			}
		} catch (error) {
			// log the error
			logger.error(`Error saving configuration: ${error.message}`);
		}
	}


	// update() - used to update only part of the configuration with new data
	update(newData) {
		// try to update the config with the new data, else log a failure
		try {
			// log that we're updating the config
			if (VERBOSE_LOGGING) {
				logger.info('Updating configuration with new data...');
			}

			// set this.config to the merged objects: this.config (original) and newData (new)
			this.config = this.mergeObjects(this.config, newData);

			// log success message
			if (VERBOSE_LOGGING) {
				logger.info('Successfully updated configuration!');
			}

			// save to file
			this.saveToFile();

			// log that we updated & saved
			logger.info('Successfully updated and saved configuration!');
		} catch (error) {
			// log the error
			logger.error(`Error updating configuration: ${error.message}`);
		}
	}


	// utility function to merge two objects
	// - If a key is present in A but not in B, it remains unchanged in A. 
	// - If a key is present in both A and B, the value from B overwrites the value in A.
	// - If a key is present only in B, it is added to A.
	mergeObjects(objA, objB) {
	    // Iterate over the keys of object B
	    Object.keys(objB).forEach(function(key) {
	        // Update object A with values from object B
	        objA[key] = objB[key];
	    });

	    // Return the updated object A
	    return objA;
	}


	// ----- GETTER METHODS FOR DIFFERENT PARTS OF CONFIGURATION ------
	
	// fixtures
	getFixtures() {
        const data = this.config?.patch?.fixturesList;

        // if undefined then log that we have an error and return empty array
        if (data === undefined) {
            logger.error(`Error accessing fixturesList! Invalid or undefined config.patch!`);
            return [];
        }

        return data;
	}

	// zones
	getZones() {
        const data = this.config?.patch?.zonesList;

        // if undefined then log that we have an error and return empty array
        if (data === undefined) {
            logger.error(`Error accessing zonesList! Invalid or undefined config.patch!`);
            return [];
        }

        return data;
	}

	getFixtureTypes() {
		return this.config.fixtureTypes || [];
	}

	// shows
	getShows() {
        return this.config.shows || [];
	}

	// scheduleBlocks
	getScheduleBlocks() {
		return this.config.scheduleBlocks || [];
	}

	// eventBlocks
	getEventBlocks() {
		return this.config.eventBlocks || [];
	}

	// customBlocks 
	getCustomBlocks() {
		return this.config.customBlocks || [];
	}
	
	// overrides
	getOverrides() {
		return this.config.overrides || [];
	}
	
	// webOverrides
	getWebOverrides() {
		return this.config.webOverrides || [];
	}

	// timezone
	getDeviceTimezone() {
		// try to get the parameter, else throw/log an error and return a default
		try {
			// ? is the safe optional chaining operator that safely grabs those properties
	        const timezone = this.config?.devicemeta?.timezone;

	        // if undefined then we have an error
	        if (timezone === undefined) {
	            throw new Error('Either devicemeta or timezone is missing!');
	        }

	        // else return the grabbed tiemzone
	        return timezone;
	    } catch (error) {
	    	// log the error to logger
	        logger.error(`Error accessing config.devicemeta.timezone: ${error.message}`);

	        // return default
	        return 'America/Chicago';
	    }
	}
}



// Create an instance of the ConfigManager and initialize it
const configManager = new ConfigManager();
configManager.init();

// Export the configManager instance for use in other modules
export default configManager;