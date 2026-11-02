import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,chmodSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync,verify} from 'node:crypto';
import {Harness,MemoryStorage,createRegistry,defineExtension,defineTask,type ConversationId} from '@earendil-works/pi-durable';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
import {State} from '../src/state.js';
import {Questions} from '../src/documents.js';
import {createPush,type Push} from '../src/push.js';

const PROJECT='bob-push-test-12345',OAUTH='https://oauth2.googleapis.com/token';
const email=`push@${PROJECT}.iam.gserviceaccount.com`;
const keys=generateKeyPairSync('rsa',{modulusLength:2048});
const key=keys.privateKey.export({type:'pkcs8',format:'pem'});
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};};
class Clock{
 now=1_800_000_000_000;
 timers=new Map<number,{at:number;callback:()=>void}>();id=0;
 setTimer=(callback:()=>void,ms:number)=>{const id=++this.id;this.timers.set(id,{at:this.now+ms,callback});return()=>{this.timers.delete(id);};};
 async advance(ms:number){
  this.now+=ms;
  for(let i=0;i<100;i++){
   const due=[...this.timers].find(([,t])=>t.at<=this.now);
   if(!due){await tick();if(![...this.timers.values()].some(t=>t.at<=this.now))return;continue;}
   this.timers.delete(due[0]);due[1].callback();await tick();
  }
  throw Error('Timer loop');
 }
}
function provider(){
 const calls:{url:string;headers:Headers;body:any}[]=[];
 const api={
  calls,projectId:PROJECT,
  auth:async()=>Response.json({access_token:'OAUTH_SECRET',expires_in:3600}),
  send:async()=>Response.json({name:'projects/test/messages/accepted-not-delivered'}),
  fetch:undefined as unknown as typeof fetch,
 };
 api.fetch=async(url,init)=>{
  const address=String(url),headers=new Headers(init?.headers);
  calls.push({url:address,headers,body:address===OAUTH?new URLSearchParams(String(init?.body)):JSON.parse(String(init?.body))});
  assert.equal(init?.redirect,'error');assert.ok(init?.signal);
  assert.ok(address===OAUTH||address===`https://fcm.googleapis.com/v1/projects/${api.projectId}/messages:send`);
  return address===OAUTH?api.auth():api.send();
 };
 return api;
}
const ownerTask=defineTask({name:'test.push-owner',version:1,initial:()=>({phase:'wait'}),phases:{wait:async()=>{}},abort:async()=>{}});
async function fixture(options:{configured?:boolean;attach?:boolean}={}){
 const dir=mkdtempSync(join(tmpdir(),'bob-push-test-')),state=new State(dir),clock=new Clock(),fake=provider();
 const accountFile=join(dir,'service-account.json'),configFile=join(dir,'firebase-push.json');
 const account={type:'service_account',project_id:PROJECT,client_email:email,private_key:key,token_uri:OAUTH};
 writeFileSync(accountFile,JSON.stringify(account),{mode:0o600});
 if(options.configured!==false)writeFileSync(configFile,JSON.stringify({projectId:PROJECT,serviceAccountFile:accountFile}),{mode:0o600});
 const registry=createRegistry();registry.install(defineExtension({name:'test.push',tasks:[ownerTask]}));
 const h=await Harness.open(new MemoryStorage(),{registry,models:createModels()},ctx);const root=await h.root(ctx);
 let push:Push|undefined;
 const attach=async()=>push=await createPush(state,h,{fetch:fake.fetch,now:()=>clock.now,setTimer:clock.setTimer,requestTimeoutMs:1000});
 if(options.attach!==false)await attach();
 const device=state.pair(state.invite().token,'Test phone');
 const chat=()=>h.createConversation({ownership:{kind:'ownerless'}},ctx);
 return {state,clock,fake,h,root,device,chat,accountFile,configFile,account,attach,get push(){return push!;},
  async close(){await push?.close();await h.close(ctx);state.close();rmSync(dir,{recursive:true,force:true});}};
}
async function settled(h:Harness,id:ConversationId,options:{kind?:string;answer?:string;unanswered?:boolean;unplaced?:boolean;write?:boolean;requestId?:string}={}){
 return h.commit(async tx=>{
  const input=options.unplaced?undefined:await tx.appendEntry(id,{kind:options.kind??'bob.user',data:{text:'PRIVATE_OWNER_CONTENT'}});
  const answer=await tx.appendEntry(id,{kind:'pi.assistant',model:[fauxAssistantMessage(options.answer??'PRIVATE_ASSISTANT_CONTENT')]});
  const base={conversationId:id,requestId:options.requestId};
  if(options.write)return tx.createSubmission({...base,type:'write',status:'done',entry:input!.id});
  if(options.unanswered)return tx.createSubmission({...base,type:'input',status:'unanswered',...(input?{entry:input.id}:{}),reason:'PRIVATE_FAILURE_DETAIL'});
  return tx.createSubmission({...base,type:'input',status:'done',entry:input!.id,answer:answer.id});
 },ctx);
}
const sends=(f:ReturnType<typeof provider>)=>f.calls.filter(c=>c.url!==OAUTH);
const oauth=(f:ReturnType<typeof provider>)=>f.calls.filter(c=>c.url===OAUTH);
const invalid=(code='UNREGISTERED',status=404)=>Response.json({error:{message:'PROVIDER_SECRET',details:[{'@type':'type.googleapis.com/google.firebase.fcm.v1.FcmError',errorCode:code}]}},{status});

