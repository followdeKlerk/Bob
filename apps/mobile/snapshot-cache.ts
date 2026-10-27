type Entry={id:number};
const serialized=new WeakMap<object,string|undefined>();
function fingerprint(value:unknown){
 if(value&&typeof value==='object'){
  if(!serialized.has(value))serialized.set(value,JSON.stringify(value));
  return serialized.get(value);
 }
 return JSON.stringify(value);
}
const same=(a:unknown,b:unknown)=>a===b||fingerprint(a)===fingerprint(b);
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const sameFields=(a:Record<string,unknown>,b:Record<string,unknown>)=>Object.keys(a).length===Object.keys(b).length&&Object.keys(b).every(key=>a[key]===b[key]);
/** Durable entry IDs are immutable. Identical heartbeats also retain live-doc,
 * tool-output and work identities instead of remeasuring the chat every 3s.
 * Inputs are immutable JSON snapshots, never locally edited draft objects. */
export function reuseSnapshotEntries<T extends {entries:Entry[]}>(previous:T|undefined,next:T):T{
 if(!previous)return next;
 const known=new Map(previous.entries.map(entry=>[entry.id,entry]));
 let entries=next.entries.map(entry=>known.get(entry.id)??entry);
 if(entries.length===previous.entries.length&&entries.every((entry,index)=>entry===previous.entries[index]))entries=previous.entries;
 const before=previous as Record<string,unknown>,result={...next,entries} as Record<string,unknown>;
 for(const key of Object.keys(next)){
  if(key==='entries')continue;
  const value=result[key];
  if(key==='docs'&&record(value)&&record(before.docs)){
   const docs={...value};for(const id of Object.keys(docs))if(same(before.docs[id],docs[id]))docs[id]=before.docs[id];
   result.docs=sameFields(before.docs,docs)?before.docs:sameFields(value,docs)?value:docs;
  }else if(same(before[key],value))result[key]=before[key];
 }
 return (sameFields(before,result)?previous:result) as T;
}
