import test from 'node:test';
import assert from 'node:assert/strict';
import {Harness,MemoryStorage,createRegistry,type ConversationId} from '@earendil-works/pi-durable';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
import {Library} from '@bob-local/core/documents';
import {createResources,LearningWorker,SkillMetadata,SkillReads,CuratedMemory,createSkillTools,createCuratedMemoryTool,mutateSkill,mutateCuratedMemory,runSkillCurator,CURATOR_DEFAULTS,renderSkillIndex,validateSkillPath} from '@bob-local/resources';

async function fixture(){
 let libraryId=0 as ConversationId;
 const models=createModels(),faux=fauxProvider({tokensPerSecond:100000});models.setProvider(faux.provider);
 const extension=createResources(()=>libraryId,undefined,undefined,undefined,undefined,undefined,()=> 'You are Bob.');
 const registry=createRegistry();registry.install(extension);
 const h=await Harness.open(new MemoryStorage(),{registry,models,settings:{extensions:[extension]}},ctx);
 const root=await h.root(ctx);libraryId=root.id;
 const chat=await h.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);
 const review=await h.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);
 await h.commit(async tx=>{Object.assign(await tx.doc(LearningWorker,review.id),{background:true,sourceId:chat.id});},ctx);
 const tools=[...createSkillTools(()=>libraryId),createCuratedMemoryTool(()=>libraryId)];let task=0;
 async function tool(name:string,args:any,id=chat.id,taskId=++task){const t=tools.find(t=>t.name===name)!;const result=await t.execute(args,{conversationId:id,taskId,commit:(fn:any,c:any)=>h.commit(fn,c),snapshot:(...a:any[])=>(h.snapshot as any)(...a)} as any,ctx);return JSON.parse((result.output[0] as any).text);}
 const change=(args:any,id=chat.id,now=100)=>h.commit(tx=>mutateSkill(tx,libraryId,id,args,now),ctx);
 const decision=(action:string,id:string,kind='bob.user')=>h.commit(tx=>tx.appendEntry(chat.id,{kind,data:{text:`/memory ${action} ${id}`},model:[{role:'user',content:`/memory ${action} ${id}`,timestamp:Date.now()}]}),ctx);
 return {h,faux,libraryId,chat,review,tools,tool,change,decision,close:()=>h.close(ctx)};
}

test('skills progressively disclose native packages; pin+auto_load is explicit; legacy Library stays intact',async()=>{
 const f=await fixture();try{
  await f.h.commit(async tx=>{const l=await tx.doc(Library,f.libraryId);l.instructions='owner default';l.templates.keep='template';l.skills.legacy={description:'Legacy discovery.',markdown:'LEGACY_BODY_NOT_AUTO',enabled:true};},ctx);
  assert.doesNotMatch(renderSkillIndex((await f.h.snapshot(Library,f.libraryId,ctx))!.skills),/LEGACY_BODY_NOT_AUTO/);
  const saved=await f.tool('skill_save',{name:'learned',description:'Use for repeat tasks.',markdown:'FULL_LEARNED_BODY',enabled:true});assert.equal(saved.persisted,true);assert.equal(saved.revision,1);
  const list=await f.tool('skills_list',{});assert.equal(list.skills.length,2);assert.doesNotMatch(JSON.stringify(list),/FULL_LEARNED_BODY|LEGACY_BODY_NOT_AUTO/);
  const view=await f.tool('skill_view',{name:'legacy'});assert.equal(view.content,'LEGACY_BODY_NOT_AUTO');assert.equal(view.revision,1);
  await f.tool('skill_manage',{action:'pin',name:'legacy',pinned:true,auto_load:true,expectedRevision:1});
  const lib=(await f.h.snapshot(Library,f.libraryId,ctx))!,meta=(await f.h.snapshot(SkillMetadata,f.libraryId,ctx))!;
  const prompt=renderSkillIndex(lib.skills,meta.skills);assert.match(prompt,/LEGACY_BODY_NOT_AUTO/);assert.doesNotMatch(prompt,/FULL_LEARNED_BODY/);
  assert.equal(lib.templates.keep,'template');assert.equal(lib.instructions,'owner default');assert.equal(meta.skills.legacy.createdBy,'legacy');assert.equal(meta.skills.legacy.managed,false);
  await assert.rejects(()=>f.tool('skill_manage',{action:'delete',name:'legacy'}),/Pinned/);
 }finally{await f.close();}
});

