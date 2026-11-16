import React,{useEffect,useRef,useState} from 'react';
import {ActivityIndicator,AppState,NativeModules,Pressable,StyleSheet,View} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import {v4 as uuid} from 'uuid';
import {Check,Download,AlertCircle} from 'lucide-react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {activeBuild,type BuildBackend,type BuildState} from '../use-build-status';
import {themed,useTheme,useThemedValue} from '../theme';
import {Text} from './app-text';
import {UpdatePopover} from './update-popover';

type Request={id:string;action:'update'|'build'|'rollback';target:'android'|'all'|'backend'};
type Props={backend:BuildBackend;state?:BuildState;error?:string;focus?:boolean;active?:boolean;keyboardInset?:number;onDismiss:()=>void;onRefresh:()=>void};
const retryable=(request:Request)=>request.action!=='rollback'&&request.target!=='backend';
const foreground=()=>AppState.currentState!=='background'&&AppState.currentState!=='inactive';

// One app-wide owner, outside retained transcripts. A transport identity change
// retires all async ownership; persisted uncertain requests retain their IDs.
export function BuildCard(props:Props){return <UpdateController key={JSON.stringify([props.backend.backendId,props.backend.endpoint])} {...props}/>;}
function UpdateController({backend,state,error,focus=false,active=true,keyboardInset=0,onDismiss,onRefresh}:Props){
 const {colors}=useTheme(),s=useThemedValue(styles),insets=useSafeAreaInsets();
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[failure,setFailure]=useState('');
 const [request,setRequest]=useState<Request>(),[installVersion,setInstallVersion]=useState<number>(),[dismissed,setDismissed]=useState(''),[loaded,setLoaded]=useState(false);
 const [downloadState,setDownloadState]=useState('checking');
 const mounted=useRef(true),admission=useRef(false),pollReceipt=useRef(0),epoch=useRef(0);
 const key=`bob.update-request.${backend.backendId}`,apk=state?.apk,job=activeBuild(state);
 const installed=Number(NativeModules.BobFiles?.versionCode??0),installedKnown=Number.isSafeInteger(installed)&&installed>0;
 const newer=installedKnown&&!!apk&&Number.isSafeInteger(apk.versionCode)&&apk.versionCode>installed;
 const success=installedKnown&&!!installVersion&&installed>=installVersion&&!newer;
 const failed=!job&&state?.jobs?.[0]?.status==='failed'?state.jobs[0]:undefined;
 const serviceAvailable=state?.enabled===true&&state.supervisorOnline!==false&&!error;
 const canBuild=serviceAvailable&&state?.androidBuild?.configured!==false;
 const unavailable=error?'Update status unavailable':state?.enabled===false?'Updates not configured':state?.enabled&&state.supervisorOnline===false?'Update supervisor offline':!state?'Checking update status…':undefined;
 const versionUnavailable=!!apk&&!installedKnown;
 const artifactScope=JSON.stringify([backend.backendId,backend.endpoint,apk?.releaseId,apk?.sha256,apk?.size,apk?.versionCode]);
 const scope=useRef(artifactScope);scope.current=artifactScope;
 const capability=useRef({install:false,queue:false});
 const downloading=['downloading','busy','verifying'].includes(downloadState);
 capability.current={install:serviceAvailable&&newer&&!job&&!request,queue:canBuild&&!job&&!downloading};
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;pollReceipt.current++;epoch.current++;};},[]);
 useEffect(()=>{if(focus)setOpen(true);},[focus]);
 useEffect(()=>{if(!active)setOpen(false);},[active]);
 useEffect(()=>{
  let alive=true;
  void Promise.all([AsyncStorage.getItem(key),AsyncStorage.getItem(`pending-install:${backend.backendId}`),AsyncStorage.getItem(`build-dismissed:${backend.backendId}`)]).then(([pending,version,hide])=>{
   if(!alive)return;
   try{if(pending){const value=JSON.parse(pending);if(typeof value.id==='string'&&['update','build','rollback'].includes(value.action)&&['android','all','backend'].includes(value.target))setRequest(value);}}catch{}
   setInstallVersion(version?Number(version):undefined);setDismissed(hide??'');setLoaded(true);
  }).catch(()=>{if(alive){setFailure('Device update history unavailable. Reopen Bob before starting a build.');}});
  return()=>{alive=false;};
 },[key,backend.backendId]);
 useEffect(()=>{
  if(request&&state?.jobs?.some(value=>value.id===request.id)){
   setRequest(undefined);void AsyncStorage.removeItem(key).catch(()=>{});
  }
 },[state,request,key]);
 useEffect(()=>{
  let alive=true,timer:ReturnType<typeof setInterval>|undefined,inFlight:number|undefined;
  setDownloadState('checking');setFailure('');pollReceipt.current++;
  async function read(){
   if(!alive||inFlight!==undefined||!foreground()||admission.current||!newer||!apk||!serviceAvailable)return;
   const ticket=++pollReceipt.current;inFlight=ticket;
   const current=()=>alive&&foreground()&&scope.current===artifactScope&&ticket===pollReceipt.current;
   try{
    if(typeof NativeModules.BobFiles?.getUpdateStatus!=='function')throw Error('unsupported');
    const value=await NativeModules.BobFiles.getUpdateStatus(apk.sha256,apk.size);
    if(!current())return;
    const next=['idle','downloading','verifying','busy','ready','failed'].includes(value?.state)?value.state:'unknown';
    setDownloadState(next);
    // Native text is not a UI instruction source. Present our bounded state copy.
    if(next==='ready'){setInstallVersion(apk.versionCode);void AsyncStorage.setItem(`pending-install:${backend.backendId}`,String(apk.versionCode)).catch(()=>{});}
   }catch{if(current())setDownloadState('unknown');}
   finally{if(inFlight===ticket)inFlight=undefined;}
  }
  function stop(){if(timer!==undefined)clearInterval(timer);timer=undefined;inFlight=undefined;pollReceipt.current++;}
  function start(){stop();void read();timer=setInterval(()=>void read(),1500);}
  if(foreground())start();
  const listener=AppState.addEventListener('change',value=>{epoch.current++;if(value==='active')start();else stop();});
  return()=>{alive=false;stop();listener.remove();};
 },[artifactScope,newer,serviceAvailable]);
 async function credential(){const value=await Keychain.getGenericPassword({service:`bob.${backend.backendId}`});if(!value)throw Error('Pairing credential unavailable');return value.password;}
 async function install(){
  if(!active||!foreground()||!loaded||!newer||!apk||!serviceAvailable||admission.current||downloading||job||request||!['idle','ready','failed'].includes(downloadState))return;
  admission.current=true;pollReceipt.current++;setBusy(true);setFailure('');
  const ownedScope=artifactScope,ownedEpoch=epoch.current;
  const current=()=>mounted.current&&scope.current===ownedScope&&epoch.current===ownedEpoch&&foreground()&&capability.current.install;
  try{
   const token=await credential();if(!current())return;
   const value=await NativeModules.BobFiles.installUpdate(`${backend.endpoint}/v1/updates/${apk.releaseId}/apk`,token,backend.backendId,apk.sha256,apk.size);
   if(!current())return;
   const next=['idle','downloading','verifying','busy','ready','failed'].includes(value?.state)?value.state:'unknown';setDownloadState(next);
   if(next==='ready'){setInstallVersion(apk.versionCode);void AsyncStorage.setItem(`pending-install:${backend.backendId}`,String(apk.versionCode)).catch(()=>{});}
  }catch{if(current()){setDownloadState('failed');setFailure('');}}
  finally{admission.current=false;if(mounted.current)setBusy(false);}
 }
 async function queue(target:'android'|'all'){
  if(!active||!foreground()||!loaded||!canBuild||admission.current||downloading||job||request&&!retryable(request))return;
  admission.current=true;setBusy(true);setFailure('');
  const ownedScope=artifactScope,ownedEpoch=epoch.current;
  const current=()=>mounted.current&&scope.current===ownedScope&&epoch.current===ownedEpoch&&foreground()&&capability.current.queue;
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
  let persisted=false;
  try{
   const value=request??{id:'app-'+uuid(),action:'update' as const,target};
   // Write before POST: an uncertain admission must never get a new request ID.
   await AsyncStorage.setItem(key,JSON.stringify(value));persisted=true;if(mounted.current)setRequest(value);if(!current())return;
   const token=await credential();if(!current())return;
   const response=await fetch(`${backend.endpoint}/v1/updates`,{method:'POST',headers:{Authorization:'Bearer '+token,'x-bob-backend':backend.backendId,'content-type':'application/json'},body:JSON.stringify(value),signal:controller.signal});
   if(!current())return;
   if(!response.ok)throw Error('rejected');onRefresh();
  }catch{if(current())setFailure(persisted?'':'Could not save the build request. No build was sent.');}
  finally{clearTimeout(timeout);admission.current=false;if(mounted.current)setBusy(false);}
 }
 const showBuildFailure=!!failed&&!job&&!request&&!success&&(!newer||!['downloading','verifying','busy','ready'].includes(downloadState));
 const status=(()=>{
  if(unavailable)return unavailable;
  if(job)return job.status==='queued'?'Update queued':job.status==='activating'?'Activating update…':'Building update…';
  if(request)return 'Build result not confirmed';
  if(busy)return 'Starting update…';
  if(success)return `App ${NativeModules.BobFiles?.versionName??''} installed`;
  if(versionUnavailable)return 'Installed app version unavailable';
  if(showBuildFailure)return 'Build needs attention';
  if(newer){
   if(downloadState==='busy')return 'Another update is downloading';
   if(downloadState==='downloading')return 'Downloading & verifying…';
   if(downloadState==='verifying')return 'Verifying update…';
   if(downloadState==='ready')return `App ${apk!.versionName} ready to install`;
   if(downloadState==='failed')return 'Download needs attention';
   if(downloadState==='idle')return `App ${apk!.versionName} available`;
   return downloadState==='unknown'?'Downloaded update status unavailable':'Checking downloaded update…';
  }
  return state?.androidBuild?.configured===false?'App builds not configured':'No app update available';
 })();
 const identity=success?`installed:${installVersion}`:unavailable?`unavailable:${unavailable}`:versionUnavailable?'version-unavailable':showBuildFailure?`failed:${failed!.id}`:newer?`${artifactScope}:${downloadState}`:'';
 const working=!!job||!!request||busy||downloading;
 // Dismissal belongs to the terminal receipt, not to a later explicit attempt.
 useEffect(()=>{if(working&&dismissed){setDismissed('');void AsyncStorage.removeItem(`build-dismissed:${backend.backendId}`).catch(()=>{});}},[working,dismissed,backend.backendId]);
 const restoringDismissedArtifact=!working&&downloadState==='checking'&&dismissed.startsWith(`${artifactScope}:`);
 const visible=active&&loaded&&!restoringDismissedArtifact&&(working||!!focus||((!!unavailable||newer||success||!!failed||versionUnavailable)&&dismissed!==identity));
 const close=()=>{setOpen(false);onDismiss();};
 const dismiss=()=>{if(working)return;setDismissed(identity);void AsyncStorage.setItem(`build-dismissed:${backend.backendId}`,identity).catch(()=>{});if(success)void AsyncStorage.removeItem(`pending-install:${backend.backendId}`).catch(()=>{});close();};
 function action(label:string,onPress:()=>void,disabled=false,primary=false){return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={[s.action,primary&&s.primary,disabled&&s.disabled]}><Text style={[s.text,primary&&s.primaryText]}>{label}</Text></Pressable>;}
 const installable=newer&&!unavailable&&!job&&!request&&!versionUnavailable&&(!showBuildFailure||focus);
 const terminal=success||!!unavailable||versionUnavailable||showBuildFailure||['failed','unknown'].includes(downloadState);
 const attention=!!unavailable||versionUnavailable||!!failed||downloadState==='failed'||downloadState==='unknown'||!!request;
 return <>
  {visible&&<View pointerEvents="box-none" testID="update-indicator-anchor" style={[s.anchor,{top:insets.top+4,right:insets.right+8}]}><Pressable accessibilityRole="button" accessibilityLabel="App update status" accessibilityHint="Open update details" accessibilityValue={{text:status}} accessibilityState={{expanded:open&&active}} onPress={()=>setOpen(true)} style={s.hitTarget}><View accessible={false} importantForAccessibility="no-hide-descendants" style={s.circle}>{working?<ActivityIndicator size="small" color={colors.accent}/>:success?<Check size={14} color={colors.accent}/>:attention?<AlertCircle size={14} color={colors.foreground}/>:<Download size={14} color={colors.foreground}/>}</View></Pressable></View>}
  <UpdatePopover visible={open&&active} status={status} onClose={close} keyboardInset={keyboardInset}>
   {!!unavailable&&<Text style={s.text}>{state?.enabled===false?'Set up supervised updates on the backend with bob updates install --help.':state?.supervisorOnline===false&&!error?'Check the backend update service. Build and install are paused.':'Last known status may be stale. Check again before building or installing.'}</Text>}
   {!unavailable&&versionUnavailable&&<Text style={s.text}>Fully close and reopen Bob to read the installed app version. Installation is paused.</Text>}
   {!unavailable&&!!job&&<Text style={s.text}>{job.stage}</Text>}
   {!unavailable&&!!request&&<Text style={s.text}>{retryable(request)?'Check for the recorded result first. Retry only resends this same request ID.':'This request is retained and will not be resent here. Check its recorded result.'}</Text>}
   {!unavailable&&showBuildFailure&&<Text style={s.text}>{(failed!.error??failed!.stage).slice(0,260)}</Text>}
   {!unavailable&&!job&&!request&&!showBuildFailure&&newer&&downloadState==='failed'&&<Text style={s.text}>Download or verification stopped. Nothing was installed; no automatic retry.</Text>}
   {!unavailable&&!job&&!request&&!showBuildFailure&&newer&&['checking','unknown'].includes(downloadState)&&<Text style={s.text}>Downloaded update status is not confirmed. Check again; nothing will be downloaded automatically.</Text>}
   {!unavailable&&!job&&!request&&!showBuildFailure&&newer&&downloading&&<Text style={s.text}>You can close this bubble. The background download is not cancelled.</Text>}
   {!unavailable&&!job&&!request&&!showBuildFailure&&newer&&downloadState==='ready'&&<Text style={s.text}>Verified download. Android still asks you to approve installation.</Text>}
   {!!failure&&failure!==status&&<Text accessibilityRole="alert" style={s.text}>{failure}</Text>}
   {installable&&['idle','ready','failed'].includes(downloadState)&&action(downloadState==='ready'?`Install ${apk!.versionName}`:downloadState==='failed'?'Retry download':`Download ${apk!.versionName}`,()=>void install(),busy||downloading,true)}
   {(!!unavailable||!!request||showBuildFailure||!job&&!request&&newer&&['checking','unknown'].includes(downloadState))&&action('Check status',onRefresh,busy)}
   {focus&&<>
    {state?.androidBuild?.configured===false&&<Text style={s.text}>App build/signing prerequisites are not configured on this backend.</Text>}
    {request?action('Retry same build request',()=>void queue('android'),!loaded||!canBuild||busy||downloading||!!job||!retryable(request)): <>{action('Build app',()=>void queue('android'),!loaded||!canBuild||busy||downloading||!!job)}{action('Build app and backend',()=>void queue('all'),!loaded||!canBuild||busy||downloading||!!job)}</>}
   </>}
   {!working&&terminal&&!!identity&&action(success?'Acknowledge update':'Dismiss update',dismiss)}
  </UpdatePopover>
 </>;
}
const styles=themed(({colors})=>StyleSheet.create({
 anchor:{position:'absolute',zIndex:35},hitTarget:{width:48,height:48,alignItems:'center',justifyContent:'center'},
 circle:{width:26,height:26,borderRadius:13,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,alignItems:'center',justifyContent:'center'},
 text:{fontSize:14,lineHeight:22,color:colors.body},action:{minHeight:48,paddingHorizontal:12,paddingVertical:12,borderRadius:14,borderWidth:1,borderColor:colors.border,alignItems:'center',justifyContent:'center'},
 primary:{backgroundColor:colors.accent,borderColor:colors.accent},primaryText:{color:colors.onAccent,fontWeight:'600'},disabled:{opacity:0.5},
}));
