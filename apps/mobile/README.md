# Bob Android client

This is Bob's React Native/TypeScript client, with Kotlin integrations for pairing, attachments, isolated views, notification checks, on-demand location, manual reply read-aloud and diagnostics. Android is the supported target; the generated iOS scaffold is not a supported release.

Start with the root [application overview](../../README.md), [feature contracts](../../FEATURES.md) and [operations guide](../../OPERATIONS.md). Those guides are the maintained authority; do not infer production procedures from React Native's generated scripts.

## Local checks

After installing/building root dependencies, run from this directory:

```sh
npm ci
../../node_modules/.bin/tsc --noEmit
npm test -- --runInBand
```

For interactive-host changes, run `npm run build:interactive` at the repository root. Native Kotlin changes also need the appropriate Gradle unit tests (`cd android && ./gradlew testDebugUnitTest`) and release compilation with the configured SDK/Java toolchain.

## Production updates

Use Bob's `self_update` with target `android` or `all`, then end the turn. The supervised build produces the signed release; the owner approves in-place installation through **Build & install**. Do not run Metro/a development server against the production workflow, uninstall the app, or assume an available USB/emulator device is the owner's phone.

Backend work and history remain authoritative on the selected backend. Local drafts, caches, outbox identities and offline Notes edits must stay backend-scoped. Compilation/unit tests are not evidence of physical-device layout, GPS, notification delivery or installation; verify those separately when authorized.
