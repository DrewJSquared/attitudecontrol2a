# 2.A.27 — Flair Sense works with an Attitude box, matched by its serial number

## What was wrong

Found on the bench on 2026-11-20 (AC-0020180, a UDP capture on 6455). A Flair Sense (Mark VII,
firmware 2.1) broadcasts:

```
{"NAME":"Flair Sense","TYPE":1,"ID":11,"SERIAL":"SENS-87734C2D","VERSION":"2.1",...,"DATA":"0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0"}
```

1. **19 input values.** The board has 15 car-wash inputs and 4 relay inputs, and every Flair Sense
   firmware since its first commit (2026-07-01) sends all 19. The box has required exactly 16
   since `AttitudeSenseManager` was written (2024-07-29); no release or branch ever changed it. Every
   packet was rejected (`Invalid DATA property`, folded into `N DUPLICATES`) and the unit's triggers
   never fired.
2. **ID 11 on every unit.** The Flair Sense firmware has `ID = "11"` written in, and **11 is a live
   field Sense.** Matching by ID would act on another Sense's ports; relaying under ID 11 would
   overwrite that Sense's status on the server (which files relayed data by id).

## What changes (`AttitudeSenseManager.mjs`, one line in `AttitudeScheduler.mjs`)

- **16 or 19 values accepted**; a 19-value packet is trimmed to inputs 1-16 (John's ruling, the
  same fix made in FlairNode on 2026-10-05: inputs 1-16 are the same inputs in the same order on
  both lines). Logged once per unit per boot. Every other shape is still refused.
- **A packet with a `SERIAL` is filed by serial, never by its ID.** Packets without one (the
  original 16-input Sense) are filed by ID exactly as before.
- **The scheduler looks a Sense up by its whole website record** (`getSensePortData(sense)`):
  by `serialnumber` first, then by ID for the original Sense.
- **Relayed under the matching record's id.** A serial packet is reported to the server under the
  id of the record whose serial matches, not the ID it announces. A serial this location does not
  own (a unit on the bench, or another site's) is **ignored and not relayed**, so it cannot drive
  or overwrite another Sense. Logged once per unit per boot.
- Serials compare case- and space-insensitively; the firmware placeholder `SENS-00200xx` counts as
  no serial.

## Depends on the server sending serial numbers

Matching by serial needs each Sense record in the box's config to carry `serialnumber`. **If the
server does not send it**, the box has nothing to match against and falls back to the announced ID,
exactly the behaviour before this release (tested). Confirm on a box with a Sense before rollout;
if it is missing, the gateway (`sync.js`) and Laravel (`DeviceController`) both need to include it.

## Tests

`npm run preflight` clean; `npm test` 243/243, 11 new in `test/sense-flair-serial.test.mjs`, all
through the real `handleNewSenseData` path with real ConfigManager records:
19 values accepted and trimmed (inputs 1 and 16 land on ports 1 and 16; server gets 16); the
original Sense unchanged; 15/17/18/20 values, trailing comma, a 2, leading space, wrong separator,
empty and non-string all refused and never relayed; Flair Sense matched by serial whatever ID it
announces and relayed under its own record id; a Flair Sense announcing 11 never drives the live
Sense 11; an unowned serial is ignored and not relayed; case/space-insensitive serials; the
placeholder treated as none; a config without serials behaves as before; a quiet Flair Sense ages
out; the scheduler passes the whole record.

Mutation check: reverting to 16-only fails 7 tests; filing serial packets by ID fails 6; relaying
under the announced ID fails 2.

## Still to do outside this repo

- **Flair Sense firmware:** stop shipping `ID = "11"`. With this release the box ignores a Flair
  Sense's ID wherever the server sends serials, but older boxes (2.A.26 and before, and the 2.A.10
  group) still go by ID.
- Boxes on 2.A.10 cannot take a flagged update, so a Flair Sense will not work at those sites.
