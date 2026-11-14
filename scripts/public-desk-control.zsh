#!/bin/zsh
set -u

# One controller for Public Desk's five local services. The Finder launchers are deliberately thin wrappers around
# this file so start, stop, status, repair and future menu-bar controls all use the same ownership and readiness rules.

APP_DIR="${0:A:h:h}"
MANAGED_OSINT_ROOT="$APP_DIR/work/dependencies/osint-mcp"
OSINT_ROOT="${PUBLIC_DESK_OSINT_ROOT:-$MANAGED_OSINT_ROOT}"
RUNTIME_DIR="$APP_DIR/work/runtime"
LOG_DIR="$APP_DIR/work/logs"
TOKEN_FILE="$RUNTIME_DIR/public-desk-token"
LOCK_DIR="$RUNTIME_DIR/control.lock"
START_TIMEOUT="${PUBLIC_DESK_START_TIMEOUT:-180}"
STOP_TIMEOUT="${PUBLIC_DESK_STOP_TIMEOUT:-8}"

source "$APP_DIR/scripts/service-ownership.zsh"

typeset -a SERVICES=(headless mcp osint-toolbox omega signaldesk)
typeset -a STOP_ORDER=(signaldesk omega osint-toolbox mcp headless)

service_name() {
  case "$1" in
    signaldesk) REPLY="Public Desk" ;;
    omega) REPLY="Omega tools" ;;
    osint-toolbox) REPLY="OSINT Toolbox" ;;
    mcp) REPLY="Open OSINT tools" ;;
    headless) REPLY="Open OSINT data" ;;
  esac
}

service_port() {
  case "$1" in
    signaldesk) REPLY=4173 ;;
    headless) REPLY=8080 ;;
    mcp) REPLY=8892 ;;
    osint-toolbox) REPLY=8893 ;;
    omega) REPLY=8894 ;;
  esac
}

expected_identity() {
  case "$1" in
    signaldesk) REPLY=("$APP_DIR" "server.mjs") ;;
    omega) REPLY=("$APP_DIR" "$APP_DIR/config/omega-mcp.json") ;;
    osint-toolbox) REPLY=("$APP_DIR" "$APP_DIR/config/osint-toolbox-mcp.json") ;;
    mcp) REPLY=("$OSINT_ROOT/mcp" "$APP_DIR/scripts/run-osint-mcp-guarded.py") ;;
    headless) REPLY=("$OSINT_ROOT/server" "$APP_DIR/scripts/live-api-keys.mjs") ;;
  esac
}

prepare_folders() {
  mkdir -p "$RUNTIME_DIR" "$LOG_DIR"
  chmod 700 "$APP_DIR/work" "$RUNTIME_DIR" "$LOG_DIR"
}

release_lock() {
  [[ -d "$LOCK_DIR" ]] || return 0
  local owner=""
  [[ -f "$LOCK_DIR/pid" ]] && owner="$(<"$LOCK_DIR/pid")"
  [[ -n "$owner" && "$owner" != "$$" ]] && return 0
  rm -f "$LOCK_DIR/pid"
  rmdir "$LOCK_DIR" 2>/dev/null || true
}

acquire_lock() {
  prepare_folders
  local attempt owner
  for attempt in {1..120}; do
    if mkdir "$LOCK_DIR" 2>/dev/null; then
      print -r -- "$$" > "$LOCK_DIR/pid"
      trap release_lock EXIT INT TERM
      return 0
    fi
    owner=""
    [[ -f "$LOCK_DIR/pid" ]] && owner="$(<"$LOCK_DIR/pid")"
    if [[ "$owner" != <-> ]] || ! kill -0 "$owner" 2>/dev/null; then
      rm -f "$LOCK_DIR/pid"
      rmdir "$LOCK_DIR" 2>/dev/null || true
      continue
    fi
    sleep 0.5
  done
  print -u2 -- "Public Desk is already being started or stopped. Try again in a moment."
  return 1
}

owned_pid() {
  local service="$1" pid_file="$RUNTIME_DIR/$service.pid" pid=""
  if [[ -f "$pid_file" ]]; then
    pid="$(<"$pid_file")"
    if [[ "$pid" == <-> ]] && kill -0 "$pid" 2>/dev/null; then
      expected_identity "$service"
      process_belongs_to_service "$pid" "$REPLY[1]" "$REPLY[2]" || return 1
      REPLY="$pid"
      return 0
    fi
    rm -f "$pid_file"
  fi
  service_port "$service"
  pid="$(listener_pid "$REPLY")"
  [[ -n "$pid" ]] || return 1
  expected_identity "$service"
  process_belongs_to_service "$pid" "$REPLY[1]" "$REPLY[2]" || return 1
  REPLY="$pid"
}

