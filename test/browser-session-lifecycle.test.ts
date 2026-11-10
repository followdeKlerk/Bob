import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {chromium, type Browser} from 'playwright';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';
import {createWebTools} from '../packages/web/src/index.js';

const gate = () => Promise.withResolvers<void>();
type Hooks = {
  launch?: () => Promise<void>;
  context?: (number: number) => Promise<void>;
  page?: (number: number) => Promise<void>;
  contextClose?: (number: number) => Promise<void>;
  browserClose?: () => Promise<void>;
  click?: () => Promise<void>;
};
function fixture(t: TestContext, hooks: Hooks = {}) {
  const browsers: {closes: number}[] = [];
  const contexts: {closes: number; pages: number; timeouts: number[]}[] = [];
  let clicks = 0;
  t.mock.method(chromium, 'launch', async (options: unknown) => {
    assert.deepEqual(options, {executablePath: '/fake/chromium', headless: true});
    const browser = {closes: 0}; browsers.push(browser);
    await hooks.launch?.();
    return {
      async newContext(options: unknown) {
        assert.deepEqual(options, {acceptDownloads: false});
        const number = contexts.length + 1, context = {closes: 0, pages: 0, timeouts: [] as number[]};
        contexts.push(context);
        await hooks.context?.(number);
        return {
          async newPage() {
            context.pages++;
            await hooks.page?.(number);
            return {
              setDefaultTimeout(timeout: number) { context.timeouts.push(timeout); },
              url: () => `https://fixture.invalid/context/${number}`,
              locator: () => ({
                innerText: async () => `page ${number}`,
                first: () => ({click: async () => { clicks++; await hooks.click?.(); }, fill: async () => {}}),
              }),
              goto: async () => {},
            };
          },
          async close() { context.closes++; await hooks.contextClose?.(number); },
        };
      },
      async close() { browser.closes++; await hooks.browserClose?.(); },
    } as unknown as Browser;
  });
  const web = createWebTools('/fake/chromium');
  const tool = web.extension.tools!.find(tool => tool.name === 'browser')!;
  return {
    web, tool, browsers, contexts, get clicks() { return clicks; },
    run: (conversationId: number, action = 'text') => tool.execute({action, selector: '#button'}, {conversationId} as any, ctx),
  };
}
function assertClean(f: ReturnType<typeof fixture>) {
  assert.ok(f.browsers.every(browser => browser.closes === 1), 'each launched browser closes exactly once');
  assert.ok(f.contexts.every(context => context.closes === 1), 'each acquired context closes exactly once');
}

test('two first conversations share one launch but have distinct isolated contexts', async t => {
  const launch = gate(), f = fixture(t, {launch: () => launch.promise});
  const first = f.run(1), second = f.run(2);
  try {
    launch.resolve();
    const results = await Promise.all([first, second]);
    assert.equal(f.browsers.length, 1);
    assert.equal(f.contexts.length, 2);
    assert.notDeepEqual(results[0], results[1]);
    assert.deepEqual(f.contexts.map(context => context.timeouts), [[15000], [15000]]);
  } finally { launch.resolve(); await Promise.allSettled([first, second]); await f.web.close(); }
  assertClean(f);
});

test('same conversation shares a pending launch, context and page and retains that page', async t => {
  const launch = gate(), page = gate(), entered = gate();
  const f = fixture(t, {launch: () => launch.promise, page: async () => { entered.resolve(); await page.promise; }});
  const first = f.run(1), second = f.run(1);
  try {
    launch.resolve(); await entered.promise;
    const third = f.run(1);
    page.resolve();
    const results = await Promise.all([first, second, third]);
    assert.equal(f.browsers.length, 1); assert.equal(f.contexts.length, 1);
    assert.equal(f.contexts[0]!.pages, 1);
    assert.deepEqual(results[0], results[1]); assert.deepEqual(results[0], results[2]);
    assert.deepEqual(await f.run(1), results[0]);
  } finally { launch.resolve(); page.resolve(); await Promise.allSettled([first, second]); await f.web.close(); }
  assertClean(f);
});

test('an already launched browser also memoizes concurrent first context creation', async t => {
  const context = gate(), entered = gate();
  const f = fixture(t, {context: async number => { if (number > 1) { entered.resolve(); await context.promise; } }});
  try {
    await f.run(99);
    const first = f.run(1); await entered.promise;
    const second = f.run(1);
    context.resolve();
    assert.deepEqual(await first, await second);
    assert.equal(f.contexts.length, 2);
  } finally { context.resolve(); await f.web.close(); }
  assertClean(f);
});

