// AttitudeScheduler.mjs
// schedule processing module for the Attitude Control 2.A app
// copyright 2024 Drew Shipps, J Squared Systems


// this module creates a single instance of the AttitudeScheduler javascript object,
// which then processes the schedule for this device



// ==================== IMPORT ====================
import Logger from './Logger.mjs';
const logger = new Logger('AttitudeScheduler');

import eventHub from './EventHub.mjs';
import configManager from './ConfigManager.mjs';
import attitudeSACN from './AttitudeSACN2A.mjs';

import { DateTime } from 'Luxon';



// ==================== VARIABLES ====================
const PROCESS_SCHEDULE_INTERVAL = 1000;  // interval speed for recalculating the schedule in milliseconds
// might make this something configurable by the server later

const MAX_ZONES_COUNT = 10;  // max number of zones in the patch



// ==================== CLASS DEFINITION ====================
class AttitudeScheduler {

	// constructor
	constructor() {
		// setup timezones
		this.timezoneString = 'America/Chicago';
		this.currentTimestamp;

		// setup variables to hold current time
		this.now = {};
		this.now.month = 1;
		this.now.day = 1;
		this.now.weekday = 1;
		this.now.hour = 1;
		this.now.minute = 1;

		// setup variables to hold the different components of the configuration of the schedule blocks
		this.scheduleBlocks = [];
		this.customBlocks = [];
		this.overrides = [];
		this.webOverrides = [];

		// setup variables to hold the processed show ids lists. ex: [104, 1, 0, 37, 0]
		this.processedShowIds = {};
		this.processedShowIds.defaultWeeklySchedule = new Array(MAX_ZONES_COUNT).fill(0);
        this.processedShowIds.customScheduleBlocks = new Array(MAX_ZONES_COUNT).fill(0);
        this.processedShowIds.overrides = new Array(MAX_ZONES_COUNT).fill(0);
        this.processedShowIds.webOverrides = new Array(MAX_ZONES_COUNT).fill(0);
        this.processedShowIds.final = new Array(MAX_ZONES_COUNT).fill(0);
	}


	// Initialize the scheduler and start the interval
    init() {
        // Start the scheduling interval to run processSchedule function
        this.intervalId = setInterval(() => {
            this.processSchedule();
        }, PROCESS_SCHEDULE_INTERVAL);

        logger.info('Initialized the scheduler and started the processSchedule interval!');
    }


    // process the schedule at regular intervals
    processSchedule() {
    	// try to process schedule
    	try {
    		// grab the most up to date schedule config blocks & timestamp from configManager
    		this.updateScheduleConfigration();

    		// update the current timestamp based on timezone in config and 
    		this.updateCurrentTime();

    		// process each component of the schedule
    		this.processWeeklySchedule();
    		this.processCustomScheduleBlocks();
    		this.processOverrides();
    		this.processWebOverrides();

    		// layer the schedule
    		this.layerScheduleToCreateFinal();

    		// log the final output schedule
    		logger.info('Processed schedule and determined final show ids: ' + JSON.stringify(this.processedShowIds.final));

    		// TODO fire some sort of event here to update the fixture patch & shows data?
    	} catch (error) {
    		// else log error
            logger.error(`Error processing schedule: ${error}`);

            // TODO note error here and maybe fire an event? force us to go to white backup mode?
        }
    }


    // updateScheduleConfigration - update the internal data about the schedule here with the data from the configManager
    updateScheduleConfigration() {
		// get current time from device config timezone
		this.timezoneString = configManager.getDeviceTimezone();

		// get schedule/custom/override blocks
    	this.scheduleBlocks = configManager.getScheduleBlocks();
		this.eventBlocks = configManager.getEventBlocks();
		this.customBlocks = configManager.getCustomBlocks();
		this.overrides = configManager.getOverrides();
		this.webOverrides = configManager.getWebOverrides();
	}


	// updateCurrentTime - update the internal time variables based on timezone
	updateCurrentTime() {
		// get the current local time
		var local = DateTime.local();

		// rezone the current local time based on the timezone string saved
		var rezoned = local.setZone(this.timezoneString);

		// update current timestamp
		this.currentTimestamp = rezoned;

		this.now = {};
		this.now.month = rezoned.month;
		this.now.day = rezoned.day;
		this.now.weekday = (rezoned.weekday % 7 + 1); // offset for luxon thinking about days of week differently
		this.now.hour = rezoned.hour;
		this.now.minute = rezoned.minute;

		// log the current time
		logger.info(`Current time in ${this.timezoneString} is ${this.currentTimestamp.toFormat("ccc LLL d yyyy H:mm:ss 'GMT'ZZ (ZZZZZ)")}`);
	}


