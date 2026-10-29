import {readFileSync,writeFileSync} from 'node:fs';

const bundledPrompt = new URL('../core-prompt.md', import.meta.url);
/** Read on every prompt render; never silently replace an invalid owner file. */
export function readCorePrompt(path: string | URL = bundledPrompt): string {
  const text = readFileSync(path, 'utf8').trim();
  if (!text) throw new Error(`Core prompt is empty: ${path}`);
  return text;
}
/** Seed once outside release directories; upgrades preserve owner edits. */
export function createCorePromptReader(path: string): () => string {
  try {
    writeFileSync(path, readCorePrompt() + '\n', {flag: 'wx', mode: 0o600});
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  readCorePrompt(path);
  return () => readCorePrompt(path);
}
