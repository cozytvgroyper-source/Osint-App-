#!/bin/zsh
APP_DIR="${0:A:h}"
/bin/zsh "$APP_DIR/scripts/public-desk-control.zsh" start --open
exit_code=$?
if (( exit_code != 0 )); then read -k 1 "?Public Desk could not start. Press any key to close."; fi
exit $exit_code
