#!/bin/bash
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "$0")/../.." && pwd)
APK="$ROOT/android/.build/VibeWord-debug.apk"
[[ -f "$APK" ]] || { echo 'Run npm run android:build first.' >&2; exit 1; }
ADB_ARGS=()
if [[ -n "${ANDROID_SERIAL:-}" ]]; then ADB_ARGS=(-s "$ANDROID_SERIAL"); fi
adb "${ADB_ARGS[@]}" install --no-incremental -r "$APK"
adb "${ADB_ARGS[@]}" shell am start -n com.vibeword.android/.MainActivity
