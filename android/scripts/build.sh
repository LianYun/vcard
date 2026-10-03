#!/bin/bash
# Reproducible debug APK using official SDK tools, with no Gradle/NDK download.
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "$0")/../.." && pwd)
export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
export PATH="$JAVA_HOME/bin:$PATH"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
TOOLS="$SDK/build-tools/36.0.0"
PLATFORM="$SDK/platforms/android-35/android.jar"
OUT="$ROOT/android/.build"
for tool in "$JAVA_HOME/bin/javac" "$TOOLS/aapt2" "$TOOLS/d8" "$TOOLS/apksigner"; do
  [[ -x "$tool" ]] || { echo "Missing tool: $tool" >&2; exit 1; }
done
rm -rf "$OUT/classes" "$OUT/dex" "$OUT/generated"
mkdir -p "$OUT/assets/web" "$OUT/classes" "$OUT/dex" "$OUT/generated"
cd "$ROOT"
npm run typecheck
./node_modules/.bin/vite build --outDir android/.build/assets/web --emptyOutDir
# Public presentation/demo files are unrelated to the app; only package the app bundle.
find "$OUT/assets/web" -maxdepth 1 -type f ! -name index.html -delete
"$TOOLS/aapt2" compile --dir android/app/src/main/res -o "$OUT/resources.zip"
"$TOOLS/aapt2" link -o "$OUT/unsigned.apk" -I "$PLATFORM" \
  --manifest android/app/src/main/AndroidManifest.xml --java "$OUT/generated" \
  -A "$OUT/assets" "$OUT/resources.zip"
find android/app/src/main/java "$OUT/generated" -name '*.java' > "$OUT/sources.list"
javac -encoding UTF-8 -source 8 -target 8 -Xlint:-options -bootclasspath "$PLATFORM:$TOOLS/core-lambda-stubs.jar" -d "$OUT/classes" @"$OUT/sources.list"
jar cf "$OUT/classes.jar" -C "$OUT/classes" .
"$TOOLS/d8" --lib "$PLATFORM" --min-api 26 --output "$OUT/dex" "$OUT/classes.jar"
(cd "$OUT/dex" && zip -q -j "$OUT/unsigned.apk" ./*.dex)
"$TOOLS/zipalign" -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"
# A local, disposable debug key; never use this key to publish production builds.
if [[ ! -f "$OUT/debug.keystore" ]]; then
  keytool -genkeypair -keystore "$OUT/debug.keystore" -storepass android -keypass android \
    -alias androiddebugkey -dname 'CN=Android Debug,O=Android,C=US' -keyalg RSA -keysize 2048 -validity 10000
fi
"$TOOLS/apksigner" sign --ks "$OUT/debug.keystore" --ks-pass pass:android --key-pass pass:android \
  --out "$OUT/VibeWord-debug.apk" "$OUT/aligned.apk"
"$TOOLS/apksigner" verify "$OUT/VibeWord-debug.apk"
echo "APK: $OUT/VibeWord-debug.apk"
