import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {State} from '../src/state.js';
import {migrateControl} from '../src/control-migrations.js';
import {acquireOwner} from '../src/ownership.js';
import {prepareFreshPi15Floor, prepareFreshPi151Floor, pi151Fingerprint, readControlFloor} from '../src/maintenance-migration.js';
import {inspectSetup} from '../src/setup-host.js';
import {guidedSetup, type SetupPort} from '../src/setup-wizard.js';

function fixture(version: 3 | 4, managed = false) {
  const base = mkdtempSync(join(tmpdir(), 'bob-setup-floor-')), directory = join(base, 'state');
  const state = new State(directory), id = state.id;
  state.set('cwd', base); state.set('model', {provider: 'openai', modelId: 'fixture'});
  state.set('openaiKey', 'private-sentinel');
  if (managed) state.set('maintenanceHome', '/fixture/supervisor');
  migrateControl(state); state.close();
  const release = acquireOwner(directory);
  try {
    if (version === 3) prepareFreshPi15Floor(directory);
    else prepareFreshPi151Floor(directory, {id: 'fixture', cli: join(base, 'cli.js'), durableVersion: '1.5.1', compatibility: pi151Fingerprint});
  } finally { release(); }
  const database = join(directory, 'control.sqlite');
  return {base, directory, database, id, inspect: () => inspectSetup(directory, join(base, 'no-cli-config')), close: () => rmSync(base, {recursive: true, force: true})};
}

for (const version of [3, 4] as const) for (const mode of ['offline', 'managed', 'owned'] as const) {
  test(`schema ${version} ${mode} inspection uses the validated floor and wizard preserves reuse boundaries`, async () => {
    const f = fixture(version, mode === 'managed');
    const release = mode === 'owned' ? acquireOwner(f.directory) : () => {};
    try {
      const before = readFileSync(f.database), floor = readControlFloor(f.directory, true);
      assert.equal(floor.kind, version === 3 ? 'pi15-fresh' : 'pi151');
      const inspection = f.inspect();
      assert.equal(inspection.backendId, f.id); assert.equal(inspection.configurationReady, true);
      assert.equal(inspection.managed, mode === 'managed'); assert.equal(inspection.owned, mode === 'owned');
      assert.doesNotMatch(JSON.stringify(inspection), /private-sentinel/);
      const calls: string[] = [], endpoint = 'https://fixture.tailnet.ts.net:49158';
      const port: SetupPort = {
        say: () => {}, ask: async (question, fallback) => question === 'Backend state directory' ? fallback! : endpoint,
        confirm: async () => true, inspect: async () => { calls.push('inspect'); return f.inspect(); },
        configure: async () => { throw Error('configured state must never be rewritten'); },
        prepareNetwork: async () => { calls.push('network'); return endpoint; },
        startService: async () => { calls.push('service'); return true; },
        verify: async (url, id) => { assert.equal(url, endpoint); assert.equal(id, f.id); calls.push('verify'); },
        pair: async () => { calls.push('pair'); },
      };
      assert.equal((await guidedSetup(f.directory, port)).status, 'invitation-issued');
      assert.deepEqual(calls, mode === 'offline' ? ['inspect', 'network', 'service', 'verify', 'pair'] : ['inspect', 'verify', 'pair']);
      assert.deepEqual(readFileSync(f.database), before, 'inspector/wizard never modify control bytes');
      assert.deepEqual(readControlFloor(f.directory, true), floor);
    } finally { release(); f.close(); }
  });
}

for (const [label, sql] of [
  ['future version', 'PRAGMA user_version=99'],
  ['forged fingerprint', "UPDATE maintenance_pi151_floor SET to_fingerprint='" + 'f'.repeat(64) + "'"],
  ['missing floor', 'DROP TABLE maintenance_pi151_floor'],
  ['corrupt lifecycle', 'UPDATE maintenance_runtime_floor SET lifecycle_schema_version=99'],
  ['invalid configuration', "UPDATE config SET value='not-json' WHERE key='model'"],
] as const) test(`setup continues to refuse ${label} read-only`, () => {
  const f = fixture(4);
  try {
    const db = new DatabaseSync(f.database); try { db.exec(sql); } finally { db.close(); }
    const before = readFileSync(f.database);
    assert.throws(f.inspect, /safely inspected/);
    assert.deepEqual(readFileSync(f.database), before);
  } finally { f.close(); }
});
