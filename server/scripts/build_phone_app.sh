#!/bin/sh
# Build the Genesis phone app (release, R8-minified, signed with the local debug key) into dist/Genesis.apk.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export JAVA_HOME="${JAVA_HOME:-$(ls -d "$HOME"/Library/Java/JavaVirtualMachines/jdk-17*/Contents/Home | head -1)}"
export GRADLE_USER_HOME="$ROOT/data/gradle-home"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
MOBILE="$ROOT/../mobile"  # the phone app sits next to server/ in the repo
[ -f "$MOBILE/local.properties" ] || printf 'sdk.dir=%s\n' "$SDK" > "$MOBILE/local.properties"
cd "$MOBILE"
./gradlew assembleRelease --console=plain -q
mkdir -p "$ROOT/dist"
cp app/build/outputs/apk/release/app-release.apk "$ROOT/dist/Genesis.apk"
echo "Built $ROOT/dist/Genesis.apk"
