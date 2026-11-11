import assert from 'node:assert/strict';
import test from 'node:test';
import {createReplyPresentation} from '../src/reply-presentation.js';
const entry=(id:number,kind='pi.assistant',conversationId=7)=>({id,conversationId,kind,model:kind==='pi.assistant'?[{role:'assistant',content:'Answer'}]:undefined}) as any;
function fixture(){
 let observer:any,detached=0,scans=0,reads=0;let subs:any[]=[];
 const publications={observeCommits(value:any){observer=value;return {detach(){detached++;}};}};
 const reader={scanSubmissions:async()=>{scans++;return {items:subs.slice()};},entry:async(id:number)=>{reads++;return {entry:entry(id),commitSeq:1};}};
 const present=createReplyPresentation(reader as any,publications as any);
 return {present,reader,publications,set:(value:any[])=>{subs=value;},publish:(type='submission',conversationId=7,kind='pi.assistant')=>observer?.advance({changes:[{type,value:{conversationId,kind}}]}),counts:()=>({scans,reads,detached})};
}
const done=(first:number,answer=50)=>({conversationId:7,type:'input',status:'done',entry:first,answer});
test('same-window late settlements, expanded shared answers and new overlaps invalidate attribution',async()=>{
 const f=fixture(),rows=[entry(20,'bob.file'),entry(50)];
 assert.equal((await f.present(7 as any,rows))[0].mobileReply,undefined);
 f.set([done(10)]);f.publish();assert.deepEqual((await f.present(7 as any,rows))[0].mobileReply,{version:1,first:10,answer:50});
 f.set([done(10),done(5)]);f.publish();assert.equal((await f.present(7 as any,rows))[0].mobileReply.first,5);
 f.set([done(10),done(40,60)]);f.publish();assert.equal((await f.present(7 as any,rows))[0].mobileReply,undefined);
});
test('different windows and unrelated appended entries reuse one conversation index and answer proofs',async()=>{
 const f=fixture();f.set([done(1)]);
 for(let i=0;i<20;i++){f.publish('entry',7,'bob.memory-status');await f.present(7 as any,[entry(20+i,'bob.file')]);}
 assert.deepEqual(f.counts(),{scans:1,reads:1,detached:0});
 f.publish('document');f.publish('submission',8);await f.present(7 as any,[entry(25)]);assert.equal(f.counts().scans,1);
});

