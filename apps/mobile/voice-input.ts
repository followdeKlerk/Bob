import {AppState,NativeEventEmitter,NativeModules,PermissionsAndroid,Platform} from 'react-native';
import {stopSpeech,subscribeSpeech,speechSnapshot,markAudioCleanupUnconfirmed} from './speech';

export type VoicePhase='idle'|'preparing'|'listening'|'finishing'|'external';
export type VoiceProvider={mode:'onDevice'|'platform'|'activity';key:string;label:string;language:string;networkCapable:boolean};
export type VoiceDetails={partial:string;provider?:string;external:boolean};
type Mode='onDevice'|'platform'|'activity';
type VoiceEvent={id:string;state:'listening'|'finishing'|'external'|'partial'|'final'|'cancelled'|'error';text?:string;message?:string;stopUnconfirmed?:boolean};
type VoiceNative={options?:(language:string|null)=>Promise<VoiceProvider[]>;startConfigured?:(id:string,key:string,language:string,consent:boolean)=>Promise<void>;windowFocused:()=>Promise<boolean>;availability:()=>Promise<Mode|'unavailable'>;start:(id:string,mode:Mode,platformConsent:boolean)=>Promise<void>;finish:(id:string)=>Promise<void>;cancel:(id:string)=>Promise<void>};
const native=():VoiceNative|undefined=>NativeModules.BobVoiceInput;
let sequence=0;
/** Wait only for our consent/permission UI to return focus; never opens a recognizer. */
function waitForWindowFocus(bridge:VoiceNative,signal:AbortSignal):Promise<void>{
 return new Promise((resolve,reject)=>{
  let settled=false,timer:ReturnType<typeof setTimeout>|undefined,focus:{remove:()=>void}|undefined;
  const finish=(error?:Error)=>{
   if(settled)return;settled=true;clearTimeout(timer);focus?.remove();signal.removeEventListener('abort',abort);
   if(error)reject(error);else resolve();
  };
  const abort=()=>finish(Error('Dictation cancelled.'));
  const check=()=>{void bridge.windowFocused().then(focused=>{if(focused)finish();}).catch(()=>finish(Error('Unable to check Bob’s window focus. Tap the mic again.')));};
  if(signal.aborted){abort();return;}
  if(typeof bridge.windowFocused!=='function'){finish(Error('Install an updated Bob Android build with focus-safe dictation.'));return;}
  focus=AppState.addEventListener('focus',check);signal.addEventListener('abort',abort);
  timer=setTimeout(()=>finish(Error('Return to Bob, then tap the mic again.')),2000);
  check();
 });
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
 stopSpeech,
 waitForWindowFocus,
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
 private dialog:AbortController|null=null;
 private external=false;
 private selected?:VoiceProvider;
 private picker?: (initial:string,load:(language:string)=>Promise<VoiceProvider[]>,signal:AbortSignal)=>Promise<VoiceProvider|undefined>;
 private consent?: (provider:VoiceProvider,signal:AbortSignal)=>Promise<boolean>;
 setPicker(picker:typeof this.picker){this.picker=picker;}
 setConsent(consent:typeof this.consent){this.consent=consent;}
 private details:VoiceDetails={partial:'',external:false};
 private describe(change:Partial<VoiceDetails>){this.details={...this.details,...change};if(!this.disposed)this.observe?.(this.details);}
 ownsExternal(){return this.external;}
 constructor(private readonly changed:(phase:VoicePhase)=>void,private readonly transcript:(text:string)=>void,private readonly error:(message:string)=>void,private readonly deps=voiceDependencies,private readonly observe?:(details:VoiceDetails)=>void){}
 attach(){this.disposed=false;}
 configure(scope:string,enabled:boolean){
  if(this.scope!==scope||!enabled)this.cancel();
  if(this.scope!==scope)this.selected=undefined; // Remember choices for this chat visit only.
  this.scope=scope;this.enabled=enabled;
 }
 private publish(phase:VoicePhase){this.phase=phase;if(!this.disposed)this.changed(phase);}
 cancel(){
  this.generation++;this.external=false;this.describe({partial:'',external:false});
  this.dialog?.abort();this.dialog=null;
  const id=this.id;this.id=null;clearTimeout(this.timer);this.timer=undefined;
  this.publish('idle');
  if(id)void this.deps.native()?.cancel(id).catch(()=>{});
 }
 blur(){if(!this.dialog&&!this.external)this.cancel();}
 background(){if(!this.external)this.cancel();}
 dispose(){this.disposed=true;this.enabled=false;this.cancel();}
 receive(raw:unknown){
  if(!raw||typeof raw!=='object')return;
  const event=raw as VoiceEvent;
  if(typeof event.id!=='string'||!['listening','finishing','external','partial','final','cancelled','error'].includes(event.state))return;
  if(event.stopUnconfirmed===true){markAudioCleanupUnconfirmed(event.message??'Audio cleanup is unconfirmed. Retry Stop before speaking.');return;}
  if(!this.enabled||!this.deps.foreground()||event.id!==this.id)return;
  if(event.state==='external'){if(this.external)this.publish('external');return;}
  if(event.state==='partial'){this.describe({partial:typeof event.text==='string'?event.text.slice(0,16000):''});return;}
  if(event.state==='listening'){if(this.phase==='preparing'){this.publish('listening');this.deadline(25000);}return;}
  if(event.state==='finishing'){if(this.phase!=='finishing'){this.publish('finishing');this.deadline(8000);}return;}
  // Fence before delivering to the parent: repeated finals/errors cannot insert twice.
  this.id=null;this.generation++;clearTimeout(this.timer);this.timer=undefined;this.external=false;this.describe({external:false});this.publish('idle');
  if(event.state==='final'){
   const text=typeof event.text==='string'?event.text.trim():undefined;
   if(text&&text.length<=16000)this.transcript(text);
   else this.error('No usable speech was heard. Tap the mic and try again.');
  }else if(event.state==='error')this.error(typeof event.message==='string'?event.message:'Dictation failed. Try again or type your message.');
 }
 private deadline(ms:number){
  clearTimeout(this.timer);
  const generation=this.generation;
  this.timer=setTimeout(()=>{if(generation!==this.generation)return;this.cancel();this.error('Dictation timed out. Tap the mic to try again.');},ms);
 }
 async press(chooseProvider=false){
  if(!this.enabled||this.disposed||!this.deps.foreground())return;
  if(chooseProvider&&this.phase!=='idle')this.cancel();
  if(this.phase==='listening'&&this.id){
   const id=this.id;this.publish('finishing');this.deadline(8000);
   try{await this.deps.native()?.finish(id);}catch{if(this.id===id){this.cancel();this.error('Dictation could not finish. Please try again.');}}
   return;
  }
  if(this.phase!=='idle'){this.cancel();return;}
  const bridge=this.deps.native();
  if(!bridge){this.error('Dictation needs an Android Bob build with speech recognition support. Typing and Read aloud are unchanged.');return;}
  const generation=++this.generation;
  const current=()=>generation===this.generation&&this.enabled&&!this.disposed&&this.deps.foreground();
  this.id=`voice-${++sequence}`;this.publish('preparing');
  // Setup time is NOT borrowed from listening/finalization. Every stage is independently bounded.
  this.describe({partial:'',provider:undefined});this.deadline(40000);
  let dialog:AbortController|undefined;
  try{
   if(chooseProvider&&!bridge.options)throw Error('Speech options require an updated Bob Android build. No microphone was started.');
   const initial=bridge.options?await bridge.options(chooseProvider?null:this.selected?.language??null):undefined;if(!current())return;
   let provider=chooseProvider?initial?.[0]:this.selected?initial?.find(plan=>plan.key===this.selected?.key):initial?.[0];
   if(!chooseProvider&&this.selected&&!provider)throw Error('Speech provider configuration changed. Open Speech options to review it; no fallback was started.');
   let mode=provider?.mode??await bridge.availability();if(!current())return;
   dialog=new AbortController();this.dialog=dialog;
   if(chooseProvider){
    if(!this.picker)throw Error('Speech options are not available on this screen. No microphone was started.');
    const chosen=await this.picker(initial?.[0]?.language??'',language=>bridge.options!(language),dialog.signal);
    if(!current())return;if(!chosen){this.cancel();return;}
    provider=chosen;this.selected=chosen;mode=provider.mode;
   }
   if(mode!=='onDevice'&&mode!=='platform'&&mode!=='activity')throw Error('No Android speech recognizer is available. Enable an installed speech recognition service in Android Settings; typing still works.');
   this.describe({provider:provider?`${provider.label} (${provider.language})`:mode});
   const network=provider?.networkCapable??mode!=='onDevice';
   if(network&&(!provider||!this.consent))throw Error('Named speech-provider consent is unavailable. No microphone was started.');
   const consent=network?await this.consent!(provider!,dialog.signal):false;if(!current())return;
   if(network&&!consent){this.cancel();return;}
   await this.deps.permission();if(!current())return;
   await this.deps.waitForWindowFocus(bridge,dialog.signal);if(!current())return;
   this.dialog=null;
   const stopped=await this.deps.stopSpeech();if(!current())return;
   if(!stopped)throw Error('Read aloud could not stop. Stop playback before dictating.');
   // Only this explicit Activity handoff may temporarily borrow foreground/focus.
   this.external=mode==='activity';this.describe({external:this.external});
   if(this.external)this.publish('external');
   this.deadline(this.external?65000:15000);
   if(provider){
    if(!bridge.startConfigured)throw Error('Speech configuration requires an updated Bob Android build. No microphone was started.');
    await bridge.startConfigured(this.id!,provider.key,provider.language,consent);
   }else await bridge.start(this.id!,mode,consent);
  }catch(error){if((error as {userInfo?:{stopUnconfirmed?:boolean}})?.userInfo?.stopUnconfirmed)markAudioCleanupUnconfirmed('Audio cleanup is unconfirmed. Retry Stop before speaking.');if(current()){this.cancel();this.error(error instanceof Error?error.message:'Dictation is unavailable. Try again or type your message.');}}
  finally{if(this.dialog===dialog)this.dialog=null;dialog?.abort();}
 }
}

export function connectVoiceInput(session:VoiceInputSession){
 session.attach();
 const bridge=native();
 const events=Platform.OS==='android'&&bridge?new NativeEventEmitter(NativeModules.BobVoiceInput).addListener('BobVoiceInputState',event=>session.receive(event)):undefined;
 const app=AppState.addEventListener('change',state=>{if(state!=='active')session.background();});
 const blur=Platform.OS==='android'?AppState.addEventListener('blur',()=>session.blur()):undefined;
 const speech=subscribeSpeech(()=>{if(speechSnapshot())session.cancel();});
 return ()=>{events?.remove();app.remove();blur?.remove();speech();session.dispose();};
}
