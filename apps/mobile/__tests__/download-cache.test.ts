import type {AsyncStorage as Storage} from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage',()=>({getItem:jest.fn(),setItem:jest.fn(),removeItem:jest.fn(),getMany:jest.fn(),setMany:jest.fn(),removeMany:jest.fn(),getAllKeys:jest.fn(),clear:jest.fn()}));
const {Buffer}=require('buffer') as {Buffer:{byteLength(value:string,encoding?:string):number}};
const preferencesKey='download-cache:preferences:v1', lruKey='download-cache:lru:v1';
let rows:Map<string,string>, storage:jest.Mocked<Storage>;
let policy:typeof import('../download-cache'), history:typeof import('../history-cache');
function reopen(){
 // A new JS process, with the same synthetic persisted storage and no production reset API.
 jest.resetModules();
 jest.doMock('@react-native-async-storage/async-storage',()=>storage);
 policy=require('../download-cache');history=require('../history-cache');
}
function deferred<T=void>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>resolve=done);return {promise,resolve};}
function chunked(base:string,value:string,generation='saved'){
 rows.set(`chunked:${base}`,JSON.stringify({version:1,generation,parts:1}));
 rows.set(`chunked:${base}:${generation}:0`,value);
}
const payloadKeys=()=>[...rows.keys()].filter(key=>/^(chunked:)?(history|history-pages|chats):/.test(key));
beforeEach(()=>{
 rows=new Map();
 storage={
  getItem:jest.fn(async(key:string)=>rows.get(key)??null),
  setItem:jest.fn(async(key:string,value:string)=>{rows.set(key,value);}),
  removeItem:jest.fn(async(key:string)=>{rows.delete(key);}),
  getMany:jest.fn(async(keys:string[])=>Object.fromEntries(keys.map(key=>[key,rows.get(key)??null]))),
  setMany:jest.fn(async(items:Record<string,string>)=>{for(const [key,value] of Object.entries(items))rows.set(key,value);}),
  removeMany:jest.fn(async(keys:string[])=>{for(const key of keys)rows.delete(key);}),
  getAllKeys:jest.fn(async()=>[...rows.keys()]),clear:jest.fn(),
 };
 reopen();
});
afterEach(()=>jest.useRealTimers());

test('defaults only apply to an absent policy; opt-out survives process reopen and is global',async()=>{
 expect(await policy.getCachePreferences()).toEqual({chatLists:true,history:true,maxConversations:50});
 await history.writeHistoryCache('history:alpha:1','snapshot');await policy.writeChatListCache('chats:beta','list');
 await policy.updateCachePreferences({chatLists:false,history:false,maxConversations:25});
 expect(payloadKeys()).toEqual([]);reopen();
 expect(await policy.getCachePreferences()).toEqual({chatLists:false,history:false,maxConversations:25});
 await history.writeHistoryCache('history:other:2','blocked');await policy.writeChatListCache('chats:other','blocked');
 rows.set('history:legacy:3','left over after interrupted old cleanup');
 expect(await history.readHistoryCache('history:legacy:3')).toBeUndefined();
 expect(await policy.readChatListCache('chats:other')).toBeUndefined();
 expect((await policy.getCacheUsage()).totalBytes).toBe(0);
 expect(storage.clear).not.toHaveBeenCalled();
});

test('saved preferences remain readable while a payload scan is waiting for storage',async()=>{
 await policy.getCachePreferences();rows.set('history:alpha:1','cached');
 const entered=deferred(),release=deferred();
 storage.getItem.mockImplementation(async key=>{if(key==='history:alpha:1'){entered.resolve();await release.promise;}return rows.get(key)??null;});
 const size=policy.getCacheUsage();await entered.promise;
 let settled=false;const read=policy.getCachePreferences().then(value=>{settled=true;return value;});
 try{for(let i=0;i<8;i++)await Promise.resolve();expect(settled).toBe(true);}
 finally{release.resolve();await Promise.all([size,read]);}
});

