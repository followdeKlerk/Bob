import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider, fauxAssistantMessage} from '@earendil-works/pi-ai/providers/faux';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';
import {Harness, MemoryStorage, LiveDoc, createRegistry, defineTask, defineExtension,
  type Conversation, type ConversationView, type EntryRecord} from '@earendil-works/pi-durable';
import {openNodeSqliteStorage} from '@earendil-works/pi-durable/storage/sqlite/node';
import {createConversationProjection} from '../src/conversation-projection.js';
import {State} from '../src/state.js';
import {openRuntime} from '../src/runtime.js';
import {serve} from '../src/server.js';
import {ChatMeta} from '../src/documents.js';

const ids = (entries: readonly EntryRecord[]) => entries.map(e => e.id);
async function append(chat: Conversation, count: number) {
  return chat.commit(async tx => {
    const entries: EntryRecord[] = [];
    for (let i = 0; i < count; i++) entries.push(await tx.appendEntry(chat.id, {
      kind: 'bob.user', data: {text: `Synthetic transcript entry ${i}`},
    }));
    return entries;
  }, ctx);
}
async function captured(chat: Conversation) {
  const watch = await chat.watch(ctx);
  try { return watch.value; } finally { await watch.stop(); }
}
function assertNative(projected: Omit<ConversationView, 'before'>, native: ConversationView) {
  assert.equal(projected.docs, native.docs, 'captured built-in docs are unchanged');
  assert.equal(projected.conversation, native.conversation);
  assert.equal(Object.hasOwn(projected, 'before'), false, 'no misleading bounded-window cursor');
}

for (const backend of ['memory', 'sqlite'] as const) {
  test(`Pi 1.5 ${backend}: ordinary >200 entries, reconnect, heads, reset, fork and pinned historical tail`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bob-pi15-context-'));
    const storage = backend === 'memory' ? new MemoryStorage() : await openNodeSqliteStorage(join(dir, 'fixture.sqlite'));
    const h = await Harness.open(storage, {registry: createRegistry(), models: createModels()}, ctx);
    try {
      const chat = await h.createConversation({ownership: {kind: 'ownerless'}}, ctx);
      const empty = await captured(chat);
      const all = await append(chat, 241);
      const project = createConversationProjection(chat, ctx);
      assert.deepEqual((await project(empty)).entries, [], 'a captured empty view cannot leak a later commit');
      const native = await captured(chat);
      assert.equal(native.entries.length, 50, 'actual 1.5 default watch is bounded');
      assert.ok(native.before);
      const view = await project(native);
      assertNative(view, native);
      assert.deepEqual(ids(view.entries), ids(all), 'legacy active transcript is not capped at 50/100/200');
      assert.deepEqual(ids((await createConversationProjection(chat, ctx)(await captured(chat))).entries), ids(all), 'reattach hydrates all active entries');

      // Official entry head semantics, without asking a provider to summarize.
      const head = await chat.commit(tx => tx.appendEntry(chat.id, {
        kind: 'pi.compaction', head: all[160]!.id, data: {reason: 'manual'},
      }), ctx);
      const afterHead = await append(chat, 3);
      const headed = await captured(chat);
      const active = await project(headed);
      assert.deepEqual(ids(active.entries), [head.id, ...ids(all.slice(160)), ...ids(afterHead)]);
      assert.deepEqual(active.entries, (await chat.context(ctx, {at: headed.entries.at(-1)!.id})).entries);
      assertNative(active, headed);

      const fork = await chat.fork(all[120]!.id, {ownership: {kind: 'ownerless'}}, ctx);
      const forked = await append(fork, 2);
      assert.deepEqual(ids((await createConversationProjection(fork, ctx)(await captured(fork))).entries), [...ids(all.slice(0, 121)), ...ids(forked)]);

      await chat.reset(undefined, ctx);
      const postReset = await append(chat, 2);
      const resetView = await project(await captured(chat));
      assert.equal(resetView.entries[0]!.kind, 'pi.reset');
      assert.deepEqual(ids(resetView.entries.slice(1)), ids(postReset));
      assert.deepEqual(ids((await project(native)).entries), ids(all), 'old captured tail ignores a later head/reset');
      assert.deepEqual(ids((await project(headed)).entries), ids(active.entries), 'historical head remains pinned after reset');
    } finally { await h.close(ctx); await rm(dir, {recursive: true, force: true}); }
  });
}

