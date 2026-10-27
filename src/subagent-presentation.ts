import type {ConversationId,EntryRecord,Harness,TaskId} from '@earendil-works/pi-durable';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';
import {Subagents} from './subagents.js';

/** Display-only provenance for native reporter inputs, including historical ones.
 * Never infer identity from message text, or modify stored entries/task schemas.
 * The native submission receipt links each reporter request to its exact entry.
 */
type AgentRegistry={reporters:Record<string,TaskId>};
export async function presentSubagentReports(h:Harness,id:ConversationId,entries:readonly EntryRecord[],registry?:AgentRegistry) {
 const candidates=new Set(entries.filter(entry=>entry.kind==='pi.user').map(entry=>entry.id));
 if(!candidates.size)return [...entries];
 const agents=registry??await h.snapshot(Subagents,id,ctx);
 if(!agents)return [...entries];
 const provenance=await h.commit(async tx=>{
  const result=new Map<number,{name:string;conversationId?:ConversationId}>();
  for(const taskId of Object.values(agents.reporters??{})){
   const receipt=await tx.submissionByRequest(id,`subagent-report:${taskId}`);
   if(receipt?.type==='input'&&receipt.entry!==undefined&&candidates.has(receipt.entry)){
    const task=await tx.task(taskId);
    if(task?.kind!=='app.subagent-reporter'||task.conversationId!==id)continue;
    const input=task.input as {name?:unknown;conversationId?:unknown}|null;
    if(typeof input?.name!=='string'||typeof input.conversationId!=='number')continue;
    result.set(receipt.entry,{name:input.name,conversationId:input.conversationId as ConversationId});
   }
  }
  return result;
 },ctx);
 return entries.map(entry=>{
  const source=provenance.get(entry.id);
  return source?{...entry,kind:'bob.subagent-report',data:source}:entry;
 });
}
