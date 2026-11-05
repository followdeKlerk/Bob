# Bob operations

Administration, updates and recovery for a Bob backend. For everyday workflows, see [Features](FEATURES.md). Paths refer to a source checkout; installed CLI packages contain compiled output. Confirm the intended backend and owner approval before changing services, credentials or data.

## Backend and saved data

```text
Android app ── authenticated HTTPS ── Bob backend / official Durable
                                          ├─ selected tool extensions
                                          ├─ configured model / memory / MCP services
                                          └─ authenticated independent peer backends
```

| Component | Stores or manages |
| --- | --- |
| Official Durable (`durable.sqlite`) | Conversations, committed entries, documents, tasks and recovery |
| Bob control store (`control.sqlite`) | Backend identity, configuration, credentials and device/peer grants |
| Backend artifact/custom-module directories | Uploaded files and imported extension packages |
| Android private storage | Pairing credentials, scoped caches, drafts, outbox and offline Notes queue |
| Maintenance supervisor | Builds and release activation outside the process being replaced |
| External services | Model inference, Hindsight, websites and MCP systems |

An OS-backed lock gives one runtime exclusive ownership of state. Keep only one original/restored copy of an identity active; use Bob’s maintenance commands rather than editing its databases. Tailscale provides reachability; Bob grants access through pairing and credentials. Remote endpoints require verified HTTPS. Tools and extensions use the backend account's OS permissions, including access outside a working folder.

## CLI and initial configuration

Use `node dist/cli.js --help` in the checkout or `bob --help` when installed. Always identify the intended `--state <absolute-directory>`; the default can come from `~/.config/bob/cli.json`, otherwise `~/.local/share/bob`. A wrong path can create a new identity rather than inspect the intended backend.

