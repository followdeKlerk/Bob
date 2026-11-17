import React,{useSyncExternalStore} from 'react';
import {subscribeSpeech,speechState,stopSpeech} from '../speech';
import {Alert,Pressable,View,useWindowDimensions} from 'react-native';
import {voicePanelMetrics} from '../composer-geometry';
import {Headphones,Mic,Square,X,Settings2,Volume2,Clock} from 'lucide-react-native';
import {Button} from './ui/button';
import {Text} from './app-text';
import {useTheme} from '../theme';
import type {VoiceChatSession,VoiceChatState} from '../voice-chat';
import {useSpeechOptions} from './speech-options';

export function VoiceChatButton({state,session,disabled}:{state:VoiceChatState;session:VoiceChatSession;disabled:boolean}){
 const {colors}=useTheme();
 const options=useSpeechOptions(session.capture);
 const capturing=['preparing','listening','finishing','external'].includes(state.phase);
 const label=state.phase==='listening'?'Finish speaking to Bob':capturing?'Cancel voice capture':state.open?'Speak to Bob':'Start Voice Chat';
 const Icon=state.phase==='listening'?Square:capturing?X:Headphones;
 const blocked=disabled||state.phase==='waiting';
 return <>{options}<Button variant="ghost" size="icon" accessibilityLabel={label} accessibilityState={{disabled:blocked,selected:state.open}}
  accessibilityHint="Voice Chat automatically sends your finished speech as its own message and reads the completed reply. Tap again for each new turn. Draft dictation is the separate microphone."
  disabled={blocked} onPress={()=>void session.press()} style={{width:48,height:48,padding:0,flexShrink:0,borderRadius:24,borderWidth:state.open?2:0,borderColor:colors.accent,backgroundColor:state.open?colors.selectedSurface:'transparent',opacity:blocked?0.4:1}}>
  <Icon size={20} strokeWidth={1.8} color={state.open?colors.accent:colors.muted}/>
 </Button></>;
}
export function VoiceChatPanel({state,session,maxHeight}:{state:VoiceChatState;session:VoiceChatSession;maxHeight:number}){
 const {colors}=useTheme();
 const metrics=voicePanelMetrics(useWindowDimensions().fontScale);
 if(!state.open||maxHeight<=0)return null;
 const phases={idle:'Tap headphones to speak',preparing:'Preparing microphone',listening:'Listening · auto-send',finishing:'Finishing recognition',external:'Chosen speech screen',waiting:'Waiting for reply',speaking:'Reading reply',error:'Voice needs attention'};
 const error=state.phase==='error'?state.message:undefined;
 const livePhase=error?`Voice error · tap for details\n${error}`:state.message??phases[state.phase];
 // Normal copy is accessibility metadata only; errors retain their visible disclosure.
 const StatusIcon=state.phase==='listening'?Mic:state.phase==='speaking'?Volume2:['preparing','finishing','waiting'].includes(state.phase)?Clock:Headphones;
 const iconStyle={width:48,height:48,minWidth:48,minHeight:48,padding:0,flexShrink:0};
 return <View testID="voice-chat-panel" style={{maxHeight}}>
  {error?<Pressable disabled={false} accessible accessibilityRole="button" accessibilityLabel="Read full voice error" accessibilityHint="Opens the complete error and recovery steps." hitSlop={8} onPress={()=>Alert.alert('Voice error',error,[{text:'Close'}])} style={{paddingHorizontal:12,paddingTop:8,maxHeight:metrics.phase}}>
   <Text testID="voice-chat-phase" accessibilityRole="header" accessibilityLabel={`Voice Chat: ${livePhase}`} accessibilityLiveRegion="polite" numberOfLines={2} style={{color:colors.foreground,fontSize:13,lineHeight:18}}>{livePhase}</Text>
  </Pressable>:<View testID="voice-chat-phase" accessible accessibilityRole="text" accessibilityLabel={`Voice Chat: ${livePhase}${state.partial?`\n${state.partial}`:''}`} accessibilityHint={state.provider} accessibilityLiveRegion="polite" style={{height:metrics.phase,alignItems:'center',justifyContent:'center'}}>
   <View testID="voice-chat-state-icon" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{width:32,height:32,borderRadius:16,borderWidth:state.phase==='listening'?2:0,borderColor:colors.accent,backgroundColor:state.phase==='listening'?colors.selectedSurface:'transparent',alignItems:'center',justifyContent:'center'}}>
    <StatusIcon size={20} color={colors.accent}/>
   </View>
  </View>}
  <View testID="voice-chat-fixed-controls" style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:12}}>
   <Button variant="ghost" size="icon" accessibilityLabel="Stop voice" accessibilityHint="Stop capture or reading without cancelling backend work." onPress={()=>void session.stop()} style={iconStyle}><Square size={20} color={colors.accent}/></Button>
   <Button variant="ghost" size="icon" accessibilityLabel="Speech options" disabled={state.phase==='waiting'} accessibilityState={{disabled:state.phase==='waiting'}} onPress={()=>void session.press(true)} style={iconStyle}><Settings2 size={20} color={colors.accent}/></Button>
   <Button variant="ghost" size="icon" accessibilityLabel="Exit Voice Chat" accessibilityHint="Close Voice Chat without cancelling backend work." onPress={()=>session.cancel(true)} style={iconStyle}><X size={20} color={colors.accent}/></Button>
  </View>
 </View>;
}

/** Recovery is not owned by a virtualized reply cell or even an open voice panel. */
export function SpeechRecoveryControl({maxHeight=180}:{maxHeight?:number}){
 const {colors}=useTheme();
 const state=useSyncExternalStore(subscribeSpeech,speechState,speechState);
 if(state.phase!=='stop-unconfirmed')return null;
 return <View testID="speech-stop-recovery" style={{paddingHorizontal:12,paddingTop:8,maxHeight}}>
  <Text numberOfLines={2} accessibilityLiveRegion="polite" accessibilityLabel="Audio cleanup is unconfirmed. Microphone capture is blocked until cleanup succeeds." style={{color:colors.foreground,fontSize:13,lineHeight:18}}>Audio cleanup unconfirmed.</Text>
  <Button variant="ghost" accessibilityLabel="Retry stopping playback" onPress={()=>void stopSpeech()} style={{minHeight:48,height:'auto',minWidth:48,paddingHorizontal:12,paddingVertical:8}}><Text style={{color:colors.accent,fontSize:13,lineHeight:18}}>Retry Stop</Text></Button>
 </View>;
}
