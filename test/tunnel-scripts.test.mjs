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
//   tunnel server unreachable  2.A.22: no key requested; curl's reason reported to the website
//   tailscale up fails     2.A.22: bounded by --timeout, output reported, a fresh key next pass
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

function fakes({ enrolled = false, httpCode = 200, body = '', probeExit = 0, probeMsg = '', upFail = false,
                 journal = 'control: controlclient paused (waiting for network)', dnsIp = '134.209.67.146', hosts = '127.0.0.1\tlocalhost\n' } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tunnel-sh-'));
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    const calls = path.join(dir, 'calls.log');
    const w = (name, text) => { fs.writeFileSync(path.join(bin, name), text); fs.chmodSync(path.join(bin, name), 0o755); };
    w('tailscale', `#!/bin/bash
echo "tailscale $*" >> "${calls}"
case "$1" in
  ip) if [ -f "${dir}/enrolled" ]; then echo 100.64.0.99; else exit 1; fi ;;
  up) ${upFail ? 'echo "timeout waiting for Tailscale service to enter a Running state; check health with \"tailscale status\""; exit 1' : `touch "${dir}/enrolled"`} ;;
  version) echo 1.102.4 ;;
  status) [ "$2" = --json ] && { echo '{"Version": "1.102.4", "BackendState": "NeedsLogin"}'; exit 0; }; ${upFail ? `printf '# Health check:\\n#     - not connected to control: dial tcp: lookup net.attitude.lighting: no such host\\n\\n100.64.0.99 x\\n'` : 'true'} ;;
esac
exit 0
`);
    w('curl', `#!/bin/bash
echo "curl $*" >> "${calls}"
case "$*" in
  */health*) [ "${probeExit}" = 0 ] || { echo "curl: (${probeExit}) ${probeMsg}" >&2; exit ${probeExit}; }; exit 0 ;;
  *tunnel-report*) exit 0 ;;
esac
printf '%s\\n%s' '${body.replace(/'/g, "'\\''")}' '${httpCode}'
`);
    w('sleep', '#!/bin/bash\necho "sleep $*" >> "' + calls + '"\n');
    w('systemctl', '#!/bin/bash\necho "systemctl $*" >> "' + calls + '"\n');
    w('journalctl', `#!/bin/bash\necho '${journal}'\necho "magicsock: unrelated chatter"\n`);
    const hostsFile = path.join(dir, 'hosts');
    fs.writeFileSync(hostsFile, hosts);
    // glibc stand-in: /etc/hosts first (as nsswitch 'files dns'), then "DNS" = dnsIp, or nothing.
    w('getent', `#!/bin/bash
echo "getent $*" >> "${calls}"
h=$(grep -w "$2" "${hostsFile}" | awk '{print $1}' | head -1)
if [ -n "$h" ]; then echo "$h STREAM $2"; exit 0; fi
[ -n "${dnsIp}" ] && { echo "${dnsIp} STREAM $2"; exit 0; }
exit 2
`);
    if (enrolled) fs.writeFileSync(path.join(dir, 'enrolled'), '');
    const idFile = path.join(dir, 'id.json');
    fs.writeFileSync(idFile, '{"device_id":179,"serialnumber":"AC-0020139"}');
    return { dir, bin, calls, idFile, hostsFile, log: path.join(dir, 'enroll.log') };
}