    // process the weekly schedule itself
    processWeeklySchedule() {
    	// try to process the weekly schedule
    	try {
    		// find the current schedule block
		    const currentScheduleBlock = this.scheduleBlocks.find(block => 
		        block.day === this.now.weekday &&
		        block.start - 1 <= this.now.hour &&
		        block.start - 1 + block.height > this.now.hour
		    );

		    // find the actual event block from the ID referenced in current schedule block
		    const eventBlock = this.eventBlocks.find(itm => itm.id === currentScheduleBlock.eventBlockId);

		    // if a block was found, then pull the showdata out and map it to the defaultWeeklySchedule
		    if (eventBlock) {
		        this.processedShowIds.defaultWeeklySchedule = [...eventBlock.showdata];

		        // Fill remaining spots with 0 if necessary
		        while (this.processedShowIds.defaultWeeklySchedule.length < MAX_ZONES_COUNT) {
		            this.processedShowIds.defaultWeeklySchedule.push(0);
		        }
		    }

		    // log that we finished (optional)
		    logger.info('Processed default weekly schedule: ' + JSON.stringify(this.processedShowIds.defaultWeeklySchedule));
    	} catch (error) {
    		// else log error
            logger.error(`Error processing weekly schedule: ${error}`);

            // default array to zeroes, which will make this part of the schedule processing transparent
            this.processedShowIds.defaultWeeklySchedule = new Array(MAX_ZONES_COUNT).fill(0);
    	}
    }


    // process the custom schedule blocks (pre-schedule overrides)
    processCustomScheduleBlocks() {
    	// try processing custom blocks
    	try {
    		// iterate over each custom block
    		this.customBlocks.forEach(thisBlock => {
    			// variable to hold if this block applies to today
				let thisBlockShouldBeToday = false;

				// validate that we aren't using the old type of custom block with singular month/days
				if (thisBlock.month !== undefined && thisBlock.day !== undefined) {
					throw new Error('Invalid type of custom schedule block. Please rebuild this block.');
		        }

		        // if the any of the month/day start/end values are undefined, throw an error
		        if (thisBlock.startMonth == undefined || thisBlock.startDay == undefined ||
		            thisBlock.endMonth == undefined || thisBlock.endDay == undefined) {
	        		throw new Error('Invalid start/end month/day for this block.');
		    	}

		    	// now setup the monthday stamps, which establish whether we are currently within the month/day combo selected
			    const startMonthDayStamp = thisBlock.startMonth * 100 + thisBlock.startDay;
			    const endMonthDayStamp = thisBlock.endMonth * 100 + thisBlock.endDay;
			    const currentMonthDayStamp = this.now.month * 100 + this.now.day;

			    // massive if statement to check if we are within the timespan for this block (note that some wrap around the new year)
			    if (
			        (endMonthDayStamp >= startMonthDayStamp && currentMonthDayStamp >= startMonthDayStamp && currentMonthDayStamp <= endMonthDayStamp) ||
			        (endMonthDayStamp < startMonthDayStamp && (currentMonthDayStamp >= startMonthDayStamp || currentMonthDayStamp <= endMonthDayStamp))
			    ) {
			        thisBlockShouldBeToday = true;
			        if (endMonthDayStamp < startMonthDayStamp) {
			        	logger.info('This schedule block wraps around the new year.');
			        }
			    }

			    // if it is determnied that this block should be run today, then we need to check the time of day
				if (thisBlockShouldBeToday) {
					// calculate raw time numbers in number of minutes for current, start, and end
				    const currentTimeNumber = this.now.hour * 60 + this.now.minute;
				    const thisBlockStartNumber = thisBlock.startHour * 60 + thisBlock.startMinute;
				    const thisBlockEndNumber = thisBlock.endHour * 60 + thisBlock.endMinute;

				    // see if we are within those numbers
				    if (currentTimeNumber >= thisBlockStartNumber && currentTimeNumber < thisBlockEndNumber) {
				    	// log that we're running this custom block
				    	logger.info(`Running custom schedule block "${thisBlock.name}"`);

				    	// pull the showdata out of this custom block and 
				    	this.processedShowIds.customScheduleBlocks = this.layerAnOverride(this.processedShowIds.customScheduleBlocks, thisBlock.showdata);

				    	// fill remaining spots with 0 if necessary
				        while (this.processedShowIds.defaultWeeklySchedule.length < MAX_ZONES_COUNT) {
				            this.processedShowIds.defaultWeeklySchedule.push(0);
				        }
				    }
				}
			});

		    // log that we finished (optional)
		    logger.info('Processed custom schedule blocks: ' + JSON.stringify(this.processedShowIds.customScheduleBlocks));
    	} catch (error) {
    		// else log error
            logger.error(`Error processing custom schedule blocks: ${error}`);

            // default array to zeroes, which will make this part of the schedule processing transparent
            this.processedShowIds.customScheduleBlocks = new Array(MAX_ZONES_COUNT).fill(0);
    	}
    }