| Need | CLI path and prerequisite |
| --- | --- |
| Guided Linux setup | `bob setup --guided`; explicit terminal approvals, prerequisite/network/auth setup, standalone TLS user service and optional verified QR pairing; see [INSTALL.md](INSTALL.md#guided-installation). Running/managed backends are not reconfigured. |
| Initialize an isolated backend (scripted) | `bob --state <new-state> setup --cwd <existing-folder>`; no default model/credential is supplied |
| Provider API key | `provider --provider <openai-or-anthropic> --model <exact-id>` reads the key from **stdin**, not arguments/chat |
| ChatGPT subscription login | `login --provider openai --model <exact-id>`; complete Bob's browser flow on the backend machine; loopback callback port 1455, five-minute limit |
| Serve | `serve` defaults to loopback; remote `--host` must be a Tailscale IP with `--cert` and `--key` |
| Pair a phone | `connect --endpoint https://<machine>.ts.net:<port>` (`pair` alias); single-use expiring QR invitation |
| Manage device grants | `list`, `revoke <device>`; paired devices currently have broad backend conversation access |
| Diagnose | `doctor` inspects existing state without initialization; JSON checks with remediation hints. `doctor --check` exits 1 on configuration errors, 0 for warnings alone. No inference/browser launch or service-readiness test |
| Unsupervised service setup | `service-install`, then explicit `start`/`stop`/`status`; details below |

Doctor checks Node/platform, schema and identity, model/credential presence, working-folder access, Chromium and current runtime ownership. Running and offline states are both valid. Use `--check` for a nonzero exit on configuration errors; the default command returns a report with a successful exit. Model requests, TLS connectivity and optional integrations need their own checks. Reports omit credential values but include local paths/model names, so review before sharing. Doctor opens control data read-only; SQLite may create WAL/SHM sidecars, and the ownership check uses the lock database.

Configure credentials in Bob itself. Replacing a provider API key supersedes its subscription credentials. Read secrets from stdin or the login flow, and keep them out of command arguments, prompts, logs and documentation. Store credential-bearing backups privately.

`service-install` creates a backend-specific systemd **user** unit. Configure remote HTTPS certificates and any boot-before-login/linger setup separately with the owner. The guided `setup --guided` path instead writes an explicitly approved TLS-aware user unit, refuses conflicting existing units, and can request lingering separately. It stores listener/TLS-path metadata in `setup-connection.json`, never certificate key contents. Certificate renewal is manual; no renewal timer or maintenance supervisor is installed. For an already-supervised backend, use the maintenance update path rather than these start/stop controls.

## Updates and recovery

### Normal supervised update

1. Use `self_update(action="status")` to check whether maintenance is configured and whether work is already building. Do not edit until an active build settles.
2. Confirm the configured checkout contains the version you want to install. Keep it unchanged while the build runs.
3. Request `self_update(action="update",target="backend"|"android"|"all")`. `build` only stages without backend activation. End the turn after queueing; no polling loop.
4. The external supervisor builds a candidate, checks compatibility, waits for foreground work, backs up before backend activation and verifies readiness. Build failure leaves running code alone; an unhealthy candidate returns to previous compatible code with current data retained.
5. Verify the returned status/card: **queued**, **built**, **backend active**, **APK ready** and **phone installed** are different outcomes. Android installation requires the owner's approval and in-place signing/version compatibility. Never uninstall to update.

Failed chat-requested jobs are also admitted as `bob.maintenance-result` follow-ups to the original owner conversation through the existing native Durable runtime. This relay is independent of FCM and checks the bounded maintenance journal every two seconds. It baselines historical failures once, persists its observation cursor in control settings, and uses stable native request IDs so admission followed by an interrupted cursor write cannot duplicate model turns. It catches failures recorded while the backend was offline on reopening; successful jobs are not consumed because a later activation/handoff error may change them to failed. No raw log text or credentials are injected, no new owner/delegation authority is granted, and no build is automatically retried. Missing/source-less/owned-worker destinations are not replaced with another conversation. The notification can trigger model usage; native admission does not prove model completion or phone delivery. This feature only operates after its backend code is successfully activated.

`rollback` selects the previous compatible backend code while keeping current data; Android downgrades are separate. Compatibility fences reject storage/task changes that require migration. Review and authorize a migration rather than weaken the fence. Finish edits before building: source changes invalidate a candidate.

The [Pi Durable 1.5 migration gates](PI15-MIGRATION.md) describe the preparatory Pi 1.4 supervisor bridge, exact reviewed transition allowlist and forward-only downgrade barrier. The bridge ships with that allowlist empty: its installation alone does not migrate native state or enable the 1.5 crossing.

### Scheduled work

Schedules use additive native session/conversation documents (`bob.schedules`, `bob.schedule-worker`) and `bob.schedule-driver` v1 in the resources extension. No second scheduler, shadow database or OS cron service is introduced. Existing document/task definitions and control schema are unchanged. The standard Durable backup includes schedules and their recovery checkpoints.

Keep resources installed while schedules exist. Before reverting to a release without these definitions, cancel/settle schedule work first; never restore an older database to roll code back. A missing/blocked driver is not proof that a schedule is running. On startup Bob reconciles obsolete/paused/cancelled drivers and requests their abort before resuming normal scheduling. Healthy active drivers resume their saved phase/deadline. Scheduling endpoints require ordinary paired-device authentication and backend identity. Android delivery uses optional generic FCM attention signals with polling fallback, never server-confirmed notification delivery.

### Firebase push delivery

FCM is optional. Create a Firebase project, register Android package `com.bobmobile`, and download `google-services.json`. Keep that Android configuration outside Git at `~/.local/share/bob/firebase/google-services.json`, or set `BOB_FIREBASE_CONFIG` in the Android builder's environment. It supplies public SDK resources, not server credentials. A build without the file retains polling-only notification support. Google Analytics, a Firebase database and Firebase Hosting are not needed.

Enable the Firebase Cloud Messaging API (`fcm.googleapis.com`). Use a dedicated service account with the `roles/firebasecloudmessaging.admin` role, not project Owner/Editor. Store its service-account JSON privately outside the repository, owned by the backend OS account with mode `0600`. In the **intended backend state directory**, create `firebase-push.json` (also mode `0600`):

```json
{"projectId":"YOUR_FIREBASE_PROJECT_ID","serviceAccountFile":"/absolute/private/sender-service-account.json"}
```

The Android configuration and backend sender must use the same Firebase project. Never put a service-account private key in the APK, Git, a chat message, CLI arguments or logs. Restrict access to the containing directories. Back up both configuration and credentials separately and securely; external Firebase files are not included in Bob's normal state export. Rotate/revoke service-account keys through Google IAM when necessary. Provisioning or key rotation is separate from source deployment.

After deploying the configured backend and installing the Android build, open Bob with notifications allowed. The paired app registers its current FCM token using authenticated `POST /v1/push/register`; deletion uses the same endpoint with `DELETE`. The token is transport metadata in the existing control store, not conversation/read authority. Revoked device grants are excluded from sends. Token rotation and removed pairings are reconciled by Android; stale hints from unknown backends are ignored.

The backend observes newly committed owner-facing replies, questions and schedule alerts without replaying historical chats. A small relay observes the existing maintenance journal for newly completed/failed builds. Sending has a bounded, five-minute, coalescing transport queue; its commit-to-queue handoff is best-effort, and a crash after provider acceptance may resend a generic hint. No new task definitions, scheduler or conversation database are introduced. HTTP acceptance by FCM does not prove phone delivery.

Verify on a real phone: foreground suppression; a new notice while locked on Wi-Fi and mobile data; multiple events updating one notice without previews/Reply actions; permission/channel-disabled behaviour; token refresh; backend restart; pairing removal; and preservation of unresolved legacy notification-reply feedback. Do not infer Doze or SystemUI behaviour from JVM/JavaScript tests alone.

### Backup and disaster recovery

`backup <new-directory>` / `export <new-directory>` require a stopped runtime and exclusive ownership. The checksummed export includes Durable history/documents/tasks, control configuration, credentials/grants, uploaded artifacts and custom-module packages. Treat it as a private full-state backup.

Only the generic `packages/resources/soul.default.md` template is published. The editable, Git-ignored `soul.md` in each installation’s state directory is independent of release packages; preserve it separately when backing up (the fixed backup/export manifest does not include it). On upgrade, existing `core-prompt.md` contents seed `soul.md` without overwriting either file; `soul.md` then takes precedence and the legacy file remains for older releases. Maintenance transition snapshots include both names when present.

Excluded: Android caches/drafts, external working folders, external TLS/signing material, systemd units, browser binaries, bundled runtime dependencies and external Hindsight data. Reinstall the exact compatible Bob package and provision excluded prerequisites separately.

`restore <backup> <new-state-directory>` verifies hashes/integrity and requires a new destination. It restores the identity and grants, so keep only the recovered copy active. Confirm acceptance of work lost since the backup before recovery. Use code rollback—not an older database—for release reversions. The maintenance pre-activation snapshot covers a different scope from the full export above.

### Offline CLI upgrade / migration

`bob update` stages a validated package and state copy for offline upgrades. It requires stopped, settled state, `--version`, `--package`, trusted `--sha256`, new `--installation`, `--destination`, `--backup`, and `--trust-release-code`. Dependencies must be cached; npm lifecycle scripts stay disabled. The original state and backup are retained, and cutover is explicit. For control-schema migration use `bob migrate --backup <new-directory>`. Check command help for supported versions.

## Modules and integrations

### Capability selection

Bundled modules are `coding`, `resources`, `subagents`, `web`, `interactive`, `peers` and `memory`. A capability passes through package availability, backend installation, runtime registration and conversation selection. Defaults affect future chats; existing explicit selections remain. Android's Modules section changes the current settled chat, while `bob module list` shows backend configuration.

`bob module install|remove|enable|disable <id> --version <exact>` operates through paused/exclusively owned runtime maintenance; settle work first. Removal retains module documents/package archives and removes activation/selections. Do not remove definitions needed by pending tasks.

### Trusted custom extensions

Custom extensions load trusted backend code with the OS account's permissions. Review the code and obtain owner authorization before importing it.

`bob module import <id> <built-directory> --trust-backend-code --backup <new-directory>` imports local ESM code while stopped/settled. No downloads or npm scripts run; new imports are not selected by default. A compatible replacement additionally needs `--replace <exact-old-version>` and a fresh backup.

### Advanced Delegation configuration

Before reverting to a release without Advanced Delegation, settle helper work and revoke standing continuation authority. Likewise, finish active code-mode calls before reverting to a release without code mode. Keep current chat data throughout rollback.

Use the backend's explicit `--state` path. Configuration patches are strict JSON: supplied top-level fields replace those fields, and a supplied route/profile block replaces that block. Unrelated settings stay intact. The CLI validates the provider catalog, credentials and supported options before saving; then test the chosen route with a real request.

```sh
bob --state /absolute/backend/state delegation config --show
bob --state /absolute/backend/state delegation config --set /absolute/routes.json
bob --state /absolute/backend/state delegation config --mode model_map
# A dedicated credential is read from stdin, never argv or the JSON file:
bob --state /absolute/backend/state delegation secret reviewer-key
```

Example `routes.json` (replace the model with an exact available ID and choose a supported effort):

```json
{
  "mode": "model_map",
  "modelMap": {
    "options": [{
      "name": "review",
      "description": "Independent review of completed work.",
      "provider": "openai",
      "model": "<configured-model-id>",
      "reasoning_effort": "high"
    }],
    "default": "review"
  }
}
```

`defaultRoute` is a route object or `null`. `modelMap` contains `options` and an optional `default`; `profileRoutes` contains allowlisted `{name,description}` entries under `profiles` and an optional `default`. The separate top-level `profiles` list defines `{name,route,instructions,skills,cwd,modules}`. Profile credentials must be explicit: `route.credential` is `{kind:"secret",name:"reviewer-key"}` or an explicitly selected `{kind:"provider",provider:"openai"}`. Profiles cannot select subagents; selected skill bodies are captured at spawn, with Bob's safety sections retained even without resource tools. A missing selected skill/module refuses spawn. Model routes may omit `credential` to use their named provider's existing Bob credential. No ambient Hermes credential discovery occurs.

Custom OpenAI-compatible routes declare `endpoint:{baseUrl,api,contextWindow,maxTokens,thinkingLevels}` (`api` is `openai-completions` or `openai-responses`) and require a dedicated secret reference or explicit `{kind:"none"}`. HTTPS is required except loopback HTTP; URLs cannot contain user information, query strings or fragments. Backend provider credentials are never forwarded to custom endpoints. Endpoint model/capability declarations are owner-supplied, not remotely discovered or verified.

`service_tier` supports `normal` (default) and `fast`. Fast requires native OpenAI Responses with API-key auth and a confirmed priority response. Unsupported tiers, credential pools, fallback-provider lists and Hermes-specific fields return validation errors. Configure Bob through JSON/CLI; see [attribution](THIRD_PARTY_NOTICES.md) for the upstream adaptation.

Adaptive delegation is configured separately from the frozen routing/profile v1 format. It defaults to off; routing/profile selection never grants standing consent. Use `bob --state /absolute/backend/state delegation behavior --show`, `--enabled on|off`, or `--set /absolute/behavior.json`. A patch can set `enabled`, `maxActive` (1–8, default 4), `maxDispatches` (1–32, default 12) and `profileTools`. For example, `"profileTools":{"reviewer":["read"]}` binds that exact tool selection to the currently saved reviewer's fingerprint. Save profiles first; changing their identity requires an explicit tool-policy rebind. Omitted keys are preserved; supplying `profileTools` replaces that map. Exact native `tools` selections restrict direct and nested calls; a policy containing `bash` is not read-only or an OS sandbox. Child policy is captured separately, and missing/mismatched policy fails closed.

Existing chats do not adopt saved profiles or tool scopes implicitly. Use a new chat or the explicit, settled `/delegation profiles --now` refresh. Adaptive profile mode rejects an unprofiled parent fallback from a stale/default snapshot; default-off manual behavior remains available. Helper names used for new work must be nonblank and non-reserved.

Denial, Stop/revoke, changed configuration and newer owner input end continuation authority. Forks start without inherited grants; restarts retain budgets. Use tree stop to cancel helpers already running.

`/delegation auto status` checks configuration and scope without inference or replacing the scope. Plain “Status” is a new owner input, so outstanding reports can finish but cannot authorize another phase. `revoke` ends this chat's authority; `on`/`off` set standing consent for future tasks and revoke the earlier scope. Use tree stop to cancel already-running helpers. Scope checks use recorded lineage, not helper names or report text.

When old/new-scope sends coalesce into one answer, native deduplication may associate it with the older Reporter. Continuation then ends; a new owner task can authorize further work.

The app’s slash-command picker lists the commands available on the selected backend and inserts an editable draft.

`--now` requires the conversation to be settled. If work begins during a configuration change, the reply distinguishes the saved setting for future work from an unapplied current-chat change.

### MCP, peers and memory

- **MCP:** `bob mcp configure <id> --endpoint <url> --tools <exact,names>` explicitly grants tools; owner-requested setup can be performed by the assistant without updating the app. MCP configuration has no navigation tab. `mcp_tool` discovers/calls ordinary tools; `mcp_app` separately opens genuine MCP Apps resources. `bob mcp key <id>` reads a bearer credential from stdin. `list`, `enable`, `disable`, `remove` manage configuration. An endpoint must use verified HTTPS or explicit backend-loopback HTTP. Test a configured connection with a read-only call.
- **Peers:** app pairing normally establishes links between compatible reachable backends. CLI `peer grant/connect/revoke` remains for explicit scoped one-way trust; use its help and protect handoff files. Peers never merge histories or become owned subagents.
- **Memory:** owner configuration in `<state>/hindsight.json` enables the separate module; unconfigured backends make no memory calls. Its complete configuration reference is `packages/memory/README.md` in the checkout (the installed module also includes its README). Removing an override file is not disabling an already persisted configuration. Use memory status to check current health.

## Diagnosing phone failures

Start with **Settings → Copy app diagnostics** on the phone. The report includes bounded memory/workload samples and sanitized crash/exit history. Match each event to its app version, distinguish backgrounding from process death, and examine memory trends rather than a single high reading. Capture may be incomplete during memory exhaustion.

Include the backend, conversation and request IDs when reporting a problem. Before repeating an action with an uncertain outcome, check whether it already completed.

### Read-only scheduled GMX email

The resources module exposes `email_read` through the existing authenticated Himalaya account `gmx` at `/home/ndk/.local/bin/himalaya`. No credentials/configuration are returned. Commands are fixed read-only argument vectors without a shell; reads omit `--seen`. Missing executable/account/network, invalid responses, size limits and timeouts are failures, not empty results. Attachments are not saved or exposed; HTML is reduced to text, never rendered or fetched. Redaction is best effort: mail bodies/authentication headers remain untrusted evidence and remaining secrets must not be repeated.

Schedules must explicitly opt in with `emailAccess:true`; `emailMailboxes` is the enforced folder allowlist (default Inbox, Spam, Archive). Existing schedules remain email-disabled without edits. Every authorized folder must have a fully paginated search before a non-failure result. `bob.email-reads` stores bounded per-conversation metadata and read evidence; `bob.email-delivered` stores up to 10,000 source keys per schedule. The latter is updated in the alert transaction, not at scan time or phone delivery. Failed/partial searches and unreadable/truncated relevant bodies fail closed. Native documents are additive; existing schedule documents accept absent email fields, requiring no database restoration or destructive migration.

### Conversation notifications and direct reply

Android builds conversation-style notices from the existing operation-status and schedule-alert endpoints. Bob adds bounded `conversationTitle` response metadata and current schedule-target `questionPending` state via supported document snapshots; no Pi Durable source, document schema, database layout or scheduler changes are required. Notification tag identity includes both backend and conversation. A bounded encrypted phone preview cache is presentation-only, not transcript/read/delivery/question-state authority. Pending or unknown question state omits Reply; a notification-origin worker also checks the existing operation response before posting. Normal polling completion never revokes a pairing or cancels the notice just delivered. Context changes and publication share a lock; viewed suppression settles rather than retrying. Install notices remain separate.

Incomplete retained input keeps the same recoverable request identity beyond the normal empty-action expiry, but never survives revocation as authorization to a new pairing. A later notification offers retry of that retained input rather than replacing it. Old accepted-send watches cannot overwrite a newer pairing. Background reply statuses share the context/publication lock and do not reappear for viewed chats or replaced pairings. Direct failed-input feedback uses a separate notification identity from asynchronous delivery, preserving its unqueued meaning and text when the earlier send later changes status. It remains visible so new text on a consumed action is explicitly reported as not queued, never silently treated as sent.

Native RemoteInput replies reuse the encrypted outbox and existing authenticated message/operation APIs with stable request identities. They do not start an activity or React Native to send, bypass question-option validation, or bypass Bob’s existing delegation policy. The app recovers native sends on startup/resume and native change events. OS acceptance of a notification and persistence of a send are not human-view or server-delivery receipts. No push service, new universal event feed or generic foreground service is introduced. Device checks should include a locked phone/unlock, app process recreation, offline/reconnect, pairing rotation, concurrent incoming notices, large text and disabled notification channels.

### Native learning state and recovery

The resources module includes Bob's curated memory, on-demand skill packages and learning controls. `bob.library` v1 remains the authority for existing skill bodies; additive native sidecars hold metadata, supporting files, read receipts, bounded memory and audit history. No previous chat, Notes, Hindsight bank or task schema is replaced. Old releases ignore the new documents, so rollback does not restore an older database. A rollback to old code will not expose new skill metadata or background-task definitions; settle learning work before removing the resources module.

`bob.learning.settings` defaults to automatic review enabled, memory interval 10, skill interval 10, at most 16 model rounds and a 120-second review deadline. `learning` status/configure is the owner-facing control. Each source conversation has counters and idempotent submission receipts. `bob.learning.installation` establishes an activation boundary so installing the feature does not silently review every historical conversation. A queued review is a native `bob.learning.review` task with a task-owned child, stable request identity and a restricted callable tool set; review children cannot launch further reviews or delegate. Canonical owner input is distinguished from peer and task-owned input. Actual artifact changes, staged proposal IDs, failures and explicit `/refine` results are recorded as passive source-chat metadata; automatic no-signal reviews stay silent. Automatic evidence excludes turns whose persisted learning policy was disabled, not just `#nomem`/`#skip` text. Skill and memory tool mutations commit a per-task result receipt atomically with the artifact write, covering the replay-safe commit-to-tool-settlement crash window.

Automatic reviews yield to new foreground turns. Explicit `/refine` and consolidation reviews continue across ordinary follow-up messages, so asking for status does not cancel them. A fresh `/refine` supersedes the active review; conversation-tree Stop still cancels background work. Disabling automatic learning does not cancel explicitly requested reviews. This explicit-review continuation is a deliberate Bob lifecycle adaptation; the pinned upstream cancels reviews on live turns.

Review workers can read and modify native skill/memory artifacts; shell, browser, network mutation, scheduling and delegation tools are not part of their callable set. The existing Hindsight module retains its own configuration and state. Native reference/template/script files are stored as document content: loading a script does not execute it or create a filesystem copy.

Pinned learning source and the reproducible prompt adaptation are shipped under `assets/learning/`. Run `python3 assets/learning/port.py` to regenerate prompts, then the learning tests and normal backend checks. Legal upstream attribution is retained; operative prompts use Bob tool names and storage concepts.

Optional semantic skill consolidation is off by default. `learning` action `consolidate` queues an explicit restricted curator pass (ten-minute deadline), using the pinned curator prompt and a host-enforced candidate set. Native package ledgers replace filesystem backup snapshots. Original filesystem/hub/plugin installers, scanner integrations, full YAML metadata parsing and optional global write-approval switches are not part of this Bob-native port; default review behavior and the original unattended destructive-memory proposal gate are retained.


### Learning controls and coverage boundaries

- `learning(enabled=false)` disables automatic review triggers and cancels unfinished automatic reviews. Explicit `/refine` and explicitly requested consolidation remain available. Setting one interval to zero disables only that trigger.
- Deterministic skill aging is a separate idle-triggered maintenance path; disabling automatic review does not disable it. It considers only unpinned, background-created managed skills. Pinning protects a package; archive is reversible. Curator status/run is exposed through `skill_manage`; public threshold configuration, pause/adopt controls and automatic semantic consolidation are not implemented.
- The review input is bounded to a recent entry window and a textual budget (500 recent entries, 60,000 characters overall, 12,000 characters per entry). Boundary recovery preserves consent/opt-out context; it does not restore all omitted history. Reasoning and binary content are excluded. A completed review is not proof that the entire conversation was examined.
- Memory budgets remain fixed at 1,375 user-profile and 2,200 environment characters. Normal review defaults remain 16 model rounds and 120 seconds; an explicit consolidation has a ten-minute deadline. These are bounded operations, not continuous trainers.
- Native package ledgers retain at most 10 changes and are also size-bounded (2 MiB). Retained snapshots support rollback; they are not unlimited content-addressed backups. Old chats, Notes and external Hindsight stores remain independent.
- Skill selection is model-mediated. Advertising a skill in an index and allowing `skill_view` establishes availability, not successful application. Use bounded real-model relevance/reuse evaluations alongside deterministic storage and lifecycle tests, and report their sample size and misses.


### Native skill metadata contract

Native `description`, `category`, `tags`, `version`, `author` and `platforms` fields are the routing metadata authority. Markdown frontmatter remains authored content; the limited initial one-line description fallback is not a YAML importer. Updating a description or tags means supplying the native metadata fields, not only patching similarly named text in `SKILL.md`. Unsupported YAML conditions do not silently become enforced tool, app, environment or credential checks. Such readiness dependencies require foreground verification before applying a skill.

Platform applicability concerns the backend executing the skill, not the paired phone. Explicit inspection remains available for non-applicable packages; default routing and automatic body injection must not suggest that a platform-specific procedure is ready on another platform. Empty platform metadata means no declared platform restriction, not proof of all dependency readiness.


### Curated-memory write scanning

New memory entries and complete patched entries are checked against the pinned Hermes strict threat-pattern set before persistence or proposal staging. Approval replays the same checks, so a pending proposal is not a bypass. Scan normalization is applied only to a copy; accepted fact text and exact replacement whitespace are preserved. Refusals identify a pattern, not a guarantee that malicious content is otherwise impossible. Normal facts remain direct writes; this does not add a blanket approval gate.

The scanner is a heuristic and can reject benign descriptions that contain upstream strict attack patterns. Existing entries are not silently rewritten, removed, or retroactively quarantined by this upgrade; untrusted-reference treatment remains in place, and explicit removal remains available. This is write-time parity, not a port of upstream filesystem-load sanitation or a complete prompt-injection defense. Provenance and differential fixtures live in `assets/learning/memory-threats/`.


### Visible learning completion receipts

`bob.learning-status` remains passive stored metadata, not a new model message or owner input. The app renders valid completed/failed/cancelled notices as plain, selectable, wrapped chat text rather than hiding them behind a disclosure. Older valid learning-status entries also become visible with the updated app; they retain their original text.

Skill mutations atomically record name, action, revision and supporting path when the package changes. Foreground mutations emit a notice only in their owner conversation, not the shared library or task-owned chat. Background workers accumulate details and the review driver emits a compact aggregate after completion/failure/cancellation. Tool-task receipts prevent duplicate mutations and notices after replay/restart; transaction rollback also rolls back notices. Reads, revision conflicts and no-op saves do not claim changes. Legacy worker records without detailed action receipts use a generic “changed” fallback rather than inventing a specific action.

Automatic no-change reviews stay silent; explicit reviews report no saved changes when appropriate. Model-authored review replies remain available in learning status diagnostics but do not author the saved-result notice. Memory proposals remain visibly pending approval, never described as applied. Large skill summaries are bounded at action boundaries with an explicit additional-change count; full structured changes remain in native metadata. This is chat visibility, not a promise of push delivery or on-device display before the Android update is installed.

## Tool-schema library conversion

See [Tool-schema builder conversion](SCHEMA-MIGRATION.md) for the exact same-format compatibility alias, preserved input rules and supervised two-stage deployment. This does not rewrite the Pi 1.5 migration floor or native state.