test('background exact-file read-before-write, stale receipts and conflicts protect existing skills',async()=>{
 const f=await fixture();try{
  await f.change({action:'create',name:'work',description:'Work.',markdown:'alpha body'});
  await assert.rejects(()=>f.change({action:'save',name:'work',description:'Work.',markdown:'bad overwrite'},f.review.id),/Read-before-write/);
  await f.tool('skill_view',{name:'work'},f.review.id);
  const saved=await f.change({action:'patch',name:'work',old_string:'alpha',new_string:'beta',expectedRevision:1},f.review.id);assert.equal(saved.persisted,true);
  await assert.rejects(()=>f.change({action:'patch',name:'work',old_string:'beta',new_string:'gamma'},f.review.id),/Read-before-write/);
  const conflict=await f.change({action:'save',name:'work',markdown:'lost',expectedRevision:1});assert.equal(conflict.conflict,true);assert.equal(conflict.persisted,false);
  assert.equal((await f.h.snapshot(Library,f.libraryId,ctx))!.skills.work.markdown,'beta body');
  await f.tool('skill_view',{name:'work'},f.review.id);
  await f.change({action:'write_file',name:'work',file_path:'references/topic.md',file_content:'original'},f.review.id);
  await f.tool('skill_view',{name:'work'},f.review.id);
  await assert.rejects(()=>f.change({action:'write_file',name:'work',file_path:'references/topic.md',file_content:'unread'},f.review.id),/Read-before-write/);
  await f.tool('skill_view',{name:'work',file_path:'references/topic.md'},f.review.id);
  await f.change({action:'write_file',name:'work',file_path:'references/topic.md',file_content:'improved'},f.review.id);
  await assert.rejects(()=>f.change({action:'save',name:'work',file_path:'references/topic.md',markdown:'bypass'},f.review.id),/Read-before-write|current revision/);
  assert.equal((await f.tool('skill_view',{name:'work',file_path:'references/topic.md'})).content,'improved');
  await f.h.commit(async tx=>{(await tx.doc(Library,f.libraryId)).skills.work.markdown='changed through existing API';},ctx);
  const before=await f.change({action:'update',name:'work',markdown:'lost external edit',expectedRevision:4});assert.equal(before.conflict,true);
  assert.equal((await f.h.snapshot(Library,f.libraryId,ctx))!.skills.work.markdown,'changed through existing API');
 }finally{await f.close();}
});

test('native supporting paths cannot escape or write backend files; literal patch and rollback preserve packages',async()=>{
 const f=await fixture();try{
  for(const path of ['../escape','references/../../etc/passwd','/tmp/file','C:\\file','references//x','references/.env','references/%x/../secret','references/x\u0000','SKILL.md/x','scripts/../../x','references/x:y'])assert.throws(()=>validateSkillPath(path));
  assert.equal(validateSkillPath('scripts/check.ts'),'scripts/check.ts');
  await f.change({action:'create',name:'files',description:'Files.',markdown:'hello $&'});
  await f.change({action:'write_file',name:'files',file_path:'scripts/check.ts',file_content:'return 1;'});
  await f.change({action:'patch',name:'files',old_string:'hello',new_string:'literal $&'});
  assert.equal((await f.tool('skill_view',{name:'files'})).content,'literal $& $&');
  const ledger=await f.tool('skill_manage',{action:'ledger',name:'files'});assert.equal(ledger.entries.length,3);assert.equal(ledger.entries.at(-1).rollbackAvailable,true);
  await f.change({action:'rollback',name:'files',revision:3,expectedRevision:3});
  assert.equal((await f.tool('skill_view',{name:'files'})).content,'hello $&');
  assert.equal((await f.tool('skill_view',{name:'files',file_path:'scripts/check.ts'})).content,'return 1;');
  await f.change({action:'delete',name:'files',expectedRevision:4});
  assert.equal((await f.tool('skills_list',{})).skills.length,0);
  assert.equal((await f.tool('skills_list',{includeArchived:true})).skills[0].archived,true);
  assert.ok((await f.h.snapshot(Library,f.libraryId,ctx))!.skills.files,'delete archives without deleting installed content');
  await f.change({action:'restore',name:'files',expectedRevision:5});
  assert.equal((await f.tool('skills_list',{})).skills.length,1);
  const rev=(await f.tool('skill_view',{name:'files'})).revision;
  await assert.rejects(()=>f.change({action:'patch',name:'files',old_string:'l',new_string:'x',expectedRevision:rev}),/ambiguous/).catch(error=>{throw error;});
 }finally{await f.close();}
});

test('automatic review can save learned skills but cannot self-pin or archive legacy/foreground skills',async()=>{
 const f=await fixture();try{
  await f.tool('skill_save',{name:'auto',description:'Automatic workflow.',markdown:'Learned procedure',enabled:true},f.review.id);
  const auto=(await f.h.snapshot(SkillMetadata,f.libraryId,ctx))!.skills.auto;assert.equal(auto.createdBy,'background');assert.equal(auto.managed,true);
  await assert.rejects(()=>f.change({action:'create',name:'evil',description:'Self pin.',markdown:'x',pinned:true},f.review.id),/self-pin/);
  await f.change({action:'create',name:'owner',description:'Owner workflow.',markdown:'owner procedure'});
  await f.tool('skill_view',{name:'owner'},f.review.id);
  await assert.rejects(()=>f.change({action:'archive',name:'owner',absorbed_into:'auto'},f.review.id),/foreground|legacy/);
  await f.tool('skill_view',{name:'auto'},f.review.id);
  await assert.rejects(()=>f.change({action:'archive',name:'auto'},f.review.id),/absorbed_into/);
  await f.change({action:'archive',name:'auto',absorbed_into:'owner'},f.review.id);
  assert.equal((await f.tool('skill_view',{name:'auto'})).archived,true);
  await f.change({action:'restore',name:'auto'});
  assert.equal((await f.h.snapshot(SkillMetadata,f.libraryId,ctx))!.skills.auto.managed,false,'foreground ownership is never silently re-adopted');
 }finally{await f.close();}
});

