# Bob operations

Read only for development/administration, not ordinary feature use. Reviewed against source on **2026-10-27**. Commands below are reference procedures, not authorization to stop services, change credentials, migrate data or deploy code. Source paths refer to a checkout; installed CLI packages contain compiled output.

## Architecture and state

```text
Android app ── authenticated HTTPS ── Bob backend / official Durable
                                          ├─ selected tool extensions
                                          ├─ configured model / memory / MCP services
                                          └─ authenticated independent peer backends
```

| Authority | Owns | Does not imply |
| --- | --- | --- |
| Official Durable (`durable.sqlite`) | Conversations, committed entries, documents, tasks and recovery | An exposed general scheduler or unlimited prompt context |
| Bob control store (`control.sqlite`) | Backend identity, configuration, credentials and device/peer grants | A replacement task/history engine |
| Backend artifact/custom-module directories | Original uploaded files and imported extension packages | All files in external working folders |
| Android private storage | Pairing credentials, scoped caches/drafts/outbox and offline Notes queue | Authoritative backend execution or complete history |
| Maintenance supervisor | Release/build lifecycle outside the process being replaced | Permission to rewind chat data |
| External services | Model inference, Hindsight, configured websites/MCP systems | Coverage by a Bob state backup |

An OS-backed exclusive ownership lock prevents a second runtime/recovery owner. Do not edit Durable tables, bypass the lock or run original/restored copies of one identity together. Tailscale supplies reachability, not Bob authorization. Remote endpoints require valid HTTPS; never disable certificate checks. Backend working folders and module selection are not security sandboxes.

## Development checks

Backend: Linux x86_64, Node.js `>=24.22.1 <25`; exact dependency versions are in the manifests/lockfiles. Durable, pi-ai and chord are pinned to `1.4.0`; do not silently upgrade them.

From a development checkout, with no release build in progress:

```sh
npm ci
npm run build
npm test
```

`npm test` includes `test/documentation.test.ts`: local guide links/heading anchors and tool-name coverage derived from source declarations plus upstream coding tools. Run just that check with `./node_modules/.bin/tsx --test test/documentation.test.ts`. It checks structural drift, not model comprehension or external URLs.

For Android/interactive changes, also run the relevant checks:

```sh
npm run build:interactive
cd apps/mobile
npm ci
../../node_modules/.bin/tsc --noEmit
npm test -- --runInBand
# Native Kotlin changes, when the local SDK/Java setup is available:
cd android
./gradlew testDebugUnitTest
```

For inline-visual regressions, `test/interactive.test.ts` also runs `test/inline-visual-lifecycle.ts` against the real host/opaque iframe in Chromium, sequentially with the existing browser test. With an already-running x86_64 Android emulator and Java/SDK configured, run `bash apps/mobile/android/inline-webview-test/run-emulator.sh emulator-SERIAL`. This opt-in harness compiles the production `BobInteractive.kt` and assets into a **separate test-only package**, never over Bob; it checks actual WebView painting/taps, natural sizing and grow/shrink, timeout/resize-ack fallback, overflow, and live data over a test-only authenticated loopback HTTP fixture (including input preservation, hidden-view pause and reconnect). It refuses physical phones. The harness also exercises the production inline React Native row in real Fabric/Hermes scroll and inverted-list views; only credential/icon chrome adapters are mocked. `App.test.tsx` separately covers history placement. Neither replaces a final installed-owner-phone chat test. Debug builds log only fallback reason and native viewport under `BobInline`, not HTML or bridge tokens.

These commands do not deploy. `build:interactive` generates the mobile host asset. Native tests and release compilation require Android SDK/Java; signed installation additionally requires the existing signing identity. Use `self_update` for production releases, not `npm start`, Metro or another development server. The supervised release path runs backend build/tests and, for Android targets, interactive/mobile compilation and signed release checks; do not assume it also ran every mobile Jest/native test.

