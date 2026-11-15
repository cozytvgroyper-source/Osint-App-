#!/bin/zsh
set -eu

# Builds the Public Desk menu-bar controller and installs it in ~/Applications (or the folder given as $1).
# It needs only Apple's free command line tools (xcode-select --install): the app is signed ad hoc on this Mac,
# so no Apple developer account is involved. The app remembers this checkout's folder and the PATH this script
# ran with, so it can find node and uv when opened from Finder.

APP_DIR="${0:A:h:h}"

# A fingerprint of everything compiled into the app (and of this recipe). The app stores the one it was built from
# and compares it with this checkout's to update itself after a pull. The control script is not included: the app
# runs it from this folder, so changes to it apply without a rebuild.
source_hash() {
  cat "$APP_DIR"/macos/PublicDeskController/*.swift "$APP_DIR"/macos/Icon/*.swift "$APP_DIR/scripts/build-menu-bar-app.zsh" \
    | /usr/bin/shasum -a 256 | cut -d' ' -f1
}
if [[ "${1:-}" == "--source-hash" ]]; then
  source_hash
  exit 0
fi

DEST="$HOME/Applications"
LAUNCH=1
for arg in "$@"; do
  case "$arg" in
    --no-launch) LAUNCH=0 ;; # used by the controller to update itself; it then reopens the new copy on its own
    *) DEST="$arg" ;;
  esac
done
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
# A menu-bar app: no Dock icon. Single-instance is enforced by the app's own lock, not LSMultipleInstancesProhibited:
# that key would also stop the app from opening its own updated copy while it hands over.
plutil -insert LSUIElement -bool YES "$PLIST"
plutil -insert NSAppleEventsUsageDescription \
  -string "Public Desk brings its open browser tab to the front instead of opening another one." "$PLIST"
plutil -insert PublicDeskRoot -string "$APP_DIR" "$PLIST"
plutil -insert PublicDeskPath -string "$PATH" "$PLIST"
plutil -insert PublicDeskSourceHash -string "$(source_hash)" "$PLIST"

# The icon is drawn by macos/Icon/DrawIcon.swift, then scaled to every size macOS uses and packed into AppIcon.icns
# with sips and iconutil, which come with macOS.
ICONSET="$STAGE_DIR/AppIcon.iconset"
mkdir -p "$ICONSET"
swiftc -O -o "$STAGE_DIR/draw-icon" "$APP_DIR/macos/Icon/DrawIcon.swift"
"$STAGE_DIR/draw-icon" "$STAGE_DIR/AppIcon-1024.png"
for size in 16 32 128 256 512; do
  /usr/bin/sips -z $size $size "$STAGE_DIR/AppIcon-1024.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  /usr/bin/sips -z $((size * 2)) $((size * 2)) "$STAGE_DIR/AppIcon-1024.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
/usr/bin/iconutil -c icns "$ICONSET" -o "$BUNDLE/Contents/Resources/AppIcon.icns"
plutil -insert CFBundleIconFile -string AppIcon "$PLIST"

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

# When the controller updates itself it must not be stopped from here: macOS ends an app's child processes with it,
# so this script would die halfway through installing. Replacing the files under a running app is safe (it keeps
# running from the copy already in memory); the controller then opens the new copy and quits.
if (( LAUNCH )) && /usr/bin/pgrep -xq "$NAME"; then
  # Replace a running copy: it releases its single-instance lock on exit, and services keep running.
  /usr/bin/pkill -x "$NAME" || true
  for _ in {1..25}; do /usr/bin/pgrep -xq "$NAME" || break; sleep 0.2; done
fi
mkdir -p "$DEST"
rm -rf "$DEST/$NAME.app"
/usr/bin/ditto --noextattr --noqtn "$BUNDLE" "$DEST/$NAME.app"
print -r -- "Installed $DEST/$NAME.app"
if (( LAUNCH )); then
  /usr/bin/open "$DEST/$NAME.app"
  print -r -- "Public Desk is in the menu bar. Choose Open Public Desk to start it."
fi
