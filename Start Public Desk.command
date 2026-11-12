#!/bin/zsh
set -u

APP_DIR="${0:A:h}"
source "$APP_DIR/config/open-osint.env"
MANAGED_OSINT_ROOT="$APP_DIR/work/dependencies/osint-mcp"
LEGACY_OSINT_ROOT="${APP_DIR:h}/omprehensive-osint-toolboxes-osint-mcp-by/downloads/osint-mcp"
OSINT_ROOT="${PUBLIC_DESK_OSINT_ROOT:-$MANAGED_OSINT_ROOT}"
[[ -d "$OSINT_ROOT/.git" ]] || OSINT_ROOT="$LEGACY_OSINT_ROOT"
RUNTIME_DIR="$APP_DIR/work/runtime"
LOG_DIR="$APP_DIR/work/logs"
TOKEN_FILE="$RUNTIME_DIR/public-desk-token"

source "$APP_DIR/scripts/service-ownership.zsh"

mkdir -p "$RUNTIME_DIR" "$LOG_DIR"
chmod 700 "$APP_DIR/work" "$RUNTIME_DIR" "$LOG_DIR"

expected_identity() {
  case "$1" in
    signaldesk) REPLY=("$APP_DIR" "server.mjs") ;;
    omega) REPLY=("$APP_DIR" "$APP_DIR/config/omega-mcp.json") ;;
    osint-toolbox) REPLY=("$APP_DIR" "$APP_DIR/config/osint-toolbox-mcp.json") ;;
    mcp) REPLY=("$OSINT_ROOT/mcp" "$APP_DIR/scripts/run-osint-mcp-guarded.py") ;;
    headless) REPLY=("$OSINT_ROOT/server" "$APP_DIR/scripts/live-api-keys.mjs") ;;
  esac
}

cohort_is_running=false
for service in signaldesk omega osint-toolbox mcp headless; do
  pid_file="$RUNTIME_DIR/$service.pid"
  [[ -f "$pid_file" ]] || continue
  pid="$(<"$pid_file")"
  if [[ "$pid" == <-> ]] && kill -0 "$pid" 2>/dev/null; then
    expected_identity "$service"
    if process_belongs_to_service "$pid" "$REPLY[1]" "$REPLY[2]"; then
      cohort_is_running=true
      break
    fi
  fi
done

if [[ "$cohort_is_running" == true && -s "$TOKEN_FILE" ]]; then
  IFS= read -r PUBLIC_DESK_TOKEN < "$TOKEN_FILE"
else
  PUBLIC_DESK_TOKEN="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')"
  (umask 077; print -rn -- "$PUBLIC_DESK_TOKEN" > "$TOKEN_FILE")
fi
chmod 600 "$TOKEN_FILE"
export PUBLIC_DESK_TOKEN

if [[ ! -d "$OSINT_ROOT/server/node_modules" || ! -x "$OSINT_ROOT/mcp/.venv/bin/osint-mcp" ]]; then
  echo "Public Desk dependencies are missing."
  echo "Run: npm run setup"
  read -k 1 "?Press any key to close."
  exit 1
fi

is_ready() {
  /usr/bin/curl -fsS --max-time 2 "$1" >/dev/null 2>&1
}

service_ready() {
  /usr/bin/curl -fsS --max-time 2 -H "Authorization: Bearer $PUBLIC_DESK_TOKEN" "$1" >/dev/null 2>&1
}

# MCP endpoints reject plain GET requests (HTTP 400), so a bridge only counts as running
# when it answers an MCP initialize request.
mcp_ready() {
  /usr/bin/curl -fsS --max-time 2 -X POST "$1" \
    -H "Authorization: Bearer $PUBLIC_DESK_TOKEN" \
    -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
    --data '{"jsonrpc":"2.0","id":"startup","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"Public Desk Launcher","version":"1.0"}}}' \
    >/dev/null 2>&1
}

start_bridge() {
  local name="$1" port="$2" service="$3" config="$APP_DIR/config/$3-mcp.json"
  refuse_foreign_listener "$name" "$port" "$APP_DIR" "$config" || {
    read -k 1 "?Close the process using port $port, then press any key to close."
    exit 1
  }
  if mcp_ready "http://127.0.0.1:$port/mcp"; then
    echo "$name is already running."
    return 0
  fi
  echo "Starting $name…"
  (
    cd "$APP_DIR"
    # FastMCP's Host/Origin check is off by default; it rejects DNS-rebinding requests with HTTP 421.
    # The version is pinned because that setting's name is version-specific: an unpinned upgrade that
    # renamed it would switch the protection off without any error. Recheck the 421 before raising it.
    FASTMCP_HTTP_HOST_ORIGIN_PROTECTION=true PATH="$HOME/.local/bin:$PATH" "$HOME/.local/bin/uvx" --from 'fastmcp-slim[server]==4.1.8' \
      python "$APP_DIR/scripts/run-fastmcp-bridge-authenticated.py" run \
      "$config" --transport http \
      --host 127.0.0.1 --port "$port" --path /mcp --no-banner \
      >"$LOG_DIR/$service.log" 2>&1 &
    echo $! >"$RUNTIME_DIR/$service.pid"
  )
  for _ in {1..40}; do
    mcp_ready "http://127.0.0.1:$port/mcp" && return 0
    sleep 0.5
  done
  echo "$name is still starting (first launch can take a few minutes). Check $LOG_DIR/$service.log"
}

wait_for() {
  local name="$1" url="$2"
  for _ in {1..40}; do
    is_ready "$url" && return 0
    sleep 0.5
  done
  echo "$name did not start. Check $LOG_DIR"
  return 1
}

