import {useModalTransition} from './modal-transition';
import {useOverlayHost} from './overlay-host';
import React,{useLayoutEffect,useRef,useState} from 'react';
import {Animated,AppState,Modal,ScrollView,StyleSheet,View,useWindowDimensions} from 'react-native';
import {Mic,Square,X} from 'lucide-react-native';
import {Button} from './ui/button';
import {useTheme} from '../theme';
import {Text} from './app-text';
import {connectVoiceInput,VoiceInputSession,type VoicePhase} from '../voice-input';
import {useSpeechOptions} from './speech-options';

type Props={disabled:boolean;active:boolean;scope:string;onTranscript:(text:string)=>void;onError?:(message:string)=>void;onBegin?:()=>void;onExternalChange?:(external:boolean)=>void};
export function VoiceInputButton({disabled,active,scope,onTranscript,onError,onBegin,onExternalChange}:Props){
 const {colors}=useTheme();

 const [phase,setPhase]=useState<VoicePhase>('idle');
 const [failure,setFailure]=useState<{scope:string;message:string}|null>(null);
 const recovery=useRef<typeof failure>(null);
 const live=useRef({scope,active,disabled});live.current={scope,active,disabled};
 const close=()=>{recovery.current=null;setFailure(null);};
 const callbacks=useRef({onTranscript,onError,onExternalChange,onBegin});
 const session=useRef<VoiceInputSession|null>(null);
 if(!session.current)session.current=new VoiceInputSession(setPhase,text=>callbacks.current.onTranscript(text),message=>{
  callbacks.current.onError?.(message);
  const current=live.current;
  if(current.active&&!current.disabled&&AppState.currentState==='active'){
   const entry={scope:current.scope,message};recovery.current=entry;setFailure(entry);
  }
 },undefined,details=>callbacks.current.onExternalChange?.(details.external));
 const voice=session.current;
 const options=useSpeechOptions(voice);
 useLayoutEffect(()=>connectVoiceInput(voice),[voice]);
 useLayoutEffect(()=>{const app=AppState.addEventListener('change',value=>{if(value!=='active')close();});return()=>app.remove();},[]);
 useLayoutEffect(()=>{callbacks.current={onTranscript,onError,onExternalChange,onBegin};if(failure&&(failure.scope!==scope||!active||disabled))close();voice.configure(scope,active&&!disabled);},[voice,scope,active,disabled,onTranscript,onError,onExternalChange,onBegin,failure]);
 const listening=phase==='listening';
 const label=listening?'Finish dictation':phase==='preparing'?'Cancel dictation setup':phase==='finishing'?'Cancel dictation':'Dictate message';
 const Icon=listening?Square:phase==='idle'?Mic:X;
 const {height}=useWindowDimensions();
 const shown=failure?.scope===scope&&active&&!disabled?failure:null;
 const lastShown=useRef<typeof shown>(null);if(shown)lastShown.current=shown;
 const transition=useModalTransition(!!shown,active&&!disabled);
 const overlay=<View pointerEvents={shown?'auto':'none'} style={{flex:1,justifyContent:'center',paddingHorizontal:16}}><Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill,{backgroundColor:'rgba(0,0,0,0.7)'},transition.backdrop]}/>
   <Animated.View testID="dictation-recovery" style={[{backgroundColor:colors.background,borderWidth:1,borderColor:colors.border,borderRadius:16,maxHeight:Math.max(0,height-48),padding:16,gap:12},transition.panel]}>
    <Text accessibilityRole="header" style={{color:colors.foreground,fontSize:20}}>Dictation needs attention</Text>
    <ScrollView style={{flexShrink:1,minHeight:0}}><Text style={{color:colors.foreground,fontSize:16,lineHeight:24}}>{lastShown.current?.message}</Text></ScrollView>
    <View style={{flexDirection:'row',gap:8}}>
     <Button variant="outline" accessibilityLabel="Close dictation recovery" onPress={close} style={{flex:1,minHeight:48,minWidth:48,height:'auto',paddingLeft:8,paddingRight:8,paddingTop:8,paddingBottom:8,borderColor:colors.border}}><Text style={{color:colors.foreground}}>Close</Text></Button>
     <Button variant="outline" accessibilityLabel="Open speech options from dictation recovery" onPress={()=>{if(!shown||recovery.current!==shown||live.current.scope!==shown.scope||!live.current.active||live.current.disabled||AppState.currentState!=='active')return;close();callbacks.current.onBegin?.();void voice.press(true);}} style={{flex:1,minHeight:48,minWidth:48,height:'auto',paddingLeft:8,paddingRight:8,paddingTop:8,paddingBottom:8,borderColor:colors.border}}><Text style={{color:colors.foreground}}>Speech options</Text></Button>
    </View>
   </Animated.View>
  </View>
 ;
 const hosted=useOverlayHost(!!shown,transition.mounted,overlay,()=>{if(shown)close();});
 return <>{options}{!hosted&&<Modal visible={!!shown} transparent animationType="none" onRequestClose={close} accessibilityViewIsModal>{overlay}</Modal>}<Button variant="ghost" size="icon" disabled={disabled||!active} accessibilityLabel={label}
  accessibilityHint={listening?'Microphone on. Tap to finish, or hold to cancel without inserting text.':phase==='idle'?'Speak one utterance into the draft. Nothing is sent.':'Tap to cancel without inserting text.'}
  accessibilityState={{disabled:disabled||!active,selected:phase!=='idle'}}
  onPress={()=>{close();if(phase==='idle')onBegin?.();void voice.press();}} onLongPress={()=>{close();voice.cancel();}}
  style={{width:48,height:48,padding:0,flexShrink:0,borderRadius:24,borderWidth:phase==='idle'?0:2,borderColor:colors.accent,backgroundColor:phase==='idle'?'transparent':colors.selectedSurface,opacity:disabled||!active?0.4:1}}>
  <Icon size={20} strokeWidth={1.8} color={phase==='idle'?colors.muted:colors.accent}/>
 </Button></>;
}
