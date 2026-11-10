import React,{useEffect,useMemo,useRef,useState} from 'react';
import {ActivityIndicator,AppState,Modal,Platform,Pressable,requireNativeComponent,ScrollView,StyleSheet,UIManager,useWindowDimensions,View,type NativeSyntheticEvent,type ViewProps} from 'react-native';
import {SafeAreaProvider,SafeAreaView} from 'react-native-safe-area-context';
import {Download,ExternalLink,FileAudio,FileVideo,Info,Maximize,Pause,Play,RotateCcw,Square,X} from 'lucide-react-native';
import * as Keychain from 'react-native-keychain';
import {Text} from './app-text';
import {attachmentType} from './attachment-type';
import {inlineMediaSizing} from './media-sizing';
import {initialMediaState,mediaBusy,mediaBytes,mediaStateFromProgress,mediaStatus,mediaTime,type MediaProgress,type MediaState} from './media-presentation';
import {useChatMotion} from '../chat-motion';
import {themed,useTheme,useThemedValue} from '../theme';

type Backend={backendId:string;endpoint:string};
type Artifact={id:string;conversationId:number;name:string;mime:string;size:number};
type Mode='inline'|'full';
type Source={endpoint:string;identity:string;token:string;conversation:string;artifact:string;size:number;video:boolean;sessionId:string;initialPositionMs:number;initialPaused:boolean};
type Control={sessionId:string;sequence:number;action:'play'|'pause';};
type NativeProps=ViewProps&{source:Source;control?:Control;palette:{foreground:string;background:string;muted:string};sizing:ReturnType<typeof inlineMediaSizing>;onProgress:(event:NativeSyntheticEvent<MediaProgress>)=>void;onStopped:(event:NativeSyntheticEvent<MediaProgress>)=>void};
type Playback={scope:string;mode:Mode;source:Source};
// No WebView/remote URL player: only the paired, redirect-denying native transport.
const NativePlayer=Platform.OS==='android'&&UIManager.getViewManagerConfig('BobInlineMedia')?requireNativeComponent<NativeProps>('BobInlineMedia'):undefined;
let nextSession=0;

