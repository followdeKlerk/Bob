import {useEffect,useRef,useState} from 'react';
import {AppState,NativeModules,PermissionsAndroid,Platform} from 'react-native';

export type PhoneToolsBackend={backendId:string;endpoint:string;name:string};
export type PhoneToolRequest={id:string;action:string;parameters:Record<string,unknown>;expiresAt:number;status:'pending'|'executing'};
export type PhoneToolResult={status:'ok'|'launched'|'error'|'unavailable'|'unknown';data?:Record<string,unknown>;message?:string};
type Request=(path:string,method?:string,body?:unknown,backend?:PhoneToolsBackend,signal?:AbortSignal)=>Promise<any>;
type Options={backend?:PhoneToolsBackend;chat?:number;requests?:PhoneToolRequest[];request:Request};
/** An external lifecycle signal must not disable the network deadline. Race the
 * abort as well as fetch: a stuck implementation cannot hold the serial tail forever. */
async function boundedRequest(api:Request,path:string,body:unknown,backend:PhoneToolsBackend,controller:AbortController){
 if(controller.signal.aborted)throw Error('Phone request cancelled');
 let abort!:()=>void;
 const stopped=new Promise<never>((_resolve,reject)=>{abort=()=>reject(Error('Phone request cancelled or timed out'));controller.signal.addEventListener('abort',abort,{once:true});});
 const timer=setTimeout(()=>controller.abort(),20000);
 try{return await Promise.race([api(path,'POST',body,backend,controller.signal),stopped]);}
 finally{clearTimeout(timer);controller.signal.removeEventListener('abort',abort);}
}

type NativeTools={enabled:(backendId:string)=>Promise<boolean>;setEnabled:(backendId:string,enabled:boolean)=>Promise<void|boolean>;execute:(backendId:string,requestJson:string)=>Promise<string>;getResult?:(backendId:string,requestId:string)=>Promise<string|null>};
const actions=new Set(['capabilities','calendar_list','calendar_events','calendar_create','calendar_update','calendar_delete','contacts_search','apps_list','app_launch','alarm_set','timer_set','device_info','volume_set','torch_set','clipboard_write','dial','sms_compose','share_text','open_settings']);
const native=()=>NativeModules.BobPhoneTools as NativeTools|undefined;
const supported=()=>Platform.OS==='android'&&!!native()?.enabled&&!!native()?.setEnabled&&!!native()?.execute;
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function jsonValue(value:unknown,depth=0,budget={nodes:2048,characters:131072}):boolean{
 if(depth>8||--budget.nodes<0)return false;
 if(value===null||typeof value==='boolean')return true;
 if(typeof value==='number')return Number.isFinite(value);
 if(typeof value==='string'){budget.characters-=value.length;return value.length<=20000&&budget.characters>=0;}
 if(Array.isArray(value))return value.length<=100&&value.every(item=>jsonValue(item,depth+1,budget));
 if(!object(value)||Object.keys(value).length>100)return false;
 return Object.entries(value).every(([key,item])=>{budget.characters-=key.length;return budget.characters>=0&&key.length<=128&&!['__proto__','prototype','constructor'].includes(key)&&jsonValue(item,depth+1,budget);});
}
function bytes(value:string){let n=0;for(const c of value){const code=c.codePointAt(0)!;n+=code<=127?1:code<=2047?2:code<=65535?3:4;}return n;}
/** Snapshot contents are untrusted; native additionally validates each action's parameters. */
export function validatePhoneToolRequest(value:unknown,now=Date.now()):PhoneToolRequest|undefined{
 try{
  if(!object(value)||typeof value.id!=='string'||!/^[a-f0-9]{64}$/.test(value.id)||typeof value.action!=='string'||!actions.has(value.action)||!object(value.parameters)||!jsonValue(value.parameters)||!Number.isSafeInteger(value.expiresAt)||(value.expiresAt as number)<=now||(value.expiresAt as number)>now+90000||!['pending','executing'].includes(value.status as string))return;
  const copy={id:value.id,action:value.action,parameters:value.parameters,expiresAt:value.expiresAt,status:value.status};
  if(bytes(JSON.stringify(copy))>131072)return;
  return JSON.parse(JSON.stringify(copy)) as PhoneToolRequest;
 }catch{return;}
}
function parseResult(text:unknown):PhoneToolResult|undefined{
 if(typeof text!=='string'||bytes(text)>65536)return;
 try{const result:unknown=JSON.parse(text);if(object(result)&&['ok','launched','error','unavailable','unknown'].includes(result.status as string)&&(result.data===undefined||object(result.data))&&(result.message===undefined||typeof result.message==='string'))return result as PhoneToolResult;}catch{/* Never rerun an action to repair a malformed result. */}
}

