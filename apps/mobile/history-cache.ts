import {cacheGeneration,readManagedCache,writeManagedCache} from './download-cache';

/** Cache failure is never a reason to skip reconnecting to authoritative stored history. */
export function readHistoryCache(key:string):Promise<string|undefined> {
 return /^(history|history-pages):/.test(key)?readManagedCache(key):Promise.resolve(undefined);
}
/** Small rows avoid Android's single-row limits. Publish only after every chunk was saved.
 * Async producers must pass the generation captured before their work was admitted. */
export function writeHistoryCache(key:string,value:string,generation=cacheGeneration()):Promise<void> {
 return /^(history|history-pages):/.test(key)?writeManagedCache(key,value,generation):Promise.resolve();
}
