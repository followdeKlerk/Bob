import type {Backend} from './use-mobile-runtime';
import {sessionKey} from './retained-sessions';

export const STARTUP_READ_TIMEOUT_MS=8000;
export const NOTIFICATION_STARTUP_TIMEOUT_MS=1500;
/** A view deadline, not cancellation of native I/O. Callers must fence the late
 * result. This helper never retries, mutates storage, or reports raw errors. */
export function startupRead<T>(read:()=>Promise<T>,timeoutMs=STARTUP_READ_TIMEOUT_MS):Promise<T>{
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Startup read timed out')),timeoutMs);
  Promise.resolve().then(read).then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});
 });
}
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export function savedBackends(raw:string|null,loopbackTesting=false):Backend[]{
 if(raw===null)return [];
 const value:unknown=JSON.parse(raw);
 if(!Array.isArray(value))throw Error('Invalid saved workstations');
 const ids=new Set<string>();
 return value.map(item=>{
  if(!record(item)||typeof item.backendId!=='string'||!sessionKey({backendId:item.backendId})||ids.has(item.backendId)||typeof item.endpoint!=='string'||typeof item.name!=='string'||!item.name.trim()||(item.alias!==undefined&&typeof item.alias!=='string'))throw Error('Invalid saved workstation');
  const url=new URL(item.endpoint);
  // Preserve saved HTTPS profiles; never reinterpret a corrupt record as
  // a new invitation, send credentials elsewhere, or silently drop one profile.
  if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!(url.protocol==='https:'&&!!url.hostname||loopbackTesting&&url.protocol==='http:'&&url.hostname==='127.0.0.1'&&Number(url.port)>0))throw Error('Invalid saved workstation endpoint');
  ids.add(item.backendId);
  return {backendId:item.backendId,endpoint:item.endpoint,name:item.name,...(item.alias!==undefined?{alias:item.alias}:{})} as Backend;
 });
}
export function savedSelection(raw:string|null):{backendId:string;chat?:number}|undefined{
 if(raw===null)return undefined;
 const value:unknown=JSON.parse(raw);
 if(!record(value)||typeof value.backendId!=='string'||!sessionKey(value as {backendId:string;chat?:number}))throw Error('Invalid saved selection');
 return {backendId:value.backendId,chat:value.chat as number|undefined};
}
export function savedChats(raw:string|null):Record<string,number>{
 if(raw===null)return {};
 const value:unknown=JSON.parse(raw);
 if(!record(value))throw Error('Invalid saved workstation selections');
 const result:Record<string,number>={};
 for(const [backendId,chat] of Object.entries(value)){
  if(!sessionKey({backendId,chat:chat as number})||chat===undefined)throw Error('Invalid saved conversation');
  Object.defineProperty(result,backendId,{value:chat,enumerable:true,writable:true,configurable:true});
 }
 return result;
}