test('deterministic curator obeys idle/cadence, ages only background-managed skills and preserves all bodies',async()=>{
 const f=await fixture(),day=86400000;try{
  await f.change({action:'create',name:'old',description:'Old.',markdown:'old content'},f.review.id,0);
  await f.change({action:'create',name:'pinned',description:'Pinned.',markdown:'pinned content'},f.review.id,0);
  await f.change({action:'pin',name:'pinned',pinned:true},f.chat.id,0);
  await f.change({action:'create',name:'foreground',description:'Foreground.',markdown:'foreground content'},f.chat.id,0);
  await f.h.commit(async tx=>{(await tx.doc(Library,f.libraryId)).skills.legacy={description:'Legacy.',markdown:'legacy content',enabled:true};},ctx);
  const run=(now:number)=>f.h.commit(tx=>runSkillCurator(tx,f.libraryId,now),ctx);
  assert.equal((await run(14*day)).ran,false,'first call only establishes activity');
  assert.equal((await run(14*day+1000)).ran,false,'busy sessions do not age');
  const stale=await run(14*day+CURATOR_DEFAULTS.idleMs+1000);assert.deepEqual(stale.stale,['old']);assert.deepEqual(stale.archived,[]);
  assert.equal((await run(15*day)).ran,false,'weekly cadence');
  const archive=await run(31*day);assert.deepEqual(archive.archived,['old']);
  const lib=(await f.h.snapshot(Library,f.libraryId,ctx))!;assert.deepEqual(Object.keys(lib.skills).sort(),['foreground','legacy','old','pinned']);
  assert.equal((await f.tool('skills_list',{})).skills.length,3);
  const ledger=await f.tool('skill_manage',{action:'ledger',name:'old'});assert.equal(ledger.entries.at(-1).actor,'curator');
  await f.change({action:'rollback',name:'old',revision:2,expectedRevision:2});assert.equal((await f.tool('skills_list',{})).skills.length,4);
 }finally{await f.close();}
});

test('background reads do not inflate usage; explicit reviews retain background skill safeguards',async()=>{
 const f=await fixture();try{
  await f.change({action:'create',name:'used',description:'Used.',markdown:'repeat'});
  await f.tool('skill_view',{name:'used'},f.review.id);assert.equal((await f.h.snapshot(SkillMetadata,f.libraryId,ctx))!.skills.used.uses,0);
  await f.tool('skill_view',{name:'used'});assert.equal((await f.h.snapshot(SkillMetadata,f.libraryId,ctx))!.skills.used.uses,1);
  await f.h.commit(async tx=>{(await tx.doc(LearningWorker,f.review.id)).explicit=true;},ctx);
  await assert.rejects(()=>f.change({action:'create',name:'explicit',description:'Explicit.',markdown:'explicit content',pinned:true,autoLoad:true},f.review.id),/cannot self-pin/);
  await f.change({action:'create',name:'explicit',description:'Explicit.',markdown:'explicit content'},f.review.id);
  assert.equal((await f.h.snapshot(SkillMetadata,f.libraryId,ctx))!.skills.explicit.createdBy,'background');
  await assert.rejects(()=>f.change({action:'patch',name:'explicit',old_string:'content',new_string:'new content'},f.review.id),/Read-before-write/);
  await f.tool('skill_view',{name:'explicit'},f.review.id);
  await f.change({action:'patch',name:'explicit',old_string:'content',new_string:'new content'},f.review.id);
 }finally{await f.close();}
});