function Status({state,video,pending=false}:{state?:MediaState;video:boolean;pending?:boolean}){
 const {colors}=useTheme(),styles=useThemedValue(stylesTheme),motion=useChatMotion();
 const busy=pending||!!state&&mediaBusy(state.phase);
 const title=pending?'Authorizing…':state?mediaStatus(state.phase,video):'Tap Play to stream';
 return <View style={styles.status} testID="media-status">
  <View style={styles.statusLine}>
   {busy&&(motion?<ActivityIndicator size="small" color={colors.foreground} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"/>:<View accessible={false} style={styles.loadingDot}/>)}
   <Text accessibilityLiveRegion="polite" style={styles.statusText}>{title}</Text>
  </View>
  {!!state?.receivedBytes&&<Text style={styles.transfer}>{`${mediaBytes(state.receivedBytes)} received`}</Text>}
 </View>;
}

function PlaybackSurface({playback,state,control,onProgress,onStopped}:{playback:Playback;state:MediaState;control?:Control;onProgress:NativeProps['onProgress'];onStopped:NativeProps['onStopped']}){
 const {colors}=useTheme(),styles=useThemedValue(stylesTheme),window=useWindowDimensions();
 const [width,setWidth]=useState(Math.max(1,window.width-56));
 const video=playback.source.video,sizing=inlineMediaSizing(window.fontScale,width,video);
 const palette=useMemo(()=>({foreground:colors.foreground,background:colors.panel,muted:colors.border}),[colors]);
 return <View style={styles.playback} onLayout={event=>{const measured=event.nativeEvent.layout.width;if(Number.isFinite(measured)&&measured>0)setWidth(measured);}}>
  <View style={styles.nativeFrame}>
   {NativePlayer&&<NativePlayer key={playback.source.sessionId} source={playback.source} control={control} palette={palette} sizing={sizing} style={{width:'100%',height:sizing.height}} onProgress={onProgress} onStopped={onStopped}/>}
   {video&&!state.videoReady&&<View pointerEvents="none" style={[styles.videoCover,{height:sizing.videoHeight}]}>
    <FileVideo size={30} color="#e8e0d2"/>
    <Text style={styles.videoCoverText}>{state.phase==='paused'?'Paused video':state.phase==='playing'?'Starting video…':mediaStatus(state.phase,true)}</Text>
   </View>}
  </View>
  <View style={styles.times} accessible accessibilityLabel={`Playback time ${mediaTime(state.positionMs)} of ${state.durationMs>0?mediaTime(state.durationMs):'unknown duration'}`}>
   <Text style={styles.time}>{mediaTime(state.positionMs)}</Text>
   <Text style={styles.time}>{state.durationMs>0?mediaTime(state.durationMs):'—:—'}</Text>
  </View>
 </View>;
}
function Toggle({state,video,name,pending,disabled,onPress,retry=false}:{state?:MediaState;video:boolean;name:string;pending?:boolean;disabled?:boolean;onPress:()=>void;retry?:boolean}){
 const {colors}=useTheme(),styles=useThemedValue(stylesTheme),motion=useChatMotion();
 const [pressed,setPressed]=useState(false);
 const loading=pending||state?.phase==='connecting'||state?.phase==='loading';
 const pausing=!!state&&!state.paused;
 const label=loading?'Loading':retry?'Retry':pausing?'Pause':'Play';
 const Icon=retry?RotateCcw:pausing?Pause:Play;
 // NativeWind's production interop drops function-valued styles. Pass concrete
 // styles so the primary action keeps its contrast and touch target on the phone.
 return <Pressable accessibilityRole="button" accessibilityLabel={`${label} ${video?'video':'audio'}: ${name}`} accessibilityState={{disabled:!!disabled||!!loading,busy:!!loading}} disabled={!!disabled||!!loading} onPress={onPress} onPressIn={()=>setPressed(true)} onPressOut={()=>setPressed(false)} style={[styles.toggle,pressed&&styles.pressed]}>
  {loading?(motion?<ActivityIndicator size="small" color={colors.onAccent}/>:<Text style={styles.toggleLoading}>…</Text>):<Icon size={23} color={colors.onAccent}/>}
  <Text style={styles.toggleLabel}>{label}</Text>
 </Pressable>;
}

/** A new modal and native session, never a reparented Surface/MediaPlayer. */
function FullVideo({playback,name,pending,state,control,onClose,onToggle,onProgress,onStopped}:{playback?:Playback;name:string;pending:boolean;state:MediaState;control?:Control;onClose:()=>void;onToggle:()=>void;onProgress:NativeProps['onProgress'];onStopped:NativeProps['onStopped']}) {
 const {colors}=useTheme(),styles=useThemedValue(stylesTheme);
 const [shown,setShown]=useState(false);
 return <Modal visible animationType="none" presentationStyle="fullScreen" statusBarTranslucent navigationBarTranslucent onShow={()=>setShown(true)} onRequestClose={onClose}>
  <SafeAreaProvider><SafeAreaView edges={['top','right','bottom','left']} style={styles.fullSafe} accessibilityViewIsModal>
   <View style={styles.fullHeader}>
    <Text numberOfLines={2} accessibilityRole="header" style={styles.fullTitle}>{name}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Close full video" onPress={onClose} style={styles.details}><X size={24} color={colors.foreground}/></Pressable>
   </View>
   <ScrollView style={styles.fullBody} contentContainerStyle={styles.fullScroll}>
    <Status state={state} video pending={pending}/>
    {shown&&playback&&<PlaybackSurface playback={playback} state={state} control={control} onProgress={onProgress} onStopped={onStopped}/>}
    <View style={styles.fullControls}>
     <Toggle state={state} video name={name} pending={pending||!shown||!playback} onPress={onToggle}/>
     <Pressable accessibilityRole="button" accessibilityLabel="Stop full video" onPress={onClose} style={styles.action}><Square size={18} color={colors.foreground}/><Text style={styles.actionLabel}>Stop</Text></Pressable>
    </View>
   </ScrollView>
  </SafeAreaView></SafeAreaProvider>
 </Modal>;
}

export function StreamingMedia({backend,artifact,video,active=true,onOpen,onSave,onDetails}:{backend:Backend;artifact:Artifact;video:boolean;active?:boolean;onOpen:()=>void;onSave?:()=>void;onDetails:()=>void}) {
 const {colors}=useTheme(),styles=useThemedValue(stylesTheme);
 const scope=JSON.stringify([backend.backendId,backend.endpoint,artifact.conversationId,artifact.id,artifact.size,video]);
 const [playback,setPlayback]=useState<Playback>();
 const [full,setFull]=useState<{scope:string;sessionId:string}>();
 const [pending,setPending]=useState(false),[error,setError]=useState<string>();
 const [state,setState]=useState<MediaState>(initialMediaState),[control,setControl]=useState<Control>();
 const stateRef=useRef(state),admission=useRef(0),sequence=useRef(0),currentSession=useRef<string|undefined>(undefined);
 const nativeResponded=useRef(false);
 const resume=useRef<{scope:string;positionMs:number;paused:boolean}|undefined>(undefined);
 const live=useRef({scope,active});live.current={scope,active};
 const setCurrentState=(value:MediaState)=>{stateRef.current=value;setState(value);};
 const invalidate=()=>{admission.current++;currentSession.current=undefined;setPlayback(undefined);setFull(undefined);setPending(false);setControl(undefined);};
 useEffect(()=>{
  invalidate();setError(undefined);setCurrentState(initialMediaState());
  if(resume.current?.scope!==scope)resume.current=undefined;
  return ()=>{admission.current++;currentSession.current=undefined;};
 },[scope,active]);
 useEffect(()=>{
  const subscription=AppState.addEventListener('change',next=>{if(next!=='active')invalidate();});
  return ()=>subscription.remove();
 },[]);
 // A dropped native admission/event must never leave an endless, uninformative blank player.
 useEffect(()=>{
  if(!playback)return;
  const sessionId=playback.source.sessionId;
  const timeout=setTimeout(()=>{
   if(currentSession.current===sessionId&&!nativeResponded.current){invalidate();setError('The player did not respond. Tap Retry, or use Open / Save.');}
  },35000);
  return ()=>clearTimeout(timeout);
 },[playback]);
 const play=async(mode:Mode='inline')=>{
  if(!active||pending)return;
  if(!NativePlayer){setError('Inline playback is unavailable in this app. Use Open or Save.');return;}
  const previous=resume.current?.scope===scope?resume.current:undefined;
  const paused=mode==='full'&&currentSession.current!==undefined?(previous?.paused??false):false;
  const attempt=++admission.current,sessionId=`media-${++nextSession}`;
  currentSession.current=sessionId;nativeResponded.current=false;setPlayback(undefined);setPending(true);setError(undefined);setControl(undefined);
  setCurrentState(initialMediaState(previous?.positionMs??0,paused));
  setFull(mode==='full'?{scope,sessionId}:undefined);
  try {
   const credential=await Keychain.getGenericPassword({service:`bob.${backend.backendId}`});
   if(attempt!==admission.current||live.current.scope!==scope||!live.current.active)return;
   if(!credential)throw Error('Missing pairing');
   setPlayback({scope,mode,source:{endpoint:backend.endpoint,identity:backend.backendId,token:credential.password,conversation:String(artifact.conversationId),artifact:artifact.id,size:artifact.size,video,sessionId,initialPositionMs:previous?.positionMs??0,initialPaused:paused}});
  }catch {if(attempt===admission.current){setFull(undefined);currentSession.current=undefined;setError('Cannot authorize playback. Check the paired connection and retry.');}}
  finally{if(attempt===admission.current)setPending(false);}
 };
 const playing=active&&playback?.scope===scope?playback:undefined;
 const showingFull=active&&full?.scope===scope?full:undefined;
 const accept=(event:NativeSyntheticEvent<MediaProgress>)=>{
  const data=event.nativeEvent;
  if(!live.current.active||live.current.scope!==scope||!currentSession.current||data.sessionId!==currentSession.current)return false;
  const next=mediaStateFromProgress(data,stateRef.current);if(!next)return false;
  nativeResponded.current=true;
  resume.current={scope,positionMs:next.positionMs,paused:next.paused};setCurrentState(next);
  return true;
 };
 const progress:NativeProps['onProgress']=event=>{accept(event);};
 const stopped:NativeProps['onStopped']=event=>{
  if(!accept(event))return;
  invalidate();setError(typeof event.nativeEvent.message==='string'?event.nativeEvent.message.slice(0,500):undefined);
 };
 const close=()=>{invalidate();setError(undefined);};
 const toggle=()=>{
  if(!playing){void play();return;}
  if(!active||currentSession.current!==playing.source.sessionId)return;
  setControl({sessionId:playing.source.sessionId,sequence:++sequence.current,action:stateRef.current.paused?'play':'pause'});
 };
 const TypeIcon=video?FileVideo:FileAudio;
 const badge=attachmentType(artifact.name,artifact.mime).badge;
 const inline=playing?.mode==='inline'?playing:undefined;
 return <View style={styles.card} testID="media-card">
  <View style={styles.header}>
   <View style={styles.fileIcon}><TypeIcon size={22} color={colors.foreground}/></View>
   <View style={styles.heading}>
    <Text style={styles.title}>{video?'Video':'Audio'}</Text>
    <Text style={styles.meta}>{`${badge} · ${mediaBytes(artifact.size)}`}</Text>
   </View>
   <Toggle state={inline?state:undefined} video={video} name={artifact.name} pending={pending} disabled={!active} retry={!!error} onPress={toggle}/>
   <Pressable accessibilityRole="button" accessibilityLabel={`Attachment details: ${artifact.name}`} onPress={onDetails} style={styles.details}><Info size={20} color={colors.muted}/></Pressable>
  </View>
  {error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:<Status state={inline?state:state.phase==='ended'?state:undefined} video={video} pending={pending}/>}
  {inline?<PlaybackSurface playback={inline} state={state} control={control} onProgress={progress} onStopped={stopped}/>:
   video&&<Pressable accessibilityRole="button" accessibilityLabel={`Play video preview: ${artifact.name}`} disabled={pending||!active} onPress={()=>void play()} style={styles.videoPreview}>
    <Play size={34} color="#e8e0d2"/><Text style={styles.videoPreviewLabel}>{pending?'Authorizing…':error?'Tap to retry':'Play video'}</Text>
   </Pressable>}
  <View style={styles.actions}>
   {(playing||pending)&&<Pressable accessibilityRole="button" accessibilityLabel={`Stop ${video?'video':'audio'}: ${artifact.name}`} onPress={close} style={styles.action}><Square size={17} color={colors.foreground}/><Text style={styles.actionLabel}>Stop</Text></Pressable>}
   {video&&<Pressable accessibilityRole="button" accessibilityLabel={`Full video: ${artifact.name}`} accessibilityState={{disabled:pending||!active}} disabled={pending||!active} onPress={()=>void play('full')} style={styles.action}><Maximize size={18} color={colors.foreground}/><Text style={styles.actionLabel}>Full view</Text></Pressable>}
   <Pressable accessibilityRole="button" accessibilityLabel={`Open ${artifact.name} externally`} onPress={onOpen} style={styles.action}><ExternalLink size={18} color={colors.foreground}/><Text style={styles.actionLabel}>Open</Text></Pressable>
   {onSave&&<Pressable accessibilityRole="button" accessibilityLabel={`Save ${artifact.name}`} onPress={onSave} style={styles.action}><Download size={18} color={colors.foreground}/><Text style={styles.actionLabel}>Save</Text></Pressable>}
  </View>
  {showingFull&&<FullVideo key={showingFull.sessionId} playback={playing?.mode==='full'?playing:undefined} name={artifact.name} pending={pending} state={state} control={control} onClose={()=>{if(currentSession.current===showingFull.sessionId&&live.current.scope===scope)close();}} onToggle={toggle} onProgress={progress} onStopped={stopped}/>}
 </View>;
}
const stylesTheme=themed(({colors,menuChrome})=>StyleSheet.create({
 card:{alignSelf:'stretch',width:'100%',backgroundColor:colors.panel,borderWidth:1,borderColor:colors.border,borderRadius:16,padding:12,gap:8},
 header:{flexDirection:'row',alignItems:'center',gap:6,flexWrap:'wrap'},
 fileIcon:{width:32,minHeight:40,alignItems:'center',justifyContent:'center'},
 heading:{flex:1,minWidth:80},
 title:{fontSize:16,lineHeight:23,fontWeight:'600',color:colors.foreground},
 meta:{fontSize:12,lineHeight:18,color:colors.muted},
 toggle:{minWidth:88,minHeight:48,paddingHorizontal:12,paddingVertical:8,flexDirection:'row',gap:6,flexShrink:1,alignItems:'center',justifyContent:'center',borderRadius:24,backgroundColor:colors.accent},
 toggleLabel:{fontSize:13,lineHeight:20,color:colors.onAccent,fontWeight:'600',flexShrink:1},
 toggleLoading:{fontSize:18,color:colors.onAccent},
 pressed:{opacity:0.75},
 details:{width:48,height:48,alignItems:'center',justifyContent:'center'},
 status:{gap:2,paddingHorizontal:2},
 statusLine:{flexDirection:'row',alignItems:'center',gap:8},
 statusText:{fontSize:14,lineHeight:21,color:colors.foreground,flexShrink:1},
 transfer:{fontSize:12,lineHeight:18,color:colors.muted},
 loadingDot:{width:7,height:7,borderRadius:4,backgroundColor:colors.foreground},
 playback:{alignSelf:'stretch',gap:0},
 nativeFrame:{borderRadius:10,overflow:'hidden'},
 videoCover:{position:'absolute',left:0,right:0,top:0,alignItems:'center',justifyContent:'center',backgroundColor:'#141414',padding:16,gap:10},
 videoCoverText:{color:'#e8e0d2',fontSize:14,textAlign:'center'},
 videoPreview:{minHeight:136,backgroundColor:'#141414',borderRadius:10,alignItems:'center',justifyContent:'center',padding:16,gap:10},
 videoPreviewLabel:{color:'#e8e0d2',fontSize:14,lineHeight:21,textAlign:'center'},
 times:{flexDirection:'row',justifyContent:'space-between',flexWrap:'wrap',gap:8,paddingHorizontal:4},
 time:{fontSize:12,lineHeight:19,color:colors.muted},
 actions:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:4},
 action:{minHeight:48,paddingHorizontal:8,paddingVertical:10,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6,flexShrink:1,borderRadius:menuChrome.control.borderRadius},
 actionLabel:{fontSize:13,lineHeight:20,color:colors.foreground,flexShrink:1},
 error:{fontSize:14,lineHeight:21,color:colors.foreground},
 fullSafe:{flex:1,backgroundColor:colors.panel},
 fullHeader:{flexDirection:'row',alignItems:'center',paddingHorizontal:12,paddingVertical:8,gap:8},
 fullTitle:{flex:1,fontSize:16,color:colors.foreground},
 fullBody:{flex:1},
 fullScroll:{flexGrow:1,justifyContent:'center',padding:16,gap:12},
 fullControls:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:16,flexWrap:'wrap'},
}));
