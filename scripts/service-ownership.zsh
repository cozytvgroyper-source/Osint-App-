#!/bin/zsh

# Shared launcher safety checks. A health response alone is not proof that a local process belongs
# to this Public Desk checkout; both its working directory and a service-specific command marker
# must match before it may be reused or stopped.
#
# lsof is found on PATH (macOS keeps it in /usr/sbin, Linux in /usr/bin); PUBLIC_DESK_LSOF overrides it
# for tests. If lsof cannot run, ownership cannot be checked, so every check fails closed: a port is
# never treated as free and a process is never treated as ours.

lsof_command() {
  local candidate="${PUBLIC_DESK_LSOF:-$(command -v lsof 2>/dev/null || print -r -- /usr/sbin/lsof)}"
  [[ -x "$candidate" ]] || return 1
  print -r -- "$candidate"
}

listener_pid() {
  local lsof
  lsof="$(lsof_command)" || return 1
  "$lsof" -nP -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null | head -1
}

process_command() {
  /bin/ps -o command= -p "$1" 2>/dev/null
}

process_working_directory() {
  local lsof
  lsof="$(lsof_command)" || return 1
  "$lsof" -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p'
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
  if ! lsof_command >/dev/null; then
    echo "$name: cannot check who is using port $port because lsof is not available."
    return 1
  fi
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
