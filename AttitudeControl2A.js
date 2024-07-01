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
import moduleStatusTracker from './ModuleStatusTracker.mjs';
import configManager from './ConfigManager.mjs';
import attitudeLED from './AttitudeLED2A.mjs';
import attitudeSACN from './AttitudeSACN2A.mjs';
import attitudeScheduler from './AttitudeScheduler.mjs';
import attitudeFixtureManager from './AttitudeFixtureManager.mjs';

attitudeScheduler.init();
attitudeFixtureManager.init();



// attitudeLED.setColor('D');


attitudeSACN.initialize(8);

// attitudeSACN.set(1,1,255);
// attitudeSACN.set(1,2,0);
// attitudeSACN.set(1,3,255);
// attitudeSACN.set(1,4,255);
// attitudeSACN.set(1,5,0);
// attitudeSACN.set(1,6,255);
// attitudeSACN.set(1,15,255);




// setTimeout(function () {
// 	eventHub.emit('moduleStatus', { 
// 		name: 'Scheduler Fake Module', 
// 		status: 'operational',
// 		data: '',
// 	});
// }, 1000);


// setInterval(function() {

// // add a show to the congiuration
// let newShow = {
// 	id: 404,
// 	name: 'RGB Chase Show on New Engine',
// 	engineVersion: '2A',
// 	type: 'Chase',
//     direction: 'Left to Right',
//     speed: 50,
//     size: 34,
//     splits: 1,
//     transition: 'Both Edges',
//     transitionWidth: 0,
//     bounce: false,
//     colors: [
//         { red: 255, green: 0, blue: 0 },
//         { red: 0, green: 255, blue: 0 },
//         { red: 0, green: 0, blue: 255 },
//     ],
// }
// configManager.config.shows.push(newShow);

// // update a web override to run this show
// configManager.config.webOverrides[0].active = true;
// configManager.config.overrides[2].showsdata = '[0,404,0,0,0,0,0,0,0,0]';
// // console.log(configManager.config.overrides);

// }, 500);







// 		logger.info('Hello world!');

// setTimeout(function () {
// 		logger.info('SENDING SOME DMX VALUES');

// attitudeSACN.set(1,1,255);
// attitudeSACN.set(1,2,0);
// attitudeSACN.set(1,3,255);
// attitudeSACN.set(1,4,255);
// attitudeSACN.set(1,5,0);
// attitudeSACN.set(1,6,255);
// attitudeSACN.set(1,15,255);




// 		logger.info('GETTING SOME SCHEDULE DATA');

// 		var scheduleBlocks = configManager.getScheduleBlocks();

// 		// console.log(configManager.getScheduleBlocks());
// 		// console.log(configManager.getCustomBlocks());
// 		// console.log(configManager.getOverrides());
// 		// console.log(configManager.getWebOverrides());


// }, 1000);








// setTimeout(() => {
// 	console.log('TIMEOUT ACTIVATED!');

// 	logger.info('READING part of the device configuration...');

// 	// console.log(configManager.config.devicemeta.timezone);


// }, 4000);



// setTimeout(() => {
// 	console.log('TIMEOUT ACTIVATED!');

// 	logger.info('Updating part of the device configuration...');

// 	configManager.update({
// 		devicemeta: {
// 			timezone: 'America/Los_Angeles',
// 			port1: 4,
// 			port2: 3,
// 			port3: 2,
// 			port4: 1,
// 		}
// 	})


// }, 2000);






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