Tests using deterministic providers exercise real Durable/SQLite/HTTP paths without proving live model compliance. Compilation does not prove phone behavior, TLS reachability, background delivery or GPS. State exactly which checks were run. Documentation-only changes normally need link/reference review, not deployment or model calls.

The consented diagnostic channel is implemented in `src/app-diagnostics.ts` (custom extension, strict report schema, task-bound receipts and additive `bob.diagnostic-requests` v1), `components/diagnostic-card.tsx` (native in-chat consent), and `ApprovedDiagnostics.kt` (bounded metadata-only export). It is composed at the host resources boundary without changing existing extension identities or task definitions. Authenticated per-chat responses enforce source-device, expiry and approval before upload; reports are appended atomically once and never exposed as HTML authority. Backend tests cover native tool/HTTP scope, replay/reopen, decline/cancellation/expiry and forbidden payloads; mobile tests assert capture cannot occur on arrival, decline, another phone, or failed approval. The emulator harness additionally verifies the native report bounds and versions. Preserve the separate document/history on rollback; never restore an old database.

## CLI and initial configuration

Use `node dist/cli.js --help` in the checkout or `bob --help` when installed. Always identify the intended `--state <absolute-directory>`; the default can come from `~/.config/bob/cli.json`, otherwise `~/.local/share/bob`. A wrong path can create a new identity rather than inspect the intended backend.

| Need | CLI path and prerequisite |
| --- | --- |
| Initialize an isolated backend | `bob --state <new-state> setup --cwd <existing-folder>`; no default model/credential is supplied |
| Provider API key | `provider --provider <openai-or-anthropic> --model <exact-id>` reads the key from **stdin**, not arguments/chat |
| ChatGPT subscription login | `login --provider openai --model <exact-id>`; complete Bob's browser flow on the backend machine; loopback callback port 1455, five-minute limit |
| Serve | `serve` defaults to loopback; remote `--host` must be a Tailscale IP with `--cert` and `--key` |
| Pair a phone | `connect --endpoint https://<machine>.ts.net:<port>` (`pair` alias); single-use expiring QR invitation |
| Manage device grants | `list`, `revoke <device>`; paired devices currently have broad backend conversation access |
| Diagnose | `doctor`; reports identity/configuration/owner and Chromium presence, not successful inference/browser launch |
| Unsupervised service setup | `service-install`, then explicit `start`/`stop`/`status`; see warning below |

Bob uses explicitly configured credentials, not another application's auth files. API-key replacement supersedes subscription credentials for that provider. Never copy keys/tokens into documentation, command arguments, prompts or logs. Backups containing stored credentials must stay private.

`service-install` creates a backend-specific systemd **user** unit. It does not enable startup/linger and does not expose TLS certificate/key options; it is not complete remote HTTPS provisioning. Boot-before-login needs separate owner-approved setup. These CLI controls are not a reason to stop/restart the **currently serving supervised backend**; use its maintenance path.

## Updates and recovery

### Normal supervised update

1. Use `self_update(action="status")` to check whether maintenance is configured and whether work is already building. Do not edit until an active build settles.
2. Make the authorized source change in the configured checkout. Review state/task compatibility and run relevant tests.
3. Request `self_update(action="update",target="backend"|"android"|"all")`. `build` only stages without backend activation. End the turn after queueing; no polling loop.
4. The external supervisor builds a candidate, checks compatibility, waits for foreground work, backs up before backend activation and verifies readiness. Build failure leaves running code alone; an unhealthy candidate returns to previous compatible code with current data retained.
5. Verify the returned status/card: **queued**, **built**, **backend active**, **APK ready** and **phone installed** are different outcomes. Android installation requires the owner's approval and in-place signing/version compatibility. Never uninstall to update.

Conversation-driven visual data uses the additive version-1 `bob.visual-data` document in `src/visual-data.ts`, composed into the interactive extension by `src/interactive.ts`. Existing `Interactive` records, MCP task definitions and history are unchanged; absent data means revision 0. Legacy code ignores the separate document. `test/visual-data.test.ts` covers native tool/HTTP scope, atomic revision conflicts, replay receipts, restart and legacy-code reopen; no compatibility fence or database rewrite is needed for this additive change.

