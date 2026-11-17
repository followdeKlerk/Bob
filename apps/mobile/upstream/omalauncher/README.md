# Omalauncher Voice — unchanged phone-source snapshot

**Immutable reference, adapted integration.** `source/` and `SHA256SUMS` remain
byte-identical phone reference material, not Gradle/Metro build inputs. Bob now
separately extracts and adapts useful Voice behavior into its own Android and
React Native chat. The owner explicitly authorized extraction after the original
unchanged-controller blocker; no launcher runtime emulation was introduced.

## Provenance and byte verification

`source/` retains the original relative paths and unmodified file bytes from the
owner-authorized phone working tree at base HEAD
`af07fb11e2b72337e2e189bb0f75eecba7ee5a04`. The working tree was **dirty**:
notably `VoiceScreen.kt`, `VoiceSession.kt`, `AgentLink.kt`, translations and the
added Bob integration/tests. This is not a checkout of HEAD or a reconstruction
from GitHub. Upstream: https://github.com/SimonSchubert/omalauncher.

The read-only SSH transfer used strict host-key checks and verified the pinned
ED25519 fingerprint recorded in `TRANSFER.json`. Every selected path and its
ancestors was checked; all symlinks were rejected. A path allowlist excluded
credentials, local configuration, chat data, APKs, caches and unrelated launcher
features. No phone files were written, no app was driven, and no microphone or
TTS was activated.

SHA-256 was computed remotely before transfer and again remotely after transfer;
both inventories and the received bytes matched for all **26 files / 311,078
bytes**. `TRANSFER.json` records these three inventories. It is a transfer record,
not an upstream-signed attestation. `SHA256SUMS` is the exact per-file inventory;
its own SHA-256 is
`4a3c3587298f83c7a976c742eae126b6e7e19f02eff77483cbf141888d1eb7a9`.

Recheck locally from the repository root:

```sh
(cd apps/mobile/upstream/omalauncher/source && sha256sum -c ../SHA256SUMS)
node --import tsx --test test/omalauncher-voice-import.test.ts
```

### Copied inventory

All paths below are relative to `source/`; the manifest lists each individually.

- `LICENSE`, `THIRD_PARTY.md` and
  `app/src/main/assets/licenses/apache-2.0.txt` (3 files).
- `gradle/libs.versions.toml` (the original dependency catalog, not build wiring).
- Under `app/src/main/kotlin/dev/omalauncher/` (11 files):
  - `ui/voice/{Speech,Speaker,VoiceScreen,BobConversationPicker}.kt`;
  - `voice/{VoiceSession,AgentLink,BobLink,BobSessionGuard}.kt`;
  - `SpeakNowActivity.kt`, `VoiceActivity.kt`;
  - `widgets/runtime/Dictation.kt`.
- `app/src/main/res/{values,values-de,values-es,values-in,values-pt,values-ru,values-zh}/strings_voice.xml`
  (7 files, including current dirty translations).
- `app/src/test/kotlin/dev/omalauncher/voice/{AgentLinkTest,YesNoTest,BobLinkTest,BobSessionGuardTest}.kt`
  (4 original regression files, retained unchanged; not run as JVM tests here).

## Behavior preserved in the copied source

In `VoiceScreen.kt:202–205`, `listen()` starts upstream `Speech` and immediately
passes a nonblank final result to `session.ask(heard)`. There is **no Send press**
in this speech path. Opening listens once; further turns are tap-to-talk.
`VoiceSession.kt:980–1000` hands completed sentences to `say()`, which calls
`speaker.speak(clean)` automatically unless typing or explicitly muted. The
original `Speech` selected-service/on-device/activity fallback and `Speaker`
engine/voice/language/rate handling are untouched. These are source observations,
not an installed-phone test.

## Extracted implementation and deliberate differences

- `Speech.kt`: selected/non-Google service discovery, on-device checks, locale
  capability inspection, final/partial results and activity-only recognition. Bob preserves the requested locale and does not copy upstream’s guessed-region fallback.
  Adapted in `BobVoiceInput.kt`, `VoiceProviders.kt`, `VoiceInputPolicy.kt` and
  `BobVoiceRecognitionActivity.kt`. Bob owns Android permission, focus, separate
  stage deadlines, cancellation and process-wide capture/playback exclusion.
- `VoiceScreen.kt` / `VoiceSession.kt`: a final utterance submits without Send;
  subsequent captures require a tap; waiting/errors are visible; the answer is
  automatically read. Adapted in `voice-chat.ts`, `use-voice-chat.ts`,
  `components/voice-chat-controls.tsx` and actual `App.tsx` callbacks. Bob's current
  selected-chat/device-bound outbox and authenticated causal completion receipt
  replace the launcher process link. No second delivery controller is introduced.
- `Speaker.kt`: system TTS engine/language/rate/voice selection, bounded output,
  progress/failure and stop handling. Adapted in `BobSpeech.kt` and `speech.ts`,
  retaining Bob's fail-closed process-lifetime engine lease.

