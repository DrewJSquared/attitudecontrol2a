// AttitudeFixtureManager.mjs
// manages and processes fixtures for the Attitude Control 2.A app
// copyright 2024 Drew Shipps, J Squared Systems


// this module creates a single instance of the AttitudeFixtureManager javascript object,
// which then takes the fixtures, schedule, shows, and engine to calculate DMX values



// ==================== IMPORT ====================
import Logger from './Logger.mjs';
const logger = new Logger('AttitudeFixtureManager');

import eventHub from './EventHub.mjs';
import configManager from './ConfigManager.mjs';
import attitudeScheduler from './AttitudeScheduler.mjs';
import attitudeSACN from './AttitudeSACN2A.mjs';

// import engine
import { AttitudeEngine3 } from './AttitudeEngine3.mjs';
import { SHOWTYPES } from './ShowTypes.js';
import { DIRECTIONS } from './Directions.js';
import { TRANSITIONS } from './Transitions.js';



// ==================== VARIABLES ====================
const DMX_FRAME_INTERVAL = 1000;  // interval speed in milliseconds for each DMX frame (should be 25ms)



// ==================== CLASS DEFINITION ====================
class AttitudeFixtureManager {

	// constructor
	constructor() {
		// variables to hold fixture/shows/schedule configuration
		this.zonesList = [];
		this.fixturesList = [];
		this.showsList = [];
		this.schedule = new Array(10).fill(0);

		// variable to hold instances of the AttitudeEngine for each show
		// each engineInstance should include an object with the engine and show ID
		this.engineInstances = [];

		// variable to hold the processFixtures interval ID
		this.processFixturesInterval;
	}


	// start the DMX frame interval for running the engine
    init() {
        // Start the scheduling interval to run processFixtures function
        this.processFixturesInterval = setInterval(() => {
            this.processFixtures();
        }, DMX_FRAME_INTERVAL);

        // log succcess message
        logger.info('Initialized the fixture manager and started the process fixtures interval!');
    }


    // processFixtures - master function that runs every 25ms to process fixtures/shows/schedule,
    // run engine, then send values to sACN/DMX
    processFixtures() {
    	// try to process fixtures
    	try {

    		// temp
        	logger.info('Processing fixtures/shows/schedule...');


    		// get fixtures/zones/shows configManager and schedule from attitudeScheduler
        	this.getConfigration();



        	this.processShows();



    	} catch (error) {
    		// else log error
            logger.error(`Error processing fixtures: ${error}`);

            // TODO note error here and maybe fire an event? force us to go to white backup mode?
        }
    }


    // getConfigration - update the internal data about the schedule here by getting the most recent data from the configManager
    getConfigration() {
		// get schedule/custom/override blocks
		this.zones = configManager.getZones();
		this.fixtures = configManager.getFixtures();
		this.shows = configManager.getShows();
		this.schedule = attitudeScheduler.getFinalSchedule();

		// log items to console for debugging
		// console.log('zones', this.zones);
		// console.log('fixtures', this.fixtures);
		// console.log('shows', this.shows);
		// console.log('schedule', this.schedule);
	}


	// processShows - function that takes all the show IDs present in the schedule, 
	// processes each show data, and stores the engine instance for it
	processShows() {
		// find unique show IDs
		this.uniqueShowIds = this.findUniqueNumbers(this.schedule);

		// generate/remove engine instances if needed
		this.generateEngineInstances();

		// processEngineInstances
		this.generateEngineInstances();

		console.log('uniqueShowIds', this.uniqueShowIds);
		console.log('engineInstances', this.engineInstances);
	}


	// processEngineInstances - process each engine instance
	processEngineInstances() {
		// update engine instance configuration based on show

		    // find the actual event block from the ID referenced in current schedule block
		    const show = this.shows.find(itm => itm.id === currentScheduleBlock.eventBlockId);

		// run engine
	}


	// generateEngineInstances - generate any new engineInstances needed, and remove any not needed, based on this.uniqueShowIds
	generateEngineInstances() {
	    const uniqueIdSet = new Set(this.uniqueShowIds);

	    // Create a map of current engineInstances for quick lookup
	    const showMap = new Map();
	    this.engineInstances.forEach(show => {
	        showMap.set(show.showId, show);
	    });

	    // Filter the engineInstances list to only include items in uniqueIds
	    this.engineInstances = this.engineInstances.filter(show => uniqueIdSet.has(show.showId));

	    // Add new items for each id in uniqueIds if not already present
	    this.uniqueShowIds.forEach(id => {
	        if (!showMap.has(id)) {
	        	// create the engine object
	        	let engine = new AttitudeEngine3({
		            showType: SHOWTYPES.STATIC,
		            direction: DIRECTIONS.LR,
		            speed: 50,
		            size: 34,
		            splits: 1,
		            transition: TRANSITIONS.BOTH,
		            transitionWidth: 0,
		            bounce: false,
		            colors: [
		                { red: 255, green: 0, blue: 0 },
		                { red: 0, green: 255, blue: 0 },
		                { red: 0, green: 0, blue: 255 },
		            ]
		        });

		        // now push this to the engineInstances list
	            this.engineInstances.push({
	            	showId: id,
	            	engine: engine,
	            });
	        }
	    });
	}


	// finds all unique numbers in the input array. used to find unique show IDs to process shows. Skips zeroes.
	findUniqueNumbers(inputArray) {
	    // Create a Set to store unique numbers
	    const uniqueNumbers = new Set();

	    // Helper function to process each element
	    function processElement(element) {
	        if (Array.isArray(element)) {
	            element.forEach(processElement); // Recursively process nested arrays
	        } else if (typeof element === 'number' && element != 0) { // skip zeros in array
	            uniqueNumbers.add(element); // Add number to the Set
	        }
	    }

	    // Process each element in the input array
	    inputArray.forEach(processElement);

	    // Convert the Set back to an array and return
	    return [...uniqueNumbers];
	}

}



// ==================== EXPORT ====================
const attitudeFixtureManager = new AttitudeFixtureManager();
export default attitudeFixtureManager;