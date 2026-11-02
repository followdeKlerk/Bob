# Bounded real-model skill relevance/reuse evaluation

## Result — 2026-11-01

**Eight real-model tasks completed; corrected scoring passed 8/8.** This is a small synthetic acceptance sample, not a general skill-quality claim or evidence of a live learning review creating a production skill.

- Exact model: **`openai/gpt-6-astra`, medium thinking effort**. Read from the native `pi.agent` document of explicitly selected ownerless foreground conversation **29510** in the running backend's state. No model substitution. The backend default was Luna; that default was not mistaken for the selected foreground conversation's configuration. Other foreground conversations can use different models.
- Source under evaluation: current `packages/resources/src/skills.ts`, after the guidance worker's ready notification.
- Source SHA-256: `4b123e76d90cfa78a0044ae093f04ce16ed7bc57e82994ed46043a7565d18f7e`. The file was unchanged across the run.
- Guidance + synthetic rendered index SHA-256: `96d332c6dc016e205358c9c18890ebd6c51c0294755c7895f635361244c086ad`.
- Run started `2026-11-01T15:31:17.094Z`; elapsed **59,541 ms**.
- **14 real provider requests**, not faux/model-response fixtures. Recorded usage: **12,805 input + 5,760 cached-read + 524 output = 19,089 total tokens**; reported reasoning tokens 0. Usage-based catalog estimate **$0.16001**; conservative pre-dispatch reservation **$2.39793**. Neither is a subscription invoice or independently verified billing figure.

| Task | Category | Spontaneous `skill_view` | Canary application | Outcome |
|---|---|---|---|---|
| `relevant-parcel` | Relevant | `parcel-damage` | `Parcel protocol: AMBER-17` | Pass |
| `relevant-brief` | Relevant | `status-brief` | Orbit / Next / Friction; `LILAC-42` | Pass |
| `paraphrased-parcel` | Paraphrased | `parcel-damage` | `AMBER-17` | Pass |
| `partial-brief` | Partial: team update + arithmetic | `status-brief` | Brief rules; separate `6 × 7 = 42` | Pass |
| `distracting-parcel` | Physical damage; software codename distractor | `parcel-damage` only | `AMBER-17`; no archive canary | Pass |
| `distracting-brief` | Team brief; beverage codename distractor | `status-brief` only | `LILAC-42`; no tea canary | Pass |
| `unrelated-math` | Unrelated | None | No canary; answer `42` | Pass |
| `unrelated-explanation` | Unrelated | None | No canary; two-sentence Moon explanation | Pass |

**Denominators and misses:** intended skill loaded and its canary applied in **6/6 applicable tasks**, including **2/2 direct**, **1/1 paraphrased**, **1/1 partial**, and **2/2 distracting** tasks. Applicable load misses **0/6**; applicable canary misses **0/6**. Unexpected skill body loads **0/8**. Unrelated tasks without skill body loads or canary leakage **2/2**. The model used the supplied compact index directly; it made **zero `skills_list` calls**. Thus this run verifies spontaneous `skill_view` selection/application, not spontaneous list/search discovery or pagination.

Manual inspection of the recorded parcel answers also confirmed all three asked for one outer-packaging photo and did not promise a refund before inspection. The partial task kept the arithmetic separate. The deterministic scorer checks exact canaries/required strings and forbidden distractor strings; it is not a semantic grader of every procedural rule.

## Method and isolation

`tools/learning-reuse-eval.ts` uses the production resource sections, current source guidance/index and actual native `skills_list` / `skill_view` implementations. Each task receives a **fresh `Harness` + `MemoryStorage`**, synthetic native `Library` skills, and a new conversation. No production chat is submitted, no production Durable harness/runtime is opened, and no production memory/skill is changed. Native skill read receipts and usage counters exist only inside each disposable in-memory harness.

Four harmless synthetic packages are discoverable: physical parcel damage, team status briefs, green-tea brewing, and software release archives. Bodies contain arbitrary canary procedures that are absent from the user tasks, metadata descriptions, and on-demand index. Nothing is pinned or auto-loaded. A pass on applicable tasks requires both an actual `skill_view` call and the hidden rule in the final answer. The evaluator cannot pass by guessing a marker without loading its skill. User tasks do not explicitly ask to use, list, or load skills.

The model's entire callable tool set is asserted to be **exactly `skills_list`, `skill_view`**. No shell, filesystem, browser, arbitrary HTTP/network tool, delegation, memory mutation or skill mutation capability is provided. Provider inference itself necessarily uses network transport. This is a reduced Bob resource harness, not a claim that a full production conversation with all tools behaves identically.

The running state authority was located from actual open database handles; the explicit evaluation path was `/home/ndk/GitHub/Bob/docs/live-model-state`. Live control/native model documents were opened with Node SQLite **`readOnly:true`**. **`State` was never instantiated on live state** because its constructor writes identity/schema and permissions. Authentication mirrors `createBackendModels`: Bob's native OpenAI provider and Anthropic provider, stored credential provider reads, and stored legacy key lookup rather than ambient environment scanning. The credential facade exposes the existing read/list methods but rejects **every** modify/delete before its callback can execute. Credentials are never printed, serialized into evaluation state, copied into the report, or forwarded to the model.

