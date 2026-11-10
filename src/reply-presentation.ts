import type {ConversationId,Cursor,EntryRecord,Storage} from '@earendil-works/pi-durable';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';

type Reply={version:1;first:number;answer:number};
type Reader=Pick<Storage,'scanSubmissions'|'entry'>;
/** Read-only display association from native input settlements, not transcript
 * adjacency or model-authored JSON. No stored entry, execution or schema changes.
 * Cache by loaded window: token-only snapshots do not rescan native history. */
export function createReplyPresentation(reader:Reader){
 const windows=new Map<string,Promise<Reply[]>>();
 const latestAnswer=new Map<ConversationId,number>();
 const projected=new WeakMap<object,{key:string;entry:EntryRecord}>();
 async function ranges(id:ConversationId,min:number,max:number):Promise<Reply[]>{
  const key=`${id}:${min}:${max}`,prior=windows.get(key);
  if(prior){windows.delete(key);windows.set(key,prior);return prior;}
  const job=(async()=>{
   const groups=new Map<number,Reply>();let cursor:Cursor|undefined;
   // Bounded historical fallback: when proof is outside this scan, retain the
   // original attachment slot rather than moving it to a guessed latest answer.
   for(let pageCount=0;pageCount<10;pageCount++){
    const page=await reader.scanSubmissions({conversationId:id,status:'done',order:'descending'},100,cursor,ctx);
    for(const sub of page.items){
     if(sub.conversationId!==id||sub.type!=='input'||sub.status!=='done'||sub.entry>sub.answer)continue;
     const old=groups.get(sub.answer);
     groups.set(sub.answer,{version:1,first:Math.min(old?.first??sub.entry,sub.entry),answer:sub.answer});
    }
    cursor=page.next;if(!cursor)break;
    // IDs of a submission precede its placed input. Once the whole page is
    // before an applicable input we still cannot assume older queued inputs
    // have settled in order; keep the hard scan bound instead of guessing.
   }
   // Detect overlaps using every fetched settlement, including answers before
   // this page: the metadata certifies a whole range, not only visible entries.
   const all=[...groups.values()].sort((a,b)=>a.first-b.first||a.answer-b.answer),valid:Reply[]=[];
   let previousEnd=-Infinity;
   for(let index=0;index<all.length;index++){
    const group=all[index];
    // The furthest earlier end catches nesting; the next start is the earliest
    // later range. Include rejected/unloaded groups in both overlap checks.
    const overlaps=previousEnd>=group.first||(index+1<all.length&&all[index+1].first<=group.answer);
    previousEnd=Math.max(previousEnd,group.answer);
    if(group.answer<min||group.first>max||overlaps)continue;
    const answer=(await reader.entry(group.answer as EntryRecord['id'],ctx))?.entry;
    if(answer?.conversationId===id&&answer.kind==='pi.assistant'&&answer.model?.some(message=>message.role==='assistant'))valid.push(group);
   }
   const newest=Math.max(0,...valid.map(group=>group.answer));
   if(newest>(latestAnswer.get(id)??0)){
    latestAnswer.delete(id);latestAnswer.set(id,newest);
    while(latestAnswer.size>96)latestAnswer.delete(latestAnswer.keys().next().value!);
    // A formerly incomplete historical page can become attributable after its
    // answer commits, even though that old page's min/max IDs never change.
    for(const old of windows.keys())if(old!==key&&old.startsWith(`${id}:`))windows.delete(old);
   }
   return valid;
  })();
  windows.set(key,job);while(windows.size>96)windows.delete(windows.keys().next().value!);
  try{return await job;}catch(error){if(windows.get(key)===job)windows.delete(key);throw error;}
 }
 return async function present<T extends EntryRecord>(id:ConversationId,entries:readonly T[]):Promise<T[]>{
  if(!entries.length)return [];
  const groups=await ranges(id,Math.min(...entries.map(e=>e.id)),Math.max(...entries.map(e=>e.id)));
  return entries.map(entry=>{
   if(entry.conversationId!==id||!['pi.assistant','pi.tool-result','bob.file','bob.nested-surface'].includes(entry.kind))return entry;
   // Ranges are sorted and all overlaps were rejected above. Find the last
   // start at/before this entry without rescanning every historical answer.
   let low=0,high=groups.length;
   while(low<high){const middle=(low+high)>>>1;if(groups[middle].first<=entry.id)low=middle+1;else high=middle;}
   const reply=groups[low-1];
   if(!reply||entry.id>reply.answer)return entry;
   const key=`${reply.first}:${reply.answer}`,cached=projected.get(entry);
   if(cached?.key===key)return cached.entry as T;
   const value={...entry,mobileReply:reply};projected.set(entry,{key,entry:value});return value;
  });
 };
}
