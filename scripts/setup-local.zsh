#!/bin/zsh
set -eu

APP_DIR="${0:A:h:h}"
source "$APP_DIR/config/open-osint.env"
DEPENDENCY_ROOT="${PUBLIC_DESK_OSINT_ROOT:-$APP_DIR/work/dependencies/osint-mcp}"

for command in git node npm uv; do
  command -v "$command" >/dev/null 2>&1 || { print -u2 -- "Missing required command: $command"; exit 1; }
done

node -e 'const major=Number(process.versions.node.split(".")[0]);if(major<22)process.exit(1)' \
  || { print -u2 -- "Public Desk requires Node 22 or newer."; exit 1; }

mkdir -p "${DEPENDENCY_ROOT:h}"
chmod 700 "$APP_DIR/work" "${DEPENDENCY_ROOT:h}" 2>/dev/null || true

if [[ ! -d "$DEPENDENCY_ROOT/.git" ]]; then
  git clone --filter=blob:none "$OPEN_OSINT_REPOSITORY" "$DEPENDENCY_ROOT"
fi

git -C "$DEPENDENCY_ROOT" fetch --depth 1 origin "$OPEN_OSINT_REVISION"
git -C "$DEPENDENCY_ROOT" checkout --detach "$OPEN_OSINT_REVISION"

(cd "$DEPENDENCY_ROOT/server" && npm ci)
(cd "$DEPENDENCY_ROOT/mcp" && uv sync --frozen)

source "$APP_DIR/scripts/apply-open-osint-patches.zsh"
apply_open_osint_patches "$DEPENDENCY_ROOT" "$APP_DIR/patches"

print -r -- "Public Desk dependencies are ready in $DEPENDENCY_ROOT"
