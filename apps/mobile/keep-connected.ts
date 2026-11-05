import {useEffect,useRef,useState} from 'react';
import {AppState,NativeModules,PermissionsAndroid,Platform} from 'react-native';
import * as Keychain from 'react-native-keychain';

type Backend={backendId:string;endpoint:string;name:string};
type NativeState={enabled:boolean;running:boolean;status:'off'|'connecting'|'connected'|'reconnecting'|'attention';batteryRestricted:boolean;error?:string};
type NativeConnection={select:(backendId:string,chat:number)=>Promise<void>;start:(endpoint:string,backendId:string,token:string,chat:number,allowEnable:boolean)=>Promise<unknown>;stop:(backendId:string)=>Promise<void>;state:(backendId:string)=>Promise<string>;openBatterySettings:()=>Promise<unknown>};
const bridge=()=>NativeModules.BobConnection as NativeConnection|undefined;
const available=()=>Platform.OS==='android'&&!!bridge()?.select&&!!bridge()?.start&&!!bridge()?.stop&&!!bridge()?.state;
const initial:NativeState={enabled:false,running:false,status:'off',batteryRestricted:true};
const errors:Record<string,string>={notifications:'Allow Bob notifications and its Keep connected channel in Android settings.',authorization:'The pairing was rejected. Pair this phone again.', 'backend-update':'This backend needs the matching Bob update before Keep connected can work.',identity:'The connection identity did not match. Turn Keep connected off and pair again.',protocol:'The backend returned an invalid connection response. Turn Keep connected off and update Bob.',start:'Android could not start Keep connected. Leave Bob open and try again.'};
function parse(raw:string):NativeState{
 const value:unknown=JSON.parse(raw);
 if(!value||typeof value!=='object')throw Error('Invalid connection state');
 const state=value as Record<string,unknown>;
 if(typeof state.enabled!=='boolean'||typeof state.running!=='boolean'||typeof state.batteryRestricted!=='boolean'||!['off','connecting','connected','reconnecting','attention'].includes(state.status as string))throw Error('Invalid connection state');
 return {enabled:state.enabled,running:state.running,status:state.status as NativeState['status'],batteryRestricted:state.batteryRestricted,error:typeof state.error==='string'?errors[state.error]:undefined};
}
export type KeepConnectedState=NativeState&{busy:boolean;error:string;supported:boolean;canEnable:boolean;toggle:()=>Promise<void>;refresh:()=>Promise<void>;openBatterySettings:()=>Promise<void>};
type View=NativeState&{key:string;busy:boolean;error:string};
type Scope={key:string;identity:object;backend:Backend;chat?:number;alive:boolean;active:boolean;refreshing:boolean;busy:boolean;version:number};
/** Native owns its read-only background stream. This hook never changes phone-tool
 * availability, starts headless JS or resends a pending owner action. */
