import {Alert,AppState,NativeEventEmitter,NativeModules,PermissionsAndroid,Platform} from 'react-native';
import {stopSpeech,subscribeSpeech,speechSnapshot} from './speech';

export type VoicePhase='idle'|'preparing'|'listening'|'finishing';
type Mode='onDevice'|'platform';
type VoiceEvent={id:string;state:'listening'|'finishing'|'final'|'cancelled'|'error';text?:string;message?:string};
type VoiceNative={availability:()=>Promise<Mode|'unavailable'>;start:(id:string,mode:Mode,platformConsent:boolean)=>Promise<void>;finish:(id:string)=>Promise<void>;cancel:(id:string)=>Promise<void>};
export const PLATFORM_VOICE_NOTICE='On-device recognition is unavailable. Android’s selected speech engine may send audio to its provider over the network. Bob does not upload or save audio. Continue for this utterance?';
const native=():VoiceNative|undefined=>NativeModules.BobVoiceInput;
let sequence=0;
function platformConsent():Promise<boolean>{
 return new Promise(resolve=>Alert.alert('Use Android speech engine?',PLATFORM_VOICE_NOTICE,[
  {text:'Cancel',style:'cancel',onPress:()=>resolve(false)},
  {text:'Continue',onPress:()=>resolve(true)},
 ],{cancelable:true,onDismiss:()=>resolve(false)}));
}
const voiceDependencies={
 native,
 permission:async()=>{
  const result=await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
  if(result===PermissionsAndroid.RESULTS.GRANTED)return;
  throw Error(result===PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
   ?'Microphone permission is blocked. Enable Microphone in Android Settings → Apps → Bob → Permissions, then tap the mic again.'
   :'Microphone permission was denied. Tap the mic to try again; typing still works.');
 },
 consent:platformConsent,
 stopSpeech,
 foreground:()=>AppState.currentState==='active',
};

/** One tap, one utterance. No draft, network, recording, retry or send authority. */
export class VoiceInputSession {
 private generation=0;
 private id:string|null=null;
 private phase:VoicePhase='idle';
 private scope='';
 private enabled=false;
 private timer:ReturnType<typeof setTimeout>|undefined;
 private disposed=false;
 constructor(private readonly changed:(phase:VoicePhase)=>void,private readonly transcript:(text:string)=>void,private readonly error:(message:string)=>void,private readonly deps=voiceDependencies){}
 attach(){this.disposed=false;}
 configure(scope:string,enabled:boolean){
  if(this.scope!==scope||!enabled)this.cancel();
  this.scope=scope;this.enabled=enabled;
 }
 private publish(phase:VoicePhase){this.phase=phase;if(!this.disposed)this.changed(phase);}
 cancel(){
  this.generation++;
  const id=this.id;this.id=null;clearTimeout(this.timer);this.timer=undefined;
  this.publish('idle');
  if(id)void this.deps.native()?.cancel(id).catch(()=>{});
 }
 dispose(){this.disposed=true;this.enabled=false;this.cancel();}
 receive(raw:unknown){
  if(!raw||typeof raw!=='object')return;
  const event=raw as VoiceEvent;
  if(typeof event.id!=='string'||!['listening','finishing','final','cancelled','error'].includes(event.state))return;
  if(!this.enabled||!this.deps.foreground()||event.id!==this.id)return;
  if(event.state==='listening'){if(this.phase==='preparing')this.publish('listening');return;}
  if(event.state==='finishing'){this.publish('finishing');return;}
  // Fence before delivering to the parent: repeated finals/errors cannot insert twice.
  this.id=null;this.generation++;clearTimeout(this.timer);this.timer=undefined;this.publish('idle');
  if(event.state==='final'){
   const text=typeof event.text==='string'?event.text.trim():undefined;
   if(text&&text.length<=16000)this.transcript(text);
   else this.error('No usable speech was heard. Tap the mic and try again.');
  }else if(event.state==='error')this.error(typeof event.message==='string'?event.message:'Dictation failed. Try again or type your message.');
 }
 async press(){
  if(!this.enabled||this.disposed||!this.deps.foreground())return;
  if(this.phase==='listening'&&this.id){
   const id=this.id;this.publish('finishing');
   try{await this.deps.native()?.finish(id);}catch{if(this.id===id){this.cancel();this.error('Dictation could not finish. Please try again.');}}
   return;
  }
  if(this.phase!=='idle'){this.cancel();return;}
  const bridge=this.deps.native();
  if(!bridge){this.error('Dictation needs an Android Bob build with speech recognition support. Typing and Read aloud are unchanged.');return;}
  const generation=++this.generation;
  const current=()=>generation===this.generation&&this.enabled&&!this.disposed&&this.deps.foreground();
  this.id=`voice-${++sequence}`;this.publish('preparing');
  // Also bounds hung availability/permission/consent/bridge promises; late answers are inert.
  this.timer=setTimeout(()=>{if(current()){this.cancel();this.error('Dictation timed out. Tap the mic to try again.');}},40000);
  try{
   const mode=await bridge.availability();if(!current())return;
   if(mode!=='onDevice'&&mode!=='platform')throw Error('No Android speech recognizer is available. Enable an installed speech recognition service in Android Settings; typing still works.');
   const consent=mode==='platform'?await this.deps.consent():false;if(!current())return;
   if(mode==='platform'&&!consent){this.cancel();return;}
   await this.deps.permission();if(!current())return;
   const stopped=await this.deps.stopSpeech();if(!current())return;
   if(!stopped)throw Error('Read aloud could not stop. Stop playback before dictating.');
   await bridge.start(this.id!,mode,consent);
  }catch(error){if(current()){this.cancel();this.error(error instanceof Error?error.message:'Dictation is unavailable. Try again or type your message.');}}
 }
}

export function connectVoiceInput(session:VoiceInputSession){
 session.attach();
 const bridge=native();
 const events=Platform.OS==='android'&&bridge?new NativeEventEmitter(NativeModules.BobVoiceInput).addListener('BobVoiceInputState',event=>session.receive(event)):undefined;
 const app=AppState.addEventListener('change',state=>{if(state!=='active')session.cancel();});
 const speech=subscribeSpeech(()=>{if(speechSnapshot())session.cancel();});
 return ()=>{events?.remove();app.remove();speech();session.dispose();};
}
