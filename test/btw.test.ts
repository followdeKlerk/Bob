import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {setImmediate as immediate} from 'node:timers/promises';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';
import {Harness, MemoryStorage, createRegistry, LiveDoc, type Conversation, type ContextView, type EntryRecord} from '@earendil-works/pi-durable';
import type {AssistantMessage, SimpleStreamOptions, TranscriptContext, Model} from '@earendil-works/pi-ai';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider, fauxAssistantMessage, fauxThinking, fauxText, fauxToolCall, type FauxResponseStep} from '@earendil-works/pi-ai/providers/faux';
import {BTW_LIMITS as limits, createBtwManager, type BtwThreadView} from '../src/btw.js';
import {HttpError} from '../src/errors.js';

const device = 'synthetic-device';
const entry = (kind: string, data?: EntryRecord['data'], model?: EntryRecord['model']): EntryRecord =>
  ({id: 1, conversationId: 7, kind, data, model}) as EntryRecord;
function native(entries: EntryRecord[]): ContextView {
  return {head: undefined, entries, contributions: entries.map(item => item.model ?? []), messages: []};
}
function chatFixture(entries: EntryRecord[] = [], model = 'fixture', thinkingLevel = 'high') {
  const calls: string[] = [];
  const agent = {model: {provider: 'faux', modelId: model}, thinkingLevel,
    instructions: 'SYSTEM-DO-NOT-SEND', sections: [{text: 'SECTION-DO-NOT-SEND'}], tools: [{name: 'NEVER-CALL'}]};
  const current = native(entries);
  const chat = new Proxy({id: 7,
    agent: async () => {calls.push('agent'); return agent;},
    context: async () => {calls.push('context'); return current;},
  }, {get(target, property, receiver) {
    if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
    throw new Error(`Unexpected native method ${String(property)}`);
  }}) as unknown as Conversation;
  return {chat, calls, agent, current};
}
function fixture(options: {contextWindow?: number; maxTokens?: number} = {}) {
  const models = createModels();
  const faux = fauxProvider({provider: 'faux', models: [
    {id: 'fixture', reasoning: true, contextWindow: options.contextWindow ?? 200000, maxTokens: options.maxTokens ?? 8192},
    {id: 'other', reasoning: true},
  ], tokenSize: {min: 1000000, max: 1000000}});
  models.setProvider(faux.provider);
  return {models, faux, manager: createBtwManager(models)};
}
async function settled(manager: ReturnType<typeof createBtwManager>, thread: BtwThreadView, chatId = 7) {
  for (let i = 0; i < 100; i++) {
    const view = manager.get(chatId, device, thread.id);
    if (view.messages.at(-1)?.status !== 'running') return view;
    await immediate();
  }
  throw new Error('Synthetic provider did not settle');
}
function status(code: number) {
  return (error: unknown) => error instanceof HttpError && error.status === code;
}
function plain(context: TranscriptContext) { return JSON.stringify(context.messages); }

