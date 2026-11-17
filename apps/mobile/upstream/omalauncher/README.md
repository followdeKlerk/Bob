# Omalauncher Voice — unchanged phone-source snapshot

**Copied, not integrated.** Nothing here is registered with Gradle, Metro, the
Android manifest or Bob's composer. This is not a working Voice Chat feature.
There is no new button, alternate chat, backend, agent or replacement screen.

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

## Concrete integration blocker — stopped without a shim

The upstream has no injected chat transport interface:

1. `VoiceScreen(runtime: Runtime, ...)` (`VoiceScreen.kt:167–178`) requires the
   concrete launcher `Runtime`, not a speech/chat interface. It directly reads
   `runtime.bootstrap.state`, accesses agent install states and opens launcher
   agent settings/terminals (`:282`, `:334`, `:415`, `:492`). The actual `Runtime`
   constructs PRoot, Wayland/window management, agent provisioning and widgets;
   those unrelated subsystems were inspected, not imported.
2. `VoiceSession` (`VoiceSession.kt:39–44`) requires concrete `Proot` and
   `AgentStore`. `ask()` (`:461–505`) refuses to submit without a live local
   `Process`. `start()` (`:698–782`) chooses a global `VOICE_LINKS` entry, calls
   `proot.process(l.command(session)).start()` and reads that process's pipes.
   There is no public callback for Bob's selected connection/current chat,
   canonical submission identity/outbox, or receipt reconciliation.
3. The existing Bob integration is **not** that connector. `BobLink.command()`
   (`BobLink.kt:32`) executes `bob-voice-agent rpc` in the launcher guest. Its
   protocol loads separately paired companion state, optionally switches
   `bob-voice:<id>` sessions, and exposes session selection (`:35–56`, `:111–135`).
   Pointing it at the owner's already paired launcher companion would silently
   use another connection/selection and evade Bob's current-chat admission
   boundary. Copying its private configuration is explicitly out of scope.
4. The unchanged session owns persistent local transcripts/settings under
   `context.filesDir/voice` and can continue running after the screen closes
   (`VoiceSession.kt:35–38`, `:453–457`). Bob's permitted integration instead
   needs current-chat/connection revocation and must preserve the existing draft,
   list and Durable/outbox identities. Adding a composer launch alone does not
   resolve either ownership or lifecycle.

Bob's existing canonical send path remains `apps/mobile/App.tsx`'s `submit()`:
it creates a request ID and adds an `OutgoingMessage` to the app-owned outbox.
The upstream process path cannot be connected to it by manifest/registration
alone. Keeping upstream files unchanged would require substantial launcher
runtime/process emulation; replacing that path would change upstream behavior.
Both exceed the requested small external connector. No such adapter was added,
and Bob dictation was not substituted. Integration compilation and real-phone
acceptance are therefore **blocked**, not passed.

## Privacy and licensing boundary

Do not describe this engine as offline-only. `Speech.kt:236–252,380–388` falls
back to a regular recognizer and can remove the offline preference when a
language model is unavailable; `SpeakNowActivity` can invoke another app's speech
UI. Android's selected provider may send microphone audio over the network.
`Speaker.kt:192–196,217–225` sorts network-required voices but does not prohibit
them; selected TTS providers may receive reply text. Unlike Bob's existing
per-utterance dictation consent and offline-capable Read aloud claims, these
upstream fallbacks have no equivalent Bob consent boundary. Any future exposed
integration must disclose that before deliberate Voice entry; this dormant
snapshot makes no change to current Bob behavior or privacy claims. Also note
upstream `VoiceSession.trace()` writes bounded plaintext command/event traces in
the launcher guest; those logs were not copied.

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

No new dependency is installed, resolved or bundled by this snapshot. A future
build must retain the actual resolved artifacts' licenses/notices as well.
