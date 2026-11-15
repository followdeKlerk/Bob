import React,{useEffect,useRef,useState} from 'react';
import {Alert,View} from 'react-native';
import {BarChart3,Check,ChevronDown,ChevronUp,Database,HardDrive,Info,List,MessageSquare,RefreshCw,RotateCcw,type LucideIcon} from 'lucide-react-native';
import {Text} from './app-text';
import {SettingsRow} from './section-ui';
import {TouchTarget} from './touch-target';
import {useTheme} from '../theme';
import {useBackNavigation} from '../use-back-navigation';
import {getCachePreferences,updateCachePreferences,getCacheUsage,clearDownloadedCache,subscribeCachePreferences,HISTORY_CACHE_MAX_BYTES,type CachePreferences,type CacheUsage} from '../download-cache';

export function formatCacheBytes(bytes:number):string{
 if(!Number.isFinite(bytes)||bytes<0)return 'Unavailable';
 if(bytes<1024)return `${Math.round(bytes)} B`;
 if(bytes<1024*1024)return `${(bytes/1024).toFixed(1)} KiB`;
 return `${(bytes/(1024*1024)).toFixed(1)} MiB`;
}
const limits=[10,25,50,100,200,500],READ_WAIT_MS=10000;
function CacheCard({title,icon:Icon,action,children}:{title:string;icon:LucideIcon;action?:React.ReactNode;children:React.ReactNode}){
 const {colors,menuChrome}=useTheme();
 return <View testID={`cache-card:${title}`} style={[menuChrome.card,{padding:16,gap:8}]}>
  <View style={{flexDirection:'row',alignItems:'center',gap:8,minHeight:32}}>
   <View pointerEvents="none" accessible={false}><Icon size={20} color={colors.foreground}/></View>
   <Text typography="ui" accessibilityRole="header" style={{flex:1,minWidth:0,color:colors.foreground,fontSize:16,lineHeight:24}}>{title}</Text>
   {action}
  </View>
  {children}
 </View>;
}
function CacheIconAction({label,icon:Icon,disabled=false,onPress}:{label:string;icon:LucideIcon;disabled?:boolean;onPress:()=>void}){
 const {colors}=useTheme();
 return <TouchTarget accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={{minWidth:48,minHeight:48,flexShrink:0,alignItems:'center',justifyContent:'center',opacity:disabled?0.4:1}}>
  <Icon size={19} color={colors.muted}/>
 </TouchTarget>;
}
function UsageRow({label,value}:{label:string;value:string}){
 const {colors}=useTheme();
 return <View accessible accessibilityLabel={`${label}: ${value}`} style={{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:8,paddingVertical:6}}>
  <Text typography="ui" style={{color:colors.muted,fontSize:14,lineHeight:22,maxWidth:'100%'}}>{label}</Text>
  <View accessible={false} accessibilityElementsHidden importantForAccessibility="no" style={{flexGrow:1,flexBasis:8,minWidth:8}}/>
  <Text typography="ui" style={{color:colors.foreground,fontSize:16,lineHeight:24,maxWidth:'100%'}}>{value}</Text>
 </View>;
}
/** Phone-wide cache policy, deliberately independent of mounted session lifetime. */
export function CacheSettings({active=true}:{active?:boolean}){
 const {colors,menuChrome}=useTheme();
 const [preferences,setPreferences]=useState<CachePreferences>();
 const [usage,setUsage]=useState<CacheUsage>();
 const [busy,setBusy]=useState(false),[policyLoading,setPolicyLoading]=useState(true),[usageLoading,setUsageLoading]=useState(true);
 const [error,setError]=useState(''),[message,setMessage]=useState('');
 const [policyError,setPolicyError]=useState(''),[usageError,setUsageError]=useState('');
 const [limitOpen,setLimitOpen]=useState(false);
 const alive=useRef(false),visible=useRef(active),working=useRef(false),request=useRef(0);visible.current=active;
 const reads=useRef(new Set<()=>void>());
 const textStyle={color:colors.muted,fontSize:13,lineHeight:20,paddingVertical:6};
 const problem=error||policyError||usageError;
 function stopWaiting(){for(const cancel of reads.current)cancel();}
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;request.current++;stopWaiting();};},[]);
 useEffect(()=>{if(!active||!preferences?.history)setLimitOpen(false);},[active,preferences?.history]);
 useBackNavigation(()=>{setLimitOpen(false);return true;},active&&limitOpen);
 async function refresh(){
  if(!alive.current||!visible.current)return;
  const ticket=++request.current;stopWaiting();
  setPolicyLoading(true);setUsageLoading(true);setError('');setPolicyError('');setUsageError('');
  // Bound only this view's wait. Native storage and the mutation queue continue
  // untouched; a deadline never cancels a write or admits a duplicate mutation.
  function observe<T>(read:()=>Promise<T>,success:(value:T)=>void,failure:(slow:boolean)=>void,settled:()=>void):Promise<void>{
   return new Promise(resolve=>{
    let finished=false;
    const finish=(apply?:()=>void)=>{
     if(finished)return;finished=true;clearTimeout(timer);reads.current.delete(cancel);
     if(apply&&alive.current&&visible.current&&ticket===request.current){apply();settled();}
     resolve();
    };
    const cancel=()=>finish(),timer=setTimeout(()=>finish(()=>failure(true)),READ_WAIT_MS);
    reads.current.add(cancel);
    // The separate handlers publish each result immediately and also catch a
    // synchronous adapter failure; don't depend on Promise.allSettled in the UI.
    Promise.resolve().then(read).then(value=>finish(()=>success(value)),()=>finish(()=>failure(false)));
   });
  }
  const policy=observe(getCachePreferences,value=>setPreferences(value),slow=>{
   setPreferences(undefined);setPolicyError(slow?'Cache settings took too long to load. Controls are disabled until saved settings can be read. Retry to continue.':'Could not read the saved cache settings. Controls are disabled until saved settings can be read. Retry to continue.');
  },()=>setPolicyLoading(false));
  void observe(getCacheUsage,value=>setUsage(value),slow=>{
   setUsage(undefined);setUsageError(slow?'Cache measurement took too long. You can retry.':'Could not measure downloaded chat data. Storage usage is unavailable.');
  },()=>setUsageLoading(false));
  // A completed setting change must not remain busy behind a separate scan.
  await policy;
 }
 useEffect(()=>{
  if(!active){request.current++;stopWaiting();return;}
  void refresh();
  return subscribeCachePreferences(()=>{if(visible.current)void refresh();});
 },[active]);
 async function change(operation:()=>Promise<unknown>,success:string,failure:string){
  if(!alive.current||!visible.current||working.current)return;
  working.current=true;setBusy(true);setError('');setMessage('');setLimitOpen(false);
  try{
   await operation();
   if(alive.current&&visible.current){await refresh();if(alive.current&&visible.current)setMessage(success);}
  }catch{
   // A cleanup can be partial. Never report removed bytes or roll settings back
   // speculatively after an uncertain storage result.
   if(alive.current&&visible.current){await refresh();if(alive.current&&visible.current)setError(failure);}
  }finally{working.current=false;if(alive.current)setBusy(false);}
 }
 const disabled=busy||!preferences||!active,limitDisabled=disabled||!preferences?.history;
 const expanded=limitOpen&&!limitDisabled;
 function toggle(category:'chatLists'|'history'){
  if(disabled||!preferences)return;
  const enabled=!preferences[category],label=category==='history'?'conversation history':'conversation lists';
  const apply=()=>change(()=>updateCachePreferences({[category]:enabled}),enabled?`Downloaded ${label} caching is on. New activity can save recovery copies.`:`Downloaded ${label} caching is off; its cached copies were cleared.`,`Could not finish changing ${label} caching. Check the saved setting and retry; some cached copies may remain.`);
  if(enabled){void apply();return;}
  Alert.alert(`Stop caching ${label}?`,'This removes downloaded copies on this phone. Open sessions, backend history, drafts and queued messages stay intact.',[
   {text:'Cancel',style:'cancel'},
   {text:'Turn off & clear',style:'destructive',onPress:()=>{void apply();}},
  ]);
 }
 function clear(){
  if(disabled)return;
  Alert.alert('Clear downloaded chat cache?','This clears downloaded conversation lists and history on this phone, not the workstation originals. Open sessions, drafts, queued messages, attachments, Notes, pairings and APK downloads are kept. Enabled caches may refill with new activity.',[
   {text:'Cancel',style:'cancel'},
   {text:'Clear cache',style:'destructive',onPress:()=>{void change(()=>clearDownloadedCache('all'),'Downloaded chat cache cleared. Open sessions are unchanged.','Could not completely clear the downloaded chat cache. Some cached copies may remain; retry when storage is available.');}},
  ]);
 }
 function about(){
  if(!alive.current||!visible.current)return;
  setLimitOpen(false);
  Alert.alert('About caching',`Applies to this phone across all workstations. These controls manage chat lists and downloaded messages; they do not pre-download whole conversations.\n\nThe limit keeps recently opened chats, up to ${formatCacheBytes(HISTORY_CACHE_MAX_BYTES)} of history data. Snapshots and older pages count together. This is separate from the two live sessions.\n\nResetting or turning a category off removes its cached copies, not workstation history, open sessions, drafts or queued messages. Enabled caches refill as you use Bob.\n\nUsage counts chat-data bytes, not total app storage or space immediately freed. Images, file previews, attachments, Notes, pairings and updates are excluded. Clearing is not secure erasure.`,[{text:'OK'}]);
 }
 return <>
  <CacheCard title="Cached on this device" icon={Database} action={<CacheIconAction label="About caching" icon={Info} disabled={!active} onPress={about}/>}>
   <SettingsRow title="Chat List" label="Cache conversation lists" icon={List} checked={preferences?.chatLists??false} value="Titles and recent conversations" disabled={disabled} onPress={()=>toggle('chatLists')}/>
   <SettingsRow title="Messages" separator label="Cache conversation history" icon={MessageSquare} checked={preferences?.history??false} value="Downloaded messages, available offline" disabled={disabled} onPress={()=>toggle('history')}/>
  </CacheCard>
  <CacheCard title="Limit" icon={HardDrive}>
   <TouchTarget accessibilityRole="button" accessibilityLabel="Cached conversation limit" accessibilityValue={{text:preferences?`${preferences.maxConversations} chats`:policyLoading?'Loading':'Unavailable'}} accessibilityState={{expanded,disabled:limitDisabled}} disabled={limitDisabled} onPress={()=>{if(!limitDisabled)setLimitOpen(open=>!open);}} style={[menuChrome.control,{flexDirection:'row',alignItems:'center',gap:8,minHeight:48,paddingHorizontal:12,paddingVertical:10,opacity:limitDisabled?0.4:1}]}>
    <Text typography="ui" style={{flex:1,minWidth:0,color:colors.foreground,fontSize:16,lineHeight:24}}>{preferences?`Keep Up To: ${preferences.maxConversations} chats`:policyLoading?'Loading…':'Limit unavailable'}</Text>
    {expanded?<ChevronUp size={18} color={colors.foreground}/>:<ChevronDown size={18} color={colors.foreground}/>}
   </TouchTarget>
   {expanded&&preferences&&<View accessibilityRole="radiogroup" accessibilityLabel="Cached conversation limit options" style={{gap:4}}>
    {limits.map(value=><TouchTarget key={value} accessibilityRole="radio" accessibilityLabel={`Cache up to ${value} conversations`} accessibilityState={{checked:preferences.maxConversations===value,disabled:limitDisabled}} disabled={limitDisabled} onPress={()=>{
     if(limitDisabled)return;
     setLimitOpen(false);if(value===preferences.maxConversations)return;
     void change(()=>updateCachePreferences({maxConversations:value}),`Offline cache limit saved: ${value} conversations.`,`Could not finish applying the cache limit. Check the saved setting and retry.`);
    }} style={{flexDirection:'row',alignItems:'center',gap:12,minHeight:48,paddingHorizontal:12,paddingVertical:10,borderRadius:10,borderWidth:1,borderColor:preferences.maxConversations===value?colors.selectedBorder:'transparent',backgroundColor:preferences.maxConversations===value?colors.selectedSurface:'transparent'}}>
     <Text typography="ui" style={{flex:1,minWidth:0,color:colors.foreground,fontSize:16,lineHeight:24}}>{value} chats</Text>
     <View pointerEvents="none" style={{width:18}}>{preferences.maxConversations===value&&<Check size={18} color={colors.foreground}/>}</View>
    </TouchTarget>)}
   </View>}
  </CacheCard>
  <CacheCard title="Usage" icon={BarChart3} action={<CacheIconAction label="Refresh usage" icon={RefreshCw} disabled={busy||usageLoading||!active} onPress={()=>{setMessage('');void refresh();}}/>}>
   {usage?<View accessibilityLabel="Downloaded chat storage usage">
    <UsageRow label="On this device" value={formatCacheBytes(usage.totalBytes)}/>
    <UsageRow label="Chat list" value={formatCacheBytes(usage.chatLists.bytes)}/>
    <UsageRow label="Messages" value={formatCacheBytes(usage.history.bytes)}/>
    <UsageRow label="Cached chats" value={String(usage.history.conversations)}/>
   </View>:<Text typography="ui" style={textStyle}>{usageLoading?'Measuring cache…':'Storage usage unavailable.'}</Text>}
  </CacheCard>
  <CacheCard title="Reset Cache" icon={RotateCcw}>
   <TouchTarget accessibilityRole="button" accessibilityLabel="Clear downloaded chat cache" accessibilityState={{disabled,busy}} disabled={disabled} onPress={clear} style={{minHeight:48,paddingHorizontal:12,paddingVertical:10,justifyContent:'center',opacity:disabled?0.4:1}}>
    <Text typography="ui" style={{color:colors.danger,fontSize:16,lineHeight:24}}>Reset Cache</Text>
   </TouchTarget>
  </CacheCard>
  {!!(problem||message)&&<Text typography="ui" accessibilityLiveRegion="polite" style={{...textStyle,color:problem?colors.danger:colors.foreground}}>{problem||message}</Text>}
  {!!problem&&<SettingsRow title="Retry cache settings" icon={Database} disabled={busy||policyLoading||!active} onPress={()=>{void refresh();}}/>}
 </>;
}
