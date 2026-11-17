import React,{useSyncExternalStore} from 'react';
import {subscribeSpeech,speechState,stopSpeech} from '../speech';
import {ScrollView,View} from 'react-native';
import {Headphones,Square,X} from 'lucide-react-native';
import {Button} from './ui/button';
import {Text} from './app-text';
import {useTheme} from '../theme';
import type {VoiceChatSession,VoiceChatState} from '../voice-chat';

export function VoiceChatButton({state,session,disabled}:{state:VoiceChatState;session:VoiceChatSession;disabled:boolean}){
 const {colors}=useTheme();
 const capturing=['preparing','listening','finishing','external'].includes(state.phase);
 const label=state.phase==='listening'?'Finish speaking to Bob':capturing?'Cancel voice capture':state.open?'Speak to Bob':'Start Voice Chat';
 const Icon=state.phase==='listening'?Square:capturing?X:Headphones;
 const blocked=disabled||state.phase==='waiting';
 return <Button variant="ghost" size="icon" accessibilityLabel={label} accessibilityState={{disabled:blocked,selected:state.open}}
  accessibilityHint="Voice Chat automatically sends your finished speech as its own message and reads the completed reply. Tap again for each new turn. Draft dictation is the separate microphone."
  disabled={blocked} onPress={()=>void session.press()} style={{width:48,height:48,padding:0,flexShrink:0,borderRadius:24,borderWidth:state.open?2:0,borderColor:colors.accent,backgroundColor:state.open?colors.selectedSurface:'transparent',opacity:blocked?0.4:1}}>
  <Icon size={20} strokeWidth={1.8} color={state.open?colors.accent:colors.muted}/>
 </Button>;
}
export function VoiceChatPanel({state,session,maxHeight}:{state:VoiceChatState;session:VoiceChatSession;maxHeight:number}){
 const {colors}=useTheme();
 if(!state.open)return null;
 const phases={idle:'Tap the headphones to speak',preparing:'Preparing microphone…',listening:'Listening — sends automatically when you finish',finishing:'Finishing recognition…',external:'Using your chosen speech screen…',waiting:'Waiting for the completed reply…',speaking:'Reading the completed reply…',error:'Voice needs attention'};
 const action=(label:string,onPress:()=>void,disabled=false)=><Button variant="ghost" disabled={disabled} accessibilityLabel={label} onPress={onPress} style={{minHeight:48,height:'auto',minWidth:48,paddingHorizontal:12,paddingVertical:8,flexShrink:1}}><Text numberOfLines={2} style={{color:colors.accent,fontSize:13,flexShrink:1}}>{label}</Text></Button>;
 return <View testID="voice-chat-panel" style={{maxHeight}}><ScrollView style={{maxHeight:Math.max(40,maxHeight-80)}} contentContainerStyle={{paddingHorizontal:12,paddingTop:8,paddingBottom:4,gap:4}} keyboardShouldPersistTaps="handled">
  <Text style={{color:colors.muted,fontSize:12}}>One utterance sends a new message; Bob reads its completed reply. Your draft stays separate. Tap for every new capture.</Text>
  <Text accessibilityRole="header" style={{color:colors.foreground,fontSize:13}}>Voice Chat · {phases[state.phase]}</Text>
  {!!state.provider&&<Text style={{color:colors.muted,fontSize:12}}>{state.provider}</Text>}
  {!!state.partial&&<Text testID="voice-chat-partial" accessibilityLabel={state.partial} numberOfLines={3} style={{color:colors.foreground,fontSize:13}}>{state.partial}</Text>}
  {!!state.message&&<Text testID="voice-chat-message" accessibilityLiveRegion="polite" style={{color:colors.muted,fontSize:12}}>{state.message}</Text>}
  <View style={{flexDirection:'row',flexWrap:'wrap'}}>
   {action('Speech options',()=>void session.press(true),state.phase==='waiting')}
   {state.phase==='error'&&session.canUseProviderVoice()&&action('Allow provider voice once',()=>void session.allowProviderVoice())}
  </View>
 </ScrollView><View testID="voice-chat-fixed-controls" style={{flexDirection:'row',justifyContent:'space-between',paddingHorizontal:12}}>
  {action('Stop voice',()=>void session.stop())}
  {action('Exit Voice Chat',()=>session.cancel(true))}
 </View></View>;
}

/** Recovery is not owned by a virtualized reply cell or even an open voice panel. */
export function SpeechRecoveryControl(){
 const {colors}=useTheme();
 const state=useSyncExternalStore(subscribeSpeech,speechState,speechState);
 if(state.phase!=='stop-unconfirmed')return null;
 return <View testID="speech-stop-recovery" style={{paddingHorizontal:12,paddingTop:8,maxHeight:180}}>
  <Text numberOfLines={3} accessibilityLiveRegion="polite" accessibilityLabel="Audio cleanup is unconfirmed. Microphone capture is blocked until cleanup succeeds." style={{color:colors.foreground,fontSize:13}}>Audio cleanup unconfirmed. Retry before speaking.</Text>
  <Button variant="ghost" accessibilityLabel="Retry stopping playback" onPress={()=>void stopSpeech()} style={{minHeight:48,height:'auto',minWidth:48,padding:12}}><Text style={{color:colors.accent,fontSize:13}}>Retry Stop</Text></Button>
 </View>;
}
