// MacrosModule.mjs
// macro control module for the Attitude Control 2.A app
// copyright 2024 Drew Shipps, J Squared Systems


// this module creates a single instance of the MacrosModule javascript object,
// which handles the reboot, restart, update, and autoupdate controls for the device



// import modules
import { exec } from 'child_process';
import fs from 'fs';
import eventHub from './EventHub.mjs';

import Logger from './Logger.mjs';
const logger = new Logger('MacrosModule');

import configManager from './ConfigManager.mjs';



// variables
const SAMPLE_INTERVAL = 15000;  // interval for how often to process macros (should be 15000ms)
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
                    } else {
                        // otherwise success, so set this.rebootCommandSuccess to true to indicate that the command was successful
                        this.rebootCommandSuccess = true;

                        // set the rebootCommandResults variable to the success output from console
                        if (stdout.length > 0) {
                            this.rebootCommandResults = stdout;
                        } else {
                            this.rebootCommandResults = stderr;
                        }

                        // log the success
                        logger.info(`Device reboot activated successfully with message: ${this.rebootCommandResults}`);

                        // emit a success event
                        eventHub.emit('moduleStatus', { 
                            name: 'MacrosModule', 
                            status: 'operational',
                            data: `Device reboot activated successfully with message: ${this.rebootCommandResults}`,
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
        // check if a restart command has been queued from the server
        if (this.restartQueuedFromServer == true) {

            // get the file path for the config.json file
            let configFilePath = configManager.getConfigFilePath();

            // try to remove it and restart pm2
            try {
                // syncronously remove the 
                fs.unlinkSync(configFilePath);

                // restart pm2 asyncronosly after 30 seconds.
                // this is intended to give the network module a second to let the server know
                // that the delete config part worked
                this.restartPm2Async();

                // set this.restartCommandSuccess to true to indicate that the command was successful
                this.restartCommandSuccess = true;

                // set the restartCommandResults variable to a success string
                this.restartCommandResults = 'config.json successfully deleted and pm2 restart queued for 30 seconds from now!';

                // log the success
                logger.info(`config.json successfully deleted and pm2 restart queued for 30 seconds from now!`);

                // emit a success event
                eventHub.emit('moduleStatus', { 
                    name: 'MacrosModule', 
                    status: 'operational',
                    data: `config.json successfully deleted and pm2 restart queued for 30 seconds from now!`,
                });
            } catch (error) {
                // else catch any errors with deleting the file or restarting pm2

                // set the restartCommandSuccess variable to false, since the restart failed
                this.restartCommandSuccess = false;

                // set the restartCommandResults variable to the error text
                if (error.code === 'ENOENT') {
                    this.restartCommandResults = `File not found: ${configFilePath}`;
                } else {
                    this.restartCommandResults = `An error occurred while deleting ${configFilePath}: ${error}`;
                }

                // log the error
                logger.error(this.restartCommandResults);

                // emit an event that we had an error
                eventHub.emit('moduleStatus', { 
                    name: 'MacrosModule', 
                    status: 'errored',
                    data: this.restartCommandResults,
                });
            }
        } else {
            // otherwise, we don't need to restart, so ensure that restartCommandResults is reset
            this.restartCommandSuccess = false;
            this.restartCommandResults = '';
        }
    }


    // handle update command
    handleUpdate() {
        // TODO handle update
    }



    async restartPm2Async() {
        // Command to async restart PM2 after 30 sec
        const command = 'sleep 30; pm2 restart all';

        // Execute the command
        exec(command, (error, stdout, stderr) => {
            if (error) {
                // log the error
                logger.error(`PM2 restart command failed with error: ${error}`);
            } else {
                // otherwise success

                // the problem here is that this code will never execute,
                // because if the pm2 restart all command is successful
                // then this code will be killed and restarted anyway

                // we'll go ahead and log the success, but this message will probably never be seen by anyone
                logger.info(`PM2 restart command success!`);
            }
        });
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
