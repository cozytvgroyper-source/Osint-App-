#!/bin/zsh
set -u

APP_DIR="${0:A:h}"
OSINT_ROOT="${APP_DIR:h}/omprehensive-osint-toolboxes-osint-mcp-by/downloads/osint-mcp"
RUNTIME_DIR="$APP_DIR/work/runtime"
LOG_DIR="$APP_DIR/work/logs"

mkdir -p "$RUNTIME_DIR" "$LOG_DIR"

if [[ ! -d "$OSINT_ROOT/server/node_modules" || ! -x "$OSINT_ROOT/mcp/.venv/bin/osint-mcp" ]]; then
  echo "Public Desk dependencies are missing."
  echo "Ask your coding assistant to set up Public Desk locally."
  read -k 1 "?Press any key to close."
  exit 1
fi

is_ready() {
  /usr/bin/curl -fsS --max-time 2 "$1" >/dev/null 2>&1
}

# MCP endpoints reject plain GET requests (HTTP 400), so a bridge only counts as running
# when it answers an MCP initialize request.
mcp_ready() {
  /usr/bin/curl -fsS --max-time 2 -X POST "$1" \
    -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
    --data '{"jsonrpc":"2.0","id":"startup","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"Public Desk Launcher","version":"1.0"}}}' \
    >/dev/null 2>&1
}

port_owner() {
  local pid
  pid="$(/usr/sbin/lsof -nP -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null | head -1)"
  [[ -n "$pid" ]] && /bin/ps -o command= -p "$pid"
}

# Bridges started from another Public Desk folder run that folder's config, so refuse to reuse them.
require_own_bridge() {
  local name="$1" port="$2" config="$3" owner
  owner="$(port_owner "$port")"
  if [[ -n "$owner" && "$owner" != *"$config"* ]]; then
    echo "$name on port $port belongs to another Public Desk folder:"
    echo "  $owner"
    echo "Double-click Stop Public Desk.command in that folder, then start again."
    read -k 1 "?Press any key to close."
    exit 1
  fi
}

start_bridge() {
  local name="$1" port="$2" service="$3" config="$APP_DIR/config/$3-mcp.json"
  require_own_bridge "$name" "$port" "$config"
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
    FASTMCP_HTTP_HOST_ORIGIN_PROTECTION=true PATH="$HOME/.local/bin:$PATH" "$HOME/.local/bin/uvx" --from 'fastmcp-slim[server]==4.1.8' fastmcp run \
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

signaldesk_pid="$(/usr/sbin/lsof -nP -tiTCP:4173 -sTCP:LISTEN 2>/dev/null | head -1)"
if [[ -n "$signaldesk_pid" ]]; then
  signaldesk_dir="$(/usr/sbin/lsof -a -p "$signaldesk_pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
  if [[ "$signaldesk_dir" != "$APP_DIR" ]]; then
    echo "Public Desk is already running from another folder:"
    echo "  $signaldesk_dir"
    echo "Double-click Stop Public Desk.command in that folder, then start again."
    read -k 1 "?Press any key to close."
    exit 1
  fi
  echo "Public Desk is already running."
fi

if ! is_ready "http://127.0.0.1:8080/health"; then
  echo "Starting Open OSINT data service…"
  (
    cd "$OSINT_ROOT/server"
    # The data service calls listen(8080) with no address, which listens on every network interface.
    # bind-loopback.mjs keeps it on this Mac only. default-user-agent.mjs replaces fetch's "node" User-Agent,
    # which some sources (rdap.org, behind get_whois) refuse with HTTP 403.
    node --import tsx --import "$APP_DIR/scripts/bind-loopback.mjs" --import "$APP_DIR/scripts/default-user-agent.mjs" \
      server.mjs >"$LOG_DIR/headless.log" 2>&1 &
    echo $! >"$RUNTIME_DIR/headless.pid"
  )
fi
wait_for "Open OSINT data service" "http://127.0.0.1:8080/health" || exit 1

if ! is_ready "http://127.0.0.1:8892/health"; then
  echo "Starting MCP service…"
  (
    cd "$OSINT_ROOT/mcp"
    # The wrapper rejects requests whose Host is not this Mac (DNS-rebinding protection).
    HEADLESS_BASE_URL="http://127.0.0.1:8080" PYTHONPATH="$OSINT_ROOT/mcp/src" "$HOME/.local/bin/uv" run python "$APP_DIR/scripts/run-osint-mcp-guarded.py" \
      --transport http --host 127.0.0.1 --port 8892 >"$LOG_DIR/mcp.log" 2>&1 &
    echo $! >"$RUNTIME_DIR/mcp.pid"
  )
fi
wait_for "MCP service" "http://127.0.0.1:8892/health" || exit 1

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
open "http://127.0.0.1:4173"
echo "Keep this window open while using Public Desk."
echo "Double-click Stop Public Desk.command when finished."

while is_ready "http://127.0.0.1:4173"; do
  sleep 5
done

echo "Public Desk stopped."
exit 0
