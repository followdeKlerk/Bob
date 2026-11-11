import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Harness,MemoryStorage,createRegistry,defineExtension,defineTask,type ConversationId} from '@earendil-works/pi-durable';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';
import {createModels} from '@earendil-works/pi-ai/models';
import {Library} from '@bob-local/core/documents';
import {createResources,createSkillTools,LearningWorker,SkillMetadata,SkillReads,LearningToolReceipts} from '../packages/resources/src/index.js';

const fixtureParent=defineTask<null,{phase:'idle'},null>({name:'skill-batch-fixture-parent',version:1,initial:()=>({phase:'idle'}),phases:{idle:(_task,runtime,context)=>runtime.commit(()=>({status:'terminal',outcome:{status:'completed',result:null}}),context)},abort:(_task,runtime,context)=>runtime.commit(()=>({status:'terminal',outcome:{status:'aborted'}}),context)});
// Official disposable native storage; tools under test are source, not stale dist.
async function fixture(){
 let libraryId=0 as ConversationId;
 const extension=createResources(()=>libraryId,undefined,undefined,undefined,undefined,undefined,()=> 'Fixture.');
 const registry=createRegistry();registry.install(extension);registry.install(defineExtension({name:'skill-batch-fixture-parent',tasks:[fixtureParent]}));
 const h=await Harness.open(new MemoryStorage(),{registry,models:createModels(),settings:{extensions:[extension]}},ctx);
 libraryId=(await h.root(ctx)).id;
 const owner=await h.createConversation({ownership:{kind:'ownerless'}},ctx);
 const review=await h.createConversation({ownership:{kind:'ownerless'}},ctx);
 await h.commit(async tx=>{(await tx.doc(LearningWorker,review.id)).background=true;},ctx);
 const tools=createSkillTools(()=>libraryId);let task=0;
 async function tool(name:string,args:any,id=review.id,taskId=++task){
  const result=await tools.find(t=>t.name===name)!.execute(args,{conversationId:id,taskId,commit:(fn:any,c:any)=>h.commit(fn,c),snapshot:(...a:any[])=>(h.snapshot as any)(...a)} as any,ctx);
  return JSON.parse((result.output![0] as any).text);
 }
 const manage=(args:any,id=review.id,taskId?:number)=>tool('skill_manage',args,id,taskId);
 const view=(name='batch',file_path='SKILL.md')=>tool('skill_view',{name,file_path});
 const seed=async(name='batch')=>{
  await manage({action:'create',name,description:'Batch workflow.',content:'alpha'},owner.id);
  await manage({action:'write_file',name,file_path:'references/a.md',file_content:'one'},owner.id);
 };
 const read=async(name='batch')=>{await view(name);await view(name,'references/a.md');};
 const state=async()=>({library:await h.snapshot(Library,libraryId,ctx),meta:await h.snapshot(SkillMetadata,libraryId,ctx),worker:await h.snapshot(LearningWorker,review.id,ctx),reads:await h.snapshot(SkillReads,review.id,ctx),notices:(await owner.entries({},100,undefined,ctx)).items});
 const patch=(name='batch',expected=false)=>[
  {action:'patch',name,old_string:'alpha',new_string:'beta',...(expected?{expectedRevision:2}:{})},
  {action:'patch',name,file_path:'references/a.md',old_string:'one',new_string:'two',...(expected?{expectedRevision:3}:{})},
 ];
 const notices=async(id=owner.id)=>(await (await h.conversation(id,ctx))!.entries({order:'ascending'},100,undefined,ctx)).items.filter(e=>e.kind==='bob.learning-status');
 const child=()=>h.commit(async tx=>{const taskId=await tx.createTask(fixtureParent,null,{conversationId:owner.id,ownership:{kind:'conversation'}});return (await tx.createConversation({ownership:{kind:'task',taskId}})).id;},ctx);
 return {h,libraryId,owner,review,tools,tool,manage,view,seed,read,state,patch,notices,child,close:()=>h.close(ctx)};
}

