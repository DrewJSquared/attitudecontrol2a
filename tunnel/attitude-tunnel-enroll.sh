#!/usr/bin/env bash
#
# attitude-tunnel-enroll.sh - put this Attitude controller on the J2 tunnel.
#
# Installed to /usr/local/sbin by tunnel/install.sh and run by
# attitude-tunnel-enroll.service at every boot, as root.
#
# Runs every boot and exits at once if already enrolled, so it is safe to run
# repeatedly and self-heals if tunnel identity is ever lost. Nothing to re-arm.
#
# DELIBERATELY INDEPENDENT OF THE APP. The tunnel exists to reach a controller
# whose app is broken; it must not fail with the thing it diagnoses. It reads
# id.json itself and talks to its own endpoint, never to the app.
#
# Ported from Flair's flair-tunnel-enroll.sh (2026-09-18) with its four
# first-run fixes: bounded wait for tailscaled at boot, unescaped slashes in the
# server's JSON, output to the terminal when run by hand, and `up --reset`.
# Attitude differences: tailscale is installed here if missing (the fleet was
# never imaged with it), the identity is id.json rather than the CPU serial,
# and every retry backs off - nothing in this firmware may hammer a server.
#
# Does NOT set the OS hostname. --hostname names the machine on the tunnel only.
#
# 2.A.22: every failure the website cannot otherwise see is REPORTED to it. The first field
# enrolment (AC-0020104, 2026-09-25) got its key over attitude.lighting and then never reached
# net.attitude.lighting - and with no tunnel and no serveo there was no way to ask the box why.
# attitude.lighting is by definition reachable from any box that got as far as a key, so that
# is where the reason goes. `tailscale up` is also bounded now: unbounded, one unreachable
# control server held the script silently forever.

set -uo pipefail   # NOT -e: failure means wait and retry, never exit.

BASE_HOST="${ATT_TUNNEL_BASE:-https://attitude.lighting}"
ID_FILE="${ATT_ID_FILE:-/home/attitude/Documents/attitude/id.json}"
LOG="${ATT_TUNNEL_LOG:-/var/log/attitude-tunnel-enroll.log}"
STARTUP_WAIT="${ATT_TUNNEL_STARTUP_WAIT:-60}"
BACKOFF_MIN="${ATT_TUNNEL_BACKOFF_MIN:-60}"
BACKOFF_MAX="${ATT_TUNNEL_BACKOFF_MAX:-3600}"
MAX_PASSES="${ATT_TUNNEL_MAX_PASSES:-0}"      # 0 = forever. Tests only.
# Checked BEFORE a key is requested, so an unreachable tunnel server costs no key. The server's
# own login_server answer is used for the enrolment itself; this is only the reachability probe.
LOGIN_PROBE="${ATT_TUNNEL_LOGIN_SERVER:-https://net.attitude.lighting}"
UP_TIMEOUT="${ATT_TUNNEL_UP_TIMEOUT:-120s}"

backoff="$BACKOFF_MIN"
passes=0

# Keep the log small: it lives on the SD card. Cut to its last 200 lines if it grows past 256 KB.
if [ -f "$LOG" ] && [ "$(stat -c %s "$LOG" 2>/dev/null || echo 0)" -gt 262144 ]; then
    tail -n 200 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
fi

say() {
    local line
    line="$(date '+%Y-%m-%d %H:%M:%S')  $*"
    echo "$line" >> "$LOG"
    # Also to the terminal when a person runs this by hand. Under systemd there is no tty, so this
    # stays silent where it should. Without it, a run quietly retrying looks identical to a hang.
    if [ -t 1 ]; then echo "$line"; fi
}

# Exponential backoff, capped. Returns non-zero when the test pass limit is reached.
wait_and_retry() {
    passes=$((passes + 1))
    if [ "$MAX_PASSES" -gt 0 ] && [ "$passes" -ge "$MAX_PASSES" ]; then
        say "pass limit $MAX_PASSES reached - stopping (test mode)"
        return 1
    fi
    say "retrying in ${backoff}s"
    sleep "$backoff"
    backoff=$((backoff * 2))
    [ "$backoff" -gt "$BACKOFF_MAX" ] && backoff="$BACKOFF_MAX"
    return 0
}

enrolled_ip() { tailscale ip -4 2>/dev/null | head -1; }

# One line, safe inside a JSON string: no quotes, backslashes or control characters, bounded.
# shellcheck disable=SC1003  # '"\\' is a literal quote and backslash for tr
clean() { printf '%s' "$*" | tr -d '"\\' | tr -c '[:print:]' ' ' | cut -c1-400; }