test('overlapping usage requests share one scan, but a later explicit measurement is fresh',async()=>{
 const entered=deferred(),release=deferred();rows.set('history:alpha:1','cached');
 storage.getAllKeys.mockImplementationOnce(async()=>{entered.resolve();await release.promise;return [...rows.keys()];});
 const first=policy.getCacheUsage();await entered.promise;const second=policy.getCacheUsage();
 release.resolve();expect(await first).toEqual(await second);expect(storage.getAllKeys).toHaveBeenCalledTimes(1);
 rows.set('chats:alpha','new list');await policy.getCacheUsage();expect(storage.getAllKeys).toHaveBeenCalledTimes(2);
});

test('cold metadata reads share one load with a concurrent policy writer',async()=>{
 rows.set(preferencesKey,JSON.stringify(policy.DEFAULT_CACHE_PREFERENCES));
 const entered=deferred(),release=deferred();
 storage.getItem.mockImplementation(async key=>{const value=rows.get(key)??null;if(key===preferencesKey){entered.resolve();await release.promise;}return value;});
 const first=policy.getCachePreferences(),second=policy.getCachePreferences();await entered.promise;
 const change=policy.updateCachePreferences({history:false});
 for(let i=0;i<8;i++)await Promise.resolve();
 expect(storage.getItem.mock.calls.filter(([key])=>key===preferencesKey)).toHaveLength(1);expect(storage.setItem).not.toHaveBeenCalled();
 release.resolve();expect((await first).history).toBe(true);expect((await second).history).toBe(true);await change;
 expect((await policy.getCachePreferences()).history).toBe(false);expect(JSON.parse(rows.get(preferencesKey)!).history).toBe(false);
});

test.each(['queued','writing'] as const)('metadata reads follow an already admitted %s policy change',async phase=>{
 await policy.getCachePreferences();const entered=deferred(),release=deferred();
 let size:Promise<unknown>|undefined;
 if(phase==='queued'){
  storage.getAllKeys.mockImplementationOnce(async()=>{entered.resolve();await release.promise;return [...rows.keys()];});
  size=policy.getCacheUsage();await entered.promise;
 }else storage.setItem.mockImplementationOnce(async(key,value)=>{entered.resolve();await release.promise;rows.set(key,value);});
 const change=policy.updateCachePreferences({history:false});if(phase==='writing')await entered.promise;
 let settled=false;const read=policy.getCachePreferences().then(value=>{settled=true;return value;});
 for(let i=0;i<8;i++)await Promise.resolve();expect(settled).toBe(false);
 release.resolve();await size;await change;expect((await read).history).toBe(false);
});

test('a failed policy write does not release metadata ahead of a second admitted write',async()=>{
 await policy.getCachePreferences();const entered=deferred(),release=deferred();
 storage.setItem.mockRejectedValueOnce(Error('synthetic first write failure'));
 storage.setItem.mockImplementationOnce(async(key,value)=>{entered.resolve();await release.promise;rows.set(key,value);});
 const first=policy.updateCachePreferences({history:false}).catch(()=>undefined),second=policy.updateCachePreferences({maxConversations:25});
 await entered.promise;await first;
 let settled=false;const read=policy.getCachePreferences().then(value=>{settled=true;return value;});
 for(let i=0;i<8;i++)await Promise.resolve();expect(settled).toBe(false);
 release.resolve();await second;expect(await read).toEqual({chatLists:true,history:true,maxConversations:25});
});

test('coalesced usage failures release their flight so an explicit retry performs a new scan',async()=>{
 storage.getAllKeys.mockRejectedValueOnce(Error('synthetic enumeration failure'));
 const first=policy.getCacheUsage(),second=policy.getCacheUsage();expect(first).toBe(second);
 await expect(first).rejects.toThrow('synthetic enumeration failure');await expect(second).rejects.toThrow('synthetic enumeration failure');
 expect((await policy.getCacheUsage()).totalBytes).toBe(0);expect(storage.getAllKeys).toHaveBeenCalledTimes(2);
});