    // process the overrides from the attitude sense or other ext. devices
    processOverrides() {
    	// try processing overrides
    	try {

    		// TODO IMPLEMENT OVERRIDES HERE
    		logger.warn(`Overrides processing hasn't yet been implemented!`);

			this.processedShowIds.overrides = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    		
    	} catch (error) {
    		// else log error
            logger.error(`Error processing external overrides: ${error}`);

            // default array to zeroes, which will make this part of the schedule processing transparent
            this.processedShowIds.overrides = new Array(MAX_ZONES_COUNT).fill(0);
    	}
    }


    // process web overrides
    processWebOverrides() {
    	// try processing web overrides
    	try {
    		// loop through each web override in reverse order
		    this.webOverrides.slice().reverse().forEach(webOverride => {
		    	// if it's active
		        if (webOverride.active) {
			    	// log that we're running this web override
			    	logger.info(`Running active web override "${webOverride.name}"`);

		            // Find the override object associated with this port
		            const override = this.overrides.find(obj => obj.id === webOverride.override_id);

		            // if valid override found
		            if (override) {
			            // next grab the showdata out and parse it as JSON (not sure why it's being flattened into a string?, 
			            // but that's irrelevant to this module)
			            const overrideShowData = JSON.parse(override.showsdata);

			            // now map the showdata from the override to the webOverrides layer
		                this.processedShowIds.webOverrides = this.layerAnOverride(this.processedShowIds.webOverrides, [...overrideShowData]);
		            } else {
		            	// throw an error since this override couldnt be found
		            	throw new Error('Invalid override_id for this web overrride!');
		            }
		        }
		    });

		    // log that we finished (optional)
		    logger.info('Processed web overrides: ' + JSON.stringify(this.processedShowIds.webOverrides));
    	} catch (error) {
    		// else log error
            logger.error(`Error processing web overrides: ${error}`);

            // default array to zeroes, which will make this part of the schedule processing transparent
            this.processedShowIds.webOverrides = new Array(MAX_ZONES_COUNT).fill(0);
    	}
    }


    // layerScheduleToCreateFinal - layers the different schedule components to create a final schedule
    layerScheduleToCreateFinal() {
    	// layer each schedule show IDs map
    	var defaultAndCustom = this.layerAnOverride(this.processedShowIds.defaultWeeklySchedule, this.processedShowIds.customScheduleBlocks);
    	var andOverrides = this.layerAnOverride(defaultAndCustom, this.processedShowIds.overrides);
    	var andWebOverrides = this.layerAnOverride(andOverrides, this.processedShowIds.webOverrides);

    	// assign this to the final processed layer
    	this.processedShowIds.final = andWebOverrides;
    }


    // layerAnOverride - takes a base and layers in the override above it, handling zone/group mis-matches appropriately
	layerAnOverride(base, layer) {
		return base.map((zone, z) => {
			// Check if the layer for this zone is an array (indicating groups)
			if (Array.isArray(layer[z])) {
				// Ensure zone is treated as an array
				const oldZoneData = Array.isArray(zone) ? zone : [zone];
				
				return layer[z].map((group, g) => {
					if (group > 0) {
						// Group is set to override, so use the new layer data for this group
						return group;
					} else {
						// Group is set to no change, so use the old zone data
						return oldZoneData[g] !== undefined ? oldZoneData[g] : oldZoneData[0];
					}
				});
			} else if (layer[z] > 0) {
				// Zone is set to override, so use the new layer data for this zone
				return layer[z];
			} else {
				// Zone is set to base, so use the base data for this zone
				return zone;
			}
		});
	}
}



// ==================== EXPORT ====================
const attitudeScheduler = new AttitudeScheduler();
export default attitudeScheduler;
