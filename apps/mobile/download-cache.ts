import AsyncStorage from '@react-native-async-storage/async-storage';
import {NativeModules,Platform} from 'react-native';

export type CachePreferences = {chatLists:boolean;history:boolean;maxConversations:number};
export type CacheUsage = {chatLists:{bytes:number;entries:number};history:{bytes:number;conversations:number};totalBytes:number};
export const DEFAULT_CACHE_PREFERENCES:Readonly<CachePreferences> = Object.freeze({chatLists:true,history:true,maxConversations:50});
/** Aggregate UTF-8 history payload (including manifests/chunks), not physical database size. */
export const HISTORY_CACHE_MAX_BYTES = 128 * 1024 * 1024;
const PREFERENCES_KEY = 'download-cache:preferences:v1', LRU_KEY = 'download-cache:lru:v1';
const PART_SIZE = 60000, MAX_PARTS = 256, SCAN_BATCH_SIZE = 8;
type Category = 'chatLists'|'history';
type Manifest = {version:1;generation:string;parts:number};
type Address = {base:string;category:Category;identity:string;chunked:boolean;generation?:string;part?:number};
type Row = Address & {bytes:number;manifest?:Manifest;unreadable?:boolean};
let epoch = 0, sequence = 0, preferences:CachePreferences|undefined, recencyDirty=false;
let preferenceLoad:Promise<CachePreferences>|undefined, policyWrites=0;
let usageFlight:{generation:number;job:Promise<CacheUsage>}|undefined;
let tail:Promise<unknown> = Promise.resolve(), inventory:Map<string,Row>|undefined, recency:string[]|undefined;
const listeners = new Set<()=>void>();

