# @bob-local/memory — Hindsight for Pi Durable

A separately packaged, removable native extension for **official Pi Durable 1.4.0**. No fork, patches, monkey-patching, private imports, or access to upstream SQL tables. Hermes is not a runtime dependency. HTTP uses Node's native fetch; no Python/SDK subprocess is installed.

## Behaviour

- Fresh synchronous automatic recall from `bob` and `hermes` before answering each ordinary owner input. Cache across tool rounds and use Durable hook memos for request replay. Requests time out/fail open; one unavailable bank does not hide another's results.
- Bounded/deduplicated historical reference messages injected for the current model request only. They are not system instructions or transcript entries. Current instructions/evidence override stale memory. Default recall types include observations **and raw world/experience facts**, to preserve reach into older Hermes memories; the server prefers consolidated observations where available. Score floors are configurable, not assumed calibrated.
- Automatic retention of **canonical owner user text + final assistant text** after committed successful settlement. The generic module admits `pi.user` by default; Bob's trusted host adapter explicitly also admits its app's `bob.user` entry kind. This exact allowlist is shared by recall and retention; arbitrary custom/peer kinds are never admitted. No raw tool outputs, reasoning, images, system prompts, UI display hints, peer/custom inputs, task-owned/background conversations, compaction summaries or replayed recall blocks are exported. Memory-tool inspection/control turns are excluded to avoid feedback/duplication.
- Writes only to `bob` by default. The legacy `hermes` write-bank name is refused; existing historical data is never renamed, imported, overwritten or deleted by this module.
- Durable save intent, stable document/operation identities and asynchronous operation polling. Lost acknowledgements/transient retries reuse the same idempotent operation. Server extraction completion is distinguished from queue admission. Server-side processing warnings, including child-operation failures, are shown in receipts.
- A startup catch-up scan of committed submissions closes the settlement→outbox crash window. Receipt families deduplicate capture. First installation establishes a boundary and does **not** bulk-export old conversations. Consent is checkpointed per input: re-enabling later cannot export a turn made while saving was off; a `#nomem` steer revokes retention for other inputs sharing its answer.
- A failed connection retries up to five times with exponential backoff. Terminal server failures remain visible for an explicit retry; the server also has its own extraction retry policy. A server-retry mutation with an uncertain acknowledgement is not automatically repeated.

## Owner configuration in Bob

Place `hindsight.json` in the backend state directory (mode 0600), then activate a compatible backend release through normal maintenance:

```json
{
  "enabled": true,
  "baseUrl": "http://127.0.0.1:8888",
  "writeBank": "bob",
  "recallBanks": ["bob", "hermes"],
  "recallTimeoutMs": 10000,
  "requestTimeoutMs": 20000,
  "maxTokens": 1600,
  "budget": "mid"
}
```

The validated owner configuration is also persisted in Bob’s control store, so standard backups/restores preserve it even without the override file. Environment-provided keys remain external and must be restored separately. Removing the override file is not a disable action; set `enabled:false` explicitly.

Unconfigured backends default to disabled and make no Hindsight calls, including in tests and release verification. The host provisions the module for existing owner conversations once when enabled, preserving all other selections. Afterwards ordinary per-conversation module selection remains authoritative. New conversations inherit the module's configured host default. Setting `enabled:false` cancels unsent automatic work when its task runs; operations already sent may still finish. Removing an active module is refused by Bob's normal unsettled-work guard.

Optional configuration: `types`, `minRerankerScore`, `maxTurnChars` (24000), `maxAttempts` (5), `retryDelayMs` (2000), `pollDelayMs` (2000), `apiKey`. Prefer `BOB_HINDSIGHT_API_KEY` to putting a credential in JSON. HTTPS is required for non-loopback endpoints; no redirects are followed. Do not expose an unauthenticated Hindsight service to the network.

## Local CPU recall performance

Database health does not establish recall latency. Inspect Hindsight's per-phase timings before changing Bob's deadline: local cross-encoder reranking can dominate while embeddings/retrieval remain fast. Reducing `maxTokens` alone does not cap reranker candidates; even `budget:"low"` can retain the service's default 300-candidate cap.

[`examples/hindsight-recall-performance.conf`](examples/hindsight-recall-performance.conf) is an optional **Hindsight user-service** systemd drop-in, not Bob configuration. It keeps the existing model/reranking, uses two native threads and two reranker workers, enables length-bucketed batches, and caps `mid` at 100 candidates. `high` retains the default 300. These are host-specific settings, not universal defaults: one-native-thread testing was slower on this installation. The smaller pool can miss relevant memories or change rankings; compare both banks and known answers, not just result counts. No bank contents or per-bank configuration need changing.

