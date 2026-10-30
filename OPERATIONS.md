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
| Initialize an isolated backend | `bob --state <new-state> setup --cwd <existing-folder>`; no default model/credential is supplied |
| Provider API key | `provider --provider <openai-or-anthropic> --model <exact-id>` reads the key from **stdin**, not arguments/chat |
| ChatGPT subscription login | `login --provider openai --model <exact-id>`; complete Bob's browser flow on the backend machine; loopback callback port 1455, five-minute limit |
| Serve | `serve` defaults to loopback; remote `--host` must be a Tailscale IP with `--cert` and `--key` |
| Pair a phone | `connect --endpoint https://<machine>.ts.net:<port>` (`pair` alias); single-use expiring QR invitation |
| Manage device grants | `list`, `revoke <device>`; paired devices currently have broad backend conversation access |
| Diagnose | `doctor` inspects existing state without initialization; JSON checks with remediation hints. `doctor --check` exits 1 on configuration errors, 0 for warnings alone. No inference/browser launch or service-readiness test |
| Unsupervised service setup | `service-install`, then explicit `start`/`stop`/`status`; details below |

Doctor checks Node/platform, schema and identity, model/credential presence, working-folder access, Chromium and current runtime ownership. Running and offline states are both valid. Use `--check` for a nonzero exit on configuration errors; the default command returns a report with a successful exit. Model requests, TLS connectivity and optional integrations need their own checks. Reports omit credential values but include local paths/model names, so review before sharing. Doctor opens control data read-only; SQLite may create WAL/SHM sidecars, and the ownership check uses the lock database.

Configure credentials in Bob itself. Replacing a provider API key supersedes its subscription credentials. Read secrets from stdin or the login flow, and keep them out of command arguments, prompts, logs and documentation. Store credential-bearing backups privately.

`service-install` creates a backend-specific systemd **user** unit. Configure remote HTTPS certificates and any boot-before-login/linger setup separately with the owner. For an already-supervised backend, use the maintenance update path rather than these start/stop controls.

## Updates and recovery

### Normal supervised update

1. Use `self_update(action="status")` to check whether maintenance is configured and whether work is already building. Do not edit until an active build settles.
2. Confirm the configured checkout contains the version you want to install. Keep it unchanged while the build runs.
3. Request `self_update(action="update",target="backend"|"android"|"all")`. `build` only stages without backend activation. End the turn after queueing; no polling loop.
4. The external supervisor builds a candidate, checks compatibility, waits for foreground work, backs up before backend activation and verifies readiness. Build failure leaves running code alone; an unhealthy candidate returns to previous compatible code with current data retained.
5. Verify the returned status/card: **queued**, **built**, **backend active**, **APK ready** and **phone installed** are different outcomes. Android installation requires the owner's approval and in-place signing/version compatibility. Never uninstall to update.

`rollback` selects the previous compatible backend code while keeping current data; Android downgrades are separate. Compatibility fences reject storage/task changes that require migration. Review and authorize a migration rather than weaken the fence. Finish edits before building: source changes invalidate a candidate.

### Backup and disaster recovery

`backup <new-directory>` / `export <new-directory>` require a stopped runtime and exclusive ownership. The checksummed export includes Durable history/documents/tasks, control configuration, credentials/grants, uploaded artifacts and custom-module packages. Treat it as a private full-state backup.

The editable `core-prompt.md` in the state directory is independent of release packages; preserve it separately when backing up (the fixed backup/export manifest does not include it).

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