test('btw snapshot filters system/tools/thinking/attachments and captures model/thinking once; revisions are change-only', async () => {
  const {manager, faux} = fixture();
  const parentAnswer = fauxAssistantMessage([fauxThinking('PRIVATE-DO-NOT-SEND'), fauxText('public answer'), fauxToolCall('shell', {secret: 'TOOL-CALL-DO-NOT-SEND'})]);
  const parent = chatFixture([
    entry('pi.system', undefined, [{role: 'system', content: 'SYSTEM-DO-NOT-SEND', timestamp: 1}]),
    entry('bob.user', {text: 'public owner question', attachments: [{name: 'ATTACHMENT-DO-NOT-SEND'}]}, [{role: 'user', content: [{type: 'image', data: 'IMAGE-DO-NOT-SEND', mimeType: 'image/png'}], timestamp: 1}]),
    entry('pi.assistant', undefined, [parentAnswer]),
    entry('pi.tool-result', {text: 'TOOL-RESULT-DO-NOT-SEND'}),
    entry('pi.compaction', {text: 'UNKNOWN-SUMMARY-DO-NOT-SEND'}),
    entry('unrecognized', {text: 'UNKNOWN-DO-NOT-SEND'}),
    entry('pi.assistant', undefined, [fauxAssistantMessage('ERROR-DO-NOT-SEND', {stopReason: 'error'})]),
  ]);
  let sent: TranscriptContext | undefined, options: SimpleStreamOptions | undefined, model: Model<string> | undefined;
  faux.setResponses([async (context, opts, _state, selected) => {
    sent = structuredClone(context); options = opts; model = selected;
    return fauxAssistantMessage([fauxThinking('NEW-PRIVATE-DO-NOT-SEND'), fauxText('side answer')]);
  }]);
  try {
    const thread = await manager.create(parent.chat, device, ctx);
    assert.equal(faux.state.callCount, 0, 'create is read-only and unbilled');
    assert.equal(thread.revision, 0);
    assert.deepEqual(thread.model, {provider: 'faux', modelId: 'fixture'});
    assert.equal(thread.thinkingLevel, 'high');
    assert.deepEqual(thread.snapshot, {characters: 'public owner questionpublic answer'.length, truncated: false, omitsLive: true});
    parent.agent.model.modelId = 'other'; parent.agent.thinkingLevel = 'low';
    (parent.current.entries as EntryRecord[]).push(entry('bob.user', {text: 'LATER-DO-NOT-SEND'}));
    const requestId = randomUUID();
    const running = manager.submit(7, device, thread.id, requestId, 'side question');
    assert.equal(running.messages[0]!.status, 'running'); assert.equal(running.revision, 1);
    assert.equal(manager.get(7, device, thread.id).revision, 1);
    assert.equal(manager.submit(7, device, thread.id, requestId.toUpperCase(), 'side question').revision, 1);
    const done = await settled(manager, thread);
    assert.equal(done.revision, 2); assert.equal(done.messages[0]!.answer, 'side answer');
    assert.ok(done.messages[0]!.usage); assert.ok(Number.isFinite(done.messages[0]!.usage!.cost));
    assert.equal(manager.cancel(7, device, thread.id).revision, 2);
    assert.equal(manager.submit(7, device, thread.id, requestId, 'side question').revision, 2);
    assert.equal(faux.state.callCount, 1);
    assert.equal(model!.id, 'fixture'); assert.equal(options!.reasoning, 'high');
    assert.equal(options!.toolChoice, 'none'); assert.equal(options!.maxTokens, 4096);
    assert.equal(options!.maxRetries, 0); assert.equal(options!.disableContinuation, true);
    assert.equal(options!.cacheRetention, 'none'); assert.equal(options!.transport, 'sse');
    assert.equal(options!.timeoutMs, limits.timeoutMs); assert.ok(options!.signal instanceof AbortSignal);
    assert.match(options!.sessionId!, /^[0-9a-f-]{36}$/);
    assert.equal(sent!.messages.some(message => message.role === 'toolResult'), false);
    const system = sent!.messages.filter(message => message.role === 'system');assert.equal(system.length, 1);
    assert.match(system[0]!.content, /You have no tools or execution ability/);
    assert.match(plain(sent!), /public owner question/); assert.match(plain(sent!), /public answer/);
    assert.doesNotMatch(plain(sent!), /DO-NOT-SEND|toolsAdded|thinking|textSignature/);
    assert.doesNotMatch(JSON.stringify(done), /PRIVATE|SYSTEM|ATTACHMENT/);
    assert.deepEqual(parent.calls, ['agent', 'context']);
    // Returned views are defensive copies, not a way to alter dedup or provider input.
    done.messages[0]!.answer = 'MUTATED'; done.model.modelId = 'other';
    assert.equal(manager.get(7, device, thread.id).messages[0]!.answer, 'side answer');
  } finally { await manager.close(); }
});

