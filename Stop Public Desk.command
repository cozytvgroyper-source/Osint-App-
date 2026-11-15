#!/bin/zsh
APP_DIR="${0:A:h}"
/bin/zsh "$APP_DIR/scripts/public-desk-control.zsh" stop
exit_code=$?
sleep 1
exit $exit_code