Only apply/restart with owner authorization. Verify service ownership and that all banks have no pending/processing operations immediately before a graceful Hindsight-only restart. Wait for actual API readiness, then benchmark concurrent two-bank recalls through `HindsightClient`. Roll back by removing the drop-in and repeating the same safe restart procedure; do not modify databases or restart Bob to tune Hindsight.

Choose Bob's `recallTimeoutMs` from measured latency plus headroom, not as a substitute for speeding retrieval. A 15000 ms owner override provides headroom for this installation's measured 6–9 s two-bank checks. Bob reads its override on backend activation, so a file edit alone does not change the running deadline. Keep benchmarks bounded and report cold starts, system contention and limited relevance coverage; this is not an SLA or proof of unchanged retrieval quality. Bob deliberately keeps fresh current-query recall on the answer path rather than reusing previous-turn background results.

## Tools and controls

- `hindsight_recall({query})`: relevant facts, with source-bank/document attribution.
- `hindsight_reflect({query})`: on-demand synthesis from each configured recall bank.
- `hindsight_retain({content,tags?})`: explicit selected-knowledge save to Bob. Returns a **queued receipt**, not an extraction-success claim.
- `hindsight_memory({action:"status"})`: API connectivity, capture attachment and accepted owner input kinds, current preferences, last recall and up to 30 recent save receipts. API/database health alone does not imply working extraction credentials.
- `hindsight_memory({action:"doctor"})`: deliberate LLM-health probe; makes real provider calls. Not for background polling.
- `hindsight_memory({action:"configure",autoRecall:false,autoRetain:false})`: persistent controls for this conversation.
- `hindsight_memory({action:"retry",key:"input:123"})`: explicitly reconcile/retry a failed save from status. Keeps the original document/operation identities.
- Add `#nomem` or `#skip` to a user input to exclude that run's shared answer from automatic memory. This does not delete the normal chat transcript.

The model can operate these tools from plain-language requests such as “turn memory off in this conversation” or “check memory status.” Notes are entirely separate and are never silently edited or used as the outbox.

## Embedding in another Durable host

```ts
const memory = createHindsightMemory({ enabled: true }, fetch, {
  ownerInputKinds: ['pi.user'], // Add only your host's canonical owner kind, e.g. Bob's 'bob.user'.
});
registry.install(memory.extension);
// Select memory.extension through the host's native settings/conversation agent.
const harness = await Harness.open(storage, { models, registry }, context);
const attached = await memory.attach(harness, storage, stableBackendId);
harness.resume();
// At orderly shutdown, before harness.close():
await attached.close();
```

Attach after root creation, before resuming/serving inputs. The storage port uses only public `scanSubmissions` reads. All writes use public Harness/Tx APIs. The synchronous commit subscriber merely schedules asynchronous capture; it never calls back into Session inline. The optional `selectExisting:true` provisions existing owner conversations once and should only be used with owner authorization.

## Privacy and limits

Auto-retention sends normal conversation text to Hindsight's extraction model. **Local API/database hosting does not imply local model inference.** Known tokens, bearer credentials, secret assignments and private keys are redacted best-effort; arbitrary secrets cannot be reliably detected. Use opt-out controls for sensitive conversations. Very long turns are capped, preserving a bounded portion of both user and assistant text. No file/archive/backfill ingestion, automatic legacy-bank writes, mental-model-management UI or flat-file-memory mirroring is included.

The module stores new version-1 documents/tasks in `bob.memory.*` only; no existing Durable/control schema migration is needed. Module compatibility is pinned and must be tested on future Durable upgrades. Removing the package is not deleting the Hindsight database. Settle/cancel its tasks before unregistering it. Rollback never rewinds chat data.

## Verification and service authentication

`test/memory.test.ts` uses the real Durable harness, SQLite reopening, a real SIGKILL after server acceptance, the authenticated app HTTP message route, and a deterministic Hindsight transport. The app-route regression verifies `bob.user` recall, canonical text retention, UI-hint exclusion, request deduplication, opt-out, disabled saving, and peer exclusion. Both native and app steering paths test late opt-out. Upgrading an input-kind allowlist never retrospectively grants consent: app turns skipped by older releases lack generation-time consent checkpoints and are not backfilled. It covers injection, deduplication, privacy, steering, outages, retry identity, explicit tools, capture recovery and module selection. All tests run without touching the real service.

Current service health must come from `hindsight_memory(action="status")`, and an explicitly needed `doctor`/end-to-end check—not a past smoke-test report. API availability and accepted retention do not prove extraction authentication works.

Administer Hindsight through the service and authentication mechanism configured for the deployment. Credential renewal is owner-interactive, not something this module silently performs. After renewal, use `doctor` and an isolated save/recall verification before calling the write path ready.