test('usage coalescing never crosses a clear admission',async()=>{
 rows.set('history:alpha:1','before clear');const entered=deferred(),release=deferred();
 storage.getAllKeys.mockImplementationOnce(async()=>{entered.resolve();await release.promise;return [...rows.keys()];});
 const before=policy.getCacheUsage();await entered.promise;const clear=policy.clearDownloadedCache('all'),after=policy.getCacheUsage();
 release.resolve();expect((await before).totalBytes).toBeGreaterThan(0);await clear;expect((await after).totalBytes).toBe(0);
 expect(storage.getAllKeys).toHaveBeenCalledTimes(3);
});

test('chunk scans use small ownership-filtered batches and keep legacy rows separate',async()=>{
 for(let i=1;i<=12;i++)chunked(`history:alpha:${i}`,'中文😀'.repeat(i));
 rows.set('history-pages:alpha:1','legacy');rows.set('notes:alpha','protected');rows.set('chunked:history:alpha:01:saved:0','near match');
 const expected=[...rows].filter(([key])=>key.startsWith('chunked:history:alpha:')&&!key.includes(':01:')).reduce((bytes,[,value])=>bytes+Buffer.byteLength(value),Buffer.byteLength('legacy'));
 const usage=await policy.getCacheUsage();expect(usage.history.conversations).toBe(12);expect(usage.history.bytes).toBe(expected);
 expect(storage.getMany).toHaveBeenCalledTimes(3);
 for(const [keys] of storage.getMany.mock.calls){expect(keys.length).toBeLessThanOrEqual(8);expect(keys.every(key=>key.startsWith('chunked:history:alpha:')&&!key.includes(':01:'))).toBe(true);}
 expect(storage.getItem).toHaveBeenCalledWith('history-pages:alpha:1');
 expect(storage.getItem).not.toHaveBeenCalledWith('notes:alpha');expect(rows.get('notes:alpha')).toBe('protected');
});

test('a failed scan batch falls back to individual reads without discarding readable conversations',async()=>{
 chunked('history:alpha:1','first');chunked('history:alpha:2','unreadable');chunked('history:alpha:3','third');
 storage.getMany.mockRejectedValueOnce(Error('synthetic batch failure'));
 storage.getItem.mockImplementation(async key=>{if(key==='chunked:history:alpha:2:saved:0')throw Error('synthetic row failure');return rows.get(key)??null;});
 const usage=await policy.getCacheUsage();expect(usage.history.conversations).toBe(2);
 expect(await history.readHistoryCache('history:alpha:1')).toBe('first');expect(await history.readHistoryCache('history:alpha:3')).toBe('third');
 expect(payloadKeys().some(key=>key.includes('history:alpha:2'))).toBe(false);
});

test.each(['not JSON','{}','{"chatLists":true,"history":true,"maxConversations":0}'])('unreadable saved policy %s fails closed without overwriting, then recovers',async(raw)=>{
 rows.set(preferencesKey,raw);
 await expect(policy.getCachePreferences()).rejects.toThrow();
 await expect(policy.updateCachePreferences({history:true})).rejects.toThrow();
 await history.writeHistoryCache('history:alpha:1','blocked');await policy.writeChatListCache('chats:alpha','blocked');
 expect(rows.get(preferencesKey)).toBe(raw);expect(storage.setItem).not.toHaveBeenCalled();expect(payloadKeys()).toEqual([]);
 rows.set(preferencesKey,JSON.stringify({chatLists:true,history:false,maxConversations:10}));
 expect((await policy.getCachePreferences()).history).toBe(false);
 await policy.updateCachePreferences({history:true});await history.writeHistoryCache('history:alpha:1','recovered');
 expect(await history.readHistoryCache('history:alpha:1')).toBe('recovered');
});

test('storage policy read failure is surfaced, never persisted as defaults or bypassed by cache writes',async()=>{
 storage.getItem.mockRejectedValue(Error('storage temporarily locked'));
 await expect(policy.getCachePreferences()).rejects.toThrow('storage temporarily locked');
 await expect(policy.updateCachePreferences({history:false})).rejects.toThrow('storage temporarily locked');
 await expect(history.writeHistoryCache('history:alpha:1','optional')).resolves.toBeUndefined();
 await expect(history.readHistoryCache('history:alpha:1')).resolves.toBeUndefined();
 expect(storage.setItem).not.toHaveBeenCalled();expect(storage.setMany).not.toHaveBeenCalled();
 storage.getItem.mockImplementation(async key=>rows.get(key)??null);
 expect(await policy.getCachePreferences()).toEqual(policy.DEFAULT_CACHE_PREFERENCES);
});

