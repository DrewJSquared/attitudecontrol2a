# 2.A.26 — a power cut right after an update can no longer kill a box

## What happened

At least fourteen boxes shipped dead in October and November 2026. They pass the bench test, then
at the customer the LED goes blue and the box never comes online. AC-0020153 came back and was
taken apart on the bench on 2026-11-18:

- It had taken its first-boot update from 2.A.19 to 2.A.25 on the bench and was **unplugged within
  about a minute** - a power-cycle test.
- `update.sh` rsyncs the new tree and restarts the app with **nothing forcing the files onto the
  card**. Linux holds newly written data in memory for up to ~35 s. Files the update REPLACED
  survived (btrfs flushes a file renamed over an existing one). **Every file the update ADDED - 22 of
  them - came back as a name with 0 bytes**, and so did the updater's own log and result record.
- The first of them, `RenderWatchdog.mjs`, was a **static import of the entrypoint**. One empty
  static import fails the whole module graph: no network, no LED, no tunnel, on every boot, while
  pm2 reports the process `online`. No remote way back.

Full write-up: `claude/FINDINGS-2026-11-18-blue-light-boxes-zero-byte-new-files.md` (Attitude project).

## What changes

**`update.sh` (v4)**
- After the rsync and **before the restart**: `sync`, drop the clean page cache, then compare every
  file of the release against what is now installed, read back from the card. Any difference rolls
  back to the snapshot. The log says whether the verify read from the card or from memory (cache
  drop needs passwordless sudo, which field boxes have).
- **"Already current" no longer means "nothing to do".** If the installed files differ from the
  release, the updater reinstalls. A damaged box that can still reach the server is repaired just by
  flagging an update.
- The rollback path flushes the restored tree before restarting, and the build record and log are
  flushed whenever they are written.

**`AttitudeControl2A.js`**
- Core modules (identity, config, network, status, macros/updater) stay static imports. **Every other
  module is loaded with `import()`, one at a time, in its own try/catch.** A broken module costs only
  itself; the box still connects and reports `MODULE FAILED TO LOAD: <name>` plus an `errored` status
  for that module (held, not decaying to unresponsive). An errored fixture manager or scheduler puts
  the output in white backup, as it would at runtime.
- `sync` once at every start. A box updating FROM an older build runs that build's updater, which does
  not flush; the new app flushes seconds after it is installed, shrinking that window from ~35 s to
  app start-up time.

**`AttitudeFixtureManager.mjs`**
- The render watchdog is loaded with `import()` and falls back to a do-nothing stand-in. A monitor can
  no longer stop the fixtures it monitors.

## What this does not fix

- **Boxes already dead at customers.** Their app cannot start, so they cannot take this update. Ship
  back, card swap, or an on-site laptop running `attitude-verify-repair.sh repair`.
- **The update TO 2.A.26 runs the old updater.** The startup `sync` narrows the window but does not
  close it. Until the master card image is refreshed, keep new boxes powered at least 10 minutes on
  the bench and confirm the current version on /admin/fleet before any power cycle.

## Tests

`npm run preflight` clean (smoke, golden, defects); `npm test` 232/232, 11 new in
`test/update-durability.test.mjs`:
- the comparison `update.sh` really runs (sourced from its marked block) finds 0-byte, missing and
  changed files, including a path with a space, and ignores box-only files like config.json;
- flush, cache drop and verify sit between the rsync and the restart; failure of either rolls back;
  already-current compares before it skips; rollback flushes; the build record is synced;
- the fixture manager's stand-in provides every watchdog method it calls;
- **a copy of the app with `RenderWatchdog.mjs` and `TunnelInstaller.mjs` emptied - the AC-0020153
  damage - boots, starts the network module, keeps the fixture manager, and reports both modules
  errored as "empty or truncated".**

## Canary before merge (bench box AC-0020153)

1. Install this branch with `ATT_REPO_URL=https://github.com/J2-John/attitudecontrol2a ./update.sh update-durability-2a26`
   (this run uses the box's 2.A.25 updater; let it finish).
2. Re-run with `ATT_FORCE=1` - now the v4 updater runs. The log must show
   `files flushed to the card and verified against the release (read back from card)`.
3. Empty `RenderWatchdog.mjs`, reboot: the box must come online and report RenderWatchdog errored.
4. Run `./update.sh update-durability-2a26` again: it must log `already on 2.A.26 but 1 installed
   file(s) differ ... reinstalling to repair` and finish `updated`.
