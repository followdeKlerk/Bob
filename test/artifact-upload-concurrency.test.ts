import test from 'node:test';
import assert from 'node:assert/strict';
import fs, {mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {PassThrough, Writable} from 'node:stream';
import {once} from 'node:events';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {Harness, createRegistry, type Conversation} from '@earendil-works/pi-durable';
import {openNodeSqliteStorage} from '@earendil-works/pi-durable/storage/sqlite/node';
import {createModels} from '@earendil-works/pi-ai/models';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';
import {receiveArtifact, downloadArtifact} from '../src/artifacts.js';
import type {State} from '../src/state.js';

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
function request(id: string, name = 'original.md', mime = 'text/markdown') {
  return Object.assign(new PassThrough(), {
    url: `/artifacts?uploadId=${id}`,
    headers: {'x-file-name': name, 'content-type': mime},
  }) as PassThrough & IncomingMessage;
}
class Response extends Writable {
  status = 0;
  headers: Record<string, unknown> = {};
  chunks: Buffer[] = [];
  writeHead(status: number, headers: Record<string, unknown>) { this.status = status; this.headers = headers; return this; }
  _write(chunk: Buffer, _encoding: string, done: () => void) { this.chunks.push(Buffer.from(chunk)); done(); }
}
async function fixture(limit = 1024) {
  const dir = mkdtempSync(join(tmpdir(), 'bob-artifact-upload-'));
  const database = join(dir, 'native.sqlite');
  const openHarness = async () => Harness.open(await openNodeSqliteStorage(database), {registry: createRegistry(), models: createModels()}, ctx);
  let harness = await openHarness();
  let chat = await harness.createConversation({ownership: {kind: 'ownerless'}}, ctx);
  const state = {dir, get: () => limit} as unknown as State;
  const folder = join(dir, 'artifacts', String(chat.id));
  return {
    dir, state, folder,
    get chat() { return chat; },
    path: (id: string) => join(folder, id),
    async reopen() {
      const id = chat.id;
      await harness.close(ctx);
      harness = await openHarness();
      chat = (await harness.conversation(id, ctx))!;
    },
    async upload(id: string, bytes: Buffer | string, selected = chat) {
      const req = request(id); req.end(bytes);
      return receiveArtifact(req, state, selected);
    },
    async assertWinner(id: string, bytes: Buffer | string) {
      const meta = JSON.parse(readFileSync(join(folder, id + '.json'), 'utf8'));
      assert.deepEqual(readFileSync(join(folder, id)), Buffer.from(bytes));
      assert.equal(meta.sha256, sha256(bytes));
      assert.equal(meta.size, Buffer.byteLength(bytes));
      assert.equal(meta.id, id); assert.equal(meta.conversationId, chat.id);
      const entries = (await chat.entries({}, 100, undefined, ctx)).items.filter(e => e.kind === 'bob.artifact' && e.data?.id === id);
      assert.equal(entries.length, 1);
      assert.deepEqual(entries[0]!.data, meta, 'immutable native receipt, sidecar and original bytes agree');
      assert.ok(await chat.commit(tx => tx.submissionByRequest(chat.id, `artifact:${id}`), ctx));
      const text = JSON.stringify(entries[0]!.model);
      assert.ok(text.includes(join(folder, id)), 'original file-tool path remains in model provenance');
      assert.ok(text.includes('Untrusted original filename'));
      assert.deepEqual(readdirSync(folder).filter(file => file.includes('.part')), [], 'no abandoned byte/metadata temporary files');
      return meta;
    },
    async close() { await harness.close(ctx); rmSync(dir, {recursive: true, force: true}); },
  };
}

for (const identical of [true, false]) test(`overlapping ${identical ? 'identical' : 'differing'} upload IDs retain the first bytes and native receipt`, {timeout: 15000}, async () => {
  const f = await fixture(), id = randomUUID(), winner = 'first content: Résumé\n';
  try {
    const a = request(id), b = request(id, 'other.md');
    const streaming = Promise.all([once(a, 'resume'), once(b, 'resume')]);
    const first = receiveArtifact(a, f.state, f.chat), second = receiveArtifact(b, f.state, f.chat);
    await streaming; // Both actual pipelines passed the original metadata-exists check.
    a.end(winner);
    const receipt = await first;
    b.end(identical ? winner : 'second content must never replace the original\n');
    assert.deepEqual(await second, receipt);
    assert.equal(receipt.name, 'original.md');
    await f.assertWinner(id, winner);
    const res = new Response();
    await downloadArtifact(res as unknown as ServerResponse, f.state, f.chat, id, {range: 'bytes=0-4'});
    assert.equal(res.status, 206); assert.equal(Buffer.concat(res.chunks).toString(), 'first');
    assert.equal(res.headers['content-range'], `bytes 0-4/${Buffer.byteLength(winner)}`);
    await f.reopen();
    assert.deepEqual(await f.upload(id, 'lost-response retry with different bytes'), receipt);
    await f.assertWinner(id, winner);
  } finally { await f.close(); }
});

test('same-ID publication waits for native submission while unrelated IDs remain independent', {timeout: 15000}, async () => {
  const f = await fixture(), id = randomUUID(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let calls = 0;
  const gated = new Proxy(f.chat, {get(target, key) {
    if (key === 'submit') return async (...args: Parameters<Conversation['submit']>) => {
      calls++; entered.resolve(); await release.promise;
      return target.submit(...args);
    };
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  }});
  try {
    const first = f.upload(id, 'winner', gated);
    await entered.promise;
    let secondDone = false;
    const second = f.upload(id, 'ignored retry', gated).then(value => { secondDone = true; return value; });
    const other = randomUUID();
    await f.upload(other, 'independent');
    assert.equal(secondDone, false);
    assert.equal(calls, 1, 'a replay cannot race an in-flight native publication');
    release.resolve();
    assert.deepEqual(await second, await first);
    await f.assertWinner(id, 'winner'); await f.assertWinner(other, 'independent');
  } finally { release.resolve(); await f.close(); }
});

for (const committed of [false, true]) test(`native submit ${committed ? 'lost response' : 'failure before commit'} preserves sidecar and recovers on reopen`, {timeout: 15000}, async () => {
  const f = await fixture(), id = randomUUID();
  const failing = new Proxy(f.chat, {get(target, key) {
    if (key === 'submit') return async (...args: Parameters<Conversation['submit']>) => {
      if (committed) await target.submit(...args);
      throw Error('simulated uncertain submission');
    };
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  }});
  try {
    await assert.rejects(f.upload(id, 'retained original', failing), /uncertain submission/);
    const saved = JSON.parse(readFileSync(f.path(id) + '.json', 'utf8'));
    assert.equal(saved.sha256, sha256('retained original'));
    assert.deepEqual(readdirSync(f.folder).filter(file => file.includes('.part')), []);
    await f.reopen();
    assert.deepEqual(await f.upload(id, 'not a replacement'), saved);
    await f.assertWinner(id, 'retained original');
  } finally { await f.close(); }
});

test('interrupted bytes placement and atomic sidecar failure leave no partial metadata and can retry', {timeout: 15000}, async t => {
  const f = await fixture(), id = randomUUID();
  mkdirSync(f.folder, {recursive: true});
  writeFileSync(f.path(id), 'orphan bytes from an interrupted placement');
  const rename = fs.renameSync;
  let failedMetadata = false;
  const mocked = t.mock.method(fs, 'renameSync', (from: fs.PathLike, to: fs.PathLike) => {
    if (String(to) === f.path(id) + '.json') {
      assert.equal(existsSync(f.path(id) + '.json'), false);
      assert.equal(JSON.parse(readFileSync(from, 'utf8')).sha256, sha256('validated replacement'));
      failedMetadata = true;
      throw Error('simulated sidecar rename failure');
    }
    return rename(from, to);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(f.upload(id, 'validated replacement'), /sidecar rename failure/);
    assert.equal(failedMetadata, true);
    assert.equal(existsSync(f.path(id) + '.json'), false);
    assert.deepEqual(readdirSync(f.folder), [id]);
    assert.equal(await f.chat.commit(tx => tx.submissionByRequest(f.chat.id, `artifact:${id}`), ctx), undefined);
    mocked.mock.restore(); syncBuiltinESMExports();
    await f.reopen();
    await f.upload(id, 'successful retry');
    await f.assertWinner(id, 'successful retry');
  } finally { mocked.mock.restore(); syncBuiltinESMExports(); await f.close(); }
});

test('failed or aborted streams clean temporary files, preserve bounds and permit a same-ID retry', {timeout: 15000}, async () => {
  const f = await fixture(16);
  try {
    for (const [bytes, mime, status] of [[Buffer.alloc(17), 'application/octet-stream', 413], [Buffer.from('not PNG'), 'image/png', 415], [Buffer.from([0xff]), 'text/plain', 415]] as const) {
      const id = randomUUID(), req = request(id, 'file', mime); req.end(bytes);
      await assert.rejects(receiveArtifact(req, f.state, f.chat), (error: any) => error.status === status);
      assert.deepEqual(readdirSync(f.folder), []);
      await f.upload(id, 'valid'); await f.assertWinner(id, 'valid');
      rmSync(f.path(id)); rmSync(f.path(id) + '.json');
    }
    const id = randomUUID(), req = request(id);
    const flowing = once(req, 'resume'), result = receiveArtifact(req, f.state, f.chat);
    const rejected = assert.rejects(result, /interrupted upload/);
    await flowing; req.destroy(Error('interrupted upload')); await rejected;
    assert.deepEqual(readdirSync(f.folder), []);
    await f.upload(id, 'retry'); await f.assertWinner(id, 'retry');
  } finally { await f.close(); }
});