test('preference persistence failures reject, retain recoverable policy, and do not falsely clear data',async()=>{
 rows.set('history:alpha:1','keep');await policy.getCachePreferences();
 storage.setItem.mockRejectedValueOnce(Error('disk full'));
 await expect(policy.updateCachePreferences({history:false})).rejects.toThrow('disk full');
 expect(rows.get('history:alpha:1')).toBe('keep');expect((await policy.getCachePreferences()).history).toBe(true);
 await policy.updateCachePreferences({history:false});expect(rows.has('history:alpha:1')).toBe(false);
});

test('a possibly committed preference write is reread rather than overwritten after its rejected promise',async()=>{
 storage.setItem.mockImplementationOnce(async(key,value)=>{rows.set(key,value);throw Error('uncertain receipt');});
 await expect(policy.updateCachePreferences({history:false})).rejects.toThrow('uncertain receipt');
 await history.writeHistoryCache('history:alpha:1','must remain opted out');
 expect((await policy.getCachePreferences()).history).toBe(false);expect(payloadKeys()).toEqual([]);
});

test('failed deletion is visible while saved opt-out still blocks reads/writes; retry completes cleanup',async()=>{
 rows.set('history:alpha:1','legacy');
 storage.removeMany.mockRejectedValueOnce(Error('cannot delete'));
 await expect(policy.updateCachePreferences({history:false})).rejects.toThrow('cannot delete');
 expect((await policy.getCachePreferences()).history).toBe(false);
 expect(await history.readHistoryCache('history:alpha:1')).toBeUndefined();
 await history.writeHistoryCache('history:alpha:1','blocked');expect(rows.get('history:alpha:1')).toBe('legacy');
 await policy.clearDownloadedCache('history');expect(payloadKeys()).toEqual([]);
 rows.set('chats:alpha','list');storage.removeMany.mockRejectedValueOnce(Error('cannot clear'));
 await expect(policy.clearDownloadedCache('chatLists')).rejects.toThrow('cannot clear');
 expect(rows.get('chats:alpha')).toBe('list');await policy.clearDownloadedCache('chatLists');expect(payloadKeys()).toEqual([]);
});

test.each([0,-1,1.5,501,NaN,Infinity])('invalid conversation limit %s rejects without persisting',async(maxConversations)=>{
 await expect(policy.updateCachePreferences({maxConversations})).rejects.toThrow();expect(rows.has(preferencesKey)).toBe(false);
});

test('preference notifications are isolated, unsubscribable, and never fire for token writes or touches',async()=>{
 const listener=jest.fn(),unsubscribe=policy.subscribeCachePreferences(listener);
 policy.subscribeCachePreferences(()=>{throw Error('view failed');});
 await policy.updateCachePreferences({maxConversations:500});expect(listener).toHaveBeenCalledTimes(1);
 await history.writeHistoryCache('history:alpha:1','live');await policy.touchCachedConversation('alpha',1);
 expect(listener).toHaveBeenCalledTimes(1);
 await policy.clearDownloadedCache('all');expect(listener).toHaveBeenCalledTimes(2);
 unsubscribe();await policy.updateCachePreferences({maxConversations:1});expect(listener).toHaveBeenCalledTimes(2);
});

test.each(['clear','disable'] as const)('a delayed native chunk write cannot resurrect history across %s',async(action)=>{
 const entered=deferred(), release=deferred();
 storage.setMany.mockImplementationOnce(async values=>{entered.resolve();await release.promise;for(const [key,value] of Object.entries(values))rows.set(key,value);});
 const write=history.writeHistoryCache('history:alpha:1','old snapshot');await entered.promise;
 const control=action==='clear'?policy.clearDownloadedCache('history'):policy.updateCachePreferences({history:false});
 release.resolve();await Promise.all([write,control]);expect(payloadKeys()).toEqual([]);
 // A direct call made after the clear is admitted in the new generation.
 if(action==='disable')await policy.updateCachePreferences({history:true});
 await history.writeHistoryCache('history:alpha:1','new snapshot');expect(await history.readHistoryCache('history:alpha:1')).toBe('new snapshot');
});