type Attempt={backend:PhoneToolsBackend;chat:number;id:string;expiresAt:number;api:Request;result?:PhoneToolResult;uploading?:Promise<void>;recovering?:boolean;recoverAfter?:number;finished:boolean};
// Process-wide lock survives hook remounts. No claim or native call is retried, including uncertain failures.
const attempts=new Map<string,Attempt>();
const disabledBackends=new Set<string>();
// Keep false/true writes ordered, including background/resume and hook remounts.
const availabilityTails=new Map<string,Promise<void>>();
const backendKey=(backend:PhoneToolsBackend)=>JSON.stringify([backend.backendId,backend.endpoint]);
function upload(attempt:Attempt):Promise<void>{
 if(!attempt.result||attempt.finished||AppState.currentState!=='active')return Promise.resolve();
 if(attempt.uploading)return attempt.uploading;
 attempt.uploading=(async()=>{try{const response=await attempt.api(`chats/${attempt.chat}/phone-tools`,'POST',{id:attempt.id,action:'result',result:attempt.result},attempt.backend);attempt.finished=response?.accepted===true;}catch{/* Retain precisely this result for a later foreground retry. */}finally{attempt.uploading=undefined;}})();
 return attempt.uploading;
}
async function recover(attempt:Attempt){
 if(attempt.recovering||attempt.result||!attempt.recoverAfter||attempt.recoverAfter>Date.now()||AppState.currentState!=='active'||!native()?.getResult)return;
 attempt.recovering=true;attempt.recoverAfter=Date.now()+25000;
 try{
  const receipt=await native()!.getResult!(attempt.backend.backendId,attempt.id);
  const result=parseResult(receipt);
  if(result){attempt.result=result;attempt.recoverAfter=undefined;attempt.finished=false;await upload(attempt);}
 }catch{/* Receipt lookup is read-only; retry on a later foreground reconciliation. */}
 finally{attempt.recovering=false;}
}
function reconcile(){
 for(const [key,attempt] of attempts){
  if(attempt.finished&&!attempt.recoverAfter&&attempt.expiresAt<Date.now())attempts.delete(key);
  else if(attempt.result&&!attempt.finished)void upload(attempt);
  else if(attempt.recoverAfter)void recover(attempt);
 }
}
const permissionNames=()=>[PermissionsAndroid.PERMISSIONS.READ_CALENDAR,PermissionsAndroid.PERMISSIONS.WRITE_CALENDAR,PermissionsAndroid.PERMISSIONS.READ_CONTACTS,PermissionsAndroid.PERMISSIONS.CAMERA];
type State={enabled:boolean;busy:boolean;error:string;permissions:string};
type Scope={key:string;identity:object;backend:PhoneToolsBackend;chat?:number;alive:boolean;active:boolean;enabled:boolean;available:boolean;disablePending:boolean;version:number;busy:boolean;controllers:Set<AbortController>;publish:(patch:Partial<State>)=>void};

