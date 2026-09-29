#!/usr/bin/env bash
# Install or redeploy Stemcraft as two systemd user units that start at boot (§10, D9-09).
# Idempotent: re-running it IS the deploy. `git pull && ops/install.sh` deploys;
# `git checkout <previous> && ops/install.sh` rolls back.
#
#   ops/install.sh             do it
#   ops/install.sh --dry-run   print every step, change nothing
#
# Env: STEMCRAFT_UNIT_DIR (default ~/.config/systemd/user), STEMCRAFT_PORT (default 8000),
#      STEMCRAFT_HEALTH_TIMEOUT (seconds to wait for the API, default 60).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_DIR="${STEMCRAFT_UNIT_DIR:-$HOME/.config/systemd/user}"
PORT="${STEMCRAFT_PORT:-8000}"
HEALTH_TIMEOUT="${STEMCRAFT_HEALTH_TIMEOUT:-60}"
UNITS=(stemcraft-api.service stemcraft-worker.service)
DRY=0
[[ "${1:-}" == "--dry-run" ]] && DRY=1

run() {
  echo "+ $*"
  if (( ! DRY )); then "$@"; fi
}

die() {
  echo "install.sh: $*" >&2
  exit 1
}

# N-08: refuse before touching anything if a dependency is missing.
declare -A BIN
for tool in uv npm ffmpeg yt-dlp systemctl loginctl curl; do
  BIN[$tool]="$(command -v "$tool")" || die "missing dependency: $tool is not on PATH"
done

# D9-06: the units get an explicit PATH -- at boot there is no login session to inherit it.
unit_path=""
for tool in uv ffmpeg yt-dlp; do
  dir="$(dirname "${BIN[$tool]}")"
  case ":$unit_path:" in *":$dir:"*) ;; *) unit_path="${unit_path:+$unit_path:}$dir" ;; esac
done
unit_path="$unit_path:/usr/local/bin:/usr/bin:/bin"

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
      "$REPO/ops/systemd/$unit" > "$tmp"
    mv "$tmp" "$UNIT_DIR/$unit"  # atomic: temp file then rename
  fi
done

run systemctl --user daemon-reload
run systemctl --user enable "${UNITS[@]}"

# D9-10: lingering lets the user manager start these at boot and keep them after logout.
if [[ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || true)" != "yes" ]]; then
  echo "Lingering is off for $USER; enabling it needs sudo so the units start at boot."
  run sudo loginctl enable-linger "$USER"
fi

run systemctl --user restart "${UNITS[@]}"

if (( DRY )); then
  echo "+ wait for http://127.0.0.1:$PORT/api/health"
  exit 0
fi

for (( i = 0; i < HEALTH_TIMEOUT; i++ )); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" > /dev/null 2>&1; then
    systemctl --user is-active --quiet stemcraft-worker.service \
      || { journalctl --user -u stemcraft-worker.service -n 50 --no-pager; die "the worker is not running"; }
    echo "Stemcraft is up on http://$(hostname):$PORT"
    exit 0
  fi
  sleep 1
done
journalctl --user -u stemcraft-api.service -n 50 --no-pager
die "the API did not answer on port $PORT within ${HEALTH_TIMEOUT}s"