const deferred=<T>()=>{let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
test('in-flight scan invalidation discards old proof without overwriting the newer generation',async()=>{
 const f=fixture(),held=deferred<any>();let first=true;
 f.reader.scanSubmissions=async()=>first?(first=false,held.promise):{items:[done(10)]};
 const old=f.present(7 as any,[entry(20,'bob.file')]);await Promise.resolve();
 f.publish();const fresh=await f.present(7 as any,[entry(20,'bob.file')]);assert.equal(fresh[0].mobileReply.first,10);
 held.resolve({items:[done(1)]});assert.equal((await old)[0].mobileReply.first,10);
 assert.equal((await f.present(7 as any,[entry(20,'bob.file')]))[0].mobileReply.first,10);
});
test('in-flight answer validation is discarded on publication and stale failures do not evict fresh proof',async()=>{
 for(const fail of [false,true]){
  const f=fixture(),held=deferred<any>();f.set([done(1)]);let first=true;
  f.reader.entry=async(id:number)=>first?(first=false,held.promise):{entry:entry(id),commitSeq:1};
  const old=f.present(7 as any,[entry(20,'bob.file')]);
  for(let n=0;first&&n<20;n++)await Promise.resolve();assert.equal(first,false);
  f.set([done(10)]);f.publish();assert.equal((await f.present(7 as any,[entry(20,'bob.file')]))[0].mobileReply.first,10);
  if(fail)held.reject(Error('obsolete read'));else held.resolve({entry:entry(50),commitSeq:1});
  assert.equal((await old)[0].mobileReply.first,10);
 }
});
test('errors are retryable, absent answer proof invalidates on creation, and close detaches once',async()=>{
 const f=fixture();let fail=true,missing=true;f.set([done(1)]);
 f.reader.entry=async(id:number)=>{if(fail)throw Error('read failed');return missing?undefined as any:{entry:entry(id),commitSeq:1};};
 await assert.rejects(f.present(7 as any,[entry(20)]),/read failed/);fail=false;
 assert.equal((await f.present(7 as any,[entry(20)]))[0].mobileReply,undefined);
 missing=false;f.publish('entry');assert.equal((await f.present(7 as any,[entry(20)]))[0].mobileReply.answer,50);
 f.present.close();f.present.close();assert.equal(f.counts().detached,1);await assert.rejects(f.present(7 as any,[]),/closed/);
});
test('close while a scan is pending cannot resurrect cached work',async()=>{
 const f=fixture(),held=deferred<any>();f.reader.scanSubmissions=()=>held.promise;
 const pending=f.present(7 as any,[entry(20)]);await Promise.resolve();f.present.close();held.resolve({items:[done(1)]});
 await assert.rejects(pending,/closed/);await assert.rejects(f.present(7 as any,[entry(20)]),/closed/);
});
test('96-conversation eviction is bounded and tiny windows only read intersecting answer proof',async()=>{
 const f=fixture();f.set(Array.from({length:1000},(_,i)=>done(i*4+1,i*4+3)));
 await f.present(7 as any,[entry(2,'bob.file')]);assert.equal(f.counts().reads,1);
 for(let id=8;id<=104;id++)await f.present(id as any,[entry(2,'bob.file',id)]);
 const before=f.counts().scans;await f.present(7 as any,[entry(2,'bob.file')]);assert.equal(f.counts().scans,before+1);
});

test('official SQLite commit observation refreshes late settlement, ignores progress, and reopens without stale caches',async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const {Harness,createRegistry}=await import('@earendil-works/pi-durable'),{openNodeSqliteStorage}=await import('@earendil-works/pi-durable/storage/sqlite/node');
 const {createModels}=await import('@earendil-works/pi-ai/models'),{BACKGROUND_CONTEXT:ctx}=await import('@earendil-works/chord/context');
 const {MemorySaves}=await import('@bob-local/memory');
 const dir=mkdtempSync(join(tmpdir(),'bob-reply-index-')),path=join(dir,'native.sqlite');
 let storage=await openNodeSqliteStorage(path),h=await Harness.open(storage,{registry:createRegistry(),models:createModels()},ctx),present=createReplyPresentation(storage,h);
 try{
  const chat=await h.createConversation({ownership:{kind:'ownerless'}},ctx);
  const {file,answer,sub}=await h.commit(async tx=>{
   const input=await tx.appendEntry(chat.id,{kind:'bob.user',data:{text:'Owner'}});
   const file=await tx.appendEntry(chat.id,{kind:'bob.file',data:{}});
   const answer=await tx.appendEntry(chat.id,{kind:'pi.assistant',model:entry(1).model});
   const sub=await tx.createSubmission({conversationId:chat.id,type:'input',status:'placed',entry:input.id});return {file,answer,sub};
  },ctx);
  assert.equal((await present(chat.id,[file,answer] as any[]))[0].mobileReply,undefined);
  await h.commit(tx=>{tx.settleSubmission(sub.id,{status:'done',answer:answer.id});},ctx);
  const projected=await present(chat.id,[file,answer] as any[]);assert.equal(projected[0].mobileReply.answer,answer.id);
  await h.commit(async tx=>{(await tx.doc(MemorySaves,chat.id,'progress',null)).status='accepted';await tx.appendEntry(chat.id,{kind:'bob.memory-status',data:{phase:'save-queued'}});},ctx);
  assert.equal((await present(chat.id,[file]))[0],projected[0]);
  present.close();await h.close(ctx);
  storage=await openNodeSqliteStorage(path);h=await Harness.open(storage,{registry:createRegistry(),models:createModels()},ctx);present=createReplyPresentation(storage,h);
  assert.equal((await present(chat.id,[file,answer] as any[]))[0].mobileReply.answer,answer.id);
 }finally{present.close();await h.close(ctx);rmSync(dir,{recursive:true,force:true});}
});
