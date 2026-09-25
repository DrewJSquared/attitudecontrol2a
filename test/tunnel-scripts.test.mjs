// The two root scripts that put a device on the tunnel, executed for real against fakes.
//
// attitude-tunnel-enroll.sh and install.sh run as root with nobody watching, on hardware we
// cannot reach until they have worked. So each path is EXECUTED here, with fake `tailscale`,
// `curl` and `systemctl` on PATH that record what they were asked to do:
//
//   already enrolled       exits at once, never asks the server for a key
//   not enrolled           posts id.json's identity, unescapes the URL, runs `up` with the
//                          server's hostname and --accept-dns=false, then `set --ssh`
//   409 name taken         does NOT enrol; backs off to the maximum
//   server down            does NOT enrol; retries with backoff
//   install, first time    copies both files, substitutes the id path, enables and starts
//   install, second time   writes nothing (a current device must not wear its SD card)
//
// Bash scripts, so POSIX only; skipped loudly elsewhere rather than passing vacuously.
//
//   node --test test/tunnel-scripts.test.mjs
//
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const POSIX = process.platform !== 'win32';
const SKIP = POSIX ? false : 'needs a POSIX host: executes bash scripts';
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'tunnel');

function fakes({ enrolled = false, httpCode = 200, body = '' } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tunnel-sh-'));
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    const calls = path.join(dir, 'calls.log');
    const w = (name, text) => { fs.writeFileSync(path.join(bin, name), text); fs.chmodSync(path.join(bin, name), 0o755); };
    w('tailscale', `#!/bin/bash
echo "tailscale $*" >> "${calls}"
case "$1" in
  ip) if [ -f "${dir}/enrolled" ]; then echo 100.64.0.99; else exit 1; fi ;;
  up) touch "${dir}/enrolled" ;;
  version) echo 1.102.4 ;;
esac
exit 0
`);
    w('curl', `#!/bin/bash
echo "curl $*" >> "${calls}"
printf '%s\\n%s' '${body.replace(/'/g, "'\\''")}' '${httpCode}'
`);
    w('sleep', '#!/bin/bash\necho "sleep $*" >> "' + calls + '"\n');
    if (enrolled) fs.writeFileSync(path.join(dir, 'enrolled'), '');
    const idFile = path.join(dir, 'id.json');
    fs.writeFileSync(idFile, '{"device_id":179,"serialnumber":"AC-0020139"}');
    return { dir, bin, calls, idFile, log: path.join(dir, 'enroll.log') };
}

function enroll(f, extraEnv = {}) {
    const r = spawnSync('bash', [path.join(ROOT, 'attitude-tunnel-enroll.sh')], {
        env: { ...process.env, PATH: `${f.bin}:${process.env.PATH}`,
            ATT_ID_FILE: f.idFile, ATT_TUNNEL_LOG: f.log, ATT_TUNNEL_STARTUP_WAIT: '2',
            ATT_TUNNEL_MAX_PASSES: '3', ...extraEnv },
        encoding: 'utf8', timeout: 20000,
    });
    const calls = fs.existsSync(f.calls) ? fs.readFileSync(f.calls, 'utf8') : '';
    const log = fs.existsSync(f.log) ? fs.readFileSync(f.log, 'utf8') : '';
    return { status: r.status, calls, log };
}

const GOOD = '{"hostname":"attitudecontrol-0020139","login_server":"https:\\/\\/net.attitude.lighting","tunnel_key":"hskey-auth-TEST"}';


test('already enrolled: exits 0 at once and never asks for a key', { skip: SKIP }, () => {
    const f = fakes({ enrolled: true });
    const r = enroll(f);
    assert.equal(r.status, 0);
    assert.match(r.log, /already enrolled as 100\.64\.0\.99/);
    assert.doesNotMatch(r.calls, /^curl/m);
    assert.doesNotMatch(r.calls, /tailscale up/);
});

test('not enrolled: posts id.json identity, unescapes the URL, enrols with the server hostname', { skip: SKIP }, () => {
    const f = fakes({ httpCode: 200, body: GOOD });
    const r = enroll(f);
    assert.equal(r.status, 0, r.log);
    assert.match(r.calls, /curl .*\/api\/v1\/device\/tunnel-key/);
    assert.match(r.calls, /-d \{"device_id":179,"serialnumber":"AC-0020139"\}/);
    const up = r.calls.split('\n').find(l => l.startsWith('tailscale up'));
    assert.ok(up, 'tailscale up must run');
    assert.match(up, /--reset/);
    assert.match(up, /--login-server=https:\/\/net\.attitude\.lighting(\s|$)/, 'slashes must be unescaped');
    assert.match(up, /--authkey=hskey-auth-TEST/);
    assert.match(up, /--hostname=attitudecontrol-0020139/);
    assert.match(up, /--accept-dns=false/);
    assert.match(r.calls, /tailscale set --ssh/);
    assert.match(r.log, /ENROLLED {2}attitudecontrol-0020139/);
    assert.doesNotMatch(r.log, /hskey-auth-TEST/, 'the key must never reach the log');
});