`rollback` switches to the previous compatible backend code; it is not a database restore or automatic Android downgrade. Compatibility fences conservatively reject storage/task-bearing changes. Do not weaken a fence to make a build pass; an incompatible change needs an explicitly reviewed migration and recovery plan. Source edits during a build invalidate its candidate.

### Backup and disaster recovery

`backup <new-directory>` / `export <new-directory>` require a stopped runtime/exclusive ownership. They include Durable history/documents/tasks, control configuration/credentials/grants, uploaded artifact bytes and imported custom-module packages, with checksums. This is **sensitive full-state export**, not a redacted chat export.

Excluded: Android caches/drafts, external working folders, external TLS/signing material, systemd units, browser binaries, bundled runtime dependencies and external Hindsight data. Reinstall the exact compatible Bob package and provision excluded prerequisites separately.

`restore <backup> <new-state-directory>` verifies hashes/integrity and refuses an existing destination. It restores identity and grants too. Never activate both original and restored copies. Disaster recovery can lose work after the backup; require explicit acceptance of that loss. **Do not restore an older backup merely to roll code back.** The maintenance pre-activation snapshot is not a substitute for this full recovery/export procedure.

### Offline CLI upgrade / migration

The separate `bob update` path stages an independently validated local package/state, not an in-place self-update. It requires stopped, settled state, `--version`, `--package`, trusted `--sha256`, new `--installation`, `--destination`, `--backup`, and `--trust-release-code`. Installation is offline with npm lifecycle scripts disabled; dependencies must be cached. Original state and backup remain untouched. Cutover is explicit; no automatic restart and no arbitrary Durable upgrade/downgrade support. `bob migrate --backup <new-directory>` is the explicit supported control-schema migration path. Consult command help and `src/update.ts` before using either.

## Modules and integrations

### Capability selection

Bundled module IDs are `coding`, `resources`, `subagents`, `web`, `interactive`, `peers` and `memory`. Keep four states distinct: package available, backend installed, runtime registered, conversation selected. Backend defaults affect future chats; disabling a default does not strip explicit existing selections. The Android Modules section selects installed capabilities for the current settled chat. CLI `bob module list` is configuration evidence, not proof of live registration.

`bob module install|remove|enable|disable <id> --version <exact>` operates through paused/exclusively owned runtime maintenance; settle work first. Removal retains module documents/package archives and removes activation/selections. Do not remove definitions needed by pending tasks.

### Trusted custom extensions

Use only for separately authorized extension work. Custom code runs unrestricted as the backend account; this is not a marketplace or regular-Pi plugin loader.

`bob module import <id> <built-directory> --trust-backend-code --backup <new-directory>` imports local ESM code while stopped/settled. No downloads or npm scripts run; new imports are not selected by default. A compatible replacement additionally needs `--replace <exact-old-version>` and a fresh backup.

Required package contract:

- `type:"module"`, exact numeric `major.minor.patch`, `exports:"./dist/index.js"`; default export from official `defineExtension`.
- `bobExtension`: `api:1`, `durable:"1.4.0"`, positive `stateVersion`, exact extension `name`, and `requires` module IDs.
- Exact host dependencies: Durable/pi-ai/chord `1.4.0`, Bob core `0.1.0`; Durable is required. Other dependencies must be bundled into relative package files.
- Only `package.json` and regular non-hidden `dist/` files are copied, up to 256 files/16 MiB; no symlinks. Registration verifies integrity.
- Normal replacement preserves package/extension identity and stateVersion; it is not a schema migration.

Explicit schema migration uses `bob module migrate` with `--replace`, `--backup`, `--destination` and `--trust-backend-code`. The replacement exports `bobMigration={from,to,documents:[...]}` for exactly the next stateVersion, using extension-owned native singleton conversation document tokens and their `migrate(value,fromVersion)` functions. It runs only on a backed-up clone through public Durable APIs; original data remains untouched. Review `src/custom-migration.ts` and tests before use. A changed binary alone cannot roll back a data migration.

