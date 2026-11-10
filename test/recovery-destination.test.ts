import test from 'node:test';
import assert from 'node:assert/strict';
import fs, {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, symlinkSync, statSync, readdirSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {State} from '../src/state.js';
import {backupState, restoreState} from '../src/recovery.js';
import {acquireOwner} from '../src/ownership.js';

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'bob-backup-destination-')), state = new State(join(base, 'state'));
  for (const folder of ['artifacts', 'custom-modules']) {
    mkdirSync(join(state.dir, folder)); mkdirSync(join(state.dir, folder, 'nested'));
    writeFileSync(join(state.dir, folder, 'nested', 'original.bin'), Buffer.from([0, 17, 255, 10]));
  }
  return {base, state, close: () => { state.close(); rmSync(base, {recursive: true, force: true}); }};
}
function payloads(state: State) {
  return ['artifacts', 'custom-modules'].map(folder => readFileSync(join(state.dir, folder, 'nested', 'original.bin')));
}

test('backup rejects canonical source overlap and symlinked parent aliases before any output creation', async t => {
  const f = fixture(), before = payloads(f.state), control = readFileSync(join(f.state.dir, 'control.sqlite'));
  symlinkSync(f.state.dir, join(f.base, 'state-alias'));
  symlinkSync(join(f.state.dir, 'artifacts'), join(f.base, 'artifact-alias'));
  symlinkSync(join(f.state.dir, 'custom-modules'), join(f.base, 'module-alias'));
  symlinkSync(join(f.state.dir, 'artifacts', 'nested'), join(f.base, 'nested-alias'));
  const destinations = [
    join(f.state.dir, 'snapshot'),
    ...['artifacts', 'custom-modules'].flatMap(folder => [
      join(f.state.dir, folder, 'snapshot'), join(f.state.dir, folder, 'missing', 'deep', 'snapshot'),
      join(f.base, 'state-alias', folder, 'snapshot'),
    ]),
    join(f.base, 'artifact-alias', 'missing', 'snapshot'), join(f.base, 'module-alias', 'missing', 'snapshot'),
    join(f.base, 'nested-alias') + '/../snapshot',
    // Do not use join for the suffix: it would erase the nonexistent-parent trigger.
    ...['artifact-alias', 'module-alias'].map(alias => join(f.base, 'missing') + '/../' + alias + '/snapshot'),
  ];
  const attempts: string[] = [];
  // Bound the original recursion bug: fail instead of allowing even the first output mkdir.
  const mocked = t.mock.method(fs, 'mkdirSync', (path: fs.PathLike) => {
    attempts.push(resolve(String(path))); throw Error('Unexpected backup output mkdir');
  });
  syncBuiltinESMExports();
  try {
    for (const destination of destinations) {
      await assert.rejects(backupState(f.state, destination), /overlap/i, destination);
      assert.equal(existsSync(destination), false);
    }
    assert.deepEqual(attempts, []);
    assert.deepEqual(payloads(f.state), before);
    assert.deepEqual(readFileSync(join(f.state.dir, 'control.sqlite')), control);
  } finally { mocked.mock.restore(); syncBuiltinESMExports(); f.close(); }
});

test('canonicalizing missing parents cannot overwrite an existing destination or create spurious source directories', async () => {
  const f = fixture(), existing = join(f.base, 'existing');
  mkdirSync(existing); writeFileSync(join(existing, 'sentinel'), 'retained');
  try {
    await assert.rejects(backupState(f.state, join(f.base, 'missing') + '/../existing'), /unresolved parent traversal/);
    assert.deepEqual(readdirSync(existing), ['sentinel']);
    assert.equal(readFileSync(join(existing, 'sentinel'), 'utf8'), 'retained');
    assert.equal(existsSync(join(f.base, 'missing')), false);
  } finally { f.close(); }
});

test('disjoint sibling-prefix and external symlink destinations back up and verify with private byte-preserving payloads', async () => {
  const f = fixture(), before = payloads(f.state);
  mkdirSync(join(f.base, 'exports')); symlinkSync(join(f.base, 'exports'), join(f.base, 'export-alias'));
  try {
    for (const destination of [join(f.base, 'state-backup'), join(f.base, 'export-alias', 'new', 'backup')]) {
      let verified = 0;
      const manifest = await backupState(f.state, destination, async () => { verified++; });
      assert.equal(verified, 1); assert.equal(manifest.backendId, f.state.id);
      assert.equal(statSync(destination).mode & 0o777, 0o700);
      for (const [file, expected] of Object.entries(manifest.files)) {
        const path = join(destination, file);
        assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), expected);
        assert.equal(statSync(path).mode & 0o777, 0o600);
      }
      assert.equal(statSync(join(destination, 'manifest.json')).mode & 0o777, 0o600);
      const restored = join(f.base, 'restored-' + verified + '-' + readdirSync(f.base).length);
      restoreState(destination, restored);
      for (const folder of ['artifacts', 'custom-modules']) assert.deepEqual(readFileSync(join(restored, folder, 'nested', 'original.bin')), before[folder === 'artifacts' ? 0 : 1]);
      assert.deepEqual(payloads(f.state), before);
    }
    const release = acquireOwner(f.state.dir);
    try { await assert.rejects(backupState(f.state, join(f.base, 'busy')), /already owned/); }
    finally { release(); }
    assert.equal(existsSync(join(f.base, 'busy')), false);
  } finally { f.close(); }
});
