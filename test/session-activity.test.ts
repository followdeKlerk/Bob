import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {InboxDoc,defineTask,defineExtension,type Conversation} from '@earendil-works/pi-durable';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {SessionUI} from '../src/session-controls.js';
import {ChatMeta} from '../src/documents.js';
import {createSessionActivity,SESSION_INACTIVITY_MS} from '../src/session-activity.js';
const held=defineTask<null,{phase:'hold'},null>({name:'test.session-activity-held',version:1,initial:()=>({phase:'hold'}),phases:{hold:async()=>{throw Error('Paused maintenance fixture must not run work');}}});
async function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'bob-session-activity-')),state=new State(dir),runtime=await openRuntime(state,undefined,undefined,{resume:false});
 runtime.registry.install(defineExtension({name:'test.session-activity',tasks:[held]}));
 let time=1700000000000;const now=()=>time;
 const activity=createSessionActivity(state,runtime.harness,runtime.library.id,{now,start:false});
 const create=()=>runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
 const archived=async(chat:Conversation)=>!!(await runtime.harness.snapshot(SessionUI,chat.id,ctx))?.archived;
 async function child(parent:Conversation){const taskId=await parent.commit(tx=>tx.createTask(held,null,{ownership:{kind:'conversation'},background:true}),ctx);return runtime.harness.createConversation({ownership:{kind:'task',taskId}},ctx);}
 return {dir,state,runtime,activity,now,create,archived,child,advance:(ms:number)=>{time+=ms;},async close(){await activity.close();await runtime.close();state.close();rmSync(dir,{recursive:true,force:true});}};
}
test('seven-day archive exempts pinned, foreground work, pending input and running descendants, not passive watchers',async()=>{
 const f=await fixture();try{
  const idle=await f.create(),pinned=await f.create(),working=await f.create(),parent=await f.create(),watcher=await f.create(),pending=await f.create();
  await pinned.commit(async tx=>{(await tx.doc(SessionUI,pinned.id)).pinned=true;},ctx);
  await working.commit(tx=>tx.createTask(held,null,{ownership:{kind:'conversation'}}),ctx);
  const child=await f.child(parent);await child.commit(tx=>tx.createTask(held,null,{ownership:{kind:'conversation'}}),ctx);
  await watcher.commit(tx=>tx.createTask(held,null,{ownership:{kind:'conversation'},background:true}),ctx);
  await pending.commit(async tx=>{const sub=await tx.createSubmission({conversationId:pending.id,type:'input',status:'queued'});(await tx.doc(InboxDoc,pending.id)).items.push({id:sub.id,mode:'followUp',content:'Synthetic queued input'});},ctx);
  f.advance(SESSION_INACTIVITY_MS-1);await f.activity.tick();assert.equal(await f.archived(idle),false);
  f.advance(1);await f.activity.tick();
  assert.equal(await f.archived(idle),true);assert.equal(await f.archived(watcher),true);
  for(const chat of [pinned,working,parent,pending])assert.equal(await f.archived(chat),false);
  assert.equal((await f.runtime.harness.inspect(ctx)).scheduling,'paused','maintenance never resumes work');
 }finally{await f.close();}
});
test('descendant activity refreshes its parent group, while reading and passive document edits do not',async()=>{
 const f=await fixture();try{
  const parent=await f.create(),child=await f.child(parent),passive=await f.create();
  f.advance(6*86400000);await child.commit(tx=>tx.appendEntry(child.id,{kind:'pi.assistant',data:{text:'Synthetic activity'}}),ctx);
  await passive.commit(async tx=>{(await tx.doc(ChatMeta,passive.id)).title='Metadata only';},ctx);
  f.advance(2*86400000);await f.activity.tick();assert.equal(await f.archived(parent),false);assert.equal(await f.archived(passive),true);
  const before=f.activity.lastActivityAt(parent.id);await f.runtime.harness.snapshot(ChatMeta,parent.id,ctx);assert.equal(f.activity.lastActivityAt(parent.id),before);
  f.advance(5*86400000);await f.activity.tick();assert.equal(await f.archived(parent),true);
 }finally{await f.close();}
});
test('unknown legacy ages receive an observation grace, and activity survives tracker restart',async()=>{
 const f=await fixture();try{
  await f.activity.close();const legacy=await f.create();f.advance(30*86400000);
  let tracker=createSessionActivity(f.state,f.runtime.harness,f.runtime.library.id,{now:f.now,start:false});
  await tracker.tick();assert.equal(await f.archived(legacy),false);const seen=tracker.lastActivityAt(legacy.id);assert.equal(seen,f.now());
  await tracker.close();f.advance(SESSION_INACTIVITY_MS-1);
  tracker=createSessionActivity(f.state,f.runtime.harness,f.runtime.library.id,{now:f.now,start:false});await tracker.tick();assert.equal(tracker.lastActivityAt(legacy.id),seen);assert.equal(await f.archived(legacy),false);
  f.advance(1);await tracker.tick();assert.equal(await f.archived(legacy),true);
  await legacy.commit(async tx=>{(await tx.doc(SessionUI,legacy.id)).archived=false;},ctx);tracker.touch(legacy.id);await tracker.tick();assert.equal(await f.archived(legacy),false,'explicit unarchive starts a fresh grace');
  await tracker.close();
 }finally{await f.close();}
});
test('trashed and already archived histories stay unchanged and pinned descendants protect the root',async()=>{
 const f=await fixture();try{
  const trash=await f.create(),archived=await f.create(),parent=await f.create(),child=await f.child(parent);
  await trash.commit(async tx=>{(await tx.doc(SessionUI,trash.id)).trashed=true;},ctx);
  await archived.commit(async tx=>{(await tx.doc(SessionUI,archived.id)).archived=true;},ctx);
  await child.commit(async tx=>{(await tx.doc(SessionUI,child.id)).pinned=true;},ctx);
  f.advance(SESSION_INACTIVITY_MS);await Promise.all([f.activity.tick(),f.activity.tick()]);
  assert.equal(await f.archived(trash),false);assert.equal(await f.archived(archived),true);assert.equal(await f.archived(parent),false);
  assert.ok(await f.runtime.harness.conversation(trash.id,ctx),'history is never deleted');
 }finally{await f.close();}
});
test('a descendant created after the ownership scan prevents an unsafe archive',async()=>{
 const f=await fixture();try{
  const parent=await f.create();f.advance(SESSION_INACTIVITY_MS);
  const h=f.runtime.harness,inspect=h.inspect.bind(h);let injected=false;
  h.inspect=async context=>{const captured=await inspect(context);if(!injected){injected=true;const child=await f.child(parent);await child.commit(tx=>tx.createTask(held,null,{ownership:{kind:'conversation'}}),ctx);}return captured;};
  await f.activity.tick();h.inspect=inspect;assert.equal(await f.archived(parent),false);
 }finally{await f.close();}
});
test('failed activity persistence suspends archiving instead of using a stale age',async()=>{
 const f=await fixture();try{
  const chat=await f.create();f.advance(SESSION_INACTIVITY_MS);
  const set=f.state.set.bind(f.state);f.state.set=(key,value)=>{if(key.startsWith('session-activity:'))throw Error('Synthetic storage failure');set(key,value);};
  await chat.commit(tx=>tx.appendEntry(chat.id,{kind:'bob.user',data:{text:'Synthetic fresh input'}}),ctx);
  f.state.set=set;await f.activity.tick();assert.equal(await f.archived(chat),false);
 }finally{await f.close();}
});
