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

# The control lock makes start, stop and restart run one at a time, whichever launcher asked. It is a folder holding
# the owner's PID, that process's start time and what it is doing. A lock is live only while that exact process runs:
# the start time stops a PID that macOS reused after a crash from keeping an abandoned lock alive.
process_started_at() {
  local started
  started="$(/bin/ps -o lstart= -p "$1" 2>/dev/null)" || { REPLY=""; return 1; }
  REPLY="${(j: :)${=started}}"
  [[ -n "$REPLY" ]]
}

lock_is_live() {
  [[ -d "$LOCK_DIR" ]] || return 1
  local owner="" started=""
  [[ -f "$LOCK_DIR/pid" ]] && owner="$(<"$LOCK_DIR/pid")"
  if [[ "$owner" != <-> ]]; then
    # The owner is written a moment after the folder is made; only a folder left ownerless for seconds is stale.
    zmodload -F zsh/stat b:zstat; zmodload zsh/datetime
    local -a modified
    zstat -A modified +mtime "$LOCK_DIR" 2>/dev/null || return 1
    (( EPOCHSECONDS - modified[1] < 5 ))
    return
  fi
  kill -0 "$owner" 2>/dev/null || return 1
  [[ -f "$LOCK_DIR/started" ]] && started="$(<"$LOCK_DIR/started")"
  [[ -z "$started" ]] && return 0
  process_started_at "$owner" && [[ "$REPLY" == "$started" ]]
}

lock_action() {
  REPLY=""
  [[ -f "$LOCK_DIR/action" ]] && REPLY="$(<"$LOCK_DIR/action")"
  [[ "$REPLY" == (start|stop|restart) ]] || REPLY=""
}

remove_lock_folder() {
  rm -f "$LOCK_DIR/pid" "$LOCK_DIR/started" "$LOCK_DIR/action"
  rmdir "$LOCK_DIR" 2>/dev/null || true
}

# Only the process that took the lock releases it; every run calls this on exit, including status checks.
release_lock() {
  (( ${LOCK_HELD:-0} )) || return 0
  LOCK_HELD=0
  local owner=""
  [[ -f "$LOCK_DIR/pid" ]] && owner="$(<"$LOCK_DIR/pid")"
  [[ "$owner" == "$$" ]] && remove_lock_folder
  return 0
}

