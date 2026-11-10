import {LiveDoc,type ConversationId,type Cursor,type Harness,type HarnessInspection,type LiveState} from '@earendil-works/pi-durable';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';
import {ChatMeta} from './documents.js';
import {Subagents} from './subagents.js';
import {SessionUI} from './session-controls.js';
import {isRetired} from './retired-chat-profile.js';
import {decodeCursor,encodeCursor} from './pagination.js';
import type {State} from './state.js';

export type AgentStatus='working'|'stopping'|'idle'|'unknown';
export type AgentOverviewFilter='all'|'archived'|'trash';
export type AgentOverview={backendId:string;sessions:{conversationId:ConversationId;title:string;status:AgentStatus;agents:{name:string;conversationId:ConversationId;status:AgentStatus}[];pinned?:boolean;archived?:boolean;trashed?:boolean;readOnly?:boolean}[];next?:string};
const purpose='agent-overview:v1';
export const AGENT_OVERVIEW_PAGE_SIZE=30;
const active=(status:AgentStatus)=>status==='working'||status==='stopping';

/** Summary reads only: no transcript/context reads, scheduling, or document writes.
 * Inspection is shared across every root and child in this request. Missing child
 * records and registry entries pointing outside the parent's ownership are omitted.
 */
export async function agentOverview(state:State,h:Harness,libraryId:ConversationId,token:string|null,filter?:AgentOverviewFilter):Promise<AgentOverview>{
 // Legacy overview includes archived roots with active work. Explicit Sessions
 // filters are strict UI-state partitions, with independent pagination scopes.
 const scope=filter?`${purpose}:${filter}`:purpose;
 let cursor:Cursor|undefined=decodeCursor(state,scope,token);
 const inspection=await h.inspect(ctx),sessions:AgentOverview['sessions']=[];
 async function status(id:ConversationId):Promise<AgentStatus>{
  return conversationAgentStatus(inspection,id,await h.snapshot(LiveDoc,id,ctx));
 }
 // Each native batch is no bigger than the remaining OUTPUT capacity. Thus its
 // cursor never advances past unreturned roots, even after many owned children.
 // Ten batches bound raw scanning to 300; sparse pages may still have `next`.
 for(let batches=0;batches<10&&sessions.length<AGENT_OVERVIEW_PAGE_SIZE;batches++){
  const page=await h.commit(tx=>tx.scanConversations({order:'descending'},AGENT_OVERVIEW_PAGE_SIZE-sessions.length,cursor),ctx);
  for(const record of page.items){
   if(record.id===libraryId||record.owner)continue;
   const ui=await h.snapshot(SessionUI,record.id,ctx);
   if(filter==='trash'?!ui?.trashed:ui?.trashed)continue;
   if(filter==='all'&&ui?.archived||filter==='archived'&&!ui?.archived)continue;
   const readOnly=await isRetired(h,record.id);
   if(readOnly&&!filter)continue;
   const [meta,registry,rootStatus]=await Promise.all([h.snapshot(ChatMeta,record.id,ctx),h.snapshot(Subagents,record.id,ctx),status(record.id)]);
   const agents:AgentOverview['sessions'][number]['agents']=[];
   // Retired histories are inert; trash is a history list, not a helper view.
   for(const [name,agent] of Object.entries(readOnly||ui?.trashed?{}:registry?.agents??{})){
    const child=await h.commit(tx=>tx.conversation(agent.conversationId),ctx);
    if(!child||child.id===libraryId||child.owner?.conversationId!==record.id||await isRetired(h,child.id))continue;
    const childUI=await h.snapshot(SessionUI,child.id,ctx);
    if(childUI?.trashed)continue;
    const childStatus=await status(child.id);
    if(childUI?.archived&&!active(childStatus))continue;
    agents.push({name,conversationId:child.id,status:childStatus});
   }
   if(!filter&&ui?.archived&&!active(rootStatus)&&!agents.some(agent=>active(agent.status)))continue;
   sessions.push({conversationId:record.id,title:meta?.title??'New chat',status:rootStatus,agents,...(filter?{pinned:!!ui?.pinned,archived:!!ui?.archived,trashed:!!ui?.trashed,readOnly}:ui?.pinned?{pinned:true}:{})});
  }
  cursor=page.next;
  if(!cursor)break;
 }
 return {backendId:state.id,sessions,next:encodeCursor(state,scope,cursor)};
}
/** Shared by overview and live snapshot/SSE presentation: background watchers
 * never indicate work or stopping, and passive writes never indicate a run. */
export function conversationAgentStatus(inspection:HarnessInspection,id:ConversationId,live:Readonly<LiveState>|undefined):AgentStatus{
 const tasks=inspection.tasks.filter(task=>task.record.conversationId===id&&!task.record.background);
 if(tasks.some(task=>task.record.abortRequested))return 'stopping';
 const pending=inspection.submissions.some(submission=>submission.conversationId===id&&submission.type!=='write'&&(submission.status==='queued'||submission.status==='placed'));
 if(live?.run||pending||tasks.some(task=>task.state.kind!=='blocked'))return 'working';
 return tasks.length?'unknown':'idle';
}