**Working path:** deliberate headphones tap → Android final utterance → existing
Bob outbox → exact request's completed-answer receipt → full recorded assistant
public text → automatic TTS. The next capture always needs another tap. The
separate microphone stays draft-only/manual Send and existing drafts/attachments
are untouched. **This reads the completed answer; it does not reproduce upstream
sentence-stream timing.** Virtualized rows do not own Voice Chat playback.

The old unchanged-controller blocker was real: `VoiceScreen` required concrete
launcher `Runtime`; `VoiceSession` required `Proot`, `AgentStore`, a live local
process, filesystem transcripts/settings and process-pipe events. The copied
`BobLink` starts `bob-voice-agent rpc` with separately paired launcher companion
state and its own session selection. None of that runtime/process/companion path,
Compose shell, Linux/PRoot, launcher filesystem settings, plugin UI, logos or fonts
is connected to Bob. Authorized extraction removes that architectural blocker
without altering the pristine phone reference.

The one ephemeral playback interest belongs to the current voice turn and is
revoked by cancellation, text send, navigation, chat/connection/pairing changes,
background or unmount. Only the deliberately owned external provider Activity may
temporarily leave Bob. Completion polling is bounded and read-only; outbox
recovery still owns delivery. Snapshots/history/reconnect cannot reconstruct
revoked autoplay authority. See root `FEATURES.md` for timing, controls and limits.

## Privacy and licensing boundary

**Do not describe this engine as offline-only.** Original `Speech.kt` can fall back
to a regular recognizer, remove the offline preference for missing language data,
or invoke another app's speech screen. Original `Speaker.kt` sorts but does not
prohibit network voices. Bob's adaptation never silently follows those network
fallbacks: each non-on-device recognition utterance needs named-provider consent;
TTS requires a voice reporting offline support. There is **no network TTS override**:
Android's public constructors may use a fallback engine, so the configured engine
setting cannot attest the actual text recipient. Old provider-specific network
consent is rejected in JS and native code, not silently broadened. Recognition
consent remains configuration-bound, revocable and per-utterance. Provider/model
changes fail closed. Bob itself saves/uploads no microphone audio;
only final text uses normal chat delivery. Installed provider behavior remains
Android/provider-dependent. Upstream plaintext process trace code remains dormant
reference material, not a Bob logging path.

The MIT license and **Copyright (c) 2026 Simon Schubert and contributors** are
retained verbatim in `source/LICENSE`, including its exclusions. `source/THIRD_PARTY.md`
is unchanged. No excluded logos, fonts, Omarchy themes, native libraries, Mesa,
Play SDK or third-party binary dependencies were copied.

Required dependency notices identified in the upstream license inventory
(`ui/settings/LicensesScreen.kt`, inspected but not imported) are retained here
for the Voice dependency boundary; their Apache 2.0 text is copied at
`source/app/src/main/assets/licenses/apache-2.0.txt`:

- Compose Multiplatform: Copyright 2020–2026 JetBrains s.r.o. and respective
  authors and developers; https://github.com/JetBrains/compose-multiplatform.
- Android Jetpack: Copyright The Android Open Source Project;
  https://developer.android.com/jetpack/androidx.
- Kotlin and kotlinx.coroutines: Copyright 2010–2026 JetBrains s.r.o. and Kotlin
  Programming Language contributors; https://kotlinlang.org.
- JSON-java (upstream JVM test dependency): Public Domain;
  https://github.com/stleary/JSON-java.

No dependency was installed by this extraction. Production speech text reuses the
already installed MIT `markdown-it` parser, now declared directly, rather than
stripping Markdown with destructive regexes. Root `THIRD_PARTY_NOTICES.md` records
attribution; full upstream MIT/exclusions and Markdown parser licences are also
bundled under Android `assets/licenses/`.

## Validation boundary and focused checks

```sh
(cd apps/mobile/upstream/omalauncher/source && sha256sum -c ../SHA256SUMS)
node --import tsx --test test/omalauncher-voice-import.test.ts test/documentation.test.ts
(cd apps/mobile && ../../node_modules/.bin/tsc --noEmit)
(cd apps/mobile && npm test -- --runInBand --runTestsByPath \
  __tests__/App.test.tsx __tests__/voice-chat-app.test.tsx __tests__/voice-chat.test.ts \
  __tests__/voice-input.test.ts __tests__/voice-input-button.test.tsx \
  __tests__/speech.test.ts __tests__/speech-action.test.tsx __tests__/voice-speech-safety.test.ts)
# Scoped compile/unit tests only; configured SDK/JDK and cached dependencies required.
(cd apps/mobile/android && ./gradlew :app:compileDebugKotlin :app:testDebugUnitTest \
  --tests 'com.bobmobile.Voice*' --tests 'com.bobmobile.Speech*' \
  -x buildBobInteractive -x buildBobTerminal --offline --console=plain)
```

These exercise App/controller/native policy/lease/wiring boundaries without
activating a microphone, installed recognizer, TTS engine or model/provider.
Structural 337/361×754 theme/font/keyboard tests are not physical rendering or
audio-device proof. Real provider, permission, Activity handoff, focus and speech
quality still need owner-run device acceptance. No APK build, installation,
deployment, service restart or audio activation is part of this implementation.

