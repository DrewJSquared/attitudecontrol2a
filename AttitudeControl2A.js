// AttitudeControl2A.js
// primary JS app for Attitude Control firmware (2nd gen), version 2.A
// copyright 2024 Drew Shipps, J Squared Systems



// ==================== INITIALIZE ====================
// import npmlog from 'npmlog';
// npmlog.info('INIT', 'Attitude Control Device Firmware (2nd gen) v2.A');
// npmlog.info('INIT', 'Copyright 2024 Drew Shipps, J Squared Systems');
// npmlog.info('INIT', 'System initializing at time ' + new Date());



// ==================== IMPORT ====================
import Logger from './Logger.mjs';
const logger = new Logger('AttitudeControl2A');

import eventHub from './EventHub.mjs';
import networkModule from './NetworkModule.mjs';
import statusTracker from './StatusTracker.mjs';
import configManager from './ConfigManager.mjs';
import attitudeLED from './AttitudeLED2A.mjs';



attitudeLED.setColor('A');







setTimeout(() => {
	console.log('TIMEOUT ACTIVATED!');

	logger.info('READING part of the device configuration...');

	console.log(configManager.config.devicemeta.timezone);


}, 4000);



setTimeout(() => {
	console.log('TIMEOUT ACTIVATED!');

	logger.info('Updating part of the device configuration...');

	configManager.update({
		devicemeta: {
			timezone: 'America/Los_Angeles',
			port1: 4,
			port2: 3,
			port3: 2,
			port4: 1,
		}
	})


}, 2000);






// logger.log('info', 'Initial test of the logger app!');
// logger.log('warn', 'Uh oh - something went wrong.');
// logger.log('oopsies', 'Wrong log type here...');
// logger.log('error', 'An error occurred!');



// logger.log('info', 'Initial test of the logger app!');
// logger.log('info', 'Initial test of the logger app!');
// logger.log('info', 'Initial test of the logger app!');


// setTimeout(() => {
// 	console.log('TIMEOUT ACTIVATED!');


// 	logger.info('Info log activated from timeout in main app.');

// 	logger.error('Uh oh, an error occured! Something went wrong.');



// }, 500);



// eventHub.on('log', (log) => {
//   console.log('Received log from eventHub:', log);
// });