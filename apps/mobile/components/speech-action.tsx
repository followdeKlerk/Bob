import React,{useEffect,useRef,useSyncExternalStore} from 'react';
import {Volume2,Square} from 'lucide-react-native';
import {ActionIcon} from './message-actions';
import {speechSnapshot,subscribeSpeech,startSpeech,stopSpeech,speechText} from '../speech';
let sequence=0;
export function SpeechAction({text}:{text:string}){
 const id=useRef<string>('');if(!id.current)id.current=`speech-${++sequence}`;
 const active=useSyncExternalStore(subscribeSpeech,speechSnapshot,speechSnapshot)===id.current;
 useEffect(()=>()=>{void stopSpeech(id.current);},[text]);
 return <ActionIcon icon={active?Square:Volume2} label={active?'Stop reading':'Read aloud'} selected={active} disabled={!speechText(text)} onPress={()=>void(active?stopSpeech(id.current):startSpeech(id.current,text))}/>;
}
