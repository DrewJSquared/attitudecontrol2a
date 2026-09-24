#!/usr/bin/env bash
#
# tunnel/install.sh - install or refresh attitude-tunnel-enroll.service. Run as root:
#
#   sudo -n /bin/bash tunnel/install.sh <this tunnel/ directory> <path to id.json>
#
# Called by TunnelInstaller.mjs after the app boots (the app runs as `attitude`, which has
# passwordless sudo - measured 2026-09-03). Idempotent: identical files are not rewritten, so
# a device that already has the current service writes nothing to its SD card.
#
# Copies files and enables a unit. Never touches the app, pm2, update.sh or the lights.

set -euo pipefail

SRC="${1:?usage: install.sh <tunnel dir> <id.json path>}"
ID_FILE="${2:?usage: install.sh <tunnel dir> <id.json path>}"

SBIN="${ATT_TUNNEL_SBIN:-/usr/local/sbin}"                 # overridable for tests only
UNITDIR="${ATT_TUNNEL_UNITDIR:-/etc/systemd/system}"
SYSTEMCTL="${ATT_TUNNEL_SYSTEMCTL:-systemctl}"

[ "$(id -u)" = 0 ] || { echo "install.sh: must run as root" >&2; exit 2; }
[ -f "$SRC/attitude-tunnel-enroll.sh" ] && [ -f "$SRC/attitude-tunnel-enroll.service" ] \
    || { echo "install.sh: source files missing in $SRC" >&2; exit 2; }
case "$ID_FILE" in */id.json) ;; *) echo "install.sh: refusing odd id path: $ID_FILE" >&2; exit 2;; esac

S_DST="$SBIN/attitude-tunnel-enroll.sh"
U_DST="$UNITDIR/attitude-tunnel-enroll.service"

UNIT_TMP="$(mktemp)"
trap 'rm -f "$UNIT_TMP"' EXIT
sed "s|__ID_FILE__|$ID_FILE|" "$SRC/attitude-tunnel-enroll.service" > "$UNIT_TMP"

changed=0
if ! cmp -s "$SRC/attitude-tunnel-enroll.sh" "$S_DST"; then
    install -D -m 0755 -o root -g root "$SRC/attitude-tunnel-enroll.sh" "$S_DST"
    changed=1
fi
if ! cmp -s "$UNIT_TMP" "$U_DST"; then
    install -D -m 0644 -o root -g root "$UNIT_TMP" "$U_DST"
    changed=1
fi

if [ "$changed" = 1 ]; then
    "$SYSTEMCTL" daemon-reload
fi
"$SYSTEMCTL" is-enabled --quiet attitude-tunnel-enroll.service 2>/dev/null \
    || "$SYSTEMCTL" enable attitude-tunnel-enroll.service

# Start it now rather than at the next boot. --no-block: never make the app wait on an enrolment
# that may sit out a network outage. If it is already running and the script changed, restart it.
if "$SYSTEMCTL" is-active --quiet attitude-tunnel-enroll.service 2>/dev/null; then
    [ "$changed" = 1 ] && "$SYSTEMCTL" restart --no-block attitude-tunnel-enroll.service
else
    "$SYSTEMCTL" start --no-block attitude-tunnel-enroll.service
fi

echo "INSTALLED changed=$changed"
