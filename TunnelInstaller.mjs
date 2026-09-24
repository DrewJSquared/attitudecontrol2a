// TunnelInstaller.mjs
// Installs the J2 tunnel enrolment service on this device, once per version of it.
// copyright 2026 J Squared Systems
//
// WHY THE APP DOES THIS, AND NOT update.sh
//
// update.sh changes cannot install anything on the update that delivers them: the updater that
// RUNS is the one already on disk, and it only replaces itself as part of the install. A step
// added to 2.A.21's update.sh would first execute on the update AFTER 2.A.21. The app, by
// contrast, is the new code the moment it boots. Same reasoning, same shape, as the legacy-updater
// bootstrap in MacrosModule (2.A.19): decide from the filesystem, record the attempt BEFORE acting,
// cap attempts, never let any of it touch the lights.
//
// WHAT IT INSTALLS, AND WHY THAT IS SAFE TO SHIP FROM THIS REPO
//
// tunnel/install.sh copies tunnel/attitude-tunnel-enroll.sh and its systemd unit into place and
// enables them. That service is then independent of this app forever after: it runs at boot as
// root, reads id.json itself, asks the server for a single-use key and joins the tunnel.
//
// Running a root script from this repo adds no exposure that does not already exist: `attitude`
// has passwordless sudo, so push access to this repo was already root on the fleet (measured
// 2026-09-03). No secret is in the repo - keys are minted per device by the server.
//
// Decision split from launch, as in MacrosModule, so the decision is tested on every platform.

import { execFile } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import Logger from './Logger.mjs';
const logger = new Logger('TunnelInstaller');

const INSTALL_DELAY = 120000;                    // after the legacy bootstrap (90 s) and the network
const MAX_ATTEMPTS = 3;                          // per version of the tunnel files
const RETRY_MS = 6 * 60 * 60 * 1000;
const INSTALL_TIMEOUT_MS = 60000;
const STATE_FILE = '.attitude-tunnel-install.json';


export class TunnelInstaller {

    // Every path is injectable so the tests can drive the real methods. Production passes nothing.
    constructor(opts = {}) {
        const appDir = opts.appDir ?? process.cwd();
        this.platform = opts.platform ?? process.platform;
        this.srcDir = opts.srcDir ?? path.join(appDir, 'tunnel');
        this.idFile = opts.idFile ?? path.resolve(appDir, '..', 'id.json');
        this.installedScript = opts.installedScript ?? '/usr/local/sbin/attitude-tunnel-enroll.sh';
        this.installedUnit = opts.installedUnit ?? '/etc/systemd/system/attitude-tunnel-enroll.service';
        this.stateFile = opts.stateFile ?? path.join(os.homedir(), STATE_FILE);
        this.now = opts.now ?? (() => Date.now());
        this.execFile = opts.execFile ?? execFile;
    }


    init() {
        // unref'd so it can never be the reason this process stays alive.
        const t = setTimeout(() => this.run(), INSTALL_DELAY);
        if (typeof t?.unref === 'function') t.unref();
    }


    read(file) {
        try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
    }


    // What the unit file on disk SHOULD be - the same substitution install.sh makes with sed.
    renderedUnit() {
        const tpl = this.read(path.join(this.srcDir, 'attitude-tunnel-enroll.service'));
        return tpl === null ? null : tpl.replace('__ID_FILE__', this.idFile);
    }


    // Identifies this version of the tunnel files, so a new version gets a fresh attempt budget.
    payloadHash() {
        const h = crypto.createHash('sha1');
        for (const f of ['attitude-tunnel-enroll.sh', 'attitude-tunnel-enroll.service', 'install.sh']) {
            h.update(this.read(path.join(this.srcDir, f)) ?? `missing:${f}`);
        }
        return h.digest('hex').slice(0, 12);
    }


    readState() {
        try { return JSON.parse(fs.readFileSync(this.stateFile, 'utf8')); }
        catch { return { hash: null, attempts: 0, lastAttempt: 0 }; }
    }


    // Should we run install.sh, and why? Returns { go, reason, warn, hash, attempts }.
    decision() {
        if (this.platform !== 'linux') {
            return { go: false, reason: `not a device (${this.platform})` };
        }

        const script = this.read(path.join(this.srcDir, 'attitude-tunnel-enroll.sh'));
        const unit = this.renderedUnit();
        const installer = path.join(this.srcDir, 'install.sh');
        if (script === null || unit === null || !fs.existsSync(installer)) {
            return { go: false, warn: true, reason: `tunnel files missing from ${this.srcDir}` };
        }

        if (this.read(this.installedScript) === script && this.read(this.installedUnit) === unit) {
            return { go: false, reason: 'tunnel service installed and current' };
        }

        const hash = this.payloadHash();
        const state = this.readState();
        const attempts = state.hash === hash ? (Number(state.attempts) || 0) : 0;
        const since = this.now() - (Number(state.lastAttempt) || 0);

        if (attempts >= MAX_ATTEMPTS) {
            return { go: false, warn: true, hash,
                reason: `gave up installing the tunnel service after ${attempts} attempts (version ${hash})` };
        }
        if (attempts > 0 && since < RETRY_MS) {
            return { go: false, hash, reason: 'a recent install attempt has not aged out yet' };
        }
        return { go: true, hash, attempts, reason: 'tunnel service missing or out of date' };
    }


    run() {
        try {
            const d = this.decision();
            if (!d.go) {
                if (d.warn) logger.warn(d.reason); else logger.info(d.reason);
                return false;
            }

            // Recorded BEFORE the attempt. If it cannot be recorded, it is not made: an unwritable
            // home directory must not become an install attempt on every boot.
            try {
                fs.writeFileSync(this.stateFile, JSON.stringify({
                    hash: d.hash, attempts: d.attempts + 1, lastAttempt: this.now(),
                }));
            } catch (error) {
                logger.error(`Could not record the tunnel install attempt: ${error}. Not installing.`);
                return false;
            }

            logger.info(`Installing the tunnel enrolment service (version ${d.hash}, `
                + `attempt ${d.attempts + 1} of ${MAX_ATTEMPTS}).`);

            this.execFile('sudo', ['-n', '/bin/bash', path.join(this.srcDir, 'install.sh'), this.srcDir, this.idFile],
                { timeout: INSTALL_TIMEOUT_MS },
                (error, stdout, stderr) => {
                    const out = `${stdout ?? ''} ${stderr ?? ''}`.trim().slice(0, 300);
                    if (error) logger.error(`Tunnel service install failed: ${error.message} ${out}`);
                    else logger.info(`Tunnel service install: ${out}`);
                });
            return true;
        } catch (error) {
            // Best effort by definition. A device that cannot install this must still run lights.
            logger.error(`Tunnel installer failed: ${error}`);
            return false;
        }
    }
}


const tunnelInstaller = new TunnelInstaller();
export default tunnelInstaller;
