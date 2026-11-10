# Native Mosh prototype (arm64 Android 8+)

This is the actual upstream Mosh 1.4.0 client over UDP, not SSH, a WebSocket
terminal, or a Mosh-shaped UI. Backend authentication/bootstrap is outside this
component. Bob's Kotlin/JNI adapter contains no Termux code and does not link
Mosh: it starts a **separate GPLv3+ executable** attached to an original PTY
adapter. xterm.js 5.5.0 is an unmodified MIT-licensed renderer.

## Bridge contract

`NativeModules.BobTerminal.capabilities()` resolves `{available:boolean, reason?:string}`.
It checks arm64, API >=26 and extracted executable/adapter availability. It does
not claim a UDP connection was tested.

`prepare({host:string, port:number, key:string, backendId:string,
conversationId:number, sessionId:string, title?:string, cwd?:string})`
resolves a random opaque **one-shot string handle**, not a connection result.
`releasePrepared(handle)` resolves void and is idempotent, including after use/expiry.
`conversationId` must be a positive JavaScript safe integer. `host` must be a
numeric IPv4 or IPv6 address; resolve DNS at bootstrap. Key is the upstream
22-character unpadded base64 Mosh session key. The title/cwd/session identity are
metadata only, never shell arguments. The client receives no backend HTTP token.

`BobTerminalPackage` registers the `BobTerminalView` SimpleViewManager in the
existing React Native app window. There is **no separate Activity, Intent launch,
native header, or native button row**. The native view accepts only:

```tsx
<BobTerminalView
  session={preparedHandle} // opaque string only, NEVER the bootstrap config/key
  active={visible && foreground}
  control={{sequence, action, text, enabled}}
  onState={({nativeEvent}) => { /* session, phase, optional message/acknowledged, ctrl */ }}
  style={{flex: 1}}
/>
```

`control.sequence` is a strictly increasing nonnegative safe integer per view
admission. Actions: `input` (text), `ctrl` (enabled, or toggle if omitted),
`copy`, `paste`, `history` (default tmux prefix Ctrl-b then `[`), and `keyboard`
(enabled defaults true). Ctrl latches only the next nonempty input, including
keyboard/paste input; state events report `ctrl:false` after consuming it. React
owns all themed controls and the once-only bootstrap/reconnect admission policy.
Control, theme, font-scale and viewport updates do not remount/restart the client.

Direct `onState` events carry `{session:string,
phase:'starting'|'running'|'closed'|'failed', message?:string, ctrl:boolean,
acknowledged?:number}`.
Every event is scoped to its exact opaque handle. `running` means only that the
**local** client and PTY started; it does **not** verify UDP/network/server
connectivity. Errors are fixed sanitized messages, never exception strings.
`acknowledged` is the last **completed native ordering point**, separate from the
latest admitted command. Initial events omit it. Native admits at most one control
at a time, matching React's bounded FIFO and five-second fail-closed watchdog;
there is no automatic retry/replay. Copy completes only after its scoped WebView
callback updates the clipboard (or finishes an empty-selection no-op). Paste
captures xterm's synchronous generated/bracketed `onData` bytes and returns them
in one generation/sequence-scoped `pasteInput` bridge call; it completes only
after the bounded native writer accepts those bytes (or an empty-clipboard no-op).
Consequently Copy→Paste cannot read the old clipboard, and Paste→Tab/Ctrl cannot
overtake/mutate the paste. Keyboard completion is also scoped to its focus/blur
callback. None of these acknowledgements claims PTY write completion or remote
shell execution. Unrelated Ctrl/phase events cannot acknowledge unfinished async
work. Callback tickets are revoked on close/re-entry; event snapshots capture
only the completed sequence before posting. No input, clipboard payload or output
is included in state events. Oversized clipboard/generated paste fails visibly,
never silently dropping/truncating bytes.

