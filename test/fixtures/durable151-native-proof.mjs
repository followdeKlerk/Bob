// Synthetic native-only compatibility probe. No Bob runtime, control DB or providers.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, appendFileSync, realpathSync} from 'node:fs';
import {join, basename, dirname, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
const [packageRoot, expectedVersion, mode, directory] = process.argv.slice(2);
const dir = realpathSync(directory);
assert.equal(dirname(dir), realpathSync(tmpdir()));
assert.ok(basename(dir).startsWith('bob-durable151-native-'));
assert.equal(readFileSync(join(dir, 'DISPOSABLE'), 'utf8'), 'synthetic native proof only\n');
// Use ESM import conditions from the selected installation (not this fixture's dependencies).
const native = specifier => import(import.meta.resolve(specifier, pathToFileURL(join(resolve(packageRoot), 'package.json')).href));
const {Harness, createRegistry, defineDoc, defineTask, defineExtension, defineTool, AgentDoc, ToolTask} = await native('@earendil-works/pi-durable');
const {openNodeSqliteStorage} = await native('@earendil-works/pi-durable/storage/sqlite/node');
const {createModels} = await native('@earendil-works/pi-ai/models');
const {BACKGROUND_CONTEXT: ctx} = await native('@earendil-works/chord/context');
const version = JSON.parse(readFileSync(join(packageRoot, 'node_modules/@earendil-works/pi-durable/package.json'), 'utf8')).version;
assert.equal(version, expectedVersion);
globalThis.fetch = async () => { throw Error('Network/provider access forbidden in native proof'); };
const metadataPath = join(dir, 'fixture.json');
const auditPath = join(dir, 'executions.jsonl');
const compaction = {enabled: false, reserveTokens: 1234, keepRecentTokens: 5678, backgroundTokens: 0, modelOverrides: {'synthetic/model': {reserveTokens: 321}}};
const Doc = defineDoc({kind: 'synthetic.durable151', version: 1, scope: 'conversation', history: 'rewindable', fork: 'current', initial: () => ({text: 'initial', mutations: []}), checkpointWhen: () => true});
const Held = defineTask({name: 'synthetic.durable151-held', version: 1, initial: () => ({phase: 'held'}), phases: {held: async (_task, runtime, context) => runtime.commit(() => ({status: 'terminal', outcome: {status: 'completed', result: {recovered: true}}}), context)}, abort: async () => {}});
const entered = new Set();
const tools = ['safe', 'unsafe'].map(replay => defineTool({name: `synthetic_${replay}`, description: 'In-memory synthetic recovery probe', parameters: {type: 'object', properties: {}, additionalProperties: false}, replay,
  execute: async () => {
    appendFileSync(auditPath, JSON.stringify({version, mode, replay}) + '\n');
    if (mode === 'crash') {
      entered.add(replay);
      if (entered.size === 2) {
        // Intent is durably committed by native ToolTask before execute is called.
        // Exit only this disposable child, deliberately without graceful close.
        console.log(JSON.stringify({mode, version, durableExecuteIntents: [...entered]}));
        process.exit(0);
      }
      return new Promise(() => {});
    }
    return {output: [{type: 'text', text: `${replay} recovered synthetically`}]};
  }
}));
const extension = defineExtension({name: 'synthetic.durable151', tasks: [Held], tools});
const registry = createRegistry(); registry.install(extension);
const reports = [];
const h = await Harness.open(await openNodeSqliteStorage(join(dir, 'durable.sqlite')), {registry, models: createModels(), settings: {extensions: [extension]}, onReport: report => reports.push({message: String(report.error), info: report.info})}, ctx);
let result = {mode, version, agentDocVersion: AgentDoc.definition.version, toolTaskVersion: ToolTask.definition.version};
try {
  if (mode === 'seed') {
    assert.equal(version, '1.5.0');
    const c = await h.createConversation({ownership: {kind: 'ownerless'}, agent: {instructions: 'Synthetic original instructions', maxTurns: 9}}, ctx);
    const tasks = await c.commit(async tx => {
      (await tx.doc(Doc, c.id)).text = 'synthetic document survives';
      await tx.doc(AgentDoc, c.id); // Acquire the actual built-in draft, not just Harness.open.
      for (let i = 0; i < 4; i++) await tx.appendEntry(c.id, {kind: 'synthetic.history', data: {i}});
      const held = await tx.createTask(Held, null, {ownership: {kind: 'conversation'}});
      const toolIds = {};
      for (const replay of ['safe', 'unsafe']) {
        const call = {type: 'toolCall', id: `synthetic-${replay}`, name: `synthetic_${replay}`, arguments: {}};
        const entry = await tx.appendEntry(c.id, {kind: 'pi.assistant', data: {}, model: [{role: 'assistant', content: [call], api: 'synthetic', provider: 'synthetic', model: 'synthetic', stopReason: 'toolUse', timestamp: 1}]});
        toolIds[replay] = await tx.createTask(ToolTask, {kind: 'model', assistant: entry.id, callId: call.id}, {ownership: {kind: 'conversation'}});
      }
      return {held, ...toolIds};
    }, ctx);
    const entries = (await c.entries({}, 100, undefined, ctx)).items;
    const metadata = {conversationId: c.id, tasks, originalEntryIds: entries.map(e => e.id)};
    writeFileSync(metadataPath, JSON.stringify(metadata));
    for (const id of Object.values(tasks)) assert.equal((await h.getTask(id, ctx)).state.status, 'pending');
    result = {...result, ...metadata, pendingTasks: 3};
  } else {
    const before = JSON.parse(readFileSync(metadataPath, 'utf8'));
    const c = await h.conversation(before.conversationId, ctx); assert.ok(c);
    const entries = (await c.entries({}, 100, undefined, ctx)).items;
    for (const id of before.originalEntryIds) assert.ok(entries.some(e => e.id === id), `history ID lost: ${id}`);
    assert.deepEqual(entries.filter(e => e.kind === 'synthetic.history').map(e => e.data.i), [3, 2, 1, 0]);
    assert.equal((await h.snapshot(Doc, c.id, ctx)).text, 'synthetic document survives');
    const storedAgent = await h.snapshot(AgentDoc, c.id, ctx);
    assert.equal(storedAgent.instructions, 'Synthetic original instructions');
    assert.equal(storedAgent.maxTurns, 9);
    const effectiveAgent = await c.agent(ctx);
    result = {...result, historyRead: true, documentRead: true, storedCompaction: storedAgent.compaction ?? null, effectiveCompaction: effectiveAgent.compaction ?? null};
    if (mode === 'draft' || mode === 'configure' || mode === 'mutate') {
      await c.commit(async tx => {
        const agent = await tx.doc(AgentDoc, c.id);
        assert.equal(agent.instructions, storedAgent.instructions);
        if (mode === 'mutate') agent.cwd = '/synthetic/old-mutation';
        (await tx.doc(Doc, c.id)).mutations.push(`${version}:${mode}`);
        await tx.appendEntry(c.id, {kind: 'synthetic.mutation', data: {version, mode}});
      }, ctx);
      if (mode === 'configure') {
        assert.equal(version, '1.5.1');
        await c.configure({compaction}, ctx);
        assert.deepEqual((await h.snapshot(AgentDoc, c.id, ctx)).compaction, compaction);
        assert.deepEqual((await c.agent(ctx)).compaction, compaction);
      }
      if (mode === 'mutate' && storedAgent.compaction !== undefined) {
        assert.equal(version, '1.5.0');
        // Native 1.5.0 can preserve unknown stored fields while ignoring their semantics.
        assert.equal(effectiveAgent.compaction, undefined);
        await c.configure({compaction: {enabled: true, reserveTokens: 999}}, ctx);
        assert.deepEqual((await h.snapshot(AgentDoc, c.id, ctx)).compaction, compaction, 'old configure silently ignores this new field');
        result.oldConfigureIgnoredCompaction = true;
      }
      assert.ok((await c.entries({}, 100, undefined, ctx)).items.some(e => e.kind === 'synthetic.mutation' && e.data.mode === mode && e.data.version === version));
      assert.ok((await h.snapshot(Doc, c.id, ctx)).mutations.includes(`${version}:${mode}`));
      result.draftAcquired = true; result.historyAndDocumentMutation = true;
    } else if (mode === 'crash' || mode === 'recover') {
      const records = await Promise.all(Object.values(before.tasks).map(id => h.getTask(id, ctx)));
      result.initialTaskStates = records.map(t => ({id: t.id, kind: t.kind, version: t.version, state: t.state}));
      if (mode === 'recover' && process.env.EXPECT_EXECUTE === '1') {
        for (const replay of ['safe', 'unsafe']) assert.equal((await h.getTask(before.tasks[replay], ctx)).state.checkpoint.phase, 'execute');
      }
      h.resume();
      if (mode === 'crash') await new Promise(() => {});
      for (const id of Object.values(before.tasks)) {
        const task = await h.waitForTask(id, ctx);
        assert.equal(task.state.status, 'terminal');
        assert.equal(task.state.outcome.status, process.env.EXPECT_EXECUTE === '1' && id === before.tasks.unsafe ? 'failed' : 'completed');
      }
      const after = (await c.entries({}, 100, undefined, ctx)).items;
      const results = after.filter(e => e.kind === 'pi.tool-result');
      assert.equal(results.length, 2);
      const unsafe = results.find(e => e.model?.[0]?.toolName === 'synthetic_unsafe');
      assert.ok(unsafe);
      if (process.env.EXPECT_EXECUTE === '1') assert.ok(unsafe.data.diagnostics.some(d => d.code === 'interrupted'));
      else assert.equal(unsafe.model[0].isError, false);
      result = {...result, recoveredTasks: 3, toolResults: results.map(e => ({toolName: e.model[0].toolName, diagnostics: e.data.diagnostics}))};
    } else if (mode === 'verify') {
      if (process.env.EXPECT_COMPACTION === '1') assert.deepEqual(storedAgent.compaction, compaction);
      if (process.env.EXPECT_COMPACTION === '1' && version === '1.5.1') assert.deepEqual(effectiveAgent.compaction, compaction);
    } else throw Error(`Unknown mode ${mode}`);
  }
} finally { await h.close(ctx); }
assert.deepEqual(reports, [], 'native reported a task or storage failure');
console.log(JSON.stringify(result));