test('background batch patches two exact files read at transaction-start revision, and replays atomically',async()=>{
 const f=await fixture();try{
  await f.seed();await f.read();
  const args={operations:f.patch('batch',true)};
  const result=await f.manage(args,f.review.id,9001);
  assert.equal(result.persisted,true);assert.deepEqual(result.results.map((r:any)=>r.revision),[3,4]);
  assert.deepEqual(await f.manage(args,f.review.id,9001),result);
  const saved=await f.state();
  assert.equal(saved.library!.skills.batch.markdown,'beta');assert.equal(saved.meta!.skills.batch.files['references/a.md'],'two');
  assert.equal(saved.meta!.skills.batch.ledger.length,4);
  assert.deepEqual(saved.worker!.changes!.skillChanges!.map(c=>c.revision),[3,4]);
  assert.equal(saved.reads!.files['batch/SKILL.md'].revision,2,'batch must not forge new read receipts');
  await assert.rejects(()=>f.manage({operations:[{action:'patch',name:'batch',old_string:'beta',new_string:'gamma'}]}),/Read-before-write/);
  await assert.rejects(()=>f.manage({operations:f.patch()},f.review.id,9001),/identity conflict/);
  assert.deepEqual(await f.state(),saved);
 }finally{await f.close();}
});

test('background batch needs no expectedRevision, but exact file reads are still mandatory',async()=>{
 const f=await fixture();try{
  await f.seed();await f.view();
  const before=await f.state();
  await assert.rejects(()=>f.manage({operations:f.patch()}),/Read-before-write.*references\/a.md/);
  assert.deepEqual(await f.state(),before);
  await f.view('batch','references/a.md');
  assert.equal((await f.manage({operations:f.patch()})).persisted,true);
 }finally{await f.close();}
});

test('expectedRevision retains sequential semantics for foreground and background batches',async()=>{
 for(const background of [false,true]){
  const f=await fixture();try{
   await f.seed();await f.read();const id=background?f.review.id:f.owner.id;
   const before=await f.state(),operations=f.patch('batch',true);operations[1].expectedRevision=2;
   await assert.rejects(()=>f.manage({operations},id),/revision conflict/);
   assert.deepEqual(await f.state(),before);
   assert.equal((await f.manage({operations:f.patch('batch',true)},id)).persisted,true);
  }finally{await f.close();}
 }
});

test('external revisions invalidate reads even if target bytes did not change; explicit revision fences also hold',async()=>{
 const f=await fixture();try{
  await f.seed();await f.read();
  await f.manage({action:'update',name:'batch',description:'External metadata.'},f.owner.id);
  const before=await f.state();
  await assert.rejects(()=>f.manage({operations:f.patch()}),/Read-before-write/);
  await assert.rejects(()=>f.manage({operations:f.patch('batch',true)}),/revision conflict/);
  assert.deepEqual(await f.state(),before);
  // Reading only the body again cannot make the older supporting-file receipt valid.
  await f.view();const mixed=await f.state();
  await assert.rejects(()=>f.manage({operations:f.patch()}),/Read-before-write.*references\/a.md/);
  assert.deepEqual(await f.state(),mixed);
 }finally{await f.close();}
});

test('native Library edits and exact-content receipt mismatches cannot be hidden by a batch',async()=>{
 const f=await fixture();try{
  await f.seed();await f.read();
  await f.h.commit(async tx=>{(await tx.doc(Library,f.libraryId)).skills.batch.markdown='external alpha';},ctx);
  const external=await f.state();
  await assert.rejects(()=>f.manage({operations:f.patch()}),/Read-before-write/);
  assert.deepEqual(await f.state(),external);
  await f.read();
  // A same-revision wrong digest must still fail, independently of the revision guard.
  await f.h.commit(async tx=>{(await tx.doc(SkillReads,f.review.id)).files['batch/references/a.md'].digest=createHash('sha256').update('not one').digest('hex');},ctx);
  const mismatch=await f.state();
  await assert.rejects(()=>f.manage({operations:f.patch()}),/Read-before-write.*references\/a.md/);
  assert.deepEqual(await f.state(),mismatch);
 }finally{await f.close();}
});

