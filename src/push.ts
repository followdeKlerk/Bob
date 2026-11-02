import {constants,openSync,fstatSync,readSync,closeSync} from 'node:fs';
import {isAbsolute,join} from 'node:path';
import {createHash,createPrivateKey,randomUUID,sign} from 'node:crypto';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';
import type {Harness,ConversationId,SubmissionRecord,EntryId} from '@earendil-works/pi-durable';
import {Questions} from './documents.js';
import {notificationReply} from './notification-preview.js';
import {HttpError} from './errors.js';
import type {State} from './state.js';

const OAUTH='https://oauth2.googleapis.com/token';
const TTL=300_000, LIMIT=256, RECENT_LIMIT=512, MAX_ATTEMPTS=4;
const retryDelay=(attempt:number)=>[1000,5000,30_000,60_000][attempt-1];
const QUEUE='firebasePush.queue', deviceKey=(id:string)=>`firebasePush.device:${id}`;
const digest=(key:string)=>createHash('sha256').update(key).digest('hex');
type Registration={token:string;generation:string};
export type PushSource='reply'|'question'|'schedule'|'update';
const SOURCES:PushSource[]=['reply','question','schedule','update'];
type Pending={id:string;deviceId:string;generation:string;expiresAt:number;nextAt:number;attempts:number;sources?:PushSource[]};
type Queue={pending:Pending[];recent:{key:string;expiresAt:number}[]};
type Timer=(callback:()=>void,ms:number)=>()=>void;
/** Optional transport/clock seams for deterministic tests; production uses Node's HTTPS fetch. */
export type PushOptions={fetch?:typeof fetch;now?:()=>number;setTimer?:Timer;requestTimeoutMs?:number};
export type Push={enabled:boolean;register(deviceId:string,token:string):{registered:true;enabled:boolean};unregister(deviceId:string):void;attention(key:string,source?:PushSource):void;status():{enabled:boolean;closed:boolean;pending:number};flush():Promise<void>;close():Promise<void>};

/** No symlink following, non-regular files, shared permissions, or unbounded credential reads. */
function privateJson(path:string):any{
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const stat=fstatSync(fd);
  if(!stat.isFile()||(stat.mode&0o077)!==0||stat.size>65_536||stat.uid!==process.getuid?.())throw Error();
  const bytes=Buffer.alloc(65_537),size=readFileBounded(fd,bytes);
  if(size>65_536)throw Error();
  return JSON.parse(bytes.subarray(0,size).toString('utf8'));
 }finally{closeSync(fd);}
}
// Bound the actual read as well as stat size, in case the file grows concurrently.
function readFileBounded(fd:number,buffer:Buffer){let size=0,n=0;while(size<buffer.length&&(n=readSync(fd,buffer,size,buffer.length-size,null))>0)size+=n;return size;}
function configuration(dir:string){
 let config:any;
 try{config=privateJson(join(dir,'firebase-push.json'));}
 catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;console.warn('[firebase-push] disabled: configuration is invalid or not private');return;}
 try{
  if(typeof config?.projectId!=='string'||!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(config.projectId)||typeof config.serviceAccountFile!=='string'||!isAbsolute(config.serviceAccountFile))throw Error();
  const account=privateJson(config.serviceAccountFile);
  if(account?.type!=='service_account'||account.project_id!==config.projectId||typeof account.client_email!=='string'||!/^[-a-zA-Z0-9._]+@[-a-z0-9]+\.iam\.gserviceaccount\.com$/.test(account.client_email)||account.token_uri!==OAUTH||typeof account.private_key!=='string')throw Error();
  const key=createPrivateKey(account.private_key);
  if(key.asymmetricKeyType!=='rsa'||(key.asymmetricKeyDetails?.modulusLength??0)<2048)throw Error();
  return {projectId:config.projectId as string,email:account.client_email as string,key};
 }catch{console.warn('[firebase-push] disabled: configuration is invalid or not private');return;}
}
class TransportFailure extends Error {constructor(readonly retry:boolean,readonly delay=0){super('Firebase push transport failed');}}

/** Generic attention transport, not delivery confirmation. No historical scan on attach.
 * Only the bounded transport queue is recovered. The commit-to-queue handoff is best effort;
 * provider acceptance followed by a crash may result in another generic notification.
 */
