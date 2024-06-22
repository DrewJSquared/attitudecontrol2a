// EventHub.mjs
// event hub module for the Attitude Control 2.A app
// copyright 2024 Drew Shipps, J Squared Systems


// this module creates a single instance of the EventEmitter javascript object,
// which coordinates all events across the other modules


// Import the EventEmitter class from the 'events' module
import { EventEmitter } from 'events';

// Define a class EventHub that extends EventEmitter
class EventHub extends EventEmitter {}

// Create a single instance of EventHub
// This instance will be shared across all modules
const eventHub = new EventHub();

// Export the eventHub instance as the default export
// This ensures that all modules that import eventHub.js
// will use the same instance of EventHub
export default eventHub;

/**
 * Usage Example:
 * 
 * // Import the eventHub in any module
 * import eventHub from './eventHub.js';
 * 
 * // Emit an event
 * eventHub.emit('log', { type: 'info', message: 'This is a log message' });
 * 
 * // Listen for an event
 * eventHub.on('log', (log) => {
 *   console.log('Received log:', log);
 * });
 */
