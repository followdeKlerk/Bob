import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const native = (name: string) => readFileSync(new URL(`../apps/mobile/android/app/src/main/java/com/bobmobile/${name}.kt`, import.meta.url), "utf8");

test("PDF scope and safe-area chrome remain native, private and separate from chat", () => {
  const activity = native("BobPreviewActivity");
  assert.match(activity, /require\(file\.parentFile == root && file\.isFile\)/);
  assert.match(activity, /WindowInsetsCompat\.Type\.displayCutout\(\)/);
  assert.match(activity, /LinearLayout\.LayoutParams\(dp\(48\), dp\(48\)\)/);
  assert.match(activity, /imageTintList = ColorStateList\.valueOf\(colors\.foreground\)/);
  assert.match(activity, /override fun setTintList\(tint: ColorStateList\?\)/);
  assert.match(activity, /putBundle\("pdf\.viewport", it\.saveState\(\)\)/);
  assert.doesNotMatch(activity, /PdfRenderer|ParcelFileDescriptor|\.render\(/);
  const manifest = readFileSync(new URL("../apps/mobile/android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8");
  assert.match(manifest, /<activity\s+android:name="\.BobPreviewActivity"[^>]*android:exported="false"/);
});

test("PDF rendering is serialized and UI-acknowledged, with bounded rasters and asynchronous disposal", () => {
  const session = native("PdfRenderSession");
  assert.match(session, /HandlerThread\("BobPdfRender"\)/);
  assert.match(session, /LatestPdfWork<Request>\(\)/);
  assert.match(session, /PdfViewport\.BASE_PIXELS/);
  assert.match(session, /PdfViewport\.DETAIL_PIXELS/);
  assert.match(session, /main\.post\s*\{\s*try\s*\{/);
  assert.match(session, /finally \{ if \(queue\.complete\(\) && !closed\) worker\.post/);
  assert.match(session, /onOpened = null; onRendered = null/);
  assert.match(session, /worker\.post \{ closeResources\(\); thread\.quitSafely\(\) \}/);
  assert.doesNotMatch(session, /\.join\(|\.await\(|System\.gc\(/);
});

test("PDF gestures retain stale-result, pointer and page-request guards without excluding Android Back", () => {
  const view = native("PdfPreviewView");
  assert.match(view, /epoch != generation \|\| page != currentState\.page/);
  assert.match(view, /requestedBaseGeneration != generation/);
  assert.match(view, /leftEdge = viewport\.atLeft; rightEdge = viewport\.atRight/);
  assert.match(view, /event\.pointerCount > 1/);
  assert.match(view, /multiTouch = true; pageDirection = 0; pageDrag = 0f/);
  assert.match(view, /lockedToPan = pageDirection == 0/);
  assert.match(view, /ACTION_POINTER_UP/);
  assert.match(view, /ACTION_CANCEL/);
  assert.match(view, /PdfViewport\.raster\(viewport\.visible\(\), viewport\.scale, PdfViewport\.DETAIL_PIXELS\)/);
  assert.match(view, /isQuickScaleEnabled = false/);
  assert.doesNotMatch(view, /[Ss]ystemGestureExclusionRects|PdfRenderer|ParcelFileDescriptor/);
  assert.match(view, /ACTION_SCROLL_FORWARD/); assert.match(view, /R\.id\.pdf_zoom_in/);
});
