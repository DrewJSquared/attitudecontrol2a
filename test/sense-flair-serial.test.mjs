// 2.A.27 — a Flair Sense works with an Attitude box, matched by its serial number.
//
// Found 2026-11-20 on the bench (AC-0020180): a Flair Sense (Mark VII, firmware 2.1) broadcasts
//   {"NAME":"Flair Sense","TYPE":1,"ID":11,"SERIAL":"SENS-87734C2D","VERSION":"2.1",...,
//    "DATA":"0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0"}
// Two problems, both fixed here:
//   1. DATA has 19 values (15 car-wash + 4 relay inputs). The box accepted exactly 16, so every
//      packet was rejected and the unit's triggers never fired.
//   2. ID is "11" on every unit flashed without editing - and 11 is a live field Sense. Matching
//      by ID would act on another Sense's ports, and relaying under ID 11 would overwrite that
//      Sense's status on the server. A Flair Sense must be matched by SERIAL.
//
// Ruling (John, 2026-10-05, the same as FlairNode): inputs 1-16 are the same inputs in the same
// order on both Sense lines, so a 19-value packet is trimmed to its first 16.
//
// These run the REAL AttitudeSenseManager through handleNewSenseData, the path every UDP packet
// takes, with the location's Sense records set in the real ConfigManager.
//
//   node --test test/sense-flair-serial.test.mjs
//
import test from 'node:test';
import assert from 'node:assert/strict';

const { default: senseManager }  = await import('../AttitudeSenseManager.mjs');
const { default: configManager } = await import('../ConfigManager.mjs');
const { default: eventHub }      = await import('../EventHub.mjs');


const ZERO16 = Array(16).fill(0);
const data = (n, onAt = []) => Array.from({ length: n }, (_, i) => (onAt.includes(i + 1) ? 1 : 0)).join(',');

function packet(over = {}) {
    return { NAME: 'Attitude Sense', TYPE: 1, ID: 82, VERSION: '0.9', PACKET_NO: 7, DATA: data(16), ...over };
}

function flair(over = {}) {
    return packet({ NAME: 'Flair Sense', ID: 11, SERIAL: 'SENS-87734C2D', VERSION: '2.1', DATA: data(19), ...over });
}

// Fresh manager state and a given set of website Sense records for "this location".
function reset(senses) {
    senseManager.mostRecentPacketFromEachSense.clear();
    senseManager.mostRecentPacketBySerial.clear();
    senseManager.serialPacketByAnnouncedId.clear();
    senseManager.trimmedSenseIds.clear();
    senseManager.unassignedSerialsLogged.clear();
    senseManager.unassignedSerialLastReport.clear();
    configManager.config = { ...(configManager.config || {}), attitudeSenses: senses, logLevel: 'minimal' };
}

// Capture what the box would relay to the server and whether the packet was rejected.
function capture(fn) {
    const relayed = [], statuses = [];
    const onData = p => relayed.push(p);
    const onStatus = s => { if (s.name === 'AttitudeSenseManager') statuses.push(s); };
    eventHub.on('senseData', onData);
    eventHub.on('moduleStatus', onStatus);
    try { fn(); } finally { eventHub.off('senseData', onData); eventHub.off('moduleStatus', onStatus); }
    return { relayed, statuses, rejected: statuses.some(s => s.status === 'errored') };
}

const LIVE_SENSE_11 = { id: 11, serialnumber: 'SENS-0010011', data: [] };     // an original Sense, live
const FLAIR_RECORD  = { id: 205, serialnumber: 'SENS-87734C2D', data: [] };   // the Flair Sense's own record


// ---------------------------------------------------------------------------------------------
// The 16-or-19 rule
// ---------------------------------------------------------------------------------------------

test('a 19-value Flair Sense packet is accepted and trimmed to inputs 1-16', () => {
    reset([FLAIR_RECORD]);
    const r = capture(() => senseManager.handleNewSenseData(flair({ DATA: data(19, [1, 16, 17, 19]) })));
    assert.equal(r.rejected, false, 'must not be rejected: ' + JSON.stringify(r.statuses));
    const ports = senseManager.getSensePortData(FLAIR_RECORD);
    assert.equal(ports.length, 16, 'the box works in 16 ports');
    assert.equal(ports[0], 1, 'input 1 is input 1');
    assert.equal(ports[15], 1, 'input 16 is input 16');
    assert.deepEqual(r.relayed[0].data.length, 16, 'the server receives 16 values, as it expects');
});

