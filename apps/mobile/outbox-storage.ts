import AsyncStorage from '@react-native-async-storage/async-storage';
const KEY='message-outbox:v2',LEGACY='message-outbox:v1',PART_SIZE=60000;
type Manifest={version:2;generation:string;parts:number};
let sequence=0;
function parseManifest(raw:string):Manifest {
 const value=JSON.parse(raw);
 if(value?.version!==2||typeof value.generation!=='string'||!/^[a-z0-9-]+$/.test(value.generation)||!Number.isSafeInteger(value.parts)||value.parts<1||value.parts>100000)throw Error('Saved message queue manifest is unreadable');
 return value;
}
const names=(value:Manifest)=>Array.from({length:value.parts},(_,index)=>`${KEY}:${value.generation}:${index}`);
/** Unlike an optional history cache, an unreadable outbox must fail closed. */
export async function readOutbox():Promise<unknown[]> {
 const raw=await AsyncStorage.getItem(KEY);
 if(!raw)return JSON.parse(await AsyncStorage.getItem(LEGACY)??'[]');
 const manifest=parseManifest(raw),parts=await Promise.all(names(manifest).map(key=>AsyncStorage.getItem(key)));
 if(parts.some(part=>part===null))throw Error('Saved message queue is incomplete');
 return JSON.parse(parts.join(''));
}
/** Publish the small manifest last. A crash during a write leaves the previous
 * complete queue readable; large queues never hit Android's single-row limit.
 * Caller serializes writes. The v1 queue is removed only after v2 is committed. */
export async function writeOutbox(items:unknown[]):Promise<void> {
 const raw=await AsyncStorage.getItem(KEY),previous=raw?parseManifest(raw):undefined;
 let generation:string;do{generation=`${Date.now().toString(36)}-${(++sequence).toString(36)}`;}while(generation===previous?.generation);
 const body=JSON.stringify(items),parts:string[]=[];
 for(let start=0;start<body.length;){let end=Math.min(start+PART_SIZE,body.length);const last=body.charCodeAt(end-1);if(end<body.length&&last>=0xD800&&last<=0xDBFF)end--;parts.push(body.slice(start,end));start=end;}
 const manifest:Manifest={version:2,generation,parts:parts.length},keys=names(manifest);
 let publishing=false;
 try{
  for(let index=0;index<keys.length;index++)await AsyncStorage.setItem(keys[index],parts[index]);
  publishing=true;await AsyncStorage.setItem(KEY,JSON.stringify(manifest));
 }catch(error){if(!publishing)await Promise.all(keys.map(key=>AsyncStorage.removeItem(key).catch(()=>{})));throw error;}
 if(previous)await Promise.all(names(previous).map(key=>AsyncStorage.removeItem(key).catch(()=>{})));
 await AsyncStorage.removeItem(LEGACY).catch(()=>{});
}
