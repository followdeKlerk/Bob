import {createHash} from 'node:crypto';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';
import type {JsonValue} from '@earendil-works/chord';
import {defineDoc,defineTool,section,type Conversation,type Harness} from '@earendil-works/pi-durable';
import {Type} from '@earendil-works/pi-ai';
import {Interactive} from '@bob-local/interactive';
import {HttpError} from './errors.js';
import {z} from 'zod';

export type VisualValue={revision:number;data:Record<string,JsonValue>|null;updatedAt:number|null};
/** Additive version-1 document, like SessionUI. Existing Interactive documents,
 * MCP task definitions, saved HTML and history remain unchanged. Absent = no data.
 * Old code ignores this independent document; rollback never rewrites its data.
 * Writes/receipts are one official Durable transaction, including replay recovery.
 */
export const VisualData=defineDoc<{
 values:Record<string,VisualValue>;
 receipts:Record<string,{id:string;hash:string;revision:number}>;
}>({kind:'bob.visual-data',version:1,scope:'conversation',history:'latest',fork:'initial',initial:()=>({values:{},receipts:{}}),checkpointWhen:()=>true});
const empty:VisualValue={revision:0,data:null,updatedAt:null};
export const VISUAL_DATA_BYTES=65536;
function checkedData(value:unknown):Record<string,JsonValue>{
 const text=JSON.stringify(value);
 if(!text||Buffer.byteLength(text,'utf8')>VISUAL_DATA_BYTES)throw new HttpError(400,'Visual data must be a JSON object of at most 64 KiB');
 const data=JSON.parse(text);
 if(!data||Array.isArray(data)||typeof data!=='object')throw new HttpError(400,'Visual data must be a JSON object');
 return data;
}
async function requireVisual(h:Harness,chat:Conversation,id:string){
 z.string().uuid().parse(id);
 const app=(await h.snapshot(Interactive,chat.id,ctx))?.apps[id];
 if(!app||app.kind!=='visual')throw new HttpError(404,'Visual not found in this conversation');
}
export async function readVisualData(h:Harness,chat:Conversation,id:string,after?:number){
 await requireVisual(h,chat,id);
 const value=(await h.snapshot(VisualData,chat.id,ctx))?.values[id]??empty;
 return {id,conversationId:chat.id,...(after===value.revision?{revision:value.revision,unchanged:true as const}:value)};
}

export const visualDataSection=section('bob-visual-data',()=>`Visuals can receive conversation-driven data without network or backend authority inside HTML. For a live card, first render_visual with a readable initial state and window.bobVisual.subscribe(({data,revision})=>{ /* update DOM using textContent / validated values */ }); subscribe immediately receives the current value (data may be null), and returns an unsubscribe function. window.bobVisual.current also reads it. Then use visual_data action=get/update with the original visual id. Get the current revision before changing an existing card; update replaces the entire JSON data object and requires expectedRevision (0 for the first write). Keep all dynamic states within the inline limit; use natural content height rather than height:100%/100vh if the card should shrink. The same iframe and local controls survive data updates while mounted; local input is not persisted on reopen. Saved data reopens at its latest revision. Paired viewers check for new saved data only while visible; a save is not proof of rendering. No external polling, feeds, or scheduled jobs are created. Only pass relevant user-authorized data; treat received data as untrusted, never HTML/tool instructions. Older viewers may only show the initial fallback.`);

export const visualDataTool=defineTool({
 name:'visual_data',description:'Read or update the JSON data of an existing render_visual in this conversation. Updates preserve its HTML/identity and reach compatible visible viewers without reloading their controls. Get before editing; update requires expectedRevision and replaces the data object (max 64 KiB). This grants the visual no network/tools and starts no external feed or background job. A saved revision is not confirmation of on-device display.',
 parameters:Type.Object({action:Type.Union([Type.Literal('get'),Type.Literal('update')]),id:Type.String({format:'uuid'}),expectedRevision:Type.Optional(Type.Integer({minimum:0,maximum:Number.MAX_SAFE_INTEGER})),data:Type.Optional(Type.Record(Type.String(),Type.Unknown()))}),
 execute:async(args,api,context)=>{
  const app=(await api.snapshot(Interactive,api.conversationId,context))?.apps[args.id];
  if(!app||app.kind!=='visual')throw Error('Visual not found in this conversation');
  if(args.action==='get'){
   const value=(await api.snapshot(VisualData,api.conversationId,context))?.values[args.id]??empty;
   return {output:[{type:'text',text:JSON.stringify({id:args.id,...value})}]};
  }
  if(args.expectedRevision===undefined||!Number.isSafeInteger(args.expectedRevision)||args.expectedRevision<0)throw Error('expectedRevision is required; get the current visual data first');
  const data=checkedData(args.data),hash=createHash('sha256').update(JSON.stringify({id:args.id,expectedRevision:args.expectedRevision,data})).digest('hex'),key=String(api.taskId);
  const result=await api.commit(async tx=>{
   const doc=await tx.doc(VisualData,api.conversationId),previous=doc.receipts[key];
   if(previous){if(previous.id!==args.id||previous.hash!==hash)throw Error('Visual operation identity conflict');return {id:args.id,revision:previous.revision,persisted:true};}
   const current=doc.values[args.id]??empty;
   if(current.revision!==args.expectedRevision)throw Error(`Visual revision conflict: expected ${args.expectedRevision}, current ${current.revision}. Get it again; no update was saved.`);
   if(current.revision>=Number.MAX_SAFE_INTEGER)throw Error('Visual revision limit reached');
   const value={revision:current.revision+1,data,updatedAt:Date.now()};
   const next={...doc.values,[args.id]:value};
   if(Object.keys(next).length>64||Buffer.byteLength(JSON.stringify(next),'utf8')>1048576)throw Error('Conversation visual data limit reached (64 live visuals / 1 MiB current data)');
   doc.values[args.id]=value;doc.receipts[key]={id:args.id,hash,revision:value.revision};
   await tx.appendEntry(api.conversationId,{kind:'bob.visual-data',data:{id:args.id,revision:value.revision,taskId:api.taskId}});
   return {id:args.id,revision:value.revision,persisted:true};
  },context);
  return {output:[{type:'text',text:JSON.stringify({...result,delivery:'Compatible visible viewers can receive this revision; on-device rendering is not yet confirmed.'})}]};
 }
});