export async function createPush(state:State,harness:Harness,options:PushOptions={}):Promise<Push>{
 const config=configuration(state.dir),now=options.now??Date.now,transport=options.fetch??fetch;
 const timer:Timer=options.setTimer??((callback,ms)=>{const t=setTimeout(callback,ms);t.unref();return()=>clearTimeout(t);});
 const timeout=options.requestTimeoutMs??10_000;
 let closed=false,sendTimer:(()=>void)|undefined,eventTimer:(()=>void)|undefined;
 let sending:Promise<void>|undefined,observing:Promise<void>|undefined,request:AbortController|undefined;
 let access:{token:string;until:number}|undefined;
 const active=(id:string)=>state.devices().some(d=>d.id===id&&!d.revoked);
 const registration=(id:string)=>state.get<Registration>(deviceKey(id));
 let queue=state.get<Queue>(QUEUE)??{pending:[],recent:[]};
 // Only this component writes this config key; State's synchronous writes serialize rotation/revocation.
 const trim=()=>{
  queue.pending=queue.pending.filter(p=>p.expiresAt>now()&&p.attempts<MAX_ATTEMPTS&&active(p.deviceId)&&registration(p.deviceId)?.generation===p.generation).slice(-LIMIT);
  queue.recent=queue.recent.filter(r=>r.expiresAt>now()).slice(-RECENT_LIMIT);
 };
 const save=()=>{if(!closed)state.set(QUEUE,queue);};
 const current=(p:Pending)=>!closed&&queue.pending.some(q=>q.id===p.id)&&p.expiresAt>now()&&active(p.deviceId)&&registration(p.deviceId)?.generation===p.generation;
 const remove=(p:Pending)=>{queue.pending=queue.pending.filter(q=>q.id!==p.id);};

 /** Never propagate response bodies, tokens, JWTs, credential paths or fetch exceptions. */
 async function post(url:string,headers:Record<string,string>,body:string){
  const controller=new AbortController();request=controller;
  let cancel=()=>{},abort=()=>{};
  try{
   const interrupted=new Promise<never>((_,reject)=>{abort=()=>reject(new TransportFailure(true));controller.signal.addEventListener('abort',abort,{once:true});cancel=timer(()=>controller.abort(),timeout);});
   return await Promise.race([interrupted,(async()=>{
    const response=await transport(url,{method:'POST',headers,body,signal:controller.signal,redirect:'error'});
    const retryAfter=response.headers.get('retry-after');
    const delay=retryAfter&&/^\d+$/.test(retryAfter)?Math.min(60_000,Number(retryAfter)*1000):0;
    let data:any;
    if(response.body){
     const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
     try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>65_536){void reader.cancel().catch(()=>{});throw new TransportFailure(true);}chunks.push(part.value);}}
     finally{reader.releaseLock();}
     try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{data=undefined;}
    }
    return {status:response.status,data,delay};
   })()]);
  }catch{throw new TransportFailure(true);}
  finally{cancel();controller.signal.removeEventListener('abort',abort);if(request===controller)request=undefined;}
 }
 async function authorize(){
  if(access&&access.until>now())return access.token;
  const iat=Math.floor(now()/1000);
  const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned=encode({alg:'RS256',typ:'JWT'})+'.'+encode({iss:config!.email,scope:'https://www.googleapis.com/auth/firebase.messaging',aud:OAUTH,iat,exp:iat+3600});
  const assertion=unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),config!.key).toString('base64url');
  const result=await post(OAUTH,{'content-type':'application/x-www-form-urlencoded'},new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}).toString());
  if(result.status!==200)throw new TransportFailure(result.status===429||result.status>=500,result.delay);
  if(typeof result.data?.access_token!=='string'||!result.data.access_token||!Number.isFinite(result.data.expires_in)||result.data.expires_in<=60)throw new TransportFailure(true);
  access={token:result.data.access_token,until:now()+(Math.min(result.data.expires_in,3600)-60)*1000};
  return access.token;
 }
 function wake(delay?:number){
  if(closed||!config||sending)return;
  sendTimer?.();sendTimer=undefined;
  if(!queue.pending.length)return;
  const wait=delay??Math.max(0,Math.min(...queue.pending.map(p=>p.nextAt))-now());
  sendTimer=timer(()=>{sendTimer=undefined;sending=drain().catch(()=>{console.warn('[firebase-push] queue processing failed; pending work retained');}).finally(()=>{sending=undefined;if(!closed)wake();});},wait);
 }
 async function drain(){
  while(!closed){
   trim();save();
   const pending=queue.pending.find(p=>p.nextAt<=now());if(!pending)return;
   // Reserve the attempt before I/O; a process crash cannot reset the retry budget.
   pending.attempts++;pending.nextAt=now()+retryDelay(pending.attempts);save();
   try{
    const bearer=await authorize();
    // OAuth may take seconds. Rotation, expiry, unregister and revocation fence the actual send.
    if(!current(pending)){remove(pending);save();continue;}
    const token=registration(pending.deviceId)!.token;
    const result=await post(`https://fcm.googleapis.com/v1/projects/${config!.projectId}/messages:send`,{'content-type':'application/json',authorization:`Bearer ${bearer}`},JSON.stringify({message:{token,android:{priority:'high',ttl:'300s',collapse_key:'bob-attention'},data:{type:'bob_attention',backendId:state.id,sources:(pending.sources??['question']).join(',')}}}));
    if(closed)return;
    // Only FCM's explicit registration errors invalidate a token; generic 400 is not proof.
    const invalid=(result.status===404||result.status===400)&&Array.isArray(result.data?.error?.details)&&result.data.error.details.some((d:any)=>d?.['@type']==='type.googleapis.com/google.firebase.fcm.v1.FcmError'&&['UNREGISTERED','INVALID_ARGUMENT'].includes(d.errorCode));
    if(invalid&&registration(pending.deviceId)?.generation===pending.generation)state.delete(deviceKey(pending.deviceId));
    if(result.status>=200&&result.status<300||invalid){remove(pending);}
    else{
     if(result.status===401)access=undefined;
     throw new TransportFailure(result.status===401||result.status===429||result.status>=500,result.delay);
    }
   }catch(error){
    if(closed)return;
    if(!(error instanceof TransportFailure)||!error.retry||pending.attempts>=MAX_ATTEMPTS){
     console.warn('[firebase-push] attention not accepted: '+(error instanceof TransportFailure&&error.retry?'retry limit reached':'transport rejected request'));
     remove(pending);
    }else pending.nextAt=now()+Math.max(retryDelay(pending.attempts),error.delay);
   }
   if(closed)return;
   trim();save();
  }
 }
 function attention(key:string,source:PushSource='question'){
  if(!SOURCES.includes(source))throw new HttpError(400,'Invalid attention source');
  if(closed)throw new HttpError(503,'Firebase push is closed');
  if(!config)throw new HttpError(503,'Firebase push is not configured');
  // Publish in memory only after persistence succeeds. A failed admission must not
  // become a false dedup hit when the maintenance relay retries its stable key.
  const previous=queue;queue={pending:[...queue.pending],recent:[...queue.recent]};
  try{
   trim();const id=digest(key);if(queue.recent.some(r=>r.key===id))return;
   queue.recent.push({key:id,expiresAt:now()+TTL});
   for(const device of state.devices()){
    const deviceId=String(device.id),r=registration(deviceId);if(device.revoked||!r)continue;
    const prior=queue.pending.find(p=>p.deviceId===deviceId&&p.generation===r.generation);
    // A newer reply must not hide a coalesced question when reply alerts are muted.
    const sources=SOURCES.filter(s=>s===source||prior?.sources?.includes(s));
    queue.pending=queue.pending.filter(p=>p.deviceId!==deviceId);
    queue.pending.push({id:randomUUID(),deviceId,generation:r.generation,expiresAt:now()+TTL,nextAt:now(),attempts:0,sources});
   }
   trim();save();
  }catch{queue=previous;throw new HttpError(503,'Firebase push queue unavailable');}
  wake(50); // Coalesce same-turn Questions / replies / schedule alerts.
 }

 type Event={kind:'submission';value:SubmissionRecord}|{kind:'question';conversationId:ConversationId;id:string}|{kind:'schedule';conversationId:ConversationId;id:EntryId};
 const events=new Map<string,Event>();
 const rootId=config?(await harness.root(ctx)).id:undefined;
 async function observe(){
  while(!closed&&events.size){
   const [key,event]=events.entries().next().value!;events.delete(key);
   try{
    const id=event.kind==='submission'?event.value.conversationId:event.conversationId;
    const owner=await harness.commit(tx=>tx.conversation(id),ctx);
    if(closed||!owner||owner.owner||id===rootId)continue;
    if(event.kind==='submission'){
     const s=event.value;if(s.type!=='input'||(s.status!=='done'&&s.status!=='unanswered'))continue;
     const input=s.entry?await harness.commit(tx=>tx.entry(s.entry!),ctx):undefined;
     // Unplaced owner inputs can still fail; only an authenticated-device admission identifies them.
     const ownerInput=input?input.conversationId===id&&['bob.user','pi.user'].includes(input.kind):s.requestId?.startsWith('device:');
     if(!ownerInput)continue;
     if(s.status==='done'){
      const answer=await harness.commit(tx=>tx.entry(s.answer),ctx);
      if(!notificationReply(answer,id))continue;
     }
    }else if(event.kind==='question'){
     if((await harness.snapshot(Questions,id,ctx))?.pending?.id!==event.id)continue;
    }
    if(!closed)attention(key,event.kind==='submission'?(event.value.status==='done'?'reply':'question'):event.kind==='schedule'?'schedule':'question');
   }catch{/* A notification observer must never break Durable or expose content in errors. */}
  }
 }
 function scheduleEvents(){
  if(eventTimer||observing||closed||!events.size)return;
  // A timer, not an async commit listener: public reads occur after the committing stack returns.
  eventTimer=timer(()=>{eventTimer=undefined;observing=observe().finally(()=>{observing=undefined;scheduleEvents();});},0);
 }
 function enqueue(key:string,event:Event){
  events.set(key,event);if(events.size>RECENT_LIMIT)events.delete(events.keys().next().value!);
  scheduleEvents();
 }
 const unsubscribe=config?harness.subscribeCommits(publication=>{
  if(closed)return;
  for(const change of publication.changes){
   if(change.type==='submission'&&change.value.type==='input'&&['done','unanswered'].includes(change.value.status))enqueue(`submission:${change.value.id}`,{kind:'submission',value:change.value});
   else if(change.type==='entry'&&change.value.kind==='bob.schedule-alert')enqueue(`schedule:${change.value.id}`,{kind:'schedule',conversationId:change.value.conversationId,id:change.value.id});
   else if(change.type==='document'&&change.record.kind==='bob.questions'&&change.conversationId){
    const pending=change.value?.pending;
    if(pending&&typeof pending==='object'&&!Array.isArray(pending)&&typeof pending.id==='string')enqueue(`question:${change.conversationId}:${digest(pending.id)}`,{kind:'question',conversationId:change.conversationId,id:pending.id});
   }
  }
 }):()=>{};
 if(config){trim();save();wake();}
 return {
  enabled:!!config,
  register(deviceId,token){
   if(closed)throw new HttpError(503,'Firebase push is closed');
   if(!config)throw new HttpError(503,'Firebase push is not configured');
   if(!active(deviceId))throw new HttpError(404,'Active device not found');
   if(typeof token!=='string'||!token.length||token.length>4096||/\s/.test(token))throw new HttpError(400,'Invalid push registration');
   const previous=registration(deviceId);
   if(previous?.token!==token){
    state.set(deviceKey(deviceId),{token,generation:randomUUID()} satisfies Registration);
    queue.pending=queue.pending.filter(p=>p.deviceId!==deviceId);save();wake();
   }
   return {registered:true,enabled:true};
  },
  unregister(deviceId){
   if(closed)return;
   state.delete(deviceKey(deviceId));queue.pending=queue.pending.filter(p=>p.deviceId!==deviceId);save();wake();
  },
  attention,
  status:()=>({enabled:!!config,closed,pending:queue.pending.length}),
  // Drain newly observed events and currently due sends only; never wait through retry delays.
  async flush(){
   if(closed)return;
   eventTimer?.();eventTimer=undefined;
   if(observing)await observing;
   if(!closed&&events.size){observing=observe().finally(()=>{observing=undefined;scheduleEvents();});await observing;}
   if(closed||!config)return;
   sendTimer?.();sendTimer=undefined;
   if(!sending){sending=drain().finally(()=>{sending=undefined;if(!closed)wake();});}
   await sending;
  },
  async close(){
   if(!closed){closed=true;unsubscribe();sendTimer?.();eventTimer?.();events.clear();request?.abort();access=undefined;}
   await Promise.all([sending,observing]);
  }
 };
}
