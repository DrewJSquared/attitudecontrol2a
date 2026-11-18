// 2.A.26 — a power cut right after an update must not be able to kill a box.
//
// What happened (Oct/Nov 2026, AC-0020153 and at least thirteen more): update.sh rsynced the new
// tree and restarted the app with nothing forcing the files onto the card. A box unplugged inside
// the next ~35 s came back with every file the update had ADDED at 0 bytes. The first of them,
// RenderWatchdog.mjs, was a static import of the entrypoint, so the whole module graph failed to
// link on every boot: no network, no LED, no tunnel, pm2 still saying "online". The only way back
// was the box in someone's hands.
//
// Three guards, three groups of tests:
//
//   1. update.sh's file comparison really finds empty, missing and changed files (and does not
//      trip on files that exist only on the box, or on paths with spaces - node_modules has one).
//   2. update.sh flushes and verifies BEFORE it restarts, repairs an "already current" box whose
//      files are damaged, and makes its own record durable.
//   3. The entrypoint survives exactly the AC-0020153 damage: with RenderWatchdog.mjs and
//      TunnelInstaller.mjs emptied, it still loads, still starts the network module, and reports
//      both modules as errored by name instead of dying silently.
//
//   node --test test/update-durability.test.mjs
//
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UPDATE_SH = fs.readFileSync(path.join(REPO, 'update.sh'), 'utf8');
const NEEDS_POSIX = process.platform === 'win32' ? 'needs bash, find and cmp' : false;


// ---------------------------------------------------------------------------------------------
// 1. tree_mismatches, run for real from the block update.sh itself contains
// ---------------------------------------------------------------------------------------------

function integrityBlock() {
    const m = UPDATE_SH.match(/# --- install-integrity begin[^\n]*\n([\s\S]*?)# --- install-integrity end ---/);
    assert.ok(m, 'update.sh must contain the install-integrity block between its markers');
    return m[1];
}

function mismatches(src, dst) {
    const script = integrityBlock() + '\ntree_mismatches "$1" "$2"\n';
    const out = execFileSync('bash', ['-c', script, 'harness', src, dst], { encoding: 'utf8' });
    return out.split('\n').filter(Boolean).sort();
}

function makeTree(root, files) {
    for (const [rel, body] of Object.entries(files)) {
        const p = path.join(root, rel);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, body);
    }
}

function tempPair(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'att-durability-'));
    const src = path.join(dir, 'src'), dst = path.join(dir, 'dst');
    makeTree(src, files);
    makeTree(dst, files);
    return { dir, src, dst };
}

const RELEASE = {
    'AttitudeControl2A.js': 'import x from "./RenderWatchdog.mjs";\n',
    'RenderWatchdog.mjs': 'export default {};\n',
    'tunnel/install.sh': '#!/bin/bash\necho hi\n',
    'node_modules/@@ test/test.json': '{"a":1}\n',
};