test('bounded USER/MEMORY stores are distinct; unattended destructive edits require owner decisions',async()=>{
 const f=await fixture();try{
  const user=await f.tool('memory',{target:'user',action:'add',content:'User prefers concise responses.'});assert.equal(user.persisted,true);
  await f.tool('memory',{target:'memory',action:'add',content:'Backend runs Linux.'});
  assert.equal((await f.tool('memory',{target:'user',action:'read'})).entries.length,1);
  await assert.rejects(()=>f.tool('memory',{target:'user',action:'add',content:'User likes tea.'},f.review.id),/not authorized/);
  await f.h.commit(async tx=>{(await tx.doc(LearningWorker,f.review.id)).reviewMemory=true;},ctx);
  const added=await f.tool('memory',{target:'user',action:'add',content:'User likes tea.'},f.review.id);assert.equal(added.persisted,true,'unattended additions need no extra read');
  const proposed=await f.tool('memory',{target:'user',action:'patch',old_text:'concise',content:'clear'},f.review.id);assert.equal(proposed.staged,true);assert.equal(proposed.persisted,false);
  assert.deepEqual((await f.tool('memory',{target:'user',action:'read'})).entries,['User prefers concise responses.','User likes tea.']);
  await assert.rejects(()=>f.tool('memory',{target:'user',action:'approve',id:proposed.pending_id},f.review.id),/Only an owner/);
  const pending=await f.tool('memory',{target:'user',action:'pending'});assert.equal(pending.proposals.length,1);
  await f.decision('approve',proposed.pending_id);
  await f.tool('memory',{target:'user',action:'approve',id:proposed.pending_id});
  const conflict=await f.tool('memory',{target:'user',action:'patch',old_text:'responses',content:'detailed responses',expectedRevision:1});assert.equal(conflict.conflict,true);
  await assert.rejects(()=>f.tool('memory',{target:'user',action:'add',content:'x'.repeat(1376)}),/budget exceeded/);
  const stores=(await f.h.snapshot(CuratedMemory,f.libraryId,ctx))!;assert.deepEqual(stores.memory.entries,['Backend runs Linux.']);assert.deepEqual(stores.user.entries,['User prefers clear responses.','User likes tea.']);
  await f.tool('memory',{target:'user',action:'patch',old_text:'User prefers clear responses.',content:'User prefers short replies.'});
  await f.tool('memory',{target:'user',action:'remove',old_text:'short replies'});assert.equal((await f.tool('memory',{target:'user',action:'read'})).entries.length,1);
 }finally{await f.close();}
});

test('actual native request renders compact index plus pinned body, retains resource tools, and supports automatic skill_save',{timeout:10000},async()=>{
 const f=await fixture();const seen:string[]=[];try{
  await f.change({action:'create',name:'on-demand',description:'On demand routing.',markdown:'ON_DEMAND_BODY_SECRET'});
  await f.change({action:'create',name:'pinned',description:'Pinned routing.',markdown:'PINNED_BODY_MARKER',pinned:true,autoLoad:true});
  f.faux.setResponses([request=>{seen.push(JSON.stringify(request.messages.filter(m=>m.role==='system')));assert.ok(f.tools.some(t=>t.name==='skill_view'));return fauxAssistantMessage([fauxToolCall('skill_save',{name:'native-learned',description:'Native learning.',markdown:'NATIVE_LEARNED_BODY',enabled:true})],{stopReason:'toolUse'});},()=>fauxAssistantMessage('Saved the workflow.')]);
  await(await f.review.submit({type:'input',content:'Review the supplied workflow evidence.'},ctx)).wait(ctx);
  assert.match(seen[0],/On demand routing/);assert.match(seen[0],/PINNED_BODY_MARKER/);assert.doesNotMatch(seen[0],/ON_DEMAND_BODY_SECRET/);
  assert.equal((await f.h.snapshot(Library,f.libraryId,ctx))!.skills['native-learned'].markdown,'NATIVE_LEARNED_BODY');
  assert.equal((await f.h.snapshot(SkillMetadata,f.libraryId,ctx))!.skills['native-learned'].createdBy,'background');
 }finally{await f.close();}
});

test('skill operation batches are atomic, supporting creation needs no prior read, and auto_load is independent of pin',async()=>{
 const f=await fixture();try{
  await f.tool('skill_manage',{operations:[{action:'create',name:'batch',description:'Batch workflow.',content:'batch core'},{action:'write_file',name:'batch',file_path:'references/one.md',file_content:'One'}]},f.review.id);
  const view=await f.tool('skill_view',{name:'batch'});assert.deepEqual(view.files,['references/one.md']);
  await f.tool('skill_manage',{action:'write_file',name:'batch',file_path:'references/two.md',file_content:'Two'},f.review.id);
  await assert.rejects(()=>f.tool('skill_manage',{operations:[{action:'create',name:'rolled-back',description:'Rollback.',content:'first staged'},{action:'write_file',name:'batch',file_path:'../outside',file_content:'forbidden'}]}),/relative supporting path/);
  assert.equal((await f.h.snapshot(Library,f.libraryId,ctx))!.skills['rolled-back'],undefined);
  await assert.rejects(()=>f.tool('skill_manage',{operations:[{action:'update',name:'batch',content:'first staged'},{action:'update',name:'batch',content:'second staged',expectedRevision:1}]}),/revision conflict/);
  assert.equal((await f.tool('skill_view',{name:'batch'})).content,'batch core');
  await f.tool('skill_manage',{action:'auto_load',name:'batch',auto_load:true});
  const lib=(await f.h.snapshot(Library,f.libraryId,ctx))!,meta=(await f.h.snapshot(SkillMetadata,f.libraryId,ctx))!;assert.equal(meta.skills.batch.pinned,false);assert.match(renderSkillIndex(lib.skills,meta.skills),/batch core/);
  const status=await f.tool('skill_manage',{action:'curator_status'});assert.equal(status.defaults.archiveMs,30*86400000);
 }finally{await f.close();}
});

