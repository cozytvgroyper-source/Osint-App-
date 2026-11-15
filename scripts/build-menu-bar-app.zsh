#!/bin/zsh
set -eu

# Builds the Public Desk menu-bar controller and installs it in ~/Applications (or the folder given as $1).
# It needs only Apple's free command line tools (xcode-select --install): the app is signed ad hoc on this Mac,
# so no Apple developer account is involved. The app remembers this checkout's folder and the PATH this script
# ran with, so it can find node and uv when opened from Finder.

APP_DIR="${0:A:h:h}"
DEST="${1:-$HOME/Applications}"
NAME="Public Desk"
BUNDLE_ID="local.public-desk.controller"
OUTPUT_DIR="$APP_DIR/work/build/menu-bar"
# Build and sign in a private temporary folder: folders synced by iCloud (such as the Desktop) keep adding Finder
# attributes that code signing refuses. The signed app is then copied out.
STAGE_DIR="$(mktemp -d -t public-desk-menu-bar)"
trap 'rm -rf "$STAGE_DIR"' EXIT
BUNDLE="$STAGE_DIR/$NAME.app"

if ! command -v swiftc >/dev/null 2>&1; then
  print -u2 -- "The Swift compiler is missing. Install Apple's command line tools with: xcode-select --install"
  exit 1
fi

print -r -- "Building $NAME.app…"
mkdir -p "$BUNDLE/Contents/MacOS" "$BUNDLE/Contents/Resources"
swiftc -O -swift-version 5 -parse-as-library -target "$(uname -m)-apple-macos13.0" \
  -o "$BUNDLE/Contents/MacOS/$NAME" "$APP_DIR"/macos/PublicDeskController/*.swift

PLIST="$BUNDLE/Contents/Info.plist"
plutil -create xml1 "$PLIST"
plutil -insert CFBundleName -string "$NAME" "$PLIST"
plutil -insert CFBundleDisplayName -string "$NAME" "$PLIST"
plutil -insert CFBundleIdentifier -string "$BUNDLE_ID" "$PLIST"
plutil -insert CFBundleExecutable -string "$NAME" "$PLIST"
plutil -insert CFBundlePackageType -string APPL "$PLIST"
plutil -insert CFBundleShortVersionString -string 1.0 "$PLIST"
plutil -insert CFBundleVersion -string 1 "$PLIST"
plutil -insert LSMinimumSystemVersion -string 13.0 "$PLIST"
# A menu-bar app: no Dock icon, and macOS reuses a running copy instead of opening another.
plutil -insert LSUIElement -bool YES "$PLIST"
plutil -insert LSMultipleInstancesProhibited -bool YES "$PLIST"
plutil -insert NSAppleEventsUsageDescription \
  -string "Public Desk brings its open browser tab to the front instead of opening another one." "$PLIST"
plutil -insert PublicDeskRoot -string "$APP_DIR" "$PLIST"
plutil -insert PublicDeskPath -string "$PATH" "$PLIST"

/usr/bin/xattr -cr "$BUNDLE"
codesign --force --sign - --identifier "$BUNDLE_ID" "$BUNDLE"
codesign --verify --strict "$BUNDLE"

mkdir -p "$OUTPUT_DIR"
rm -rf "$OUTPUT_DIR/$NAME.app"
/usr/bin/ditto --noextattr --noqtn "$BUNDLE" "$OUTPUT_DIR/$NAME.app"
if [[ "$DEST" == "--build-only" ]]; then
  print -r -- "Built $OUTPUT_DIR/$NAME.app"
  exit 0
fi

# Replace a running copy: it releases its single-instance lock on exit, and services keep running.
if /usr/bin/pgrep -xq "$NAME"; then
  /usr/bin/pkill -x "$NAME" || true
  for _ in {1..25}; do /usr/bin/pgrep -xq "$NAME" || break; sleep 0.2; done
fi
mkdir -p "$DEST"
rm -rf "$DEST/$NAME.app"
/usr/bin/ditto --noextattr --noqtn "$BUNDLE" "$DEST/$NAME.app"
print -r -- "Installed $DEST/$NAME.app"
/usr/bin/open "$DEST/$NAME.app"
print -r -- "Public Desk is in the menu bar. Choose Open Public Desk to start it."