test('the original 16-value Sense still works exactly as before', () => {
    reset([{ id: 82, serialnumber: 'SENS-0010082', data: [] }]);
    const r = capture(() => senseManager.handleNewSenseData(packet({ DATA: data(16, [6]) })));
    assert.equal(r.rejected, false);
    assert.equal(senseManager.getSensePortData({ id: 82, serialnumber: 'SENS-0010082' })[5], 1);
    assert.equal(r.relayed[0].id, 82, 'reported under its own ID');
    assert.equal(senseManager.getSensePortDataById(82)[5], 1, 'the old by-ID lookup still serves it');
});

test('every other shape of DATA is still refused', () => {
    reset([FLAIR_RECORD]);
    for (const bad of [data(15), data(17), data(18), data(20), data(16) + ',', '0,0,2' + ',0'.repeat(13),
                       ' 0' + ',0'.repeat(15), data(16).replace(/,/g, ';'), '', 16]) {
        const r = capture(() => senseManager.handleNewSenseData(flair({ DATA: bad })));
        assert.equal(r.rejected, true, `DATA ${JSON.stringify(bad)} must be rejected`);
        assert.equal(r.relayed.length, 0, `and never relayed: ${JSON.stringify(bad)}`);
    }
});


// ---------------------------------------------------------------------------------------------
// Matching by serial number
// ---------------------------------------------------------------------------------------------

test('a Flair Sense is matched to its own record by serial, whatever ID it announces', () => {
    reset([LIVE_SENSE_11, FLAIR_RECORD]);
    const r = capture(() => senseManager.handleNewSenseData(flair({ DATA: data(19, [3]) })));
    assert.equal(senseManager.getSensePortData(FLAIR_RECORD)[2], 1, 'its own record gets its inputs');
    assert.equal(r.relayed[0].id, 205, 'relayed under its OWN record id, not the 11 it announced');
});

test('a Flair Sense announcing ID 11 never drives, or overwrites, the live Sense 11', () => {
    reset([LIVE_SENSE_11, FLAIR_RECORD]);
    capture(() => {
        senseManager.handleNewSenseData(packet({ ID: 11, DATA: data(16, [2]) }));            // the real Sense 11
        senseManager.handleNewSenseData(flair({ ID: 11, DATA: data(19, [9, 10, 11]) }));   // a Flair Sense, also "11"
    });
    const live = senseManager.getSensePortData(LIVE_SENSE_11);
    assert.equal(live[1], 1, 'Sense 11 keeps its own input 2');
    assert.equal(live[8] + live[9] + live[10], 0, 'and never sees the Flair Sense inputs 9-11');
});

test('a Flair Sense this location does not have is REPORTED with its serial for auto-connect, but not acted on (2.A.28)', () => {
    reset([LIVE_SENSE_11]);   // this location has Sense 11 only; the Flair unit is new here
    const r = capture(() => senseManager.handleNewSenseData(flair({ ID: 11, DATA: data(19, [1]) })));
    assert.equal(r.relayed.length, 1, 'the server must hear about it - that is how it gets connected');
    assert.equal(r.relayed[0].id, null, 'with NO id: the 11 it announces is another site\'s live Sense');
    assert.equal(r.relayed[0].serial, 'SENS-87734C2D', 'and its serial, which is what the server keys on');
    assert.deepEqual(senseManager.getSensePortData(LIVE_SENSE_11), ZERO16, 'Sense 11 is not driven by it');
    assert.deepEqual(senseManager.getSensePortData(FLAIR_RECORD), ZERO16.map((_, i) => i === 0 ? 1 : 0),
        'once its own record arrives in config, its inputs are used - the packet was kept by serial');
    assert.equal(r.rejected, false, 'a valid packet is not an error');
});

