# Bob architecture

A developer orientation map of the current source, not a deployment inventory or a replacement for reading the implementation. Start here before a cross-component change; follow the source and test references for exact behavior. Keep this guide synchronized when ownership, execution flow or trust boundaries change. Do not treat historical design notes as proof of current behavior.

For product workflows see [Features](FEATURES.md); for setup see [Installation](INSTALL.md); for verification and releases see [Contributing](CONTRIBUTING.md); for security reporting see [Security](SECURITY.md).

## System shape

```text
Android app
  | authenticated HTTPS: requests, snapshots and event streams
Linux backend
  | HTTP admission and device authorization
  | Pi Durable: conversations, submissions, tasks, documents and recovery
  | registered extensions: model tools, prompt sections, hooks and tasks
  +-- model providers
  +-- local files, shell and browser
  +-- optional memory service and configured MCP connections
  +-- authenticated peer backends
  +-- requests back to the paired phone
```

Bob is a Linux agent host with an Android client, not a hosted model service. Closing the app does not by itself stop backend work. Self-hosting does not mean all processing stays local: selected providers and optional integrations receive the data needed for their requests. Shell and file tools run with the backend OS account's access; a working directory or an agent instruction is not a sandbox.

## Code map

Source paths are repository-relative. Release packages contain compiled code rather than the entire source/test tree; use a checkout for these references.

| Area | Entry points and responsibility |
| --- | --- |
| CLI and installation | CLI (`src/cli.ts`), setup wizard (`src/setup-wizard.ts`), doctor (`src/doctor.ts`): configuration, startup, guided setup and diagnostics |
| Composition root | Runtime (`src/runtime.ts`): owner lock, compatibility floor, model adapters, registry, modules, Durable harness and recovery ordering |
| HTTP boundary | Server (`src/server.ts`), contracts (`src/contracts.ts`): authenticated device requests, validation, command admission and client views |
| Agent framework | The exact Pi Durable dependency in [package.json](package.json) owns scheduling and native persistence; Bob adds extensions rather than a second task engine |
| Extension selection | Modules (`src/modules.ts`), custom modules (`src/custom-modules.ts`): installation, defaults, conversation selection and manifest compatibility |
| Shared packages | Core (`packages/core/src/documents.ts`), resources (`packages/resources/src/index.ts`), plus coding, subagents, web, interactive, peers and memory workspaces |
| Android UI | App (`apps/mobile/App.tsx`), [mobile guide](apps/mobile/README.md), `apps/mobile/components/`: navigation, conversation UI and capability controls |
| Android platform layer | `apps/mobile/android/`: native services, permissions, notifications, phone integration and WebView hosting |
| Isolated visual host | Interactive host (`apps/interactive/host.ts`), backend integration (`src/interactive.ts`): generated visuals and configured MCP App surfaces |
| Tests | `test/`, `apps/mobile/__tests__/` and Android test sources: backend, client and native regression coverage |

A module's installed state, default selection, a conversation's selected extensions and its persisted delegation snapshot are distinct. Changing a backend default is not proof that existing chats received a new tool schema.

## From message to reply

1. The mobile outbox assigns an identity to a request and handles delivery/reconciliation. Inspect message outbox (`apps/mobile/message-outbox.ts`), outbox delivery (`apps/mobile/outbox-delivery.ts`) and snapshot stream (`apps/mobile/snapshot-stream.ts`) before changing reconnect behavior.
2. The server validates the authenticated request and checks for an existing submission under its device-scoped request ID. Repeated delivery must not mean repeated inference or repeated external effects.
3. Recognized owner commands, such as delegation commands, are handled before ordinary model submission. They can produce a persisted receipt without inference. Ordinary messages require a configured model and credential; delegation authorization and source-phone binding are recorded before submission.
4. `chat.submit` hands input and busy-mode behavior to Pi Durable. Its task engine invokes the configured model and registered tools. Bob extensions supply prompt sections, hooks, documents and background tasks. Codemode (`src/codemode.ts`) composes tool calls without giving the script arbitrary host access.
5. Native history and documents become client views through the server, conversation projection (`src/conversation-projection.ts`), mobile transcript (`src/mobile-transcript.ts`) and reply presentation (`src/reply-presentation.ts`). Projection is a read model, not a second authoritative conversation store.
6. Streams and reconnect snapshots update the phone. Connection streams (`src/connection-stream.ts`) and push (`src/push.ts`) have different jobs: a notification is not proof of transcript delivery, display or owner attention.

