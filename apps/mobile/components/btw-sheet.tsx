import {MenuTheme,withMenuTheme,ChatTheme,useChatTheme} from '../menu-theme';
import {useOverlayHost,useOverlayHostAvailable,useOverlayKeyboardClearance} from './overlay-host';
import React,{useEffect,useRef,useState} from 'react';
import {Alert,Animated,AppState,Keyboard,KeyboardAvoidingView,Modal,Platform,ScrollView,StyleSheet,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {ArrowUp,Plus,RefreshCw,Square,Trash2,X} from 'lucide-react-native';
import {v4 as uuid} from 'uuid';
import {Text,TextInput} from './app-text';
import {ChatMarkdown} from './chat-markdown';
import {RoundAction,SectionActions,SectionBody} from './section-ui';
import {useTheme} from '../theme';
import {useModalTransition} from './modal-transition';
const AnimatedSafeAreaView=Animated.createAnimatedComponent(SafeAreaView);
import {BtwSession,type BtwRequest,type BtwState} from '../btw';

type Props={visible:boolean;active:boolean;conversationId:number;initial?:{id:string;text:string};request:BtwRequest;onClose:()=>void};
/** A separate native workspace; underlying chat and its running task stay mounted.
 * Closing hides, not cancels. Side state is intentionally process-local. */
function BtwSheetContent({visible,active,conversationId,initial,request,onClose}:Props){
 const {colors}=useTheme(),chatColors=useChatTheme().colors;
 const transport=useRef(request);transport.current=request;
 const [session]=useState(()=>new BtwSession(`chats/${conversationId}/btw`,(...args)=>transport.current(...args),uuid));
 const [state,setState]=useState<BtwState>(session.state),[draft,setDraft]=useState('');
 const [foreground,setForeground]=useState(AppState.currentState==='active');
 const list=useRef<React.ComponentRef<typeof ScrollView>>(null),following=useRef(true),handled=useRef(''),queued=useRef<{id:string;text:string}|undefined>(undefined);
 const displayed=visible&&active,thread=state.thread,transition=useModalTransition(displayed,active),hostAvailable=useOverlayHostAvailable(),overlayKeyboard=useOverlayKeyboardClearance();
 const running=!!thread?.messages.some(message=>message.status==='running');
 const lastReceipt=thread?.messages.at(-1);
 useEffect(()=>{if(lastReceipt)setDraft(current=>current.trim()===lastReceipt.question?'':current);},[lastReceipt?.requestId]);
 useEffect(()=>session.subscribe(setState),[session]);
 useEffect(()=>()=>session.dispose(),[session]);
 useEffect(()=>{const sub=AppState.addEventListener('change',value=>setForeground(value==='active'));return()=>sub.remove();},[]);
 useEffect(()=>{
  if(!displayed||!foreground)return;
  if(initial&&handled.current!==initial.id){handled.current=initial.id;if(initial.text){setDraft(initial.text);queued.current=initial;}}
  void session.open();
 },[displayed,foreground,initial?.id,session]);
 useEffect(()=>{
  if(!displayed||!foreground||!thread||state.busy||!queued.current)return;
  const next=queued.current;queued.current=undefined;
  if(running||state.uncertain)return; // Keep the supplied text editable, not silently queued.
  void session.send(next.text).then(accepted=>{if(accepted)setDraft(current=>current===next.text?'':current);});
 },[displayed,foreground,thread?.id,state.busy,session,running,state.uncertain]);
 useEffect(()=>{
  if(!displayed||!foreground||!thread||(!running&&!state.uncertain))return;
  let alive=true,timer:ReturnType<typeof setTimeout>;
  const poll=()=>{timer=setTimeout(async()=>{await session.check();if(alive)poll();},1800);};
  poll();return()=>{alive=false;clearTimeout(timer);};
 },[displayed,foreground,thread?.id,running,state.uncertain,session]);
 const close=()=>{Keyboard.dismiss();onClose();};
 const send=()=>{const text=draft.trim();if(!text)return;following.current=true;void session.send(text).then(accepted=>{if(accepted)setDraft(current=>current.trim()===text?'':current);});};
 const clearThreads=()=>Alert.alert('Clear temporary side chats?','Discard all temporary side chats for this paired device on this backend, including other conversations, and start fresh here. Running side replies will be cancelled; main tasks are unaffected.',[{text:'Keep them',style:'cancel'},{text:'Clear side chats',style:'destructive',onPress:()=>{queued.current=undefined;setDraft('');following.current=true;void session.discardAll();}}]);
 const newThread=()=>Alert.alert('New side chat?','Discard this temporary thread and take a fresh snapshot of the main chat. Any side response still running will be cancelled. The main task is unaffected.',[{text:'Keep this one',style:'cancel'},{text:'New side chat',onPress:()=>{queued.current=undefined;setDraft('');following.current=true;void session.reset();}}]);
 const overlay=<MenuTheme>  {/* Android Modal resizes its own window for the IME; don't apply Activity insets twice. */}
  <KeyboardAvoidingView pointerEvents={displayed?'auto':'none'} accessibilityElementsHidden={!displayed} importantForAccessibility={displayed?'auto':'no-hide-descendants'} enabled={Platform.OS==='ios'} behavior="padding" style={[{flex:1,justifyContent:'flex-end'},hostAvailable&&Platform.OS==='android'&&{paddingBottom:overlayKeyboard??0}]}>
   <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill,{backgroundColor:'#00000088'},transition.backdrop]}/>
   <AnimatedSafeAreaView edges={['top','bottom']} testID="btw-sheet" style={[{height:'90%',backgroundColor:colors.background,borderTopLeftRadius:22,borderTopRightRadius:22,borderWidth:1,borderColor:colors.border},transition.panel]}>
    <View style={{paddingHorizontal:18,paddingTop:15,paddingBottom:8,gap:5}}>
     <Text accessibilityRole="header" style={{fontSize:23,fontWeight:'600'}}>BTW · side chat</Text>
     <Text style={{fontSize:13,lineHeight:19,color:colors.muted}}>Main task continues · no tools · not added to main chat</Text>
     {thread&&<Text testID="btw-model" style={{fontSize:12,lineHeight:18,color:colors.muted}}>{thread.model.provider} / {thread.model.modelId}{thread.thinkingLevel?` · ${thread.thinkingLevel}`:''}</Text>}
    </View>
    <SectionBody footer={<View style={{paddingHorizontal:12,paddingTop:7,paddingBottom:8,gap:7}}>
     {!!state.error&&<Text testID="btw-error" accessibilityLiveRegion="polite" style={{fontSize:13,lineHeight:19,color:colors.foreground}}>{state.error}</Text>}
     <View style={{flexDirection:'row',alignItems:'flex-end',gap:8,borderWidth:1,borderColor:colors.border,borderRadius:22,padding:8,backgroundColor:colors.composer}}>
      <TextInput testID="btw-draft" accessibilityLabel="Side question" multiline maxLength={4000} value={draft} onChangeText={setDraft} editable={!state.busy&&!state.uncertain} placeholder="Ask a side question…" style={{flex:1,minWidth:0,fontSize:15,lineHeight:21,minHeight:39,maxHeight:120,paddingHorizontal:5,paddingVertical:7}}/>
      <RoundAction icon={ArrowUp} label="Send side question" disabled={!thread||state.busy||state.uncertain||running||!draft.trim()} onPress={send}/>
     </View>
     <SectionActions overlay leading={<RoundAction icon={X} label="Close side chat" onPress={close}/>}>
      <RoundAction icon={Plus} label="New side chat" disabled={state.busy} onPress={newThread}/>
      <RoundAction icon={Trash2} label="Clear temporary side chats" disabled={state.busy} onPress={clearThreads}/>
      <RoundAction icon={RefreshCw} label={thread?'Check side-chat status':'Open side chat'} disabled={state.busy} onPress={()=>void(thread?session.check():session.open())}/>
      {(running||state.uncertain)&&<RoundAction icon={Square} label="Stop side response" disabled={state.busy} onPress={()=>void session.cancel()}/>}
     </SectionActions>
    </View>}>{clearance=><ChatTheme><ScrollView style={{backgroundColor:chatColors.background}} ref={list} testID="btw-messages" keyboardShouldPersistTaps="handled" contentContainerStyle={{paddingHorizontal:16,paddingTop:10,paddingBottom:clearance+12,gap:12}} onScroll={event=>{const {contentSize,contentOffset,layoutMeasurement}=event.nativeEvent;following.current=contentSize.height-contentOffset.y-layoutMeasurement.height<80;}} scrollEventThrottle={100} onContentSizeChange={()=>{if(following.current)list.current?.scrollToEnd({animated:false});}}>
     <Text style={{fontSize:13,lineHeight:19,color:chatColors.muted}}>{thread?`Recent saved text snapshot · ${thread.snapshot.characters.toLocaleString()} characters${thread.snapshot.truncated?' · older text omitted':''}. Live output, tools and attachments are not included.`:'Opening a temporary side conversation…'} Normal provider usage applies. Side history is not saved across app or backend restarts.</Text>
     {thread?.messages.map(message=><View key={message.requestId} style={{gap:10}}>
      <View style={{alignSelf:'flex-end',maxWidth:'95%',borderRadius:18,borderBottomRightRadius:5,backgroundColor:chatColors.ownerBubble,padding:12}}><Text selectable style={{fontSize:16,lineHeight:23}}>{message.question}</Text></View>
      {message.answer&&<View style={{alignSelf:'flex-start',maxWidth:'100%',borderRadius:18,borderBottomLeftRadius:5,backgroundColor:chatColors.assistantBubble,padding:12}}><ChatMarkdown text={message.answer}/></View>}
      {message.status!=='done'&&<Text accessibilityLiveRegion="polite" style={{fontSize:13,lineHeight:20,color:chatColors.muted}}>{message.status==='running'?'Answering your side question…':message.status==='cancelled'?'Side response stopped.':message.error??'Side response failed. No automatic retry was made.'}</Text>}
     </View>)}
    </ScrollView></ChatTheme>}</SectionBody>
   </AnimatedSafeAreaView>
  </KeyboardAvoidingView>
 </MenuTheme>;
 const hosted=useOverlayHost(displayed,transition.mounted,overlay,()=>{if(displayed)close();});
 return hosted?null:<Modal visible={displayed} transparent animationType="none" onRequestClose={()=>{if(displayed)close();}}>{overlay}</Modal>;
}

export const BtwSheet=withMenuTheme(BtwSheetContent);
