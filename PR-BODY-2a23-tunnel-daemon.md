# 2.A.23 — a fresh tailscaled for every enrolment attempt, and its own story in the report

## What 2.A.22 found

AC-0020104's first report, 2026-09-26 18:12 UTC:

    health: none | up: timeout waiting for Tailscale service to enter a Running state | probe: reachable

and the server logs for the same minutes show the box's `curl` reaching `net.attitude.lighting`
four times (`GET /health`, 200) while its tailscaled sent **nothing** — no `/key`, no
registration — through a full two-minute `tailscale up` with a valid key. The site network is
fine. Tailscale on the box is sitting idle. Yet at 01:01 that morning a freshly started
tailscaled on the same box did contact the server within seconds.

## What changes (tunnel/attitude-tunnel-enroll.sh only)

1. **Restart tailscaled before every enrolment attempt** (after the key, before `up`), and wait
   up to 30 s for it to answer. Only on the not-enrolled path: an enrolled box exits long before
   this, so nothing on the tunnel is ever restarted. A box that is not enrolled has nothing
   depending on tailscaled.
2. **The `up` failure report now carries tailscaled's own facts**: its backend state, its version,
   how full the disk holding its state is, and the last three lines of its own journal that
   mention control, login, the network, a dial or an error. Short fields first, so the
   400-character cut can only trim the journal lines, never the state.

As with 2.A.22, the installer needs no change: the new script contents trigger a reinstall and a
service restart, which starts a fresh attempt on 0020104 within minutes of the update.

## Depends on

Nothing new. The report endpoint from attitudelighting `tunnel-report-2a22` is live.

## Tests

`npm test` all pass; 3 new in `tunnel-scripts.test.mjs`: one tailscaled restart per attempt
in the order key → restart → up, no restart ever on an enrolled box, and the failure report
carrying state, version, disk and only the relevant journal lines within 400 characters.
