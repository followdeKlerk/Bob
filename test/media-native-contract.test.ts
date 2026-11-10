import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const native = (name: string) => readFileSync(new URL(`../apps/mobile/android/app/src/main/java/com/bobmobile/${name}.kt`, import.meta.url), "utf8");

test("media admission reads the real application lifecycle, not ThemedReactContext's inherited BEFORE_CREATE state", () => {
  const view = native("BobMediaView");
  // RN 0.88 ThemedReactContext forwards lifecycle listeners, but does not override
  // getLifecycleState or copy it in initializeFromOther. A view-local check rejects
  // every fresh player even while the underlying ReactApplicationContext is resumed.
  assert.doesNotMatch(view, /\breact\.lifecycleState\b/);
  assert.match(view, /react\.reactApplicationContext\.lifecycleState\s*!=\s*LifecycleState\.RESUMED/);
  assert.ok(view.indexOf("sessionId = id; admitted = true") < view.indexOf("Keep Bob open, then tap Play again."));
  assert.match(view, /OnScrollChangedListener\s*\{\s*maybeStart\(\)/);
  assert.match(view, /removeOnScrollChangedListener\(scrollObserver\)/);
});

test("native video backing is a normal container, never an unsupported TextureView background", () => {
  const view = native("BobMediaView");
  // This guards the Android constructor crash from returning. A source contract
  // is not a substitute for mounting the actual view in an Android test.
  assert.match(view, /val videoFrame = FrameLayout\(react\)\.apply \{ setBackgroundColor\(Color\.BLACK\) \}/);
  assert.match(view, /videoFrame\.addView\(picture,/);
  assert.doesNotMatch(view, /picture\.(?:setBackground\w*\(|background\s*=)/);
  assert.match(view, /videoFrame\.visibility = if \(video\) View\.VISIBLE else View\.GONE/);
  assert.match(view, /videoFrame\.layoutParams = LayoutParams/);
});

test("codec setup belongs to the serial codec worker; the view owns no default Android text/buttons", () => {
  const session = native("BobMediaSession"), view = native("BobMediaView");
  assert.match(session, /HandlerThread\("BobMediaCodec"\)/);
  assert.match(session, /fun start\(surface: Surface\?\)\s*\{\s*worker\.post/);
  assert.doesNotMatch(view, /MediaPlayer\(|\.setDataSource\(|import android\.widget\.(Button|TextView)/);
  assert.match(view, /thumbTintList = tint/);
  assert.match(view, /snapshot\.phase == "playing" && SystemClock\.elapsedRealtime\(\) - lastAdvanceAt >= 3000/);
});
