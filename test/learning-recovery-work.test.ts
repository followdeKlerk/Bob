import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Harness,MemoryStorage,createRegistry,defineExtension,defineTask,type ConversationId,type SubmissionRecord,type Storage} from '@earendil-works/pi-durable';
import {openNodeSqliteStorage} from '@earendil-works/pi-durable/storage/sqlite/node';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';
import {createModels} from '@earendil-works/pi-ai/models';
import {createLearning,LearningInstallation,LearningSettings,LearningActivity,LearningReceipts,LearningPolicy} from '../src/learning.js';

// Instrument the real Harness/Tx surface; no replacement learning implementation or provider requests.
const counters=()=>({commits:0,storedBatches:0,storedWrites:0,receiptReads:0,conversationReads:0,entryReads:0,docReads:0,snapshots:0,resolutions:0,pages:0});
type Counts=ReturnType<typeof counters>;
function instrument(h:Harness,counts:Counts,fail:{agent?:boolean;entry?:boolean}){
 return new Proxy(h,{get(target,key){
  if(key==='commit')return (fn:any,context:any)=>{counts.commits++;return h.commit(tx=>fn(new Proxy(tx,{get(t,k){
   if(k==='doc')return (...args:any[])=>{counts.docReads++;if(args[0]===LearningReceipts)counts.receiptReads++;return (t.doc as any)(...args);};
   if(k==='conversation')return (...args:any[])=>{counts.conversationReads++;return (t.conversation as any)(...args);};
   if(k==='entry')return (...args:any[])=>{counts.entryReads++;if(fail.entry){fail.entry=false;throw Error('injected capture failure');}return (t.entry as any)(...args);};
   const value=Reflect.get(t,k);return typeof value==='function'?value.bind(t):value;
  }})),context);};
  if(key==='snapshot')return (...args:any[])=>{counts.snapshots++;if(args[0]===LearningReceipts)counts.receiptReads++;return (h.snapshot as any)(...args);};
  if(key==='conversation')return async (...args:any[])=>{counts.conversationReads++;const c=await (h.conversation as any)(...args);return c&&new Proxy(c,{get(t,k){if(k==='agent')return (...a:any[])=>{counts.resolutions++;if(fail.agent)throw Error('injected agent failure');return t.agent(a[0]);};const v=Reflect.get(t,k);return typeof v==='function'?v.bind(t):v;}});};
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
}
const resources=defineExtension({name:'bob.resources'});
const parent=defineTask<null,{phase:'idle'},null>({name:'learning-work-fixture',version:1,initial:()=>({phase:'idle'}),phases:{idle:async(_task,runtime,context)=>runtime.commit(()=>({status:'terminal',outcome:{status:'completed',result:null}}),context)},abort:async(_task,runtime,context)=>runtime.commit(()=>({status:'terminal',outcome:{status:'aborted'}}),context)});
async function fixture(path?:string){
 const storage:Storage=path?await openNodeSqliteStorage(path):new MemoryStorage(),registry=createRegistry();registry.install(resources);registry.install(defineExtension({name:'learning-work-fixture',tasks:[parent]}));
 const counts=counters(),measuredStorage=new Proxy(storage,{get(target,key){
  if(key==='commit')return (batches:any,receive:any,context:any)=>{counts.storedBatches+=batches.length;counts.storedWrites+=batches.reduce((n:number,b:any[])=>n+b.length,0);return storage.commit(batches,receive,context);};
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 const h=await Harness.open(measuredStorage,{registry,models:createModels(),settings:{extensions:[resources]}},ctx);
 const library=await h.root(ctx),chat=await h.createConversation({ownership:{kind:'ownerless'}},ctx);
 await h.commit(async tx=>{await tx.doc(LearningInstallation);Object.assign(await tx.doc(LearningSettings),{memoryInterval:0,skillInterval:0});},ctx);
 const fail:{agent?:boolean;entry?:boolean}={},wrapped=instrument(h,counts,fail);
 const learning=()=>createLearning(()=>wrapped,()=>library.id);
 const reader={scanSubmissions:(...args:Parameters<typeof storage.scanSubmissions>)=>{counts.pages++;return storage.scanSubmissions(...args);}};
 const reset=()=>Object.assign(counts,counters());
 async function input(id=chat.id,kind='pi.user',tools:string[]=[]){return h.commit(async tx=>{
  const user=await tx.appendEntry(id,{kind,data:{text:'Verified owner work'},model:[{role:'user',content:'Verified owner work',timestamp:0}]});
  const answer=await tx.appendEntry(id,{kind:'pi.assistant',model:[{role:'assistant',content:tools.map(name=>({type:'toolCall' as const,id:name,name,arguments:{}})),timestamp:0,provider:'fixture',model:'fixture',api:'fixture',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop'}]});
  const s=await tx.createSubmission({type:'input',status:'done',conversationId:id,entry:user.id,answer:answer.id});
  (await tx.doc(LearningPolicy,id,String(s.id),true)).enabled=true;
  return {...s,status:'done',answer:answer.id} as SubmissionRecord;
 },ctx);}
 async function child(){return h.commit(async tx=>{const taskId=await tx.createTask(parent,null,{conversationId:chat.id,ownership:{kind:'conversation'}});return (await tx.createConversation({ownership:{kind:'task',taskId}})).id;},ctx);}
 return {storage,h,registry,library,chat,learning,reader,counts,fail,reset,input,child,close:()=>h.close(ctx)};
}

// This is the original finding's 300-child/two-attach probe, now an acceptance gate.
test('300 permanently excluded child completions are receipted in bounded recovery batches before resolution',async t=>{
 const f=await fixture();try{
  const child=await f.child();const inputs=[];for(let n=0;n<300;n++)inputs.push(await f.input(child));
  f.reset();for(let n=0;n<2;n++){const a=await f.learning().attach(f.reader);await a.close();}
  t.diagnostic(JSON.stringify(f.counts));
  assert.equal(f.counts.resolutions,0);
  assert.equal(f.counts.receiptReads,600,'historical receipt scan remains linear');
  assert.ok(f.counts.commits<=6,'at most one preflight transaction per 100-row page, not per excluded input');
  for(const s of inputs)assert.equal((await f.h.snapshot(LearningReceipts,child,String(s.id),ctx))?.processed,true);
  assert.equal(await f.h.snapshot(LearningActivity,child,ctx),undefined);
 }finally{await f.close();}
});

test('normal eligible recovery and direct capture operation counts',async t=>{
 const f=await fixture();try{
  for(let n=0;n<100;n++)await f.input();
  f.reset();for(let n=0;n<2;n++){const a=await f.learning().attach(f.reader);await a.close();}
  t.diagnostic('100 eligible / two attaches '+JSON.stringify(f.counts));
  assert.equal(f.counts.storedBatches,100,'no new persisted transaction on eligible recovery');
  assert.equal(f.counts.storedWrites,200,'no eager false receipt writes');
  assert.equal(f.counts.commits,102,'only two page preflights beyond normal capture transactions');
  assert.equal((await f.h.snapshot(LearningActivity,f.chat.id,ctx))?.turns,100);
  const s=await f.input();f.reset();await f.learning().capture(s);
  t.diagnostic('direct eligible '+JSON.stringify(f.counts));
  assert.equal(f.counts.commits,2,'one read-only ownership preflight plus the existing capture mutation');
  assert.equal(f.counts.storedBatches,1);assert.equal(f.counts.storedWrites,2);
  assert.equal((await f.h.snapshot(LearningActivity,f.chat.id,ctx))?.turns,101);
 }finally{await f.close();}
});

test('direct capture checks immutable child/library exclusion before a broken agent; eligible costs are measured',async t=>{
 const f=await fixture();try{
  const child=await f.input(await f.child()),library=await f.input(f.library.id),eligible=await f.input();
  f.fail.agent=true;await f.learning().capture(child);await f.learning().capture(library);
  assert.equal(f.counts.resolutions,0);
  for(const s of [child,library])assert.equal((await f.h.snapshot(LearningReceipts,s.conversationId,String(s.id),ctx))?.processed,true);
  f.fail.agent=false;f.reset();await f.learning().capture(eligible);t.diagnostic('direct eligible '+JSON.stringify(f.counts));
  assert.equal((await f.h.snapshot(LearningActivity,f.chat.id,ctx))?.turns,1);
  await f.learning().capture(eligible);assert.equal((await f.h.snapshot(LearningActivity,f.chat.id,ctx))?.turns,1,'direct capture remains idempotent');
 }finally{await f.close();}
});

test('missing resources and agent/capture failures remain retryable; atomic capture failure rolls back receipt',async()=>{
 const f=await fixture();try{
  const s=await f.input();
  await f.learning().capture({...s,conversationId:999999 as ConversationId});
  assert.equal(f.counts.resolutions,0,'missing conversation is not resolved or permanently acknowledged');
  await f.chat.configure({extensions:[]},ctx);await f.learning().capture(s);
  const unavailable=await f.learning().attach(f.reader);await unavailable.close();
  assert.notEqual((await f.h.snapshot(LearningReceipts,f.chat.id,String(s.id),ctx))?.processed,true);
  await f.chat.configure({extensions:[resources]},ctx);f.fail.agent=true;
  await assert.rejects(()=>f.learning().capture(s),/injected agent failure/);
  assert.notEqual((await f.h.snapshot(LearningReceipts,f.chat.id,String(s.id),ctx))?.processed,true);
  f.fail.agent=false;f.fail.entry=true;await assert.rejects(()=>f.learning().capture(s),/injected capture failure/);
  assert.notEqual((await f.h.snapshot(LearningReceipts,f.chat.id,String(s.id),ctx))?.processed,true);
  const a=await f.learning().attach(f.reader);await a.close();
  assert.equal((await f.h.snapshot(LearningReceipts,f.chat.id,String(s.id),ctx))?.processed,true);
  assert.equal((await f.h.snapshot(LearningActivity,f.chat.id,ctx))?.turns,1);
 }finally{await f.close();}
});

test('observed completion failure is retried on reattach without dropping or double-counting the input',async()=>{
 const f=await fixture();try{
  const a=await f.learning().attach(f.reader);f.fail.entry=true;
  const s=await f.input();await a.flush();await a.close();
  assert.notEqual((await f.h.snapshot(LearningReceipts,s.conversationId,String(s.id),ctx))?.processed,true);
  assert.match((await f.h.snapshot(LearningActivity,f.chat.id,ctx))?.error??'',/restart retries/);
  const b=await f.learning().attach(f.reader);await b.close();
  assert.equal((await f.h.snapshot(LearningActivity,f.chat.id,ctx))?.turns,1);
  assert.equal((await f.h.snapshot(LearningReceipts,s.conversationId,String(s.id),ctx))?.processed,true);
 }finally{await f.close();}
});

test('installation floor, input guards and admission-order skill resets survive mixed recovery',async t=>{
 const f=await fixture();try{
  const old=await f.input(),oldChild=await f.input(await f.child());
  await f.h.commit(async tx=>{(await tx.doc(LearningInstallation)).floor=oldChild.id;},ctx);
  const skill=await f.input(f.chat.id,'pi.user',['skill_save']),newer=await f.input(f.chat.id,'pi.user',['read']);
  const peer=await f.input(f.chat.id,'bob.peer-message'),lib=await f.input(f.library.id),child=await f.input(await f.child());
  f.reset();const a=await f.learning().attach(f.reader);await a.close();t.diagnostic('mixed recovery '+JSON.stringify(f.counts));
  const activity=await f.h.snapshot(LearningActivity,f.chat.id,ctx);assert.equal(activity?.turns,2);assert.equal(activity?.iterations,1,'skill reset must precede newer round');
  for(const s of [skill,newer,peer,lib,child])assert.equal((await f.h.snapshot(LearningReceipts,s.conversationId,String(s.id),ctx))?.processed,true);
  for(const s of [old,oldChild])assert.equal(await f.h.snapshot(LearningReceipts,s.conversationId,String(s.id),ctx),undefined);
  await f.learning().capture({...newer,type:'write'} as any);await f.learning().capture({...newer,status:'placed'} as any);
  assert.equal((await f.h.snapshot(LearningActivity,f.chat.id,ctx))?.turns,2);
 }finally{await f.close();}
});

test('first attach establishes installation floor without acknowledging older owner or child completions',async()=>{
 const f=await fixture();try{
  const old=await f.input(),child=await f.input(await f.child());
  await f.h.commit(tx=>tx.retireDoc(LearningInstallation),ctx);f.reset();
  const a=await f.learning().attach(f.reader);await a.close();
  assert.equal((await f.h.snapshot(LearningInstallation,ctx))?.floor,child.id);
  assert.equal(f.counts.resolutions,0);
  for(const s of [old,child])assert.equal(await f.h.snapshot(LearningReceipts,s.conversationId,String(s.id),ctx),undefined);
  const fresh=await f.input();const b=await f.learning().attach(f.reader);await b.close();
  assert.equal((await f.h.snapshot(LearningActivity,f.chat.id,ctx))?.turns,1);
  assert.equal((await f.h.snapshot(LearningReceipts,f.chat.id,String(fresh.id),ctx))?.processed,true);
 }finally{await f.close();}
});

test('native SQLite reopen retains exclusions and recovers eligible missed completion after failed attach',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bob-learning-work-')),path=join(dir,'durable.sqlite');let f=await fixture(path);
 try{
  const child=await f.input(await f.child()),lib=await f.input(f.library.id),eligible=await f.input();const chatId=f.chat.id,libraryId=f.library.id;
  f.fail.entry=true;await assert.rejects(()=>f.learning().attach(f.reader),/injected capture failure/);
  assert.equal((await f.h.snapshot(LearningReceipts,child.conversationId,String(child.id),ctx))?.processed,true);
  await f.close();f=await fixture(path);
  // Use the original library identity, not the fixture's newly-created chat.
  const wrapped=instrument(f.h,f.counts,f.fail),learning=createLearning(()=>wrapped,()=>libraryId);
  f.reset();const a=await learning.attach(f.reader);await a.close();
  assert.equal(f.counts.resolutions,1,'only eligible missed completion resolves after reopen');
  for(const s of [child,lib,eligible])assert.equal((await f.h.snapshot(LearningReceipts,s.conversationId,String(s.id),ctx))?.processed,true);
  assert.equal((await f.h.snapshot(LearningActivity,chatId,ctx))?.turns,1);
  const b=await learning.attach(f.reader);await b.close();assert.equal(f.counts.resolutions,1,'no repeated capture after second attach');
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});
