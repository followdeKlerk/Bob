'use strict';
// No browser/package install: exercise the packaged renderer's bridge/lifecycle in an inert VM.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const assets = path.join(__dirname, '../app/src/main/assets/terminal');

async function renderer() {
  const calls = { input: [], pasteInput: [], resize: [], consumed: [], fonts: [], writes: [], focus: 0, reset: 0, ready: 0 };
  const root = { clientWidth: 800, clientHeight: 400, style: {}, appendChild() {} };
  let terminal;
  class Terminal {
    constructor(options) { this.options = options; terminal = this; this.cols = 80; this.rows = 24; }
    open() {}
    onData(callback) { this.data = callback; }
    resize(cols, rows) { this.cols = cols; this.rows = rows; }
    write(bytes, callback) { calls.writes.push({ bytes, callback }); }
    reset() { calls.reset++; }
    clearSelection() {}
    blur() {}
    focus() { calls.focus++; }
    getSelection() { return 'selection'; }
    paste(text) { this.data(`\x1b[200~${text}\x1b[201~`); }
  }
  const window = {};
  const context = vm.createContext({
    window, Terminal, Uint8Array, atob: value => Buffer.from(value, 'base64').toString('binary'),
    getComputedStyle: () => ({ paddingLeft: '16px', paddingRight: '16px', paddingTop: '8px', paddingBottom: '8px' }),
    ResizeObserver: class { constructor(callback) { calls.resizeObserver = callback; } observe() {} },
    document: {
      fonts: { load: font => { calls.fonts.push(font); return Promise.resolve(); } },
      body: { style: {} }, getElementById: () => root,
      createElement: () => ({ style: {}, remove() {}, getBoundingClientRect() {
        const size = Number.parseFloat(this.style.fontSize);
        return { width: size * 0.6 * 80, height: size * 1.2 };
      } }),
    },
    BobTerminalInput: {
      input: (...args) => calls.input.push(args), pasteInput: (...args) => calls.pasteInput.push(args), resize: (...args) => calls.resize.push(args),
      outputConsumed: (...args) => calls.consumed.push(args), ready: () => calls.ready++,
    },
  });
  await vm.runInContext(fs.readFileSync(path.join(assets, 'terminal.js'), 'utf8'), context);
  return { window, calls, root, terminal };
}

test('mount loads real Nordwand variants, starts inert, and never requests keyboard focus', async () => {
  const { calls, terminal } = await renderer();
  assert.equal(calls.fonts.length, 4);
  assert(calls.fonts.every(font => font.includes('"Nordwand Mono"')));
  assert.equal(terminal.options.fontFamily, '"Nordwand Mono"');
  assert.equal(terminal.options.fontSize, 14);
  assert.equal(terminal.options.disableStdin, true);
  assert.equal(calls.ready, 1);
  assert.equal(calls.focus, 0);
  terminal.data('ignored-before-admission');
  assert.deepEqual(calls.input, []);
});

test('theme/font-scale and viewport resize do not reset session or focus IME', async () => {
  const { window, calls, terminal, root } = await renderer();
  window.bobSession(3);
  const resetCount = calls.reset;
  const oldColumns = terminal.cols;
  window.bobTheme({ background: '#e8dfd0', foreground: '#292720' }, 21);
  assert.equal(terminal.options.fontSize, 21);
  assert(terminal.cols < oldColumns);
  root.clientWidth = 400;
  root.clientHeight = 200;
  calls.resizeObserver();
  assert(calls.resize.every(([epoch]) => epoch === 3));
  assert.equal(calls.reset, resetCount);
  assert.equal(calls.focus, 0);
  terminal.data('hello');
  assert.deepEqual(calls.input, [[3, 'hello']]);
  window.bobFocus(3);
  assert.equal(calls.focus, 1);
});

test('only parser completion acknowledges bounded output, with the original generation/ticket', async () => {
  const { window, calls } = await renderer();
  window.bobSession(1);
  window.bobWrite(1, 7, Buffer.from('\x1b[31mhello').toString('base64'));
  assert.equal(calls.writes.length, 1);
  assert.deepEqual(calls.consumed, []);
  window.bobSession(2);
  calls.writes[0].callback();
  assert.deepEqual(calls.consumed, [[1, 7]]);
  window.bobWrite(1, 8, 'aGk=');
  assert.equal(calls.writes.length, 1, 'stale generation cannot reach the new renderer session');
  window.bobWrite(2, 1, 'aGk=');
  assert.equal(calls.writes.length, 2);
  assert.equal(Buffer.from(calls.writes[1].bytes).toString(), 'hi');
});

