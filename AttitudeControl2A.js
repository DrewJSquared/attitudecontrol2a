// AttitudeControl2A.js
// primary JS app for Attitude Control firmware (2nd gen), version 2.A
// copyright 2024 Drew Shipps, J Squared Systems




// ==================== IMPORT ====================
//
// TWO KINDS OF MODULE, LOADED TWO WAYS. (2.A.26)
//
// CORE modules are imported statically below. They are the path the box needs to stay reachable:
// identity, config, the network connection to attitude.lighting, the status report, and the
// macros module that runs update.sh. If one of these cannot load, nothing can help from here.
//
// EVERY OTHER module is loaded with import(), one at a time, each inside its own try/catch.
//
// Why: in October/November 2026 at least fourteen boxes shipped dead. A power cut within a minute
// of a firmware update left every file that update had ADDED as a 0-byte file on the card. The
// first of them, RenderWatchdog.mjs, was a static import here - and one bad static import fails
// the whole module graph before a single line runs. No network, no LED, no tunnel: the process
// stayed up doing nothing, pm2 reported it online, and the only way back was a site visit or
// shipping the box home (AC-0020153, claude/FINDINGS-2026-11-18-blue-light-boxes-zero-byte-new-files.md).
//
// Loaded this way, a broken optional module costs only itself. The box still connects, reports
// exactly which module failed and why, and can take a repairing update from the server. If the
// fixture manager or scheduler is the one that failed, it is reported 'errored', which puts the
// output into white backup - the same thing that happens when either of them fails at runtime.
import Logger from './Logger.mjs';
const logger = new Logger('AttitudeControl2A');

import eventHub from './EventHub.mjs';
import idManager from './IdManager.mjs';
import configManager from './ConfigManager.mjs';
import networkModule from './NetworkModule.mjs';
import statusTracker from './StatusTracker.mjs';
import macrosModule from './MacrosModule.mjs';

import { execFile } from 'child_process';


// Optional modules. Order matters only as far as it always has: load in the old static order so
// module-level side effects happen in the same sequence they always did.
const OPTIONAL_MODULES = [
	['AttitudeScheduler', './AttitudeScheduler.mjs'],
	['AttitudeFixtureManager', './AttitudeFixtureManager.mjs'],
	['AttitudeSACN', './AttitudeSACN2A.mjs'],
	['AttitudeLED', './AttitudeLED2A.mjs'],
	['AttitudeSenseManager', './AttitudeSenseManager.mjs'],
	['AttitudeEmitManager', './AttitudeEmitManager.mjs'],
	['ModuleStatusTracker', './ModuleStatusTracker.mjs'],
	['RenderWatchdog', './RenderWatchdog.mjs'],
	['UDPManager', './UDPManager.mjs'],
	['TunnelInstaller', './TunnelInstaller.mjs'],
];

const loaded = {};
const loadFailures = [];

for (const [name, file] of OPTIONAL_MODULES) {
	try {
		const mod = await import(file);

		// An EMPTY file is a valid module with no exports - import() resolves, and the failure
		// would only surface later as "cannot read properties of undefined". Catch it here, where
		// the message can say what it actually is.
		if (!mod || mod.default === undefined || mod.default === null) {
			throw new Error('module has no default export - the file is empty or truncated on the card');
		}

		loaded[name] = mod.default;
	} catch (err) {
		loaded[name] = null;
		loadFailures.push({ name, file, message: err && err.message ? err.message : String(err) });
	}
}

const attitudeScheduler = loaded.AttitudeScheduler;
const attitudeFixtureManager = loaded.AttitudeFixtureManager;
const attitudeSACN = loaded.AttitudeSACN;
const attitudeLED = loaded.AttitudeLED;
const attitudeSenseManager = loaded.AttitudeSenseManager;
const attitudeEmitManager = loaded.AttitudeEmitManager;
const moduleStatusTracker = loaded.ModuleStatusTracker;
const renderWatchdog = loaded.RenderWatchdog;
const udpManager = loaded.UDPManager;
const tunnelInstaller = loaded.TunnelInstaller;


// Run one module's init without letting it take the rest of the sequence down with it.
function safeInit(name, fn) {
	try {
		fn();
	} catch (err) {
		loadFailures.push({ name, file: '(init)', message: err && err.message ? err.message : String(err) });
		logger.error(`${name} failed to initialize: ${err && err.message ? err.message : err}`);
	}
}