test('an unassigned unit is reported at once, then at most every 10 s - not every heartbeat', () => {
    reset([LIVE_SENSE_11]);
    const r = capture(() => { for (let i = 0; i < 5; i++) senseManager.handleNewSenseData(flair()); });
    assert.equal(r.relayed.length, 1, 'five heartbeats in a row: one report');
    senseManager.unassignedSerialLastReport.set('SENS-87734C2D', Date.now() - 11000);
    const r2 = capture(() => senseManager.handleNewSenseData(flair()));
    assert.equal(r2.relayed.length, 1, 'after 10 s it is reported again, so the server can notice a move');
});

test('a location with NO Senses yet: a new Flair Sense is reported for auto-connect, never as ID 11', () => {
    reset([]);
    const r = capture(() => senseManager.handleNewSenseData(flair({ ID: 11 })));
    assert.equal(r.relayed.length, 1);
    assert.equal(r.relayed[0].id, null, 'an empty site is where a new unit auto-connects - not a reason to trust its ID');
    assert.equal(r.relayed[0].serial, 'SENS-87734C2D');
});

test('a matched Flair Sense is relayed under its record id WITH its serial; the original Sense without one', () => {
    reset([FLAIR_RECORD, { id: 82, serialnumber: 'SENS-0010072', data: [] }]);
    const r = capture(() => {
        senseManager.handleNewSenseData(flair());
        senseManager.handleNewSenseData(packet({ ID: 82 }));
    });
    assert.equal(r.relayed[0].id, 205);
    assert.equal(r.relayed[0].serial, 'SENS-87734C2D', 'the server uses the serial to keep it following the box that hears it');
    assert.equal(r.relayed[1].id, 82);
    assert.equal('serial' in r.relayed[1], false, 'the original Sense sends no serial and none is invented');
});

test('serials match regardless of case and stray spaces', () => {
    reset([{ id: 205, serialnumber: ' sens-87734c2d ', data: [] }]);
    capture(() => senseManager.handleNewSenseData(flair({ SERIAL: 'SENS-87734C2D', DATA: data(19, [4]) })));
    assert.equal(senseManager.getSensePortData({ id: 205, serialnumber: ' sens-87734c2d ' })[3], 1);
});

test('a unit still announcing the firmware placeholder serial is treated as having none', () => {
    reset([{ id: 11, data: [] }]);
    capture(() => senseManager.handleNewSenseData(flair({ SERIAL: 'SENS-00200xx', ID: 11, DATA: data(19, [5]) })));
    assert.equal(senseManager.mostRecentPacketBySerial.size, 0, 'the placeholder is not a serial');
    assert.equal(senseManager.getSensePortData({ id: 11 })[4], 1, 'it falls back to its announced ID');
});

test('a location whose config carries no serial numbers behaves as before 2.A.27', () => {
    // If the server does not send serialnumber in the Sense records, there is nothing to match a
    // serial against: the announced ID is used, as it always was.
    reset([{ id: 11, data: [] }]);
    const r = capture(() => senseManager.handleNewSenseData(flair({ ID: 11, DATA: data(19, [7]) })));
    assert.equal(senseManager.getSensePortData({ id: 11 })[6], 1);
    assert.equal(r.relayed[0].id, 11);
});

test('a Flair Sense that goes quiet ages out like any other', () => {
    reset([FLAIR_RECORD]);
    capture(() => senseManager.handleNewSenseData(flair({ DATA: data(19, [1]) })));
    senseManager.mostRecentPacketBySerial.get('SENS-87734C2D').receivedAt = Date.now() - 10 * 60 * 1000;
    assert.deepEqual(senseManager.getSensePortData(FLAIR_RECORD), ZERO16);
    assert.equal(senseManager.mostRecentPacketBySerial.has('SENS-87734C2D'), false, 'stale entry dropped');
});

test('the scheduler looks Senses up by record, so serial matching reaches the overrides', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(new URL('../AttitudeScheduler.mjs', import.meta.url), 'utf8');
    assert.match(src, /attitudeSenseManager\.getSensePortData\(attitudeSense\)/,
        'the scheduler must pass the whole record (id + serialnumber), not just the id');
});
