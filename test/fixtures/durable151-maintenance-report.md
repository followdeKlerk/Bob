# Durable 1.5.1 supervisor implementation evidence

Scope: isolated `/tmp/bob-durable151-candidate` only. No deployment checkout/state edit, installation, service operation or database restore.

## Exact reviewed persistence identities

- Existing 1.5.0 canonical: `5c798ab849e5ebf456f1aa4da70f8ef88f87af72bd8e709292083776ba1d0b45`.
- Existing schema-builder raw alias retained: `95750e8918ed663e0607933a0e3867674fec8098d32981b45008b15806a072f9`.
- New old-compatible bridge raw alias: `2a4bc4fcd5898898e00e03fb5d89702df671c264061eb2d8eff983e086e2f60c`. Calculation uses root dependency hash inputs at 1.5.0 and root Chord JsonValue type imports in peers/interactive. Only this exact new raw aliases the old canonical identity.
- Distinct 1.5.1 target raw/canonical: `c009f575442a9eeb23b72ba0d4b9fee594f1182d4dee2698f56a6afb97ef2bd5`.

No request, environment, journal or package-supplied allowlist authorizes another crossing.

## Physical floor and recovery contract

Physical control user_version 4 retains the original `maintenance_runtime_floor` table and historical `migrationIntent`. New table `maintenance_pi151_floor` has ordered columns `singleton,min_durable,protocol,origin,from_fingerprint,to_fingerprint,migration_release_id,migration_cli`. Lifecycle version remains solely in the original table. New journal key `patchMigrationIntent` uses protocol `bob-pi151-v1` and phases `intent|backed-up|floor-committed|complete`.

Public floor object:

```ts
{kind:'pi151'; minDurable:'1.5.1'; protocol:'bob-pi151-v1';
 origin:'fresh'|'migration'; from?:string; to:string;
 migrationReleaseId:string; migrationCli:string;
 lifecycleSchemaVersion:0|1|2}
```

`from` is present only for migration; its database value is NULL for fresh origin. `readControlFloor(dir,true,true)` validates both tables but returns the historical floor for journal identity validation. The default returns the v4 object. Original lifecycle migration updates the original lifecycle marker without lowering physical v4.

Crossing requires fresh live runner evidence with additional `patchSupervisorProtocol:'bob-pi151-v1'` and exact previous release identity. Pre-bridge runner evidence cannot authorize crossing. All nonempty or invalid customModules configurations are rejected before backup/barrier. COMMIT, not journal phase, determines forward-only recovery. After COMMIT no old-code spawn or automatic database restore exists. Bridge direct State construction on v4 now checks the actual installed native version before mkdir/chmod/writer/config mutation; target State may preflight legacy/v3, while target native open remains barred until explicit crossing or verified native-absent bootstrap.

## Commands actually run

Using Node 24.22.1 through PATH:

- `node_modules/.bin/tsc --noEmit`: PASS after final production changes.
- `node_modules/.bin/tsx --import ./test/environment.mjs --test test/durable151-maintenance.test.ts test/pi15-state-floor.test.ts test/maintenance-migration.test.ts`: **120 passed, 0 failed, 0 skipped**, 238.6 seconds. Log `/tmp/bob-durable151-maintenance-final.log`.
- Earlier unchanged historical maintenance regression: 49 passed; included again in the final 120.

New tests cover exact pins, evidence, fresh and historically migrated origins across lifecycle 0/1/2, custom modules, ownership, intent/backup/COMMIT/start/completion interruption boundaries, corrupt/missing/mixed floor and journal metadata, pre-writer State rejection, monotonic lifecycle migration, fresh/native-present bootstrap, and real subprocess unchanged-loader handoff from original supervisor to bridge to target. Archived original supervisor source under `durable151-pi150-supervisor/` is a test fixture, not executable deployment policy.

## Remaining parent-owned gate

Subprocess handoff backends here are synthetic health servers; they are NOT proof of installed native packaged transition. Parent must build/install isolated real old-compatible bridge and target packages, verify both raw identities and installed versions, run actual packaged handoff/failure recovery, integrate strict recovery schemas/manifests/custom-module and report policies, and complete full validation. No deployment or restart is authorized by this report.