function enroll(f, extraEnv = {}) {
    const r = spawnSync('bash', [path.join(ROOT, 'attitude-tunnel-enroll.sh')], {
        env: { ...process.env, PATH: `${f.bin}:${process.env.PATH}`,
            ATT_ID_FILE: f.idFile, ATT_TUNNEL_LOG: f.log, ATT_TUNNEL_STARTUP_WAIT: '2',
            ATT_TUNNEL_MAX_PASSES: '3', ATT_TUNNEL_HOSTS: f.hostsFile, ...extraEnv },
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


// ---- 2.A.22: reachability probe, bounded up, reports ----

const reports = calls => calls.split('\n').filter(l => l.includes('tunnel-report'))
    .map(l => JSON.parse(l.slice(l.indexOf('-d ') + 3)));

test('2.A.22: tunnel server does not resolve - no key requested, the reason is reported', { skip: SKIP }, () => {
    const f = fakes({ body: GOOD, probeExit: 6, probeMsg: 'Could not resolve host: net.attitude.lighting' });
    const r = enroll(f);
    assert.doesNotMatch(r.calls, /tunnel-key/, 'an unreachable tunnel server must not cost a key');
    assert.doesNotMatch(r.calls, /tailscale up/);
    const rep = reports(r.calls);
    assert.ok(rep.length >= 1, 'must report');
    assert.equal(rep[0].stage, 'preflight');
    assert.equal(rep[0].code, 6);
    assert.equal(rep[0].device_id, 179);
    assert.equal(rep[0].serialnumber, 'AC-0020139');
    assert.match(rep[0].detail, /curl=6 curl: \(6\) Could not resolve host/);
    assert.match(rep[0].detail, /resolves=/);
    assert.match(rep[0].detail, /nameservers=/);
    assert.match(r.log, /cannot reach https:\/\/net\.attitude\.lighting/);
    assert.match(r.calls, /sleep 60/, 'still backs off');
});

test('2.A.22: handshake reset (hostname filter) is reported as curl 35', { skip: SKIP }, () => {
    const f = fakes({ body: GOOD, probeExit: 35, probeMsg: 'OpenSSL SSL_connect: Connection reset by peer' });
    const rep = reports(enroll(f).calls);
    assert.equal(rep[0].code, 35);
    assert.match(rep[0].detail, /Connection reset by peer/);
});

test('2.A.22: tailscale up is bounded, and a failure is reported without the key', { skip: SKIP }, () => {
    const f = fakes({ body: GOOD, upFail: true });
    const r = enroll(f);
    const ups = r.calls.split('\n').filter(l => l.startsWith('tailscale up'));
    assert.ok(ups.length >= 2, 'a failed up retries with a fresh key');
    assert.match(ups[0], /--timeout=120s/);
    assert.equal(r.calls.split('\n').filter(l => /tunnel-key/.test(l)).length, ups.length, 'one key per attempt');
    const rep = reports(r.calls).filter(x => x.stage === 'up');
    assert.ok(rep.length >= 1);
    assert.equal(rep[0].code, 1);
    assert.match(rep[0].detail, /timeout waiting for Tailscale/);
    assert.match(rep[0].detail, /probe: reachable/);
    assert.match(rep[0].detail, /^health: not connected to control: dial tcp: lookup net\.attitude\.lighting: no such host/,
        "tailscaled's own reason comes first, so the 400-character cut never drops it");
    assert.match(r.log, /tailscale health: not connected to control/);
    assert.doesNotMatch(JSON.stringify(rep), /hskey/);
    assert.match(r.log, /tailscale up failed \(exit 1\)/);
});

test('2.A.22: a successful enrolment is reported, and the report is valid JSON', { skip: SKIP }, () => {
    const f = fakes({ body: GOOD });
    const r = enroll(f);
    const rep = reports(r.calls);
    assert.equal(rep.length, 1);
    assert.equal(rep[0].stage, 'enrolled');
    assert.match(rep[0].detail, /attitudecontrol-0020139 100\.64\.0\.99/);
});

test('2.A.22: already enrolled - no probe, no report, nothing sent anywhere', { skip: SKIP }, () => {
    const f = fakes({ enrolled: true });
    assert.doesNotMatch(enroll(f).calls, /^curl/m);
});


// ---- 2.A.23: fresh tailscaled per attempt, and tailscaled's own facts in the report ----

test('2.A.23: restarts tailscaled before every enrolment attempt, after the key, before up', { skip: SKIP }, () => {
    const f = fakes({ body: GOOD, upFail: true });
    const lines = enroll(f).calls.split('\n');
    const restarts = lines.map((l, i) => l === 'systemctl restart tailscaled' ? i : -1).filter(i => i >= 0);
    const ups = lines.map((l, i) => l.startsWith('tailscale up') ? i : -1).filter(i => i >= 0);
    assert.ok(ups.length >= 2);
    assert.equal(restarts.length, ups.length, 'one restart per attempt');
    const firstKey = lines.findIndex(l => /tunnel-key/.test(l));
    assert.ok(firstKey < restarts[0] && restarts[0] < ups[0], 'key, then restart, then up');
});

test('2.A.23: an enrolled box never restarts tailscaled', { skip: SKIP }, () => {
    const f = fakes({ enrolled: true });
    assert.doesNotMatch(enroll(f).calls, /systemctl restart/);
});

test('2.A.23: a failed up reports tailscaled state, version, disk and its own log lines', { skip: SKIP }, () => {
    const f = fakes({ body: GOOD, upFail: true });
    const r = enroll(f);
    const rep = reports(r.calls).filter(x => x.stage === 'up')[0];
    assert.match(rep.detail, /state=NeedsLogin ver=1\.102\.4 disk=\d+%/);
    assert.match(rep.detail, /log: control: controlclient paused \(waiting for network\)/);
    assert.doesNotMatch(rep.detail, /magicsock/, 'only lines about control, the network or errors');
    assert.ok(rep.detail.length <= 400);
    assert.match(r.log, /tailscaled restarted, state NeedsLogin/);
});


// ---- 2.A.24: /etc/hosts pin when tailscaled cannot use the site's DNS ----

const RESOLVE_FAIL = 'Received error: fetch control key: Get "https://net.attitude.lighting/key?v=142": failed to resolve "net.attitude.lighting": no DNS fallback candidates remain';
const PIN_RE = /^134\.209\.67\.146\tnet\.attitude\.lighting\t# attitude-tunnel-pin/m;

test('2.A.24: tailscaled cannot resolve the tunnel server - pins the glibc address, keeps the rest of hosts', { skip: SKIP }, () => {
    const f = fakes({ body: GOOD, upFail: true, journal: RESOLVE_FAIL });
    const r = enroll(f);
    const hosts = fs.readFileSync(f.hostsFile, 'utf8');
    assert.match(hosts, /^127\.0\.0\.1\tlocalhost$/m, 'existing lines untouched');
    assert.match(hosts, PIN_RE);
    assert.equal(hosts.match(/attitude-tunnel-pin/g).length, 1, 'exactly one pin, however many failures');
    assert.match(r.log, /pinned net\.attitude\.lighting to 134\.209\.67\.146/);
    const later = reports(r.calls).filter(x => x.stage === 'up').slice(1);
    assert.ok(later.length >= 1 && later.every(x => /^health: .*pin=134\.209\.67\.146/.test(x.detail) || /pin=134\.209\.67\.146/.test(x.detail)));
});

test('2.A.24: any other up failure never touches hosts', { skip: SKIP }, () => {
    const f = fakes({ body: GOOD, upFail: true });
    enroll(f);
    assert.equal(fs.readFileSync(f.hostsFile, 'utf8'), '127.0.0.1\tlocalhost\n');
});

test('2.A.24: glibc cannot resolve it either - no pin', { skip: SKIP }, () => {
    const f = fakes({ body: GOOD, upFail: true, journal: RESOLVE_FAIL, dnsIp: '' });
    const r = enroll(f);
    assert.doesNotMatch(fs.readFileSync(f.hostsFile, 'utf8'), /attitude-tunnel-pin/);
    assert.match(r.log, /cannot pin .* glibc does not resolve it either/);
});

test('2.A.24: every run follows the DNS - a moved droplet updates the pin, even on an enrolled box', { skip: SKIP }, () => {
    const f = fakes({ enrolled: true, hosts: '127.0.0.1\tlocalhost\n1.2.3.4\tnet.attitude.lighting\t# attitude-tunnel-pin (x)\n' });
    const r = enroll(f);
    const hosts = fs.readFileSync(f.hostsFile, 'utf8');
    assert.match(hosts, PIN_RE, 'the lookup must go to DNS with the old pin out of the way');
    assert.doesNotMatch(hosts, /1\.2\.3\.4/);
    assert.match(hosts, /^127\.0\.0\.1\tlocalhost$/m);
    assert.match(r.log, /moved 1\.2\.3\.4 -> 134\.209\.67\.146/);
});

test('2.A.24: DNS down at boot - the old pin is kept, not dropped', { skip: SKIP }, () => {
    const f = fakes({ enrolled: true, dnsIp: '', hosts: '127.0.0.1\tlocalhost\n134.209.67.146\tnet.attitude.lighting\t# attitude-tunnel-pin (x)\n' });
    enroll(f);
    assert.match(fs.readFileSync(f.hostsFile, 'utf8'), PIN_RE);
});

test('2.A.24: no pin present - an ordinary box never runs a lookup or writes hosts', { skip: SKIP }, () => {
    const f = fakes({ enrolled: true });
    const before = fs.statSync(f.hostsFile).mtimeMs;
    const r = enroll(f);
    assert.doesNotMatch(r.calls, /getent/);
    assert.equal(fs.statSync(f.hostsFile).mtimeMs, before);
});