any_owned_service_running() {
  local service
  for service in $SERVICES; do owned_pid "$service" && return 0; done
  return 1
}

load_token() {
  PUBLIC_DESK_TOKEN=""
  [[ -s "$TOKEN_FILE" ]] && IFS= read -r PUBLIC_DESK_TOKEN < "$TOKEN_FILE"
  export PUBLIC_DESK_TOKEN
}

new_token() {
  PUBLIC_DESK_TOKEN="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')"
  (umask 077; print -rn -- "$PUBLIC_DESK_TOKEN" > "$TOKEN_FILE")
  chmod 600 "$TOKEN_FILE"
  export PUBLIC_DESK_TOKEN
}

is_ready() {
  /usr/bin/curl -fsS --max-time 2 "$1" >/dev/null 2>&1
}

# The token goes to curl on standard input, never its command line, where other programs could read it.
service_ready() {
  [[ -n "${PUBLIC_DESK_TOKEN:-}" ]] || return 1
  print -r -- "Authorization: Bearer $PUBLIC_DESK_TOKEN" | /usr/bin/curl -fsS --max-time 2 -H @- "$1" >/dev/null 2>&1
}

mcp_ready() {
  [[ -n "${PUBLIC_DESK_TOKEN:-}" ]] || return 1
  print -r -- "Authorization: Bearer $PUBLIC_DESK_TOKEN" | /usr/bin/curl -fsS --max-time 2 -X POST "$1" \
    -H @- -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
    --data '{"jsonrpc":"2.0","id":"startup","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"Public Desk Launcher","version":"1.0"}}}' \
    >/dev/null 2>&1
}

service_is_ready() {
  case "$1" in
    signaldesk) is_ready "http://127.0.0.1:4173" ;;
    headless) service_ready "http://127.0.0.1:8080/health" ;;
    mcp) mcp_ready "http://127.0.0.1:8892/mcp" ;;
    osint-toolbox) mcp_ready "http://127.0.0.1:8893/mcp" ;;
    omega) mcp_ready "http://127.0.0.1:8894/mcp" ;;
  esac
}

all_services_ready() {
  local service
  for service in $SERVICES; do
    owned_pid "$service" || return 1
    service_is_ready "$service" || return 1
  done
}

wait_for_service() {
  local service="$1" attempts=$((START_TIMEOUT * 2)) attempt
  service_name "$service"
  local name="$REPLY"
  for ((attempt=1; attempt<=attempts; attempt++)); do
    service_is_ready "$service" && return 0
    sleep 0.5
  done
  print -u2 -- "$name did not become ready."
  print -u2 -- "Diagnostics: $LOG_DIR/$service.log"
  return 1
}

check_port() {
  local service="$1"
  service_name "$service"; local name="$REPLY"
  service_port "$service"; local port="$REPLY"
  expected_identity "$service"
  refuse_foreign_listener "$name" "$port" "$REPLY[1]" "$REPLY[2]"
}

start_headless() {
  check_port headless || return 1
  service_is_ready headless && return 0
  service_port headless
  if [[ -n "$(listener_pid "$REPLY")" ]]; then
    print -r -- "Open OSINT data is not responding; restarting its verified process."
    stop_service headless || return 1
  fi
  if [[ -z "$(listener_pid 8080)" ]]; then
    source "$APP_DIR/scripts/apply-open-osint-patches.zsh"
    apply_open_osint_patches "$OSINT_ROOT" "$APP_DIR/patches"
    local keys="$APP_DIR/work/api-keys.env"
    if [[ ! -e "$keys" ]]; then
      (umask 077; cp "$APP_DIR/config/api-keys.env.example" "$keys")
    fi
    (
      cd "$OSINT_ROOT/server"
      PUBLIC_DESK_API_KEYS_FILE="$keys" /usr/bin/nohup node --import tsx --import "$APP_DIR/scripts/live-api-keys.mjs" \
        --import "$APP_DIR/scripts/bind-loopback.mjs" --import "$APP_DIR/scripts/default-user-agent.mjs" \
        --import "$APP_DIR/scripts/intelx-host.mjs" --import "$APP_DIR/scripts/abuse-ch-auth.mjs" \
        --import "$APP_DIR/scripts/require-loopback-token.mjs" \
        server.mjs >"$LOG_DIR/headless.log" 2>&1 </dev/null &!
      echo $! >"$RUNTIME_DIR/headless.pid"
    )
  fi
  wait_for_service headless
}

