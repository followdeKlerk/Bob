# Third-party notices

## Experimental Android terminal

The arm64 terminal prototype packages [Mosh 1.4.0](https://github.com/mobile-shell/mosh/tree/mosh-1.4.0) as a separate executable communicating through a pseudo-terminal, not as a JNI-linked copy of its protocol code. Mosh retains its **GPLv3-or-later** terms and the specific upstream OpenSSL exception. Bob's MIT licence does not replace those terms or settle the licensing of a combined distribution. Broader redistribution requires review of the actual combined artefact; this is an owner-tested prototype, not a claim of an MIT-only APK.

The native build recipe pins source archives and checksums for Mosh and its static dependencies (Protocol Buffers, OpenSSL and ncurses). The APK includes their licence notices and a corresponding-source archive under `assets/terminal/legal/`. Source URLs, versions, hashes and build instructions are retained in `apps/mobile/android/terminal/` in the source checkout. No Termux application or GPL terminal-view code is copied into Bob.

The dedicated terminal renderer vendors [xterm.js](https://github.com/xtermjs/xterm.js) under its MIT licence. Its unmodified licence is retained alongside the bundled JavaScript and CSS in the APK's `assets/terminal/vendor/` directory. Terminal content is separate from Bob's generated interactive visual viewer.

## Advanced Delegation

Bob's Advanced Delegation behavior is adapted from the Nous Research Advanced Delegation plugin, reviewed commit [`e404b6816b20237a82f6fbe2749b5a576cf75dba`](https://github.com/NousResearch/hermes-official-plugins/tree/e404b6816b20237a82f6fbe2749b5a576cf75dba/advanced-delegation). Bob uses its own native configuration, credentials and Pi Durable subagent lifecycle, not the Hermes runtime.

MIT License

Copyright (c) 2026 Nous Research

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Bro skill

The optional native `bro` skill is adapted from [`luchasarie/bro-skill`, commit `6c08e7ee5eb8ef8b9bf0588d400170654abc256b`](https://github.com/luchasarie/bro-skill/tree/6c08e7ee5eb8ef8b9bf0588d400170654abc256b). Its invocation guard is adapted for Bob's enabled-skill prompt loading and skill picker. The skill is stored in the backend's native library, not automatically installed by the CLI package.

MIT License

Copyright (c) 2026 Hermes Agent + Luka

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Nordwand Mono

Bob bundles unmodified [Nordwand Mono 1.4.0](https://github.com/tywr/Nordwand-Mono/releases/tag/1.4.0), Copyright (c) 2026, Tanguy VIVIER, under the SIL Open Font License 1.1. The [full font licence](apps/mobile/android/app/src/main/assets/fonts/OFL.txt) is shipped in the Android app alongside the web fonts. [Provenance and SHA-256 checksums](apps/mobile/android/app/src/main/assets/fonts/README.md) identify the bundled upstream TTF and WOFF2 files. No font is downloaded at runtime.

## Learning review, `/learn` prompts and memory threat patterns

Bob's learning review prompts, `/learn` authoring prompt, and `/refine` focus suffix are adapted from [Nous Research's Hermes Agent, commit `bf0203a794a07aac3ff764972ab9087baa4e4f4e`](https://github.com/NousResearch/hermes-agent/tree/bf0203a794a07aac3ff764972ab9087baa4e4f4e), specifically `agent/background_review.py`, `agent/learn_prompt.py`, and `agent/curator.py`. The latter credits the knowledge-base layout to [virgiliojr94/book-to-skill](https://github.com/virgiliojr94/book-to-skill). Bob uses native Pi Durable memory/skill resources and coding/browser tools, not the upstream runtime. These are prompt instructions, not tool enforcement or approval gates.

[Provenance, adaptation details and reproducible AST extraction](assets/learning/README.md) include byte-identical pinned source files, original regression tests, the upstream license, SHA-256 digests and Git blob IDs. The upstream agent/runtime code is retained for provenance only and is never imported or executed by the Bob runtime.

Bob also adapts the pinned `tools/threat_patterns.py` strict scanner for native curated-memory writes. [Scanner provenance and parity checks](assets/learning/memory-threats/README.md) retain original source bytes, hashes, Git blob IDs and the same MIT licence. Development differential tests execute only the vendored standalone standard-library Python scanner, not the Hermes agent/runtime. Bob runtime scanning is native TypeScript.

MIT License

Copyright (c) 2025 Nous Research

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


## Nunito

Bob bundles unmodified official Google Fonts **Nunito 3.602** static fonts, Copyright 2014 The Nunito Project Authors ([upstream](https://github.com/googlefonts/nunito)), under the SIL Open Font License 1.1. The [full license](apps/mobile/android/app/src/main/assets/fonts/nunito/OFL.txt), [integration/provenance guide](apps/mobile/android/app/src/main/assets/fonts/nunito/README.md), and [pinned download URLs and SHA-256 checksums](apps/mobile/android/app/src/main/assets/fonts/nunito/provenance.json) are shipped with the Android app. Nunito is the rounded UI/chat-prose family; Nordwand Mono remains the code/terminal family. Fonts are bundled offline; no runtime download is required.

## Android Voice Chat extraction

Android recognition/provider/language handling, activity-only handoff, TTS engine/language/rate/queue handling, final-speech automatic submission and automatic reply reading are adapted from [Omalauncher](https://github.com/SimonSchubert/omalauncher), **MIT, Copyright (c) 2026 Simon Schubert and contributors**. The exact owner-authorized dirty phone-source reference, original relative paths, full MIT licence/exclusions, dependency notices and verified per-file SHA256 inventory are retained in `apps/mobile/upstream/omalauncher/`. Base HEAD is `af07fb11e2b72337e2e189bb0f75eecba7ee5a04`; copied bytes are working-tree bytes, not that commit’s reconstruction.

Production adaptations are separately marked in `BobVoiceInput.kt`, `VoiceProviders.kt`, `BobVoiceRecognitionActivity.kt`, `BobSpeech.kt` and `apps/mobile/voice-chat.ts`. Bob’s existing React Native UI, authenticated selected chat, outbox, exact native completion receipts and playback/capture safety boundaries replace the launcher shell; no launcher UI, Compose, Linux/PRoot, local agent process, separately paired companion, logos or fonts are included by this extraction. The immutable upstream files are reference material, not Android build sources.

The complete upstream MIT text is also bundled in the APK at `assets/licenses/omalauncher-voice-MIT.txt`, with its exclusions retained at `assets/licenses/omalauncher-THIRD_PARTY.md`. Recognition/TTS providers are independently installed Android software, not bundled here; their licensing and network behavior are not covered by Omalauncher’s MIT licence.

Speech text uses the already bundled **markdown-it 14.3.3**, MIT, Copyright (c) 2014 Vitaly Puzrin, Alex Kocharin. Its licence is bundled at `assets/licenses/markdown-it-MIT.txt`. Reusing the Markdown grammar preserves visible labels, inline code and literal numeric operators without changing Copy’s original text; this is not a new Markdown renderer or a new downloaded dependency.
