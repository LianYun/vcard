#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=$(mktemp -d /tmp/vibe-study-start.XXXXXX)
trap 'rm -rf "$OUT"' EXIT
SOURCES=(ios/VibeWord/Core/{Localization,EnglishMessages,FSRSVendor,FSRSScheduler,Models,Anki,SyncEvent,JSONEventStore}.swift
 ios/VibeWord/App/{FolderSync,LegacyCoreDataImport,Persistence}.swift
 src-tauri/macos/{LegacyImport,DocumentImport,TextImport,AnkiImport,CloudBridge}.swift)
# Freeze inputs so localization generation or another build cannot change them mid-compile.
cp "${SOURCES[@]}" scripts/fixtures/study-start-performance.swift "$OUT/"
xcrun swiftc -O -parse-as-library -swift-version 5 -module-cache-path "$OUT/cache" "$OUT/"*.swift -o "$OUT/tests"
"$OUT/tests"
