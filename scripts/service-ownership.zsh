#!/bin/zsh

# Shared launcher safety checks. A health response alone is not proof that a local process belongs
# to this Public Desk checkout; both its working directory and a service-specific command marker
# must match before it may be reused or stopped.

listener_pid() {
  /usr/sbin/lsof -nP -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null | head -1
}

process_command() {
  /bin/ps -o command= -p "$1" 2>/dev/null
}

process_working_directory() {
  /usr/sbin/lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p'
}

identity_values_match() {
  local actual_cwd="$1" actual_command="$2" expected_cwd="$3" expected_marker="$4"
  [[ -n "$actual_cwd" && "$actual_cwd" == "$expected_cwd" && -n "$actual_command" && "$actual_command" == *"$expected_marker"* ]]
}

process_belongs_to_service() {
  local pid="$1" expected_cwd="$2" expected_marker="$3"
  kill -0 "$pid" 2>/dev/null || return 1
  identity_values_match "$(process_working_directory "$pid")" "$(process_command "$pid")" "$expected_cwd" "$expected_marker"
}

refuse_foreign_listener() {
  local name="$1" port="$2" expected_cwd="$3" expected_marker="$4" pid command cwd
  pid="$(listener_pid "$port")"
  [[ -z "$pid" ]] && return 0
  process_belongs_to_service "$pid" "$expected_cwd" "$expected_marker" && return 0
  command="$(process_command "$pid")"
  cwd="$(process_working_directory "$pid")"
  echo "$name cannot use port $port because it belongs to another process:"
  echo "  PID: $pid"
  echo "  Folder: ${cwd:-unknown}"
  echo "  Command: ${command:-unknown}"
  return 1
}
