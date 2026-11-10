import React,{useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Alert,AppState,BackHandler,Keyboard,Pressable,ScrollView,StyleSheet,View,useWindowDimensions,requireNativeComponent,type NativeSyntheticEvent,type ViewProps} from 'react-native';
import {Copy,Ellipsis,History,Keyboard as KeyboardIcon,ClipboardPaste,RefreshCw,Trash2,X} from 'lucide-react-native';
import {v4 as uuid} from 'uuid';
import {Text} from './app-text';
import {SectionActions,SectionAction,RoundAction} from './section-ui';
import {Button} from './ui/button';
import {TerminalHeader} from './terminal-header';
import {TerminalKeyRow} from './terminal-key-row';
import {themed,useThemedValue,useTheme} from '../theme';
import {terminalConnection,terminalKeyLayout,terminalNative,terminalStatus,type TerminalControl,type TerminalState,type TerminalStatus,type TerminalTarget} from '../terminal';

const NativeTerminal=requireNativeComponent<ViewProps&{session:string;active:boolean;control?:TerminalControl;onState:(event:NativeSyntheticEvent<TerminalState>)=>void}>('BobTerminalView');
type Props={visible:boolean;target?:TerminalTarget;workstation?:string;allowed:boolean;bottomInset?:number;menuOpen?:boolean;menu?:React.ReactNode;onBack:()=>void;request:(path:string,method?:string,body?:unknown,signal?:AbortSignal)=>Promise<unknown>};
type Pending={scope:string;id:string;promise?:Promise<unknown>};
type Phase='idle'|'checking'|'starting'|'running'|'closed'|'failed'|'unavailable';

