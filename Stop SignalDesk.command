#!/bin/zsh
set -u

APP_DIR="${0:A:h}"
RUNTIME_DIR="$APP_DIR/work/runtime"

for service in signaldesk omega osint-toolbox mcp headless; do
  pid_file="$RUNTIME_DIR/$service.pid"
  if [[ -f "$pid_file" ]]; then
    pid="$(<"$pid_file")"
    if [[ "$pid" == <-> ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      echo "Stopped $service."
    fi
    rm -f "$pid_file"
  fi
done

echo "SignalDesk services are stopped."
sleep 1