test('deactivation leaves renderer mounted but inert until explicit fresh admission', async () => {
  const { window, calls, terminal } = await renderer();
  window.bobSession(9);
  window.bobPaste(9, 1, 'hello');
  assert.deepEqual(calls.pasteInput, [[9, 1, '\x1b[200~hello\x1b[201~', false]]);
  assert.deepEqual(calls.input, []);
  window.bobDeactivate();
  terminal.data('ignored');
  window.bobFocus(9);
  window.bobPaste(9, 2, 'ignored');
  window.bobWrite(9, 1, 'aGk=');
  window.bobResize();
  assert.equal(terminal.options.disableStdin, true);
  assert.equal(calls.input.length, 0);
  assert.equal(calls.pasteInput.length, 1);
  assert.equal(calls.writes.length, 0);
  assert.equal(calls.focus, 0);
  assert.equal(calls.reset, 1);
  window.bobSession(10);
  terminal.data('new');
  assert.deepEqual(calls.input[0], [10, 'new']);
});

test('embedded interface has no Activity launch, key prop, native controls or window insets', () => {
  const nativeRoot = path.join(__dirname, '../app/src/main/java/com/bobmobile/terminal');
  const module = fs.readFileSync(path.join(nativeRoot, 'BobTerminal.kt'), 'utf8');
  const manager = fs.readFileSync(path.join(nativeRoot, 'BobTerminalViewManager.kt'), 'utf8');
  const view = fs.readFileSync(path.join(nativeRoot, 'BobTerminalView.kt'), 'utf8');
  const manifest = fs.readFileSync(path.join(__dirname, '../app/src/main/AndroidManifest.xml'), 'utf8');
  assert(module.includes('@ReactMethod fun prepare('));
  assert(module.includes('@ReactMethod fun releasePrepared('));
  assert(!module.includes('@ReactMethod fun open('));
  assert(manager.includes('getName() = "BobTerminalView"'));
  assert.deepEqual([...manager.matchAll(/@ReactProp\(name = "([^"]+)"/g)].map(match => match[1]).sort(), ['active', 'control', 'session']);
  assert(manager.includes('"registrationName" to "onState"'));
  assert(!manifest.includes('BobTerminalActivity'));
  assert(!/startActivity|android\.content\.Intent|WindowManager|WindowInsets|setSoftInputMode|Button\(/.test(module + manager + view));
  assert(view.includes('putBoolean("ctrl", state.ctrl)'));
  assert(view.includes('override fun onHostPause() { finish() }'));
  assert(view.includes('override fun onDetachedFromWindow() { finish();'));
  const css = fs.readFileSync(path.join(assets, 'terminal.css'), 'utf8');
  for (const face of ['Regular', 'Bold', 'Italic', 'BoldItalic']) assert(css.includes(`/fonts/NordwandMono-${face}.woff2`));
});

test('control acknowledgements snapshot sequence before posting and oversize paste fails visibly', () => {
  const view = fs.readFileSync(path.join(__dirname, '../app/src/main/java/com/bobmobile/terminal/BobTerminalView.kt'), 'utf8');
  assert(view.includes('state.acknowledged?.let { putDouble("acknowledged", it) }'));
  const emit = view.slice(view.indexOf('private fun emit('), view.indexOf('private fun finish('));
  assert(emit.indexOf('val snapshot = TerminalStateSnapshot(identity, phase, message, ctrl, controls.completedSequence)') < emit.indexOf('post {'));
  assert(!emit.slice(emit.indexOf('post {')).includes('commandSequence'));
  assert(view.includes('if (!isCurrent(scope) || !controls.complete(scope.ticket)) return'));
  assert(view.includes('if (send(value)) complete(scope)'));
  assert(view.includes('window.bobPaste(${current.epoch},$sequence,${JSONObject.quote(text)})'));
  const command = view.slice(view.indexOf('private fun command('), view.indexOf('private fun emit('));
  assert(!command.includes('emit(admission.phase)'));
  const copy = command.slice(command.indexOf('\"copy\" ->'), command.indexOf('\"paste\" ->'));
  assert(copy.indexOf('setPrimaryClip') < copy.indexOf('complete(current)'));
  assert(copy.includes('if (!isCurrent(current)) return@evaluateJavascript'));
  assert(view.includes('text.length > 65536 || text.toByteArray(Charsets.UTF_8).size > 65536'));
  assert(view.includes('finish("Clipboard paste is too large. Use a smaller selection and reconnect.")'));
});

test('finish dismisses only the terminal-owned IME before WebView destruction', () => {
  const view = fs.readFileSync(path.join(__dirname, '../app/src/main/java/com/bobmobile/terminal/BobTerminalView.kt'), 'utf8');
  const finish = view.slice(view.indexOf('private fun finish('), view.indexOf('fun dispose()'));
  assert(/if \(!disposed && web\.hasFocus\(\)\) \{[\s\S]*?hideSoftInputFromWindow\(web\.windowToken, 0\)[\s\S]*?web\.clearFocus\(\)/.test(finish));
  const dispose = view.slice(view.indexOf('fun dispose()'), view.indexOf('override fun onMeasure('));
  assert(dispose.indexOf('finish(); disposed = true') < dispose.indexOf('web.destroy()'));
});

test('delayed paste invocation returns one captured input completion, not an early ordinary input', async () => {
  const { window, calls, terminal } = await renderer();
  window.bobSession(4);
  const delayedRendererWork = () => window.bobPaste(4, 17, 'paste');
  assert.deepEqual(calls.pasteInput, []);
  assert.deepEqual(calls.input, []);
  // Multi-chunk synchronous onData must still reach native as ONE atomic paste ordering point.
  terminal.paste = text => { terminal.data('prefix'); terminal.data(text); terminal.data('suffix'); };
  delayedRendererWork();
  assert.deepEqual(calls.input, []);
  assert.deepEqual(calls.pasteInput, [[4, 17, 'prefixpastesuffix', false]]);
  terminal.data('ordinary');
  assert.deepEqual(calls.input, [[4, 'ordinary']]);
});

test('delayed paste/focus/selection from an old epoch cannot affect a fresh renderer admission', async () => {
  const { window, calls } = await renderer();
  window.bobSession(5);
  const delayed = () => { window.bobPaste(5, 1, 'stale'); window.bobFocus(5); return window.bobSelection(5); };
  window.bobSession(6);
  assert.equal(delayed(), null);
  assert.deepEqual(calls.pasteInput, []);
  assert.equal(calls.focus, 0);
  assert.equal(window.bobSelection(6), 'selection');
  window.bobFocus(6);
  assert.equal(calls.focus, 1);
});

test('captured paste output is bounded and an overflow reaches native as failure, never truncated input', async () => {
  const { window, calls, terminal } = await renderer();
  window.bobSession(7);
  terminal.paste = () => { terminal.data('a'.repeat(65536)); terminal.data('overflow'); };
  window.bobPaste(7, 3, 'text');
  assert.deepEqual(calls.pasteInput, [[7, 3, '', true]]);
  assert.deepEqual(calls.input, []);
});

test('grid sizing reserves visible margins and relaxed line height instead of clipping content', async () => {
  const { window, root, terminal, calls } = await renderer();
  root.clientWidth = 337; root.clientHeight = 150;
  window.bobSession(1);
  assert.equal(terminal.options.lineHeight, 1.15);
  assert.equal(terminal.cols, Math.floor((337 - 32) / (14 * 0.6)));
  assert.equal(terminal.rows, Math.floor((150 - 16) / (14 * 1.2 * 1.15)));
  assert.deepEqual(calls.resize.at(-1), [1, terminal.cols, terminal.rows]);
  window.bobTheme({ background: '#e8dfd0', foreground: '#292720' }, 21);
  assert.equal(terminal.rows, Math.floor((150 - 16) / (21 * 1.2 * 1.15)));
  assert.equal(calls.focus, 0);
  assert.equal(calls.reset, 1);
});
