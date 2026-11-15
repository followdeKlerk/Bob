import type {ConversationId,EntryId,EntryRecord,Harness,TaskId} from '@earendil-works/pi-durable';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';
import {Subagents,SUBAGENT_REPORT_KIND,subagentReportDisplayRequest} from './subagents.js';

type AgentRegistry={reporters:Record<string,TaskId>};
type Source={name:string;conversationId:ConversationId};
type Display={source:Source;text:string;receivedAt:number};
/** Native receipts prove report provenance, never text prefixes or supplied names.
 * New reporters persist one display-only event before queuing their model input.
 * Project that event immediately and suppress ONLY its proven duplicate input,
 * even across separate history pages. Legacy reporters retain the old projection.
 * No stored entry, submission, task or model context is rewritten here.
 */
export async function presentSubagentReports(h:Harness,id:ConversationId,entries:readonly EntryRecord[],registry?:AgentRegistry) {
 const candidates=new Map(entries.filter(entry=>entry.kind==='pi.user'||entry.kind===SUBAGENT_REPORT_KIND).map(entry=>[entry.id,entry]));
 if(!candidates.size)return [...entries];
 const agents=registry??await h.snapshot(Subagents,id,ctx);
 if(!agents)return [...entries];
 const {legacy,displays,hidden}=await h.commit(async tx=>{
  const legacy=new Map<EntryId,Source>(),displays=new Map<EntryId,Display>(),hidden=new Set<EntryId>();
  for(const taskId of new Set(Object.values(agents.reporters??{}))){
   const receipt=await tx.submissionByRequest(id,`subagent-report:${taskId}`);
   const display=await tx.submissionByRequest(id,subagentReportDisplayRequest(taskId));
   const inputEntry=receipt?.type==='input'&&receipt.entry!==undefined?candidates.get(receipt.entry):undefined;
   const displayId=display?.type==='write'&&display.status==='done'?display.entry:undefined;
   if(inputEntry?.kind!=='pi.user'&&(displayId===undefined||!candidates.has(displayId)))continue;
   const task=await tx.task(taskId);
   if(task?.kind!=='app.subagent-reporter'||task.conversationId!==id)continue;
   const input=task.input as {name?:unknown;conversationId?:unknown}|null;
   if(typeof input?.name!=='string'||typeof input.conversationId!=='number')continue;
   const source:Source={name:input.name,conversationId:input.conversationId as ConversationId};
   const event=displayId===undefined?undefined:candidates.get(displayId)??await tx.entry(displayId);
   const data=event?.data as {reporterTaskId?:unknown;name?:unknown;conversationId?:unknown;text?:unknown;receivedAt?:unknown}|null;
   const valid=event?.kind===SUBAGENT_REPORT_KIND&&event.conversationId===id&&!event.model?.length&&
    data?.reporterTaskId===taskId&&data.name===source.name&&data.conversationId===source.conversationId&&
    typeof data.text==='string'&&typeof data.receivedAt==='number'&&Number.isFinite(data.receivedAt)&&data.receivedAt>=0;
   if(valid&&event&&data){
    if(candidates.has(event.id))displays.set(event.id,{source,text:data.text as string,receivedAt:data.receivedAt as number});
    if(inputEntry?.kind==='pi.user'&&inputEntry.conversationId===id&&inputEntry.model?.length===1&&
      inputEntry.model[0]?.role==='user'&&inputEntry.model[0].content===data.text){
     hidden.add(inputEntry.id);continue;
    }
   }
   if(inputEntry?.kind==='pi.user')legacy.set(inputEntry.id,source);
  }
  return {legacy,displays,hidden};
 },ctx);
 return entries.flatMap(entry=>{
  if(hidden.has(entry.id))return [];
  const display=displays.get(entry.id);
  if(display)return [{...entry,kind:'bob.subagent-report',data:{...display.source,receivedAt:display.receivedAt},
   model:[{role:'user' as const,content:display.text,timestamp:display.receivedAt}]}];
  const source=legacy.get(entry.id);
  return [source?{...entry,kind:'bob.subagent-report',data:source}:entry];
 });
}
