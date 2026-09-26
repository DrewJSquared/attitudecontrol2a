# 2.A.25 — Tailscale SSH on whenever a box is found enrolled

## What happened

AC-0020104 joined the tunnel at 18:41 UTC on 2026-09-26 — the 2.A.24 hosts pin worked — but it
joined a few seconds *after* its `tailscale up` had timed out. The script only ran
`tailscale set --ssh` straight after a successful `up`, so on the next pass it found the box
enrolled and exited with Tailscale SSH still off: on the tunnel, but not reachable by
`tailscale ssh`.

## What changes (tunnel/attitude-tunnel-enroll.sh only)

- **Every time the script finds the box enrolled** (at boot, or on a later pass), it runs
  `tailscale set --ssh`. It is idempotent, so boxes that already have it are unaffected; any box
  that ever loses it gets it back at its next boot.
- **A join that finishes after `up` gave up is reported** as `"stage":"enrolled"` with
  `joined after up timed out`, so the website log shows every enrolment, including late ones.
  A box already enrolled at boot still reports nothing.

On 0020104 the update itself fixes it: the installer sees the new script and restarts the
service, which finds the box enrolled and turns SSH on.

## Tests

`npm test` all pass; 2 new: an enrolled box turns SSH on and asks for no key or report; a join
that completes after `up` timed out turns SSH on, asks for no second key, and reports
`up` then `enrolled`.
