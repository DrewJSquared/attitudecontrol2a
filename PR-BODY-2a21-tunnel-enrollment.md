# 2.A.21 — devices put themselves on the J2 tunnel

A device on 2.A.21 installs a small root service, `attitude-tunnel-enroll.service`, that joins
the J2-owned tunnel (headscale at `net.attitude.lighting`) with nobody touching it: on a card
booting for the first time, on a box a technician has just unfrozen, or on a box that has lost
its tunnel identity.

Reach on 2026-09-24: 17 devices on 2.A.19/2.A.20 that are not yet on the tunnel (12 of them a
batch provisioned on 09-23), every future card, and self-healing for the 23 enrolled by hand.

## How

1. **`TunnelInstaller.mjs`** (app, 2 min after boot): if the installed service differs from
   `tunnel/`, runs `sudo -n /bin/bash tunnel/install.sh tunnel/ ../id.json`. Records the attempt
   before acting; 3 attempts per version, 6 h apart; a current device writes nothing.
2. **`tunnel/install.sh`** (root): copies the script to `/usr/local/sbin` and the unit to
   `/etc/systemd/system`, enables and starts it. Idempotent.
3. **`tunnel/attitude-tunnel-enroll.sh`** (root, every boot): installs tailscale if missing
   (niced), exits if already enrolled, otherwise reads `id.json`, asks
   `POST https://attitude.lighting/api/v1/device/tunnel-key` for a single-use key and runs
   `tailscale up --reset --hostname=attitudecontrol-<serial> --accept-dns=false`, then `set --ssh`.
   Every retry backs off (60 s doubling to 1 h); a 409 goes straight to 1 h.

Why the app installs it rather than `update.sh`: the updater that runs is the one already on
disk, so a step added to 2.A.21's `update.sh` would first execute on the update *after* 2.A.21.

Why shipping a root script from this public repo adds no exposure: `attitude` already has
passwordless sudo, so push access here was already root on the fleet. No secret is in the repo;
keys are minted per device by the server, and a device key reaches nothing (policy verified on
hardware 2026-09-22).

Nothing here touches the render loop, pm2, `update.sh`, or the lights.

## Depends on

The Laravel endpoint `POST /api/v1/device/tunnel-key` (attitudelighting patch
`0001-Tunnel-enrollment-endpoint-for-Attitude-devices.patch`), deployed and verified by curl
**before** any device runs 2.A.21. Without it the service simply retries with backoff.

## Tests

`npm test`: 205 pass, including 22 new — `tunnel-installer.test.mjs` (the decision and launch,
every platform) and `tunnel-scripts.test.mjs` (both scripts executed against fake
`tailscale`/`curl`/`systemctl`: already-enrolled, fresh enrolment, 409, server down, missing
id.json, quoted device_id, install first/second run, bad id path).
