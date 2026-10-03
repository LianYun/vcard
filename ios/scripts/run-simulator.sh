#!/bin/bash
# Build and launch a Debug-only local preview, without a developer signing account.
set -euo pipefail
IOS_ROOT=$(cd -- "$(dirname -- "$0")/.." && pwd)
if [[ -z "${DEVELOPER_DIR:-}" && -d /Applications/Xcode.app/Contents/Developer ]]; then
  export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
fi
if ! xcodebuild -version >/dev/null 2>&1; then
  echo '需要完整 Xcode：先从 App Store 安装并首次打开，安装 iOS Simulator 组件。' >&2
  exit 1
fi
DEVICE_ID=$(xcrun simctl list devices available -j | python3 -c '
import json,sys
devices=[d for runtime,items in json.load(sys.stdin)["devices"].items() if ".iOS-" in runtime for d in items if d.get("isAvailable") and "iPhone" in d["name"]]
devices.sort(key=lambda d: (d["state"] == "Booted", d["name"]), reverse=True)
if not devices:
    sys.exit("没有可用的 iPhone 模拟器。请执行 xcodebuild -downloadPlatform iOS 安装运行时，然后在 Xcode > Window > Devices and Simulators 创建 iPhone。")
print(devices[0]["udid"])
')
xcodebuild -project "$IOS_ROOT/VibeWord.xcodeproj" -scheme VibeWord -configuration Debug \
  -destination "platform=iOS Simulator,id=$DEVICE_ID" -derivedDataPath "$IOS_ROOT/DerivedData" \
  CODE_SIGNING_ALLOWED=NO build
DEVICE_STATE=$(xcrun simctl list devices -j | python3 -c 'import json,sys; print(next(d["state"] for items in json.load(sys.stdin)["devices"].values() for d in items if d["udid"]==sys.argv[1]))' "$DEVICE_ID")
if [[ "$DEVICE_STATE" != Booted ]]; then xcrun simctl boot "$DEVICE_ID"; fi
DEVELOPER_PATH="${DEVELOPER_DIR:-$(xcode-select -p)}"
if [[ -d "$DEVELOPER_PATH/Applications/Simulator.app" ]]; then
  open -a "$DEVELOPER_PATH/Applications/Simulator.app" --args -CurrentDeviceUDID "$DEVICE_ID"
elif [[ -d "$DEVELOPER_PATH/../Applications/DeviceHub.app" ]]; then
  open "$DEVELOPER_PATH/../Applications/DeviceHub.app"
else
  echo '模拟器已启动；未找到窗口程序，请从 Xcode 打开设备管理界面。' >&2
fi
xcrun simctl bootstatus "$DEVICE_ID" -b
xcrun simctl install "$DEVICE_ID" "$IOS_ROOT/DerivedData/Build/Products/Debug-iphonesimulator/VibeWord.app"
xcrun simctl launch --terminate-running-process "$DEVICE_ID" com.lianyun.vibeword -local-preview