test('a clear racing manifest publication removes the fully published old generation',async()=>{
 const entered=deferred(),release=deferred();
 storage.setItem.mockImplementation(async(key,value)=>{if(key==='chunked:history:alpha:1'){entered.resolve();await release.promise;}rows.set(key,value);});
 const write=history.writeHistoryCache('history:alpha:1','old');await entered.promise;
 const clear=policy.clearDownloadedCache('history');release.resolve();await Promise.all([write,clear]);
 expect(payloadKeys()).toEqual([]);
});

test('reads racing clear/disable do not restore a stale payload',async()=>{
 chunked('history:alpha:1','old');const entered=deferred(),release=deferred();
 storage.getMany.mockImplementationOnce(async keys=>{const values=Object.fromEntries(keys.map(key=>[key,rows.get(key)??null]));entered.resolve();await release.promise;return values;});
 const read=history.readHistoryCache('history:alpha:1');await entered.promise;
 const clear=policy.clearDownloadedCache('history');release.resolve();expect(await read).toBeUndefined();await clear;
 rows.set('chats:alpha','old list');const enteredList=deferred(),releaseList=deferred();
 storage.getItem.mockImplementation(async key=>{const value=rows.get(key)??null;if(key==='chats:alpha'){enteredList.resolve();await releaseList.promise;}return value;});
 const list=policy.readChatListCache('chats:alpha');await enteredList.promise;
 const disable=policy.updateCachePreferences({chatLists:false});releaseList.resolve();expect(await list).toBeUndefined();await disable;
});

test('queued post-clear writes are not coalesced ahead of the clear, and old producer tokens are rejected',async()=>{
 const token=policy.cacheGeneration();
 const old=history.writeHistoryCache('history:alpha:1','old');
 const clear=policy.clearDownloadedCache('all');
 const fresh=history.writeHistoryCache('history:alpha:1','fresh');
 await Promise.all([old,clear,fresh]);
 await history.writeHistoryCache('history:alpha:1','late old fetch',token);
 await policy.writeChatListCache('chats:alpha','late old list fetch',token);
 expect(await history.readHistoryCache('history:alpha:1')).toBe('fresh');expect(await policy.readChatListCache('chats:alpha')).toBeUndefined();
});

test('snapshot push captures admission generation, including close and an in-flight write follow-up',async()=>{
 jest.useFakeTimers();jest.setSystemTime(0);
 const {snapshotPersistence}=require('../snapshot-persistence') as typeof import('../snapshot-persistence');
 const cache=snapshotPersistence('history:alpha:1');cache.push({text:'old delayed'});
 await policy.clearDownloadedCache('all');await jest.advanceTimersByTimeAsync(1000);
 expect(payloadKeys()).toEqual([]);
 cache.push({text:'old closing'});await policy.clearDownloadedCache('all');await cache.close();expect(payloadKeys()).toEqual([]);
 const entered=deferred(),release=deferred();
 storage.setMany.mockImplementationOnce(async values=>{entered.resolve();await release.promise;for(const [key,value] of Object.entries(values))rows.set(key,value);});
 const active=snapshotPersistence('history:alpha:1');active.push({text:'first'},true);await entered.promise;
 active.push({text:'pending old'},true);
 const clear=policy.clearDownloadedCache('all');release.resolve();await clear;await active.flush();expect(payloadKeys()).toEqual([]);
 active.push({text:'new'},true);await active.close();expect(await history.readHistoryCache('history:alpha:1')).toBe('{"text":"new"}');
});