export function useKeepConnected(backend?:Backend,chat?:number,visible=false):KeepConnectedState{
 const key=JSON.stringify([backend?.backendId,backend?.endpoint,chat]),supported=available();
 const selected=useRef({key});if(selected.current.key!==key)selected.current={key};
 const identity=selected.current,scope=useRef<Scope|undefined>(undefined);
 const [view,setView]=useState<View>({...initial,key:'',busy:false,error:''});
 const valid=(s:Scope)=>s.alive&&scope.current===s&&selected.current===s.identity;
 const foreground=(s:Scope)=>valid(s)&&s.active&&AppState.currentState==='active';
 const publish=(s:Scope,state:Partial<View>)=>{if(valid(s))setView(previous=>({...initial,busy:false,error:'',...(previous.key===s.key?previous:{}),...state,key:s.key}));};
 async function read(s:Scope,version=s.version){const result=parse(await bridge()!.state(s.backend.backendId));if(s.version===version)publish(s,{...result,error:result.error??(result.status==='attention'?'Connection needs attention. Turn it off and enable it again while Bob is open.':'')});return result;}
 async function refreshScope(s:Scope,reconcile=false){
  if(!foreground(s)||s.busy||s.refreshing)return;
  s.refreshing=true;const version=s.version;
  try{
   const state=await read(s,version);
   if(s.version!==version||!foreground(s)||!s.chat||!state.enabled||(state.running&&!reconcile)||state.status==='attention')return;
   const auth=await Keychain.getGenericPassword({service:`bob.${s.backend.backendId}`});
   if(!foreground(s)||s.version!==version)return;
   if(!auth){publish(s,{error:'Pair this phone with the backend again to resume Keep connected.'});return;}
   // Native rechecks selection and saved opt-in: a delayed credential lookup
   // cannot undo the notification's Turn off action or a backend/chat switch.
   await bridge()!.start(s.backend.endpoint,s.backend.backendId,auth.password,s.chat,false);
   if(valid(s)&&s.version===version)await read(s,version);
  }catch{if(s.version===version)publish(s,{error:'Could not resume Keep connected. Check Android permissions or turn it off and on again.'});}
  finally{s.refreshing=false;}
 }
 useEffect(()=>{
  if(!supported)return;
  const s:Scope|undefined=backend?{key,identity,backend,chat:chat&&Number.isSafeInteger(chat)&&chat>0?chat:undefined,alive:true,active:AppState.currentState==='active',refreshing:false,busy:true,version:0}:undefined;
  scope.current=s;
  let cancelled=false;
  const ready=(async()=>{
   try{
    await bridge()!.select(s?.chat?s.backend.backendId:'',s?.chat??0);
    if(s&&valid(s)){await read(s);s.busy=false;publish(s,{busy:false});await refreshScope(s,true);}
   }catch{if(s){s.busy=false;publish(s,{busy:false,error:'Could not load background connection settings. Reopen Bob to retry.'});}}
  })();
  if(s)publish(s,{busy:true});
  const listener=AppState.addEventListener('change',state=>{if(!s)return;s.active=state==='active';if(s.active)void ready.then(()=>{if(!cancelled)void refreshScope(s,true);});});
  const focus=AppState.addEventListener('focus',()=>{if(s&&AppState.currentState==='active')void ready.then(()=>{if(!cancelled)void refreshScope(s,true);});});
  // Do not stop a native owner-enabled connection just because React unmounts.
  // A new selection explicitly retires the old socket; disabling does so below.
  return()=>{cancelled=true;if(s)s.alive=false;listener.remove();focus.remove();};
 },[key,supported]);
 useEffect(()=>{
  if(!visible||!supported)return;
  const refresh=()=>{const s=scope.current;if(s)void refreshScope(s);};
  refresh();const timer=setInterval(refresh,3000);return()=>clearInterval(timer);
 },[visible,key,supported]);
 async function toggle(){
  const s=scope.current;if(!s||s.identity!==identity||!foreground(s)||s.busy)return;
  // Honor the currently visible action, not a preference reread after a delay.
  const disable=view.key===s.key&&view.enabled;
  if(!disable&&(!s.chat||s.refreshing))return;
  s.version++;s.busy=true;publish(s,{busy:true,error:''});
  try{
   if(disable)await bridge()!.stop(s.backend.backendId);
   else{
    if(Number(Platform.Version)>=33){
     const permission=PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
     if(!await PermissionsAndroid.check(permission)&&await PermissionsAndroid.request(permission)!==PermissionsAndroid.RESULTS.GRANTED)throw Error('notification-permission');
    }
    // Android permission dialogs can briefly pause the Activity. Never start an
    // FGS while locked/backgrounded or after its owner has selected another scope.
    for(let n=0;valid(s)&&AppState.currentState!=='active'&&n<30;n++)await new Promise<void>(resolve=>setTimeout(resolve,50));
    if(!foreground(s))return;
    const auth=await Keychain.getGenericPassword({service:`bob.${s.backend.backendId}`});
    if(!foreground(s))return;
    if(!auth)throw Error('credential');
    await bridge()!.start(s.backend.endpoint,s.backend.backendId,auth.password,s.chat!,true);
   }
   if(valid(s))await read(s);
  }catch{publish(s,{error:disable?'Could not turn off Keep connected. Reopen Bob and try again.':'Could not enable Keep connected. Allow notifications, check pairing and keep Bob open while enabling it.'});}
  finally{s.busy=false;publish(s,{busy:false});}
 }
 async function refresh(){const s=scope.current;if(s?.identity===identity)await refreshScope(s);}
 async function openBatterySettings(){try{await bridge()?.openBatterySettings();}catch{const s=scope.current;if(s)publish(s,{error:'Open Android Settings → Apps → Bob → Battery and allow unrestricted background use.'});}}
 const state=view.key===key?view:{...initial,busy:supported&&!!backend,error:''};
 return {...state,error:state.error??'',supported,canEnable:!!backend&&!!chat&&Number.isSafeInteger(chat)&&chat>0,toggle,refresh,openBatterySettings};
}