test('bad later exact spans roll back bodies, metadata, ledger, notices and worker changes, with no success receipt',async()=>{
 const f=await fixture();try{
  await f.seed();await f.read();
  for(const [old_string,error] of [['missing',/old_string not found/],['',/nonempty old_string/]] as const){
   const before=await f.state(),operations=f.patch();operations[1].old_string=old_string;
   await assert.rejects(()=>f.manage({operations},f.review.id,8001),error);
   assert.deepEqual(await f.state(),before);
   assert.equal((await f.h.snapshot(LearningToolReceipts,f.review.id,'8001',ctx))?.fingerprint,undefined);
  }
  // A failed task identity may retry a corrected batch, and only then becomes idempotent.
  assert.equal((await f.manage({operations:f.patch()},f.review.id,8001)).persisted,true);
 }finally{await f.close();}
});

test('cross-skill failures roll back every package, including a newly created package',async()=>{
 const f=await fixture();try{
  await f.seed();await f.seed('other');await f.read();await f.read('other');
  const before=await f.state();
  await assert.rejects(()=>f.manage({operations:[...f.patch(),{action:'create',name:'new',description:'New.',content:'staged'},...f.patch('other'),{action:'patch',name:'other',old_string:'absent',new_string:'bad'}]}),/old_string not found/);
  assert.deepEqual(await f.state(),before);
  assert.equal((await f.manage({operations:[...f.patch(),...f.patch('other')]})).persisted,true);
 }finally{await f.close();}
});

test('same-file patches use initial reads but sequential exact spans, never stale spans',async()=>{
 const f=await fixture();try{
  await f.seed();await f.read();
  await f.manage({operations:[{action:'patch',name:'batch',old_string:'alpha',new_string:'beta',expectedRevision:2},{action:'patch',name:'batch',old_string:'beta',new_string:'gamma',expectedRevision:3}]});
  assert.equal((await f.state()).library!.skills.batch.markdown,'gamma');
  await f.read();const before=await f.state();
  await assert.rejects(()=>f.manage({operations:[{action:'patch',name:'batch',old_string:'gamma',new_string:'next'},{action:'patch',name:'batch',old_string:'gamma',new_string:'stale'}]}),/old_string not found/);
  assert.deepEqual(await f.state(),before);
  await assert.rejects(()=>f.manage({operations:[{action:'patch',name:'batch',old_string:'gamma',new_string:'gamma'}]}),/would not change/);
 }finally{await f.close();}
});

test('creation and new-file batches need no fabricated reads, including edits to newly staged content',async()=>{
 const f=await fixture();try{
  await f.manage({operations:[{action:'create',name:'new',description:'New.',content:'alpha',expectedRevision:0},{action:'write_file',name:'new',file_path:'references/new.md',file_content:'one',expectedRevision:1}]});
  await f.seed(); // Existing unread body does not prevent creating a new supporting file.
  await f.manage({operations:[{action:'write_file',name:'batch',file_path:'references/new.md',file_content:'one'},{action:'patch',name:'batch',file_path:'references/new.md',old_string:'one',new_string:'two'}]});
  await f.manage({operations:[{action:'create',name:'staged',description:'Staged.',content:'alpha'},{action:'patch',name:'staged',old_string:'alpha',new_string:'beta'},{action:'write_file',name:'staged',file_path:'references/new.md',file_content:'one'},{action:'patch',name:'staged',file_path:'references/new.md',old_string:'one',new_string:'two'}]});
  const state=await f.state();assert.equal(state.library!.skills.staged.markdown,'beta');assert.equal(state.meta!.skills.staged.files['references/new.md'],'two');
  assert.equal(state.reads?.files['staged/SKILL.md'],undefined);
  await assert.rejects(()=>f.manage({operations:[{action:'patch',name:'staged',old_string:'beta',new_string:'gamma'}]}),/Read-before-write/);
 }finally{await f.close();}
});

test('remove/recreate and full-content writes use the initial exact-file receipt',async()=>{
 const f=await fixture();try{
  await f.seed();await f.read();
  await f.manage({operations:[{action:'remove_file',name:'batch',file_path:'references/a.md'},{action:'write_file',name:'batch',file_path:'references/a.md',file_content:'two'},{action:'patch',name:'batch',content:'beta'}]});
  const state=await f.state();assert.equal(state.meta!.skills.batch.files['references/a.md'],'two');assert.equal(state.library!.skills.batch.markdown,'beta');
 }finally{await f.close();}
});

