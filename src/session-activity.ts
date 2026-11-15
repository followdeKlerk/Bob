import {InboxDoc,LiveDoc,type ConversationId,type ConversationRecord,type Cursor,type Harness,type Tx} from '@earendil-works/pi-durable';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';
import {SessionUI} from './session-controls.js';
import type {State} from './state.js';

export const SESSION_INACTIVITY_MS=7*24*60*60*1000;
const activityEntries=new Set(['bob.user','pi.user','pi.assistant','pi.tool-result','bob.artifact','bob.file','bob.subagent-report']);
const activeTaskStates=['pending','running','waiting','sleeping','completing'] as const;
type Activity={lastActivityAt:number};
/** Derived wall-clock metadata only. Durable owns conversations, work and archive
 * flags. No transcript reads or clock guesses for pre-upgrade conversations. */
export function createSessionActivity(state:State,h:Harness,libraryId:ConversationId,options:{now?:()=>number;intervalMs?:number;start?:boolean}={}){
 const now=options.now??Date.now;
 const key=(id:ConversationId)=>`session-activity:v1:${id}`;
 const read=(id:ConversationId)=>state.get<Activity>(key(id));
 let metadataHealthy=true;
 function touch(id:ConversationId){
  try {
   const time=now(),old=read(id);
   if(!old||!Number.isFinite(old.lastActivityAt)||old.lastActivityAt<time)state.set(key(id),{lastActivityAt:time});
  } catch {
   metadataHealthy=false;
   console.error('Session activity metadata unavailable; automatic archiving is suspended until restart.');
  }
 }
 let revision=0,closed=false,running:Promise<void>|undefined;
 const observation=h.observeCommits({advance:publication=>{
  const touched=new Set<ConversationId>();
  for(const change of publication.changes){
   if(change.type==='conversation')touched.add(change.value.id);
   if(change.type==='entry'&&activityEntries.has(change.value.kind))touched.add(change.value.conversationId);
   if(change.type==='submission'&&change.value.type==='input')touched.add(change.value.conversationId);
   if(change.type==='task'&&!change.value.background)touched.add(change.value.conversationId);
  }
  if(touched.size)revision++;
  for(const id of touched)if(id!==libraryId)touch(id);
 },end:()=>{closed=true;}});
 async function busy(tx:Tx,id:ConversationId){
  // Recheck inside the same native transaction as the archive flag write.
  // Background watchers never keep a session alive; blocked foreground work does.
  if((await tx.doc(LiveDoc,id)).run||(await tx.doc(InboxDoc,id)).items.some(item=>item.mode!=='write'))return true;
  for(const status of activeTaskStates)if((await tx.scanTasks({conversationId:id,background:false,status},1)).items.length)return true;
  return false;
 }
 async function sweep(){
  if(!metadataHealthy)return;
  const graphRevision=revision;
  const records:ConversationRecord[]=[];let cursor:Cursor|undefined;
  // Never archive with an incomplete ownership graph. Bound each maintenance pass.
  for(let page=0;page<100;page++){
   const batch=await h.commit(tx=>tx.scanConversations({order:'ascending'},100,cursor),ctx);records.push(...batch.items);cursor=batch.next;
   if(!cursor)break;
  }
  if(cursor||closed||!metadataHealthy||revision!==graphRevision)return;
  const children=new Map<ConversationId,ConversationId[]>();
  for(const record of records){
   if(record.id!==libraryId&&!read(record.id))touch(record.id); // Conservative seven-day upgrade grace.
   if(record.owner){const list=children.get(record.owner.conversationId)??[];list.push(record.id);children.set(record.owner.conversationId,list);}
  }
  const inspection=await h.inspect(ctx);
  const pending=new Set(inspection.submissions.filter(s=>s.type!=='write'&&(s.status==='queued'||s.status==='placed')).map(s=>s.conversationId));
  for(const root of records){
   if(closed)return;
   if(root.owner||root.id===libraryId)continue;
   const members:ConversationId[]=[],seen=new Set<ConversationId>(),stack=[root.id];
   while(stack.length){const id=stack.pop()!;if(seen.has(id))continue;seen.add(id);members.push(id);stack.push(...children.get(id)??[]);}
   const last=Math.max(...members.map(id=>read(id)?.lastActivityAt??now()));
   if(!Number.isFinite(last)||last>now()-SESSION_INACTIVITY_MS||members.some(id=>pending.has(id)))continue;
   const capturedRevision=graphRevision;
   await h.commit(async tx=>{
    const flags=await tx.doc(SessionUI,root.id);
    if(flags.pinned||flags.archived||flags.trashed)return;
    for(const id of members){
     if((await tx.doc(SessionUI,id)).pinned||await busy(tx,id))return;
    }
    // A newly admitted child/conversation or input between scan and commit makes
    // this pass conservative. Native commits serialize the check and flag write.
    if(!metadataHealthy||revision!==capturedRevision||members.some(id=>(read(id)?.lastActivityAt??now())>now()-SESSION_INACTIVITY_MS))return;
    flags.archived=true;
   },ctx);
  }
 }
 function tick(){
  if(closed)return Promise.resolve();
  if(!running)running=sweep().finally(()=>{running=undefined;});
  return running;
 }
 const timer=options.start===false?undefined:setInterval(()=>{void tick().catch(()=>console.error('Session inactivity maintenance failed; no retry of external actions.'));},options.intervalMs??60000);
 timer?.unref();
 return {touch,lastActivityAt:(id:ConversationId)=>read(id)?.lastActivityAt,tick,
  async close(){closed=true;if(timer)clearInterval(timer);observation.detach();await running;}};
}
