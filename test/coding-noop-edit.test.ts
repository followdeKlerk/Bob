import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test, type TestContext} from 'node:test';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';
import {NodeExecutionEnv} from '@earendil-works/pi-durable/env/node';
import {CodingTools as NativeCodingTools, type createEditTool} from '@earendil-works/pi-durable/tools';
import {CodingTools} from '../packages/coding/src/index.js';

type EditTool = ReturnType<typeof createEditTool>;
const edit = CodingTools.tools!.find(tool => tool.name === 'edit')! as EditTool;
const native = NativeCodingTools.tools!.find(tool => tool.name === 'edit')! as EditTool;

function fixture(t: TestContext, content = 'alpha\nbeta\ngamma\n') {
  const dir = mkdtempSync(join(tmpdir(), 'bob-noop-edit-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const path = join(dir, 'file.txt');
  writeFileSync(path, content);
  const env = new NodeExecutionEnv({cwd: dir});
  const writes = t.mock.method(env, 'writeFile');
  const accesses = t.mock.method(env, 'absolutePath');
  // These native tools only use the execution environment from the tool API.
  const api = {env} as unknown as Parameters<EditTool['execute']>[1];
  return {
    path, content, writes, accesses, api,
    read: () => readFileSync(path, 'utf8'),
    run: (args: unknown, tool = edit) => tool.execute(tool.prepareArguments!(args), api, ctx),
  };
}

test('coding extension configures image read and wraps edit while retaining other native registrations', () => {
  assert.equal(CodingTools.name, NativeCodingTools.name);
  assert.deepEqual(Object.keys(CodingTools), Object.keys(NativeCodingTools));
  assert.deepEqual(CodingTools.tools!.map(tool => tool.name), NativeCodingTools.tools!.map(tool => tool.name));
  for (const tool of NativeCodingTools.tools!) {
    if (tool.name !== 'edit' && tool.name !== 'read') assert.equal(CodingTools.tools!.find(candidate => candidate.name === tool.name), tool);
    if (tool.name === 'read') assert.deepEqual(CodingTools.tools!.find(candidate => candidate.name === 'read')!.parameters, tool.parameters);
  }
  assert.deepEqual({...edit, execute: native.execute}, native);
  assert.equal(edit.prepareArguments, native.prepareArguments);
});

test('identical single edit is rejected before file access, including missing files', async t => {
  const f = fixture(t);
  for (const path of [f.path, join(f.path, 'missing')]) {
    await assert.rejects(f.run({path, edits: [{oldText: 'alpha', newText: 'alpha'}]}), /Edit block 1 has identical oldText and newText/);
  }
  assert.equal(f.read(), f.content);
  assert.equal(f.writes.mock.callCount(), 0);
  assert.equal(f.accesses.mock.callCount(), 0);
});

test('mixed batch rejects any identical block atomically with a 1-based index', async t => {
  const f = fixture(t);
  for (const edits of [
    [{oldText: 'alpha', newText: 'changed'}, {oldText: 'beta', newText: 'beta'}],
    [{oldText: 'beta', newText: 'beta'}, {oldText: 'alpha', newText: 'changed'}],
    [{oldText: 'alpha', newText: 'changed'}, {oldText: 'beta', newText: 'changed too'}, {oldText: 'not present', newText: 'not present'}],
  ]) {
    const index = edits.findIndex(block => block.oldText === block.newText) + 1;
    await assert.rejects(f.run({path: f.path, edits}), new RegExp(`Edit block ${index} has identical oldText and newText`));
    assert.equal(f.read(), f.content);
  }
  assert.equal(f.writes.mock.callCount(), 0);
  assert.equal(f.accesses.mock.callCount(), 0);
});

test('native argument repairs still reject identical blocks without mutating input', async t => {
  const f = fixture(t);
  const block = {oldText: 'alpha', newText: 'alpha'};
  for (const args of [
    {path: f.path, edits: block},
    {path: f.path, edits: JSON.stringify([block])},
    {path: f.path, edits: JSON.stringify(block)},
    {path: f.path, ...block},
    {path: f.path, edits: [{oldText: 'beta', newText: 'changed'}], ...block},
  ]) {
    const before = structuredClone(args);
    await assert.rejects(f.run(args), /has identical oldText and newText/);
    assert.deepEqual(args, before);
  }
  assert.equal(f.read(), f.content);
  assert.equal(f.writes.mock.callCount(), 0);
  assert.equal(f.accesses.mock.callCount(), 0);
});

test('real edits retain native result details, original-file matching, BOM and CRLF', async t => {
  const f = fixture(t, '\uFEFFalpha\r\nbeta\r\ngamma\r\n');
  const args = {path: f.path, edits: [{oldText: 'alpha', newText: 'beta'}, {oldText: 'beta', newText: 'delta'}]};
  const result = await f.run(args);
  assert.equal(f.read(), '\uFEFFbeta\r\ndelta\r\ngamma\r\n');
  assert.equal(f.writes.mock.callCount(), 1);
  writeFileSync(f.path, f.content);
  const expected = await f.run(args, native);
  assert.deepEqual(result, expected);
  assert.match(result.details!.patch, /\+delta/);
  assert.equal(result.details!.firstChangedLine, 1);
});

test('native missing/ambiguous/overlapping/empty and net-zero edit safeguards stay unchanged', async t => {
  const f = fixture(t, 'alpha beta\nbeta\ngamma\n');
  const batches = [
    [],
    [{oldText: '', newText: 'insert'}],
    [{oldText: 'missing', newText: 'changed'}],
    [{oldText: 'beta', newText: 'changed'}],
    [{oldText: 'alpha beta', newText: 'changed'}, {oldText: 'alpha', newText: 'changed too'}],
    [{oldText: 'alpha', newText: 'alp'}, {oldText: 'ha beta', newText: 'haha beta'}],
  ];
  for (const edits of batches) {
    const args = {path: f.path, edits};
    let nativeError: unknown;
    try { await f.run(args, native); } catch (error) { nativeError = error; }
    assert.ok(nativeError instanceof Error, JSON.stringify(edits));
    await assert.rejects(f.run(args), {message: nativeError.message});
    assert.equal(f.read(), f.content);
  }
  assert.equal(f.writes.mock.callCount(), 0);
});

test('native abort safeguard is retained for a real replacement', async t => {
  const f = fixture(t);
  const controller = new AbortController();
  controller.abort();
  for (const tool of [native, edit]) {
    await assert.rejects(tool.execute({path: f.path, edits: [{oldText: 'alpha', newText: 'changed'}]}, f.api, {...ctx, abortSignal: controller.signal}), /aborted/i);
  }
  assert.equal(f.read(), f.content);
  assert.equal(f.writes.mock.callCount(), 0);
});
