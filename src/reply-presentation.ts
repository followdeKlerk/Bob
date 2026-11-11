import type {ConversationId,Cursor,EntryRecord,Harness,Storage} from '@earendil-works/pi-durable';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';

type Reply={version:1;first:number;answer:number};
type Reader=Pick<Storage,'scanSubmissions'|'entry'>;
type Index={groups:Promise<Reply[]>;answers:Map<number,Promise<boolean>>};
/** Native settlements, never adjacency/model-authored JSON, certify ownership.
 * Share one bounded index across loaded windows. Public commit notifications,
 * not entry-window IDs or terminal-status guesses, invalidate mutable evidence. */
export function createReplyPresentation(reader:Reader,publications:Pick<Harness,'observeCommits'>){
 const indices=new Map<ConversationId,Index>();
 const projected=new WeakMap<object,{key:string;entry:EntryRecord}>();
 let closed=false;
 const observation=publications.observeCommits({advance:publication=>{
  for(const change of publication.changes){
   // Non-answer entries and progress-only documents cannot change settlement
   // ranges or validate a missing assistant answer. No native reads in observers.
   if(change.type==='submission'||change.type==='entry'&&change.value.kind==='pi.assistant')indices.delete(change.value.conversationId);
  }
 },end:()=>{closed=true;indices.clear();}});
 async function ranges(id:ConversationId):Promise<Reply[]>{
  const groups=new Map<number,Reply>();let cursor:Cursor|undefined;
  // Submission creation order is NOT settlement order. Keep the conservative
  // hard bound and inspect all fetched ranges, including unloaded overlaps.
  for(let pageCount=0;pageCount<10;pageCount++){
   const page=await reader.scanSubmissions({conversationId:id,status:'done',order:'descending'},100,cursor,ctx);
   for(const sub of page.items){
    if(sub.conversationId!==id||sub.type!=='input'||sub.status!=='done'||sub.entry>sub.answer)continue;
    const old=groups.get(sub.answer);
    groups.set(sub.answer,{version:1,first:Math.min(old?.first??sub.entry,sub.entry),answer:sub.answer});
   }
   cursor=page.next;if(!cursor)break;
  }
  const all=[...groups.values()].sort((a,b)=>a.first-b.first||a.answer-b.answer),valid:Reply[]=[];
  let previousEnd=-Infinity;
  for(let index=0;index<all.length;index++){
   const group=all[index];
   const overlaps=previousEnd>=group.first||(index+1<all.length&&all[index+1].first<=group.answer);
   previousEnd=Math.max(previousEnd,group.answer);
   if(!overlaps)valid.push(group);
  }
  return valid;
 }
 function index(id:ConversationId){
  let value=indices.get(id);
  if(value)indices.delete(id);
  else value={groups:Promise.resolve().then(()=>ranges(id)),answers:new Map()};
  indices.set(id,value);while(indices.size>96)indices.delete(indices.keys().next().value!);
  return value;
 }
 function answer(id:ConversationId,value:Index,group:Reply){
  let job=value.answers.get(group.answer);
  if(!job){job=Promise.resolve().then(async()=>{const result=(await reader.entry(group.answer as EntryRecord['id'],ctx))?.entry;return result?.conversationId===id&&result.kind==='pi.assistant'&&!!result.model?.some(message=>message.role==='assistant');});value.answers.set(group.answer,job);}
  return job;
 }
 const present=async<T extends EntryRecord>(id:ConversationId,entries:readonly T[]):Promise<T[]>=>{
  if(closed)throw Error('Reply presentation is closed');
  if(!entries.length)return [];
  const min=Math.min(...entries.map(e=>e.id)),max=Math.max(...entries.map(e=>e.id));
  // A continuously changing conversation must not create an unbounded retry loop.
  // If both attempts are superseded, keep original output slots without guessed proof.
  for(let attempt=0;attempt<2;attempt++){
   const current=index(id);let groups:Reply[]=[];
   try{
    const all=await current.groups;
    if(closed)throw Error('Reply presentation is closed');
    if(indices.get(id)!==current)continue;
    for(const group of all){
     if(group.answer<min||group.first>max)continue;
     if(await answer(id,current,group))groups.push(group);
     if(indices.get(id)!==current||closed)break;
    }
   }catch(error){
    if(closed)throw Error('Reply presentation is closed');
    if(indices.get(id)!==current)continue;
    indices.delete(id);throw error;
   }
   if(closed)throw Error('Reply presentation is closed');
   if(indices.get(id)!==current)continue;
   return entries.map(entry=>{
    if(entry.conversationId!==id||!['pi.assistant','pi.tool-result','bob.file','bob.nested-surface'].includes(entry.kind))return entry;
    let low=0,high=groups.length;
    while(low<high){const middle=(low+high)>>>1;if(groups[middle].first<=entry.id)low=middle+1;else high=middle;}
    const reply=groups[low-1];if(!reply||entry.id>reply.answer)return entry;
    const key=`${reply.first}:${reply.answer}`,cached=projected.get(entry);
    if(cached?.key===key)return cached.entry as T;
    const value={...entry,mobileReply:reply};projected.set(entry,{key,entry:value});return value;
   });
  }
  return [...entries];
 };
 return Object.assign(present,{close(){if(closed)return;closed=true;indices.clear();observation.detach();}});
}
