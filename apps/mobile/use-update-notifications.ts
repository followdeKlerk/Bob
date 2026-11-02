import {useEffect,useRef} from 'react';
import {AppState,NativeModules,PermissionsAndroid,Platform} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
type Backend={backendId:string;endpoint:string;name:string};
export async function enableUpdateNotifications(backends:Backend[],askPermission=true,onRegistered?:(backendId:string)=>Promise<void>){
 if(Platform.OS!=='android'||!backends.length||AppState.currentState!=='active')return false;
 await NativeModules.BobNotifications.syncPushBackends?.(backends.map(backend=>backend.backendId));
 // Activation also reconciles deregistration when Android permission was revoked.
 // Native WorkManager retries registration without blocking pairing or the UI.
 for(const backend of backends){
  const credential=await Keychain.getGenericPassword({service:`bob.${backend.backendId}`});
  if(credential)try{await NativeModules.BobNotifications.activatePush?.(backend.endpoint,backend.backendId,credential.password);}catch{/* Retry on the next activation. */}
 }
 if(Number(Platform.Version)>=33){
  const permission=PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  if(!await PermissionsAndroid.check(permission)){
   if(!askPermission)return false;
   if(await PermissionsAndroid.request(permission)!=='granted')return false;
   // A pre-dialog worker may already have completed DELETE while permission was
   // denied. Reconcile after the grant, not only on a future app activation.
   for(const backend of backends){
    const credential=await Keychain.getGenericPassword({service:`bob.${backend.backendId}`});
    if(credential)try{await NativeModules.BobNotifications.activatePush?.(backend.endpoint,backend.backendId,credential.password);}catch{/* Polling still works; retry registration on resume. */}
   }
  }
 }
 let watching=false;
 for(const backend of backends){
  const credential=await Keychain.getGenericPassword({service:`bob.${backend.backendId}`});
  if(credential){await NativeModules.BobNotifications.watchUpdates(backend.endpoint,backend.backendId,credential.password,backend.name);await onRegistered?.(backend.backendId);watching=true;}
 }
 return watching;
}
/** Keep update-ready monitoring independent of individual chat requests and any open build card. */
export function useUpdateNotifications(backends:Backend[],onRegistered?:(backendId:string)=>Promise<void>){
 const registered=useRef(onRegistered);registered.current=onRegistered;
 useEffect(()=>{
  let stopped=false,running=false;
  async function sync(){
   if(stopped||running||!backends.length||AppState.currentState!=='active')return;
   running=true;
   try{
    const asked=await AsyncStorage.getItem('update-notification-permission-asked');
    if(!asked)await AsyncStorage.setItem('update-notification-permission-asked','true');
    if(!stopped)await enableUpdateNotifications(backends,!asked,async id=>{if(!stopped)await registered.current?.(id);});
   }catch{/* Android notification settings can restore permission; the next resume registers monitoring again. */}
   finally{running=false;}
  }
  void sync();const listener=AppState.addEventListener('change',state=>{if(state==='active')void sync();});
  return()=>{stopped=true;listener.remove();};
 },[backends]);
}