test('strict ownership preserves drafts, queue, Notes, pairings, credentials, settings and near-match keys byte for byte',async()=>{
 const protectedKeys=['draft:alpha:1','pending:alpha:1','outbox','notes:alpha','pairings','selection','auth:alpha','settings','download:apk','history:alpha:0','history:alpha:-1','history:alpha:01','history:alpha:1:unknown','history:alpha:9007199254740992','chats:alpha:extra','chunked:history:alpha:1:UPPER:0','chunked:history:alpha:1:saved:256','chunked:history:alpha:1:saved:00','chunked:notes:alpha:saved:0','chunked:history:alpha:1:manifest:other','unrelated'];
 const original=new Map(protectedKeys.map((key,i)=>[key,`\u0000private-looking synthetic 🐈 ${i}\n`]));
 for(const entry of original)rows.set(...entry);
 rows.set('chats:alpha','list');rows.set('history:alpha:1','snapshot');chunked('history-pages:alpha:1','pages');
 rows.set('chunked:history:beta:2:orphan:0','orphan');
 await policy.getCacheUsage();await policy.updateCachePreferences({history:false,chatLists:false});await policy.clearDownloadedCache('all');
 for(const [key,value] of original)expect(rows.get(key)).toBe(value);
 expect(storage.clear).not.toHaveBeenCalled();
});

test('usage cleans orphan/incomplete/corrupt generations and counts UTF-8 payloads including manifests once per conversation',async()=>{
 rows.set('chats:alpha','列表😀');rows.set('history:alpha:1','old legacy é');chunked('history:alpha:1','界😀\ud800');chunked('history-pages:alpha:1','pages 🐈');
 rows.set('chunked:history:alpha:1:abandoned:0','remove me');
 rows.set('chunked:history:beta:2','not a manifest');rows.set('chunked:history:beta:2:bad:0','remove me');
 rows.set('chunked:history:beta:3',JSON.stringify({version:1,generation:'missing',parts:2}));rows.set('chunked:history:beta:3:missing:0','half');
 const usage=await policy.getCacheUsage();
 const historyBytes=[...rows].filter(([key])=>key.startsWith('history:')||key.startsWith('chunked:history')).reduce((n,[,value])=>n+Buffer.byteLength(value,'utf8'),0);
 expect(usage).toEqual({chatLists:{bytes:Buffer.byteLength('列表😀'),entries:1},history:{bytes:historyBytes,conversations:1},totalBytes:historyBytes+Buffer.byteLength('列表😀')});
 expect([...rows.keys()].some(key=>/abandoned|beta/.test(key))).toBe(false);
 expect(await history.readHistoryCache('history:alpha:1')).toBe('界😀\ud800');
});

test('conversation quota groups pages and snapshots across backends, follows persisted selection LRU and ignores hidden live updates',async()=>{
 await policy.updateCachePreferences({maxConversations:2});
 await policy.touchCachedConversation('alpha',1);
 await history.writeHistoryCache('history:alpha:1','A snapshot');await history.writeHistoryCache('history-pages:alpha:1','A pages');
 await policy.touchCachedConversation('beta',1);await history.writeHistoryCache('history:beta:1','B snapshot');
 expect((await policy.getCacheUsage()).history.conversations).toBe(2);
 await history.writeHistoryCache('history:alpha:1','A hidden live update');
 reopen();
 await policy.touchCachedConversation('gamma',1);await history.writeHistoryCache('history:gamma:1','C snapshot');
 const usage=await policy.getCacheUsage();expect(usage.history.conversations).toBe(2);
 expect(payloadKeys().some(key=>key.includes('alpha:1'))).toBe(false);
 // Retained A may still produce tokens; it cannot displace more recently opened B/C.
 await history.writeHistoryCache('history-pages:alpha:1','hidden but mounted');
 expect(payloadKeys().some(key=>key.includes('alpha:1'))).toBe(false);
 // Selecting B again is enough to promote it without remounting or cache reads.
 await policy.touchCachedConversation('beta',1);
 await policy.touchCachedConversation('delta',1);await history.writeHistoryCache('history:delta:1','D');
 expect(payloadKeys().some(key=>key.includes('gamma:1'))).toBe(false);
 expect(await history.readHistoryCache('history:beta:1')).toBe('B snapshot');
});

