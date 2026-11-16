import React,{useLayoutEffect,useRef,useState} from 'react';
import {Alert} from 'react-native';
import {Mic,Square,X} from 'lucide-react-native';
import {Button} from './ui/button';
import {useTheme} from '../theme';
import {connectVoiceInput,VoiceInputSession,type VoicePhase} from '../voice-input';

type Props={disabled:boolean;active:boolean;scope:string;onTranscript:(text:string)=>void;onError?:(message:string)=>void};
export function VoiceInputButton({disabled,active,scope,onTranscript,onError}:Props){
 const {colors}=useTheme();
 const [phase,setPhase]=useState<VoicePhase>('idle');
 const callbacks=useRef({onTranscript,onError});
 const session=useRef<VoiceInputSession|null>(null);
 if(!session.current)session.current=new VoiceInputSession(setPhase,text=>callbacks.current.onTranscript(text),message=>{
  if(callbacks.current.onError)callbacks.current.onError(message);
  else Alert.alert('Dictation',message);
 });
 const voice=session.current;
 useLayoutEffect(()=>connectVoiceInput(voice),[voice]);
 useLayoutEffect(()=>{callbacks.current={onTranscript,onError};voice.configure(scope,active&&!disabled);},[voice,scope,active,disabled,onTranscript,onError]);
 const listening=phase==='listening';
 const label=listening?'Finish dictation':phase==='preparing'?'Cancel dictation setup':phase==='finishing'?'Cancel dictation':'Dictate message';
 const Icon=listening?Square:phase==='idle'?Mic:X;
 return <Button variant="ghost" size="icon" disabled={disabled||!active} accessibilityLabel={label}
  accessibilityHint={listening?'Microphone on. Tap to finish, or hold to cancel without inserting text.':phase==='idle'?'Speak one utterance into the draft. Nothing is sent.':'Tap to cancel without inserting text.'}
  accessibilityState={{disabled:disabled||!active,selected:phase!=='idle'}}
  onPress={()=>void voice.press()} onLongPress={()=>voice.cancel()}
  style={{width:48,height:48,padding:0,flexShrink:0,borderRadius:24,borderWidth:phase==='idle'?0:2,borderColor:colors.accent,backgroundColor:phase==='idle'?'transparent':colors.selectedSurface,opacity:disabled||!active?0.4:1}}>
  <Icon size={20} strokeWidth={1.8} color={phase==='idle'?colors.muted:colors.accent}/>
 </Button>;
}