An admitted submission is not a completed answer. A completed tool call may only mean a request was queued or an Android intent was launched. Preserve these distinctions in receipts and UI wording.

## Temporary side conversations

`/btw` is a native client/server workspace, not a Pi TUI extension or a model-invoked tool. The mobile client (`apps/mobile/btw.ts`, `apps/mobile/components/btw-sheet.tsx`) intercepts the command before the ordinary outbox. Authenticated, conversation/device-scoped routes in `src/server.ts` use `src/btw.ts` for an independent tool-free model request. Sending the command to the ordinary message endpoint is rejected rather than steering or queueing the main run.

Each thread captures the current model and thinking level plus a bounded snapshot of recent committed user/assistant text. It excludes prompt sections, private reasoning, tool payloads, attachments, queued input and uncommitted live output; it is not a live copy of the provider's full context. The snapshot does not refresh automatically. A fixed BTW-only system instruction explains the read-only boundary; the main agent's instructions are never copied. Side questions incur additional provider usage and cannot mutate the main transcript or invoke tools.

Side threads, provider-call receipts and history are intentionally process-local, scoped, bounded and expire thirty minutes after creation. They are not a second Durable state store or restart-recoverable work. Stable request IDs deduplicate within a surviving thread; uncertain delivery is reconciled by reading that receipt, never by automatic paid resubmission. A lost thread epoch requires explicit new-thread creation. Side cancellation is independent of the main agent's stop action. Logically active side replies contribute to supervised update health until completion, cancellation or timeout; physically stuck adapters do not hold the update drain forever. Device-scoped explicit clearing can reclaim temporary threads whose UI handles were lost to view eviction or app restart. Closing the workspace hides it without cancelling an admitted side call; explicit Stop, discard, timeout, expiry and server shutdown fence late responses. Revision-aware polling returns a tiny unchanged response instead of repeatedly sending side history.

## State ownership

| State | Authority and boundary |
| --- | --- |
| Backend identity, device grants, provider/configuration settings | State (`src/state.ts`) and control migrations in `control.sqlite`; use supported setters and validators, not ad hoc database rewrites |
| Conversation history, submissions, tasks and extension documents | Pi Durable in `durable.sqlite`; use its transactions, document definitions and lifecycle APIs |
| Shared resource library | The runtime's root/library conversation; core documents (`packages/core/src/documents.ts`), resource skills and related metadata provide backend-wide knowledge |
| User-managed Notes | Notes (`src/notes.ts`), agent adapter (`src/notes-agent.ts`): library-scoped notebook, revisions, synchronization receipts and conflict behavior |
| Bounded declarative memory | Resource memory (`packages/resources/src/memory.ts`): USER/MEMORY entries, budgets, revisions and approval-sensitive proposals; not the notebook |
| Procedural skills | Skills (`packages/resources/src/skills.ts`): native content, metadata, supporting files, revisions and retained edit history; native supporting paths are document keys, not host files |
| Historical memory | Host adapter (`src/memory.ts`) and [memory package guide](packages/memory/README.md): external Hindsight service plus local durable integration state; separate from Notes and skills |
| Artifacts | Artifacts (`src/artifacts.ts`), file delivery (`src/send-file.ts`): retained bytes and authorized delivery; source workspaces are not conversation databases |
| Phone-local state | Client caches, outbox/drafts, Android permissions and platform receipts; not a replacement for backend history |
| Release/build state | Maintenance (`src/maintenance.ts`) and its loader, runner and build modules; separate from chat data and ordinary workspace files |

Do not assume a transaction spans control settings, Durable documents and an external service. For example, delegation commands (`src/delegation-command.ts`) use recoverable intents and revision checks across separate control and native commits. Preserve that recovery contract rather than claiming cross-store atomicity.

## Mounted mobile sessions

Menu presentation (`apps/mobile/menu-theme.tsx`) uses stable, side-effect-free palette contexts selected by the resolved app scheme: beige in Light mode and the existing dark palette in Dark mode. System follows device appearance through the root theme provider. Menu boundaries share the saved appearance preference controls but do not own persistence or native appearance effects. Menus scope NativeWind variables to their existing primitive hosts; explicit chat boundaries restore the original palette for embedded helper/side-chat transcripts. Chat palette tokens, retained component identity and special document/media/terminal content remain independent.

