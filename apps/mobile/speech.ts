import {Alert,NativeEventEmitter,NativeModules} from 'react-native';
import {speechText} from './speech-markdown';
export {speechText} from './speech-markdown';
export type SpeechState={id:string|null;phase:'idle'|'starting'|'speaking'|'stopping'|'stop-unconfirmed';message?:string};
export type SpeechOptions={configuration?:string;networkConsent?:boolean;onError?:(message:string)=>void};
let state:SpeechState={id:null,phase:'idle'},request:string|null=null;
let sequence=0,revision=0;
let playbackError:((message:string)=>void)|undefined;
const listeners=new Set<()=>void>();
let events:{remove:()=>void}|undefined;
const publish=(next:SpeechState)=>{state=next;for(const listener of listeners)listener();};
export const speechSnapshot=()=>state.id;
export const speechState=()=>state;
function report(message:string){if(playbackError)playbackError(message);else Alert.alert('Read aloud unavailable',message);}
function ensureEvents(){
 if(events||!NativeModules.BobSpeech)return;
 events=new NativeEventEmitter(NativeModules.BobSpeech).addListener('BobSpeechState',(raw:object)=>{
  const event=raw as {id:string;state:string;message?:string;stopUnconfirmed?:boolean};
  if(event.id!==request)return;
  if(['done','stopped','error'].includes(event.state)){
   request=null;
   publish(event.stopUnconfirmed?{id:state.id,phase:'stop-unconfirmed',message:event.message}:{id:null,phase:'idle',message:event.message});
   if(event.state==='error')report(event.message??'Check Android text-to-speech settings.');
  }else if(event.state==='speaking')publish({...state,phase:'speaking'});
 });
}
export function subscribeSpeech(listener:()=>void){
 listeners.add(listener);ensureEvents();
 return ()=>{listeners.delete(listener);if(!listeners.size){events?.remove();events=undefined;}};
}
/** Revoke event authority immediately, but retain a visible retry-Stop lease until cleanup is confirmed. */
export async function stopSpeech(id?:string):Promise<boolean>{
 if(id&&state.id!==id)return true;
 const selected=state.id,previousRequest=request,recovering=state.phase==='stop-unconfirmed',current=++revision;
 request=null;
 if(selected)publish({id:selected,phase:'stopping'});
 try{
  // An unconfirmed native lease has no live utterance ID. Empty means cleanup ALL leases,
  // including a failed engine retained by a previous React module instance.
  await NativeModules.BobSpeech?.stop(recovering?'':id?(previousRequest??''):'');
  if(current===revision)publish({id:null,phase:'idle'});
  return true;
 }catch{
  if(current===revision)publish({id:selected??'speech-recovery',phase:'stop-unconfirmed',message:'Playback stop is unconfirmed. Try Stop again; close Bob completely if it still fails.'});
  if(selected)Alert.alert('Unable to stop speech','Try Stop again. If it still fails, close Bob completely before dictating.');
  return false;
 }
}
/** A native capture lease can fail cleanup too. Stop retries the shared native audio registry. */
export function markAudioCleanupUnconfirmed(message:string){
 request=null;
 publish({id:state.id??'audio-recovery',phase:'stop-unconfirmed',message});
}
export async function startSpeech(id:string,text:string,options:SpeechOptions={}):Promise<boolean>{
 if(options.networkConsent){
  const message='Network TTS override is unavailable: Android may use an unidentified fallback engine. Install an offline voice.';
  if(options.onError)options.onError(message);else Alert.alert('Read aloud unavailable',message);
  return false;
 }
 const spoken=speechText(text);
 if(!spoken)return false;
 const bridge=NativeModules.BobSpeech;
 if(!bridge){Alert.alert('Read aloud unavailable','Install a Bob Android version with text-to-speech support.');return false;}
 if(state.phase==='stop-unconfirmed'&&!await stopSpeech())return false;
 const playback=`${id}-${++sequence}`,current=++revision;
 ensureEvents();request=playback;playbackError=options.onError;publish({id,phase:'starting'});
 try{
  if(options.configuration&&bridge.speakConfigured)await bridge.speakConfigured(spoken,playback,options.configuration,false);
  else await bridge.speak(spoken,playback);
  return current===revision&&(request===playback||state.phase==='idle'&&!state.message);
 }catch(error){
  if(request!==playback)return false; // Native error, Stop, or newer playback already revoked this request.
  request=null;
  const message=error instanceof Error?error.message:'Check Android text-to-speech settings.';
  const uncertain=(error as {userInfo?:{stopUnconfirmed?:boolean}})?.userInfo?.stopUnconfirmed===true;
  publish(uncertain?{id,phase:'stop-unconfirmed',message}:{id:null,phase:'idle',message});
  report(message);return false;
 }
}
export async function openSpeechSettings(){
 if(!await stopSpeech())throw Error('Playback stop is unconfirmed. Try Stop again before opening speech settings.');
 if(!NativeModules.BobSpeech)throw Error('Install a Bob Android version with text-to-speech support.');
 await NativeModules.BobSpeech.openSettings();
}
