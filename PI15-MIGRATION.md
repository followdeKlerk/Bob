# Pi Durable 1.5 migration safety

This is a native Durable backend migration, not a Pi TUI update. The bridge keeps Pi 1.4.0 installed and its existing compatibility fingerprint unchanged. The initial preparatory release had an empty allowlist. The later pinned bridge authorizes only the reviewed pair documented below; installing that bridge still does **not** perform the native 1.5 migration. A separate supervised target update crosses the barrier.

## Why a bridge is necessary

Pi 1.5 keeps the same Durable SQLite schema, but advances native document and task formats (`pi.live` v1 to v3, `pi.generation` v1 to v2, and `pi.tool` v2 to v3). Use official forward migrations. Do not edit native version fields or write application-authored Durable SQL migrations.

An older harness may open upgraded state successfully and only fail on a later typed document read. The old supervisor also runs during a candidate's first startup. Therefore candidate health checks and a newer supervisor shipped only inside the candidate are not downgrade barriers.

## Deployment gates

1. Install the Pi 1.4 bridge through ordinary supervised self-update. Verify the **running supervisor's** protocol, process and release identity; a healthy backend or generic heartbeat alone is insufficient.
2. Finish the target runtime, recovery tooling and client-compatibility implementation in isolation. Review the exact source/target compatibility fingerprints and immutable candidate. Add only that reviewed transition to the compiled allowlist; retain ordinary equality checks for all other updates. No request/configuration/environment override may grant compatibility.
3. Drain and gracefully stop the previous backend, hold the exclusive state-owner lock, and verify the recovery backup. Persist the exact forward-transition intent before committing the control-v3 runtime floor.
4. Only after that committed floor may the 1.5 candidate open native storage. Control v3 is an explicit compatibility migration preserving configuration, credentials and device grants, with the earlier lifecycle-schema version recorded separately. Old Bob rejects v3 before normal startup writes.
5. Confirm candidate health, then finalize the active release. After the barrier, recovery is **forward-only**: compatible 1.5 repair/restart or a safe stop. Never restart 1.4 or restore an older chat database as automatic rollback.

The maintenance journal and control database cannot commit atomically together. Recovery must inspect both, treating a committed or ambiguous floor as a prohibition on old-code startup. A crash between floor commit and journal phase advancement is already past the downgrade boundary.

## Required evidence

- Ordinary same-fingerprint update failure still restores compatible code without rewinding data.
- Crash tests cover intent, verified backup, floor commit, journal advancement, candidate first native write, health confirmation and supervisor handoff.
- Every startup choice (interrupted transition, heartbeat restart, explicit rollback and normal activation) enforces the same floor.
- Missing, corrupt or contradictory metadata fails closed. Graceful-stop/ownership failure never starts a second runtime.
- An actual older executable rejects a disposable control-v3 fixture without changing native state or credential/grant fixtures.
- Native forward fixtures preserve original entry IDs, metadata, queued-input request IDs and exactly-once settlement; test interrupted/background tasks too, not just settled conversations.
- Recovery export metadata states the actual native version and restore validation enforces it. A 1.5 backup must not be labeled 1.4-compatible.
- Existing custom-module records are inspected for exact compatibility; old code is not implicitly accepted under the new native runtime.

## Client compatibility

Keep the legacy history envelope and wire task state unchanged. Pi 1.5's native `pending` inspection state maps to wire `ready` for existing clients.

Pi 1.5 watches are bounded windows. The unchanged phone cannot replace its legacy active transcript with the newest 50 entries without potentially hiding intermediate messages. The migration projection must use public `Conversation.context(context, {at: capturedTail}).entries`, retain original entries/provenance, remove the window's `before`, cache unchanged tails and serialize projection/emission. This preserves old active-context coverage, not a fixed-size snapshot. Do not substitute model-context messages or manufacture entry IDs.

The updated app displays native failure, retry and compaction state as passive status, separately from assistant output. Provider error details are not rendered verbatim. A done tool without a recorded result is not displayed as successful; a genuine persisted result remains authoritative. Installing a preparatory APK does not migrate the backend or prove on-device behavior.

## Final target and cold-start policy

The reviewed compatibility family is exactly:

- Pi 1.4 source: `328bbd2b3ec5505199382f781d7dc2dc5359e17b8356c92daef8be53155f8003`
- Pi 1.5 target: `5c798ab849e5ebf456f1aa4da70f8ef88f87af72bd8e709292083776ba1d0b45`

These constants authorize no other pair. Install the pinned 1.4 supervisor before requesting the target build; changing only the candidate cannot grant permission to the already-running bridge. Keep the same pair in the target so it can validate migrated state. `bridgeReady` establishes supervisor identity, not completion of the native upgrade.

For new installations, control-only state gains a distinct `pi15-fresh` floor under exclusive ownership before the first native database open. Supervised cold startup additionally verifies the installed package's exact 1.5 identity. Any native database, WAL or SHM already present prevents this bootstrap; existing native state needs the explicit bridge migration, even with `resume:false`. Fresh floor metadata is not a migration intent. Device lifecycle version 0/1/2 remains independent of physical control version 3, including subsequent lifecycle migrations.

Imported custom-module records must be absent or empty for this transition. Populated or malformed records stop migration before backup/floor commit; no automatic package replacement, metadata rewrite or silent disabling occurs. Existing archives remain covered by the maintenance snapshot.

## Recovery exports

The 1.5 recovery tooling writes strict format-2 manifests containing the actual runtime, physical control version, lifecycle version and recognized floor. It checks identity, integrity, metadata and hashes before restoring into a new destination. Restore copies bytes only; it does not initialize State, start native work, migrate formats or activate a supervisor.

Historical format-1 exports keep their Pi 1.4 meaning and are deliberately rejected by the 1.5 restore command. Use the matching 1.4 release to restore such an export into a new directory, then follow the separately authorized forward migration. Do not relabel a manifest. Restoration never replaces existing live state. Reinstall the matching package and recover maintenance/service configuration separately; a migrated floor without matching maintenance intent deliberately prevents supervised startup. A restored identity must not run alongside its original.

## Reproducible packaged acceptance tests

`test/pi15-packaged-transition.test.ts` is opt-in through `BOB_PI15_PACKAGE_FIXTURES`, a private JSON file describing disposable bridge/target installations and their exact fingerprints. This selects test fixtures only; it cannot enable a production pair. Normal tests skip these package-dependent cases explicitly.

The cases exercise actual 1.4/1.5 runtime packages and the stable loader: complete transition; interruption before the floor; process exit after control COMMIT but before journal advancement; startup failure after a genuine 1.5 native write; cold supervised installation; and interrupted native tool/codemode recovery with one shell side effect, preserved visual identity and a sleeping native reminder. No external provider or live-state execution is needed. Synthetic-pin unit tests remain separate from this packaged proof.