The mobile shell (`apps/mobile/use-session-shell.ts`) owns selection and retains two recent conversation workspaces by backend identity plus conversation ID (`apps/mobile/retained-sessions.ts`). An empty workstation browser does not consume either conversation slot. Selecting another retained conversation changes only visibility: its transcript list, draft input, loaded history, paused/following state and mounted controls remain owned by the same `SessionMain` instance in `apps/mobile/App.tsx`. Opening a third conversation replaces the least recently selected conversation view; there is no idle timer or battery-driven eviction.

Foreground read delivery (`src/snapshot-delivery.ts`) retains one in-flight projection/write and one replaceable latest native value rather than queueing full snapshots per token. Full snapshots remain authoritative on connection and after changes; unchanged three-second refreshes become tiny `heartbeat` events only for clients negotiating `heartbeats=1`. Legacy readers retain full-snapshot keepalives within their existing watchdog deadline. Clients additionally negotiating `patches=1` receive sequenced connection-local string splices when smaller than a full snapshot; the phone reconstructs the same authoritative JSON before normal identity checks and publication. A missing base, sequence gap or invalid range closes the read and reconnects for a full snapshot, never replaying mutations. Size-adaptive coalescing is a soft traffic reduction, not a strict byte budget. The mobile snapshot reader (`apps/mobile/snapshot-stream.ts`) counts heartbeats for liveness without publishing or caching them, and rotates XHR reads after ten minutes or eight million buffered characters; background suspension and real reconnect reconciliation remain separate.

Hidden workspaces keep their foreground read streams and full viewport geometry, with plain native visibility, touch and accessibility masks. Hidden motion, media playback and native scroll-follow work are suspended independently of snapshot publication. AppState background suspension closes foreground read sockets without unloading the retained views; foreground recovery opens fresh reads. Android process reclamation still requires persisted recovery. Long disconnects retain the existing paginated-history reconciliation rules rather than promising an unlimited continuous offline transcript.

One app-wide runtime (`apps/mobile/use-mobile-runtime.ts`) owns the outbox, delivery worker, native queue recovery, notifications and workstation network synchronization. The shell alone selects native phone-tool availability and the optional background connection. Session lifetime, transport generation and interactive visibility are separate: hidden instances may receive their own data, but cannot start new selected-session actions or steal navigation. Endpoint or re-pairing changes restart the affected read transport without changing conversation identity; aliases are display metadata only.

Draft writes (`apps/mobile/session-drafts.ts`) are ordered per scope across view eviction/remount, with unsaved in-process text kept on a storage failure. Staged chat attachments and conversation-settings drafts are also app-owned. Notes has one mounted owner per backend outside the conversation deck, including its editor and write queue; two chats on the same backend must never instantiate competing writers to the same Notes cache.

Downloaded chat caches are optional recovery data, not live-session ownership. The phone-wide policy and writer boundary (`apps/mobile/download-cache.ts`) own conversation-list and history cache preferences, chunk publication, exact-key inventory, UTF-8 payload accounting and persisted conversation recency. Snapshots and paginated history share a backend-plus-conversation quota identity. The default is 50 cached conversations, with a 128 MiB aggregate history-payload ceiling; selection and cache reads update recency, while hidden live writes do not. Legacy unchunked rows remain readable. Cache/settings read failures do not silently become writable defaults or stop authoritative network recovery. Preference reads share one cold load and bypass payload scans unless a policy mutation was already admitted. Small chunk-read batches limit native scan overhead; overlapping usage requests share a scan within the same cache generation. Settings and usage publish independently, with view-only read deadlines that expose retry without cancelling or releasing serialized storage operations.

Settings → Storage & cache (`apps/mobile/components/cache-settings.tsx`) provides category switches, offline conversation limits, usage and confirmed clearing. Clear/disable operations share the writer queue and advance a generation at admission; snapshot buffering, stored-history requests and conversation-list requests capture their producer generation so delayed work cannot resurrect a cleared copy. New activity may cache again when enabled. These controls never clear drafts, pending/queued sends, staged attachments, Notes recovery, pairings, selection or release downloads, and never unmount or disconnect retained workspaces. Native image/file preview storage is outside this policy because it shares lifecycle boundaries with staging and external opens. Opening a preview must not perform an age-based sweep of the shared camera/update directory; only a failed download owned by that invocation is deleted there. Reported bytes are managed value payload, not physical SQLite size or secure erasure; this change adds no application-level encryption.

## Execution, recovery and updates

Runtime startup (`src/runtime.ts`) acquires exclusive ownership and checks storage compatibility before opening native state. It installs registered extensions, restores persisted delegation schemas/provider aliases and reconciles retained commands before resuming tasks. Memory, learning, schedules and retired-conversation handling participate in startup ordering. Changing this order can strand work or resume it with different permissions.