test('btw recent snapshot is bounded by characters/message count, honors edited contributions and never imports arbitrary summaries', async () => {
  const {manager, faux} = fixture();
  const parent = chatFixture([entry('bob.user', {text: 'old'.repeat(20000)}), entry('bob.user', {text: 'new'.repeat(20000)}),
    entry('pi.assistant', undefined, [fauxAssistantMessage('STALE-RAW-ANSWER')])]);
  (parent.current.contributions as (readonly import('@earendil-works/pi-ai').Message[])[])[2] = [fauxAssistantMessage('edited answer')];
  let sent = '';
  faux.setResponses([context => {sent = plain(context); return fauxAssistantMessage('ok');}]);
  try {
    const thread = await manager.create(parent.chat, device, ctx);
    assert.equal(thread.snapshot.characters, limits.contextCharacters); assert.equal(thread.snapshot.truncated, true);
    manager.submit(7, device, thread.id, randomUUID(), 'question'); await settled(manager, thread);
    assert.match(sent, /edited answer/); assert.doesNotMatch(sent, /STALE-RAW|oldold/);
    const texts = Array.from({length: 140}, (_, n) => entry('bob.user', {text: `message-${n};`}));
    const bounded = await manager.create(chatFixture(texts).chat, device, ctx);
    assert.equal(bounded.snapshot.truncated, true);
    faux.setResponses([context => {assert.equal(context.messages.length, limits.snapshotMessages + 2); return fauxAssistantMessage('ok');}]);
    manager.submit(7, device, bounded.id, randomUUID(), 'question'); assert.equal((await settled(manager, bounded)).messages.at(-1)?.status, 'done');
  } finally { await manager.close(); }
});

test('btw UTF-8 input budget and output tokens clamp to the captured model and context', async () => {
  const {manager, faux} = fixture({contextWindow: 15000, maxTokens: 99});
  let options: SimpleStreamOptions | undefined, sent: TranscriptContext | undefined;
  faux.setResponses([async (context, opts) => {sent = context; options = opts; return fauxAssistantMessage('ok');}]);
  try {
    const thread = await manager.create(chatFixture([entry('bob.user', {text: '界'.repeat(20000)})]).chat, device, ctx);
    assert.ok(thread.snapshot.characters < limits.contextCharacters); assert.equal(thread.snapshot.truncated, true);
    manager.submit(7, device, thread.id, randomUUID(), '界'.repeat(4000)); await settled(manager, thread);
    assert.equal(options!.maxTokens, 99);
    const bytes = sent!.messages.reduce((n, m) => n + 64 + Buffer.byteLength(typeof m.content === 'string' ? m.content : ''), 512);
    assert.ok(bytes + options!.maxTokens! <= 15000);
    assert.doesNotThrow(() => JSON.stringify(sent));
  } finally { await manager.close(); }
  const tiny = fixture({contextWindow: 1500, maxTokens: 4096});
  try {
    let maxTokens: number | undefined;
    tiny.faux.setResponses([(_c, options, _state, model) => {
      maxTokens = options!.maxTokens;
      assert.equal(model.maxTokens, maxTokens, 'token-budgeted adapters cannot expand reasoning beyond the request ceiling');
      return fauxAssistantMessage('ok');
    }]);
    const thread = await tiny.manager.create(chatFixture().chat, device, ctx);
    tiny.manager.submit(7, device, thread.id, randomUUID(), 'q'); await settled(tiny.manager, thread);
    assert.ok(maxTokens! > 0 && maxTokens! < 4096);
    assert.throws(() => tiny.manager.submit(7, device, thread.id, randomUUID(), 'x'.repeat(1000)), status(409));
  } finally { await tiny.manager.close(); }
});

test('btw strict device/conversation/epoch isolation and validated input cannot start inference', async () => {
  const {manager, faux, models} = fixture();
  try {
    const thread = await manager.create(chatFixture().chat, device, ctx);
    const wrong = [[8, device, thread.id], [7, 'other-device', thread.id], [7, device, randomUUID()]] as const;
    for (const [chatId, deviceId, threadId] of wrong) {
      assert.throws(() => manager.get(chatId, deviceId, threadId), status(404));
      assert.throws(() => manager.submit(chatId, deviceId, threadId, randomUUID(), 'question'), status(404));
      assert.throws(() => manager.cancel(chatId, deviceId, threadId), status(404));
      assert.throws(() => manager.remove(chatId, deviceId, threadId), status(404));
    }
    for (const [id, text] of [['not-a-uuid', 'question'], [randomUUID(), ' '], [randomUUID(), 'x'.repeat(4001)]]) {
      assert.throws(() => manager.submit(7, device, thread.id, id!, text!), status(400));
    }
    assert.equal(faux.state.callCount, 0);
    const restarted = createBtwManager(models);
    try { assert.throws(() => restarted.submit(7, device, thread.id, randomUUID(), 'never replay'), status(404)); }
    finally { await restarted.close(); }
    manager.remove(7, device, thread.id);
    assert.throws(() => manager.get(7, device, thread.id), status(404));
  } finally { await manager.close(); }
});