# Waits for another start or stop to finish (a cold start can take minutes) rather than running a second one beside it.
acquire_lock() {
  prepare_folders
  local action="${LOCK_ACTION:-start}" attempt waiting=0 attempts=$(( (START_TIMEOUT + 60) * 2 ))
  for ((attempt=1; attempt<=attempts; attempt++)); do
    if mkdir "$LOCK_DIR" 2>/dev/null; then
      print -r -- "$$" > "$LOCK_DIR/pid"
      process_started_at "$$" && print -r -- "$REPLY" > "$LOCK_DIR/started"
      print -r -- "$action" > "$LOCK_DIR/action"
      LOCK_HELD=1
      return 0
    fi
    if ! lock_is_live; then
      print -r -- "Cleared a lock left by an earlier start or stop that did not finish."
      remove_lock_folder
      continue
    fi
    if (( ! waiting )); then
      print -r -- "Public Desk is already being started or stopped; waiting for that to finish…"
      waiting=1
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

# Opening Public Desk again brings its existing tab forward instead of adding another. Safari and Chromium-based
# browsers that are already running are asked through AppleScript (macOS asks once for permission; if it is refused,
# a new tab opens as before). BROWSER_MARK_FILE holds a fingerprint of the token the open tab was given, so a tab
# from before a restart is reloaded with the new token rather than left signed out.
BROWSER_MARK_FILE="$RUNTIME_DIR/browser-tab"
PUBLIC_DESK_ORIGIN="http://127.0.0.1:4173"

token_fingerprint() {
  REPLY="$(print -rn -- "$PUBLIC_DESK_TOKEN" | /usr/bin/shasum -a 256)"
  REPLY="${REPLY%% *}"
}

browser_tab_script() {
  local app="$1" kind="$2" url="$3" navigate="" select
  [[ -n "$url" ]] && navigate="set URL of t to \"$url\""
  if [[ "$kind" == safari ]]; then select='set current tab of w to t'
  else select='set active tab index of w to i'
  fi
  REPLY="with timeout of 10 seconds
tell application \"$app\"
  repeat with w in windows
    set i to 0
    try
      repeat with t in tabs of w
        set i to i + 1
        if (URL of t as text) starts with \"$PUBLIC_DESK_ORIGIN\" then
          $navigate
          $select
          set index of w to 1
          activate
          return \"found\"
        end if
      end repeat
    end try
  end repeat
end tell
end timeout
return \"none\""
}

# The script goes to osascript on standard input, so the token never appears on a command line.
focus_existing_tab() {
  local url="$1" entry app kind
  local osascript="${PUBLIC_DESK_OSASCRIPT:-/usr/bin/osascript}" pgrep="${PUBLIC_DESK_PGREP:-/usr/bin/pgrep}"
  for entry in "Safari:safari" "Google Chrome:chromium" "Brave Browser:chromium" "Microsoft Edge:chromium" "Chromium:chromium"; do
    app="${entry%%:*}"; kind="${entry##*:}"
    "$pgrep" -xq "$app" 2>/dev/null || continue
    browser_tab_script "$app" "$kind" "$url"
    [[ "$(print -r -- "$REPLY" | "$osascript" - 2>/dev/null)" == found ]] && return 0
  done
  return 1
}

open_public_desk() {
  [[ -n "${PUBLIC_DESK_TOKEN:-}" ]] || load_token
  [[ -n "${PUBLIC_DESK_TOKEN:-}" ]] || { print -u2 -- "Public Desk does not have an access token. Restart it."; return 1; }
  local url="$PUBLIC_DESK_ORIGIN/#access=$PUBLIC_DESK_TOKEN" mark=""
  local reload_url="$url"
  token_fingerprint; local fingerprint="$REPLY"
  [[ -f "$BROWSER_MARK_FILE" ]] && mark="$(<"$BROWSER_MARK_FILE")"
  [[ "$mark" == "$fingerprint" ]] && reload_url=""
  if [[ "${PUBLIC_DESK_REUSE_TAB:-1}" == 1 ]] && focus_existing_tab "$reload_url"; then
    print -r -- "Brought the open Public Desk tab to the front."
  else
    "${PUBLIC_DESK_OPEN:-/usr/bin/open}" "$url" || return 1
  fi
  (umask 077; print -rn -- "$fingerprint" > "$BROWSER_MARK_FILE")
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
  rm -f "$TOKEN_FILE" "$BROWSER_MARK_FILE"
  print -r -- "Public Desk services are stopped."
  return $failed
}

stop_all() {
  acquire_lock || return 1
  load_token
  stop_all_unlocked
}

# Status only reads: it never takes the control lock, starts or stops anything, so it is safe to poll.
collect_status() {
  prepare_folders
  load_token
  typeset -gA STATUS_STATE=()
  STATUS_READY=0 STATUS_RUNNING=0
  local service
  for service in $SERVICES; do
    if owned_pid "$service"; then
      if service_is_ready "$service"; then STATUS_STATE[$service]=ready; ((STATUS_READY++))
      else STATUS_STATE[$service]=starting; ((STATUS_RUNNING++))
      fi
    else STATUS_STATE[$service]=stopped
    fi
  done
  if (( STATUS_READY == 5 )); then STATUS_OVERALL=ready
  elif (( STATUS_READY + STATUS_RUNNING == 0 )); then STATUS_OVERALL=stopped
  else STATUS_OVERALL=partial
  fi
  STATUS_ACTION=""
  if lock_is_live; then lock_action; STATUS_ACTION="${REPLY:-busy}"; fi
}

show_status() {
  [[ "${1:-}" == "--json" ]] && { show_status_json; return; }
  collect_status
  local service label
  for service in $SERVICES; do
    service_name "$service"; local name="$REPLY"
    case "$STATUS_STATE[$service]" in
      ready) label="Ready" ;;
      starting) label="Starting or unavailable" ;;
      *) label="Stopped" ;;
    esac
    print -r -- "$name: $label"
  done
  case "$STATUS_OVERALL" in
    ready) print -r -- "Overall: Ready" ;;
    stopped) print -r -- "Overall: Stopped" ;;
    *) print -r -- "Overall: Needs attention ($STATUS_READY of 5 ready)" ;;
  esac
  [[ -n "$STATUS_ACTION" ]] && print -r -- "In progress: $STATUS_ACTION"
  return 0
}

# One line of JSON for the menu-bar controller. Every value is a fixed word or count, so no escaping is needed.
show_status_json() {
  collect_status
  local service entries=()
  for service in $SERVICES; do
    service_name "$service"
    entries+=("{\"id\":\"$service\",\"name\":\"$REPLY\",\"state\":\"$STATUS_STATE[$service]\"}")
  done
  print -r -- "{\"overall\":\"$STATUS_OVERALL\",\"ready\":$STATUS_READY,\"action\":\"$STATUS_ACTION\",\"services\":[${(j:,:)entries}]}"
}

show_diagnostics() {
  show_status
  print -r -- "Logs: $LOG_DIR"
  if [[ "${1:-}" == "--open" ]]; then /usr/bin/open "$LOG_DIR" || return 1; fi
  return 0
}

usage() {
  print -r -- "Usage: ${0:t} start [--open] | open | stop | restart [--open] | status [--json] | diagnostics [--open]"
}

main() {
  local action="${1:-start}"
  shift 2>/dev/null || true
  case "$action" in
    start) start_all "${1:-}" ;;
    open) prepare_folders; load_token; all_services_ready || { print -u2 -- "Public Desk is not ready."; return 1; }; open_public_desk ;;
    stop) LOCK_ACTION=stop stop_all ;;
    restart)
      LOCK_ACTION=restart
      stop_all || return 1
      release_lock
      start_all "${1:-}"
      ;;
    status) show_status "${1:-}" ;;
    diagnostics) show_diagnostics "${1:-}" ;;
    *) usage; return 2 ;;
  esac
}

# Tests source this file to call single functions; only a direct run performs an action.
# The traps are set here, outside any function: zsh runs an EXIT trap set inside a function as soon as that function
# returns, which would drop the lock the moment it was taken. Interrupting a start or stop releases the lock and exits.
if [[ "$ZSH_EVAL_CONTEXT" == toplevel ]]; then
  trap release_lock EXIT
  trap 'release_lock; exit 130' INT
  trap 'release_lock; exit 143' TERM
  main "$@"
fi