Distinguish at least three kinds of activity:

- Foreground generation and its tool calls.
- Owned subagent work and pending conversation input.
- Background maintenance work such as memory retention, learning reviews and schedule drivers.

A visually idle conversation need not be settled. At present, `requireDelegationSettled` in delegation (`src/delegation.ts`) checks the live run, inbox and all nonterminal task categories, including sleeping tasks. A background task can therefore block a tool-snapshot refresh. Inspect task kinds and lifecycle evidence before proposing a fix; do not delete tasks, disable memory or bypass the guard as a generic workaround. Any narrower guard needs tests showing which work can safely coexist with schema changes.

Recovery (`src/recovery.ts`), ownership (`src/ownership.ts`) and migration floors (`src/maintenance-migration.ts`) enforce compatibility and exclusive state access. Backups contain sensitive configuration; recovery is not an ordinary code rollback mechanism. Never restore an older conversation database just to run older code.

The optional maintenance supervisor builds and validates releases separately from activation. Maintenance port (`src/maintenance-port.ts`), build (`src/maintenance-build.ts`), runner (`src/maintenance-runner.ts`) and reports (`src/maintenance-reports.ts`) connect requests, execution and chat status. Source fingerprints and compatibility checks matter. Backend activation must respect active work; Android installation requires the owner action. Building JavaScript, building an APK, activating a backend and installing on a phone are separate outcomes.

## Delegation and connected machines

Delegation configuration (`src/delegation-config.ts`) defines routes and profiles. Behavior (`src/delegation-behavior.ts`) and budget (`src/delegation-budget.ts`) define adaptive limits and permissions. Custom delegation (`src/delegation-custom.ts`) selects a supported authenticated model while retaining a base profile's boundaries; it is not an unrestricted endpoint or credential override.

Delegation snapshots keep a chat's exposed schema consistent. Saved backend settings do not silently replace all existing snapshots. Tool policies are bound to profile fingerprints: changing a profile requires rebinding its policy through supported setters. Check both configuration and conversation snapshot when a tool option is missing.

Subagents (`src/subagents.ts`) are owned helper work; peer configuration (`src/peer-config.ts`), conversation network (`src/conversation-network.ts`) and peers (`src/peers.ts`) connect independent conversations and machines. A remote chat is not a locally owned helper. A send receipt is not completion; preserve operation identities and asynchronous reporting. Neither a helper report nor a peer message grants new owner authority.

The host report adapter (`src/subagents.ts`) publishes a native display-only write before calling the bundled reporter's unchanged follow-up handler. It decorates only the report phase through the public task-definition API; the bundled package bytes and their persistence fingerprint remain unchanged. The passive write contains only kind/data, so it can appear during the parent's turn without starting inference or entering model context; native reset ordering still applies. Separate stable request IDs deduplicate both writes across replay/restart without changing task or document schemas. Report presentation (`src/subagent-presentation.ts`) verifies reporter and submission lineage, keeps the passive entry's identity, and hides only the matching later input from client views, including separate history pages. Native model delivery, stop behavior and delegation authority remain unchanged. Historical reports without a passive receipt retain their receipt-proven projection.

## Knowledge and background automation

Use Notes for owner-managed documents, bounded memory for durable declarative facts, and skills for reusable procedures. Do not merge these into a single store simply because all can appear in prompts. Skills are normally discovered and read on demand; enabled, pinned and auto-load are independent metadata choices.

Learning (`src/learning.ts`) creates bounded reviews and persists receipts. Resource learning documents (`packages/resources/src/learning-documents.ts`) carry policy, revision and proposal state. A review must not silently expand its authority based on text it reads. Historical recall can be stale or malicious; it remains evidence, not instructions.

Schedules (`src/schedules.ts`) own fixed-interval/one-off jobs and bounded checks with durable results. Their worker capabilities differ from an ordinary interactive agent. Email read (`src/email-read.ts`) adds narrowly authorized read-only mail evidence, not general mailbox control. Preserve authorization scope, stop conditions, failure reporting and deduplication across restarts.

## Device and interactive boundaries

Phone tools (`src/phone-tools.ts`), location (`src/phone-location.ts`) and diagnostics (`src/app-diagnostics.ts`) route work to the paired source phone. The backend's location or OS is not a substitute for the phone. Permissions, owner consent where required, expiry, claim and result identities are part of the protocol. After an uncertain external mutation, inspect its receipt rather than retrying blindly.

