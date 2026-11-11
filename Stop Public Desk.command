#!/bin/zsh
set -u

APP_DIR="${0:A:h}"
RUNTIME_DIR="$APP_DIR/work/runtime"
OSINT_ROOT="${APP_DIR:h}/omprehensive-osint-toolboxes-osint-mcp-by/downloads/osint-mcp"

source "$APP_DIR/scripts/service-ownership.zsh"

expected_identity() {
  case "$1" in
    signaldesk) REPLY=("$APP_DIR" "server.mjs") ;;
    omega) REPLY=("$APP_DIR" "$APP_DIR/config/omega-mcp.json") ;;
    osint-toolbox) REPLY=("$APP_DIR" "$APP_DIR/config/osint-toolbox-mcp.json") ;;
    mcp) REPLY=("$OSINT_ROOT/mcp" "$APP_DIR/scripts/run-osint-mcp-guarded.py") ;;
    headless) REPLY=("$OSINT_ROOT/server" "$APP_DIR/scripts/live-api-keys.mjs") ;;
  esac
}

for service in signaldesk omega osint-toolbox mcp headless; do
  pid_file="$RUNTIME_DIR/$service.pid"
  if [[ -f "$pid_file" ]]; then
    pid="$(<"$pid_file")"
    if [[ "$pid" == <-> ]] && kill -0 "$pid" 2>/dev/null; then
      expected_identity "$service"
      if process_belongs_to_service "$pid" "$REPLY[1]" "$REPLY[2]"; then
        kill "$pid" 2>/dev/null || true
        echo "Stopped $service."
      else
        echo "Did not stop PID $pid for $service because it does not belong to this Public Desk folder."
      fi
    fi
    rm -f "$pid_file"
  fi
done

echo "Public Desk services are stopped."
sleep 1
