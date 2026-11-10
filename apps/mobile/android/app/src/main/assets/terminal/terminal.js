'use strict';
(async () => {
  // Use Bob's packaged faces, including real bold/italic metrics; never a CDN or generic monospace.
  await Promise.all([
    document.fonts.load('14px "Nordwand Mono"'),
    document.fonts.load('bold 14px "Nordwand Mono"'),
    document.fonts.load('italic 14px "Nordwand Mono"'),
    document.fonts.load('italic bold 14px "Nordwand Mono"'),
  ]);
  const fontFamily = '"Nordwand Mono"';
  const term = new Terminal({
    fontSize: 14, fontFamily, lineHeight: 1.15, scrollback: 5000, cursorBlink: true,
    allowProposedApi: false, allowTransparency: false, disableStdin: true,
  });
  let epoch = 0;
  let active = false;
  const root = document.getElementById('terminal');
  term.open(root);
  let pasteCapture = null;
  term.onData(data => {
    if (!active) return;
    if (pasteCapture) {
      if (data.length > 65536 - pasteCapture.length) {
        pasteCapture.overflow = true;
        pasteCapture.parts.length = 0;
      } else if (!pasteCapture.overflow) {
        pasteCapture.parts.push(data);
        pasteCapture.length += data.length;
      }
    } else BobTerminalInput.input(epoch, data);
  });
  // No links addon, OSC clipboard handler, HTTP client, credentials or general JS command bridge.
  const resize = () => {
    if (!root.clientWidth || !root.clientHeight) return;
    const measure = document.createElement('span');
    measure.textContent = 'W'.repeat(80);
    measure.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;line-height:normal';
    measure.style.fontFamily = fontFamily;
    measure.style.fontSize = `${term.options.fontSize}px`;
    root.appendChild(measure);
    const rect = measure.getBoundingClientRect();
    measure.remove();
    if (!rect.width || !rect.height) return;
    // Use the real content box: changing visual padding must not clip the last
    // columns/rows or report a different grid to Mosh than the one actually drawn.
    const style = getComputedStyle(root);
    const width = root.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const height = root.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    const cols = Math.max(2, Math.min(500, Math.floor(width / (rect.width / 80))));
    const rows = Math.max(1, Math.min(300, Math.floor(height / (rect.height * term.options.lineHeight))));
    if (term.cols !== cols || term.rows !== rows) term.resize(cols, rows);
    if (active) BobTerminalInput.resize(epoch, cols, rows);
  };
  window.bobSession = next => {
    epoch = next;
    active = true;
    term.options.disableStdin = false;
    term.reset();
    term.clearSelection();
    resize();
  };
  window.bobDeactivate = () => {
    active = false;
    term.options.disableStdin = true;
    term.blur();
  };
  window.bobWrite = (source, ticket, base64) => {
    if (!active || source !== epoch) return;
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
    term.write(bytes, () => BobTerminalInput.outputConsumed(source, ticket));
  };
  window.bobTheme = (theme, fontSize) => {
    term.options.theme = theme;
    term.options.fontSize = fontSize;
    document.body.style.background = theme.background;
    root.style.visibility = 'visible';
    resize();
  };
  window.bobResize = resize;
  window.bobFocus = source => { if (active && source === epoch) term.focus(); };
  window.bobBlur = source => { if (source === epoch) term.blur(); };
  window.bobSelection = source => source === epoch && active ? term.getSelection() : null;
  window.bobPaste = (source, sequence, text) => {
    if (!active || source !== epoch) return;
    const capture = { parts: [], length: 0, overflow: false };
    pasteCapture = capture;
    try {
      // Pinned xterm 5.5 paste synchronously emits onData (Clipboard.paste ->
      // CoreService.triggerDataEvent). Capture ALL generated/bracketed bytes,
      // never ordinary input followed by a premature scheduling acknowledgement.
      term.paste(text);
    } finally { pasteCapture = null; }
    BobTerminalInput.pasteInput(source, sequence, capture.parts.join(''), capture.overflow);
  };
  new ResizeObserver(resize).observe(root);
  resize();
  BobTerminalInput.ready();
  // Deliberately no focus on mount, admission, output, resize or appearance changes.
})();
