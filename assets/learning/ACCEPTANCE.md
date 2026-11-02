# Bob-native learning port acceptance

## Scope and provenance

Pinned source: `bf0203a794a07aac3ff764972ab9087baa4e4f4e`. The review, `/learn`, `/refine` and optional consolidation prompts are extracted reproducibly from pinned upstream Python constants, with every substitution recorded in `adaptations.json`. Operative identities, tools and storage references use Bob. Original MIT attribution and source bytes remain intact.

Runtime integration uses Bob's existing Pi Durable authority. No original document/task version, database, chat, Notes document, Hindsight bank or existing skill body is replaced. Added metadata and task definitions are additive. Existing uncommitted push/UI work was preserved; its owning conversation confirmed no concurrent editing/building.

Implemented: bounded user/environment memory; frozen per-conversation memory prompt snapshots; compact skill discovery and on-demand exact-file loading; native support files; patch/batch authoring; automatic post-turn reviews; `/learn`; explicit background `/refine`; current-read guards and revision conflicts; unattended destructive-memory proposals; recoverable archive/restore; bounded package ledgers/rollback; deterministic idle aging; explicit optional consolidation (off by default).

## Independent review and corrections

The independent reviewer did not clear the initial implementation. The following findings were corrected and covered by regression tests after the report:

1. Skill and memory mutations now commit per-tool-task receipts atomically with artifact changes. SQLite tests interrupt after artifact commit and before ToolTask settlement, reopen, and verify one application and the original success result, including expectedRevision. Nested code-mode calls have distinct operation identities.
2. Automatic review evidence is selected from completed submission ranges whose persisted learning policy is enabled. A disabled turn's input and answer are excluded after re-enabling. Text opt-outs and non-owner boundaries are also excluded.
3. `/refine` keeps background skill provenance, exact-read guards, archive protection and pin/auto-load restrictions. Attendedness relaxes only the original unattended destructive-memory gate.
4. Memory proposal approval/rejection requires an exact current owner command for that proposal. Peer input and stale owner authorization are rejected. Native receipts retain already-completed results on recovery without reauthorizing a second mutation.
5. Memory span patches preserve replacement whitespace.
6. Atomic memory batches cannot empty a previously nonempty store; the check applies to direct writes, staging and approval. An intentional single remove remains available.
7. Successful changes and staged proposal IDs are recorded in the worker transaction and surfaced to the source chat, including after later failure/cancellation. Automatic no-signal reviews remain silent.
8. Added optional consolidation using the pinned curator prompt with host-enforced writable candidates. It remains off by default and is explicitly requested through `learning`.

No second independent sign-off is claimed. Post-fix verification was performed by the integrating agent.

## Verified checks

- `npm run build`: passed.
- `npm test`: **397/397 passed**, zero failures, cancellations or skips.
- `python3 assets/learning/port.py --check`: original hashes, AST extraction and generated prompt module verified.
- `git diff --check`: passed.
- `npm pack --dry-run --json`: verified the compiled host modules, native skill/memory/receipt modules, upstream MIT licence and pinned provenance are in the release package.
- Real native SQLite restart tests cover review recovery and the mutation/result-settlement crash window.
- Native model/tool integration tests cover automatic creation, later discovery/loading, explicit review with automatic review disabled, memory proposals, exact-file reads, lifecycle/rollback, protected curator candidates, opt-outs, disabled-history exclusion, and nested code mode.
- Existing skill-screen HTTP tests cover audit history, supporting-file preservation, recoverable deletion, idempotent repeated deletion and restoration through the existing screen API.
- The independent reviewer verified native rejection of review attempts to invoke `bash` and `codemode`.

Model responses in automated tests are deterministic fixtures. No claim is made that these tests measured real-model learning quality or verified on-phone behaviour after deployment. Backend activation is a separate supervised-update outcome.

## Integration boundaries

Native support scripts are text artifacts, loaded and materialized through Bob's tools before execution; they are not arbitrary filesystem paths. Review evidence is bounded to recent stored entries and a character budget. Native package ledgers replace filesystem backup snapshots. Bob schedules have no upstream cron skill-reference fields, so consolidation does not rewrite schedule text.

Upstream hub/plugin/filesystem installers, installer-scanner integrations, full YAML metadata parsing, optional global write-approval switches and auxiliary-model routing controls were not imported. They are distinct from the default learning loop ported here. Existing Hindsight configuration and external memory remain unchanged.


## Explicit-review follow-up lifecycle

