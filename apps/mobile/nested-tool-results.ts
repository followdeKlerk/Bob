/** Read-only presentation of Durable 1.4 nested slots and codemode result details.
 * Never infer relationships from names, array position or call-ID prefixes. */
export type NestedToolRow={id:string;name:string;status:string;depth:number;args?:string;preview?:string;durationMs?:number};
export type NestedToolActivity={source:'live'|'audit';rows:NestedToolRow[];total:number};
const MAX_ROWS=50;
const object=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const cut=(value:unknown,max:number)=>typeof value==='string'?value.length>max?value.slice(0,max)+'…':value:undefined;
const duration=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:undefined;
/** Bound before stringifying: nested args can contain file bodies or images. */
function argsPreview(value:unknown):string|undefined{
 const bounded=(item:unknown,depth:number):unknown=>{
  if(typeof item==='string')return cut(item,200);
  if(!item||typeof item!=='object')return item;
  if(depth===0)return '[…]';
  if(Array.isArray(item))return [...item.slice(0,8).map(v=>bounded(v,depth-1)),...(item.length>8?['…']:[])];
  const keys=Object.keys(item),result:Record<string,unknown>={};
  for(const key of keys.slice(0,8))result[key]=bounded((item as Record<string,unknown>)[key],depth-1);
  if(keys.length>8)result['…']='More fields';
  return result;
 };
 return cut(JSON.stringify(bounded(value,3)),600);
}
export function codemodeAudit(name:string|undefined,details:unknown):NestedToolActivity|undefined{
 if(name!=='codemode'||!object(details)||!Array.isArray(details.calls))return undefined;
 const rows:NestedToolRow[]=[];let total=0;
 const seen=new Set<number>();
 for(const call of details.calls){
  if(!object(call)||!Number.isInteger(call.id)||seen.has(call.id)||typeof call.name!=='string'||typeof call.args!=='string'||!['running','ok','error','cancelled'].includes(call.status))continue;
  seen.add(call.id);total++;
  if(rows.length<MAX_ROWS)rows.push({id:String(call.id),name:cut(call.name,120)!,status:call.status,depth:0,args:cut(call.args,600),preview:cut(call.error,320),durationMs:duration(call.durationMs)});
 }
 return {source:'audit',rows,total};
}
export function liveNestedActivity(live:unknown):Map<string,NestedToolActivity>{
 const activities=new Map<string,NestedToolActivity>();
 if(!object(live)||!Array.isArray(live.tools)||!Array.isArray(live.nestedTools))return activities;
 const parents=new Map<string,{taskId:unknown;root:string;depth:number}>();
 for(const tool of live.tools)if(object(tool)&&typeof tool.callId==='string'&&typeof tool.taskId==='number')parents.set(tool.callId,{taskId:tool.taskId,root:tool.callId,depth:-1});
 // Official slots are in creation order, with parents before descendants. A
 // missing/stale/mismatched parent is deliberately not assigned a guessed root.
 for(const tool of live.nestedTools){
  if(!object(tool)||typeof tool.callId!=='string'||typeof tool.name!=='string'||typeof tool.taskId!=='number'||typeof tool.parentCallId!=='string'||!['pending','running','done'].includes(tool.status)||parents.has(tool.callId))continue;
  const parent=parents.get(tool.parentCallId);
  if(!parent||parent.taskId!==tool.parentTaskId)continue;
  const depth=parent.depth+1;
  parents.set(tool.callId,{taskId:tool.taskId,root:parent.root,depth});
  let activity=activities.get(parent.root);
  if(!activity){activity={source:'live',rows:[],total:0};activities.set(parent.root,activity);}
  activity.total++;
  // Keep recent progress visible even for scripts with hundreds of calls.
  if(activity.rows.length>=MAX_ROWS)activity.rows.shift();
  const summary=object(tool.summary)?tool.summary:undefined;
  activity.rows.push({id:tool.callId,name:cut(tool.name,120)!,depth,status:summary?.isError===true?'error':tool.status==='done'&&!summary?'ended (outcome unavailable)':tool.status,args:argsPreview(tool.arguments),preview:cut(summary?.error??tool.output,320),durationMs:duration(summary?.durationMs)});
 }
 return activities;
}
