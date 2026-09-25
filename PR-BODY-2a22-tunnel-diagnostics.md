# 2.A.22 — the tunnel enrolment says why it failed, and cannot hang

## What happened

The first field box to take 2.A.21, AC-0020104, installed the enrolment service and got its
tunnel key from attitude.lighting at 18:33 UTC on 2026-09-25. Then nothing. The tunnel server
(net.attitude.lighting) never saw a single request from that site, and the box never asked for a
second key. `tailscale up` has no time limit by default, so it was waiting forever on a server it
could not reach. With no tunnel and no serveo, there was no way to ask the box why. Its lights
are fine throughout.

## What changes (tunnel/attitude-tunnel-enroll.sh only)

1. **Reachability first.** Before asking for a key, the script fetches
   `https://net.attitude.lighting/health`. If that fails it asks for no key, and it logs curl's
   exit code, which separates the causes a site network can have: 6 name does not resolve,
   7 refused, 28 timed out, 35 handshake reset (a hostname filter), 60 certificate not trusted
   (TLS interception). It also logs what the name resolves to locally and the box's nameservers.
2. **`tailscale up --timeout=120s`.** A hang becomes a logged failure, a retry with backoff, and
   a fresh key on the next pass.
3. **Reports to the website.** Every failed check, every failed `up` and every success is POSTed
   to `attitude.lighting/api/v1/device/tunnel-report`, which any box that got a key can reach.
   Reports never carry the key; `up` output has the key masked before logging.

The installer needs no change. The script's contents change, so TunnelInstaller reinstalls it,
and install.sh already restarts a running service when its files change. That restart also
clears the stuck `tailscale up` on 0020104.

## Depends on

attitudelighting patch `0002-Tunnel-report-endpoint...` deployed first. Without it the reports
go nowhere and everything else still works.

## Tests

`npm test`: 210 pass, 5 new in `tunnel-scripts.test.mjs`: DNS failure (no key requested,
reported with curl 6, backs off), handshake reset reported as 35, bounded `up` failing (reported
without the key, one key per attempt), success reported, and already-enrolled sending nothing.
