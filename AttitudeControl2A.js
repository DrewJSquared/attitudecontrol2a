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
const logger = new Logger('AttitudeControl2A.js');

import eventHub from './EventHub.mjs';
import networkModule from './NetworkModule.mjs';



import statusTracker from './StatusTracker.mjs';


// logger.log('info', 'Initial test of the logger app!');
// logger.log('warn', 'Uh oh - something went wrong.');
// logger.log('oopsies', 'Wrong log type here...');
// logger.log('error', 'An error occurred!');



// logger.log('info', 'Initial test of the logger app!');
// logger.log('info', 'Initial test of the logger app!');
// logger.log('info', 'Initial test of the logger app!');


setTimeout(() => {
	console.log('TIMEOUT ACTIVATED!');


	logger.info('Info log activated from timeout in main app.');

	logger.error('Uh oh, an error occured! Something went wrong.');



}, 500);



// eventHub.on('log', (log) => {
//   console.log('Received log from eventHub:', log);
// });