### Historical initial-integration checks (c965091; not post-fix full gates)

- **176/176 tests, eight focused mobile Jest suites**, including the real App's
  auto-send/outbox/receipt/playback callbacks, two turns, preserved draft and
  attachments, late focus/background/navigation/pairing races, unmounted rows,
  failed capture/playback cleanup, and both themes at 337/361×754 with keyboard
  and 1×/2× font-scale structural probes. `--detectOpenHandles` reported no handles.
- Mobile **`tsc --noEmit` passed**.
- Scoped debug Kotlin compilation and **31/31 Voice/Speech JVM tests passed**
  offline with Temurin 17. Existing ReactPackage/Gradle deprecation warnings remain.
- Source/provenance and documentation **9/9 tests passed**; **26/26 source hashes**
  remain equal to the phone inventory, including the unchanged manifest hash.
- The original three reproduction inputs now pass: 30-second setup followed by a
  valid 15-second recognition/final still delivers its transcript; failed Stop
  retains visible recovery while revoking old event authority; `2*3` is preserved.
  The independent probe harness only needed the new Markdown module wired into
  its imports; inputs were not weakened.

One simultaneous Gradle/Jest attempt exceeded the pre-existing App harness's
five-second test deadline and caused a downstream fixture failure. The identical
Jest command passed when rerun alone; no deadlines/assertions were relaxed. These
results do not replace physical-provider/audio/layout acceptance.


## Independent-review HOLD corrections

- **Network TTS:** the safe public-API policy is to disable the unprovable network
  override, not broaden its consent. Native `speakConfigured(..., consent=true)`
  rejects before engine construction; legacy JS network options also reject before
  a native call. `SpeechPolicy.permitsVoice` never admits a network-required voice.
  The preferences key is a change detector only, never actual-provider attestation.
- **Cold engine cleanup:** `SpeechEngineLease` tracks any possible audio attempt.
  Confirmed shutdown is sufficient only before any attempt; attempted speech still
  requires confirmed Stop AND shutdown. The mark is inside atomic admission and
  before the real `speak` call. Process-wide unresolved leases remain retained.
- **Queued start:** `SpeechAdmission` synchronously revokes a thread-safe native
  ticket at Stop/invalidate admission, before main-thread cleanup. Initialization
  and each atomic chunk admission recheck it. Stale ID/module stops and queued old
  cleanup cannot revoke a newer playback ticket.
- **Composer:** the shared geometry budget includes heading, chrome/gaps, the
  scaled text minimum plus its separate control row, attachments and essential
  voice/recovery rows. Only decorative/preview/detail content collapses or scrolls.
  Live phase and 48dp Stop/Exit/Retry controls stay outside scrolling details;
  input/list identity, caret, unrelated draft and files remain intact.
- **Locale:** the shared activity/service request adapter preserves BCP-47 region,
  script and extensions. Capability lookup admits only the exact advertised request
  or reports missing data; another advertised region is a suggestion, not an
  automatic substitution or undisclosed change to the consent language.

These are scoped fixes for independent re-review. The refreshed complete root,
mobile and native gates remain the parent's responsibility before release; focused
checks and browser/compiled-policy probes are not Android hardware acceptance.

### Focused post-HOLD evidence (not refreshed full gates)

- Mobile TypeScript passed. Ten affected Jest suites passed **240/240** with
  `--detectOpenHandles`; native compilation and scoped Voice/Speech tests passed
  **41/41** offline, serially rather than alongside Jest. The final focused runs
  include the prepared **0.3.199 / 202** source metadata.
- The original independent `LeaseProbe.java`, unchanged, now prints confirmed
  cleanup with no retained never-used engine and zero speak calls; all five
  requested locale strings equal the actual request-adapter outputs. This is a
  compiled-policy probe, not an Android service/intent/device test.
- The updated original browser adapter/current wrapper uses the actual editor,
  Voice/recovery panels and attachment component plus the shared whole-composer
  budget. **64/64** width/theme/font/keyboard/files/recovery cases have their
  heading, live phase and essential 48dp controls in bounds, with no horizontal
  overflow or page exceptions. The fixture's synthetic heading matches the App's
  48/76dp navigation/avatar lane; it is not a full Android/Yoga/IME rendering.
- The App regression additionally keeps native input/list identity, caret, draft
  and files across scaled keyboard/recovery transitions and verifies that an error
  cause remains in the live header rather than beneath explanatory copy.

Reproduce the affected mobile suites from `apps/mobile`:

```sh
npm test -- --runInBand --runTestsByPath \
  __tests__/App.test.tsx __tests__/voice-chat-app.test.tsx __tests__/voice-chat.test.ts \
  __tests__/voice-input.test.ts __tests__/voice-input-button.test.tsx \
  __tests__/speech.test.ts __tests__/speech-action.test.tsx __tests__/voice-speech-safety.test.ts \
  __tests__/draft-input.test.tsx __tests__/composer-geometry.test.ts --detectOpenHandles
```

Use the scoped native compile/test command above only after Jest finishes. No
APK/release build, installation, deployment or real microphone/TTS activation was
performed. Independent re-review and refreshed full validation are still required.
