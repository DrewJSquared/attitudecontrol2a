// AttitudeControl2A.js
// primary JS app for Attitude Control firmware (2nd gen), version 2.A
// copyright 2024 Drew Shipps, J Squared Systems




// ==================== IMPORT ====================
import Logger from './Logger.mjs';
const logger = new Logger('AttitudeControl2A');

import eventHub from './EventHub.mjs';

import attitudeScheduler from './AttitudeScheduler.mjs';
import attitudeFixtureManager from './AttitudeFixtureManager.mjs';
import attitudeSACN from './AttitudeSACN2A.mjs';
import attitudeLED from './AttitudeLED2A.mjs';

import idManager from './IdManager.mjs';
import configManager from './ConfigManager.mjs';
import networkModule from './NetworkModule.mjs';
import statusTracker from './StatusTracker.mjs';
import moduleStatusTracker from './ModuleStatusTracker.mjs';
import macrosModule from './MacrosModule.mjs';



// ==================== INITIALIZATION SEQUENCE ====================

// initial logs
logger.info('Attitude Control Device Firmware (2nd gen) v2.A');
logger.info('Copyright 2024 Drew Shipps, J Squared Systems');
logger.info('System initializing at time ' + new Date());

console.log('HELLO WORLD UPDATE!')

// initialize sACN (to ensure that we go to white DMX on fixtures)
setTimeout(() => {
	attitudeSACN.initialize(8);
}, 10);


// initialize config manager and id manager
setTimeout(() => {
	idManager.init();
	configManager.init();
}, 20);


// initialize network module so it can begin listening for messages
setTimeout(() => {
	networkModule.init();
}, 30);


// initialize LED panel
setTimeout(() => {
	attitudeLED.init();
}, 40);


// initialize status trackers
setTimeout(() => {
	statusTracker.init();
	moduleStatusTracker.init();
}, 50);


// initialize schedule and fixtures
setTimeout(() => {
	attitudeScheduler.init();
	attitudeFixtureManager.init();
}, 60);

// initialize macros module
setTimeout(() => {
	macrosModule.init();
}, 70);

// initialization sequence complete!
setTimeout(() => {
	logger.info('Device initialization sequence complete!');
}, 80);


