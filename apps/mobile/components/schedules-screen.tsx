import React,{useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Alert,AppState,FlatList,Pressable,StyleSheet,View} from 'react-native';
import {Clock3,Plus,RefreshCw} from 'lucide-react-native';
import {v4 as uuid} from 'uuid';
import {Text} from './app-text';
import {RoundAction,sectionStyles} from './section-ui';
import {colors} from '../theme';

export type ScheduleJob={id:string;revision:number;conversationId:number;title:string;kind:'reminder'|'check';text:string;timezone:string;firstRunAt:number;intervalMs?:number;maxRuns:number;stopOnMatch:boolean;state:'active'|'paused'|'finished'|'cancelled';nextRunAt?:number;runs:number;health?:string;history:{number:number;dueAt:number;startedAt:number;finishedAt?:number;outcome:string;message?:string;lateByMs:number}[]};
export function scheduleTime(at:number|undefined,zone:string){if(at===undefined)return '—';try{return new Intl.DateTimeFormat(undefined,{timeZone:zone,month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}).format(at);}catch{return new Date(at).toISOString();}}
export function scheduleFrequency(job:ScheduleJob){
 if(!job.intervalMs)return 'One-off';
 const seconds=job.intervalMs/1000,[count,unit]=seconds%86400===0?[seconds/86400,'day']:seconds%3600===0?[seconds/3600,'hour']:seconds%60===0?[seconds/60,'minute']:[seconds,'second'];
 return `Every ${count} ${unit}${count===1?'':'s'} (elapsed)`;
}
function Action({label,onPress,disabled=false}:{label:string;onPress:()=>void;disabled?:boolean}){return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={[s.action,disabled&&{opacity:0.4}]}><Text style={s.actionText}>{label}</Text></Pressable>;}
export function ScheduleReceipt({job,onOpen}:{job?:ScheduleJob;onOpen:()=>void}){
 return <Pressable accessibilityRole="button" accessibilityLabel={job?`View schedule ${job.title}`:'View schedules'} onPress={onOpen} style={s.receipt}><View style={{flexDirection:'row',gap:10,alignItems:'center'}}><Clock3 size={20} color={colors.foreground}/><Text style={[s.title,{flex:1}]}>{job?.title??'Schedule saved'}</Text></View>{job&&<><Text style={s.caption}>{job.state==='active'&&job.health==='needs_attention'?'Needs attention':job.state[0].toUpperCase()+job.state.slice(1)} · {scheduleFrequency(job)}</Text>{job.history.at(-1)?.outcome==='running'?<Text style={s.body}>Running since {scheduleTime(job.history.at(-1)!.startedAt,job.timezone)}</Text>:job.nextRunAt!==undefined&&<Text style={s.body}>Next: {scheduleTime(job.nextRunAt,job.timezone)}</Text>}</>}<Text style={s.caption}>View schedule & controls</Text></Pressable>;
}
export function ScheduleAlert({data,onOpen}:{data:unknown;onOpen:()=>void}){
 const value=data&&typeof data==='object'?data as {title?:unknown;text?:unknown}:{};
 return <View style={s.receipt}><Text style={s.caption}>Scheduled result</Text><Text style={s.title}>{typeof value.title==='string'?value.title:'Schedule'}</Text><Text selectable style={s.body}>{typeof value.text==='string'?value.text:'Open schedules to inspect this result.'}</Text><Action label="View schedules" onPress={onOpen}/></View>;
}
type Request=(path:string,method?:string,body?:unknown,signal?:AbortSignal)=>Promise<any>;
export function SchedulesScreen({visible,request,onCompose,onOpenChat}:{visible:boolean;request:Request;onCompose:(text:string)=>void;onOpenChat:(id:number)=>void}){
 const api=useRef(request);api.current=request;
 const [jobs,setJobs]=useState<ScheduleJob[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(''),[expanded,setExpanded]=useState(''),[tab,setTab]=useState<'active'|'paused'|'finished'>('active');
 const mounted=useRef(true),generation=useRef(0),pending=useRef(0),readAbort=useRef<AbortController|undefined>(undefined),mutating=useRef(false);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;readAbort.current?.abort();};},[]);
 async function refresh(){
  if(pending.current||mutating.current)return;
  const ticket=++generation.current,controller=new AbortController();pending.current=ticket;readAbort.current=controller;
  try{const value=await api.current('schedules','GET',undefined,controller.signal);if(!Array.isArray(value.jobs))throw Error('Invalid schedule response');if(mounted.current&&ticket===generation.current){setJobs(value.jobs);setError('');}}
  catch(e){if(mounted.current&&ticket===generation.current&&!controller.signal.aborted)setError(String((e as Error).message??e));}
  finally{if(pending.current===ticket)pending.current=0;if(readAbort.current===controller)readAbort.current=undefined;if(mounted.current&&ticket===generation.current)setLoading(false);}
 }
 useEffect(()=>{
  if(!visible)return;void refresh();
  const timer=setInterval(()=>{if(AppState.currentState==='active')void refresh();},10000),listener=AppState.addEventListener('change',state=>{if(state==='active')void refresh();});
  return()=>{clearInterval(timer);listener.remove();generation.current++;readAbort.current?.abort();readAbort.current=undefined;pending.current=0;};
 },[visible]);
 async function change(job:ScheduleJob,action:'pause'|'resume'|'cancel'){
  if(mutating.current)return;mutating.current=true;setBusy(job.id);setError('');generation.current++;readAbort.current?.abort();readAbort.current=undefined;pending.current=0;
  try{await api.current('schedules','POST',{requestId:uuid(),operation:{action,id:job.id,expectedRevision:job.revision}});if(mounted.current){const value=await api.current('schedules');if(mounted.current){setJobs(value.jobs);setError('');}}}
  catch(e){if(mounted.current)setError(`${String((e as Error).message??e)} Refresh to check the saved state before trying again.`);}
  finally{mutating.current=false;if(mounted.current)setBusy('');}
 }
 if(!visible)return null;
 const filtered=jobs.filter(j=>tab==='finished'?j.state==='finished'||j.state==='cancelled':j.state===tab);
 return <View style={s.screen} testID="schedules-screen"><View style={s.heading}><View style={{flex:1}}><Text accessibilityRole="header" style={sectionStyles.title}>Schedules</Text><Text style={s.caption}>This workstation</Text></View><RoundAction icon={RefreshCw} label="Refresh schedules" disabled={!!busy} onPress={()=>void refresh()}/><RoundAction icon={Plus} label="Create a schedule in chat" primary onPress={()=>onCompose('Create a schedule: ')}/></View>
  <View style={s.tabs}>{(['active','paused','finished'] as const).map(value=><Pressable key={value} accessibilityRole="tab" accessibilityState={{selected:tab===value}} onPress={()=>setTab(value)} style={[s.tab,tab===value&&{backgroundColor:colors.surface}]}><Text style={s.body}>{value[0].toUpperCase()+value.slice(1)}</Text></Pressable>)}</View>
  {!!error&&<View style={s.notice}><Text accessibilityLiveRegion="polite" style={s.body}>{error}</Text><Action label="Refresh saved state" onPress={()=>void refresh()}/></View>}
  {loading?<ActivityIndicator accessibilityLabel="Loading schedules" style={{padding:24}} color={colors.foreground}/>:<FlatList data={filtered} keyExtractor={j=>j.id} contentContainerStyle={s.list} showsVerticalScrollIndicator={false} extraData={`${expanded}:${busy}`} ListEmptyComponent={<View style={s.notice}><Text style={s.title}>{tab==='active'?'No active schedules':tab==='paused'?'No paused schedules':'No finished schedules'}</Text><Text style={s.body}>Ask Bob in chat for a reminder or a bounded recurring check. A saved schedule will show its next run here.</Text><Action label="Create in chat" onPress={()=>onCompose('Create a schedule: ')}/></View>} renderItem={({item:job})=>{
   const last=job.history.at(-1),open=expanded===job.id;
   return <View style={s.card}><Pressable accessibilityRole="button" accessibilityLabel={`${job.title}, ${job.state}. ${open?'Hide':'Show'} details`} accessibilityState={{expanded:open}} onPress={()=>setExpanded(open?'':job.id)} style={s.summary}><Text style={s.caption}>{job.kind==='check'?'Read-only check':'Reminder'} · {job.health==='needs_attention'?'Needs attention':job.state}</Text><Text style={s.title}>{job.title}</Text><Text style={s.caption}>{scheduleFrequency(job)}</Text>{job.history.at(-1)?.outcome==='running'?<Text style={s.body}>Running since {scheduleTime(job.history.at(-1)!.startedAt,job.timezone)}</Text>:job.nextRunAt!==undefined&&<Text style={s.body}>Next: {scheduleTime(job.nextRunAt,job.timezone)}</Text>}<Text style={s.caption}>{last?`Last run: ${last.outcome.replaceAll('_',' ')}`:'Not run yet'} · {job.runs}/{job.maxRuns} runs</Text></Pressable>
    <View style={s.actions}>{job.state==='active'&&<Action label={busy===job.id?'Saving…':'Pause'} disabled={!!busy} onPress={()=>void change(job,'pause')}/ >}{job.state==='paused'&&<Action label={busy===job.id?'Saving…':'Resume'} disabled={!!busy} onPress={()=>void change(job,'resume')}/ >}{(job.state==='active'||job.state==='paused')&&<Action label="Cancel" disabled={!!busy} onPress={()=>Alert.alert('Cancel schedule?',`Stop future runs of “${job.title}”. In-flight checks will be asked to stop. Saved history is kept.`,[{text:'Keep schedule',style:'cancel'},{text:'Cancel schedule',style:'destructive',onPress:()=>void change(job,'cancel')}])}/>}</View>
    {open&&<View style={s.details}><Text selectable style={s.body}>{job.text}</Text><Text style={s.caption}>Timezone: {job.timezone}{'\n'}{job.kind==='check'?`On match: ${job.stopOnMatch?'stop':'continue'}. Failures pause the schedule. Checks may use model tokens.`:'Reminders do not use model inference.'}{'\n'}After downtime: catch up once; skip missed intervals. Runs do not overlap.</Text><Text selectable style={s.caption}>ID: {job.id}{'\n'}Revision: {job.revision}</Text><Text style={s.caption}>Results are saved in the source chat. Phone notices use Android background polling and may be delayed or unavailable; delivery is not confirmed here.</Text><View style={s.actions}><Action label="Open source chat" onPress={()=>onOpenChat(job.conversationId)}/>{(job.state==='active'||job.state==='paused')&&<Action label="Edit in chat" onPress={()=>onCompose(`Update schedule ${job.id}. Please get its latest revision first. Changes: `)}/>}</View><Text style={s.title}>Recent runs</Text>{job.history.length===0?<Text style={s.caption}>No runs yet.</Text>:[...job.history].reverse().map(run=><View key={run.number} style={s.run}><Text style={s.body}>#{run.number} · {run.outcome.replaceAll('_',' ')}</Text><Text style={s.caption}>{scheduleTime(run.startedAt,job.timezone)}{run.lateByMs>=60000?` · ${Math.floor(run.lateByMs/60000)} min late`:''}</Text>{!!run.message&&<Text selectable style={s.body}>{run.message}</Text>}</View>)}</View>}
   </View>;
  }}/ >}
 </View>;
}
const s=StyleSheet.create({screen:{position:'absolute',top:0,bottom:0,left:0,right:0,zIndex:25,backgroundColor:colors.background},heading:{paddingHorizontal:20,paddingTop:20,paddingBottom:12,flexDirection:'row',alignItems:'center',gap:8},tabs:{marginHorizontal:20,flexDirection:'row',borderRadius:18,backgroundColor:colors.panel,padding:4},tab:{flex:1,minHeight:48,justifyContent:'center',alignItems:'center',borderRadius:14},list:{padding:20,gap:14,paddingBottom:32},notice:{padding:20,gap:12},card:{borderRadius:18,borderWidth:1,borderColor:colors.border,backgroundColor:colors.panel},receipt:{borderRadius:16,borderWidth:1,borderColor:colors.border,padding:16,gap:8,backgroundColor:colors.panel},summary:{padding:16,gap:7},title:{fontSize:17,lineHeight:25,fontWeight:'600',color:colors.foreground},body:{fontSize:15,lineHeight:23,color:colors.body},caption:{fontSize:13,lineHeight:21,color:colors.muted},actions:{flexDirection:'row',flexWrap:'wrap',gap:8,paddingHorizontal:12,paddingBottom:8},action:{minHeight:48,paddingHorizontal:12,justifyContent:'center'},actionText:{fontSize:15,lineHeight:23,fontWeight:'500',color:colors.foreground},details:{padding:16,gap:14,borderTopWidth:1,borderTopColor:colors.border},run:{paddingTop:10,gap:5,borderTopWidth:1,borderTopColor:colors.border}});
