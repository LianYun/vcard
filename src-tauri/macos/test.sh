#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=$(mktemp -d /tmp/vibe-cloud-tests.XXXXXX)
trap 'rm -rf "$OUT"' EXIT
xcrun swiftc -parse-as-library -swift-version 5 -module-cache-path "$OUT/cache" \
  ios/VibeWord/Core/Localization.swift ios/VibeWord/Core/EnglishMessages.swift ios/VibeWord/Core/Models.swift ios/VibeWord/Core/FSRSVendor.swift ios/VibeWord/Core/FSRSScheduler.swift ios/VibeWord/Core/Anki.swift ios/VibeWord/Core/SyncEvent.swift \
  ios/VibeWord/Core/JSONEventStore.swift ios/VibeWord/App/FolderSync.swift \
  ios/VibeWord/App/LegacyCoreDataImport.swift ios/VibeWord/App/Persistence.swift src-tauri/macos/LegacyImport.swift \
  src-tauri/macos/DocumentImport.swift src-tauri/macos/TextImport.swift src-tauri/macos/AnkiImport.swift src-tauri/macos/CloudBridge.swift src-tauri/macos/DocumentImportTests.swift src-tauri/macos/BridgeTests.swift -o "$OUT/tests"
"$OUT/tests" "$@"