test('memory batches use final budget, stage the complete batch, pin exact entries and allow owner rejection',async()=>{
 const f=await fixture();try{
  await f.h.commit(async tx=>{(await tx.doc(LearningWorker,f.review.id)).reviewMemory=true;},ctx);
  const large='a'.repeat(1300);await f.tool('memory',{target:'user',action:'add',content:large});
  const batch=[{action:'add',content:'User likes a new topic.'.repeat(10)},{action:'remove',old_text:large}];
  const staged=await f.tool('memory',{target:'user',operations:batch},f.review.id);assert.equal(staged.staged,true);
  assert.deepEqual((await f.tool('memory',{target:'user',action:'read'})).entries,[large]);
  await f.decision('approve',staged.pending_id);
  await f.tool('memory',{target:'user',action:'approve',id:staged.pending_id});
  assert.deepEqual((await f.tool('memory',{target:'user',action:'read'})).entries,[batch[0].content]);
  const proposed=await f.tool('memory',{target:'user',action:'patch',old_text:'User likes',content:'User enjoys'},f.review.id).catch(()=>undefined);
  assert.equal(proposed,undefined,'ambiguous substring within the same entry is refused before staging');
  const removal=await f.tool('memory',{target:'user',action:'remove',old_text:batch[0].content},f.review.id);
  const pending=await f.tool('memory',{target:'memory',action:'pending'});assert.equal(pending.proposals[0].operations[0].matched_entry,batch[0].content);
  await f.tool('memory',{target:'user',action:'patch',old_text:batch[0].content,content:'Changed entry still mentions User likes.'});
  await f.decision('approve',removal.pending_id);
  await assert.rejects(()=>f.tool('memory',{target:'user',action:'approve',id:removal.pending_id}),/Matched entry changed/);
  assert.equal((await f.tool('memory',{target:'user',action:'pending'})).proposals.length,1);
  await f.decision('reject',removal.pending_id);
  await f.tool('memory',{target:'user',action:'reject',id:removal.pending_id});assert.equal((await f.tool('memory',{target:'user',action:'pending'})).proposals.length,0);
  const before=await f.tool('memory',{target:'user',action:'read'});
  await assert.rejects(()=>f.tool('memory',{target:'user',operations:[{action:'add',content:'Would have been added.'},{action:'patch',old_text:'absent',content:'x'}]}),/not found/);
  assert.deepEqual(await f.tool('memory',{target:'user',action:'read'}),before,'a failed batch changes neither entries nor revision');
  await assert.rejects(()=>f.tool('memory',{target:'user',operations:[{action:'add',content:'x'.repeat(1375)}]}),/budget exceeded/);
 }finally{await f.close();}
});

test('curated memory prompt is frozen per conversation; new conversations see saved facts',{timeout:10000},async()=>{
 const f=await fixture(),seen:string[]=[];try{
  await f.tool('memory',{target:'user',action:'add',content:'INITIAL_PROFILE_FACT'});
  f.faux.setResponses(Array.from({length:3},()=>request=>{seen.push(JSON.stringify(request.messages.filter(m=>m.role==='system')));return fauxAssistantMessage('Done.');}));
  await(await f.chat.submit({type:'input',content:'First session request.'},ctx)).wait(ctx);
  await f.tool('memory',{target:'user',action:'add',content:'LATER_PROFILE_FACT'});
  await(await f.chat.submit({type:'input',content:'Same session request.'},ctx)).wait(ctx);
  const other=await f.h.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);
  await(await other.submit({type:'input',content:'New session request.'},ctx)).wait(ctx);
  assert.match(seen[0],/INITIAL_PROFILE_FACT/);assert.doesNotMatch(seen[0],/LATER_PROFILE_FACT/);
  assert.match(seen[1],/INITIAL_PROFILE_FACT/);assert.doesNotMatch(seen[1],/LATER_PROFILE_FACT/);
  assert.match(seen[2],/LATER_PROFILE_FACT/);
 }finally{await f.close();}
});

test('replay-safe skill and memory mutations return atomic task receipts instead of reapplying',async()=>{
 const f=await fixture();try{
  await f.change({action:'create',name:'receipt',description:'Receipt test.',markdown:'A'});
  const patch={action:'patch',name:'receipt',old_string:'A',new_string:'AB',expectedRevision:1};
  const first=await f.tool('skill_manage',patch,f.chat.id,900001),again=await f.tool('skill_manage',patch,f.chat.id,900001);
  assert.deepEqual(again,first);assert.equal((await f.h.snapshot(Library,f.libraryId,ctx))!.skills.receipt.markdown,'AB');
  await f.tool('memory',{action:'add',target:'user',content:'A'});
  const change={action:'patch',target:'user',old_text:'A',content:'AB'};
  assert.deepEqual(await f.tool('memory',change,f.chat.id,900002),await f.tool('memory',change,f.chat.id,900002));
  assert.deepEqual((await f.tool('memory',{action:'read',target:'user'})).entries,['AB']);
 }finally{await f.close();}
});