test('btw single request, permanent text-bound dedup, cancellation, and late provider replies are fenced', async () => {
  const {manager, faux} = fixture();
  const first = Promise.withResolvers<AssistantMessage>();
  const second = Promise.withResolvers<AssistantMessage>();
  const signals: AbortSignal[] = [], sessions: string[] = [];
  faux.setResponses([async (_c, opts) => {signals.push(opts!.signal!); sessions.push(opts!.sessionId!); return first.promise;},
    async (_c, opts) => {signals.push(opts!.signal!); sessions.push(opts!.sessionId!); return second.promise;}]);
  try {
    const thread = await manager.create(chatFixture().chat, device, ctx), requestId = randomUUID();
    manager.submit(7, device, thread.id, requestId, 'one'); await immediate();
    assert.throws(() => manager.submit(7, device, thread.id, randomUUID(), 'two'), status(409));
    assert.throws(() => manager.submit(7, device, thread.id, requestId, 'different'), status(409));
    for (let n = 0; n < 10; n++) manager.submit(7, device, thread.id, requestId, 'one');
    assert.equal(faux.state.callCount, 1);
    const cancelled = manager.cancel(7, device, thread.id);
    assert.equal(cancelled.revision, 2); assert.equal(cancelled.messages[0]!.status, 'cancelled'); assert.equal(signals[0]!.aborted, true);
    manager.submit(7, device, thread.id, requestId, 'one'); assert.equal(faux.state.callCount, 1);
    const running = manager.submit(7, device, thread.id, randomUUID(), 'two'); await immediate();
    assert.equal(running.revision, 3); assert.notEqual(sessions[0], sessions[1]);
    first.resolve(fauxAssistantMessage('LATE-DO-NOT-PUBLISH')); await immediate();
    assert.equal(manager.get(7, device, thread.id).revision, 3);
    assert.equal(manager.get(7, device, thread.id).messages[1]!.status, 'running');
    second.resolve(fauxAssistantMessage('second answer'));
    const done = await settled(manager, thread);
    assert.equal(done.revision, 4); assert.equal(done.messages[1]!.answer, 'second answer');
    assert.doesNotMatch(JSON.stringify(done), /LATE-DO-NOT-PUBLISH/);
  } finally { first.resolve(fauxAssistantMessage('late')); second.resolve(fauxAssistantMessage('late')); await manager.close(); }
});

test('btw timeout is terminal unknown, deduplicated, and late rejected provider work is consumed', async t => {
  t.mock.timers.enable({apis: ['Date', 'setTimeout', 'setInterval'], now: 1700000000000});
  const {manager, faux} = fixture(), pending = Promise.withResolvers<AssistantMessage>();
  let signal: AbortSignal | undefined;
  faux.setResponses([async (_c, options) => {signal = options!.signal; return pending.promise;}]);
  try {
    const thread = await manager.create(chatFixture().chat, device, ctx), requestId = randomUUID();
    manager.submit(7, device, thread.id, requestId, 'one'); await immediate();
    t.mock.timers.tick(limits.timeoutMs);
    const failed = manager.get(7, device, thread.id);
    assert.equal(failed.revision, 2); assert.equal(failed.messages[0]!.status, 'failed');
    assert.match(failed.messages[0]!.error!, /timed out.*unknown.*not be retried/); assert.equal(signal!.aborted, true);
    manager.submit(7, device, thread.id, requestId, 'one'); assert.equal(faux.state.callCount, 1);
    pending.reject(new Error('synthetic credential MUST-NOT-LEAK')); await immediate();
    assert.equal(manager.get(7, device, thread.id).revision, 2);
    assert.doesNotMatch(JSON.stringify(manager.get(7, device, thread.id)), /MUST-NOT-LEAK/);
  } finally { pending.resolve(fauxAssistantMessage('late')); await manager.close(); }
});

