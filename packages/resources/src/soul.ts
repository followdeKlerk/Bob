import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';

const bundledSoul = new URL('../soul.default.md', import.meta.url);
/** Read on every prompt render; never silently replace an invalid owner file. */
export function readSoul(path: string | URL = bundledSoul): string {
  const text = readFileSync(path, 'utf8').trim();
  if (!text) throw new Error(`Soul is empty: ${path}`);
  return text;
}
/** Seed once outside release directories; preserve owner edits and legacy recovery. */
export function createSoulReader(path: string): () => string {
  try {
    readSoul(path);
    return () => readSoul(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const legacyPath=join(dirname(path),'core-prompt.md');
  let initial:string;
  try {
    initial=readFileSync(legacyPath,'utf8');
    if(!initial.trim())throw new Error(`Legacy core prompt is empty: ${legacyPath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    initial=readSoul()+'\n';
  }
  try {
    // Preserve the legacy bytes and file for old releases; never clobber an
    // existing soul, including one created by another initializer.
    writeFileSync(path,initial,{flag:'wx',mode:0o600});
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  readSoul(path);
  return () => readSoul(path);
}
