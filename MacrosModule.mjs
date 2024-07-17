// MacrosModule.mjs
// macro control module for the Attitude Control 2.A app
// copyright 2024 Drew Shipps, J Squared Systems


// this module creates a single instance of the MacrosModule javascript object,
// which handles the reboot, restart, update, and autoupdate controls for the device



// import modules
import { exec } from 'child_process';
import eventHub from './EventHub.mjs';

import Logger from './Logger.mjs';
const logger = new Logger('MacrosModule');

import configManager from './ConfigManager.mjs';



// variables
const SAMPLE_INTERVAL = 5000;  // interval for how often to process macros (should be 5000ms)
const LAPTOP_MODE = (process.platform == 'darwin');



// Define the MacrosModule class
class MacrosModule {

    // constructor
    constructor() {
        // interval for processing macros
        this.sampleInterval = SAMPLE_INTERVAL;

        // variables
        this.rebootQueuedFromServer = false;
        this.restartQueuedFromServer = false;
        this.updateQueuedFromServer = false;

        this.rebootCommandSuccess = false;
        this.restartCommandSuccess = false;
        this.updateCommandSuccess = false;

        this.rebootCommandResults = '';
        this.restartCommandResults = '';
        this.updateCommandResults = '';

        // emit an event that the macros module is operational
        eventHub.emit('moduleStatus', { 
            name: 'MacrosModule', 
            status: 'operational',
            data: '',
        });
    }


    // initialize the sampling process
    init() {
        setInterval(() => {
            // process macros
            this.processMacros();
        }, this.sampleInterval);
    }


    // process macros
    processMacros() {
        // wrap the system status processing in a try catch, in case there's errors
        try {
            if (configManager.checkLogLevel('interval')) {
                logger.info(`Processing device macros at ${ new Date().toLocaleTimeString() }`);
            }

            // get updated config from configManager
            this.getUpdatedConfig();

            // handle reboot
            this.handleReboot();

            // handle restart
            this.handleRestart();

            // handle update
            this.handleUpdate();

            // emit macros event back to server
            this.emitMacrosEvent();

            // log complete!
            if (configManager.checkLogLevel('detail')) {
                logger.info(`Completed processing device macros!`);
            }

            // emit an event that the MacrosModule finished
            eventHub.emit('moduleStatus', { 
                name: 'MacrosModule', 
                status: 'operational',
                data: 'Completed processing device macros!',
            });
        } catch (error) {
            logger.error(`Error processing device macros: ${error}`);

            // emit an event that we had an error
            eventHub.emit('moduleStatus', { 
                name: 'MacrosModule', 
                status: 'errored',
                data: `Error processing device macros: ${error}`,
            });
        }
    }


    // get updated config from configManager
    getUpdatedConfig() {
        this.rebootQueuedFromServer = configManager.getReboot();
        this.restartQueuedFromServer = configManager.getRestart();
        this.updateQueuedFromServer = configManager.getUpdate();
    }


    // handle reboot command
    handleReboot() {
        // check if a reboot command has been queued from the server
        if (this.rebootQueuedFromServer == true) {

            // check if we're running on laptop or raspi
            if (!LAPTOP_MODE) {

                // Command to schedule a restart in 1 minute
                const command = 'sudo shutdown -h +1';

                // Execute the command
                exec(command, (error, stdout, stderr) => {
                    if (error) {
                        // set the rebootCommandSuccess variable to false, since the reboot failed
                        this.rebootCommandSuccess = false;

                        // set the rebootCommandResults variable to the error text
                        this.rebootCommandResults = error;

                        // log the error
                        logger.error(`Device reboot command failed with error: ${error}`);

                        // emit an event that we had an error
                        eventHub.emit('moduleStatus', { 
                            name: 'MacrosModule', 
                            status: 'errored',
                            data: `Device reboot command failed with error: ${error}`,
                        });
                    } else if (stderr) {
                        // set the rebootCommandSuccess variable to false, since the reboot failed
                        this.rebootCommandSuccess = false;

                        // set the rebootCommandResults variable to the error output from console
                        this.rebootCommandResults = stderr;

                        // log the error
                        logger.error(`Device reboot command failed with stderr: ${stderr}`);

                        // emit an event that we had an error
                        eventHub.emit('moduleStatus', { 
                            name: 'MacrosModule', 
                            status: 'errored',
                            data: `Device reboot command failed with stderr: ${stderr}`,
                        });
                    } else {
                        // otherwise success, so set this.rebootCommandSuccess to true to indicate that the command was successful
                        this.rebootCommandSuccess = true;

                        // set the rebootCommandResults variable to the success output from console
                        this.rebootCommandResults = stdout;

                        // log the success
                        logger.info(`Device reboot activated successfully with stdout: ${stdout}`);

                        // emit a success event
                        eventHub.emit('moduleStatus', { 
                            name: 'MacrosModule', 
                            status: 'operational',
                            data: `Device reboot activated successfully with stdout: ${stdout}`,
                        });
                    }
                });
            } else {
                // log that we're on laptop mode
                logger.warn(`Device reboot activated, but LAPTOP_MODE is true!`);

                // since we're in laptop mode, we'll fake that we completed the reboot successfully
                this.rebootCommandSuccess = true;
                this.rebootCommandResults = '-- activated device reboot on laptop --';
            }
        } else {
            // otherwise, we don't need to reboot, so ensure that rebootCommandResults is reset
            this.rebootCommandSuccess = false;
            this.rebootCommandResults = '';
        }
    }