# Tell the website what happened. Best effort by definition: a failed report changes nothing.
# Never carries the key. DEVICE_ID/SERIAL are set before any call site.
report() {   # report <stage> <code> <detail>
    local body
    body="{\"device_id\":$DEVICE_ID,\"serialnumber\":\"$SERIAL\",\"stage\":\"$1\",\"code\":${2:-0},\"detail\":\"$(clean "$3")\"}"
    curl --silent --max-time 10 -o /dev/null -X POST "$BASE_HOST/api/v1/device/tunnel-report" \
        -H 'Content-Type: application/json' -H 'Accept: application/json' -d "$body" 2>/dev/null || true
}

# Can this box reach the tunnel server at all? Sets PROBE_CODE (curl's exit status) and
# PROBE_DETAIL. curl's exit status is what separates the causes a site network can have:
#    6  the name does not resolve        (site DNS filters or cannot see net.attitude.lighting)
#    7  connection refused / no route
#   28  timed out                        (packets silently dropped)
#   35  TLS handshake reset              (a web filter that blocks by hostname)
#   60  certificate not trusted          (a firewall intercepting TLS - tailscale will fail too)
# Any HTTP answer at all, even an error status, means reachable.
probe() {
    local url="$1" host err
    host="${url#*://}"; host="${host%%/*}"
    err="$(curl --silent --show-error --max-time 15 -o /dev/null "$url/health" 2>&1)"
    PROBE_CODE=$?
    [ "$PROBE_CODE" = 0 ] && { PROBE_DETAIL=""; return 0; }
    local ip ns
    ip="$(getent hosts "$host" 2>/dev/null | awk '{print $1}' | head -1)"
    ns="$(awk '/^nameserver/{print $2}' /etc/resolv.conf 2>/dev/null | paste -sd, -)"
    PROBE_DETAIL="curl=$PROBE_CODE $(echo "$err" | head -1); resolves=${ip:-none}; nameservers=${ns:-none}"
    return 1
}

say "--- starting ---"

# ---------------------------------------------------------------------------
# Phase 0: tailscale present? Install it if not. Niced: on a controller held at
# 100 MHz by an overheated enclosure, an apt run must not starve the lights.
# ---------------------------------------------------------------------------
until command -v tailscale >/dev/null 2>&1; do
    say "tailscale not installed - installing"
    if curl -fsSL https://tailscale.com/install.sh | nice -n 19 ionice -c3 sh >>"$LOG" 2>&1 \
       && command -v tailscale >/dev/null 2>&1; then
        say "tailscale installed: $(tailscale version 2>/dev/null | head -1)"
        systemctl enable --now tailscaled >>"$LOG" 2>&1 || true
    else
        say "tailscale install failed"
        wait_and_retry || exit 1
    fi
done

# ---------------------------------------------------------------------------
# Phase 1: does this board already have a tunnel identity?
#
# Do NOT ask once and believe the answer. systemd considers tailscaled started when its process
# launches, not when it answers, so at boot the first check says "not enrolled" while the daemon
# is still restoring state. Flair, 2026-09-18: that fetched a key it did not need on every reboot.
# A board with stored identity answers in seconds; a blank one waits the full minute, which costs
# nothing on a first boot.
# ---------------------------------------------------------------------------
say "waiting up to ${STARTUP_WAIT}s for an existing tunnel identity..."
waited=0
while [ "$waited" -lt "$STARTUP_WAIT" ]; do
    ip="$(enrolled_ip)"
    if [ -n "$ip" ]; then say "already enrolled as $ip - nothing to do"; exit 0; fi
    sleep 2
    waited=$((waited + 2))
done
say "no existing identity after ${STARTUP_WAIT}s - enrolling"

