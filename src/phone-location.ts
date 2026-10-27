import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {defineDoc,type Conversation,type ConversationId} from '@earendil-works/pi-durable';
import {BACKGROUND_CONTEXT as ctx,withoutAbortSignal,type Context} from '@earendil-works/chord/context';
import {z} from 'zod';
import type {State} from './state.js';
import {HttpError} from './errors.js';
export const LocationFix=z.object({latitude:z.number().finite().min(-90).max(90),longitude:z.number().finite().min(-180).max(180),accuracyMeters:z.number().finite().min(0).max(100000),capturedAt:z.number().int().positive().safe(),ageMs:z.number().int().min(0).max(30000),permission:z.enum(['precise','approximate']),mock:z.boolean()}).strict();
type Fix=z.infer<typeof LocationFix>;
type Request={id:string;deviceId:string;source:number;purpose:string;createdAt:number;expiresAt:number;result?:{status:'ok';fix:Fix;receivedAt:number}|{status:'unavailable';reason:string}};
type Book={devices:Record<string,{enabled:boolean;seenAt:number}>;requests:Record<string,Request>};
// Additive documents only: no task/schema rewrites and no sidecar authority.
export const PhoneLocations=defineDoc<Book>({kind:'bob.phone-location',version:1,scope:'conversation',history:'latest',fork:'initial',initial:()=>({devices:{},requests:{}}),checkpointWhen:()=>true});
export const PhoneLocationSource=defineDoc<{deviceId?:string}>({kind:'bob.phone-location-source',version:1,scope:'conversation',history:'latest',fork:'initial',initial:()=>({}),checkpointWhen:()=>true});
const Response=z.object({id:z.string().regex(/^[a-f0-9]{64}$/),status:z.enum(['ok','unavailable']),fix:LocationFix.optional(),reason:z.enum(['timeout','permission_denied','location_disabled','service_stopped']).optional()}).strict();
function prune(book:Book,now=Date.now()){for(const [id,request] of Object.entries(book.requests))if(request.expiresAt<=now)delete book.requests[id];}
export async function bindLocationDevice(chat:Conversation,deviceId:string){await chat.commit(async tx=>{(await tx.doc(PhoneLocationSource,chat.id)).deviceId=deviceId;},ctx);}
export async function locationAvailability(library:Conversation,deviceId:string,enabled:boolean){
 return library.commit(async tx=>{const book=await tx.doc(PhoneLocations,library.id);prune(book);book.devices[deviceId]={enabled,seenAt:Date.now()};if(!enabled)for(const [id,request] of Object.entries(book.requests))if(request.deviceId===deviceId)delete book.requests[id];return {enabled};},ctx);
}
export async function pollLocations(library:Conversation,deviceId:string){
 return library.commit(async tx=>{const book=await tx.doc(PhoneLocations,library.id);prune(book);const device=book.devices[deviceId];if(!device?.enabled)return {enabled:false,requests:[]};device.seenAt=Date.now();return {enabled:true,requests:Object.values(book.requests).filter(request=>request.deviceId===deviceId&&!request.result).slice(0,4).map(({id,purpose,expiresAt})=>({id,purpose,expiresAt}))};},ctx);
}
export async function pendingLocations(library:Conversation,deviceId:string){
 return library.commit(async tx=>{const book=await tx.doc(PhoneLocations,library.id);return {enabled:book.devices[deviceId]?.enabled===true,requests:Object.values(book.requests).filter(request=>request.deviceId===deviceId&&!request.result&&request.expiresAt>Date.now()).slice(0,4).map(({id,purpose,expiresAt})=>({id,purpose,expiresAt}))};},ctx);
}
export async function respondLocation(library:Conversation,deviceId:string,input:unknown){
 const response=Response.parse(input);if(response.status==='ok'&&!response.fix)throw new HttpError(400,'Location fix required');
 if(response.status==='unavailable'&&response.fix)throw new HttpError(400,'Unavailable response cannot contain a fix');
 return library.commit(async tx=>{const book=await tx.doc(PhoneLocations,library.id);prune(book);const request=book.requests[response.id];if(!book.devices[deviceId]?.enabled||!request||request.deviceId!==deviceId)throw new HttpError(410,'Location request expired or unavailable');
  // First response wins. A retried POST cannot replace an accepted fix.
  if(!request.result)request.result=response.status==='ok'?{status:'ok',fix:response.fix!,receivedAt:Date.now()}:{status:'unavailable',reason:response.reason??'timeout'};
  return {accepted:true};
 },ctx);
}
export async function phoneLocation(state:State,library:Conversation,chat:Conversation,taskId:string,input:unknown,context:Context):Promise<unknown>{
 const {purpose}=z.object({purpose:z.string().trim().min(1).max(240)}).strict().parse(input);
 const deviceId=await chat.commit(async tx=>(await tx.doc(PhoneLocationSource,chat.id)).deviceId,context);
 if(!deviceId)return {status:'unavailable',reason:'No phone is associated with this conversation input. Ask the owner to send the question from their paired phone.'};
 const paired=state.devices().find(device=>device.id===deviceId&&!device.revoked);if(!paired)return {status:'unavailable',reason:'The source phone is no longer paired.'};
 const id=createHash('sha256').update(`${chat.id}:${taskId}`).digest('hex');
 const admitted=await library.commit(async tx=>{const book=await tx.doc(PhoneLocations,library.id);prune(book);const device=book.devices[deviceId];
  if(!device?.enabled||device.seenAt<Date.now()-90000)return false;
  if(!book.requests[id]){if(Object.keys(book.requests).length>=16)return false;book.requests[id]={id,deviceId,source:chat.id,purpose,createdAt:Date.now(),expiresAt:Date.now()+45000};}return true;
 },context);
 if(!admitted)return {status:'unavailable',reason:'Enable Automatic location in Bob Settings on the source phone, grant Android location/notification permissions, and keep its location service enabled. Android may have stopped the service; reopen Bob to reconnect.'};
 try{
  const deadline=Date.now()+45000;
  while(Date.now()<deadline){
   context.abortSignal?.throwIfAborted();
   const request=await library.commit(async tx=>{const value=(await tx.doc(PhoneLocations,library.id)).requests[id];return value?JSON.parse(JSON.stringify(value)) as Request:undefined;},context);
   if(!request||request.expiresAt<=Date.now())break;
   if(request.result){
    if(request.result.status==='unavailable')return request.result;
    const ageMs=request.result.fix.ageMs+Math.max(0,Date.now()-request.result.receivedAt);
    if(ageMs>60000)return {status:'unavailable',reason:'The location fix is too old. Never present it as current.'};
    return {status:'ok',source:'Android phone location',deviceName:String(paired.name),...request.result.fix,ageMs,receivedAt:request.result.receivedAt};
   }
   await delay(400,undefined,{signal:context.abortSignal});
  }
  return {status:'unavailable',reason:'The phone did not provide a fresh fix before the request expired. Do not infer location from IP or use an old fix.'};
 }finally{
  // Coordinates remain in the normal tool/chat history, not an accumulating location journal.
  await library.commit(async tx=>{delete (await tx.doc(PhoneLocations,library.id)).requests[id];},withoutAbortSignal(context));
 }
}