export function TerminalScreen({visible,target,workstation,allowed,bottomInset=0,menuOpen=false,menu,onBack,request}:Props){
 const styles=useThemedValue(stylesTheme),{colors}=useTheme(),window=useWindowDimensions();
 const [frame,setFrame]=useState({width:0,height:0}),[headerHeight,setHeaderHeight]=useState(44),[footerHeight,setFooterHeight]=useState(64);
 const [status,setStatus]=useState<TerminalStatus>(),[phase,setPhase]=useState<Phase>('idle'),[message,setMessage]=useState(''),[handle,setHandle]=useState<string>(),[more,setMore]=useState(false),[ctrl,setCtrl]=useState(false),[control,setControl]=useState<TerminalControl>(),[endUnknown,setEndUnknown]=useState(false);
 const [foreground,setForeground]=useState(AppState.currentState!=='background'&&AppState.currentState!=='inactive');
 const scope=target?`${target.backendId}:${target.conversationId}`:'';
 const latest=useRef({visible,scope,allowed,request,target,foreground});latest.current={visible,scope,allowed,request,target,foreground};
 const mounted=useRef(true),generation=useRef(0),busy=useRef<number|undefined>(undefined),read=useRef<AbortController|undefined>(undefined),prepared=useRef<string|undefined>(undefined),pending=useRef<Pending|undefined>(undefined),sequence=useRef(0),commands=useRef<TerminalControl[]>([]);
 const current=(ticket:number,captured:string)=>mounted.current&&ticket===generation.current&&latest.current.visible&&latest.current.foreground&&latest.current.allowed&&latest.current.scope===captured;
 function release(value=prepared.current){
  if(!value)return;
  if(value===prepared.current)prepared.current=undefined;
  void terminalNative()?.releasePrepared(value).catch(()=>{});
 }
 function invalidate(){generation.current++;busy.current=undefined;read.current?.abort();commands.current=[];release();}
 function clearLocal(){release();commands.current=[];setHandle(undefined);setCtrl(false);setControl(undefined);}
 async function check(connectAfter:boolean){
  const selected=latest.current.target,captured=latest.current.scope;
  if(!selected||!latest.current.visible||!latest.current.allowed||!latest.current.foreground||busy.current!==undefined)return;
  const ticket=++generation.current;busy.current=ticket;
  setMore(false);setMessage('');setPhase('checking');clearLocal();
  const controller=new AbortController();read.current=controller;
  const timer=setTimeout(()=>controller.abort(),15000);
  try{
   const native=terminalNative();
   const [raw,capability]=await Promise.all([latest.current.request(`chats/${selected.conversationId}/terminal`,'GET',undefined,controller.signal),native?.capabilities()??Promise.resolve({available:false,reason:'Update Bob to use the embedded terminal.'})]);
   if(!current(ticket,captured))return;
   if(controller.signal.aborted)throw Error('Expired read');
   const next=terminalStatus(raw);setStatus(next);setEndUnknown(false);
   if(!native||!capability.available){setPhase('unavailable');setMessage(capability.reason??'The native terminal is unavailable in this build.');return;}
   if(!next.available){setPhase('unavailable');setMessage(next.reason??'Mosh is unavailable on this workstation.');return;}
   if(!connectAfter){setPhase('closed');setMessage(next.session?'Session available.':'Session ended.');return;}
   setPhase('starting');
   // The menu selection is admission. Never retry a failed POST on a timer or resume.
   // Preserve its request identity, and share any in-flight request across re-entry.
   let attempt=pending.current;
   if(!attempt||attempt.scope!==captured){attempt={scope:captured,id:uuid()};pending.current=attempt;}
   const saved=attempt;
   if(!saved.promise)saved.promise=latest.current.request(`chats/${selected.conversationId}/terminal`,'POST',{requestId:saved.id});
   let response:unknown;
   try{response=await saved.promise;}finally{saved.promise=undefined;}
   if(!current(ticket,captured))return;
   const connection=terminalConnection(response);
   setStatus({...next,session:{id:connection.sessionId,state:'detached',cwd:connection.cwd}});
   // Only an opaque one-use handle enters React view props. The Mosh key is transient.
   const value=await native.prepare({...connection,...selected,title:'Terminal'});
   if(typeof value!=='string'||!value)throw Error('Preparation unconfirmed');
   if(!current(ticket,captured)){release(value);return;}
   prepared.current=value;pending.current=undefined;setHandle(value);
  }catch(cause){
   if(!current(ticket,captured))return;
   const code=(cause as {httpStatus?:number}|undefined)?.httpStatus;
   if(typeof code==='number'&&code>=400&&code<500&&code!==408&&code!==429)pending.current=undefined;
   setPhase('failed');setMessage('Could not open terminal. Tap Reconnect to try again.');
  }finally{clearTimeout(timer);if(busy.current===ticket)busy.current=undefined;}
 }
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;invalidate();};},[]);
 useEffect(()=>{pending.current=undefined;setStatus(undefined);setEndUnknown(false);},[scope]);
 useEffect(()=>{
  setMore(false);setHandle(undefined);setCtrl(false);setControl(undefined);setMessage('');
  if(visible&&allowed&&target)void check(true);
  return()=>invalidate();
  // App passes an inline request adapter; only a deliberate entry/scope change admits work.
 },[visible,scope,allowed]);
 useEffect(()=>{
  const listener=AppState.addEventListener('change',state=>{
   const active=state==='active';latest.current.foreground=active;setForeground(active);
   if(!active){invalidate();setHandle(undefined);setCtrl(false);setMore(false);setPhase('closed');setMessage('Session paused.');}
  });return()=>listener.remove();
 },[]);
 useEffect(()=>{if(!more)return;const listener=BackHandler.addEventListener('hardwareBackPress',()=>{setMore(false);return true;});return()=>listener.remove();},[more]);
 // React can batch several presses into one render. Keep an ordered bounded FIFO,
 // exposing only its head until native acknowledges admission; never replay on timeout.
 useEffect(()=>{
  if(!handle||!control)return;
  const timer=setTimeout(()=>{
   if(prepared.current===handle&&commands.current[0]?.sequence===control.sequence){clearLocal();setPhase('failed');setMessage('Terminal input stalled. Reconnect to continue.');}
  },5000);
  return()=>clearTimeout(timer);
 },[handle,control]);
 // RN Keyboard.dismiss does not own a WebView textarea's input connection.
 useEffect(()=>{if(visible&&menuOpen)send('keyboard',undefined,false);},[visible,menuOpen]);
 function send(action:TerminalControl['action'],text?:string,enabled?:boolean){
  if(!prepared.current||phase!=='running'||!latest.current.foreground||!latest.current.visible||!latest.current.allowed||scope!==latest.current.scope)return;
  if(commands.current.length>=32){clearLocal();setPhase('failed');setMessage('Terminal input queue is full. Reconnect to continue.');return;}
  const next={sequence:++sequence.current,action,...(text!==undefined?{text}:{}),...(enabled!==undefined?{enabled}:{})};
  commands.current.push(next);
  if(commands.current.length===1)setControl(next);
 }
 function toggleCtrl(){
  let intended=ctrl;
  for(const queued of commands.current){if(queued.action==='ctrl')intended=queued.enabled??!intended;else if(['input','history','paste'].includes(queued.action))intended=false;}
  setCtrl(!intended);send('ctrl',undefined,!intended);
 }
 function nativeState(event:NativeSyntheticEvent<TerminalState>){
  const value=event.nativeEvent;
  if(value.session!==prepared.current||!latest.current.visible||!latest.current.foreground)return;
  if(value.acknowledged!==undefined&&value.acknowledged===commands.current[0]?.sequence){commands.current.shift();setControl(commands.current[0]);}
  if(typeof value.ctrl==='boolean')setCtrl(value.ctrl);
  if(value.phase==='running'){setPhase('running');setMessage('');}
  else if(value.phase==='failed'||value.phase==='closed'){clearLocal();setPhase(value.phase);setMessage('Terminal disconnected.');}
 }
 async function endSession(id:string,captured:string,confirmationGeneration:number){
  const selected=latest.current.target;
  if(!mounted.current||confirmationGeneration!==generation.current||!selected||latest.current.scope!==captured||!latest.current.visible||!latest.current.foreground||!latest.current.allowed||busy.current!==undefined)return;
  const ticket=++generation.current;busy.current=ticket;clearLocal();setPhase('checking');setMessage('');
  try{
   const result=await latest.current.request(`chats/${selected.conversationId}/terminal`,'DELETE',{sessionId:id}) as {ended?:boolean};
   if(!current(ticket,captured))return;
   if(result?.ended!==true)throw Error('Unconfirmed');
   pending.current=undefined;setStatus(previous=>previous?{...previous,session:undefined}:previous);setEndUnknown(false);setPhase('closed');setMessage('Session ended.');
  }catch{if(current(ticket,captured)){setEndUnknown(true);setPhase('failed');setMessage('Could not confirm session closure. Check status before retrying.');}}
  finally{if(busy.current===ticket)busy.current=undefined;}
 }
 function confirmEnd(){
  const id=status?.session?.id,captured=scope,confirmationGeneration=generation.current;if(!id||endUnknown)return;
  setMore(false);
  Alert.alert('End terminal session?','This closes the host shell and can stop programs running inside it. Going back leaves it running.',[{text:'Cancel',style:'cancel'},{text:'End session',style:'destructive',onPress:()=>void endSession(id,captured,confirmationGeneration)}]);
 }
 if(!visible)return null;
 const unavailable=!target?'Select a conversation first.':!allowed?'Terminal is unavailable for this read-only conversation.':undefined;
 const loading=phase==='checking'||phase==='starting',ready=!!handle&&phase==='running'&&foreground;
 const showHeader=!frame.height||frame.height>=240;
 const keyLayout=terminalKeyLayout(frame.width||window.width,window.fontScale),keyRows=Math.ceil(7/keyLayout.columns);
 const keyHeight=keyRows*Math.max(48,keyLayout.faceHeight+8)+(keyRows-1)*4+4;
 // Reserve a readable terminal band before adding keys. They remain available
 // in Controls when the IME/large text leaves too little vertical space.
 const showKeys=!frame.height||frame.height>=(showHeader?headerHeight:0)+footerHeight+keyHeight+64;
 const compactControls=frame.height>0&&frame.height<240;
 const menuRows=[
  {label:'Copy selection',icon:Copy,onPress:()=>send('copy'),disabled:!ready},
  {label:'Paste',icon:ClipboardPaste,onPress:()=>send('paste'),disabled:!ready},
  {label:'History',icon:History,onPress:()=>send('history'),disabled:!ready},
  {label:'Reconnect',icon:RefreshCw,onPress:()=>void check(true),disabled:loading||!!unavailable||endUnknown||!foreground},
  {label:'End session',icon:Trash2,onPress:confirmEnd,disabled:loading||!status?.session||endUnknown},
 ];
 return <View testID="terminal-screen" onLayout={event=>{const {width,height}=event.nativeEvent.layout;if(Number.isFinite(width)&&width>0&&Number.isFinite(height)&&height>=0)setFrame({width,height});}} style={[styles.root,{bottom:bottomInset}]}>
  <View style={styles.workspace} accessibilityElementsHidden={more} importantForAccessibility={more?'no-hide-descendants':'auto'}>
   <View testID="terminal-header-container" onLayout={event=>{const h=event.nativeEvent.layout.height;if(Number.isFinite(h)&&h>0)setHeaderHeight(h);}} style={!showHeader&&styles.hidden}><TerminalHeader workstation={workstation}/></View>
   <View testID="terminal-viewport" style={styles.viewport}>
    {handle&&!unavailable&&<NativeTerminal testID="embedded-terminal" collapsable={false} session={handle} active={visible&&foreground} control={control} onState={nativeState} style={styles.native}/>}
    {(!handle||unavailable)&&<ScrollView contentContainerStyle={styles.empty} keyboardShouldPersistTaps="handled">
     {loading&&!unavailable?<><ActivityIndicator color={colors.foreground} accessibilityLabel="Opening terminal"/><Text typography="ui" style={styles.message}>Connecting…</Text></>:<>
      {!!(unavailable||message)&&<Text typography="ui" accessibilityLiveRegion="polite" style={styles.message}>{unavailable||message}</Text>}
      {!unavailable&&<SectionAction label={endUnknown?'Check status':'Reconnect'} disabled={!foreground} onPress={()=>void check(!endUnknown)}/>}
     </>}
    </ScrollView>}
   </View>
   {handle&&showKeys&&<TerminalKeyRow ready={ready} ctrl={ctrl} onCtrl={toggleCtrl} onInput={value=>send('input',value)}/>}
   <View testID="terminal-footer-container" onLayout={event=>{const h=event.nativeEvent.layout.height;if(Number.isFinite(h)&&h>0)setFooterHeight(h);}}><SectionActions menu={menu} onBack={()=>{Keyboard.dismiss();onBack();}}>
    <RoundAction label="Show terminal keyboard" icon={KeyboardIcon} onPress={()=>send('keyboard')} disabled={!ready}/>
    <RoundAction label="Terminal controls" icon={Ellipsis} onPress={()=>{if(!showKeys)send('keyboard',undefined,false);setMore(true);}} disabled={!!unavailable}/>
   </SectionActions></View>
  </View>
  {more&&<View testID="terminal-controls" accessibilityViewIsModal style={styles.moreOverlay}>
   <Pressable accessibilityLabel="Close terminal controls" onPress={()=>setMore(false)} style={StyleSheet.absoluteFill}/>
   <View style={[styles.morePanel,compactControls&&styles.compactPanel]}>
    <View style={[styles.moreHeading,compactControls&&styles.compactHeading]}>{(!frame.height||frame.height>=160)&&<Text typography="ui" style={styles.moreTitle}>Terminal controls</Text>}<RoundAction label="Close controls" icon={X} onPress={()=>setMore(false)}/></View>
    <ScrollView keyboardShouldPersistTaps="always">
     {handle&&<TerminalKeyRow ready={ready} ctrl={ctrl} onCtrl={()=>{setMore(false);toggleCtrl();}} onInput={value=>{setMore(false);send('input',value);}}/>}
     {menuRows.map(({label,icon:Icon,onPress,disabled})=><Button key={label} variant="ghost" accessibilityLabel={label} disabled={disabled} onPress={()=>{setMore(false);onPress();}} style={[styles.menuRow,disabled&&styles.disabled]}><Icon size={20} color={colors.foreground}/><Text typography="ui" style={styles.menuText}>{label}</Text></Button>)}
    </ScrollView>
   </View>
  </View>}
 </View>;
}
const stylesTheme=themed(theme=>{const {colors}=theme;return StyleSheet.create({
 root:{position:'absolute',top:0,right:0,bottom:0,left:0,zIndex:25,backgroundColor:colors.background},workspace:{flex:1},viewport:{flex:1,minHeight:0},native:{flex:1},empty:{flexGrow:1,justifyContent:'center',alignItems:'center',padding:20,gap:16},message:{fontSize:15,lineHeight:23,color:colors.muted,textAlign:'center'},
 disabled:{opacity:0.4},hidden:{display:'none'},compactPanel:{maxHeight:'100%',padding:8,paddingBottom:8},compactHeading:{paddingBottom:2,justifyContent:'flex-end'},
 moreOverlay:{...StyleSheet.absoluteFill,justifyContent:'flex-end',backgroundColor:'#00000088'},morePanel:{maxHeight:'90%',backgroundColor:colors.background,borderColor:colors.border,borderWidth:1,borderTopLeftRadius:24,borderTopRightRadius:24,padding:16,paddingBottom:20},moreHeading:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8,paddingBottom:8},moreTitle:{fontSize:18,lineHeight:26,color:colors.foreground,flexShrink:1},menuRow:{minHeight:52,height:'auto',paddingVertical:12,paddingHorizontal:12,flexDirection:'row',justifyContent:'flex-start',gap:14,borderRadius:16},menuText:{fontSize:16,lineHeight:24,color:colors.foreground,flexShrink:1},
});});
