import {useLayoutEffect,useRef,useState} from 'react';
import {AppState,Platform} from 'react-native';
import {connectVoiceInput} from './voice-input';
import {subscribeSpeech} from './speech';
import {VoiceChatSession,type VoiceChatPort,type VoiceChatState} from './voice-chat';

export function useVoiceChat({scope,active,foreground,snapshot,port}:{scope:string;active:boolean;foreground:boolean;snapshot:unknown;port:VoiceChatPort}){
 const callbacks=useRef(port);callbacks.current=port;
 const [state,setState]=useState<VoiceChatState>({open:false,phase:'idle',partial:'',external:false});
 const ref=useRef<VoiceChatSession|null>(null);
 if(!ref.current)ref.current=new VoiceChatSession(setState,{
  send:(text,current)=>callbacks.current.send(text,current),
  read:(path,interest,signal)=>callbacks.current.read(path,interest,signal),
  sameDevice:interest=>callbacks.current.sameDevice(interest),
 });
 const session=ref.current;
 useLayoutEffect(()=>{
  session.attach();
  const disconnect=connectVoiceInput(session.capture);
  const speech=subscribeSpeech(()=>session.speechChanged());
  const app=AppState.addEventListener('change',value=>{if(value!=='active')session.background();});
  const blur=Platform.OS==='android'?AppState.addEventListener('blur',()=>session.blur()):undefined;
  return()=>{session.dispose();disconnect();speech();app.remove();blur?.remove();};
 },[session]);
 useLayoutEffect(()=>session.configure(scope,active,foreground||AppState.currentState==='active'),[session,scope,active,foreground]);
 useLayoutEffect(()=>session.wake(),[session,snapshot]);
 return {state,session};
}