export function usePhoneTools({backend,chat,requests,request}:Options){
 const key=JSON.stringify([backend?.backendId,backend?.endpoint,chat]);
 const api=useRef(request);api.current=request;
 const selected=useRef(key);selected.current=key;
 const selectedBackend=useRef(backend?backendKey(backend):undefined);selectedBackend.current=backend?backendKey(backend):undefined;
 const identity=useRef({key});if(identity.current.key!==key)identity.current={key};
 const renderIdentity=identity.current;
 const scope=useRef<Scope|undefined>(undefined);
 const pending=useRef(requests);pending.current=requests;
 const [view,setView]=useState<State&{key:string}>({key,enabled:false,busy:false,error:'',permissions:'Not checked'});
 const valid=(s:Scope)=>s.alive&&selected.current===s.key&&identity.current===s.identity&&scope.current===s;
 const foreground=(s:Scope)=>valid(s)&&s.active&&AppState.currentState==='active';
 function cancel(s:Scope){s.available=false;s.version++;for(const controller of s.controllers)controller.abort();s.controllers.clear();}
 async function availability(s:Scope,enabled:boolean){
  const controller=new AbortController(),id=backendKey(s.backend),version=s.version;
  if(enabled)s.controllers.add(controller);else s.available=false;
  const operation=(availabilityTails.get(id)??Promise.resolve()).then(async()=>{
   if(enabled&&(!foreground(s)||!s.enabled||version!==s.version||controller.signal.aborted))return;
   try{
    const response=await boundedRequest(api.current,'phone-tools/availability',{enabled},s.backend,controller);
    if(enabled&&foreground(s)&&s.enabled&&version===s.version&&!controller.signal.aborted){
     s.available=response?.enabled===true;
     if(s.available)void dispatch(s);else s.publish({error:'Backend did not acknowledge phone availability. Refresh to retry.'});
    }
   }catch{if(enabled&&foreground(s))s.publish({error:'Could not report phone availability. Reopen settings or refresh to retry.'});}
   finally{s.controllers.delete(controller);}
  });
  availabilityTails.set(id,operation);
  try{await operation;}finally{s.controllers.delete(controller);if(availabilityTails.get(id)===operation)availabilityTails.delete(id);}
 }
 async function permissions(s:Scope,ask:boolean){
  const version=s.version,names=permissionNames();
  const current=await Promise.all(names.map(name=>PermissionsAndroid.check(name)));
  if(!foreground(s)||version!==s.version)return;
  const missing=names.filter((_,index)=>!current[index]);
  const decisions=ask&&missing.length?await PermissionsAndroid.requestMultiple(missing):undefined;
  const granted=names.filter((name,index)=>current[index]||decisions?.[name]==='granted').length;
  if(foreground(s)&&version===s.version)s.publish({permissions:granted===names.length?'Calendar, contacts and camera allowed':`${granted}/${names.length} permissions allowed; other tools remain available`});
 }
 async function dispatch(s:Scope){
  if(!foreground(s)||!s.enabled||!s.available||disabledBackends.has(backendKey(s.backend))||s.busy||!Number.isSafeInteger(s.chat)||(s.chat??0)<=0)return;
  const candidates=Array.isArray(pending.current)?pending.current.slice(0,100):[];
  for(const candidate of candidates){
   if(!foreground(s)||!s.enabled||!s.available||disabledBackends.has(backendKey(s.backend))||s.busy)return;
   const item=validatePhoneToolRequest(candidate);if(!item)continue;
   const attemptKey=JSON.stringify([s.backend.backendId,s.backend.endpoint,s.chat,item.id]);
   if(attempts.has(attemptKey))continue;
   if(attempts.size>=4096){s.publish({error:'Too many unresolved phone receipts. New actions are paused rather than risking a duplicate.'});return;}
   const attempt:Attempt={backend:s.backend,chat:s.chat!,id:item.id,expiresAt:item.expiresAt,api:api.current,finished:false};
   attempts.set(attemptKey,attempt);
   if(item.status==='executing'){attempt.recoverAfter=Date.now();void recover(attempt);continue;}
   const version=s.version,controller=new AbortController();s.controllers.add(controller);
   try{
    const claim=await boundedRequest(attempt.api,`chats/${s.chat}/phone-tools`,{id:item.id,action:'claim'},s.backend,controller);
    if(!foreground(s)||!s.enabled||disabledBackends.has(backendKey(s.backend))||s.busy||version!==s.version||controller.signal.aborted||item.expiresAt<=Date.now()||claim?.execute!==true){attempt.finished=true;if(claim?.execute===true||['executing','unknown'].includes(claim?.status))attempt.recoverAfter=Date.now()+25000;continue;}
    // This check and the native invocation have no await between them.
    const {status:_status,...nativeRequest}=item;
    try{attempt.result=parseResult(await native()!.execute(s.backend.backendId,JSON.stringify(nativeRequest)));}
    catch{/* An uncertain bridge completion is not a native receipt. Recover read-only later. */}
    if(attempt.result)await upload(attempt);
    else{attempt.recoverAfter=Date.now()+25000;if(foreground(s))s.publish({error:'No valid native receipt was returned. The action will not be repeated; a later refresh can recover its stored receipt.'});}
   }catch{attempt.finished=true;attempt.recoverAfter=Date.now()+25000;if(foreground(s))s.publish({error:'Phone action claim failed or was interrupted. It will not be retried.'});}
   finally{s.controllers.delete(controller);}
  }
 }
 async function refreshScope(s:Scope){
  if(!foreground(s)||s.busy)return;
  const version=++s.version;s.publish({busy:true});
  try{
   const enabled=await native()!.enabled(s.backend.backendId);
   if(!foreground(s)||version!==s.version)return;
   if(!enabled)disabledBackends.delete(backendKey(s.backend));
   s.disablePending=disabledBackends.has(backendKey(s.backend));
   s.enabled=enabled===true&&!s.disablePending;
   s.publish({enabled:s.enabled||s.disablePending,error:s.disablePending?'Disabled locally, but the saved preference needs another Disable attempt.':''});
   await permissions(s,false);
   if(!foreground(s)||version!==s.version)return;
   await availability(s,s.enabled);
  }catch{if(foreground(s)&&version===s.version){s.enabled=false;s.publish({enabled:false,error:'Could not read phone tools preference. Refresh to retry.'});}}
  finally{if(valid(s)&&version===s.version){s.publish({busy:false});void dispatch(s);}}
 }
 useEffect(()=>{
  if(!backend||!supported()){setView({key,enabled:false,busy:false,error:'',permissions:'Not available'});return;}
  const s:Scope={key,identity:renderIdentity,backend:{...backend},chat,alive:true,active:AppState.currentState==='active',enabled:false,available:false,disablePending:false,version:0,busy:false,controllers:new Set(),publish:patch=>{if(valid(s))setView(old=>({...old,...patch,key}));}};
  scope.current=s;s.publish({enabled:false,busy:false,error:'',permissions:'Not checked'});
  void refreshScope(s);reconcile();
  const listener=AppState.addEventListener('change',state=>{
   s.active=state==='active';
   if(!s.active){cancel(s);s.busy=false;s.publish({busy:false});void availability(s,false);}
   else{void refreshScope(s);reconcile();}
  });
  const timer=setInterval(()=>{if(foreground(s)){reconcile();if(s.enabled)void availability(s,true);void dispatch(s);}},25000);
  return()=>{
   s.alive=false;cancel(s);listener.remove();clearInterval(timer);
   // Availability belongs to the backend, not the chat. The replacement scope refreshes it.
   if(selectedBackend.current!==backendKey(s.backend)||selected.current===s.key)void availability(s,false);
  };
 },[key]); // API closures intentionally live in a ref, not in the scope identity.
 useEffect(()=>{const s=scope.current;if(s&&s.key===key)void dispatch(s);},[key,requests,view.enabled,view.busy]);
 async function toggle(){
  const s=scope.current;if(!s||s.identity!==renderIdentity||!foreground(s)||s.busy||!supported())return;
  const enable=!s.enabled&&!s.disablePending;s.busy=true;cancel(s);const version=s.version;s.publish({busy:true,error:''});
  // Disable dispatch immediately, before network or native preference operations complete.
  if(!enable){disabledBackends.add(backendKey(s.backend));s.enabled=false;s.disablePending=true;s.publish({enabled:true});void availability(s,false);}
  try{
   if(enable)await permissions(s,true);
   if(!foreground(s)||version!==s.version)return;
   const saved=await native()!.setEnabled(s.backend.backendId,enable);
   if(saved===false&&enable)throw Error('Phone tools could not be enabled.');
   if(!foreground(s)||version!==s.version)return;
   disabledBackends.delete(backendKey(s.backend));s.enabled=enable;s.disablePending=false;s.publish({enabled:enable});await availability(s,enable);
  }catch{if(valid(s))s.publish({error:enable?'Could not enable phone tools. Try again.':'Could not save disabled preference. Try disabling again before reopening Bob.'});}
  finally{ if(valid(s)&&version===s.version){s.busy=false;s.publish({busy:false});void dispatch(s);} }
 }
 async function refresh(){const s=scope.current;if(s&&s.identity===renderIdentity&&supported()){await refreshScope(s);if(foreground(s))reconcile();}}
 async function requestPermissions(){const s=scope.current;if(!s||s.identity!==renderIdentity||!foreground(s)||s.busy)return;s.busy=true;const version=s.version;s.publish({busy:true,error:''});try{await permissions(s,true);}catch{if(valid(s)&&version===s.version)s.publish({error:'Could not request Android permissions.'});}finally{if(valid(s)&&version===s.version){s.busy=false;s.publish({busy:false});void dispatch(s);}}}
 const current=view.key===key?view:{enabled:false,busy:false,error:'',permissions:'Not checked'};
 return {enabled:current.enabled,busy:current.busy,error:current.error,permissions:current.permissions,supported:supported(),toggle,refresh,requestPermissions};
}
export type PhoneToolsState=ReturnType<typeof usePhoneTools>;
