import AsyncStorage from '@react-native-async-storage/async-storage';
const PART_SIZE=60000,MAX_PARTS=256;
type Manifest={version:1;generation:string;parts:number};
const writes=new Map<string,Promise<void>>();let sequence=0;
const manifestKey=(key:string)=>`chunked:${key}`;
function manifest(value:string|null):Manifest|undefined{
 if(!value)return undefined;
 try{const item=JSON.parse(value);if(item.version===1&&typeof item.generation==='string'&&/^[a-z0-9-]+$/.test(item.generation)&&Number.isInteger(item.parts)&&item.parts>=0&&item.parts<=MAX_PARTS)return item;}catch{}
 return undefined;
}
const keys=(key:string,item:Manifest)=>Array.from({length:item.parts},(_,i)=>`${manifestKey(key)}:${item.generation}:${i}`);
/** Cache failure is never a reason to skip reconnecting to authoritative stored history. */
export async function readHistoryCache(key:string):Promise<string|undefined>{
 try{
  for(let attempt=0;attempt<2;attempt++){
   const item=manifest(await AsyncStorage.getItem(manifestKey(key)));
   if(!item)break;
   const names=keys(key,item),values=await AsyncStorage.getMany(names);
   if(names.every(name=>typeof values[name]==='string'))return names.map(name=>values[name]).join('');
  }
  // Read old caches when possible. Oversized or corrupt legacy rows are optional, not fatal.
  return await AsyncStorage.getItem(key)??undefined;
 }catch{return undefined;}
}
/** Small rows avoid Android's single-row limits. Publish only after every chunk was saved. */
export function writeHistoryCache(key:string,value:string):Promise<void>{
 if(value.length>PART_SIZE*MAX_PARTS)return Promise.resolve();
 const previous=writes.get(key)??Promise.resolve();
 const job=previous.catch(()=>{}).then(async()=>{
  let old:Manifest|undefined;try{old=manifest(await AsyncStorage.getItem(manifestKey(key)));}catch{}
  const parts:string[]=[];
  for(let start=0;start<value.length;){let end=Math.min(start+PART_SIZE,value.length);const last=value.charCodeAt(end-1);if(end<value.length&&last>=0xD800&&last<=0xDBFF)end--;parts.push(value.slice(start,end));start=end;}
  if(parts.length>MAX_PARTS)return;
  const item:Manifest={version:1,generation:`${Date.now().toString(36)}-${(++sequence).toString(36)}`,parts:parts.length},names=keys(key,item);
  try{
   if(names.length)await AsyncStorage.setMany(Object.fromEntries(names.map((name,i)=>[name,parts[i]])));
   await AsyncStorage.setItem(manifestKey(key),JSON.stringify(item));
  }catch(error){await AsyncStorage.removeMany(names).catch(()=>{});throw error;}
  if(old)await AsyncStorage.removeMany(keys(key,old)).catch(()=>{});
  await AsyncStorage.removeItem(key).catch(()=>{});
 });
 writes.set(key,job);
 return job.catch(()=>{}).finally(()=>{if(writes.get(key)===job)writes.delete(key);});
}
