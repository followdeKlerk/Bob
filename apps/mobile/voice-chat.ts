// Auto-final submission and automatic reply reading extracted from Omalauncher
// VoiceScreen/VoiceSession (MIT, Copyright (c) 2026 Simon Schubert and contributors).
// Bob owns delivery and completion: no launcher, Linux, local agent, or second sender.
import {VoiceInputSession,type VoicePhase,type VoiceDetails} from './voice-input';
import {replyText} from './reply-text';
import {speechSnapshot,speechState,startSpeech,stopSpeech} from './speech';
import type {Backend} from './use-mobile-runtime';

export type VoiceInterest={requestId:string;deviceId:string;backend:Backend;chat:number};
type RecordedEntry={id:number;conversationId?:number;kind:string;model?:{role:string;content:unknown;stopReason?:string}[]};
export type VoiceChatState={open:boolean;phase:VoicePhase|'waiting'|'speaking'|'error';partial:string;provider?:string;external:boolean;message?:string};
export type VoiceChatPort={
 send(text:string,current:()=>boolean):Promise<VoiceInterest>;
 read(path:string,interest:VoiceInterest,signal:AbortSignal):Promise<any>;
 sameDevice(interest:VoiceInterest):Promise<boolean>;
};
class VoiceReceiptError extends Error {}
const positive=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0;
/** The exact native settlement's public assistant text. Never tools, reasoning, data JSON, or previews. */
export function completedVoiceText(entry:RecordedEntry,answer:number,chat:number):string {
 if(entry.id!==answer||entry.kind!=='pi.assistant'||entry.conversationId!==undefined&&entry.conversationId!==chat)return '';
 const messages=Array.isArray(entry.model)?entry.model.filter(message=>message?.role==='assistant'):[];
 if(messages.some(message=>message.stopReason==='aborted'||message.stopReason==='error'))return '';
 return messages.map(message=>replyText(message.content)).filter(Boolean).join('\n\n');
}
let voiceSequence=0;
/** One ephemeral playback interest, NOT a delivery/retry controller. Remount never restores autoplay authority. */
export class VoiceChatSession {
 readonly capture:VoiceInputSession;
 private state:VoiceChatState={open:false,phase:'idle',partial:'',external:false};
 private scope='';
 private active=false;
 private epoch=0;
 private interest?:VoiceInterest;
 private timeout?:ReturnType<typeof setTimeout>;
 private poll?:AbortController;
 private until=0;
 private playing?:string;
 private reply?:{text:string;interest:VoiceInterest};
 private played=new Set<string>();
 private claimed?:{interest:VoiceInterest;answer:number};
 private disposed=false;
 constructor(private changed:(state:VoiceChatState)=>void,private readonly port:VoiceChatPort){
  this.capture=new VoiceInputSession(phase=>{
   if(this.state.open&&this.state.phase!=='waiting'&&this.state.phase!=='speaking')this.publish({phase});
  },text=>void this.final(text),message=>this.publish({phase:'error',message}),undefined,(details:VoiceDetails)=>this.publish(details));
 }
 snapshot(){return this.state;}
 private publish(change:Partial<VoiceChatState>){this.state={...this.state,...change};if(!this.disposed)this.changed(this.state);}
 configure(scope:string,active:boolean,foreground:boolean){
  if(this.scope!==scope||!active||!foreground&&!this.capture.ownsExternal())this.cancel(true);
  if(this.scope!==scope)this.played.clear();
  this.scope=scope;this.active=active;
  this.capture.configure(scope,active&&(foreground||this.capture.ownsExternal()));
 }
 attach(){this.disposed=false;this.capture.attach();}
 dispose(){this.cancel(true);this.disposed=true;this.active=false;this.capture.dispose();}
 background(){if(!this.capture.ownsExternal())this.cancel(true);}
 blur(){if(this.state.phase==='waiting'||this.interest||this.playing)this.cancel(true);}
 cancel(close=false){
  ++this.epoch;this.interest=undefined;this.reply=undefined;this.claimed=undefined;clearTimeout(this.timeout);this.timeout=undefined;
  this.poll?.abort();this.poll=undefined;
  const playing=this.playing;this.playing=undefined;
  this.capture.cancel();
  if(playing)void stopSpeech(playing);
  this.publish({open:close?false:this.state.open,phase:'idle',partial:'',external:false,message:undefined});
 }
 async press(chooseProvider=false){
  if(!this.active)return;
  const epoch=this.epoch,scope=this.scope;
  if(this.state.phase==='waiting')return; // one turn until its exact settlement; no joined-work heuristic
  if(this.playing){const id=this.playing;if(!await stopSpeech(id))return;this.playing=undefined;}
  if(!this.active||this.epoch!==epoch||this.scope!==scope)return;
  if(!this.state.open)this.publish({open:true});
  this.reply=undefined;
  this.publish({message:undefined});
  await this.capture.press(chooseProvider);
 }
 private async final(text:string){
  if(!this.active||!this.state.open)return;
  this.claimed=undefined;
  const epoch=++this.epoch,scope=this.scope;
  const current=()=>this.active&&!this.disposed&&this.epoch===epoch&&this.scope===scope&&this.state.open;
  this.publish({phase:'waiting',partial:text,message:'Sending once through Bob’s message queue…'});
  try{
   const interest=await this.port.send(text,current);
   if(!current())return; // Already enqueued delivery stays with the outbox, never resubmit it.
   this.interest=interest;this.until=Date.now()+10*60*1000;
   this.publish({message:'Waiting for this spoken turn’s completed reply…'});
   this.wake();
  }catch(error){if(current())this.publish({phase:'error',message:String((error as Error).message??error)});}
 }
 /** Snapshot/reconnect activity coalesces into the same bounded read-only receipt check. */
 wake(){
  if(!this.interest||this.poll||this.timeout||!this.active)return;
  void this.check();
 }
 private async check(){
  const interest=this.interest;if(!interest)return;
  const epoch=this.epoch,controller=new AbortController();this.poll=controller;
  const current=()=>this.active&&!this.disposed&&this.epoch===epoch&&this.interest===interest&&!controller.signal.aborted;
  let expire!:(error:Error)=>void;
  const expired=new Promise<never>((_,reject)=>{expire=reject;});
  const deadline=setTimeout(()=>{controller.abort();expire(Error('Voice receipt check timed out.'));},10000);
  const read=(path:string)=>Promise.race([this.port.read(path,interest,controller.signal),expired]);
  try{
   const result=await read(`chats/${interest.chat}/operations/${interest.requestId}`);
   if(!current())return;
   const admission=result?.admission;
   if(admission){
    if(admission.conversationId!==interest.chat||admission.requestId!==`device:${interest.deviceId}:${interest.requestId}`||admission.type!=='input')throw new VoiceReceiptError('Voice reply identity could not be confirmed. Your message is still owned by the outbox.');
    if(admission.status==='unanswered'){
     this.interest=undefined;this.publish({phase:'error',message:'This spoken turn ended without an answer. Its message remains in chat; Voice Chat will not resend it.'});return;
    }
    if(admission.status==='done'){
     if(!positive(admission.entry)||!positive(admission.answer))throw new VoiceReceiptError('Invalid completed voice receipt.');
     const answer=admission.answer,key=`${this.scope}:${answer}`;
     if(this.played.has(key)&&this.claimed?.interest!==interest){this.interest=undefined;this.publish({phase:'idle',message:'This answer was already read in this voice session. Tap to speak again.'});return;}
     // Claim the scoped answer BEFORE awaiting history/TTS, including shared-answer settlements.
     if(this.claimed&&this.claimed.answer!==answer)throw new VoiceReceiptError('Invalid changed voice settlement.');
     this.played.add(key);this.claimed={interest,answer};
     const history=await read(`chats/${interest.chat}/history?entryId=${answer}`);
     if(!current())return;
     if(history?.backendId!==interest.backend.backendId||history?.conversationId!==interest.chat||history?.coverage!=='stored-entry'||history?.entry?.id!==answer)throw new VoiceReceiptError('The completed voice answer did not match this conversation.');
     const text=completedVoiceText(history.entry,answer,interest.chat);
     if(!text){this.interest=undefined;this.publish({phase:'idle',message:'This turn completed without public assistant text to read. Tap to speak again.'});return;}
     if(!await Promise.race([this.port.sameDevice(interest),expired]))throw new VoiceReceiptError('Pairing changed. Automatic voice playback was revoked.');
     if(!current())return;
     this.reply={text,interest};this.interest=undefined;
     await this.play(text,epoch);
     return;
    }
    if(!['queued','placed'].includes(admission.status))throw new VoiceReceiptError('This operation has no supported voice completion receipt.');
   }
  }catch(error){
   if(this.epoch===epoch&&this.interest===interest){
    const fatal=(error as {httpStatus?:number;deliveryUnconfirmed?:boolean});
    if(fatal.httpStatus===401||fatal.httpStatus===403||fatal.deliveryUnconfirmed||!(error instanceof Error)||error instanceof VoiceReceiptError){
     this.interest=undefined;this.publish({phase:'error',message:String((error as Error).message??error)});
    }else this.publish({message:'Reply delivery/completion is not confirmed yet. Checking the same request; never resending.'});
   }
  }finally{
   clearTimeout(deadline);
   if(this.poll===controller)this.poll=undefined;
   if(this.epoch===epoch&&this.interest===interest){
    if(Date.now()>=this.until){this.interest=undefined;this.publish({phase:'error',message:'Automatic reading timed out. Your message remains in the normal chat queue; it was not resent.'});}
    else this.timeout=setTimeout(()=>{this.timeout=undefined;this.wake();},2000);
   }
  }
 }
 private async play(text:string,epoch:number){
  if(this.epoch!==epoch||!this.active)return;
  const id=`voice-chat-${++voiceSequence}`;this.playing=id;
  this.capture.cancel();this.publish({phase:'speaking',message:'Reading the completed reply. Tap the voice button to interrupt and speak again.'});
  const admitted=await startSpeech(id,text,{onError:message=>{if(this.epoch===epoch)this.publish({phase:'error',message});}});
  if(this.epoch!==epoch){if(speechState().phase!=='stop-unconfirmed')void stopSpeech(id);return;}
  if(!admitted&&speechSnapshot()!==id){this.playing=undefined;if(this.state.phase!=='error')this.publish({phase:'error',message:'Reply playback did not start. The text remains in chat.'});}
 }
 speechChanged(){
  if(speechState().phase==='stop-unconfirmed'){this.playing=undefined;this.cancel(true);return;}
  if(!this.playing){if(this.state.open&&this.state.phase==='waiting'&&speechSnapshot())this.cancel(true);return;}
  const status=speechState();
  if(status.id===this.playing){if(status.phase==='stop-unconfirmed')this.publish({phase:'error',message:status.message});return;}
  this.playing=undefined;
  if(this.state.phase==='speaking')this.publish({phase:'idle',message:'Reply finished. Tap the voice button for the next turn.'});
 }
 async stop(){
  this.cancel(false);
  if(speechState().phase==='stop-unconfirmed')await stopSpeech();
 }
}