test('disabled sender rejects registration/attention with sanitized 503; registration is active-device bound',async()=>{
 const r=await fixture({configured:false});
 try{
  assert.equal(r.push.enabled,false);
  for(const fn of [()=>r.push.register(r.device.deviceId,'TOKEN_SECRET'),()=>r.push.attention('maintenance:key')])assert.throws(fn,(e:any)=>e.status===503&&!/TOKEN_SECRET/.test(e.message));
  assert.deepEqual(r.push.status(),{enabled:false,closed:false,pending:0});await r.push.flush();assert.equal(r.fake.calls.length,0);
 }finally{await r.close();}
 const enabled=await fixture();
 try{
  assert.throws(()=>enabled.push.register('unknown','TOKEN_SECRET'),(e:any)=>e.status===404);
  assert.deepEqual(enabled.push.register(enabled.device.deviceId,'TOKEN_SECRET'),{registered:true,enabled:true});
  enabled.state.revoke(enabled.device.deviceId);assert.throws(()=>enabled.push.register(enabled.device.deviceId,'OTHER_TOKEN'),(e:any)=>e.status===404);
 }finally{await enabled.close();}
});

test('private config/credentials disable safely for permissions, symlinks, wrong projects and unsafe OAuth endpoints',async t=>{
 const warning=t.mock.method(console,'warn',()=>{});
 const r=await fixture({attach:false});
 const reject=async()=>{await r.attach();assert.equal(r.push.enabled,false);assert.throws(()=>r.push.register(r.device.deviceId,'SECRET_TOKEN'),(e:any)=>e.status===503);await r.push.close();};
 try{
  chmodSync(r.configFile,0o644);await reject();chmodSync(r.configFile,0o600);
  chmodSync(r.accountFile,0o640);await reject();chmodSync(r.accountFile,0o600);
  for(const change of [{project_id:'wrong'},{token_uri:'https://attacker.invalid/token'},{private_key:'SECRET_INVALID_KEY'}]){
   writeFileSync(r.accountFile,JSON.stringify({...r.account,...change}));await reject();
  }
  writeFileSync(r.accountFile,JSON.stringify(r.account));
  const link=join(r.state.dir,'credential-link');symlinkSync(r.accountFile,link);
  writeFileSync(r.configFile,JSON.stringify({projectId:PROJECT,serviceAccountFile:link}));await reject();
  writeFileSync(r.configFile,JSON.stringify({projectId:PROJECT,serviceAccountFile:'relative.json'}));await reject();
  assert.equal(r.fake.calls.length,0);
  assert.ok(warning.mock.callCount()>0);
  for(const call of warning.mock.calls)assert.deepEqual(call.arguments,['[firebase-push] disabled: configuration is invalid or not private']);
 }finally{await r.close();}
});

