# 2.A.24 — pin the tunnel server in /etc/hosts where tailscaled cannot use the site's DNS

## What 2.A.23 found

AC-0020104, 2026-09-26 18:27 and 18:30 UTC, tailscaled's own log:

    fetch control key: Get https://net.attitude.lighting/key?v=142: failed to resolve net.attitude.lighting

while the same box's `curl` resolved and reached `net.attitude.lighting` on every attempt
(`probe: reachable`, and `GET /health` 200 in the server's log). State `NeedsLogin`,
version 1.102.4, disk 9% — nothing else wrong.

curl resolves names through glibc. tailscale is a static Go binary with Go's own DNS client: it
reads `/etc/resolv.conf` itself and queries those servers directly, and some site DNS servers
mishandle its queries while answering glibc fine. Go's resolver does consult `/etc/hosts` first.

## What changes (tunnel/attitude-tunnel-enroll.sh only)

- **After a failed `up`, and only if tailscaled's journal says it failed to resolve the tunnel
  server**, the script looks the name up through glibc and adds one marked line to `/etc/hosts`:
  `134.209.67.146  net.attitude.lighting  # attitude-tunnel-pin (...)`. The next attempt restarts
  tailscaled (2.A.23), which then resolves it from the file.
- **Every run refreshes an existing pin** from a fresh glibc lookup, with the pin taken out
  first so the lookup really goes to DNS. A droplet that ever changes address is followed on the
  next boot; if DNS is down, the old pin is kept. This runs on enrolled boxes too, but only where
  a pin exists.
- Nothing else in `/etc/hosts` is touched; the file is rewritten in place and never written back
  if it could not be read. A box that never had the problem never runs a lookup or writes the
  file. The pin appears in the report as `pin=<ip>`.

## Tests

`npm test` all pass; 6 new: pin added on a resolve failure with the rest of hosts intact and only
one pin however many failures; any other failure never touches hosts; no pin when glibc cannot
resolve either; a moved address updates the pin on an enrolled box; DNS down keeps the old pin;
an ordinary box never looks up or writes.