test('409 name already taken: does not enrol, backs off to the maximum', { skip: SKIP }, () => {
    const f = fakes({ httpCode: 409, body: '{"error":"Already enrolled."}' });
    const r = enroll(f, { ATT_TUNNEL_BACKOFF_MAX: '3600' });
    assert.equal(r.status, 1, 'test pass limit ends it');
    assert.doesNotMatch(r.calls, /tailscale up/);
    assert.match(r.log, /already enrolled \(409\)/);
    assert.match(r.calls, /sleep 3600/, 'a 409 needs a person - retry slowly');
});

test('server down: does not enrol, retries with growing backoff', { skip: SKIP }, () => {
    const f = fakes({ httpCode: 502, body: '{"error":"x"}' });
    const r = enroll(f, { ATT_TUNNEL_BACKOFF_MIN: '60' });
    assert.doesNotMatch(r.calls, /tailscale up/);
    assert.match(r.calls, /sleep 60/);
    assert.match(r.calls, /sleep 120/, 'backoff must grow');
});

test('no id.json: does not call the server at all', { skip: SKIP }, () => {
    const f = fakes({ body: GOOD });
    fs.rmSync(f.idFile);
    const r = enroll(f);
    assert.doesNotMatch(r.calls, /^curl/m);
    assert.match(r.log, /no usable identity/);
});

test('device_id quoted as a string in id.json still parses', { skip: SKIP }, () => {
    const f = fakes({ body: GOOD });
    fs.writeFileSync(f.idFile, '{"device_id": "179", "serialnumber": "AC-0020139"}');
    const r = enroll(f);
    assert.match(r.calls, /"device_id":179,/);
});


function installRun(dir, sysLog) {
    const bin = path.join(dir, 'bin'); fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'systemctl'), `#!/bin/bash
echo "systemctl $*" >> "${sysLog}"
case "$1" in is-enabled) [ -f "${dir}/enabled" ]; exit $? ;; enable) touch "${dir}/enabled" ;; is-active) exit 3 ;; esac
exit 0
`);
    fs.chmodSync(path.join(bin, 'systemctl'), 0o755);
    return spawnSync('bash', [path.join(ROOT, 'install.sh'), ROOT, '/home/attitude/Documents/attitude/id.json'], {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`,
            ATT_TUNNEL_SBIN: path.join(dir, 'sbin'), ATT_TUNNEL_UNITDIR: path.join(dir, 'unit'),
            ATT_TUNNEL_SYSTEMCTL: path.join(bin, 'systemctl') },
        encoding: 'utf8',
    });
}

const IS_ROOT = POSIX && process.getuid && process.getuid() === 0;

test('install.sh: first run installs, substitutes the id path, enables and starts', { skip: IS_ROOT ? false : 'install.sh must run as root (it chowns to root)' }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tunnel-inst-sh-'));
    const sysLog = path.join(dir, 'sys.log');
    const r = installRun(dir, sysLog);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /INSTALLED changed=1/);
    const unit = fs.readFileSync(path.join(dir, 'unit', 'attitude-tunnel-enroll.service'), 'utf8');
    assert.match(unit, /Environment=ATT_ID_FILE=\/home\/attitude\/Documents\/attitude\/id\.json/);
    assert.equal(fs.statSync(path.join(dir, 'sbin', 'attitude-tunnel-enroll.sh')).mode & 0o777, 0o755);
    const sys = fs.readFileSync(sysLog, 'utf8');
    assert.match(sys, /daemon-reload/);
    assert.match(sys, /enable attitude-tunnel-enroll\.service/);
    assert.match(sys, /start --no-block attitude-tunnel-enroll\.service/);
});

test('install.sh: second run writes nothing and does not reload', { skip: IS_ROOT ? false : 'needs root' }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tunnel-inst-sh-'));
    installRun(dir, path.join(dir, 'first.log'));
    const f = path.join(dir, 'sbin', 'attitude-tunnel-enroll.sh');
    const before = fs.statSync(f).mtimeMs;
    const sysLog = path.join(dir, 'second.log');
    const r = installRun(dir, sysLog);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /INSTALLED changed=0/);
    assert.equal(fs.statSync(f).mtimeMs, before, 'identical file must not be rewritten');
    assert.doesNotMatch(fs.readFileSync(sysLog, 'utf8'), /daemon-reload/);
});

test('install.sh: refuses an id path that is not an id.json', { skip: POSIX ? false : SKIP }, () => {
    const r = spawnSync('bash', [path.join(ROOT, 'install.sh'), ROOT, '/etc/shadow'], { encoding: 'utf8' });
    assert.notEqual(r.status, 0);
});
