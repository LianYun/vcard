#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
ANKI_FIXTURES=$(mktemp -d /tmp/vibe-anki-fixtures.XXXXXX)
export ANKI_FIXTURES
trap 'rm -rf "$ANKI_FIXTURES"' EXIT
cp scripts/fixtures/anki/*.apkg "$ANKI_FIXTURES/"
cargo test --manifest-path src-tauri/Cargo.toml --lib anki
bash scripts/test-anki-native.sh
node scripts/test-decks.mjs