// Payload access and policy mutations share this boundary. Metadata-only reads
// need not wait behind transcript scans, but still follow admitted policy writes.
// Control admission advances the epoch even while a native write is pending.
function serial<T>(run:()=>Promise<T>):Promise<T> {
 const job = tail.then(run); tail = job.catch(()=>{}); return job;
}
export function cacheGeneration():number { return epoch; }
export function subscribeCachePreferences(listener:()=>void):()=>void {
 listeners.add(listener); return ()=>{listeners.delete(listener);};
}
function notify() { for(const listener of listeners)try{listener();}catch{/* A view cannot break policy persistence. */} }
function validPreferences(value:unknown):value is CachePreferences {
 const p=value as CachePreferences|null;
 return !!p && typeof p.chatLists==='boolean' && typeof p.history==='boolean' && Number.isInteger(p.maxConversations) && p.maxConversations>=1 && p.maxConversations<=500;
}
function loadPreferences():Promise<CachePreferences> {
 if(preferences)return Promise.resolve(preferences);
 if(preferenceLoad)return preferenceLoad;
 // Share cold reads with writers. A delayed duplicate read must never overwrite
 // a newer persisted policy. Only absence means defaults; errors fail closed.
 const job=(async()=>{
  const raw=await AsyncStorage.getItem(PREFERENCES_KEY);
  const value:unknown=raw===null?{...DEFAULT_CACHE_PREFERENCES}:JSON.parse(raw);
  if(!validPreferences(value))throw Error('Downloaded cache preferences could not be read. Retry before changing them.');
  preferences={chatLists:value.chatLists,history:value.history,maxConversations:value.maxConversations};
  return preferences;
 })();
 preferenceLoad=job;
 const finished=()=>{if(preferenceLoad===job)preferenceLoad=undefined;};
 void job.then(finished,finished);
 return job;
}
export function getCachePreferences():Promise<CachePreferences> {
 const read=async()=>({...await loadPreferences()});
 return policyWrites?serial(read):read();
}
function address(key:string):Address|undefined {
 const chunked=key.startsWith('chunked:'), source=chunked?key.slice(8):key;
 const match=/^(chats:[^:\s]+|(?:history|history-pages):[^:\s]+:[1-9][0-9]*)(?::([a-z0-9-]+):(0|[1-9][0-9]*))?$/.exec(source);
 if(!match || (!chunked && match[2]) || (match[3]!==undefined && Number(match[3])>=MAX_PARTS))return;
 const base=match[1], category=base.startsWith('chats:')?'chatLists':'history';
 if(category==='history' && !Number.isSafeInteger(Number(base.slice(base.lastIndexOf(':')+1))))return;
 return {base,category,identity:base.slice(base.indexOf(':')+1),chunked,...(match[2]?{generation:match[2],part:Number(match[3])}:{})};
}
function parseManifest(value:string|null):Manifest|undefined {
 if(!value)return;
 try{const item=JSON.parse(value);if(item.version===1 && typeof item.generation==='string' && /^[a-z0-9-]+$/.test(item.generation) && Number.isInteger(item.parts) && item.parts>=0 && item.parts<=MAX_PARTS)return item;}catch{}
}
/** JS strings may include lone surrogates: UTF-8 encodes those as replacement characters. */
function utf8Bytes(value:string):number {
 let bytes=0;
 for(let i=0;i<value.length;i++){
  const code=value.charCodeAt(i);
  if(code<0x80)bytes++;else if(code<0x800)bytes+=2;
  else if(code>=0xD800 && code<=0xDBFF && i+1<value.length && value.charCodeAt(i+1)>=0xDC00 && value.charCodeAt(i+1)<=0xDFFF){bytes+=4;i++;}
  else bytes+=3;
 }
 return bytes;
}
const manifestKey=(key:string)=>`chunked:${key}`;
const chunkKeys=(key:string,item:Manifest)=>Array.from({length:item.parts},(_,i)=>`${manifestKey(key)}:${item.generation}:${i}`);
function record(key:string,value:string):Row {
 const parsed=address(key)!;
 return {...parsed,bytes:utf8Bytes(value),...(parsed.chunked && parsed.part===undefined?{manifest:parseManifest(value)}:{})};
}
async function removeRows(names:string[]):Promise<void> {
 try{
  for(let start=0;start<names.length;start+=64){
   const batch=names.slice(start,start+64);await AsyncStorage.removeMany(batch);
   for(const key of batch)inventory?.delete(key);
  }
 }catch(error){inventory=undefined;throw error;}
}
async function scan(publish=true):Promise<Map<string,Row>> {
 const rows=new Map<string,Row>();
 if(Platform.OS==='android' && NativeModules.BobPlatform?.downloadedCacheSnapshot){
  const snapshot:unknown=await NativeModules.BobPlatform.downloadedCacheSnapshot();
  if(!Array.isArray(snapshot))throw Error('Invalid cache measurement');
  for(const item of snapshot){
   const parsed=typeof item?.key==='string'?address(item.key):undefined;
   if(!parsed || !Number.isSafeInteger(item.bytes) || item.bytes<0)throw Error('Invalid cache measurement row');
   rows.set(item.key,{...parsed,bytes:item.bytes});
  }
  if(publish){
   // Byte-count snapshots deliberately omit ALL values. Resolve the actual
   // manifests before destructive bookkeeping; an omitted/failed read must
   // never be mistaken for corrupt metadata and delete valid history.
   for(const [key,row] of rows)if(row.chunked&&row.part===undefined){
    const raw=await AsyncStorage.getItem(key);
    if(raw===null)throw Error('Cache manifest changed during indexing');
    row.manifest=parseManifest(raw);
   }
   inventory=rows;
  }
  return rows;
 }
 async function one(key:string){
  try{const value=await AsyncStorage.getItem(key);if(value!==null)rows.set(key,record(key,value));}
  catch{rows.set(key,{...address(key)!,bytes:0,unreadable:true});}
 }
 let batch:string[]=[];
 async function flush(){
  if(!batch.length)return;
  const keys=batch;batch=[];
  try{
   const values=await AsyncStorage.getMany(keys);
   for(const key of keys)if(typeof values[key]==='string')rows.set(key,record(key,values[key]!));
  }catch{
   // A failed batch is not proof every row is bad. Isolate failures before the
   // existing orphan recovery can remove unreadable managed copies.
   for(const key of keys)await one(key);
  }
 }
 // Batch only managed chunks/manifests, keeping legacy large rows separate and
 // never reading unrelated storage. Each batch is bounded, not all transcripts.
 for(const key of await AsyncStorage.getAllKeys()){
  const parsed=address(key);if(!parsed)continue;
  if(!parsed.chunked){await flush();await one(key);continue;}
  batch.push(key);if(batch.length===SCAN_BATCH_SIZE)await flush();
 }
 await flush();if(publish)inventory=rows;return rows;
}
async function cleanOrphans():Promise<void> {
 const rows=inventory!;
 const valid=new Set<string>();
 for(const [key,row] of rows){
  if(!row.chunked || row.part!==undefined || !row.manifest || row.unreadable)continue;
  const names=chunkKeys(row.base,row.manifest);
  if(names.every(name=>rows.has(name) && !rows.get(name)!.unreadable)){
   valid.add(key);for(const name of names)valid.add(name);
  }
 }
 await removeRows([...rows].filter(([key,row])=>row.unreadable || (row.chunked && !valid.has(key))).map(([key])=>key));
}
async function indexed():Promise<Map<string,Row>> {
 if(!inventory){await scan();await cleanOrphans();}
 return inventory!;
}
async function loadRecency():Promise<string[]> {
 if(recency)return recency;
 try{
  const value:unknown=JSON.parse(await AsyncStorage.getItem(LRU_KEY)??'[]');
  if(Array.isArray(value))recency=[...new Set(value.filter((id):id is string=>typeof id==='string' && !!address(`history:${id}`)))].slice(-1000);
 }catch{/* Optional ordering metadata must not prevent authoritative loading. */}
 return recency??(recency=[]);
}
async function persistRecency():Promise<void> {
 if(!recencyDirty || !recency)return;
 await AsyncStorage.setItem(LRU_KEY,JSON.stringify(recency));recencyDirty=false;
}
async function touch(identity:string,persist=true):Promise<void> {
 const order=await loadRecency();recency=[...order.filter(id=>id!==identity),identity].slice(-1000);recencyDirty=true;
 if(persist)await persistRecency();
}
export function touchCachedConversation(backendId:string,conversationId:number):Promise<void> {
 const parsed=address(`history:${backendId}:${conversationId}`);
 if(!parsed || parsed.chunked)return Promise.resolve();
 return serial(async()=>{
  let enabled=false;try{enabled=(await loadPreferences()).history;}catch{}
  // Selection remains meaningful while caching is off. Keep only in-memory
  // ordering then, and persist it on re-enable without remounting any session.
  await touch(parsed.identity,enabled);
 }).catch(()=>{});
}
async function enforce(p:CachePreferences):Promise<void> {
 const rows=await indexed();
 await removeRows([...rows].filter(([,row])=>!p[row.category]).map(([key])=>key));
 const groups=new Map<string,{bytes:number;keys:string[]}>();
 for(const [key,row] of rows){
  if(row.category!=='history')continue;
  const group=groups.get(row.identity)??{bytes:0,keys:[]};group.bytes+=row.bytes;group.keys.push(key);groups.set(row.identity,group);
 }
 let bytes=[...groups.values()].reduce((sum,group)=>sum+group.bytes,0), count=groups.size;
 if(count<=p.maxConversations && bytes<=HISTORY_CACHE_MAX_BYTES)return;
 const order=await loadRecency(), ranks=new Map(order.map((id,i)=>[id,i]));
 // Writes never promote a conversation. Newly downloaded, never-opened history
 // loses to explicitly read/selected history, regardless of live-view lifetime.
 for(const [,group] of [...groups].sort(([a],[b])=>(ranks.get(a)??-1)-(ranks.get(b)??-1) || a.localeCompare(b))){
  if(count<=p.maxConversations && bytes<=HISTORY_CACHE_MAX_BYTES)break;
  await removeRows(group.keys);bytes-=group.bytes;count--;
 }
}
export function updateCachePreferences(patch:Partial<CachePreferences>):Promise<CachePreferences> {
 epoch++;policyWrites++;
 return serial(async()=>{
  const previous=await loadPreferences(), next={...previous,...patch};
  if(!validPreferences(next))throw Error('Cache limits must be whole numbers from 1 to 500 and cache switches must be boolean.');
  try{await AsyncStorage.setItem(PREFERENCES_KEY,JSON.stringify(next));}
  catch(error){preferences=undefined;throw error;}
  preferences=next;
  if(next.history)await persistRecency().catch(()=>{});
  // Persist opt-out before deleting. If deletion fails the UI sees the error,
  // while subsequent reads/writes still honor the successfully saved opt-out.
  try{inventory=undefined;await enforce(next);}finally{notify();}
  return {...next};
 }).finally(()=>{policyWrites--;});
}
export function clearDownloadedCache(category:'all'|'chatLists'|'history'):Promise<void> {
 epoch++;
 return serial(async()=>{
  if(!['all','chatLists','history'].includes(category))throw Error('Unknown downloaded cache category');
  const names=(await AsyncStorage.getAllKeys()).filter(key=>{const row=address(key);return row && (category==='all' || row.category===category);});
  await removeRows(names);
  // Selection/read recency is independent metadata, not downloaded content.
  // Keep it across clears: mounted hidden streams must not outrank the selected
  // conversation merely because both start caching again in the new epoch.
  inventory=undefined;notify();
 });
}
export function getCacheUsage():Promise<CacheUsage> {
 // Retained views and retries may observe the same pending scan. Never add an
 // unbounded queue of duplicate scans, or reuse one across clear/policy epochs.
 if(usageFlight?.generation===epoch)return usageFlight.job;
 const job=serial(async()=>{
  await loadPreferences();
  // Measurement is observational: no orphan deletion or policy enforcement.
  // Android returns byte counts, not entire transcripts. Do not replace the
  // writer's inventory with an observational snapshot.
  const rows=await scan(false);
  if([...rows.values()].some(row=>row.unreadable))throw Error('Some cached data could not be measured');
  const usage:CacheUsage={chatLists:{bytes:0,entries:0},history:{bytes:0,conversations:0},totalBytes:0};
  const chats=new Set<string>(), histories=new Set<string>();
  for(const row of rows.values()){
   usage[row.category].bytes+=row.bytes;
   (row.category==='chatLists'?chats:histories).add(row.identity);
  }
  usage.chatLists.entries=chats.size;usage.history.conversations=histories.size;
  usage.totalBytes=usage.chatLists.bytes+usage.history.bytes;return usage;
 });
 const flight={generation:epoch,job};usageFlight=flight;
 const finished=()=>{if(usageFlight===flight)usageFlight=undefined;};
 void job.then(finished,finished);
 return job;
}
/** Internal common reader; callers must not access managed storage outside this boundary. */
export function readManagedCache(key:string):Promise<string|undefined> {
 const parsed=address(key), generation=epoch;
 if(!parsed || parsed.chunked)return Promise.resolve(undefined);
 return serial(async()=>{
  if(generation!==epoch || !(await loadPreferences())[parsed.category])return;
  if(parsed.category==='history')await touch(parsed.identity).catch(()=>{});
  let value:string|undefined;
  try{
   const item=parseManifest(await AsyncStorage.getItem(manifestKey(key)));
   if(item){const names=chunkKeys(key,item), values=names.length?await AsyncStorage.getMany(names):{};
    if(names.every(name=>typeof values[name]==='string'))value=names.map(name=>values[name]).join('');}
  }catch{/* Try a readable legacy row even if the optional manifest is corrupt. */}
  if(value===undefined)value=await AsyncStorage.getItem(key)??undefined;
  return generation===epoch?value:undefined;
 }).catch(()=>undefined);
}
const pendingWrites=new Map<string,{value:string;generation:number;job:Promise<void>}>();
/** Internal common writer; one waiting value per key bounds live-update queues. */
export function writeManagedCache(key:string,value:string,generation=epoch):Promise<void> {
 const parsed=address(key);
 if(!parsed || parsed.chunked || generation!==epoch || value.length>PART_SIZE*MAX_PARTS)return Promise.resolve();
 const pending=pendingWrites.get(key);
 if(pending && pending.generation===generation){pending.value=value;return pending.job;}
 const entry={value,generation,job:Promise.resolve()};
 entry.job=serial(async()=>{
  if(pendingWrites.get(key)===entry)pendingWrites.delete(key);
  const admitted=entry.generation, payload=entry.value;
  if(admitted!==epoch)return;
  const p=await loadPreferences();if(!p[parsed.category] || admitted!==epoch)return;
  await indexed();if(admitted!==epoch)return;
  const old=parseManifest(await AsyncStorage.getItem(manifestKey(key)).catch(()=>null));
  const parts:string[]=[];
  for(let start=0;start<payload.length;){
   let end=Math.min(start+PART_SIZE,payload.length), last=payload.charCodeAt(end-1);
   if(end<payload.length && last>=0xD800 && last<=0xDBFF)end--;
   parts.push(payload.slice(start,end));start=end;
  }
  if(parts.length>MAX_PARTS)return;
  // The process counter restarts, and wall time can repeat or move backwards.
  // Never overwrite currently published chunks before the new manifest commits.
  const indexedGeneration=inventory?.get(manifestKey(key))?.manifest?.generation;
  let chunkGeneration:string;
  do{chunkGeneration=`${Date.now().toString(36)}-${(++sequence).toString(36)}`;}
  while(chunkGeneration===old?.generation || chunkGeneration===indexedGeneration);
  const item:Manifest={version:1,generation:chunkGeneration,parts:parts.length}, names=chunkKeys(key,item);
  try{
   if(names.length)await AsyncStorage.setMany(Object.fromEntries(names.map((name,i)=>[name,parts[i]])));
   if(admitted!==epoch){await removeRows(names);return;}
   await AsyncStorage.setItem(manifestKey(key),JSON.stringify(item));
   for(let i=0;i<names.length;i++)inventory?.set(names[i],record(names[i],parts[i]));
   inventory?.set(manifestKey(key),record(manifestKey(key),JSON.stringify(item)));
  }catch(error){await removeRows(names).catch(()=>{});throw error;}
  // Publication precedes cleanup: an interrupted replacement never publishes
  // incomplete JSON, and the next scan can reclaim abandoned generations.
  if(old)await removeRows(chunkKeys(key,old));
  await removeRows([key]);await enforce(p);
 }).catch(()=>{inventory=undefined;});
 pendingWrites.set(key,entry);return entry.job;
}
export function readChatListCache(key:string):Promise<string|undefined> {
 return address(key)?.category==='chatLists'?readManagedCache(key):Promise.resolve(undefined);
}
export function writeChatListCache(key:string,value:string,generation=epoch):Promise<void> {
 return address(key)?.category==='chatLists'?writeManagedCache(key,value,generation):Promise.resolve();
}