# ---------------------------------------------------------------------------
# Phase 2: enrol. No internet at boot is expected, not exceptional.
# ---------------------------------------------------------------------------
while true; do

    ip="$(enrolled_ip)"
    if [ -n "$ip" ]; then say "already enrolled as $ip - nothing to do"; exit 0; fi

    # id.json: {"device_id": 179, "serialnumber": "AC-0020139"} - device_id may be quoted.
    # Parsed without jq or node: not guaranteed on a bare card, and the app may be the broken thing.
    DEVICE_ID="$(grep -oE '"device_id"[[:space:]]*:[[:space:]]*"?[0-9]+' "$ID_FILE" 2>/dev/null | grep -oE '[0-9]+$' | head -1)"
    SERIAL="$(grep -oE '"serialnumber"[[:space:]]*:[[:space:]]*"[^"]*"' "$ID_FILE" 2>/dev/null | cut -d'"' -f4 | head -1)"

    if [ -z "$DEVICE_ID" ] || [ -z "$SERIAL" ]; then
        say "no usable identity in $ID_FILE (device_id=${DEVICE_ID:-none} serial=${SERIAL:-none})"
        wait_and_retry || exit 1
        continue
    fi

    # Reachability first. A box that cannot reach the tunnel server must not burn a key on every
    # pass, and must say why - to the website it CAN reach.
    if ! probe "$LOGIN_PROBE"; then
        say "cannot reach $LOGIN_PROBE: $PROBE_DETAIL"
        report preflight "$PROBE_CODE" "$PROBE_DETAIL"
        wait_and_retry || exit 1
        continue
    fi

    RAW="$(curl --silent --show-error --max-time 20 -w '\n%{http_code}' \
        -X POST "$BASE_HOST/api/v1/device/tunnel-key" \
        -H 'Content-Type: application/json' -H 'Accept: application/json' \
        -d "{\"device_id\":$DEVICE_ID,\"serialnumber\":\"$SERIAL\"}" 2>>"$LOG")"
    CODE="${RAW##*$'\n'}"
    BODY="${RAW%$'\n'*}"

    case "$CODE" in
        200) ;;
        409)
            # A node with our name exists. Either this board lost its state (an admin must delete
            # the stale record) or something else claimed the name. Both need a person; ask slowly.
            say "server says $SERIAL is already enrolled (409) - an admin must clear the old record"
            backoff="$BACKOFF_MAX"
            wait_and_retry || exit 1
            continue ;;
        *)
            say "tunnel-key request failed (HTTP ${CODE:-none}) for $SERIAL"
            wait_and_retry || exit 1
            continue ;;
    esac

    # PHP escapes forward slashes; grep+cut do not unescape, and tailscale then rejects the URL
    # with a bare "context canceled". The server now sends them unescaped too - belt and braces.
    BODY="${BODY//\\\//\/}"
    HOSTNAME_T="$(echo "$BODY" | grep -o '"hostname":"[^"]*"'     | cut -d'"' -f4)"
    SERVER="$(echo "$BODY"     | grep -o '"login_server":"[^"]*"' | cut -d'"' -f4)"
    KEY="$(echo "$BODY"        | grep -o '"tunnel_key":"[^"]*"'   | cut -d'"' -f4)"

    if [ -z "$HOSTNAME_T" ] || [ -z "$SERVER" ] || [ -z "$KEY" ]; then
        say "response missing a field (hostname=${HOSTNAME_T:-none} server=${SERVER:-none} key=$([ -n "$KEY" ] && echo present || echo none))"
        wait_and_retry || exit 1
        continue
    fi

    # Log what is about to happen, not only whether it worked: Flair's escaped-URL bug was found
    # from exactly this line.
    say "enrolling as $HOSTNAME_T against $SERVER"

    # --reset: tailscale refuses to run over partial state whose flags differ, with a wall of text.
    # --accept-dns=false: this controller must keep resolving attitude.lighting through the site's
    #   own DNS; a VPN client has no business rewriting it on a customer network.
    # --timeout: without it `up` waits forever for a control server it cannot reach (0020104,
    #   2026-09-25). Bounded, a hang becomes a logged, reported failure and a fresh key next pass.
    # The key is an argument, never written to disk: single-use, 15 minutes, no other users.
    UP_OUT="$(tailscale up --reset --login-server="$SERVER" --authkey="$KEY" \
            --hostname="$HOSTNAME_T" --accept-dns=false --timeout="$UP_TIMEOUT" 2>&1)"
    UP_RC=$?
    UP_OUT="${UP_OUT//"$KEY"/<key>}"
    [ -n "$UP_OUT" ] && echo "$UP_OUT" >> "$LOG"
    if [ "$UP_RC" = 0 ]; then
        tailscale set --ssh >>"$LOG" 2>&1
        say "ENROLLED  $HOSTNAME_T  $(enrolled_ip)"
        report enrolled 0 "$HOSTNAME_T $(enrolled_ip)"
        exit 0
    fi

    say "tailscale up failed (exit $UP_RC)"
    # Probe again: tells "server unreachable from tailscale's side" from "reachable, but tailscale
    # itself failed". The key text never appears in `up` output, and clean() bounds the rest.
    probe "$SERVER"
    report up "$UP_RC" "$(echo "$UP_OUT" | tail -2 | tr '\n' ' ') | probe: ${PROBE_DETAIL:-reachable}"
    wait_and_retry || exit 1
done