test('a history read promotes both payload forms; lowering quota evicts whole identities but not chat lists',async()=>{
 rows.set('history:alpha:1','A');rows.set('history-pages:alpha:1','A pages');rows.set('history:beta:2','B');rows.set('chats:beta','list');
 await policy.touchCachedConversation('alpha',1);await policy.touchCachedConversation('beta',2);
 expect(await history.readHistoryCache('history-pages:alpha:1')).toBe('A pages');
 await policy.updateCachePreferences({maxConversations:1});
 expect(rows.has('history:beta:2')).toBe(false);expect(rows.get('history:alpha:1')).toBe('A');expect(rows.get('history-pages:alpha:1')).toBe('A pages');expect(rows.get('chats:beta')).toBe('list');
});

test('the aggregate history safety ceiling includes UTF-8 chunk/manifests regardless of conversation count',async()=>{
 expect(policy.HISTORY_CACHE_MAX_BYTES).toBe(128*1024*1024);
 const payload='界'.repeat(16*1024*1024); // 48 MiB shared fixture, three identities = 144 MiB.
 chunked('history:alpha:1',payload);chunked('history-pages:beta:2',payload);chunked('history:gamma:3',payload);
 rows.set(lruKey,JSON.stringify(['alpha:1','beta:2','gamma:3']));
 const usage=await policy.getCacheUsage();
 expect(usage.history.bytes).toBeLessThanOrEqual(policy.HISTORY_CACHE_MAX_BYTES);expect(usage.history.conversations).toBe(2);
 expect(rows.has('chunked:history:alpha:1')).toBe(false);expect(rows.has('chunked:history-pages:beta:2')).toBe(true);
});

test('live writes keep only one queued replacement per key and do not enumerate all storage every token',async()=>{
 const entered=deferred(),release=deferred();
 storage.setMany.mockImplementationOnce(async values=>{entered.resolve();await release.promise;for(const [key,value] of Object.entries(values))rows.set(key,value);});
 const first=history.writeHistoryCache('history:alpha:1','first');await entered.promise;
 const writes=Array.from({length:100},(_,i)=>history.writeHistoryCache('history:alpha:1',`token ${i}`));
 release.resolve();await Promise.all([first,...writes]);
 expect(storage.setMany).toHaveBeenCalledTimes(2);expect(storage.getAllKeys).toHaveBeenCalledTimes(1);
 expect(await history.readHistoryCache('history:alpha:1')).toBe('token 99');
});

test('clear preserves independent selection ordering when retained hidden sessions resume caching',async()=>{
 await policy.updateCachePreferences({maxConversations:1});
 await policy.touchCachedConversation('alpha',1);await policy.touchCachedConversation('beta',1);
 await history.writeHistoryCache('history:beta:1','selected');await policy.clearDownloadedCache('history');
 await history.writeHistoryCache('history:beta:1','selected after clear');
 await history.writeHistoryCache('history:alpha:1','hidden after clear');
 expect(await history.readHistoryCache('history:beta:1')).toBe('selected after clear');
 expect(payloadKeys().some(key=>key.includes('alpha:1'))).toBe(false);
});

test('chat-list category clear includes exact chunks and orphans but leaves history and the saved preference untouched',async()=>{
 await policy.writeChatListCache('chats:alpha','list 🐈');await history.writeHistoryCache('history:alpha:1','history');
 rows.set('chunked:chats:beta:abandoned:0','orphan list');
 await policy.updateCachePreferences({maxConversations:25});const saved=rows.get(preferencesKey);
 await policy.clearDownloadedCache('chatLists');
 expect(await policy.readChatListCache('chats:alpha')).toBeUndefined();
 expect(rows.has('chunked:chats:beta:abandoned:0')).toBe(false);
 expect(await history.readHistoryCache('history:alpha:1')).toBe('history');expect(rows.get(preferencesKey)).toBe(saved);
});