test('failed shared launch is evicted and only a later explicit call retries initialization', async t => {
  const launch = gate(); let attempts = 0;
  const f = fixture(t, {launch: async () => { attempts++; if (attempts === 1) await launch.promise; }});
  const first = f.run(1), second = f.run(2);
  const rejected = Promise.all([assert.rejects(first, /launch failed/), assert.rejects(second, /launch failed/)]);
  launch.reject(Error('launch failed')); await rejected;
  assert.equal(attempts, 1); assert.equal(f.contexts.length, 0);
  try {
    await f.run(1);
    assert.equal(attempts, 2); assert.equal(f.contexts.length, 1);
  } finally { await f.web.close(); }
  assert.equal(f.browsers[0]!.closes, 0, 'a failed launch returned no browser to close');
  assert.equal(f.browsers[1]!.closes, 1); assert.equal(f.contexts[0]!.closes, 1);
});

test('context creation failure evicts its session without closing an unacquired context', async t => {
  const f = fixture(t, {context: async number => { if (number === 1) throw Error('context failed'); }});
  try {
    await assert.rejects(f.run(1), /context failed/);
    await f.run(1);
    assert.equal(f.browsers.length, 1); assert.equal(f.contexts.length, 2);
  } finally { await f.web.close(); }
  assert.equal(f.contexts[0]!.closes, 0, 'failed newContext returned no context to own');
  assert.equal(f.contexts[1]!.closes, 1); assert.equal(f.browsers[0]!.closes, 1);
});

for (const failClose of [false, true]) test(`page failure evicts session and closes failed context${failClose ? ' even if cleanup fails' : ''}`, async t => {
  const f = fixture(t, {
    page: async number => { if (number === 1) throw Error('page failed'); },
    contextClose: async number => { if (failClose && number === 1) throw Error('context cleanup failed'); },
  });
  try {
    await assert.rejects(f.run(1), /page failed/);
    assert.equal(f.contexts[0]!.closes, 1);
    await f.run(1);
    assert.equal(f.browsers.length, 1); assert.equal(f.contexts.length, 2);
  } finally { await f.web.close(); }
  assertClean(f);
});

for (const stage of ['launch', 'context', 'page'] as const) test(`shutdown joins pending ${stage}, closes once and cannot resurrect a session`, async t => {
  const pending = gate(), entered = gate();
  const wait = async () => { entered.resolve(); await pending.promise; };
  const f = fixture(t, {[stage]: wait});
  const run = f.run(1), rejected = assert.rejects(run, /closed/i);
  await entered.promise;
  let finished = false;
  const close = f.web.close().then(() => { finished = true; });
  const closeAgain = f.web.close();
  try {
    await assert.rejects(f.run(2), /closed/i);
    assert.equal(finished, false, 'close must join initialization rather than return early');
    pending.resolve();
    await Promise.all([rejected, close, closeAgain]);
    assert.equal(f.browsers.length, 1);
    assert.equal(f.contexts.length, stage === 'launch' ? 0 : 1);
    if (stage === 'context') assert.equal(f.contexts[0]!.pages, 0, 'no page is created after shutdown');
    await assert.rejects(f.run(1), /closed/i);
    await f.web.close();
    assertClean(f);
  } finally { pending.resolve(); await Promise.allSettled([run, close, closeAgain]); }
});

test('shutdown joins a rejected launch without retrying or resurrecting sessions', async t => {
  const launch = gate(), f = fixture(t, {launch: () => launch.promise});
  const run = f.run(1), rejected = assert.rejects(run, /launch failed/);
  const close = f.web.close();
  assert.equal(f.web.close(), close, 'all close callers share the same shutdown promise');
  launch.reject(Error('launch failed'));
  await Promise.all([rejected, close]);
  await assert.rejects(f.run(1), /closed/i);
  assert.equal(f.browsers.length, 1); assert.equal(f.browsers[0]!.closes, 0);
  assert.equal(f.contexts.length, 0);
});

test('close before first use never launches and repeated close is harmless', async t => {
  const f = fixture(t);
  await Promise.all([f.web.close(), f.web.close()]);
  await assert.rejects(f.run(1), /closed/i);
  assert.equal(f.browsers.length, 0); assert.equal(f.contexts.length, 0);
});

test('shutdown still closes other contexts and Chromium when one context close fails', async t => {
  const f = fixture(t, {contextClose: async number => { if (number === 1) throw Error('close failed'); }});
  await Promise.all([f.run(1), f.run(2)]);
  await assert.rejects(f.web.close(), AggregateError);
  await assert.rejects(f.web.close(), AggregateError);
  await assert.rejects(f.run(1), /closed/i);
  assertClean(f);
});

test('browser actions remain unsafe and a failed click is never retried or reinitialized', async t => {
  const f = fixture(t, {click: async () => { throw Error('unknown click outcome'); }});
  try {
    assert.equal(f.tool.replay, 'unsafe');
    await assert.rejects(f.run(1, 'click'), /unknown click outcome/);
    assert.equal(f.clicks, 1); assert.equal(f.browsers.length, 1); assert.equal(f.contexts.length, 1);
    await f.run(1, 'text');
    assert.equal(f.clicks, 1); assert.equal(f.contexts.length, 1);
  } finally { await f.web.close(); }
  assertClean(f);
});