A held-worker regression reproduced an explicit `/refine` being cancelled by a subsequent status question. Explicit reviews now survive ordinary foreground messages; automatic reviews retain foreground preemption. A fresh `/refine` still replaces its predecessor, and tree Stop still aborts background work. Late predecessor completion cannot overwrite the replacement's `lastReview`. This explicit-review continuation is a deliberate Bob lifecycle adaptation rather than a claim of identical upstream cancellation policy.

Four added integration cases cover explicit continuation (also with automatic learning disabled), automatic preemption, fresh-command replacement, and tree Stop. Build and all 378 tests passed. Pinned prompt generation and whitespace checks passed. A real-model review on the updated active release remains a separate post-deployment check; these tests do not establish that result.


## Fidelity-audit remediation

- Bounded review windows recover the enclosing owner/opt-out/peer boundary without reintroducing omitted body text or disabled-policy evidence. Tests cover positive long-task recovery and private/peer/disabled exclusions.
- Optional `lastPatchedAt` tracks substantive skill changes; age uses the latest use or edit. Older sidecars recover patch activity from retained ledger snapshots when available. No-op and lifecycle bookkeeping do not refresh age; evicted legacy history cannot be reconstructed.
- Ordinary-turn guidance explicitly calls for loading partially relevant skills, including familiar tasks, and extending relevant procedures before reinvention. Native metadata is authoritative. Default routing/auto-load filters backend-platform mismatches while explicit inspection exposes applicability and `readiness: not_evaluated`; no claim of full YAML or dependency readiness support is made.
- Native memory writes/staging/approval use the pinned Hermes strict scanner. Differential tests exercise all 36 pattern IDs against the archived Python scanner across 204 synthetic strings, plus mutation/atomicity/approval regressions. Existing stored memory is not rewritten or retroactively quarantined.
- Independent review reproduced a final-entry secret/separator validation bypass. The integrating agent applied existing content validation to complete patched entries as well as the new scanner, and added a red-then-green direct/staging/legacy-approval regression. The reviewer did not rerun that final fix.
- Independent focused verification passed 67 tests before that final validation correction. Initial evaluation message-order extraction was also corrected; the original real responses were retained and rescored, not regenerated or invented.
- [Real-model relevance/reuse evaluation](reuse-evaluation.md): 8/8 bounded synthetic tasks passed on the exact foreground `openai/gpt-6-astra` configuration; 6/6 applicable tasks loaded and applied their hidden skill rules, and 2/2 unrelated tasks loaded none. Fourteen actual inference requests. No baseline, statistical reliability, large-library search or production learning-quality claim is made. The two earlier setup attempts made zero model calls.

Owner-facing controls, evidence limits, fixed budgets, separate curator aging, and bounded rollback retention are documented in FEATURES and OPERATIONS. No database restore, existing artifact rewrite, dependency installation or Android changes are required for these fixes.

Final integrating-agent verification after the complete-entry validation fix: `npm run build` and all **397/397 tests** passed, with zero failed/skipped/cancelled tests. Live reuse evidence is reported separately above; deployment activation remains a separate supervised-update outcome.


## Visible saved-result notices

Owner-requested completion notices now report receipt-derived skill actions and supporting-file paths directly in chat. Foreground mutations emit passive `bob.learning-status` entries in their owner chat; background reviews aggregate details on completion. Optional `skillChanges` is additive, old worker records fall back to generic “changed,” and old terminal events remain displayable. No fake assistant/user message is inserted into model history.

No-op saves, reads, conflicts and rolled-back batches do not emit success notices. Committed changes remain reported with failure/cancellation labels if the review subsequently stops. Explicit no-change reviews report no saved changes; automatic no-change reviews stay silent. Native mutation receipts and their notices share a transaction; SQLite restart regression proves no duplicate notices after tool-settlement interruption. Skill summaries are bounded to 16,000 UTF-8 bytes at action boundaries with an explicit additional-change count. The app renders valid passive terminal text directly as selectable, wrapped plain text; malformed/oversized events retain fallback.

Independent review found no actionable blockers and passed 63 backend and 32 focused mobile tests, plus a separate cancellation reproduction and type checks. Integrating-agent final full verification: **403/403 backend tests**, **390/390 mobile tests (58 suites)**, backend build, mobile TypeScript, pinned-source check and diff whitespace check passed. All seven reviewed source hashes remained unchanged through final verification. Physical-phone display/accessibility and the signed release build remain separate deployment checks; the user must install the Android update.