test('usage errors reach controls and unreadable optional payload rows can be reclaimed without blocking later network cache recovery',async()=>{
 storage.getAllKeys.mockRejectedValueOnce(Error('storage unavailable'));
 await expect(policy.getCacheUsage()).rejects.toThrow('storage unavailable');
 rows.set('history:alpha:1','oversized legacy');
 storage.getItem.mockImplementation(async key=>{if(key==='history:alpha:1')throw Error('row too large');return rows.get(key)??null;});
 expect((await policy.getCacheUsage()).totalBytes).toBe(0);expect(rows.has('history:alpha:1')).toBe(false);
 await history.writeHistoryCache('history:alpha:1','network recovery');
 expect(await history.readHistoryCache('history:alpha:1')).toBe('network recovery');
});

test('selection while caching is disabled remains the newest LRU on re-enable, without writing disabled cache metadata',async()=>{
 await policy.updateCachePreferences({maxConversations:1});
 await policy.touchCachedConversation('alpha',1);await policy.touchCachedConversation('beta',1);
 await policy.updateCachePreferences({history:false});const saved=rows.get(lruKey);
 await policy.touchCachedConversation('alpha',1);expect(rows.get(lruKey)).toBe(saved);
 await policy.updateCachePreferences({history:true});reopen();
 await history.writeHistoryCache('history:alpha:1','now selected');await history.writeHistoryCache('history:beta:1','now hidden');
 expect(await history.readHistoryCache('history:alpha:1')).toBe('now selected');
 expect(payloadKeys().some(key=>key.includes('beta:1'))).toBe(false);
});

test.each(['history:fixed-clock:1','chats:fixed-clock'])('reopening at the same wall time publishes a fresh generation for %s',async key=>{
 jest.useFakeTimers();jest.setSystemTime(1234567890000);
 const write=(value:string)=>key.startsWith('chats:')?policy.writeChatListCache(key,value):history.writeHistoryCache(key,value);
 const read=()=>key.startsWith('chats:')?policy.readChatListCache(key):history.readHistoryCache(key);
 await write('previous recovery copy');const previous=JSON.parse(rows.get(`chunked:${key}`)!);
 reopen();await write('replacement recovery copy');
 const current=JSON.parse(rows.get(`chunked:${key}`)!);
 expect(current.generation).not.toBe(previous.generation);
 expect(await read()).toBe('replacement recovery copy');
 expect(rows.has(`chunked:${key}:${previous.generation}:0`)).toBe(false);
});

test.each(['history:fixed-clock:1','chats:fixed-clock'])('partial replacement after same-clock reopen preserves the published %s copy',async key=>{
 jest.useFakeTimers();jest.setSystemTime(1234567890000);
 const write=(value:string)=>key.startsWith('chats:')?policy.writeChatListCache(key,value):history.writeHistoryCache(key,value);
 const read=()=>key.startsWith('chats:')?policy.readChatListCache(key):history.readHistoryCache(key);
 const old='previous '.repeat(10000);await write(old);const manifest=rows.get(`chunked:${key}`);
 reopen();storage.setMany.mockImplementationOnce(async values=>{
  const [name,value]=Object.entries(values)[0];rows.set(name,value);throw Error('synthetic partial chunk failure');
 });
 await write('replacement '.repeat(10000));
 expect(rows.get(`chunked:${key}`)).toBe(manifest);expect(await read()).toBe(old);
});

test('indexed published generation also prevents a collision when the later manifest read fails',async()=>{
 jest.useFakeTimers();jest.setSystemTime(1234567890000);
 const key='history:fixed-clock:1';await history.writeHistoryCache(key,'previous');
 const previous=JSON.parse(rows.get(`chunked:${key}`)!);reopen();let reads=0;
 storage.getItem.mockImplementation(async name=>{
  // The initial inventory now reads this manifest in a getMany batch. Fail the
  // writer's later standalone read, not the subsequent recovery verification.
  if(name===`chunked:${key}`&&++reads===1)throw Error('synthetic later read failure');
  return rows.get(name)??null;
 });
 await history.writeHistoryCache(key,'replacement');
 expect(storage.getMany).toHaveBeenCalledWith(expect.arrayContaining([`chunked:${key}`]));expect(reads).toBe(1);
 expect(JSON.parse(rows.get(`chunked:${key}`)!).generation).not.toBe(previous.generation);
 expect(await history.readHistoryCache(key)).toBe('replacement');
});
