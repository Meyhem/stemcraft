#!/usr/bin/env bash
# Start/stop the local dev stack: worker, API (8000), Vite (5173).
# Usage: scripts/dev.sh up|down
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RUN_DIR="$ROOT/.logs/dev"
API_PORT=8000
WEB_PORT=5173
SERVICES=(worker api frontend)

log() { printf '[dev] %s\n' "$*"; }
die() { printf '[dev] ERROR: %s\n' "$*" >&2; exit 1; }

check_deps() {
  local missing=()
  for bin in uv node npm ffmpeg yt-dlp lsof ss; do
    command -v "$bin" >/dev/null 2>&1 || missing+=("$bin")
  done
  if ((${#missing[@]})); then
    die "missing on PATH: ${missing[*]} (yt-dlp: 'uv tool install yt-dlp')"
  fi
  log "installing python deps (uv sync)"
  uv sync
  if [[ ! -d frontend/node_modules || frontend/package-lock.json -nt frontend/node_modules ]]; then
    log "installing frontend deps (npm install)"
    npm --prefix frontend install
    touch frontend/node_modules
  fi
}

stop_service() {
  local name=$1 pidfile="$RUN_DIR/$1.pid" pid
  [[ -f $pidfile ]] || return 0
  pid=$(<"$pidfile")
  if kill -0 "$pid" 2>/dev/null; then
    log "stopping $name (pgid $pid)"
    kill -TERM -- "-$pid" 2>/dev/null || true
    for _ in {1..50}; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.1
    done
    kill -KILL -- "-$pid" 2>/dev/null || true
  fi
  rm -f "$pidfile"
}

# A process is ours if it runs from inside this checkout (API, Vite and their children do).
is_ours() {
  local cwd
  cwd=$(readlink "/proc/$1/cwd" 2>/dev/null) || return 1
  [[ $cwd == "$ROOT" || $cwd == "$ROOT"/* ]]
}

# Fail fast, before touching anything, if a foreign process holds one of our ports.
check_ports() {
  local port pid pids
  for port in "$API_PORT" "$WEB_PORT"; do
    pids=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
    if [[ -z $pids ]]; then
      # lsof can't see other users' (or containers') sockets; ss still shows the listener.
      [[ -z $(ss -ltnH "sport = :$port" 2>/dev/null) ]] \
        || die "port $port is in use by a process we can't inspect (another user or a container); not touching it"
      continue
    fi
    for pid in $pids; do
      is_ours "$pid" \
        || die "port $port is held by someone else's process (pid $pid: $(ps -o args= -p "$pid" | cut -c1-100)); not touching it"
    done
  done
}

# Reap leftovers of our own stack (e.g. after a lost pidfile); check_ports vetted them.
free_port() {
  local port=$1 pids
  pids=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
  [[ -z $pids ]] && return 0
  log "port $port held by our own stale process (pid(s): $(echo $pids)); restarting it"
  kill -TERM $pids 2>/dev/null || true
  sleep 1
  pids=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
  [[ -n $pids ]] && kill -KILL $pids 2>/dev/null || true
  sleep 0.5
  [[ -z $(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true) ]] || die "could not free port $port"
}

start_service() {
  local name=$1; shift
  # setsid gives each service its own process group so `down` can kill the whole tree.
  setsid "$@" >"$RUN_DIR/$name.log" 2>&1 < /dev/null &
  echo $! >"$RUN_DIR/$name.pid"
  log "started $name (pid $!, log .logs/dev/$name.log)"
}

up() {
  check_deps
  mkdir -p "$RUN_DIR"
  check_ports
  down_quiet
  free_port "$API_PORT"
  free_port "$WEB_PORT"

  start_service worker   uv run stemcraft-worker
  start_service api      uv run uvicorn stemcraft_api.app:create_app --factory --reload --host 0.0.0.0 --port "$API_PORT"
  start_service frontend npm --prefix frontend run dev

  sleep 3
  for name in "${SERVICES[@]}"; do
    kill -0 "$(<"$RUN_DIR/$name.pid")" 2>/dev/null \
      || { tail -n 20 "$RUN_DIR/$name.log" >&2; die "$name exited on startup (see .logs/dev/$name.log)"; }
  done
  log "up: http://localhost:$WEB_PORT  (api :$API_PORT). Stop with: scripts/dev.sh down"
}

down_quiet() {
  for name in "${SERVICES[@]}"; do stop_service "$name"; done
}

down() {
  down_quiet
  log "down"
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  *) echo "usage: $0 up|down" >&2; exit 2 ;;
esac
