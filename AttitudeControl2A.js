// AttitudeControl2A.js
// primary JS app for Attitude Control firmware (2nd gen), version 2.A
// copyright 2024 Drew Shipps, J Squared Systems

import { Logger } from './Logger.mjs'; // Assuming it's an ESM module

const logger = new Logger('AttitudeControl2A.js');

logger.log('info', 'Initial test of the logger app!');
logger.log('warn', 'Uh oh - something went wrong.');
logger.log('oopsies', 'Wrong log type here...');
logger.log('error', 'An error occurred!');



logger.log('info', 'Initial test of the logger app!');
logger.log('info', 'Initial test of the logger app!');
logger.log('info', 'Initial test of the logger app!');

setInterval(() => {
	logger.log('info', 'Initial test of the logger app!');
}, 500);