test('btw provider exceptions/errors/tool calls/deferred/empty results fail safely without automatic retries', async () => {
  const {manager, faux} = fixture();
  const responses: FauxResponseStep[] = [() => {throw new Error('CREDENTIAL-NEVER-ECHO');},
    fauxAssistantMessage('CREDENTIAL-NEVER-ECHO', {stopReason: 'error', errorMessage: 'CREDENTIAL-NEVER-ECHO'}),
    fauxAssistantMessage([fauxText('do not expose'), fauxToolCall('shell', {})], {stopReason: 'toolUse'}),
    fauxAssistantMessage('', {stopReason: 'deferred', deferred: {provider: 'faux', api: 'faux', id: 'synthetic'} as AssistantMessage['deferred']}),
    fauxAssistantMessage([fauxThinking('PRIVATE-NEVER-ECHO')]),
  ];
  faux.setResponses(responses);
  try {
    const thread = await manager.create(chatFixture().chat, device, ctx);
    for (let n = 0; n < responses.length; n++) {
      const requestId = randomUUID();
      manager.submit(7, device, thread.id, requestId, `question-${n}`);
      const done = await settled(manager, thread);
      const receipt = done.messages.at(-1)!;
      assert.equal(receipt.status, 'failed'); assert.equal(receipt.answer, undefined);
      assert.match(receipt.error!, /outcome is unknown.*not be retried/);
      manager.submit(7, device, thread.id, requestId, `question-${n}`);
    }
    assert.equal(faux.state.callCount, responses.length); assert.equal(faux.state.deferredFetchCount, 0);
    assert.doesNotMatch(JSON.stringify(manager.get(7, device, thread.id)), /NEVER-ECHO|do not expose/);
  } finally { await manager.close(); }
});

test('btw response/history/turn bounds never discard paid receipts; future calls receive only public completed text', async () => {
  const {manager, faux} = fixture();
  let captured = '';
  faux.setResponses([fauxAssistantMessage([fauxThinking('PRIVATE-DO-NOT-SEND'), fauxText('a'.repeat(25000))]),
    context => {captured = plain(context); return fauxAssistantMessage('b'.repeat(25000));},
    ...Array.from({length: 10}, () => fauxAssistantMessage('c'.repeat(25000)))]);
  try {
    const thread = await manager.create(chatFixture().chat, device, ctx), firstId = randomUUID();
    manager.submit(7, device, thread.id, firstId, 'one');
    const first = await settled(manager, thread);
    assert.equal(first.messages[0]!.answer!.length, limits.responseCharacters);
    manager.submit(7, device, thread.id, randomUUID(), 'two'); await settled(manager, thread);
    assert.doesNotMatch(captured, /PRIVATE-DO-NOT-SEND|thinkingSignature/); assert.match(captured, /one/);
    while (manager.get(7, device, thread.id).messages.length < 6) {
      manager.submit(7, device, thread.id, randomUUID(), 'q'); await settled(manager, thread);
    }
    assert.throws(() => manager.submit(7, device, thread.id, randomUUID(), 'exhausted'), status(409));
    assert.equal(manager.submit(7, device, thread.id, firstId, 'one').messages[0]!.answer, first.messages[0]!.answer);
    assert.throws(() => manager.submit(7, device, thread.id, firstId, 'changed'), status(409));
    const turns = await manager.create(chatFixture().chat, device, ctx);
    faux.setResponses(Array.from({length: limits.turns}, () => fauxAssistantMessage('ok')));
    let oldest = '';
    for (let n = 0; n < limits.turns; n++) {
      const requestId = randomUUID(); if (!n) oldest = requestId;
      manager.submit(7, device, turns.id, requestId, 'small'); await settled(manager, turns);
    }
    assert.throws(() => manager.submit(7, device, turns.id, randomUUID(), 'full'), status(409));
    assert.equal(manager.submit(7, device, turns.id, oldest, 'small').messages.length, limits.turns);
  } finally { await manager.close(); }
});

