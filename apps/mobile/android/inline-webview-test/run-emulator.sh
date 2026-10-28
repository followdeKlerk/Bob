#!/usr/bin/env bash
set -euo pipefail
# Explicit emulator serial prevents touching a paired owner's physical phone.
serial=${1:?Usage: run-emulator.sh emulator-SERIAL (requires JAVA_HOME and Android SDK)}
[[ "$serial" == emulator-* ]] || { echo 'Refusing to install the test harness on a physical phone.' >&2; exit 1; }
adb=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/.local/android-sdk}}/platform-tools/adb
[[ $("$adb" -s "$serial" shell getprop ro.kernel.qemu | tr -d '\r') == 1 ]] || { echo 'Target is not a verified emulator.' >&2; exit 1; }
cd "$(dirname "$0")/.."
./gradlew -PinlineWebViewTests :inline-webview-test:assembleDebug :inline-webview-test:assembleDebugAndroidTest --console=plain
"$adb" -s "$serial" install -r inline-webview-test/build/outputs/apk/debug/inline-webview-test-debug.apk
"$adb" -s "$serial" install -r inline-webview-test/build/outputs/apk/androidTest/debug/inline-webview-test-debug-androidTest.apk
log=$(mktemp)
trap 'rm -f "$log"' EXIT
"$adb" -s "$serial" shell am instrument -w com.bobmobile.inlineverification.test/com.bobmobile.InlineSurfaceInstrumentation | tee "$log"
# adb itself can exit zero when instrumentation fails. Require every scenario.
node --input-type=module - "$log" <<'JS'
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const log=readFileSync(process.argv[2],'utf8');
assert.ok(!log.includes('INLINE_WEBVIEW_FAILED'),log);
const results=JSON.parse(/^INLINE_WEBVIEW_RESULTS=(.*)$/m.exec(log)?.[1]??'[]');
assert.deepEqual(results.map(result=>result.case),['compact','exact-viewport','grow-shrink','overflow','nested-overflow','grows-after-fit','missing-measurement','missing-resize-ack','live-data','fullscreen-data','reported-examples','approved-report','react-scroll','react-inverted']);
console.log('All fourteen real Android WebView size/data lifecycle checks passed (emulator only).');
JS