The config lives only in a process-local registry for at most 15 seconds before
consumption (four outstanding preparations maximum). A mounted, waiting view
also times out after 15 seconds. No key enters view props, WebView, Intents,
Bundle, preferences, files or logs. The key is passed to the executable via
`MOSH_KEY` in its environment, never argv. Terminal content is not granted a
separate secure window: app-wide screenshot policy remains the parent's choice.
This is not a guarantee against an attacker controlling Bob's UID, a rooted
device, or a compromised process.

## Lifecycle, rendering and controls

`active=false`, React host pause/destroy, native detach, or view drop immediately
closes the local client. `active=true` / foreground resume **cannot restart that
admission**. Only an explicit new prepared handle may start another local process.
The renderer remains mounted on close, resize, theme and keyboard changes; drop
finally destroys it. A renderer-process crash fails closed and requires reopening
the Terminal screen to create a new renderer. The native child WebView is
explicitly measured/laid out to its React FrameLayout's full viewport. This view
does not apply system/IME insets, alter Activity soft-input modes, or own window
chrome: React applies IME spacing exactly once. No focus/IME is forced on mount,
client start, output, theme or resize; only the keyboard control requests it.

Closing kills the local process group and closes all PTY descriptors. A dedicated
waiter reaps the child. JNI uses bounded, never-reused opaque child handles;
reaping invalidates the registry entry under the same lock as signalling, so a
stale handle cannot target a later child with a recycled PID. Process death
cannot recover a key or automatically restart a client. Reconnect explicitly
bootstraps the same backend tmux session. Native never kills tmux, sends backend
mutations, or retries bootstrap. Since local kill is immediate, the backend must
reap/replace abandoned mosh-server workers; this component does not send a
graceful network shutdown on leaving.

The renderer uses Bob's exact `BobAppearance` background/foreground/cursor colors
and bundled **Nordwand Mono** regular/bold/italic/bold-italic WOFF2 faces from an
exact resource allowlist, not generic monospace. Font size starts at 14 CSS px
multiplied by Android accessibility fontScale, and reflows without restarting.
Normal terminal ANSI colors remain terminal-controlled.

All input uses one ordered writer bounded to 32 items and 64 KiB, including the
in-flight write. Saturation or a failed write closes the local client visibly;
input is never silently retried. xterm has a bounded 5000-line local scrollback.
Native output is backpressured on one 8-KiB chunk acknowledged only by xterm's
parser, with per-admission generation and per-chunk ticket checks; stale parser
callbacks cannot acknowledge another client's output. No links addon, OSC
clipboard handler or general command bridge is installed. WebView has only five
renderer resources and four exact font resources on its local HTTPS allowlist,
no file/content access, no network requests, navigation, external frames, storage
or network fallback, and a restrictive CSP. Output reaches xterm only as
base64-decoded terminal bytes, never HTML/JS. Clipboard access is an explicit
owner action and paste respects bracketed paste.

## Build / packaging

Prerequisites already present on the build host: Linux x86_64, curl, tar, make,
pkg-config, Perl, a C++ host compiler, host `tic`/`infocmp`, Android SDK, NDK
**27.1.12297006**, SDK CMake **3.22.1**, JDK 17 and project dependencies. No package
manager install is performed. The NDK target is `aarch64-linux-android26` because
Mosh uses `nl_langinfo`, introduced at API26. Bob itself keeps its existing minSdk.
Other ABIs explicitly report unavailable; do not claim x86/32-bit client support.

```sh
export ANDROID_HOME=/home/ndk/.local/android-sdk
export JAVA_HOME=/home/ndk/.local/jdks/temurin-17
# Optional persistent build cache; defaults to ~/.cache/bob-terminal-native.
export BOB_TERMINAL_BUILD_DIR=/path/to/native-build-cache
bash apps/mobile/android/terminal/build-mosh.sh
cd apps/mobile/android
./gradlew :app:compileDebugKotlin :app:testDebugUnitTest \
  --tests com.bobmobile.BobTerminalConfigTest \
  --tests com.bobmobile.TerminalInputQueueTest \
  --tests com.bobmobile.TerminalAdmissionTest \
  --tests com.bobmobile.TerminalControlOrderTest \
  --tests com.bobmobile.TerminalRendererAssetsTest \
  -PreactNativeArchitectures=arm64-v8a
cd ../../..
node --test apps/mobile/android/terminal/terminal-renderer-test.cjs
cc -D_GNU_SOURCE -I"$JAVA_HOME/include" -I"$JAVA_HOME/include/linux" -pthread \
  -Wall -Wextra -Werror apps/mobile/android/terminal/terminal-pty-test.c \
  -o /tmp/bob-terminal-pty-test && /tmp/bob-terminal-pty-test
```