start_mcp() {
  check_port mcp || return 1
  service_is_ready mcp && return 0
  service_port mcp
  if [[ -n "$(listener_pid "$REPLY")" ]]; then
    print -r -- "Open OSINT tools are not responding; restarting their verified process."
    stop_service mcp || return 1
  fi
  if [[ -z "$(listener_pid 8892)" ]]; then
    (
      cd "$OSINT_ROOT/mcp"
      OSINT_MCP_API_KEY="$PUBLIC_DESK_TOKEN" HEADLESS_BASE_URL="http://127.0.0.1:8080" \
        PYTHONPATH="$OSINT_ROOT/mcp/src" /usr/bin/nohup "$UV_BIN" run python "$APP_DIR/scripts/run-osint-mcp-guarded.py" \
        --transport http --host 127.0.0.1 --port 8892 >"$LOG_DIR/mcp.log" 2>&1 </dev/null &!
      echo $! >"$RUNTIME_DIR/mcp.pid"
    )
  fi
  wait_for_service mcp
}

start_bridge() {
  local service="$1" config="$APP_DIR/config/$1-mcp.json"
  check_port "$service" || return 1
  service_is_ready "$service" && return 0
  service_port "$service"; local port="$REPLY"
  if [[ -n "$(listener_pid "$port")" ]]; then
    service_name "$service"
    print -r -- "$REPLY is not responding; restarting its verified process."
    stop_service "$service" || return 1
  fi
  if [[ -z "$(listener_pid "$port")" ]]; then
    (
      cd "$APP_DIR"
      FASTMCP_HTTP_HOST_ORIGIN_PROTECTION=true /usr/bin/nohup "$UVX_BIN" --from 'fastmcp-slim[server]==4.1.8' \
        python "$APP_DIR/scripts/run-fastmcp-bridge-authenticated.py" run "$config" --transport http \
        --host 127.0.0.1 --port "$port" --path /mcp --no-banner >"$LOG_DIR/$service.log" 2>&1 </dev/null &!
      echo $! >"$RUNTIME_DIR/$service.pid"
    )
  fi
  wait_for_service "$service"
}

start_signaldesk() {
  check_port signaldesk || return 1
  service_is_ready signaldesk && return 0
  service_port signaldesk
  if [[ -n "$(listener_pid "$REPLY")" ]]; then
    print -r -- "Public Desk is not responding; restarting its verified process."
    stop_service signaldesk || return 1
  fi
  if [[ -z "$(listener_pid 4173)" ]]; then
    (
      cd "$APP_DIR"
      /usr/bin/nohup node server.mjs >"$LOG_DIR/signaldesk.log" 2>&1 </dev/null &!
      echo $! >"$RUNTIME_DIR/signaldesk.pid"
    )
  fi
  wait_for_service signaldesk
}

find_uv() {
  # --- find uv ---
  path=("$HOME/.local/bin" $path /opt/homebrew/bin /usr/local/bin)
  UV_BIN="$(command -v uv || true)"
  UVX_BIN="$(command -v uvx || true)"
  if [[ -z "$UV_BIN" || -z "$UVX_BIN" ]]; then
    print -u2 -- "uv is not installed, so the tool services cannot start."
    print -u2 -- "Install uv (https://docs.astral.sh/uv/), then run: npm run setup"
    return 1
  fi
  # --- end find uv ---
}

check_dependencies() {
  if [[ ! -d "$OSINT_ROOT/server/node_modules" || ! -x "$OSINT_ROOT/mcp/.venv/bin/osint-mcp" ]]; then
    print -u2 -- "Public Desk dependencies are missing."
    print -u2 -- "Run: npm run setup"
    return 1
  fi
  find_uv
}

open_public_desk() {
  [[ -n "${PUBLIC_DESK_TOKEN:-}" ]] || load_token
  [[ -n "${PUBLIC_DESK_TOKEN:-}" ]] || { print -u2 -- "Public Desk does not have an access token. Restart it."; return 1; }
  /usr/bin/open "http://127.0.0.1:4173/#access=$PUBLIC_DESK_TOKEN"
}

start_all() {
  acquire_lock || return 1
  check_dependencies || return 1
  load_token
  if any_owned_service_running && [[ -z "$PUBLIC_DESK_TOKEN" ]]; then
    print -u2 -- "The previous session lost its access token. Restarting it safely…"
    stop_all_unlocked || return 1
  fi
  [[ -n "$PUBLIC_DESK_TOKEN" ]] || new_token

  if all_services_ready; then
    print -r -- "Public Desk is already ready."
  else
    local completed=0 service
    for service in $SERVICES; do
      service_name "$service"
      print -r -- "Starting $REPLY…"
      case "$service" in
        headless) start_headless || return 1 ;;
        mcp) start_mcp || return 1 ;;
        osint-toolbox|omega) start_bridge "$service" || return 1 ;;
        signaldesk) start_signaldesk || return 1 ;;
      esac
      ((completed++))
      service_name "$service"
      print -r -- "[$completed/5] $REPLY is ready."
    done
    all_services_ready || { print -u2 -- "Public Desk did not finish starting. Diagnostics: $LOG_DIR"; return 1; }
    print -r -- "Public Desk is ready."
  fi
  if [[ "${1:-}" == "--open" ]]; then open_public_desk || return 1; fi
  return 0
}