test('memory span whitespace is exact and batches cannot wipe nonempty stores',async()=>{
 const f=await fixture();try{
  await f.tool('memory',{action:'add',target:'user',content:'I prefer tea daily.'});
  await f.tool('memory',{action:'patch',target:'user',old_text:'tea ',content:'coffee '});
  assert.deepEqual((await f.tool('memory',{action:'read',target:'user'})).entries,['I prefer coffee daily.']);
  await assert.rejects(()=>f.tool('memory',{target:'user',operations:[{action:'remove',old_text:'coffee'}]}),/cannot wipe/);
  await f.h.commit(async tx=>{(await tx.doc(LearningWorker,f.review.id)).reviewMemory=true;},ctx);
  await assert.rejects(()=>f.tool('memory',{target:'user',operations:[{action:'remove',old_text:'coffee'}]},f.review.id),/cannot wipe/);
  await f.tool('memory',{action:'remove',target:'user',old_text:'coffee'});
  assert.deepEqual((await f.tool('memory',{action:'read',target:'user'})).entries,[]);
 }finally{await f.close();}
});

test('a peer turn cannot approve a staged memory change, even with an exact command or stale owner authorization',async()=>{
 const f=await fixture();try{
  await f.tool('memory',{action:'add',target:'user',content:'User likes tea.'});
  await f.h.commit(async tx=>{(await tx.doc(LearningWorker,f.review.id)).reviewMemory=true;},ctx);
  const proposal=await f.tool('memory',{action:'patch',target:'user',old_text:'tea',content:'coffee'},f.review.id);
  await f.decision('approve',proposal.pending_id);
  await f.decision('approve',proposal.pending_id,'bob.peer-message');
  await assert.rejects(()=>f.tool('memory',{action:'approve',target:'user',id:proposal.pending_id}),/Owner authorization/);
  assert.deepEqual((await f.tool('memory',{action:'read',target:'user'})).entries,['User likes tea.']);
  await f.decision('approve',proposal.pending_id);
  await f.tool('memory',{action:'approve',target:'user',id:proposal.pending_id});
  assert.deepEqual((await f.tool('memory',{action:'read',target:'user'})).entries,['User likes coffee.']);
 }finally{await f.close();}
});

test('curator consolidation cannot modify protected/noncandidate skills and retains exact-read requirements',async()=>{
 const f=await fixture();try{
  await f.change({action:'create',name:'protected',description:'Protected.',markdown:'A'});
  await f.change({action:'create',name:'candidate',description:'Candidate.',markdown:'A'},f.review.id);
  await f.h.commit(async tx=>{Object.assign(await tx.doc(LearningWorker,f.review.id),{curator:true,explicit:true,candidateNames:['candidate']});},ctx);
  await f.tool('skill_view',{name:'protected'},f.review.id);
  await assert.rejects(()=>f.change({action:'patch',name:'protected',old_string:'A',new_string:'B'},f.review.id),/only its unpinned/);
  await assert.rejects(()=>f.change({action:'patch',name:'candidate',old_string:'A',new_string:'B'},f.review.id),/Read-before-write/);
  await f.tool('skill_view',{name:'candidate'},f.review.id);
  await f.change({action:'patch',name:'candidate',old_string:'A',new_string:'B'},f.review.id);
  assert.equal((await f.h.snapshot(Library,f.libraryId,ctx))!.skills.candidate.markdown,'B');
 }finally{await f.close();}
});

test('substantive edits refresh aging, legacy ledgers recover activity, bookkeeping and no-ops do not',async()=>{
 const f=await fixture(),day=86400000;try{
  for(const name of ['patched','support','unchanged','legacy','noop'])await f.change({action:'create',name,description:'Aging.',markdown:'original'},f.review.id,0);
  for(const name of ['patched','legacy','noop']){
   await f.tool('skill_view',{name},f.review.id);
   await f.change({action:name==='noop'?'update':'patch',name,...(name==='noop'?{markdown:'original'}:{old_string:'original',new_string:'improved'})},f.review.id,31*day);
  }
  await f.change({action:'write_file',name:'support',file_path:'references/topic.md',file_content:'new procedure'},f.review.id,31*day);
  await assert.rejects(()=>f.change({action:'patch',name:'patched',old_string:'missing',new_string:'bad'},f.review.id,32*day),/Read-before-write/);
  await f.h.commit(async tx=>{
   const m=await tx.doc(SkillMetadata,f.libraryId);
   delete m.skills.legacy.lastPatchedAt; // pre-upgrade sidecar, retained substantive patch
   for(const name of ['patched','legacy','support'])m.skills[name].lastUsedAt=day; // must take max, not ??
   m.skills.unchanged.updatedAt=31*day; // bookkeeping is never activity
   m.lastActivityAt=30*day;
  },ctx);
  const result=await f.h.commit(tx=>runSkillCurator(tx,f.libraryId,31*day+CURATOR_DEFAULTS.idleMs),ctx);
  assert.deepEqual(result.archived.sort(),['noop','unchanged']);
  const meta=(await f.h.snapshot(SkillMetadata,f.libraryId,ctx))!;
  for(const name of ['patched','support','legacy']){assert.equal(meta.skills[name].archived,false);assert.equal(meta.skills[name].stale,false);}
  assert.equal(meta.skills.patched.lastPatchedAt,31*day);
  assert.equal(meta.skills.noop.lastPatchedAt,undefined);
 }finally{await f.close();}
});