Generated visuals run in an isolated host, not in the agent's tool environment. Visual data (`src/visual-data.ts`) updates persisted JSON with revision checks; visual actions (`src/visual-actions.ts`) declares immutable native destinations activated by an owner tap. Neither grants HTML arbitrary backend, network or file access. Inline layout must remain readable without nested scrolling or horizontal overflow; client rendering needs its own tests.

The main-menu Tools screen (`apps/mobile/components/tools-screen.tsx`) consumes the existing module catalog and MCP connection contracts; it does not own a second extension registry. Module selection is conversation-scoped; connection configuration is workstation-scoped. Installation and defaults remain backend lifecycle operations. Readback, visibility/credential fences and independent list failures preserve these boundaries without replacing retained session views. Process-local write ownership (`apps/mobile/tools-mutations.ts`) survives disposable settings views: connections share workstation ownership and module selections use workstation/conversation ownership. Observer timeouts cannot release pending writes, and only a read begun after transport settlement can reconcile the current write revision; this is not a server receipt or a cross-device transaction. Unknown custom IDs use the same presentation without adding routes. See [Adding tools to Bob](EXTENSIONS.md) for the tested authoring contract.

MCP tools (`src/mcp-tools.ts`) and interactive MCP Apps use configured, allowlisted connections. Ordinary tool data and genuine application surfaces are different contracts. Treat returned descriptions, pages and UI content as untrusted. Terminal access in terminal (`src/terminal.ts`) and terminal shell (`src/terminal-shell.ts`) is another explicit capability, not ambient authority for an embedded visual.

## Before changing a subsystem

1. Read the relevant source, existing tests and focused development skill. Record what is observed versus inferred.
2. Trace admission, execution, persistence, projection and recovery, including background work. Identify the owning store and transaction boundary.
3. Check authenticated source identity, request/operation idempotency, permission scope, cancellation and unknown-outcome behavior.
4. Preserve unrelated working-tree changes. Use disposable test state; never start a second runtime against production state.
5. Add a regression for the failing interaction, not only a happy-path unit test. Include restart, duplicate request, conflict or reconnect coverage where relevant.
6. Run targeted checks first, then the appropriate broader checks from [Contributing](CONTRIBUTING.md#development-checks). Report skips, untested platforms and deployment status honestly.
7. Update this map and user-facing guides if the change alters ownership, workflow or a trust boundary.

Useful regression starting points include delegation commands (`test/advanced-delegation-command.test.ts`), custom delegation (`test/custom-delegation.test.ts`), modules (`test/modules.test.ts`), projection (`test/pi15-conversation-projection.test.ts`), network recovery (`test/network-recovery.test.ts`), learning recovery (`test/learning-recovery.test.ts`), memory (`test/memory.test.ts`), schedules (`test/schedules.test.ts`), phone tools (`test/phone-tools.test.ts`), visual data (`test/visual-data.test.ts`) and recovery (`test/recovery.test.ts`). These are navigation aids, not an exhaustive test inventory.

## Public documentation and privacy

This guide describes generic project architecture only. Keep personal names/contact details, machine identifiers, private hostnames, absolute personal paths, real chat or memory excerpts, credentials, pairing material, logs and installation inventories out of repository documentation and fixtures. Use synthetic examples when needed. Native skills and owner state are not automatically repository assets.

Before publication, review the actual diff and staged file list; ignore rules and pattern scans are not complete privacy guarantees. Adding documentation does not authorize committing, pushing, changing repository visibility or uploading state. Keep detailed local debugging evidence outside distributed material. See the [public-source boundary](CONTRIBUTING.md#public-source-boundary).

## Session inactivity policy

`src/session-activity.ts` observes public native commit publications and stores only derived per-conversation wall-clock activity in the existing control config store. Native input admission, foreground task progress and foreground transcript entries count; passive document writes and background watchers do not. A server-owned, non-overlapping minute sweep archives ownerless session groups after seven inactive days using the existing `SessionUI` flag. It rechecks native foreground tasks, inbox, live run and pinned flags in the archive transaction, protecting active descendants and pinned children as well as the root. No transcript/history is deleted. Legacy sessions without trustworthy activity metadata receive a seven-day observation grace; opening/reading history does not reset it, whereas explicit unarchive does. Maintenance is bounded and conservatively skips archiving when a complete ownership graph cannot be read. The service stops and awaits its in-flight pass before server shutdown.
