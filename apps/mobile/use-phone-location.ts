import {useEffect,useRef,useState} from 'react';
import {AppState,NativeModules,PermissionsAndroid,Platform} from 'react-native';
import * as Keychain from 'react-native-keychain';
type Backend={backendId:string;endpoint:string;name:string};
async function credential(backend:Backend){return Keychain.getGenericPassword({service:`bob.${backend.backendId}`});}
export async function startPhoneLocation(backend:Backend,askPermission:boolean){
 const native=NativeModules.BobLocation;
 if(Platform.OS!=='android'||!native)throw Error('Automatic phone location requires the updated Android app.');
 const auth=await credential(backend);if(!auth)throw Error('Pair this phone with the backend first.');
 const coarse=PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,fine=PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
 if(!await PermissionsAndroid.check(coarse)&&!await PermissionsAndroid.check(fine)){
  if(!askPermission)throw Error('Location permission was removed.');
  const result=await PermissionsAndroid.requestMultiple([fine,coarse]);
  if(result[fine]!=='granted'&&result[coarse]!=='granted')throw Error('Allow Android location access to enable automatic location. Approximate access is supported; precise gives better nearby results.');
 }
 if(Number(Platform.Version)>=33){
  const notification=PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  if(!await PermissionsAndroid.check(notification)){
   if(!askPermission||await PermissionsAndroid.request(notification)!=='granted')throw Error('Allow Bob notifications so the background location service stays visible.');
  }
 }
 // Runtime permission dialogs can briefly pause the app. Never start a location FGS from the background.
 for(let count=0;AppState.currentState!=='active'&&count<30;count++)await new Promise<void>(resolve=>setTimeout(()=>resolve(),50));
 if(AppState.currentState!=='active')throw Error('Keep Bob open while enabling automatic location.');
 await native.start(backend.endpoint,backend.backendId,auth.password,askPermission);
}
export async function stopPhoneLocation(backend:Backend){
 let token='';try{const auth=await credential(backend);if(auth)token=auth.password;}catch{/* Local Stop must work even if the credential store is unavailable. */}
 await NativeModules.BobLocation?.stop(backend.endpoint,backend.backendId,token);
}
export function usePhoneLocation(backend?:Backend){
 const [state,setState]=useState({id:'',enabled:false,error:''}),[busy,setBusy]=useState(false);
 const toggling=useRef(false);
 const selected=useRef(backend?.backendId);selected.current=backend?.backendId;
 useEffect(()=>{
  if(!backend||!NativeModules.BobLocation)return;let cancelled=false,running=false;
  async function refresh(){
   if(cancelled||running||AppState.currentState!=='active')return;running=true;
   try{
    const enabled=await NativeModules.BobLocation.enabled(backend!.backendId);
    if(enabled&&!cancelled)await startPhoneLocation(backend!,false);
    const current=await NativeModules.BobLocation.enabled(backend!.backendId);
    if(!cancelled)setState({id:backend!.backendId,enabled:!!current,error:''});
   }catch{if(!cancelled)setState({id:backend!.backendId,enabled:true,error:'Location needs attention. Check Android permissions or disable and enable it again.'});}
   finally{running=false;}
  }
  void refresh();const listener=AppState.addEventListener('change',value=>{if(value==='active')void refresh();});
  const focus=AppState.addEventListener('focus',()=>void refresh());
  return()=>{cancelled=true;listener.remove();focus.remove();};
 },[backend?.backendId,backend?.endpoint]);
 async function toggle(){
  if(!backend||toggling.current)return;toggling.current=true;setBusy(true);const target=backend;
  try{
   // Honor the visible button action: a stale Disable label must never turn into Enable.
   const enabled=state.id===target.backendId&&state.enabled;
   if(enabled)await stopPhoneLocation(target);else await startPhoneLocation(target,true);
   if(selected.current===target.backendId)setState({id:target.backendId,enabled:!enabled,error:''});
  }finally{toggling.current=false;setBusy(false);}
 }
 return {enabled:state.id===backend?.backendId&&state.enabled,error:state.id===backend?.backendId?state.error:'',busy,toggle,supported:Platform.OS==='android'&&!!NativeModules.BobLocation};
}
