#!/usr/bin/env bash
# Install or redeploy Stemcraft as two systemd user units that start at boot (§10, D9-09).
# Idempotent: re-running it IS the deploy. `git pull && ops/install.sh` deploys;
# `git checkout <previous> && ops/install.sh` rolls back.
#
#   ops/install.sh             do it
#   ops/install.sh --dry-run   print every step, change nothing
#
# `systemctl --user` needs a login session (ssh is fine; cron or `sudo -u` is not).
#
# Env: STEMCRAFT_UNIT_DIR (default ~/.config/systemd/user), STEMCRAFT_PORT (default 8000),
#      STEMCRAFT_HEALTH_TIMEOUT (seconds to wait for the API, default 60).
set -euo pipefail

usage() {
  cat <<USAGE
usage: ops/install.sh [--dry-run]
  --dry-run   print every step, change nothing
  -h, --help  show this help
USAGE
}

DRY=0
case "${1:-}" in
  "") ;;
  --dry-run) DRY=1 ;;
  -h|--help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac
if (( $# > 1 )); then usage >&2; exit 2; fi

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_DIR="${STEMCRAFT_UNIT_DIR:-$HOME/.config/systemd/user}"
PORT="${STEMCRAFT_PORT:-8000}"
HEALTH_TIMEOUT="${STEMCRAFT_HEALTH_TIMEOUT:-60}"
# Despite the name, STEMCRAFT_WORKER_SETTLE is the settle window for BOTH units.
WORKER_SETTLE="${STEMCRAFT_WORKER_SETTLE:-30}"
UNITS=(stemcraft-api.service stemcraft-worker.service)
ME="$(id -un)"
tmp=""

run() {
  echo "+ $*"
  if (( ! DRY )); then "$@"; fi
}

die() {
  echo "install.sh: $*" >&2
  exit 1
}

cleanup() { if [[ -n "$tmp" ]]; then rm -f "$tmp"; fi; }
trap cleanup EXIT

[[ "$PORT" =~ ^[0-9]+$ ]] && (( 10#$PORT >= 1 && 10#$PORT <= 65535 )) \
  || die "STEMCRAFT_PORT must be an integer 1-65535, got: $PORT"
PORT=$(( 10#$PORT ))

# N-08: refuse before touching anything if a dependency is missing.
declare -A BIN
for tool in uv npm ffmpeg ffprobe yt-dlp systemctl loginctl curl; do
  BIN[$tool]="$(command -v "$tool")" || die "missing dependency: $tool is not on PATH"
done

# D9-06: the units get an explicit PATH -- at boot there is no login session to inherit it.
unit_path=""
for tool in uv ffmpeg ffprobe yt-dlp; do
  dir="$(dirname "${BIN[$tool]}")"
  case ":$unit_path:" in *":$dir:"*) ;; *) unit_path="${unit_path:+$unit_path:}$dir" ;; esac
done
unit_path="$unit_path:/usr/local/bin:/usr/bin:/bin"

# These land in unit files (and a sed script): keep them to characters that are safe in both.
for pair in "REPO=$REPO" "uv=${BIN[uv]}" "PATH=$unit_path"; do
  [[ "${pair#*=}" =~ ^[A-Za-z0-9._/+:-]+$ ]] \
    || die "unsafe character in ${pair%%=*} for a systemd unit (allowed: A-Za-z0-9._/+:-): ${pair#*=}"
done

# D9-10: lingering lets the user manager start these at boot and keep them after logout.
# Decided up front so a doomed run (no sudo) does nothing.
NEED_LINGER=0
if [[ "$(loginctl show-user "$ME" -p Linger --value 2>/dev/null || true)" != "yes" ]]; then
  NEED_LINGER=1
  command -v sudo > /dev/null || die "lingering is off for $ME and sudo is not available to enable it"
fi

cd "$REPO"
run uv sync --locked
run npm --prefix "$REPO/frontend" ci
run npm --prefix "$REPO/frontend" run build

for unit in "${UNITS[@]}"; do
  echo "+ render ops/systemd/$unit -> $UNIT_DIR/$unit"
  if (( ! DRY )); then
    mkdir -p "$UNIT_DIR"
    tmp="$(mktemp "$UNIT_DIR/.$unit.XXXXXX")"
    sed -e "s|@REPO@|$REPO|g" -e "s|@UV@|${BIN[uv]}|g" -e "s|@PATH@|$unit_path|g" \
      -e "s|@PORT@|$PORT|g" "$REPO/ops/systemd/$unit" > "$tmp"
    mv "$tmp" "$UNIT_DIR/$unit"  # atomic: temp file then rename
    tmp=""
  fi
done

run systemctl --user daemon-reload
run systemctl --user enable "${UNITS[@]}"

if (( NEED_LINGER )); then
  echo "Lingering is off for $ME; enabling it needs sudo so the units start at boot."
  run sudo loginctl enable-linger "$ME"
fi

run systemctl --user reset-failed "${UNITS[@]}"  # a deploy right after a start-limit-hit must start
run systemctl --user restart "${UNITS[@]}"

declare -A BASELINE
for unit in "${UNITS[@]}"; do
  n=0
  if (( ! DRY )); then n="$(systemctl --user show -p NRestarts --value "$unit" 2>/dev/null || echo 0)"; fi
  [[ "$n" =~ ^[0-9]+$ ]] || n=0
  BASELINE[$unit]=$n
done

if (( DRY )); then
  echo "+ wait for http://127.0.0.1:$PORT/api/health"
  echo "+ watch ${UNITS[*]} for ${WORKER_SETTLE}s (each active, no restarts)"
  exit 0
fi

fail_with_journal() {  # $1 unit, $2 message
  journalctl --user -u "$1" -n 50 --no-pager || true
  die "$2"
}

up=0
for (( i = 0; i < HEALTH_TIMEOUT; i++ )); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/api/health" > /dev/null 2>&1; then
    up=1
    break
  fi
  sleep 1
done
(( up )) || fail_with_journal stemcraft-api.service "the API did not answer on port $PORT within ${HEALTH_TIMEOUT}s"

# Both units are Type=simple, so `restart` returns at fork. The health poll above only proves
# SOMETHING answers on the port (a stray dev server would do), and /api/health cannot prove the
# worker is fresh (worker_status persists across restarts). So this is a heuristic: each unit
# must stay active with no auto-restarts beyond the NRestarts baseline read right after
# `restart`, for a settle window (STEMCRAFT_WORKER_SETTLE, which covers both units). A unit that
# dies (address in use, failed boot check) leaves "active" or bumps NRestarts (Restart=on-failure).
for (( i = 0; i <= WORKER_SETTLE; i++ )); do
  for unit in "${UNITS[@]}"; do
    systemctl --user is-active --quiet "$unit" \
      || fail_with_journal "$unit" "$unit is not running"
    restarts="$(systemctl --user show -p NRestarts --value "$unit")"
    [[ "${restarts:-0}" =~ ^[0-9]+$ ]] || restarts=0
    (( restarts <= ${BASELINE[$unit]} )) \
      || fail_with_journal "$unit" "$unit restarted $(( restarts - ${BASELINE[$unit]} )) time(s) after install"
  done
  if (( i < WORKER_SETTLE )); then sleep 1; fi
done
echo "Stemcraft is up on http://$(uname -n):$PORT"