test('btw fixed TTL, disposal, close and reservation caps stay bounded', async t => {
  t.mock.timers.enable({apis: ['Date', 'setTimeout', 'setInterval'], now: 1700000000000});
  const {manager, faux, models} = fixture();
  const pending = Promise.withResolvers<AssistantMessage>();
  let signal: AbortSignal | undefined;
  faux.setResponses([async (_c, options) => {signal = options!.signal; return pending.promise;}]);
  try {
    const thread = await manager.create(chatFixture().chat, device, ctx);
    manager.submit(7, device, thread.id, randomUUID(), 'question'); await immediate();
    t.mock.timers.tick(limits.ttlMs);
    assert.throws(() => manager.get(7, device, thread.id), status(404)); assert.equal(signal!.aborted, true);
    pending.resolve(fauxAssistantMessage('late')); await immediate();
    for (let n = 0; n < limits.threadsPerDevice; n++) await manager.create(chatFixture().chat, device, ctx);
    await assert.rejects(manager.create(chatFixture().chat, device, ctx), status(429));
    t.mock.timers.tick(limits.ttlMs);
    assert.equal((await manager.create(chatFixture().chat, device, ctx)).snapshot.characters, 0);
    for (let n = 1; n < limits.threadsGlobal; n++) await manager.create(chatFixture().chat, `device-${n}`, ctx);
    await assert.rejects(manager.create(chatFixture().chat, 'overflow', ctx), status(429));
    await manager.close(); await manager.close();
    assert.throws(() => manager.get(7, device, thread.id), status(503));
    await assert.rejects(manager.create(chatFixture().chat, device, ctx), status(503));
  } finally { pending.resolve(fauxAssistantMessage('late')); await manager.close(); }
  const reserved = createBtwManager(models), gate = Promise.withResolvers<void>();
  const blocked = chatFixture(); blocked.chat.agent = async () => {await gate.promise; return blocked.agent as unknown as Awaited<ReturnType<Conversation['agent']>>;};
  const creates = Array.from({length: limits.threadsPerDevice}, () => reserved.create(blocked.chat, device, ctx));
  try {
    await assert.rejects(reserved.create(blocked.chat, device, ctx), status(429));
    await reserved.close(); gate.resolve();
    for (const create of creates) await assert.rejects(create, status(503));
  } finally { gate.resolve(); await reserved.close(); }
});

test('btw uncooperative cancelled calls retain bounded physical call slots and close does not hang', async () => {
  const {manager, faux} = fixture();
  const gates = Array.from({length: limits.callsPerDevice}, () => Promise.withResolvers<AssistantMessage>());
  faux.setResponses(gates.map(gate => async () => gate.promise));
  try {
    const thread = await manager.create(chatFixture().chat, device, ctx);
    for (const _gate of gates) {
      manager.submit(7, device, thread.id, randomUUID(), 'question'); await immediate(); manager.cancel(7, device, thread.id);
    }
    assert.throws(() => manager.submit(7, device, thread.id, randomUUID(), 'overflow'), status(429));
    await manager.close();
    for (const gate of gates) gate.reject(new Error('ignored synthetic provider failure'));
    await immediate();
  } finally { for (const gate of gates) gate.resolve(fauxAssistantMessage('late')); await manager.close(); }
});

test('btw missing model/read failures are sanitized and thinking off matches native options', async () => {
  const {manager, faux} = fixture();
  try {
    await assert.rejects(manager.create(chatFixture([], 'missing').chat, device, ctx), status(409));
    const broken = chatFixture(); broken.chat.context = async () => {throw new HttpError(400, 'CREDENTIAL-DO-NOT-ECHO');};
    await assert.rejects(manager.create(broken.chat, device, ctx), (error: unknown) => error instanceof HttpError && error.status === 503 && !error.message.includes('CREDENTIAL'));
    faux.setResponses([(_context, options) => {assert.equal(options!.reasoning, undefined); return fauxAssistantMessage('ok');}]);
    const thread = await manager.create(chatFixture([], 'fixture', 'off').chat, device, ctx);
    manager.submit(7, device, thread.id, randomUUID(), 'question'); await settled(manager, thread);
  } finally { await manager.close(); }
});