test('Pi 1.5 doc-only updates cache the same tail, not the captured documents', async () => {
  const h = await Harness.open(new MemoryStorage(), {registry: createRegistry(), models: createModels()}, ctx);
  try {
    const chat = await h.createConversation({ownership: {kind: 'ownerless'}}, ctx);
    await append(chat, 230);
    const watch = await chat.watch(ctx);
    try {
      let reads = 0;
      const project = createConversationProjection({context: (...args) => { reads++; return chat.context(...args); }}, ctx);
      const first = watch.value;
      const initial = await project(first);
      const updated = Promise.withResolvers<ConversationView>();
      watch.start(async call => { if (call.kind === 'value') updated.resolve(call.value); });
      // Commit native live generation progress, no fabricated assistant/status entries.
      await chat.commit(async tx => { (await tx.doc(LiveDoc, chat.id)).generation = {attempt: 2}; }, ctx);
      const next = await updated.promise;
      assert.notEqual(next.docs, first.docs);
      const projected = await project(next);
      assertNative(projected, next);
      assert.equal(projected.entries, initial.entries);
      assert.equal(reads, 1);
      assert.deepEqual(projected.docs['pi.live'], {generation: {attempt: 2}});
      const newEntries = await append(chat, 1);
      const latest = await captured(chat);
      assert.equal((await project(latest)).entries.at(-1)!.id, newEntries[0]!.id);
      assert.equal(reads, 2, 'a new native tail invalidates the connection cache');
    } finally { await watch.stop(); }
  } finally { await h.close(ctx); }
});

test('Pi 1.5 native faux token progress reuses entries without synthesizing assistant entries', {timeout: 10000}, async () => {
  const models = createModels(), faux = fauxProvider({tokensPerSecond: 1000, tokenSize: {min: 1, max: 1}});
  models.setProvider(faux.provider);
  faux.setResponses([fauxAssistantMessage('Native streamed tokens. '.repeat(20))]);
  const h = await Harness.open(new MemoryStorage(), {registry: createRegistry(), models,
    settings: {progress: {partialIntervalMs: 2}}}, ctx);
  try {
    const chat = await h.createConversation({ownership: {kind: 'ownerless'}, agent: {model: {provider: 'faux', modelId: 'faux-1'}}}, ctx);
    await append(chat, 241);
    const watch = await chat.watch(ctx);
    try {
      const reads: number[] = [], completed = Promise.withResolvers<void>();
      const project = createConversationProjection({context: (context, options) => {
        reads.push(options!.at!); return chat.context(context, options);
      }}, ctx);
      await project(watch.value);
      let partials = 0;
      const entriesByTail = new Map<number, readonly EntryRecord[]>();
      watch.start(async call => {
        if (call.kind !== 'value') return;
        try {
          const projected = await project(call.value), tail = call.value.entries.at(-1)!.id;
          const previous = entriesByTail.get(tail);
          if (previous) assert.equal(projected.entries, previous);
          entriesByTail.set(tail, projected.entries);
          const live = call.value.docs['pi.live'] as any;
          if (live?.generation?.message) {
            partials++;
            assert.equal(projected.entries.some(entry => entry.kind === 'pi.assistant'), false, 'live tokens stay native docs until generation commits an answer');
            assert.equal(projected.docs, call.value.docs);
          }
          if (!live?.generation && projected.entries.some(entry => entry.kind === 'pi.assistant')) completed.resolve();
        } catch (error) { completed.reject(error); throw error; }
      });
      const submission = await chat.submit({type: 'input', content: 'Synthetic streaming fixture'}, ctx);
      await submission.wait(ctx);
      await completed.promise;
      assert.ok(partials >= 2, 'actual native token progress delivered multiple document-only revisions');
      assert.equal(new Set(reads).size, reads.length, 'one context read per native tail despite token revisions');
      assert.equal(faux.state.callCount, 1);
    } finally { await watch.stop(); }
  } finally { await h.close(ctx); }
});

async function connect(url: string, headers: Record<string, string>, lastEventId?: string) {
  const controller = new AbortController();
  const response = await fetch(url, {headers: {...headers, ...(lastEventId ? {'last-event-id': lastEventId} : {})}, signal: controller.signal});
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type')!, /text\/event-stream/);
  const reader = response.body!.getReader(), decoder = new TextDecoder();
  let buffer = '';
  return {
    async next(): Promise<any> {
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        while (!buffer.includes('\n\n')) {
          const chunk = await reader.read();
          assert.equal(chunk.done, false, 'SSE remains open');
          buffer += decoder.decode(chunk.value, {stream: true});
        }
        const boundary = buffer.indexOf('\n\n'), frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        assert.match(frame, /^event: snapshot\ndata: /);
        return JSON.parse(frame.slice(frame.indexOf('data: ') + 6));
      } finally { clearTimeout(timeout); }
    },
    close() { controller.abort(); },
  };
}