test('latest activity uses newest use or edit and excludes lifecycle/unchanged legacy ledger entries',async()=>{
 const f=await fixture();try{
  const {latestSkillActivityAt}=await import('@bob-local/resources');
  await f.change({action:'create',name:'activity',description:'Activity.',markdown:'original'},f.review.id,0);
  await f.tool('skill_view',{name:'activity'},f.review.id);
  await f.change({action:'patch',name:'activity',old_string:'original',new_string:'improved'},f.review.id,100);
  await f.h.commit(async tx=>{
   const m=(await tx.doc(SkillMetadata,f.libraryId)).skills.activity;
   m.lastUsedAt=200;
  },ctx);
  await f.change({action:'update',name:'activity',markdown:'improved'},f.chat.id,300); // no-op content
  await f.change({action:'archive',name:'activity'},f.chat.id,400);
  const lib=(await f.h.snapshot(Library,f.libraryId,ctx))!,m=(await f.h.snapshot(SkillMetadata,f.libraryId,ctx))!.skills.activity;
  assert.equal(latestSkillActivityAt(m,lib.skills.activity),200);
  delete m.lastPatchedAt;assert.equal(latestSkillActivityAt(m,lib.skills.activity),200);
  delete m.lastUsedAt;assert.equal(latestSkillActivityAt(m,lib.skills.activity),100);
 }finally{await f.close();}
});

test('native metadata is visible and platform gating applies to discovery and auto-load, not explicit inspection',async()=>{
 const f=await fixture();try{
  const {skillIndex,SKILL_GUIDANCE}=await import('@bob-local/resources');
  const platform=process.platform==='darwin'?'macos':process.platform==='win32'?'windows':'linux';
  const other=platform==='windows'?'macos':'windows';
  await f.change({action:'create',name:'foreign',description:'Native trigger.',markdown:'---\ndescription: Body trigger.\ntags: [body-tag]\n---\nFOREIGN_AUTO_BODY',category:'native-category',tags:['native-tag'],version:'1.2',author:'Bob',platforms:[other],autoLoad:true});
  await f.change({action:'create',name:'local',description:'Local trigger.',markdown:'LOCAL_AUTO_BODY',platforms:[platform],autoLoad:true});
  await f.change({action:'create',name:'portable',description:'Portable trigger.',markdown:'PORTABLE_AUTO_BODY',platforms:[],autoLoad:true});
  const lib=(await f.h.snapshot(Library,f.libraryId,ctx))!,meta=(await f.h.snapshot(SkillMetadata,f.libraryId,ctx))!;
  const prompt=renderSkillIndex(lib.skills,meta.skills);
  assert.doesNotMatch(prompt,/foreign|FOREIGN_AUTO_BODY/);assert.match(prompt,/LOCAL_AUTO_BODY/);assert.match(prompt,/PORTABLE_AUTO_BODY/);
  assert.deepEqual((await f.tool('skills_list',{})).skills.map((s:any)=>s.name),['local','portable']);
  const inspected=(await f.tool('skills_list',{includeDisabled:true,query:'native-tag'})).skills[0];
  assert.equal(inspected.name,'foreign');assert.equal(inspected.applicable,false);assert.equal(inspected.readiness,'not_evaluated');
  for(const data of [inspected,await f.tool('skill_view',{name:'foreign'})]){
   assert.equal(data.category,'native-category');assert.equal(data.version,'1.2');assert.equal(data.author,'Bob');assert.deepEqual(data.platforms,[other]);assert.deepEqual(data.tags,['native-tag']);assert.equal(data.description,'Native trigger.');assert.equal(data.applicable,false);
  }
  await f.change({action:'patch',name:'foreign',old_string:'Body trigger.',new_string:'Changed body trigger.'});
  assert.equal((await f.tool('skill_view',{name:'foreign'})).description,'Native trigger.');
  assert.equal((await f.tool('skills_list',{query:'body-tag',includeDisabled:true})).skills.length,0);
  assert.equal(skillIndex(lib.skills,meta.skills,{platform:other}).find(s=>s.name==='foreign')?.applicable,true);
  assert.equal(skillIndex(lib.skills,meta.skills,{platform:'unsupported-os'}).some(s=>s.name==='local'),false);
  for(const text of ['partially relevant','even for familiar tasks','Extend a relevant skill before reinventing','Do not load unrelated skills','Full YAML','frontmatter synchronization are unsupported','readiness (not evaluated)'])assert.ok(SKILL_GUIDANCE.includes(text),text);
  assert.match(prompt,/even partially relevant/);assert.match(prompt,/even when you already know/);assert.match(prompt,/only when genuinely none are relevant/);assert.match(prompt,/do not load unrelated skills/);
 }finally{await f.close();}
});