test('an exact copy has no mismatches', { skip: NEEDS_POSIX }, () => {
    const { dir, src, dst } = tempPair(RELEASE);
    try {
        assert.deepEqual(mismatches(src, dst), []);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a 0-byte file on the card is found - the AC-0020153 damage', { skip: NEEDS_POSIX }, () => {
    const { dir, src, dst } = tempPair(RELEASE);
    try {
        fs.truncateSync(path.join(dst, 'RenderWatchdog.mjs'), 0);
        fs.truncateSync(path.join(dst, 'tunnel/install.sh'), 0);
        assert.deepEqual(mismatches(src, dst), ['RenderWatchdog.mjs', 'tunnel/install.sh']);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a missing file and a changed file are both found, including a path with a space', { skip: NEEDS_POSIX }, () => {
    const { dir, src, dst } = tempPair(RELEASE);
    try {
        fs.rmSync(path.join(dst, 'node_modules/@@ test/test.json'));
        fs.writeFileSync(path.join(dst, 'AttitudeControl2A.js'), 'import x from "./Other.mjs";\n');
        assert.deepEqual(mismatches(src, dst), ['AttitudeControl2A.js', 'node_modules/@@ test/test.json']);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('files that exist only on the box (config.json, state files) are not mismatches', { skip: NEEDS_POSIX }, () => {
    const { dir, src, dst } = tempPair(RELEASE);
    try {
        fs.writeFileSync(path.join(dst, 'config.json'), '{"assigned":true}\n');
        fs.writeFileSync(path.join(dst, 'missedNetworkMessages.json'), '[]');
        assert.deepEqual(mismatches(src, dst), []);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});


// ---------------------------------------------------------------------------------------------
// 2. update.sh ordering. These are about WHERE things happen, which is the whole fix: the same
//    sync after the restart would have saved nothing.
// ---------------------------------------------------------------------------------------------

function mainFlow() {
    // Everything after the last function definition: the top-level install sequence.
    const start = UPDATE_SH.indexOf('# 3. Install and restart.');
    assert.ok(start > 0, 'update.sh install section marker not found');
    return UPDATE_SH.slice(start);
}

test('update.sh flushes to the card and verifies BEFORE it restarts the app', () => {
    const flow = mainFlow();
    const rsync  = flow.indexOf('rsync -a "$SRC/" "$APP_DIR/"');
    const flush  = flow.indexOf('flush_to_card');
    const drop   = flow.indexOf('drop_clean_cache');
    const verify = flow.indexOf('tree_mismatches "$SRC" "$APP_DIR"');
    const restart = flow.indexOf('pm2 restart "$PM2_APP_NAME"');
    for (const [name, at] of Object.entries({ rsync, flush, drop, verify, restart })) {
        assert.ok(at >= 0, `${name} not found in the install sequence`);
    }
    assert.ok(rsync < flush, 'flush must come after the rsync');
    assert.ok(flush < drop && drop < verify, 'verify must read back after the flush and cache drop');
    assert.ok(verify < restart, 'the app must not be restarted until the files are verified on the card');
});

test('a failed flush or a failed verify rolls back instead of restarting', () => {
    const flow = mainFlow();
    assert.match(flow, /if ! flush_to_card; then\s+rollback /);
    assert.match(flow, /if \[ -n "\$install_bad" \]; then[\s\S]*?rollback "installed files did not match/);
});

test('"already current" checks the installed files before skipping, so a damaged box is repaired', () => {
    const block = UPDATE_SH.match(/if \[ -n "\$CUR_VERSION" \] && \[ "\$CUR_VERSION" = "\$NEW_VERSION" \][\s\S]*?\nfi\n/);
    assert.ok(block, 'already-current block not found');
    const b = block[0];
    assert.ok(b.indexOf('tree_mismatches') >= 0, 'already-current must compare files');
    assert.ok(b.indexOf('tree_mismatches') < b.indexOf('exit 0'), 'and compare BEFORE it exits');
    assert.match(b, /if \[ -z "\$current_bad" \]; then[\s\S]*?exit 0/, 'it may only skip when nothing differs');
});

test('the rollback path flushes the restored tree, and the build record is made durable', () => {
    const rb = UPDATE_SH.match(/rollback\(\) \{[\s\S]*?\n\}\n/)[0];
    assert.ok(rb.indexOf('flush_to_card') > rb.indexOf('rsync -a --delete'), 'restore must be flushed');
    assert.ok(rb.indexOf('flush_to_card') < rb.lastIndexOf('pm2 restart'), 'before the restart');
    // up to the next function, not the first '}' - the JSON heredoc inside has its own
    const ws = UPDATE_SH.slice(UPDATE_SH.indexOf('write_build_state() {'), UPDATE_SH.indexOf('\nabort() {'));
    assert.match(ws, /sync -- "\$BUILD_STATE" "\$LOG"/);
});


// ---------------------------------------------------------------------------------------------
// 3. The entrypoint, booted for real against the AC-0020153 damage
// ---------------------------------------------------------------------------------------------

test('the fixture manager\'s stand-in watchdog provides every method the fixture manager calls', () => {
    const fm = fs.readFileSync(path.join(REPO, 'AttitudeFixtureManager.mjs'), 'utf8');
    const stand = fm.match(/const NO_WATCHDOG = Object\.freeze\(\{([\s\S]*?)\}\);/);
    assert.ok(stand, 'NO_WATCHDOG not found in AttitudeFixtureManager.mjs');
    const called = new Set([...fm.matchAll(/renderWatchdog\.(\w+)\(/g)].map(m => m[1]));
    assert.ok(called.size > 0);
    for (const method of called) {
        assert.match(stand[1], new RegExp('\\b' + method + '\\('), `NO_WATCHDOG is missing ${method}()`);
    }
});

test('entrypoint: core path is static, optional modules are not', () => {
    const entry = fs.readFileSync(path.join(REPO, 'AttitudeControl2A.js'), 'utf8');
    const staticImports = [...entry.matchAll(/^import\s+[\s\S]*?from\s+'\.\/([^']+)'/gm)].map(m => m[1]);
    for (const core of ['NetworkModule.mjs', 'IdManager.mjs', 'ConfigManager.mjs', 'MacrosModule.mjs', 'StatusTracker.mjs']) {
        assert.ok(staticImports.includes(core), `${core} must stay a static import - it is the recovery path`);
    }
    for (const optional of ['RenderWatchdog.mjs', 'TunnelInstaller.mjs', 'AttitudeFixtureManager.mjs', 'ModuleStatusTracker.mjs']) {
        assert.ok(!staticImports.includes(optional), `${optional} must not be a static import of the entrypoint`);
    }
});

test('entrypoint survives emptied RenderWatchdog.mjs and TunnelInstaller.mjs, starts the network, and names both',
     { skip: NEEDS_POSIX, timeout: 30000 }, async () => {
    // A throwaway copy of the app: every top-level source file, node_modules linked, then the two
    // files AC-0020153 had at 0 bytes truncated. Nothing runs in the repo itself.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'att-entry-'));
    const app = path.join(dir, 'attitudecontrol2a');
    fs.mkdirSync(app);
    for (const f of fs.readdirSync(REPO)) {
        if (/\.(m?js|json)$/.test(f) && f !== 'config.json') fs.copyFileSync(path.join(REPO, f), path.join(app, f));
    }
    fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(app, 'node_modules'), 'dir');
    fs.writeFileSync(path.join(app, 'RenderWatchdog.mjs'), '');
    fs.writeFileSync(path.join(app, 'TunnelInstaller.mjs'), '');

    // The probe shares the app's EventHub singleton (same file URL), records every moduleStatus,
    // and prints them as JSON after the init sequence has had time to finish.
    const probe = `
        const { default: eventHub } = await import(${JSON.stringify('file://' + path.join(app, 'EventHub.mjs'))});
        const seen = [];
        eventHub.on('moduleStatus', s => seen.push({ name: s.name, status: s.status, data: String(s.data || '') }));
        await import(${JSON.stringify('file://' + path.join(app, 'AttitudeControl2A.js'))});
        setTimeout(() => { process.stdout.write('PROBE ' + JSON.stringify(seen) + '\\n'); process.exit(0); }, 4000);
    `;

    try {
        const out = await new Promise((resolve, reject) => {
            const child = spawn(process.execPath, ['--input-type=module', '-e', probe], { cwd: app });
            let stdout = '', stderr = '';
            child.stdout.on('data', d => { stdout += d; });
            child.stderr.on('data', d => { stderr += d; });
            child.on('error', reject);
            child.on('close', code => resolve({ code, stdout, stderr }));
        });

        assert.doesNotMatch(out.stderr, /SyntaxError/, 'the module graph must not fail to link:\n' + out.stderr);
        const line = out.stdout.split('\n').find(l => l.startsWith('PROBE '));
        assert.ok(line, `the app must keep running long enough to report (exit ${out.code}):\n${out.stderr}`);
        const seen = JSON.parse(line.slice(6));

        for (const name of ['RenderWatchdog', 'TunnelInstaller']) {
            const s = seen.find(x => x.name === name && x.status === 'errored');
            assert.ok(s, `${name} must be reported errored; saw ${JSON.stringify(seen.map(x => x.name + ':' + x.status))}`);
            assert.match(s.data, /empty or truncated/);
        }
        assert.ok(seen.some(x => x.name === 'NetworkModule'),
            'the network module must have started - it is the only way back to a damaged box');
        assert.ok(!seen.some(x => x.name === 'AttitudeFixtureManager' && x.status === 'errored' && /Failed to load/.test(x.data)),
            'an empty watchdog must not stop the fixture manager - the lights keep rendering without their monitor');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