test('authenticated GET/SSE preserve legacy context, native pending→ready and ordered slow 3s refreshes', {timeout: 20000}, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'bob-pi15-http-')), state = new State(dir);
  // No providers registered or inference: official SQLite runtime paused for native pending work.
  const runtime = await openRuntime(state, createModels(), undefined, {resume: false});
  const task = defineTask({name: 'pi15-projection-fixture', version: 1, initial: () => ({}),
    phases: {run: async () => ({status: 'completed' as const, result: null})}, abort: async () => {}});
  runtime.registry.install(defineExtension({name: 'pi15-projection-fixture', tasks: [task]}));
  let refresh: (() => void) | undefined;
  const interval = globalThis.setInterval;
  t.mock.method(globalThis, 'setInterval', ((callback: () => void, ms: number, ...args: any[]) => {
    if (ms === 3000) { refresh = callback; return interval(callback, 3600000, ...args); }
    return interval(callback, ms, ...args);
  }) as typeof setInterval);
  const app = await serve(state, {port: 0, runtime});
  const device = state.pair(state.invite().token, 'Pi 1.5 synthetic regression');
  const headers = {authorization: `Bearer ${device.credential}`, 'x-bob-backend': state.id};
  const base = `http://127.0.0.1:${(app.server.address() as {port: number}).port}/v1/chats`;
  const streams: Awaited<ReturnType<typeof connect>>[] = [];
  const release = Promise.withResolvers<void>();
  try {
    const chat = await runtime.harness.createConversation({ownership: {kind: 'ownerless'}}, ctx);
    const entries = await append(chat, 241);
    const workId = await chat.commit(tx => tx.createTask(task, null, {conversationId: chat.id, ownership: {kind: 'conversation', conversationId: chat.id}}), ctx);
    assert.equal((await runtime.harness.inspect(ctx)).tasks.find(t => t.record.id === workId)!.state.kind, 'pending');
    assert.equal((await fetch(`${base}/${chat.id}`)).status, 401);
    assert.equal((await fetch(`${base}/${chat.id}/events`)).status, 401);
    const response = await fetch(`${base}/${chat.id}`, {headers});
    assert.equal(response.status, 200);
    const get = await response.json() as any;
    assert.deepEqual(ids(get.view.entries), ids(entries));
    assert.equal(get.view.work.find((w: any) => w.id === workId).state, 'ready');
    assert.equal(Object.hasOwn(get.view, 'before'), false);
    const stream = await connect(`${base}/${chat.id}/events`, headers); streams.push(stream);
    const first = await stream.next();
    assert.deepEqual(ids(first.view.entries), ids(entries));
    assert.equal(first.view.work.find((w: any) => w.id === workId).state, 'ready');
    assert.equal(Object.hasOwn(first.view, 'before'), false);

    // Block an actual periodic Bob-document presentation, then publish a newer
    // native tail. A second presentation must not start on a competing line.
    const entered = Promise.withResolvers<void>();
    let block = true, metaReads = 0;
    const snapshot = runtime.harness.snapshot.bind(runtime.harness);
    t.mock.method(runtime.harness, 'snapshot', (async (...args: any[]) => {
      const value = await (snapshot as any)(...args);
      if (args[0] === ChatMeta) {
        metaReads++;
        if (block) { block = false; entered.resolve(); await release.promise; }
      }
      return value;
    }) as typeof runtime.harness.snapshot);
    assert.ok(refresh);
    refresh(); await entered.promise;
    const newer = await append(chat, 1);
    await delay(100);
    assert.equal(metaReads, 1, 'all watch and refresh presentation is serialized');
    release.resolve();
    const olderFrame = await stream.next(), newerFrame = await stream.next();
    assert.deepEqual(ids(olderFrame.view.entries), ids(entries));
    assert.deepEqual(ids(newerFrame.view.entries), [...ids(entries), ...ids(newer)]);
    assert.equal(Object.hasOwn(newerFrame.view, 'before'), false);
    refresh();
    assert.deepEqual(ids((await stream.next()).view.entries), ids(newerFrame.view.entries), 'later refresh cannot roll back entries');

    stream.close();
    const reattached = await connect(`${base}/${chat.id}/events`, headers, 'irrelevant-old-event-id'); streams.push(reattached);
    assert.deepEqual(ids((await reattached.next()).view.entries), [...ids(entries), ...ids(newer)], 'reconnect is authoritative, not a bounded resume window');
  } finally {
    release.resolve(); for (const stream of streams) stream.close();
    await app.close(); state.close(); await rm(dir, {recursive: true, force: true});
  }
});