test('foreground skill notices report exact committed actions/files, never no-ops/conflicts or rolled-back work',async()=>{
 const f=await fixture();try{
  const notices=async()=> (await f.chat.entries({},100,undefined,ctx)).items.filter(e=>e.kind==='bob.learning-status');
  const create={action:'create',name:'visible-result',description:'Visible result.',markdown:'Original'};
  await f.tool('skill_manage',create,f.chat.id,990);
  await f.tool('skill_manage',create,f.chat.id,990);
  assert.equal((await notices()).length,1,'operation receipt replay must not duplicate its notice');
  await f.tool('skill_manage',{action:'patch',name:'visible-result',old_string:'Original',new_string:'Improved'});
  await f.tool('skill_manage',{action:'write_file',name:'visible-result',file_path:'references/official-mobile-dashboard.md',file_content:'Reference'});
  const saved=await notices();assert.equal(saved.length,3);
  const texts=saved.map(e=>(e.data as any).text);
  assert.ok(texts.includes("💾 Skill update: Skill 'visible-result' created"));
  assert.ok(texts.includes("💾 Skill update: Skill 'visible-result' patched"));
  assert.ok(texts.includes("💾 Skill update: Skill 'visible-result' written (references/official-mobile-dashboard.md)"));
  for(const e of saved){assert.equal(e.model,undefined);assert.equal((e.data as any).status,'completed');assert.equal((e.data as any).changes.skillChanges.length,1);}
  await f.tool('skill_manage',{action:'update',name:'visible-result',markdown:'Improved'});
  const conflict=await f.tool('skill_manage',{action:'patch',name:'visible-result',old_string:'Improved',new_string:'Conflict',expectedRevision:1});assert.equal(conflict.persisted,false);
  await assert.rejects(()=>f.tool('skill_manage',{operations:[{action:'patch',name:'visible-result',old_string:'Improved',new_string:'Rolled back'},{action:'patch',name:'visible-result',old_string:'missing',new_string:'Fail'}]}),/not found/);
  assert.equal((await notices()).length,3);
  assert.equal((await f.h.snapshot(Library,f.libraryId,ctx))!.skills['visible-result'].markdown,'Improved');
  await f.tool('skill_view',{name:'visible-result'});assert.equal((await notices()).length,3,'reads are not mutations');
 }finally{await f.close();}
});

test('background skill actions accumulate exact receipts without posting to hidden review chats',async()=>{
 const f=await fixture();try{
  await f.tool('skill_save',{name:'review-detail',description:'Review detail.',markdown:'Original',enabled:true},f.review.id,991);
  await f.tool('skill_save',{name:'review-detail',description:'Review detail.',markdown:'Original',enabled:true},f.review.id,991);
  await f.tool('skill_manage',{action:'write_file',name:'review-detail',file_path:'references/topic.md',file_content:'Topic'},f.review.id);
  const changes=(await f.h.snapshot(LearningWorker,f.review.id,ctx))!.changes!;
  assert.deepEqual(changes.skills,['review-detail']);
  assert.deepEqual(changes.skillChanges?.map(({name,action,file_path})=>({name,action,file_path})),[{name:'review-detail',action:'created',file_path:undefined},{name:'review-detail',action:'written',file_path:'references/topic.md'}]);
  assert.equal((await f.review.entries({},100,undefined,ctx)).items.filter(e=>e.kind==='bob.learning-status').length,0);
  assert.equal((await f.chat.entries({},100,undefined,ctx)).items.filter(e=>e.kind==='bob.learning-status').length,0,'background emits on driver completion, not each mutation');
 }finally{await f.close();}
});

test('large saved-change summaries bound UTF-8 bytes and retain an explicit omitted-action count',async()=>{
 const {skillMutationSummary}=await import('@bob-local/resources');
 const changes=Array.from({length:100},(_,i)=>({name:'test-'+i,action:'written',revision:1,file_path:'references/'+'💾'.repeat(120)+'.md'}));
 const summary=skillMutationSummary(changes);assert.ok(Buffer.byteLength(summary)<=16000);assert.match(summary,/additional saved skill changes$/);assert.ok(summary.startsWith("Skill 'test-0' written (references/"));
});