Provider inspection confirmed `getAuth` does **not** unconditionally call `credentials.modify`: a valid OAuth token is converted with `toAuth`; the modify/refresh path is entered when expiry is within the minimum-validity window. The observed stored token was not expired or within five minutes of expiry. Authentication succeeded read-only. If a future run needs refresh, this harness fails closed rather than rotating/discarding credentials.

## Bounds

- At most **8 tasks**, sequentially; at most **4 requests/task**, **32 requests total**.
- At most **2,048 output tokens/request**, including provider reasoning within its normal limit semantics.
- At most **16,000 serialized input bytes/request**, used as a deliberately conservative token proxy for these primarily ASCII fixtures.
- At most **75 seconds/task**, **480 seconds total**; timeout aborts the run rather than silently continuing.
- At most **$3 conservative catalog reservation**, reserving serialized input bytes × catalog input rate plus full output-token cap × catalog output rate before each request. This is not a provider-side billing limit.
- SDK retries and Durable retries disabled; automatic compaction disabled.

## Evidence and reporting correction

Sanitized JSON artifacts (owner-only filesystem permissions; no request headers, credential values, raw provider payloads or raw auth errors):

- `/tmp/bob-learning-reuse-final-20261101-1/results.json`: first setup attempt, **0 tasks / 0 requests**.
- `/tmp/bob-learning-reuse-final-20261101-2/results.json`: diagnostic setup attempt, **0 tasks / 0 requests**.
- `/tmp/bob-learning-reuse-final-20261101-3/results.json`: original real run, **8 tasks / 14 requests**; includes all normalized final model responses and usage.
- `/tmp/bob-learning-reuse-final-20261101-corrected/results.json`: corrected scoring of the same real responses, **8/8**, **zero additional inference**.

The first two attempts failed while opening the isolated harness: spreading a class-based `Models` instance omitted its prototype methods. This was **not** an auth-expiry/refresh blocker. The adapter now proxies and binds the original instance instead.

The initial real-run scorer incorrectly chose the oldest assistant entry from Durable's **newest-first** entry page. For tasks with a skill tool call, it graded that empty tool-call text and initially reported **2/8**, despite the recorded final real model answers applying all canaries. The harness now selects the newest assistant answer. A separate `--rescore` mode validates case prompts/expectations and grades the already-recorded final normalized real responses; it never scripts or regenerates responses. Both original and corrected artifacts are retained. No ninth evaluation task or replacement real-model sample was run.

Example recorded real final output:

> Parcel protocol: AMBER-17
>
> I’m sorry your parcel arrived crushed and your vase was broken. Could you please send one photo of the outer packaging so we can review the damage and advise on next steps? Please take care around any broken pieces.

Temporary evidence can be removed by OS cleanup; this tracked document preserves the method, exact sample denominator, outcome, source hashes, cost estimates, limitations and correction history.

## Reproduce and checks

From the repository root, using existing dependencies only:

```sh
# No inference, no live-state access:
node --import tsx tools/learning-reuse-eval.ts --self-test

# Opt-in real inference; --out must be a NEW directory.
# Select a currently verified foreground conversation model, not an assumed latest chat.
node --import tsx tools/learning-reuse-eval.ts \
  --run --state /home/ndk/GitHub/Bob/docs/live-model-state \
  --foreground-conversation 29510 \
  --out /tmp/bob-learning-reuse-NEW --label current-guidance

# Explicit catalog override is supported and labelled as such, not silently substituted:
# --model gpt-6-astra --provider openai --thinking medium

# Re-grade recorded real responses without more inference:
node --import tsx tools/learning-reuse-eval.ts \
  --rescore /tmp/bob-learning-reuse-final-20261101-3/results.json \
  --out /tmp/bob-learning-reuse-RESCORE-NEW

./node_modules/.bin/tsc --noEmit --target ES2023 --module NodeNext \
  --moduleResolution NodeNext --strict --skipLibCheck --ignoreConfig \
  tools/learning-reuse-eval.ts
node --import tsx --test test/learning-skills.test.ts test/learning-prompts.test.ts
```

Actually run: harness self-test **passed**; standalone strict TypeScript check **passed**; original native skill/prompt regressions **33/33 passed**. Those existing regression tests use deterministic provider fixtures for runtime contracts; **they are not the real-model relevance result** above. No deployment, service restart, dependency installation, credential modification, production skill/memory edit, or helper agent was used.

## Remaining limitations

One run, one selected foreground configuration, a tiny synthetic inventory and short tasks. No baseline comparison was run, so the result does not establish improvement caused by the new guidance. No statistical claim, long-context stress, large-library relevance/search, disabled/platform-negative model behavior, native supporting-file selection, skill-writing/generalization quality, unattended review lifecycle, production persistence, phone UI, or deployment acceptance is established. `tea-timer` and `release-parcel` were negative distractors, not positive workflow tests. All synthetic skills use the default native platform metadata. Matching skills are visible in the initial compact index, so this is not evidence for discovering an initially hidden skill. The configured full foreground prompt/tool stack may change behavior; future runs must explicitly select and report the desired current conversation/model again.