refuse_foreign_listener "Public Desk" 4173 "$APP_DIR" "server.mjs" || {
  read -k 1 "?Close the process using port 4173, then press any key to close."
  exit 1
}
signaldesk_pid="$(listener_pid 4173)"
if [[ -n "$signaldesk_pid" ]]; then
  echo "Public Desk is already running."
fi

API_KEYS_FILE="$APP_DIR/work/api-keys.env"
if [[ ! -e "$API_KEYS_FILE" ]]; then
  (umask 077; cp "$APP_DIR/config/api-keys.env.example" "$API_KEYS_FILE")
  echo "Created work/api-keys.env for optional API keys (see config/api-keys.env.example)."
fi

refuse_foreign_listener "Open OSINT data service" 8080 "$OSINT_ROOT/server" "$APP_DIR/scripts/live-api-keys.mjs" || {
  read -k 1 "?Close the process using port 8080, then press any key to close."
  exit 1
}
if ! service_ready "http://127.0.0.1:8080/health" && [[ -z "$(listener_pid 8080)" ]]; then
  # Public Desk's fixes to Open OSINT's own code (patches/), applied once and kept across Open OSINT updates.
  source "$APP_DIR/scripts/apply-open-osint-patches.zsh"
  apply_open_osint_patches "$OSINT_ROOT" "$APP_DIR/patches"
  echo "Starting Open OSINT data service…"
  (
    cd "$OSINT_ROOT/server"
    # live-api-keys.mjs reads the user's data-source keys from work/api-keys.env and follows changes made in the
    # Data sources panel, so only the data service ever holds them. It loads first: intelx-host.mjs reads its
    # setting at start. The data service calls listen(8080) with no address, which listens on every network
    # interface; bind-loopback.mjs keeps it on this Mac only. default-user-agent.mjs replaces fetch's "node"
    # User-Agent, which some sources (rdap.org, behind get_whois) refuse with HTTP 403. intelx-host.mjs sends
    # get_intelx to Intelligence X's free server, because the module hardcodes the paid one (401 for free keys).
    # abuse-ch-auth.mjs adds the saved abuse.ch key to MalwareBazaar and ThreatFox requests, which Open OSINT sends
    # without one (401).
    PUBLIC_DESK_API_KEYS_FILE="$API_KEYS_FILE" node --import tsx --import "$APP_DIR/scripts/live-api-keys.mjs" \
      --import "$APP_DIR/scripts/bind-loopback.mjs" --import "$APP_DIR/scripts/default-user-agent.mjs" \
      --import "$APP_DIR/scripts/intelx-host.mjs" --import "$APP_DIR/scripts/abuse-ch-auth.mjs" \
      --import "$APP_DIR/scripts/require-loopback-token.mjs" \
      server.mjs >"$LOG_DIR/headless.log" 2>&1 &
    echo $! >"$RUNTIME_DIR/headless.pid"
  )
fi
for _ in {1..40}; do
  service_ready "http://127.0.0.1:8080/health" && break
  sleep 0.5
done
service_ready "http://127.0.0.1:8080/health" || { echo "Open OSINT data service did not start. Check $LOG_DIR"; exit 1; }

refuse_foreign_listener "Open OSINT MCP service" 8892 "$OSINT_ROOT/mcp" "$APP_DIR/scripts/run-osint-mcp-guarded.py" || {
  read -k 1 "?Close the process using port 8892, then press any key to close."
  exit 1
}
if ! mcp_ready "http://127.0.0.1:8892/mcp" && [[ -z "$(listener_pid 8892)" ]]; then
  echo "Starting MCP service…"
  (
    cd "$OSINT_ROOT/mcp"
    # The wrapper rejects requests whose Host is not this Mac (DNS-rebinding protection).
    OSINT_MCP_API_KEY="$PUBLIC_DESK_TOKEN" HEADLESS_BASE_URL="http://127.0.0.1:8080" PYTHONPATH="$OSINT_ROOT/mcp/src" "$HOME/.local/bin/uv" run python "$APP_DIR/scripts/run-osint-mcp-guarded.py" \
      --transport http --host 127.0.0.1 --port 8892 >"$LOG_DIR/mcp.log" 2>&1 &
    echo $! >"$RUNTIME_DIR/mcp.pid"
  )
fi
for _ in {1..40}; do
  mcp_ready "http://127.0.0.1:8892/mcp" && break
  sleep 0.5
done
mcp_ready "http://127.0.0.1:8892/mcp" || { echo "MCP service did not start. Check $LOG_DIR/mcp.log"; exit 1; }

start_bridge "OSINT Toolbox MCP bridge" 8893 osint-toolbox
start_bridge "Omega MCP bridge" 8894 omega

if ! is_ready "http://127.0.0.1:4173"; then
  echo "Starting Public Desk…"
  (
    cd "$APP_DIR"
    node server.mjs >"$LOG_DIR/signaldesk.log" 2>&1 &
    echo $! >"$RUNTIME_DIR/signaldesk.pid"
  )
fi
wait_for "Public Desk" "http://127.0.0.1:4173" || exit 1

echo "Public Desk is ready."
open "http://127.0.0.1:4173/#access=$PUBLIC_DESK_TOKEN"
echo "Keep this window open while using Public Desk."
echo "Double-click Stop Public Desk.command when finished."

while is_ready "http://127.0.0.1:4173"; do
  sleep 5
done

echo "Public Desk stopped."
exit 0
