// Standalone opt-in proof: node --test test/durable151-native-proof.test.mjs
// Intentionally not hidden inside npm test: needs two explicitly pinned installations.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, readFileSync, rmSync, cpSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
const oldRoot = process.env.DURABLE150_ROOT ?? '/home/ndk/GitHub/Bob';
const newRoot = process.env.DURABLE151_ROOT ?? fileURLToPath(new URL('..', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/durable151-native-proof.mjs', import.meta.url));
const roots = [];
function disposable() {
  const dir = mkdtempSync(join(tmpdir(), 'bob-durable151-native-'));
  writeFileSync(join(dir, 'DISPOSABLE'), 'synthetic native proof only\n'); roots.push(dir); return dir;
}
function clone(dir) {const copy = disposable(); cpSync(dir, copy, {recursive: true}); return copy;}
function run(version, mode, dir, extra = {}) {
  const root = version === '1.5.0' ? oldRoot : newRoot;
  assert.equal(JSON.parse(readFileSync(join(root, 'node_modules/@earendil-works/pi-durable/package.json'), 'utf8')).version, version);
  const child = spawnSync(process.execPath, ['--experimental-import-meta-resolve', fixture, root, version, mode, dir], {
    timeout: 15000, encoding: 'utf8', env: {...process.env, ...extra, NODE_OPTIONS: '', NODE_PATH: ''}, maxBuffer: 1024 * 1024,
  });
  assert.equal(child.error, undefined, `${version} ${mode}: ${child.error}\n${child.stdout}\n${child.stderr}`);
  assert.equal(child.status, 0, `${version} ${mode}: ${child.stdout}\n${child.stderr}`);
  const result = JSON.parse(child.stdout.trim().split('\n').at(-1));
  console.log(JSON.stringify(result)); return result;
}
function storedSchema(dir) {
  const db = new DatabaseSync(join(dir, 'durable.sqlite'), {readOnly: true});
  try {
    const schema = db.prepare('SELECT * FROM durable_schema').all();
    const agentRevisions = db.prepare("SELECT r.* FROM document_revisions r JOIN documents d ON d.id=r.document_id WHERE json_extract(d.record,'$.kind')='pi.agent'").all();
    return {schema, agentRevisions};
  } finally {db.close();}
}
function audit(dir) {return readFileSync(join(dir, 'executions.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));}

test('native 1.5.0 -> 1.5.1 -> 1.5.0 read/write and recovery; unchanged schema does not imply semantic rollback safety', {timeout: 120000}, () => {
  try {
    const seeded = disposable(); run('1.5.0', 'seed', seeded);
    const baseline = storedSchema(seeded); console.log(JSON.stringify({stage: 'seed-schema', ...baseline}));
    assert.ok(baseline.agentRevisions.length > 0);
    assert.ok(baseline.agentRevisions.every(r => r.version === 1));
    const control = clone(seeded);
    run('1.5.0', 'mutate', control); run('1.5.0', 'recover', control);
    const pendingUpgrade = clone(seeded);
    run('1.5.1', 'recover', pendingUpgrade);
    const draftOnly = clone(seeded);
    run('1.5.1', 'draft', draftOnly);
    const reopened = run('1.5.0', 'mutate', draftOnly);
    assert.equal(reopened.storedCompaction, null); run('1.5.1', 'verify', draftOnly);
    const configured = clone(seeded);
    run('1.5.1', 'draft', configured); run('1.5.1', 'configure', configured);
    const downgraded = run('1.5.0', 'mutate', configured);
    assert.ok(downgraded.storedCompaction); assert.equal(downgraded.effectiveCompaction, null);
    assert.equal(downgraded.oldConfigureIgnoredCompaction, true);
    run('1.5.1', 'verify', configured, {EXPECT_COMPACTION: '1'});
    const upgraded = storedSchema(configured); console.log(JSON.stringify({stage: 'upgraded-schema', ...upgraded}));
    assert.deepEqual(upgraded.schema, baseline.schema);
    assert.ok(upgraded.agentRevisions.length > baseline.agentRevisions.length);
    assert.ok(upgraded.agentRevisions.every(r => r.version === 1));
    // Probe actual committed ToolTask execute checkpoints, not just pending records.
    const interruptedOld = clone(seeded); run('1.5.0', 'crash', interruptedOld);
    const oldRecoveryControl = clone(interruptedOld);
    run('1.5.0', 'recover', oldRecoveryControl, {EXPECT_EXECUTE: '1'});
    run('1.5.1', 'recover', interruptedOld, {EXPECT_EXECUTE: '1'});
    assert.deepEqual(audit(interruptedOld).map(e => [e.version, e.replay]).sort(), [['1.5.0', 'safe'], ['1.5.0', 'unsafe'], ['1.5.1', 'safe']]);
    const interruptedNew = clone(configured); run('1.5.1', 'crash', interruptedNew);
    run('1.5.0', 'recover', interruptedNew, {EXPECT_EXECUTE: '1'});
    assert.deepEqual(audit(interruptedNew).map(e => [e.version, e.replay]).sort(), [['1.5.0', 'safe'], ['1.5.1', 'safe'], ['1.5.1', 'unsafe']]);
    run('1.5.1', 'verify', interruptedNew, {EXPECT_COMPACTION: '1'});
    console.log('RECOMMENDATION: forward-only activation for 1.5.1 compaction semantics; structural reopen/read/write alone is insufficient.');
  } finally {for (const dir of roots) rmSync(dir, {recursive: true, force: true});}
});
