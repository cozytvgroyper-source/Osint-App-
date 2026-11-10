#!/bin/zsh
set -u

APP_DIR="${0:A:h}"
OSINT_ROOT="${APP_DIR:h}/omprehensive-osint-toolboxes-osint-mcp-by/downloads/osint-mcp"
RUNTIME_DIR="$APP_DIR/work/runtime"
LOG_DIR="$APP_DIR/work/logs"

mkdir -p "$RUNTIME_DIR" "$LOG_DIR"

if [[ ! -d "$OSINT_ROOT/server/node_modules" || ! -x "$OSINT_ROOT/mcp/.venv/bin/osint-mcp" ]]; then
  echo "SignalDesk dependencies are missing."
  echo "Open this project in Codex and ask: Set up SignalDesk locally."
  read -k 1 "?Press any key to close."
  exit 1
fi

is_ready() {
  /usr/bin/curl -fsS --max-time 2 "$1" >/dev/null 2>&1
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

if ! is_ready "http://127.0.0.1:8080/health"; then
  echo "Starting Open OSINT data service…"
  (
    cd "$OSINT_ROOT/server"
    node --import tsx server.mjs >"$LOG_DIR/headless.log" 2>&1 &
    echo $! >"$RUNTIME_DIR/headless.pid"
  )
fi
wait_for "Open OSINT data service" "http://127.0.0.1:8080/health" || exit 1

if ! is_ready "http://127.0.0.1:8892/health"; then
  echo "Starting MCP service…"
  (
    cd "$OSINT_ROOT/mcp"
    HEADLESS_BASE_URL="http://127.0.0.1:8080" "$OSINT_ROOT/mcp/.venv/bin/osint-mcp" \
      --transport http --host 127.0.0.1 --port 8892 >"$LOG_DIR/mcp.log" 2>&1 &
    echo $! >"$RUNTIME_DIR/mcp.pid"
  )
fi
wait_for "MCP service" "http://127.0.0.1:8892/health" || exit 1

if ! is_ready "http://127.0.0.1:4173"; then
  echo "Starting SignalDesk…"
  (
    cd "$APP_DIR"
    node server.mjs >"$LOG_DIR/signaldesk.log" 2>&1 &
    echo $! >"$RUNTIME_DIR/signaldesk.pid"
  )
fi
wait_for "SignalDesk" "http://127.0.0.1:4173" || exit 1

echo "SignalDesk is ready."
open "http://127.0.0.1:4173"
echo "Keep this window open while using SignalDesk."
echo "Double-click Stop SignalDesk.command when finished."

while is_ready "http://127.0.0.1:4173"; do
  sleep 5
done

echo "SignalDesk stopped."
exit 0
