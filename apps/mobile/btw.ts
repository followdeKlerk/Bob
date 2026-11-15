export type BtwMessage={requestId:string;question:string;status:'running'|'done'|'cancelled'|'failed';answer?:string;error?:string;usage?:{input:number;output:number;cost?:number}};
export type BtwThread={id:string;revision:number;model:{provider:string;modelId:string};thinkingLevel?:string;createdAt:number;expiresAt:number;snapshot:{characters:number;truncated:boolean;omitsLive:true};messages:BtwMessage[]};
export type BtwRequest=(path:string,method?:string,body?:unknown)=>Promise<unknown>;
export type BtwState={thread?:BtwThread;busy:boolean;uncertain:boolean;error:string};
const obj=(x:unknown):Record<string,unknown>=>x!==null&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,unknown>:{};
const uuid=(x:unknown):x is string=>typeof x==='string'&&/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(x);
const number=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
/** Treat backend content as plain data, never executable instructions. */
export function btwThread(value:unknown):BtwThread {
 const x=obj(value),model=obj(x.model),snapshot=obj(x.snapshot);
 if(!uuid(x.id)||!number(x.revision)||!Number.isSafeInteger(x.revision)||typeof model.provider!=='string'||typeof model.modelId!=='string'||!number(x.createdAt)||!number(x.expiresAt)||!number(snapshot.characters)||typeof snapshot.truncated!=='boolean'||snapshot.omitsLive!==true||!Array.isArray(x.messages)||x.messages.length>32)throw Error('Invalid side-chat response');
 for(const raw of x.messages){const m=obj(raw);if(!uuid(m.requestId)||typeof m.question!=='string'||m.question.length>4000||!['running','done','cancelled','failed'].includes(String(m.status))||m.answer!==undefined&&(typeof m.answer!=='string'||m.answer.length>20000)||m.error!==undefined&&(typeof m.error!=='string'||m.error.length>500))throw Error('Invalid side-chat message');}
 return x as unknown as BtwThread;
}
export function btwCommand(text:string):string|null {
 const match=/^\/btw(?:\s+([\s\S]*))?$/i.exec(text.trim());return match?match[1]?.trim()??'':null;
}

/** One ephemeral session. Paid POSTs are never replayed on reads, resume, or
 * transport errors. A missing receipt remains uncertain until explicit reset. */
export class BtwSession {
 state:BtwState={busy:false,uncertain:false,error:''};
 private pending?:{requestId:string;text:string};
 private generation=0;
 private listeners=new Set<(state:BtwState)=>void>();
 constructor(private base:string,private request:BtwRequest,private id:()=>string){}
 subscribe(listener:(state:BtwState)=>void){this.listeners.add(listener);listener(this.state);return()=>{this.listeners.delete(listener);};}
 private publish(change:Partial<BtwState>){this.state={...this.state,...change};for(const listener of this.listeners)listener(this.state);}
 private accept(raw:unknown){
  const thread=btwThread(raw);
  if(this.state.thread&&thread.id!==this.state.thread.id)throw Error('Side-chat identity changed');
  if(this.state.thread&&thread.revision<this.state.thread.revision)return;
  if(this.pending&&thread.messages.some(m=>m.requestId===this.pending!.requestId))this.pending=undefined;
  this.publish({thread,uncertain:!!this.pending,error:this.pending?'Delivery is unconfirmed. Check status before starting another request.':''});
 }
 async open(){
  if(this.state.busy)return;
  if(this.state.thread){await this.check();return;}
  const ticket=this.generation;this.publish({busy:true,error:''});
  try{const raw=await this.request(this.base,'POST',{});if(ticket===this.generation)this.accept(raw);}
  catch(cause){if(ticket===this.generation)this.publish({error:(cause as {httpStatus?:number})?.httpStatus===429?'Too many temporary side chats are open. Use Clear temporary side chats, or wait for their 30-minute expiry.':'Could not open side chat. Check your connection and that this backend supports /btw.'});}
  finally{if(ticket===this.generation)this.publish({busy:false});}
 }
 async send(text:string){
  const thread=this.state.thread,question=text.trim();
  if(!thread||this.state.busy||this.pending||thread.messages.some(m=>m.status==='running')||!question||question.length>4000)return false;
  const ticket=this.generation,requestId=this.id();this.pending={requestId,text:question};this.publish({busy:true,uncertain:true,error:''});
  try{
   const raw=await this.request(`${this.base}/${thread.id}/messages`,'POST',{requestId,text:question});
   if(ticket===this.generation)this.accept(raw);return true;
  }catch(cause){
   if(ticket!==this.generation)return false;
   const code=(cause as {httpStatus?:number})?.httpStatus;
   if(code&&code>=400&&code<500&&code!==408&&code!==429){this.pending=undefined;this.publish({uncertain:false,error:code===404?'This temporary side chat has expired. Start a new one.':code===409?'The side chat is busy or has reached its limit. Check status or start a new one.':'The side request was not accepted. Check the model and provider settings.'});}
   else this.publish({uncertain:true,error:'Delivery is unconfirmed. Check status; the request will not be resent automatically.'});
   return false;
  }finally{if(ticket===this.generation)this.publish({busy:false});}
 }
 async check(){
  const thread=this.state.thread;if(!thread||this.state.busy)return;
  const ticket=this.generation;
  // Only read endpoints repeat. Unknown admissions deliberately bypass the
  // revision fast path until their receipt is found.
  try{
   const raw=await this.request(`${this.base}/${thread.id}${this.pending?'':`?revision=${thread.revision}`}`);
   if(ticket!==this.generation||obj(raw).unchanged===true)return;
   this.accept(raw);
  }catch(cause){if(ticket===this.generation)this.publish({error:(cause as {httpStatus?:number})?.httpStatus===404?'This temporary side chat is no longer available. Start a new one.':'Could not check side-chat status. No request was resent.'});}
 }
 async cancel(){
  const thread=this.state.thread;if(!thread||this.state.busy)return;
  const ticket=this.generation;this.publish({busy:true,error:''});
  try{const raw=await this.request(`${this.base}/${thread.id}/cancel`,'POST',{});if(ticket===this.generation)this.accept(raw);}
  catch{if(ticket===this.generation)this.publish({error:'Cancellation is unconfirmed. Check status; no new request was started.'});}
  finally{if(ticket===this.generation)this.publish({busy:false});}
 }
 async reset(){
  if(this.state.busy)return;
  const thread=this.state.thread;
  this.publish({busy:true,error:''});
  try{if(thread)await this.request(`${this.base}/${thread.id}`,'DELETE');}
  catch(cause){if((cause as {httpStatus?:number})?.httpStatus!==404){this.publish({busy:false,error:'Could not discard this side chat. Check status before trying again.'});return;}}
  this.generation++;this.pending=undefined;this.publish({thread:undefined,busy:false,uncertain:false,error:''});await this.open();
 }
 async discardAll(){
  if(this.state.busy)return;
  this.publish({busy:true,error:''});
  try{await this.request(`${this.base}/discard`,'POST',{allForDevice:true});}
  catch{this.publish({busy:false,error:'Clearing temporary side chats is unconfirmed. No side question was resent.'});return;}
  this.generation++;this.pending=undefined;this.publish({thread:undefined,busy:false,uncertain:false,error:''});await this.open();
 }
 dispose(){this.generation++;this.listeners.clear();}
}
