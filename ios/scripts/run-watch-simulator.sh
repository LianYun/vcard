#!/bin/bash
# Build/install the watch app. --demo uses a separate, simulator-only sample store.
set -euo pipefail
IOS_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
WATCH_BUILD_DIR=${WATCH_BUILD_DIR:-/tmp/vibe-word-watch-simulator}
WATCH_DEVICE_ID=${WATCH_DEVICE_ID:-$(xcrun simctl list devices available -j | python3 -c '
import json,sys
devices=[d for runtime,rows in json.load(sys.stdin)["devices"].items() if "watchOS" in runtime for d in rows if d["isAvailable"]]
if not devices: sys.exit("Install a watchOS Simulator runtime in Xcode first.")
print(next((d for d in devices if d["state"] == "Booted"),devices[0])["udid"])
')}
WATCH_ARGS=()
if [[ "${1:-}" == "--demo" ]]; then WATCH_ARGS=(-watch-demo)
elif [[ $# -gt 0 ]]; then echo 'Usage: run-watch-simulator.sh [--demo]' >&2; exit 2; fi
xcodebuild -project "$IOS_ROOT/VibeWord.xcodeproj" -scheme VibeWordWatch \
  -destination "platform=watchOS Simulator,id=$WATCH_DEVICE_ID" \
  -derivedDataPath "$WATCH_BUILD_DIR" CODE_SIGNING_ALLOWED=NO build
if ! xcrun simctl list devices booted -j | python3 -c 'import json,sys;sys.exit(not any(d["udid"]==sys.argv[1] for rows in json.load(sys.stdin)["devices"].values() for d in rows))' "$WATCH_DEVICE_ID"; then
  xcrun simctl boot "$WATCH_DEVICE_ID"
fi
xcrun simctl bootstatus "$WATCH_DEVICE_ID" -b
xcrun simctl install "$WATCH_DEVICE_ID" "$WATCH_BUILD_DIR/Build/Products/Debug-watchsimulator/VibeWordWatch.app"
xcrun simctl launch "$WATCH_DEVICE_ID" com.lianyun.vibeword.watchkitapp "${WATCH_ARGS[@]}"
echo "Watch simulator: $WATCH_DEVICE_ID"
