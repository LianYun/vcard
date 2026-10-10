#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=$(mktemp -d /tmp/vibe-storage-tests.XXXXXX)
trap 'rm -rf "$OUT"' EXIT
SOURCES=(ios/VibeWord/Core/{Localization,EnglishMessages,FSRSVendor,FSRSScheduler,Models,Anki,SyncEvent,JSONEventStore}.swift
 ios/VibeWord/App/{FolderSync,LegacyCoreDataImport,Persistence}.swift
 src-tauri/macos/{LegacyImport,DocumentImport,TextImport,AnkiImport,CloudBridge}.swift)
xcrun swiftc -parse-as-library -swift-version 5 -module-cache-path "$OUT/cache" "${SOURCES[@]}" src-tauri/macos/DocumentImportTests.swift src-tauri/macos/BridgeTests.swift -o "$OUT/tests"
if [[ "${1:-}" != "--performance-only" ]]; then "$OUT/tests"; fi
if [[ "${1:-}" == "--performance" || "${1:-}" == "--performance-only" ]]; then
 xcrun swiftc -O -parse-as-library -swift-version 5 -module-cache-path "$OUT/cache" "${SOURCES[@]}" scripts/fixtures/storage-performance.swift -o "$OUT/performance"
 "$OUT/performance"
fi