test('ambiguous later patches remain rejected unless replace_all is explicit',async()=>{
 const f=await fixture();try{
  await f.seed();await f.manage({action:'write_file',name:'batch',file_path:'references/a.md',file_content:'one one'},f.owner.id);await f.read();
  const before=await f.state();await assert.rejects(()=>f.manage({operations:f.patch()}),/ambiguous/);assert.deepEqual(await f.state(),before);
  const operations=f.patch();await f.manage({operations:[operations[0],{...operations[1],replace_all:true}]});
  assert.equal((await f.state()).meta!.skills.batch.files['references/a.md'],'two two');
 }finally{await f.close();}
});

test('background package rollback checks every initial supporting-file read even after an earlier patch',async()=>{
 const f=await fixture();try{
  await f.seed();await f.manage({action:'write_file',name:'batch',file_path:'references/b.md',file_content:'extra'},f.owner.id);await f.read();
  const operations=[{action:'patch',name:'batch',file_path:'references/a.md',old_string:'one',new_string:'two'},{action:'rollback',name:'batch',revision:4,expectedRevision:4}];
  const before=await f.state();
  await assert.rejects(()=>f.manage({operations}),/Read every current supporting file/);
  assert.deepEqual(await f.state(),before);
  await f.view('batch','references/b.md');
  await f.manage({operations});
  const state=await f.state();assert.deepEqual(state.meta!.skills.batch.files,{'references/a.md':'one','references/b.md':'extra'});assert.equal(state.meta!.skills.batch.revision,5);
 }finally{await f.close();}
});

test('batch contract retains archive, foreground pin/auto-load and curator candidate boundaries',async()=>{
 const f=await fixture();try{
  const contract=f.tools.find(t=>t.name==='skill_manage')!.description;
  for(const rule of ['at transaction start','Files created in this batch need no prior read','sequential staged content','expectedRevision is also sequential'])assert.ok(contract.includes(rule),rule);
  await f.seed();await f.read();
  const before=await f.state();
  await assert.rejects(()=>f.manage({operations:[...f.patch(),{action:'archive',name:'batch',absorbed_into:'other'}]}),/sole operation/);
  await assert.rejects(()=>f.manage({operations:[...f.patch(),{action:'pin',name:'batch',pinned:true}]}),/foreground request/);
  await assert.rejects(()=>f.manage({operations:[...f.patch(),{action:'auto_load',name:'batch',auto_load:true}]}),/foreground request/);
  assert.deepEqual(await f.state(),before);
  await f.h.commit(async tx=>{Object.assign(await tx.doc(LearningWorker,f.review.id),{curator:true,candidateNames:['batch']});},ctx);
  await assert.rejects(()=>f.manage({operations:f.patch()}),/only its unpinned/);
  await f.manage({action:'pin',name:'batch',pinned:true},f.owner.id);
  await assert.rejects(()=>f.manage({operations:[{action:'archive',name:'batch'}]},f.owner.id),/Pinned skill/);
 }finally{await f.close();}
});

