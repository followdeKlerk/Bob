import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MaintenanceStore, type UpdateJob} from '../src/maintenance.js';

// Exercise actual runner selection/reconciliation without importing its process/service loop.
const runner = readFileSync(new URL('../src/maintenance-runner.ts', import.meta.url), 'utf8');
const selection = /const job=([^;]+);/.exec(runner)![1]!;
const next = new Function('store', `return ${selection};`) as (store: MaintenanceStore) => UpdateJob | undefined;
const reconcile = new Function('store', runner.split("store.set('draining',false);")[1]!.split('await supervisor.start(active);')[0]!) as (store: MaintenanceStore) => void;
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'bob-maintenance-queue-')), store = new MaintenanceStore(home);
  return {store, home, close: () => { store.close(); rmSync(home, {recursive: true, force: true}); }};
}
const enqueue = (store: MaintenanceStore, id: string) => store.enqueue({id, action: 'build', target: 'backend'});

test('runner can select all 201 accepted jobs once while display stays newest-100 descending', () => {
  const f = fixture();
  try {
    const ids = Array.from({length: 201}, (_, i) => `request-${i}`);
    ids.forEach(id => enqueue(f.store, id));
    const displayed = f.store.jobs().map(job => job.id);
    assert.deepEqual(displayed, ids.slice(-100).reverse());
    const selected: string[] = [];
    for (let job = next(f.store); job; job = next(f.store)) {
      selected.push(job.id); f.store.patch(job.id, {status: 'complete'});
      assert.ok(selected.length <= ids.length, 'completed jobs must not be selected again');
    }
    assert.deepEqual(selected, ids);
    assert.equal(f.store.job(ids[0]!)!.status, 'complete');
    assert.deepEqual(f.store.jobs().map(job => job.id), displayed, 'display contract does not become the execution queue');
    assert.equal(statSync(join(f.home, 'journal.sqlite')).mode & 0o777, 0o600);
    assert.equal(statSync(f.home).mode & 0o777, 0o700);
  } finally { f.close(); }
});

test('new completed history cannot mask older queued work, including after store reopen', () => {
  const f = fixture(); let reopened: MaintenanceStore | undefined;
  try {
    enqueue(f.store, 'oldest'); enqueue(f.store, 'second');
    for (let i = 0; i < 150; i++) { const id = `complete-${i}`; enqueue(f.store, id); f.store.patch(id, {status: 'complete'}); }
    assert.ok(f.store.jobs().every(job => job.status === 'complete'));
    assert.equal(next(f.store)!.id, 'oldest');
    f.store.close(); reopened = new MaintenanceStore(f.home);
    assert.equal(next(reopened)!.id, 'oldest'); reopened.patch('oldest', {status: 'failed'});
    assert.equal(next(reopened)!.id, 'second'); reopened.patch('second', {status: 'complete'});
    assert.equal(next(reopened), undefined);
  } finally { if (reopened) { reopened.close(); rmSync(f.home, {recursive: true, force: true}); } else f.close(); }
});

test('runner reconciles interrupted jobs outside display window without replaying them or altering queued/complete jobs', () => {
  const f = fixture();
  try {
    for (const [id, status] of [['old-build', 'building'], ['old-activation', 'activating'], ['still-queued', 'queued'], ['already-complete', 'complete']] as const) {
      enqueue(f.store, id); f.store.patch(id, {status, releaseId: 'retained-release'});
    }
    const queued = f.store.job('still-queued'), complete = f.store.job('already-complete');
    for (let i = 0; i < 105; i++) { const id = `history-${i}`; enqueue(f.store, id); f.store.patch(id, {status: 'complete'}); }
    reconcile(f.store);
    for (const id of ['old-build', 'old-activation']) {
      const job = f.store.job(id)!;
      assert.equal(job.status, 'failed'); assert.equal(job.releaseId, 'retained-release');
      assert.match(job.stage, /Interrupted; running state retained/);
      assert.match(job.error!, /not replayed/);
      assert.deepEqual(enqueue(f.store, id), job, 'same canonical request returns terminal uncertainty receipt');
    }
    assert.deepEqual(f.store.job('still-queued'), queued); assert.deepEqual(f.store.job('already-complete'), complete);
    assert.equal(next(f.store)!.id, 'still-queued');
    const before = f.store.job('old-build'); reconcile(f.store);
    assert.deepEqual(f.store.job('old-build'), before, 'restart reconciliation is idempotent');
    assert.throws(() => f.store.enqueue({id: 'old-build', action: 'update', target: 'backend'}), /request conflict/);
    assert.deepEqual(f.store.job('old-build'), before);
  } finally { f.close(); }
});