`buildBobTerminal` is a preBuild dependency. Inputs and tarball SHA256 values are
pinned in `build-mosh.sh`/`vendor-manifest.json`; archives are verified before
extraction. It builds a matching host protoc from source, then Android static
dependencies and Mosh. No opaque binary downloads. This is a repeatable source
recipe, **not a claim of bit-for-bit reproducibility** across host compilers or
host terminfo tools. Upstream sources are unmodified. All ELF load segments use
16KB alignment. libc++, protobuf, OpenSSL and ncurses are linked statically;
Android platform libc/libm/libz/liblog/libdl remain dynamic.

The executable is packaged as `lib/arm64-v8a/libbob_mosh.so` (a PIE, not a JNI
library). `jniLibs.useLegacyPackaging=true` makes PackageManager extract it to the
read-only installed `nativeLibraryDir`. Android 10+ does not allow executable code
from writable app data; this component never copies or executes code there.
`libbob_terminal_pty.so` is the only JNI-loaded library. Verify the signed APK's
`extractNativeLibs` flag, native entries and signature; running from an adb shell
would not by itself prove app-sandbox execution permission.

## Licenses / corresponding source

The root Bob MIT license is unchanged. **Do not relabel Mosh as MIT.** The separate
Mosh executable is GPLv3-or-later with its upstream OpenSSL linking exception.
Its own version banner retains that attribution. OpenSSL is Apache-2.0, protobuf
BSD-3-Clause, ncurses MIT, xterm.js MIT; original license texts are included.
This process boundary is an intentional separation, not a blanket legal opinion
about aggregation. Review distribution/installation-information obligations
before a public release.

Every generated APK includes `assets/terminal/legal/mosh-corresponding-source.tar`
(~26 MB), containing the complete, hash-pinned upstream Mosh, protobuf, OpenSSL
and ncurses source archives plus `build-mosh.sh`, the PTY adapter source and its
handle-regression test, `vendor-manifest.json` and this README.
Their licenses also appear as individual assets; xterm's license is under
`assets/terminal/vendor/XTERM-LICENSE`. Obtain them without network access:

```sh
unzip Bob.apk 'assets/terminal/legal/*' 'assets/terminal/vendor/XTERM-LICENSE'
mkdir -p extracted-source
cd extracted-source
tar xf ../assets/terminal/legal/mosh-corresponding-source.tar
# With the matching preinstalled SDK/NDK and host tools above, no source download:
BOB_TERMINAL_OFFLINE=1 \
BOB_TERMINAL_BUILD_DIR="$PWD/work" \
BOB_TERMINAL_OUTPUT_DIR="$PWD/output" bash ./build-mosh.sh
# Cached archives beside the script are verified and copied into work as needed.
# The work directory may also equal the extraction directory; same-file copies
# are guarded. Output contains jniLibs and legal assets, independent of Gradle.
```

For renderer provenance, download the pinned npm tarball in vendor-manifest.json,
verify its hash and copy `package/lib/xterm.js`, `package/css/xterm.css` and
`package/LICENSE` (renamed XTERM-LICENSE) to the vendor asset directory. No npm
install, runtime CDN or new mobile JS dependency is needed.

This is a bounded compile/packaging prototype. A successful signed-package check
is not an on-device UDP/IME/security/lifecycle acceptance test. Test those on the
owner-approved installed build before describing the feature as production-ready.
