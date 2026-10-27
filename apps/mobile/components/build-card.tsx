import React,{useEffect,useState} from 'react';
import {ActivityIndicator,NativeModules,Pressable,StyleSheet,Text,View} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import {v4 as uuid} from 'uuid';
import {Check,ChevronDown,ChevronRight,Download,RefreshCw,X} from 'lucide-react-native';
import {activeBuild,type BuildBackend,type BuildState} from '../use-build-status';
import {colors} from '../theme';
type Request={id:string;action:'update'|'build'|'rollback';target:'android'|'all'|'backend'};
const retryable=(request:Request)=>request.action!=='rollback'&&request.target!=='backend';
export function BuildCard({backend,state,error,focus=false,onDismiss,onRefresh}:{backend:BuildBackend;state?:BuildState;error?:string;focus?:boolean;onDismiss:()=>void;onRefresh:()=>void}){
 const [busy,setBusy]=useState(false),[note,setNote]=useState(''),[failure,setFailure]=useState(''),[details,setDetails]=useState(false),[collapsed,setCollapsed]=useState(false),[request,setRequest]=useState<Request>(),[installVersion,setInstallVersion]=useState<number>(),[dismissed,setDismissed]=useState('');
 const key=`bob.update-request.${backend.backendId}`,installed=Number(NativeModules.BobFiles.versionCode??0),apk=state?.apk,job=activeBuild(state),failed=!job&&state?.jobs?.[0]?.status==='failed'?state.jobs[0]:undefined;
 const ready=!!apk&&apk.versionCode>installed,success=!!installVersion&&installed>=installVersion&&!ready;
 useEffect(()=>{let alive=true;void Promise.all([AsyncStorage.getItem(key),AsyncStorage.getItem(`pending-install:${backend.backendId}`),AsyncStorage.getItem(`build-dismissed:${backend.backendId}`)]).then(([pending,version,hide])=>{if(!alive)return;try{if(pending){const saved=JSON.parse(pending);if(typeof saved.id==='string'&&['update','build','rollback'].includes(saved.action)&&['android','all','backend'].includes(saved.target))setRequest(saved);}}catch{}setInstallVersion(version?Number(version):undefined);setDismissed(hide??'');}).catch(()=>{});return()=>{alive=false;};},[key]);
 useEffect(()=>{if(request&&state?.jobs?.some(job=>job.id===request.id)){setRequest(undefined);void AsyncStorage.removeItem(key).catch(()=>{});}},[state,request,key]);
 useEffect(()=>{if(!job&&!request)setCollapsed(false);},[job?.id,job?.status,request]);
 useEffect(()=>{if(job)setNote('');},[job?.id]);
 async function credential(){const c=await Keychain.getGenericPassword({service:`bob.${backend.backendId}`});if(!c)throw Error('Pairing credential unavailable');return c.password;}
 async function install(){
  if(!apk||busy)return;setBusy(true);setFailure('');setNote('Downloading and verifying…');
  try{await NativeModules.BobFiles.installUpdate(`${backend.endpoint}/v1/updates/${apk.releaseId}/apk`,await credential(),backend.backendId,apk.sha256,apk.size);await AsyncStorage.setItem(`pending-install:${backend.backendId}`,String(apk.versionCode));setInstallVersion(apk.versionCode);setNote('Approve installation in Android.');}
  catch(e){setNote('');setFailure(String((e as Error).message??e));}finally{setBusy(false);}
 }
 async function queue(target:'android'|'all'){
  if(busy||request&&!retryable(request))return;setBusy(true);setFailure('');const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
  try{
   const value=request??{id:'app-'+uuid(),action:'update' as const,target};await AsyncStorage.setItem(key,JSON.stringify(value));setRequest(value);
   const response=await fetch(`${backend.endpoint}/v1/updates`,{method:'POST',headers:{Authorization:'Bearer '+await credential(),'x-bob-backend':backend.backendId,'content-type':'application/json'},body:JSON.stringify(value),signal:controller.signal});
   if(!response.ok)throw Error(`Build request rejected (${response.status})`);setNote('Build queued. You can leave this chat.');onRefresh();
  }catch(e){setFailure(`${String((e as Error).message??e)}. The same request is retained; no automatic resend.`);}finally{clearTimeout(timeout);setBusy(false);}
 }
 const identity=success?`installed:${installVersion}`:failed?`failed:${failed.id}`:apk?.releaseId??'';
 const visible=focus||!!job||!!request||((ready||success||!!failed)&&dismissed!==identity);
 if(!visible)return null;
 const dismiss=()=>{if(job||request){setCollapsed(value=>!value);return;}setDismissed(identity);void AsyncStorage.setItem(`build-dismissed:${backend.backendId}`,identity).catch(()=>{});if(success)void AsyncStorage.removeItem(`pending-install:${backend.backendId}`).catch(()=>{});onDismiss();};
 return <View style={s.card}>
  <View style={s.header}>{job||request||busy?<ActivityIndicator color={colors.accent}/>:success?<Check size={21} color={colors.accent}/>:<Download size={21} color={colors.muted}/>}<View style={{flex:1,gap:4}}><Text style={s.label}>App update · {backend.name}</Text><Text style={s.title}>{job?'Building update':request?'Build requested':failed?'Build needs attention':success?`App ${NativeModules.BobFiles.versionName} installed`:ready?`App ${apk!.versionName} ready`:state?.enabled===false?'Build service unavailable':'Build & install'}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={job||request?(collapsed?'Expand build card':'Collapse build card'):'Dismiss build card'} onPress={dismiss} style={s.icon}>{job||request?(collapsed?<ChevronRight size={20} color={colors.muted}/>:<ChevronDown size={20} color={colors.muted}/>):<X size={20} color={colors.muted}/>}</Pressable></View>
  {!collapsed&&<View style={s.body}>
   {!!job&&<Text accessibilityLiveRegion="polite" style={s.text}>{job.stage}</Text>}
   {!job&&!!failed&&<Text style={s.text}>{failed.error&&failed.error.length>260&&!details?failed.error.slice(0,260)+'…':failed.error??failed.stage}</Text>}
   {!!request&&!retryable(request)&&<Text style={s.text}>A previous {request.action} request is retained. Refresh to check its recorded result; it will not be resent from this card.</Text>}
   {!!note&&<Text style={s.text}>{note}</Text>}{!!failure&&<Text style={s.text}>{failure}</Text>}
   {!!error&&<Text style={s.text}>Status unavailable · {error}</Text>}
   {ready&&!job&&!request&&<Pressable accessibilityRole="button" accessibilityLabel={`Install ${apk!.versionName}`} disabled={busy} onPress={()=>void install()} style={[s.primary,busy&&{opacity:0.5}]}><Download size={18} color={colors.onAccent}/><Text style={s.primaryText}>{busy?'Please wait…':`Install ${apk!.versionName}`}</Text></Pressable>}
   {(focus||!!failed)&&<><Pressable accessibilityRole="button" accessibilityLabel="Build options" accessibilityState={{expanded:details}} onPress={()=>setDetails(value=>!value)} style={s.option}><Text style={s.text}>Build options</Text>{details?<ChevronDown size={17} color={colors.muted}/>:<ChevronRight size={17} color={colors.muted}/>}</Pressable>{details&&<View style={{gap:8}}><Pressable accessibilityRole="button" accessibilityLabel={request?'Retry same build request':'Build app'} disabled={busy||!!job||!state?.enabled||!!request&&!retryable(request)} onPress={()=>void queue('android')} style={s.secondary}><Text style={s.text}>{request?'Retry same build request':'Build app'}</Text></Pressable>{!request&&<Pressable accessibilityRole="button" accessibilityLabel="Build app and backend" disabled={busy||!!job||!state?.enabled||!!request&&!retryable(request)} onPress={()=>void queue('all')} style={s.secondary}><Text style={s.text}>Build app & backend</Text></Pressable>}</View>}</>}
   {(focus||!!failure||!!error)&&<Pressable accessibilityRole="button" accessibilityLabel="Refresh build status" onPress={onRefresh} style={s.option}><RefreshCw size={16} color={colors.muted}/><Text style={s.label}>Refresh</Text></Pressable>}
  </View>}
 </View>;
}
const s=StyleSheet.create({card:{borderRadius:18,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,overflow:'hidden'},header:{padding:14,flexDirection:'row',alignItems:'center',gap:12},label:{fontSize:12,lineHeight:18,color:colors.muted},title:{fontSize:16,lineHeight:23,color:colors.foreground,fontWeight:'500'},icon:{width:44,height:44,alignItems:'center',justifyContent:'center'},body:{paddingHorizontal:14,paddingBottom:14,gap:12},text:{fontSize:14,lineHeight:21,color:colors.body},primary:{minHeight:48,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10,borderRadius:24,backgroundColor:colors.accent},primaryText:{fontSize:16,color:colors.onAccent,fontWeight:'600'},option:{minHeight:44,flexDirection:'row',alignItems:'center',gap:8},secondary:{minHeight:48,borderRadius:16,padding:12,backgroundColor:colors.subtle,justifyContent:'center'}});