test('RS256 service-account OAuth, cached/renewed access, fixed data-only payload and no conversation content',async()=>{
 const r=await fixture();
 try{
  r.push.register(r.device.deviceId,'FCM_TOKEN_SECRET');
  const chat=await r.chat();await settled(r.h,chat.id);await r.push.flush();
  assert.equal(sends(r.fake).length,1);assert.equal(oauth(r.fake).length,1);
  const form=oauth(r.fake)[0].body as URLSearchParams;
  assert.equal(form.get('grant_type'),'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const jwt=form.get('assertion')!,[header,claims,signature]=jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header,'base64url').toString()),{alg:'RS256',typ:'JWT'});
  assert.deepEqual(JSON.parse(Buffer.from(claims,'base64url').toString()),{iss:email,scope:'https://www.googleapis.com/auth/firebase.messaging',aud:OAUTH,iat:r.clock.now/1000,exp:r.clock.now/1000+3600});
  assert.ok(verify('RSA-SHA256',Buffer.from(header+'.'+claims),keys.publicKey,Buffer.from(signature,'base64url')));
  const message={token:'FCM_TOKEN_SECRET',android:{priority:'high',ttl:'300s',collapse_key:'bob-attention'},data:{type:'bob_attention',backendId:r.state.id,sources:'reply'}};
  assert.deepEqual(sends(r.fake)[0].body,{message});assert.equal(sends(r.fake)[0].headers.get('authorization'),'Bearer OAUTH_SECRET');
  assert.doesNotMatch(JSON.stringify(sends(r.fake).map(c=>c.body)),/PRIVATE_|chat|credential|question|title/);
  r.push.attention('maintenance:second');await r.push.flush();assert.equal(oauth(r.fake).length,1);
  await r.clock.advance(3_541_000);r.push.attention('maintenance:third');await r.push.flush();assert.equal(oauth(r.fake).length,2);
  assert.equal(r.push.status().pending,0,'provider acceptance drains queue, not a delivery receipt');
 }finally{await r.close();}
});

test('attach never replays historical replies, unanswered submissions, schedule entries or Questions',async()=>{
 const r=await fixture({attach:false});
 try{
  const chat=await r.chat();await settled(r.h,chat.id);await settled(r.h,chat.id,{unanswered:true});
  await r.h.commit(async tx=>{(await tx.doc(Questions,chat.id)).pending={id:'historical',text:'PRIVATE_QUESTION'};await tx.appendEntry(chat.id,{kind:'bob.schedule-alert',data:{text:'PRIVATE_SCHEDULE'}});},ctx);
  await r.attach();r.push.register(r.device.deviceId,'TOKEN');await r.push.flush();await r.clock.advance(100);
  assert.equal(r.fake.calls.length,0);
 }finally{await r.close();}
});

test('new owner done/unanswered, pending Questions and schedule alerts notify; duplicate commits coalesce',async()=>{
 const r=await fixture();
 try{
  r.push.register(r.device.deviceId,'TOKEN');const chat=await r.chat();
  await settled(r.h,chat.id);await settled(r.h,chat.id,{unanswered:true});
  await r.h.commit(async tx=>{(await tx.doc(Questions,chat.id)).pending={id:'question-1',text:'PRIVATE_QUESTION'};await tx.appendEntry(chat.id,{kind:'bob.schedule-alert',data:{text:'PRIVATE_SCHEDULE'}});},ctx);
  await r.push.flush();assert.equal(sends(r.fake).length,1);
  await r.h.commit(async tx=>{(await tx.doc(Questions,chat.id)).pending!.text='PRIVATE_CHANGED_QUESTION';},ctx);
  await r.push.flush();assert.equal(sends(r.fake).length,1,'same pending question ID is deduplicated');
  await r.h.commit(async tx=>{(await tx.doc(Questions,chat.id)).pending={id:'question-2',text:'PRIVATE_NEW_QUESTION'};},ctx);
  await r.push.flush();assert.equal(sends(r.fake).length,2);
  await settled(r.h,chat.id,{unanswered:true,unplaced:true,requestId:`device:${r.device.deviceId}:request`});await r.push.flush();assert.equal(sends(r.fake).length,3);
  assert.doesNotMatch(JSON.stringify(sends(r.fake)),/PRIVATE_/);
 }finally{await r.close();}
});

test('root/library, task-owned helpers, passive writes, peer inputs and empty/tool-only answers stay silent',async()=>{
 const r=await fixture();
 try{
  r.push.register(r.device.deviceId,'TOKEN');const chat=await r.chat();
  const taskId=await r.h.commit(tx=>tx.createTask(ownerTask,{}, {conversationId:chat.id,ownership:{kind:'conversation'}}),ctx);
  const helper=await r.h.createConversation({ownership:{kind:'task',taskId}},ctx);
  for(const id of [r.root.id,helper.id]){
   await settled(r.h,id);
   await r.h.commit(async tx=>{(await tx.doc(Questions,id)).pending={id:'helper-question',text:'PRIVATE_HELPER'};await tx.appendEntry(id,{kind:'bob.schedule-alert',data:{text:'PRIVATE_HELPER'}});},ctx);
  }
  await settled(r.h,chat.id,{write:true});await settled(r.h,chat.id,{kind:'bob.peer'});await settled(r.h,chat.id,{answer:'   '});
  await settled(r.h,chat.id,{unanswered:true,unplaced:true,requestId:'schedule:worker'});
  await r.h.commit(async tx=>{
   const input=await tx.appendEntry(chat.id,{kind:'bob.user'}),answer=await tx.appendEntry(chat.id,{kind:'pi.assistant',model:[fauxAssistantMessage([fauxToolCall('bash',{secret:'PRIVATE_TOOL'})],{stopReason:'toolUse'})]});
   await tx.createSubmission({conversationId:chat.id,type:'input',status:'done',entry:input.id,answer:answer.id});
   await tx.appendEntry(chat.id,{kind:'bob.memory-status',data:{text:'PRIVATE_STATUS'}});
  },ctx);
  await r.push.flush();assert.equal(r.fake.calls.length,0);
 }finally{await r.close();}
});

test('synchronous durable admission, per-device coalescing/dedup, same-token registration and unregister',async()=>{
 const r=await fixture();
 try{
  const second=r.state.pair(r.state.invite().token,'Second phone');r.push.register(r.device.deviceId,'FIRST');r.push.register(second.deviceId,'SECOND');
  assert.equal(r.push.attention('PRIVATE_MAINTENANCE_KEY'),undefined);
  assert.equal(r.push.status().pending,2);assert.equal(r.state.get<any>('firebasePush.queue').pending.length,2);assert.equal(r.fake.calls.length,0);
  r.push.register(r.device.deviceId,'FIRST');assert.equal(r.push.status().pending,2,'idempotent registration preserves pending attention');
  r.push.attention('PRIVATE_MAINTENANCE_KEY');r.push.attention('another');assert.equal(r.push.status().pending,2);
  assert.doesNotMatch(JSON.stringify(r.state.get('firebasePush.queue')),/FIRST|SECOND|PRIVATE_MAINTENANCE_KEY/);
  r.push.unregister(second.deviceId);await r.push.flush();assert.deepEqual(sends(r.fake).map(c=>c.body.message.token),['FIRST']);
  r.push.attention('another');await r.push.flush();assert.equal(sends(r.fake).length,1);
 }finally{await r.close();}
});

test('queue/dedup bounds and five-minute expiry without network or historical replay',async()=>{
 const r=await fixture({attach:false});
 try{
  r.state.set('firebasePush.queue',{pending:[],recent:Array.from({length:512},(_,i)=>({key:`old:${i}`,expiresAt:r.clock.now+300_000}))});
  await r.attach();r.push.register(r.device.deviceId,'TOKEN');
  for(let i=0;i<3;i++)r.push.attention(`event:${i}`);
  assert.equal(r.state.get<any>('firebasePush.queue').recent.length,512);assert.equal(r.push.status().pending,1);
  await r.push.close();r.clock.now+=300_001;await r.attach();await r.push.flush();assert.equal(r.fake.calls.length,0);assert.equal(r.push.status().pending,0);
 }finally{await r.close();}
});

test('transient retries are bounded, respect Retry-After, and recover queued work after restart',async t=>{
 const warning=t.mock.method(console,'warn',()=>{});
 const r=await fixture();
 try{
  let attempt=0;r.fake.send=async()=>{attempt++;return Response.json({error:'PRIVATE_PROVIDER_ERROR'},{status:attempt===1?429:503,headers:attempt===1?{'retry-after':'2'}:{}});};
  r.push.register(r.device.deviceId,'TOKEN');r.push.attention('retry');await r.push.flush();assert.equal(attempt,1);
  await r.push.close();await r.attach();await r.push.flush();assert.equal(attempt,1);
  await r.clock.advance(1999);await r.push.flush();assert.equal(attempt,1);
  await r.clock.advance(1);await r.push.flush();assert.equal(attempt,2);
  await r.clock.advance(5000);await r.push.flush();assert.equal(attempt,3);
  await r.clock.advance(30_000);await r.push.flush();assert.equal(attempt,4);assert.equal(r.push.status().pending,0);
  await r.clock.advance(60_000);await r.push.flush();assert.equal(attempt,4);
  assert.equal(oauth(r.fake).length,2,'restart after first attempt renews OAuth once');
  assert.deepEqual(warning.mock.calls.map(c=>c.arguments),[['[firebase-push] attention not accepted: retry limit reached']]);
 }finally{await r.close();}
});

test('401 refreshes OAuth, permanent auth/provider failures do not retry or expose their error bodies',async t=>{
 const warning=t.mock.method(console,'warn',()=>{});
 const r=await fixture();
 try{
  r.fake.send=async()=>Response.json({error:'PROVIDER_SECRET'},{status:sends(r.fake).length===1?401:200});
  r.push.register(r.device.deviceId,'TOKEN');r.push.attention('first');await r.push.flush();assert.equal(r.push.status().pending,1);
  await r.clock.advance(1000);await r.push.flush();assert.equal(oauth(r.fake).length,2);assert.equal(r.push.status().pending,0);
  r.fake.send=async()=>Response.json({error:{message:'TOKEN_AND_PROVIDER_SECRET'}},{status:400});
  r.push.attention('second');await r.push.flush();assert.equal(r.push.status().pending,0);
  assert.ok(r.state.get('firebasePush.device:'+r.device.deviceId),'generic INVALID_ARGUMENT must not prune a token');
  await r.push.close();await r.attach();r.fake.auth=async()=>Response.json({error_description:'PRIVATE_CREDENTIAL_PATH_AND_KEY'},{status:400});
  r.push.attention('bad-auth');await r.push.flush();assert.equal(r.push.status().pending,0);
  assert.doesNotMatch(JSON.stringify(r.state.get('firebasePush.queue')),/SECRET|PRIVATE_/);
  assert.equal(warning.mock.callCount(),2);
  for(const call of warning.mock.calls)assert.deepEqual(call.arguments,['[firebase-push] attention not accepted: transport rejected request']);
 }finally{await r.close();}
});

test('explicit invalid registration prunes only the matching token generation',async()=>{
 const r=await fixture();
 try{
  const response=deferred<Response>();r.fake.send=()=>response.promise;
  r.push.register(r.device.deviceId,'OLD');r.push.attention('old');const work=r.push.flush();await tick();assert.equal(sends(r.fake).length,1);
  r.push.register(r.device.deviceId,'NEW');response.resolve(invalid());await work;
  assert.equal(r.state.get<any>('firebasePush.device:'+r.device.deviceId).token,'NEW');
  r.fake.send=async()=>invalid('INVALID_ARGUMENT',400);r.push.attention('new');await r.push.flush();assert.equal(r.state.get('firebasePush.device:'+r.device.deviceId),undefined);
  r.push.attention('after-invalid');await r.push.flush();assert.equal(sends(r.fake).length,2);
 }finally{await r.close();}
});

for(const action of ['rotate','unregister','revoke'] as const)test(`${action} during OAuth fences the pending token before FCM send`,async()=>{
 const r=await fixture();
 try{
  const auth=deferred<Response>();r.fake.auth=()=>auth.promise;
  r.push.register(r.device.deviceId,'OLD');r.push.attention('first');const work=r.push.flush();await tick();
  if(action==='rotate')r.push.register(r.device.deviceId,'NEW');
  else if(action==='unregister')r.push.unregister(r.device.deviceId);
  else r.state.revoke(r.device.deviceId);
  auth.resolve(Response.json({access_token:'OAUTH_SECRET',expires_in:3600}));await work;
  assert.equal(sends(r.fake).length,0);assert.equal(r.push.status().pending,0);
 }finally{await r.close();}
});

for(const phase of ['auth','send'] as const)test(`${phase} timeout is bounded; shutdown aborts even a fetch ignoring AbortSignal, without late State writes`,async()=>{
 const r=await fixture();
 try{
  const never=deferred<Response>();if(phase==='auth')r.fake.auth=()=>never.promise;else r.fake.send=()=>never.promise;
  r.push.register(r.device.deviceId,'TOKEN');r.push.attention('timeout');let work=r.push.flush();await tick();
  await r.clock.advance(1000);await work;assert.equal(r.push.status().pending,1);
  // Retry starts, then close while the fake transport deliberately ignores abort.
  r.clock.now+=1000;work=r.push.flush();await tick();
  const saved=JSON.stringify(r.state.get('firebasePush.queue'));
  await r.push.close();await work;assert.equal(r.clock.timers.size,0);
  never.resolve(Response.json({access_token:'LATE_SECRET',expires_in:3600}));await tick();
  assert.equal(JSON.stringify(r.state.get('firebasePush.queue')),saved);
  assert.throws(()=>r.push.register(r.device.deviceId,'NEW'),(e:any)=>e.status===503);
  assert.throws(()=>r.push.attention('closed'),(e:any)=>e.status===503);
  r.push.unregister(r.device.deviceId);await r.push.flush();assert.equal(JSON.stringify(r.state.get('firebasePush.queue')),saved);
 }finally{await r.close();}
});

test('commit listeners never await provider I/O and a resolved question is suppressed before observation',async()=>{
 const r=await fixture();
 try{
  r.push.register(r.device.deviceId,'TOKEN');const chat=await r.chat();
  await r.h.commit(async tx=>{(await tx.doc(Questions,chat.id)).pending={id:'resolved',text:'PRIVATE'};},ctx);
  await r.h.commit(async tx=>{delete (await tx.doc(Questions,chat.id)).pending;},ctx);
  await r.push.flush();assert.equal(r.fake.calls.length,0);
  const response=deferred<Response>();r.fake.send=()=>response.promise;
  await settled(r.h,chat.id);const work=r.push.flush();await tick();
  // This commit must complete although provider acceptance is still pending.
  await r.h.commit(tx=>tx.appendEntry(chat.id,{kind:'bob.memory-status',data:{text:'not attention'}}),ctx);
  assert.equal(sends(r.fake).length,1);response.resolve(Response.json({name:'accepted'}));await work;
 }finally{await r.close();}
});

test('another owner project is selected from validated config, not compiled into the transport',async()=>{
 const r=await fixture({attach:false});
 try{
  const projectId='another-owner-123';r.fake.projectId=projectId;
  writeFileSync(r.accountFile,JSON.stringify({...r.account,project_id:projectId,client_email:`push@${projectId}.iam.gserviceaccount.com`}));
  writeFileSync(r.configFile,JSON.stringify({projectId,serviceAccountFile:r.accountFile}));
  await r.attach();assert.equal(r.push.enabled,true);
  r.push.register(r.device.deviceId,'TOKEN');r.push.attention('project-test');await r.push.flush();
  assert.equal(sends(r.fake)[0].url,`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`);
 }finally{await r.close();}
});

test('failed synchronous admission is sanitized and cannot create a false durable dedup hit',async t=>{
 const r=await fixture();
 try{
  r.push.register(r.device.deviceId,'TOKEN');
  t.mock.method(r.state,'set',()=>{throw Error('PRIVATE_DATABASE_ERROR');},{times:1});
  assert.throws(()=>r.push.attention('stable-key'),(e:any)=>e.status===503&&e.message==='Firebase push queue unavailable');
  assert.equal(r.push.status().pending,0);assert.equal(r.state.get<any>('firebasePush.queue').pending.length,0);
  r.push.attention('stable-key');assert.equal(r.state.get<any>('firebasePush.queue').pending.length,1);
  await r.push.flush();assert.equal(sends(r.fake).length,1);
 }finally{await r.close();}
});

test('coalescing preserves source categories so muted replies cannot hide a question or schedule',async()=>{
 const r=await fixture();
 try{
  r.push.register(r.device.deviceId,'TOKEN');
  r.push.attention('question-one','question');
  r.push.attention('reply-one','reply');
  r.push.attention('schedule-one','schedule');
  r.push.attention('build-one','update');
  await r.push.flush();
  assert.equal(sends(r.fake).length,1);
  assert.equal(sends(r.fake)[0].body.message.data.sources,'reply,question,schedule,update');
  r.push.attention('later-reply','reply');await r.push.flush();
  assert.equal(sends(r.fake)[1].body.message.data.sources,'reply','completed coalesced sources do not leak into future notices');
  assert.throws(()=>r.push.attention('invalid','private text' as any),(e:any)=>e.status===400);
 }finally{await r.close();}
});
