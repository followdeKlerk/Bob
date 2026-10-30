import {codemodeAudit,liveNestedActivity,type NestedToolActivity} from './nested-tool-results';
export type ToolMessage={role:string;content:unknown;toolCallId?:string;toolName?:string;isError?:boolean;details?:unknown};
export type ToolEntry={id:number;kind:string;model?:ToolMessage[];data?:unknown};
export type LinkedResult={content:unknown;status:string;isError?:boolean;nested?:NestedToolActivity};
// Join only by real call identity within the selected conversation. Never by name/order.
export function linkToolResults(entries:ToolEntry[],live:any) {
 const callIds=new Set<string>();
 const collect=(content:unknown)=>{if(Array.isArray(content))for(const block of content)if(block?.type==='toolCall'&&typeof block.id==='string')callIds.add(block.id);};
 for(const entry of entries)for(const message of entry.model??[])if(message.role==='assistant')collect(message.content);
 collect(live?.generation?.message?.content);
 const persistedIds=new Set<string>();
 const results=new Map<string,LinkedResult>();
 const nested=liveNestedActivity(live);
 for(const tool of live?.tools??[])if(typeof tool.callId==='string')results.set(tool.callId,{content:tool.output,status:tool.status??'running',isError:tool.isError===true||tool.status==='failed'||tool.status==='error',nested:nested.get(tool.callId)});
 for(const entry of entries)for(const message of entry.model??[])if(message.role==='toolResult'&&typeof message.toolCallId==='string'){persistedIds.add(message.toolCallId);results.set(message.toolCallId,{content:message.content,status:message.isError?'failed':'done',isError:message.isError,nested:codemodeAudit(message.toolName,message.details)});}
 const visible=entries.flatMap(entry=>{
  if(!entry.model?.length)return [entry];
  const model=entry.model.filter(message=>!(message.role==='toolResult'&&message.toolCallId&&callIds.has(message.toolCallId)));
  return model.length?[{...entry,model}]:[];
 });
 // Unmatched results remain reachable when their call is outside the loaded history.
 const unmatchedLive=(live?.tools??[]).filter((tool:any)=>!callIds.has(tool.callId)&&!persistedIds.has(tool.callId));
 return {entries:visible,results,unmatchedLive};
}