    // handle restart command
    handleRestart() {
        /*
        // check if we need to restart
        if (this.restart == true) {

            // this one is causing the script to get stuck in a restart loop because as soon as the command is fired, 
            // this javascript can no longer run because it gets killed. so we need a more advanced way to run this command.
            // first, we need to delete config file, then send a success message to server. 
            // then trigger the pm2 restart command and hope it works, because we won't have any time to know if it worked or not
            // before this process is killed. but, we can set a timeout for 15 seconds, 
            // and if the timeout does actually get to run, then it must have failed. 
            // so in that timeout, we can have an error log to send to server to let it know we failed. 



            // Command to restart pm2
            const command = 'pm2 restart all';

            // Execute the command
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    // set the restartResults variable to the error text
                    this.restartResults = error;

                    // log the error
                    logger.error(`Script restart command failed with error: ${error}`);

                    // emit an event that we had an error
                    eventHub.emit('moduleStatus', { 
                        name: 'MacrosModule', 
                        status: 'errored',
                        data: `Script restart command failed with error: ${error}`,
                    });
                } else if (stderr) {
                    // set the restartResults variable to the error output from console
                    this.restartResults = stderr;

                    // log the error
                    logger.error(`Script restart command failed with stderr: ${stderr}`);

                    // emit an event that we had an error
                    eventHub.emit('moduleStatus', { 
                        name: 'MacrosModule', 
                        status: 'errored',
                        data: `Script restart command failed with stderr: ${stderr}`,
                    });
                } else {
                    // otherwise success, so set this.restart to false since it's already been triggered
                    this.restart = false;

                    // set the rebootResults variable to the success output from console
                    this.restartResults = stdout;

                    // log the success
                    logger.info(`Script restart activated successfully with stdout: ${stdout}`);

                    // emit a success event
                    eventHub.emit('moduleStatus', { 
                        name: 'MacrosModule', 
                        status: 'operational',
                        data: `Script restart activated successfully with stdout: ${stdout}`,
                    });
                }
            });
        }

        */
    }


    // handle update command
    handleUpdate() {
        // TODO handle update
    }


    // emit a macros event to the system
    emitMacrosEvent() {
        // check if any macros had been queued from the server
        if (this.rebootQueuedFromServer || this.restartQueuedFromServer || this.updateQueuedFromServer) {

            // log
            if (configManager.checkLogLevel('detail')) {
                logger.info(`At least one macro was queued by the server. Sending macros event with results back to server...`);
            }

            // setup the macros data object
            let macrosData = {
                rebootQueuedFromServer: this.rebootQueuedFromServer,
                rebootCommandSuccess: this.rebootCommandSuccess,
                rebootCommandResults: this.rebootCommandResults,

                restartQueuedFromServer: this.restartQueuedFromServer,
                restartCommandSuccess: this.restartCommandSuccess,
                restartCommandResults: this.restartCommandResults,

                updateQueuedFromServer: this.updateQueuedFromServer,
                updateCommandSuccess: this.updateCommandSuccess,
                updateCommandResults: this.updateCommandResults,
            }

            // emit a network event to let the server know about the macros statuses
            eventHub.emit('macrosStatus', macrosData);
        }
    }
}



// Create an instance of MacrosModule
const macrosModule = new MacrosModule();

// Export the macrosModule instance for use in other modules
export default macrosModule;