### MCP, peers and memory

- **MCP:** app MCP Apps or `bob mcp configure <id> --endpoint <url> --tools <exact,names>` explicitly grants tools. `bob mcp key <id>` reads a bearer credential from stdin. `list`, `enable`, `disable`, `remove` manage configuration. An endpoint must use verified HTTPS or explicit backend-loopback HTTP. Configuration does not prove a server/action works.
- **Peers:** app pairing normally establishes links between compatible reachable backends. CLI `peer grant/connect/revoke` remains for explicit scoped one-way trust; use its help and protect handoff files. Peers never merge histories or become owned subagents.
- **Memory:** owner configuration in `<state>/hindsight.json` enables the separate module; unconfigured backends make no memory calls. Its complete configuration reference is `packages/memory/README.md` in the checkout (the installed module also includes its README). Removing an override file is not disabling an already persisted configuration. Use memory status for current health, not old incident reports.

## Source map

| Concern | Implementation | Relevant checks |
| --- | --- | --- |
| Runtime/HTTP/auth/ownership | `src/runtime.ts`, `src/server.ts`, `src/state.ts`, `src/ownership.ts` | `test/authority.test.ts`, `test/integration.test.ts`, `test/crash.test.ts`, `test/tls.test.ts` |
| Tool contracts and instructions | `packages/*/src/index.ts`, `packages/core/src/contracts.ts` | `test/modules.test.ts`, `test/prompts.test.ts` |
| Notes | `src/notes.ts`, `src/notes-agent.ts`, `apps/mobile/notes-store.ts` | `test/notes*.test.ts`, mobile `notes-*.test.tsx` / `notes-store.test.ts` |
| History/peers/subagents | `src/conversation-network.ts`, `packages/peers`, `packages/subagents` | `test/local-history.test.ts`, `test/connected-network.test.ts`, `test/lifecycle.test.ts` |
| Memory | `packages/memory`, `src/memory.ts` | `test/memory.test.ts` |
| Views/files/web | `packages/interactive`, `apps/interactive/host.ts`, `src/artifacts.ts`, `packages/web` | `test/interactive.test.ts`, `test/mcp-http.test.ts`, `test/browser.test.ts` |
| Phone/notifications | `src/phone-location.ts`, mobile Kotlin `BobLocation.kt`, `BobNotifications.kt` | `test/phone-location.test.ts`, mobile/native location and notification tests |
| Updates/recovery/extensions | `src/maintenance*.ts`, `src/recovery.ts`, `src/update.ts`, `src/custom-*.ts` | `test/self-update.test.ts`, `test/recovery.test.ts`, `test/custom-modules.test.ts` |
| Android UI/outbox/cache | `apps/mobile/App.tsx`, `apps/mobile/components`, mobile outbox/history files | `apps/mobile/__tests__`, `apps/mobile/android/app/src/test` |

For a phone crash, **Settings → Copy app diagnostics** provides an owner-shareable on-phone report; do not assume backend logs establish the phone's exit cause. For any bug, preserve backend/conversation/request identity and reconcile committed state before repeating a possibly successful action.


## Diagnosing phone failures

Use the owner's **Settings → Copy app diagnostics** report. Schema 3 retains bounded memory/workload samples and sanitized JavaScript code positions in addition to existing lifecycle/crash/exit history. Distinguish Android backgrounding from confirmed process death, old versions from current, and allocation measurements from proof of a leak. Diagnostic capture never replaces normal failure handling and is best-effort.

Release assembly privately archives the exact composed Hermes map and bundle under ignored `docs/diagnostic-symbols/<versionCode>-<bundle-hash-prefix>/`, with APK/bundle/map hashes in `identity.json`. Match the report to the verified release before symbolication; positions use the engine's raw coordinate convention. Never publish those maps or use a different build's map. A source-map retention failure blocks release assembly. Do not assume a successful debug compile verified release artifacts or physical-phone capture.