test('btw real native harness remains unchanged while its main provider request runs concurrently', {timeout: 15000}, async () => {
  const {manager, models, faux} = fixture();
  const harness = await Harness.open(new MemoryStorage(), {models, registry: createRegistry()}, ctx);
  const mainGate = Promise.withResolvers<AssistantMessage>(), started = Promise.withResolvers<void>();
  let mainSignal: AbortSignal | undefined;
  faux.setResponses([async (_context, options) => {mainSignal = options!.signal; started.resolve(); return mainGate.promise;}, fauxAssistantMessage('isolated side answer')]);
  try {
    const chat = await harness.createConversation({ownership: {kind: 'ownerless'}, agent: {model: {provider: 'faux', modelId: 'fixture'}, thinkingLevel: 'high'}}, ctx);
    const main = await chat.submit({type: 'input', requestId: 'synthetic-main', content: 'main question', entry: {kind: 'bob.user', data: {text: 'main question'}}}, ctx);
    await started.promise;
    const before = await chat.context(ctx);
    const beforeLive = await harness.snapshot(LiveDoc, chat.id, ctx);
    const thread = await manager.create(chat, device, ctx);
    assert.equal(thread.snapshot.omitsLive, true);
    manager.submit(chat.id, device, thread.id, randomUUID(), 'side question');
    const done = await settled(manager, thread, chat.id);
    assert.equal(done.messages[0]!.answer, 'isolated side answer'); assert.equal(mainSignal!.aborted, false);
    assert.deepEqual(await chat.context(ctx), before, 'no main transcript/context mutation');
    assert.deepEqual(await harness.snapshot(LiveDoc, chat.id, ctx), beforeLive, 'no native run/submission mutation');
    manager.cancel(chat.id, device, thread.id); manager.remove(chat.id, device, thread.id);
    assert.equal(mainSignal!.aborted, false);
    mainGate.resolve(fauxAssistantMessage('main completed'));
    await main.wait(ctx);
    const final = JSON.stringify(await chat.context(ctx));
    assert.match(final, /main completed/); assert.doesNotMatch(final, /side question|isolated side answer/);
  } finally { mainGate.resolve(fauxAssistantMessage('main completed')); await manager.close(); await harness.close(ctx); }
});

test('btw explicit device cleanup reclaims abandoned thread slots without affecting another device',async()=>{
 const {manager}=fixture();const {chat}=chatFixture();
 try{
  const abandoned=[];for(let i=0;i<limits.threadsPerDevice;i++)abandoned.push(await manager.create(chat,device,ctx));
  const other=await manager.create(chat,'other-device',ctx);
  await assert.rejects(manager.create(chat,device,ctx),status(429));
  assert.equal(manager.discardDevice(device),limits.threadsPerDevice);
  for(const thread of abandoned)assert.throws(()=>manager.get(7,device,thread.id),status(404));
  assert.equal(manager.get(7,'other-device',other.id).id,other.id);
  assert.ok((await manager.create(chat,device,ctx)).id);
 }finally{await manager.close();}
});
test('btw device cleanup also invalidates in-flight unbilled snapshot reservations',async()=>{
 const {manager}=fixture(),original=chatFixture();let resolve!:(value:ContextView)=>void;
 const chat={id:7,agent:original.chat.agent.bind(original.chat),context:()=>new Promise<ContextView>(r=>{resolve=r;})} as unknown as Conversation;
 try{
  const creating=manager.create(chat,device,ctx);await immediate();
  assert.equal(manager.discardDevice(device),1);resolve(original.current);
  await assert.rejects(creating,status(404));
  assert.ok((await manager.create(original.chat,device,ctx)).id);
 }finally{await manager.close();}
});