stop_service() {
  local service="$1" pid_file="$RUNTIME_DIR/$service.pid" pid="" attempt
  if [[ -f "$pid_file" ]]; then
    pid="$(<"$pid_file")"
    if [[ "$pid" == <-> ]] && kill -0 "$pid" 2>/dev/null; then
      expected_identity "$service"
      if ! process_belongs_to_service "$pid" "$REPLY[1]" "$REPLY[2]"; then
        print -u2 -- "Did not stop PID $pid for $service because it does not belong to this Public Desk folder."
        return 1
      fi
    else
      rm -f "$pid_file"
      pid=""
    fi
  fi
  if [[ -z "$pid" ]]; then
    service_port "$service"; pid="$(listener_pid "$REPLY")"
    if [[ -n "$pid" ]]; then
      expected_identity "$service"
      process_belongs_to_service "$pid" "$REPLY[1]" "$REPLY[2]" || return 1
    fi
  fi
  [[ -n "$pid" ]] || return 0
  kill "$pid" 2>/dev/null || true
  expected_identity "$service"
  local expected_cwd="$REPLY[1]" expected_marker="$REPLY[2]"
  for ((attempt=1; attempt<=STOP_TIMEOUT*5; attempt++)); do
    process_belongs_to_service "$pid" "$expected_cwd" "$expected_marker" || break
    sleep 0.2
  done
  if process_belongs_to_service "$pid" "$expected_cwd" "$expected_marker"; then
    print -r -- "$service did not stop gracefully; force-stopping its verified process."
    kill -KILL "$pid" 2>/dev/null || true
    for _ in {1..15}; do
      process_belongs_to_service "$pid" "$expected_cwd" "$expected_marker" || break
      sleep 0.2
    done
  fi
  if process_belongs_to_service "$pid" "$expected_cwd" "$expected_marker"; then
    print -u2 -- "Could not stop $service."
    return 1
  fi
  rm -f "$pid_file"
  print -r -- "Stopped $service."
}

stop_all_unlocked() {
  local failed=0 service
  for service in $STOP_ORDER; do stop_service "$service" || failed=1; done
  if any_owned_service_running; then
    print -u2 -- "Some Public Desk services are still running. The access token was kept."
    return 1
  fi
  rm -f "$TOKEN_FILE"
  print -r -- "Public Desk services are stopped."
  return $failed
}

stop_all() {
  acquire_lock || return 1
  load_token
  stop_all_unlocked
}

show_status() {
  prepare_folders
  load_token
  local ready=0 running=0 service state
  for service in $SERVICES; do
    service_name "$service"; local name="$REPLY"
    if owned_pid "$service"; then
      if service_is_ready "$service"; then state="Ready"; ((ready++))
      else state="Starting or unavailable"; ((running++))
      fi
    else state="Stopped"
    fi
    print -r -- "$name: $state"
  done
  if (( ready == 5 )); then print -r -- "Overall: Ready"
  elif (( ready + running == 0 )); then print -r -- "Overall: Stopped"
  else print -r -- "Overall: Needs attention ($ready of 5 ready)"
  fi
}

show_diagnostics() {
  show_status
  print -r -- "Logs: $LOG_DIR"
  if [[ "${1:-}" == "--open" ]]; then /usr/bin/open "$LOG_DIR" || return 1; fi
  return 0
}

usage() {
  print -r -- "Usage: ${0:t} start [--open] | open | stop | restart [--open] | status | diagnostics [--open]"
}

main() {
  local action="${1:-start}"
  shift 2>/dev/null || true
  case "$action" in
    start) start_all "${1:-}" ;;
    open) prepare_folders; load_token; all_services_ready || { print -u2 -- "Public Desk is not ready."; return 1; }; open_public_desk ;;
    stop) stop_all ;;
    restart)
      stop_all || return 1
      release_lock
      trap - EXIT INT TERM
      start_all "${1:-}"
      ;;
    status) show_status ;;
    diagnostics) show_diagnostics "${1:-}" ;;
    *) usage; return 2 ;;
  esac
}

main "$@"
