# Hindsight memory for Bob

Hindsight gives Bob long-term recall and conversation saving. It runs as a separately configured service; Hermes is not required. This memory module supports **Pi Durable 1.4.0**.

## Behaviour

### Recall

- Queries `bob` and `hermes` before answering ordinary owner inputs. On timeout or failure, the answer continues with results from any available bank.
- Supplies bounded, deduplicated historical references for the current model request. Treat these as context subordinate to current instructions and evidence; they stay outside system instructions and the saved transcript.
- Recalls observations and raw world/experience facts by default, including older Hermes memories. Use `types` to select the memory types and `minRerankerScore` to set an optional score floor; evaluate filtering against your own queries before relying on it.

### Saving and recovery

- Saves **owner text + final assistant text** after a successful completed answer. Recall and saving are limited to owner conversations and exclude memory-tool inspection/control turns to avoid feedback. Tool outputs, reasoning, images, system prompts, display hints, peer/custom inputs, task-owned/background conversations, compaction summaries and recalled context stay outside the export.
- Writes to `bob` by default; `hermes` is read-only. Existing historical data stays in place and unchanged.
- Saves survive backend restarts. Lost acknowledgements and transient retries reuse the same operation to avoid duplicate saves. Server extraction completion is distinguished from queue admission. Server-side processing warnings, including child-operation failures, are shown in receipts.
- At startup, recovers missed saves without duplicating completed work. Capture starts at first installation and does not bulk-export old conversations. Turns made while saving was off stay excluded after re-enabling; a `#nomem` steer also excludes other inputs sharing its answer.
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

Unconfigured backends default to disabled and make no Hindsight calls. Enabling memory selects the module for existing owner conversations once, preserving all other selections. Afterwards, per-conversation module selections remain authoritative. New conversations inherit the configured default. Setting `enabled:false` cancels unsent automatic work when it next runs; operations already sent may still finish. Settle or cancel active work before removing the module.

### Optional settings

- Recall: `types` and `minRerankerScore`.
- Saving: `maxTurnChars` (24000), `maxAttempts` (5), `retryDelayMs` (2000), `pollDelayMs` (2000).
- Authentication: `apiKey`.

Prefer `BOB_HINDSIGHT_API_KEY` to putting a credential in JSON. HTTPS is required for non-loopback endpoints; no redirects are followed. Do not expose an unauthenticated Hindsight service to the network.

### Existing Hermes memories

The legacy `hermes` bank remains available for read-only recall. Bob recalls the current input before answering and defaults to a 1600-token text allowance. File-memory mirroring, template imports and service administration remain separate operations.

## Local CPU recall performance

Use Hindsight's per-phase timings to find slow stages. Local cross-encoder reranking can dominate while embeddings/retrieval remain fast. Tune its candidate cap separately from `maxTokens`; even `budget:"low"` can use the service's default 300 candidates.

Apply the optional [`examples/hindsight-recall-performance.conf`](examples/hindsight-recall-performance.conf) systemd drop-in to the **Hindsight user service**. It keeps the existing model/reranking, uses two native threads and two reranker workers, enables length-bucketed batches, and caps `mid` at 100 candidates. `high` retains the default 300. Tune these settings for your host. The smaller pool can miss relevant memories or change rankings; compare both banks and known answers as well as result counts. Leave bank contents and per-bank configuration unchanged.

Only apply/restart with owner authorization. Verify service ownership and that all banks have no pending/processing operations immediately before a graceful Hindsight-only restart. Wait for actual API readiness, then check recall latency and relevance across both banks. Roll back by removing the drop-in and repeating the same safe restart procedure; do not modify databases or restart Bob to tune Hindsight.

After tuning, set `recallTimeoutMs` to measured latency plus headroom. This installation used a 15000 ms owner override for measured 6–9 s two-bank recalls; measure your own host with bounded checks that include cold starts, system contention and relevance. Bob reads the override on backend activation.

## Tools and controls

- `hindsight_recall({query})`: relevant facts, with source-bank/document attribution.
- `hindsight_reflect({query})`: on-demand synthesis from each configured recall bank.
- `hindsight_retain({content,tags?})`: explicit selected-knowledge save to Bob. Returns a **queued receipt**; check its status for extraction completion.
- `hindsight_memory({action:"status"})`: API connectivity, whether conversation saving is connected, current preferences, last recall and up to 30 recent save receipts. Use `doctor` when you also need to check extraction credentials.
- `hindsight_memory({action:"doctor"})`: on-demand LLM-health probe that makes real provider calls; reserve it for explicit checks.
- `hindsight_memory({action:"configure",autoRecall:false,autoRetain:false})`: persistent controls for this conversation.
- `hindsight_memory({action:"retry",key:"input:123"})`: explicitly reconcile/retry a failed save from status. Keeps the original document/operation identities.
- Add `#nomem` or `#skip` to a user input to exclude that run's shared answer from automatic memory. This does not delete the normal chat transcript.

Ask in plain language, for example, “turn memory off in this conversation” or “check memory status.” Manage Notes separately through Bob's Notes tools.

## Privacy and limits

Auto-retention sends conversation text to Hindsight's extraction model, which may use an external provider even when the API/database is local. Redaction covers known token formats, bearer credentials, secret assignments and private keys on a best-effort basis. Use opt-out controls for sensitive conversations. Long turns retain a bounded portion of both user and assistant text.

This package handles conversation capture and the tools above. File/archive imports, backfills, legacy-bank writes, mental-model management and flat-file-memory mirroring need separate tooling.

Before removing the memory module, settle or cancel its active work; removing it does not delete the Hindsight database. Use a compatible backend release and preserve chat data when rolling back. See [Operations](../../OPERATIONS.md) for backend maintenance.

Previously skipped app turns remain excluded after an upgrade; upgrading does not retrospectively grant consent to save them.

## Service health and authentication

Check current service health with `hindsight_memory(action="status")`. When extraction needs verification, run an authorized `doctor`/end-to-end check; API availability and queue admission only cover the earlier stages.

Administer Hindsight through the service and authentication mechanism configured for the deployment. The owner completes credential renewal interactively. After renewal, use `doctor` and an isolated save/recall verification before calling the write path ready.
