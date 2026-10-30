import type {ToolEntry} from './tool-results';
const supported=new Set(['render_visual','mcp_app']);
const uuid='([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
const visual=new RegExp('^Isolated visual '+uuid+':','i'),mcp=new RegExp('^MCP Apps surface '+uuid+'\\.','i');
function surfaceId(name:string,content:unknown):string|undefined{
 const blocks=Array.isArray(content)?content:[content];
 const text=blocks.map(block=>typeof block==='string'?block:block?.type==='text'?block.text:'').filter(value=>typeof value==='string').join('\n').trimStart();
 return (name==='render_visual'?visual:mcp).exec(text)?.[1].toLowerCase();
}
/** Bind recorded surfaces to their actual producing call, never to the latest reply.
 * Existing tool-result receipts already contain the stable app UUID, so this also
 * repairs older conversations without changing any stored documents or messages.
 */
export function surfaceAnchors(entries:ToolEntry[],live?:any):Map<string,number>{
 const calls=new Map<string,{entryId:number;name:string}>(),parents=new Map<string,number>(),anchors=new Map<string,number>();
 for(const entry of entries)for(const message of entry.model??[])if(message.role==='assistant'&&Array.isArray(message.content))for(const block of message.content){
  if(block?.type==='toolCall'&&typeof block.id==='string'){
   parents.set(block.id,entry.id);
   if(supported.has(block.name))calls.set(block.id,{entryId:entry.id,name:block.name});
  }
 }
 for(const entry of entries)for(const message of entry.model??[]){
  if(message.role!=='toolResult'||message.isError)continue;
  const call=message.toolCallId?calls.get(message.toolCallId):undefined,name=message.toolName??call?.name;
  if(!name||!supported.has(name)||call&&call.name!==name)continue;
  const id=surfaceId(name,message.content);if(id&&!anchors.has(id))anchors.set(id,call?.entryId??entry.id);
 }
 // Nested calls have no transcript result, and codemode's final audit has no
 // surface ID. Only the adapter's persisted receipt can establish this link;
 // script output/args and transient nested progress are not anchor authority.
 for(const entry of entries){
  if(entry.kind!=='bob.nested-surface'||!entry.data||typeof entry.data!=='object')continue;
  const data=entry.data as Record<string,unknown>;
  if(typeof data.appId!=='string'||!new RegExp('^'+uuid+'$','i').test(data.appId)||typeof data.parentToolCallId!=='string'||!data.parentToolCallId||typeof data.toolName!=='string'||!supported.has(data.toolName))continue;
  const id=data.appId.toLowerCase();
  if(!anchors.has(id))anchors.set(id,parents.get(data.parentToolCallId)??entry.id);
 }
 // A surface can arrive just before its result entry. Only anchor it when its
 // real producing call is already stored; never use a provisional footer slot.
 for(const tool of live?.tools??[]){
  const call=calls.get(tool.callId);if(!call||tool.isError||['failed','error'].includes(tool.status))continue;
  const id=surfaceId(call.name,tool.output);if(id&&!anchors.has(id))anchors.set(id,call.entryId);
 }
 return anchors;
}