// ==================== INITIALIZATION SEQUENCE ====================

// initial logs
logger.info('Attitude Control Device Firmware (2nd gen) v2.A');
logger.info('Copyright 2024 Drew Shipps, J Squared Systems');
logger.info('System initializing at time ' + new Date());


// Flush everything to the card, once, at every start.
//
// update.sh restarts this app seconds after it installs new files. Before 2.A.26 nothing forced
// those files onto the card, and Linux holds newly written data in memory for up to ~35 s - so a
// box unplugged inside that window came back with every ADDED file at 0 bytes. The updater now
// syncs itself, but a box updating FROM an older build runs that build's updater, which does not.
// This closes most of that window from the new side: the first thing the new build does is make
// sure the files it was just installed from are actually on the card. Costs nothing on a box
// with nothing to write.
try {
	execFile('sync', (err) => {
		if (err) logger.error(`startup sync failed: ${err.message}`);
	});
} catch (err) {
	logger.error(`startup sync could not run: ${err.message}`);
}


// initialize sACN (to ensure that we go to white DMX on fixtures)
setTimeout(() => {
	if (attitudeSACN) safeInit('AttitudeSACN', () => attitudeSACN.initialize(16)); // init with 16 universes
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
	if (attitudeLED) safeInit('AttitudeLED', () => attitudeLED.init());
}, 40);


// initialize status trackers
setTimeout(() => {
	statusTracker.init();
	if (moduleStatusTracker) safeInit('ModuleStatusTracker', () => moduleStatusTracker.init());
}, 50);


// initialize schedule and fixtures
setTimeout(() => {
	if (attitudeScheduler) safeInit('AttitudeScheduler', () => attitudeScheduler.init());
	if (attitudeFixtureManager) safeInit('AttitudeFixtureManager', () => attitudeFixtureManager.init());

	// Frozen-output watchdog. Started alongside the fixture manager because it watches that
	// module's frames, and given its own timer rather than being called from processFixtures -
	// a status emitted from inside that function competes with the degraded/operational pair it
	// already emits per frame, and ModuleStatusTracker's hold window decides which survives.
	//
	// Dependencies are passed in rather than imported by the watchdog, so its tests drive the
	// real tick() with a fake clock and a fake event hub instead of restating it.
	//
	// It watches the sACN output, so without sACN there is nothing for it to watch.
	if (renderWatchdog && attitudeSACN) {
		safeInit('RenderWatchdog', () => renderWatchdog.init({ eventHub, attitudeSACN, logger }));
	}
}, 60);


// initialize macros module
setTimeout(() => {
	macrosModule.init();
}, 70);


// initialize UDP Manager
setTimeout(() => {
	if (udpManager) safeInit('UDPManager', () => udpManager.init());
}, 80);


// install the J2 tunnel enrolment service (once per version; see TunnelInstaller.mjs).
// It waits two minutes itself and never touches the lights.
setTimeout(() => {
	if (tunnelInstaller) safeInit('TunnelInstaller', () => tunnelInstaller.init());
}, 90);


// initialize sense and emit modules
setTimeout(() => {
	if (attitudeSenseManager) safeInit('AttitudeSenseManager', () => attitudeSenseManager.init());
	if (attitudeEmitManager) safeInit('AttitudeEmitManager', () => attitudeEmitManager.init());
}, 90);


// initialization sequence complete!
setTimeout(() => {
	// Report any module that could not load or start. Done here, after the network module and the
	// status tracker are listening, because anything logged before networkModule.init() never
	// leaves the box. oneTimeEvent keeps the status at 'errored' instead of decaying to
	// 'unresponsive' after 35 s, so it stays visible on the fleet page - and an errored fixture
	// manager or scheduler keeps the output in white backup.
	for (const failure of loadFailures) {
		logger.error(`MODULE FAILED TO LOAD: ${failure.name} (${failure.file}): ${failure.message}`);
		eventHub.emit('moduleStatus', {
			name: failure.name,
			status: 'errored',
			data: `Failed to load: ${failure.message}`,
			oneTimeEvent: true,
		});
	}

	if (loadFailures.length > 0) {
		logger.error(`Device initialization finished with ${loadFailures.length} module(s) failed - still connecting so the box can be repaired remotely`);
	} else {
		logger.info('Device initialization sequence complete!');
	}
}, 100);
