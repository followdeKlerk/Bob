# Showcase captures

Refreshed **2026-10-30**, using the signed **Bob 0.3.101 (versionCode 104)** APK in a fresh, disposable Android 16 emulator. These are captures of the real Android UI, not HTML mock-ups or composited screens.

- `coding-request.png`, `coding-tests.png`, `coding-result.png`: browsing the saved transcript of the original real-model `slugify` demonstration. The five passing tests and ZIP are recorded output from that earlier run; this refresh did not rerun inference or the sample project's tests.
- `model-picker.png`: staged model catalog/configuration, with a favourite starred through the real picker. Catalog entries do not establish current provider availability.
- `agents-active.png`, `agents-history.png`: staged working/idle agent metadata and explicitly labelled example transcript. These illustrate filtering and the viewer, not newly executed agent work.
- `coding-demo.gif`: a normal-speed recording of browsing the saved coding conversation, toggling a model favourite, and opening active/history agent views. Despite the retained filename, this is a UI tour, not a new live coding run.

The emulator was paired only to an isolated showcase fixture with disposable authentication. No production conversations or provider credentials were used. Raw screenshots were 1080×2160; published PNGs are proportionally resized to 720×1440. The GIF is 420×840 at six frames per second, approximately 56 seconds, with no time acceleration. Only resizing/palette optimization was applied—no UI text or controls were painted over.

APK SHA-256: `285c9efd1616538e584462ed31ff69de7849f7964253c9060acca901492ccde9`.

## Refresh boundary

Use a disposable emulator, a current signed APK, and nonprivate demo data. Capture with Android `screencap`/`screenrecord`; inspect every screenshot and representative GIF frames before replacing these assets. Update the root README's version and provenance together with the media. Keep pairing secrets, TLS keys, production state, diagnostic maps and raw private captures out of this directory.

Emulator captures do not verify physical-phone gesture behavior, permissions, notification delivery, every screen/font size, or live model/provider/agent operation. See the maintained [feature guide](../../FEATURES.md#app-navigation) and [verification guidance](../../OPERATIONS.md#development-checks).
