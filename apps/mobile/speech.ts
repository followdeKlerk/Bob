import {Alert,NativeEventEmitter,NativeModules} from 'react-native';

/** Read visible prose, not Markdown syntax or fenced code. Original reply is unchanged. */
export function speechText(text:string):string {
 return text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g,' Code block omitted. ')
  .replace(/!\[([^\]]*)\]\([^)]*\)/g,' $1 ')
  .replace(/\[([^\]]+)\]\([^)]*\)/g,'$1')
  .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+)/gm,'')
  .replace(/[*`]/g,'').replace(/\r/g,'').replace(/\n{3,}/g,'\n\n').trim();
}
let active:string|null=null,request:string|null=null;
let sequence=0;
const listeners=new Set<()=>void>();
let events:{remove:()=>void}|undefined;
const publish=(id:string|null)=>{active=id;for(const listener of listeners)listener();};
export const speechSnapshot=()=>active;
function ensureEvents(){
 if(events||!NativeModules.BobSpeech)return;
 events=new NativeEventEmitter(NativeModules.BobSpeech).addListener('BobSpeechState',(raw:object)=>{
  const event=raw as {id:string;state:string;message?:string};
  if(event.id!==request)return;
  if(['done','stopped','error'].includes(event.state)){
   request=null;publish(null);
   if(event.state==='error')Alert.alert('Read aloud unavailable',event.message??'Check Android text-to-speech settings.');
  }
 });
}
export function subscribeSpeech(listener:()=>void){
 listeners.add(listener);ensureEvents();
 return ()=>{listeners.delete(listener);if(!listeners.size){events?.remove();events=undefined;}};
}
export async function stopSpeech(id?:string){
 if(id&&active!==id)return;
 const selected=active,previousRequest=request;
 request=null;publish(null);
 try{await NativeModules.BobSpeech?.stop(id?(previousRequest??''):'');}
 catch{if(selected)Alert.alert('Unable to stop speech','Leave Bob to stop playback.');}
}
export async function startSpeech(id:string,text:string){
 const spoken=speechText(text);
 if(!spoken)return;
 if(!NativeModules.BobSpeech){Alert.alert('Read aloud unavailable','Install a Bob Android version with text-to-speech support.');return;}
 const playback=`${id}-${++sequence}`;
 ensureEvents();request=playback;publish(id);
 try{await NativeModules.BobSpeech.speak(spoken,playback);}
 catch(error){
  if(request!==playback)return; // A native error event, Stop, or newer reply already superseded this request.
  request=null;publish(null);Alert.alert('Read aloud unavailable',error instanceof Error?error.message:'Check Android text-to-speech settings.');
 }
}
export async function openSpeechSettings(){
 await stopSpeech();
 if(!NativeModules.BobSpeech)throw Error('Install a Bob Android version with text-to-speech support.');
 await NativeModules.BobSpeech.openSettings();
}
