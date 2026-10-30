import {Interactive} from '@bob-local/interactive';
import {defineDoc,wrapTool,type Extension,type ToolTaskInput} from '@earendil-works/pi-durable';

/** Display receipt only; native ToolTask remains the execution/result authority. */
export const NestedSurfaceReceipt=defineDoc<{published?:boolean}>({
 kind:'bob.nested-surface-receipt',version:1,scope:'task',initial:()=>({}),checkpointWhen:()=>false,
});

/** Tool hooks are read-only in 1.4.0, so publish through the invocation-bound
 * execute API. Parent identity comes from the same native input used by hooks. */
export function nestedSurfaceWraps(extension:Extension){
 return (extension.tools??[]).filter(tool=>['render_visual','mcp_app'].includes(tool.name)).map(original=>wrapTool(original,tool=>({...tool,execute:async(args,api,context)=>{
  const result=await tool.execute(args,api,context);
  if(result.isError)return result;
  const details=result.details;
  const appId=details&&typeof details==='object'&&!Array.isArray(details)?details.appId:undefined;
  if(typeof appId!=='string')return result;
  const input=(await api.getTask(api.taskId,context))?.input as ToolTaskInput|undefined;
  if(input?.kind!=='nested')return result;
  const parentToolCallId=input.parentCallId;
  await api.commit(async tx=>{
   // Never trust script output/arguments as a surface identity or cross-chat reference.
   const app=(await tx.doc(Interactive,api.conversationId)).apps[appId];
   if(!app||app.kind!==(tool.name==='render_visual'?'visual':'mcp'))return;
   const receipt=await tx.doc(NestedSurfaceReceipt,api.taskId);
   if(receipt.published)return;
   await tx.appendEntry(api.conversationId,{
    kind:'bob.nested-surface',data:{appId,parentToolCallId,toolName:tool.name},
   });
   receipt.published=true;
  },context);
  return result;
 }})));
}
