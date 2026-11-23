# 2.A.28 — report Flair Senses this location doesn't have yet, so the server can auto-connect them

Box half of Sense auto-connect. Server half: attitude-ws-gateway `sense-auto-connect` (the path the
fleet uses) and attitudelighting `sense-auto-connect` (fallback + migration).

Frosty, 2026-11-23: "if a sense is at a site, it needs to auto connect"; "if a sense gets moved, it
needs to auto adapt"; it moves only when "seen by an active box" - never from inactivity.

## What changes (`AttitudeSenseManager.mjs`)

- **A Flair Sense not on this location's records is reported, not dropped.** 2.A.27 ignored it.
  Now it is relayed with its `serial` and `id: null`, at once on first sight and then every 10 s
  (`UNASSIGNED_REPORT_MS`), so the server can create its record here or move it here. Locally it is
  still not acted on until its record arrives in config (seconds) - a unit this site does not own
  must never drive its overrides.
- **Every Flair Sense relay carries `serial`**, matched ones under their record id. The original
  16-input Sense sends none and none is invented.
- **A location with no Senses no longer trusts the announced ID.** 2.A.27 fell back to the
  announced ID whenever no record had a serial, which included an empty list - so a Flair Sense at
  a site with no Senses was relayed as ID 11 (another site's live Sense). The fallback now applies
  only when records exist and none has a serial (a server that does not send them).

## Deploy order

Any. An old server ignores a senseData item with no id; the new server works with 2.A.27 boxes for
Senses already on record. Auto-connect needs both halves.

## Tests

`npm run preflight` clean; `npm test` 246/246. `test/sense-flair-serial.test.mjs` 14 tests (4 new,
1 rewritten): unassigned unit reported with serial and id null and not acted on; reported once then
at most every 10 s; empty location never relays ID 11; matched relay carries serial, original Sense
does not. Mutations: empty-config fallback, no rate limit, serial not sent - each caught.