test('owner-chat two-file and cross-skill batches preserve ordered per-change notices, timestamps and replay',async t=>{
 let clock=Date.now();t.mock.method(Date,'now',()=>++clock);
 const f=await fixture();try{
  await f.seed();await f.seed('other');
  const before=(await f.notices()).length;
  const args={operations:[...f.patch('batch',true),{action:'update',name:'batch',content:'beta',expectedRevision:4},...f.patch('other',true)]};
  const result=await f.manage(args,f.owner.id,9101);
  const state=await f.state(),notices=(await f.notices()).slice(before);
  assert.deepEqual(result.results.map((r:any)=>r.revision),[3,4,5,3,4]);
  for(const name of ['batch','other']){assert.equal(state.library!.skills[name].markdown,'beta');assert.equal(state.meta!.skills[name].files['references/a.md'],'two');}
  assert.equal(notices.length,4,'no notice for the intervening unchanged save');
  assert.equal(new Set(notices.map(e=>(e.data as any).at)).size,4,'each operation retains its distinct timestamp');
  assert.deepEqual(notices.map(e=>(e.data as any).changes.skillChanges[0]),[
   {name:'batch',action:'patched',revision:3,file_path:'SKILL.md'},
   {name:'batch',action:'patched',revision:4,file_path:'references/a.md'},
   {name:'other',action:'patched',revision:3,file_path:'SKILL.md'},
   {name:'other',action:'patched',revision:4,file_path:'references/a.md'},
  ]);
  for(const e of notices){
   const data=e.data as any,change=data.changes.skillChanges[0],entry=state.meta!.skills[change.name].ledger.find(l=>l.revision===change.revision)!;
   assert.equal(data.at,entry.at,'retain each operation timestamp, not notification-flush time');
   assert.equal(data.status,'completed');assert.equal(data.origin,'skill-update');assert.equal(e.model,undefined);
   assert.deepEqual(data.changes.skills,[change.name]);assert.deepEqual(data.changes.memory,[]);assert.deepEqual(data.changes.proposals,[]);
   assert.equal(data.text,`💾 Skill update: Skill '${change.name}' patched${change.file_path==='SKILL.md'?'':' (references/a.md)'}`);
  }
  const receipt=await f.h.snapshot(LearningToolReceipts,f.owner.id,'9101',ctx);assert.deepEqual(receipt!.result,result);
  assert.deepEqual(await f.manage(args,f.owner.id,9101),result);
  assert.deepEqual(await f.state(),state,'replay must not reapply mutations or append any notice');
 }finally{await f.close();}
});

test('owner-chat bad last patch or revision rolls back every package, staged notice and task receipt',async()=>{
 const f=await fixture();try{
  await f.seed();await f.seed('other');
  const operations=[...f.patch(),{action:'create',name:'new',description:'New.',content:'staged'},...f.patch('other')];
  const before=await f.state();
  for(const last of [{action:'patch',name:'other',old_string:'absent',new_string:'bad'},{action:'update',name:'other',content:'bad',expectedRevision:2}]){
   await assert.rejects(()=>f.manage({operations:[...operations,last]},f.owner.id,9102),/old_string not found|revision conflict/);
   assert.deepEqual(await f.state(),before);
   assert.equal(await f.h.snapshot(LearningToolReceipts,f.owner.id,'9102',ctx),undefined);
  }
  const result=await f.manage({operations},f.owner.id,9102),saved=await f.state();
  assert.equal(result.persisted,true);assert.equal(saved.notices.length,before.notices.length+5);
  assert.deepEqual(await f.manage({operations},f.owner.id,9102),result);assert.deepEqual(await f.state(),saved);
 }finally{await f.close();}
});

test('task-owned foreground and background batch notice suppression remains unchanged',async()=>{
 const f=await fixture();try{
  await f.seed();await f.seed('background');const child=await f.child();
  const before=await f.notices();
  await f.manage({operations:f.patch()},child);
  assert.deepEqual(await f.notices(child),[]);assert.deepEqual(await f.notices(),before);
  await f.read('background');
  const args={operations:f.patch('background')};
  const result=await f.manage(args,f.review.id,9103);
  assert.deepEqual(await f.manage(args,f.review.id,9103),result);
  assert.deepEqual(await f.notices(f.review.id),[]);assert.deepEqual(await f.notices(),before);
  const state=await f.state();assert.deepEqual(state.worker!.changes!.skillChanges!.map(c=>c.revision),[3,4]);
  assert.equal((await f.h.snapshot(LearningWorker,child,ctx))?.changes,undefined,'task-owned foreground work must not become background bookkeeping');
  // Flat owner mutations still publish one immediate notice, using the same payload.
  await f.manage({action:'patch',name:'batch',old_string:'beta',new_string:'gamma'},f.owner.id);
  const notices=await f.notices();assert.equal(notices.length,before.length+1);assert.equal((notices.at(-1)!.data as any).changes.skillChanges[0].revision,5);
 }finally{await f.close();}
});
