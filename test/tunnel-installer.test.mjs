// TunnelInstaller: installs the tunnel enrolment service once per version, from the app.
//
// Runs unattended on every device at every boot. The wrong answers and what they cost:
//
//   installing when already current   an SD-card write and a systemctl call on every boot
//   not installing when it should     the device never joins the tunnel
//   not capping attempts              a box whose sudo is broken retries on every boot forever
//   launching without recording       an unwritable home becomes an install attempt per boot
//
// The DECISION is pure filesystem reasoning and is tested everywhere. The LAUNCH is tested by
// injecting execFile - it asserts the exact command, so it cannot pass vacuously on Windows.
//
//   node --test test/tunnel-installer.test.mjs
//
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { TunnelInstaller } = await import('../TunnelInstaller.mjs');
const REPO_TUNNEL = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'tunnel');

function sandbox() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tunnel-inst-'));
    const src = path.join(dir, 'tunnel');
    fs.mkdirSync(src);
    for (const f of ['attitude-tunnel-enroll.sh', 'attitude-tunnel-enroll.service', 'install.sh']) {
        fs.copyFileSync(path.join(REPO_TUNNEL, f), path.join(src, f));
    }
    const calls = [];
    const opts = {
        platform: 'linux',
        srcDir: src,
        idFile: path.join(dir, 'id.json'),
        installedScript: path.join(dir, 'sbin', 'attitude-tunnel-enroll.sh'),
        installedUnit: path.join(dir, 'unit', 'attitude-tunnel-enroll.service'),
        stateFile: path.join(dir, 'state.json'),
        now: () => 1_000_000_000_000,
        execFile: (...args) => calls.push(args),
    };
    return { dir, src, opts, calls };
}

function installCurrent(s) {
    const t = new TunnelInstaller(s.opts);
    fs.mkdirSync(path.dirname(s.opts.installedScript), { recursive: true });
    fs.mkdirSync(path.dirname(s.opts.installedUnit), { recursive: true });
    fs.copyFileSync(path.join(s.src, 'attitude-tunnel-enroll.sh'), s.opts.installedScript);
    fs.writeFileSync(s.opts.installedUnit, t.renderedUnit());
}


test('not a device: never installs', () => {
    const s = sandbox();
    const t = new TunnelInstaller({ ...s.opts, platform: 'darwin' });
    assert.equal(t.decision().go, false);
    assert.equal(t.run(), false);
    assert.equal(s.calls.length, 0);
});

test('nothing installed: installs', () => {
    const s = sandbox();
    const d = new TunnelInstaller(s.opts).decision();
    assert.equal(d.go, true, d.reason);
});

test('installed and current: does nothing, writes nothing', () => {
    const s = sandbox();
    installCurrent(s);
    const t = new TunnelInstaller(s.opts);
    const d = t.decision();
    assert.equal(d.go, false);
    assert.match(d.reason, /installed and current/);
    assert.equal(t.run(), false);
    assert.equal(s.calls.length, 0);
    assert.equal(fs.existsSync(s.opts.stateFile), false, 'a current device must not write state');
});

test('the rendered unit carries the id.json path, exactly as install.sh sed writes it', () => {
    const s = sandbox();
    const unit = new TunnelInstaller(s.opts).renderedUnit();
    assert.match(unit, new RegExp(`Environment=ATT_ID_FILE=${s.opts.idFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`));
    assert.doesNotMatch(unit, /__ID_FILE__/);
});

test('installed script differs (new version shipped): installs', () => {
    const s = sandbox();
    installCurrent(s);
    fs.appendFileSync(s.opts.installedScript, '\n# old version\n');
    assert.equal(new TunnelInstaller(s.opts).decision().go, true);
});

test('unit written for a different id.json path: reinstalls', () => {
    const s = sandbox();
    installCurrent(s);
    const t = new TunnelInstaller({ ...s.opts, idFile: '/elsewhere/id.json' });
    assert.equal(t.decision().go, true);
});

test('attempt cap: three failures of the same version, then stop', () => {
    const s = sandbox();
    const t = new TunnelInstaller(s.opts);
    fs.writeFileSync(s.opts.stateFile, JSON.stringify({ hash: t.payloadHash(), attempts: 3, lastAttempt: 0 }));
    const d = t.decision();
    assert.equal(d.go, false);
    assert.equal(d.warn, true);
    assert.match(d.reason, /gave up/);
});

test('a NEW version resets the attempt budget', () => {
    const s = sandbox();
    const t = new TunnelInstaller(s.opts);
    fs.writeFileSync(s.opts.stateFile, JSON.stringify({ hash: 'someoldhash0', attempts: 3, lastAttempt: 0 }));
    assert.equal(t.decision().go, true);
});

test('a recent attempt waits out the retry window', () => {
    const s = sandbox();
    const t = new TunnelInstaller(s.opts);
    fs.writeFileSync(s.opts.stateFile, JSON.stringify({ hash: t.payloadHash(), attempts: 1, lastAttempt: 1_000_000_000_000 - 60_000 }));
    const d = t.decision();
    assert.equal(d.go, false);
    assert.match(d.reason, /not aged out/);
});

test('launch: attempt recorded BEFORE, then exactly sudo -n bash install.sh <src> <id.json>', () => {
    const s = sandbox();
    let stateAtExec = null;
    const t = new TunnelInstaller({ ...s.opts, execFile: (...args) => {
        stateAtExec = JSON.parse(fs.readFileSync(s.opts.stateFile, 'utf8'));
        s.calls.push(args);
    } });
    assert.equal(t.run(), true);
    assert.equal(s.calls.length, 1);
    const [cmd, argv, options] = s.calls[0];
    assert.equal(cmd, 'sudo');
    assert.deepEqual(argv, ['-n', '/bin/bash', path.join(s.src, 'install.sh'), s.src, s.opts.idFile]);
    assert.ok(options.timeout > 0, 'must not wait forever on sudo');
    assert.equal(stateAtExec.attempts, 1, 'the attempt must be on disk before the command runs');
});

test('cannot record the attempt: does not launch', () => {
    const s = sandbox();
    const t = new TunnelInstaller({ ...s.opts, stateFile: path.join(s.dir, 'no', 'such', 'dir', 'state.json') });
    assert.equal(t.run(), false);
    assert.equal(s.calls.length, 0);
});

test('tunnel files missing from the build: warns, does not launch', () => {
    const s = sandbox();
    fs.rmSync(path.join(s.src, 'install.sh'));
    const t = new TunnelInstaller(s.opts);
    const d = t.decision();
    assert.equal(d.go, false);
    assert.equal(d.warn, true);
    assert.equal(t.run(), false);
    assert.equal(s.calls.length, 0);
});

test('an exec that throws synchronously never escapes run()', () => {
    const s = sandbox();
    const t = new TunnelInstaller({ ...s.opts, execFile: () => { throw new Error('boom'); } });
    assert.equal(t.run(), false);
});
