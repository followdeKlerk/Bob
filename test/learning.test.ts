import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
import {type EntryRecord,type ConversationId} from '@earendil-works/pi-durable';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {LearningSettings,LearningActivity,LearningReceipts,learningTranscript} from '../src/learning.js';
import {LearningWorker} from '@bob-local/resources';
import {Library} from '../src/documents.js';
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function until<T>(read:()=>Promise<T>,done:(v:T)=>boolean){for(let n=0;n<500;n++){const value=await read();if(done(value))return value;await sleep(20);}throw Error('Timed out');}
async function setup(){const state=new State(mkdtempSync(join(tmpdir(),'bob-learning-'))),models=createModels(),faux=fauxProvider({tokensPerSecond:100000});models.setProvider(faux.provider);const runtime=await openRuntime(state,models);const chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);return {state,models,faux,runtime,chat,close:async()=>{await runtime.close();state.close();}};}
async function settings(r:Awaited<ReturnType<typeof setup>>,values:Partial<{enabled:boolean;memoryInterval:number;skillInterval:number;timeoutMs:number;maxIterations:number}>){await r.runtime.harness.commit(async tx=>Object.assign(await tx.doc(LearningSettings),values),ctx);}
async function send(r:Awaited<ReturnType<typeof setup>>,text:string){const sub=await r.chat.submit({type:'input',content:text},ctx);const status=await sub.wait(ctx);await r.runtime.learning.flush();return status;}

test('learning evidence omits private turns and reasoning; keeps proven tool calls/results',()=>{
 const e=(kind:string,text:string):EntryRecord=>({kind,model:[{role:kind==='pi.user'?'user':'assistant',content:text}]} as any);
 const text=learningTranscript([e('pi.user','Private #nomem'),e('pi.assistant','Do not learn this'),e('pi.user','Ordinary workflow'),e('pi.assistant','Worked'),{kind:'pi.assistant',model:[{role:'assistant',content:[{type:'thinking',thinking:'SECRET'},{type:'toolCall',name:'probe',arguments:{verified:true}}]}]} as any]);
 assert.doesNotMatch(text,/Private|Do not learn|SECRET/);assert.match(text,/Ordinary workflow/);assert.match(text,/verified/);
});

test('defaults are enabled, automatic review uses only Bob learning tools and cannot recurse',{timeout:20000},async()=>{
 const r=await setup();
 try{
  assert.deepEqual(await r.runtime.harness.snapshot(LearningSettings,ctx),{enabled:true,memoryInterval:10,skillInterval:10,maxIterations:16,timeoutMs:120000});
  await settings(r,{memoryInterval:1,skillInterval:0});
  const requests:any[]=[];
  r.faux.setResponses([fauxAssistantMessage('Your answer.'),req=>{requests.push(req);return fauxAssistantMessage('Nothing to save.');}]);
  const status=await send(r,'A useful conversation turn');assert.equal(status.status,'done');
  const activity=await until(()=>r.runtime.harness.snapshot(LearningActivity,r.chat.id,ctx),v=>v?.lastReview?.status==='completed');
  assert.equal(activity!.turns,0);assert.equal(activity!.activeTask,undefined);
  const page=await r.runtime.harness.commit(tx=>tx.scanConversations({},100),ctx);const child=page.items.find(c=>c.owner?.taskId===activity!.lastReview!.taskId)!;assert.ok(child);
  const agent=await (await r.runtime.harness.conversation(child.id,ctx))!.agent(ctx);
  assert.ok(agent.callable.some(t=>t.name==='memory'));assert.ok(agent.callable.some(t=>t.name==='skill_view'));
  for(const tool of agent.callable)assert.ok(['memory','skill_view','skills_list','skill_manage','skill_save','read'].includes(tool.name),tool.name);
  assert.equal((await r.runtime.harness.snapshot(LearningWorker,child.id,ctx))?.sourceId,r.chat.id);
  assert.match(JSON.stringify(requests),/A useful conversation turn/);
  assert.equal(page.items.filter(c=>c.owner?.taskId===activity!.lastReview!.taskId).length,1);
  assert.equal(await r.runtime.harness.snapshot(LearningActivity,child.id,ctx),undefined);
  await r.runtime.learning.capture(status);assert.equal((await r.runtime.harness.snapshot(LearningActivity,r.chat.id,ctx))?.turns,0,'capture is idempotent');
 }finally{await r.close();}
});

test('tool iteration threshold counts rounds not calls, and skill-only review excludes memory',{timeout:20000},async()=>{
 const r=await setup();try{
  await settings(r,{memoryInterval:0,skillInterval:1});
  r.faux.setResponses([fauxAssistantMessage([fauxToolCall('todos',{items:[]}),fauxToolCall('todos',{items:[]})],{stopReason:'toolUse'}),fauxAssistantMessage('Completed workflow.'),fauxAssistantMessage('Nothing to save.')]);
  await send(r,'Do this workflow');const a=await until(()=>r.runtime.harness.snapshot(LearningActivity,r.chat.id,ctx),v=>v?.lastReview?.status==='completed');
  const children=await r.runtime.harness.commit(tx=>tx.scanConversations({},100),ctx),child=children.items.find(c=>c.owner?.taskId===a!.lastReview!.taskId)!;
  const agent=await (await r.runtime.harness.conversation(child.id,ctx))!.agent(ctx);assert.ok(!agent.callable.some(t=>t.name==='memory'));assert.equal(a!.iterations,0);
 }finally{await r.close();}
});

test('automatic review can create a skill; future foreground work discovers and loads it',{timeout:20000},async()=>{
 const r=await setup();try{
  await settings(r,{memoryInterval:1,skillInterval:0});
  r.faux.setResponses([fauxAssistantMessage('We verified the procedure.'),fauxAssistantMessage([fauxToolCall('skill_save',{name:'verified-workflow',description:'Run the verified workflow.',markdown:'# Verified workflow\nUse the verified command.',enabled:true})],{stopReason:'toolUse'}),fauxAssistantMessage('Saved the skill.')]);
  await send(r,'Remember our verified workflow');await until(()=>r.runtime.harness.snapshot(LearningActivity,r.chat.id,ctx),v=>v?.lastReview?.status==='completed');
  const lib=await r.runtime.harness.snapshot(Library,r.runtime.library.id,ctx);
  assert.match(lib!.skills['verified-workflow'].markdown,/verified command/);
  await settings(r,{enabled:false});const requests:any[]=[];
  r.faux.setResponses([req=>{requests.push(req);return fauxAssistantMessage([fauxToolCall('skill_view',{name:'verified-workflow'})],{stopReason:'toolUse'});},req=>{requests.push(req);return fauxAssistantMessage('I can use the verified procedure.');}]);
  await send(r,'Use the verified workflow');
  assert.match(JSON.stringify(requests[0]),/verified-workflow/);assert.match(JSON.stringify(requests[1]),/Use the verified command/);
 }finally{await r.close();}
});

test('#nomem, #skip, disabled learning and peer inputs are not reviewed',{timeout:20000},async()=>{
 const r=await setup();try{
  await settings(r,{memoryInterval:1,skillInterval:1});
  r.faux.setResponses(Array.from({length:5},()=>fauxAssistantMessage('Done')));
  for(const text of ['Private #nomem','Also private #skip'])await send(r,text);
  const peer=await r.chat.submit({type:'input',content:'Peer instruction',entry:{kind:'bob.peer-message'}},ctx);await peer.wait(ctx);await r.runtime.learning.flush();
  await settings(r,{enabled:false});await send(r,'Disabled learning turn');
  assert.equal((await r.runtime.harness.snapshot(LearningActivity,r.chat.id,ctx))?.lastReview,undefined);
 }finally{await r.close();}
});

test('/learn and /refine are expanded for the model, not rewritten in history; manual works with auto disabled',{timeout:20000},async()=>{
 const r=await setup();try{
  await settings(r,{enabled:false});const requests:any[]=[];
  for(const text of ['/learn our tested workflow','/refine focus on formatting']){
   const reply=(req:any)=>{requests.push(req);return fauxAssistantMessage(JSON.stringify(req.messages).includes('<completed-work-evidence>')?'Nothing to save.':'Review queued.');};
   r.faux.setResponses([reply,reply]);await send(r,text);
   if(text.startsWith('/refine'))await until(()=>r.runtime.harness.snapshot(LearningActivity,r.chat.id,ctx),v=>v?.lastReview?.status==='completed');
  }
  assert.match(JSON.stringify(requests[0]),/our tested workflow/);assert.match(JSON.stringify(requests[0]),/skill_manage/);
  assert.match(JSON.stringify(requests[1]),/focus on formatting/);
  const entries=await r.chat.entries({},100,undefined,ctx);assert.ok(entries.items.some(e=>e.model?.some(m=>m.role==='user'&&m.content==='/learn our tested workflow')));
  const activity=await r.runtime.harness.snapshot(LearningActivity,r.chat.id,ctx);assert.equal(activity?.lastReview?.status,'completed');assert.equal(activity?.lastReview?.result,'Nothing to save.');
  assert.match(JSON.stringify(requests),/Review the conversation above and update two things/);
  const notice=(await r.chat.entries({},100,undefined,ctx)).items.find(e=>e.kind==='bob.learning-status');assert.equal((notice?.data as any)?.text,'💾 Self-improvement review: No changes saved.');
 }finally{await r.close();}
});

test('queued automatic review survives restart without duplicating work',{timeout:25000},async()=>{
 const r=await setup();let runtime=r.runtime;try{
  await settings(r,{memoryInterval:1,skillInterval:0});
  // Keep the review generation in flight while the runtime is closed; Durable preserves its task.
  let reviewStarted=false;
  r.faux.setResponses([fauxAssistantMessage('A completed task.'),async()=>{reviewStarted=true;await sleep(1000);return fauxAssistantMessage('Nothing to save.');}]);
  const status=await send(r,'Review this after restart');assert.equal(status.status,'done');
  await until(async()=>reviewStarted,v=>v);
  const before=await runtime.harness.snapshot(LearningActivity,r.chat.id,ctx);assert.ok(before?.activeTask);
  await runtime.close();r.faux.setResponses([fauxAssistantMessage('Nothing to save.')]);runtime=await openRuntime(r.state,r.models);
  const after=await until(()=>runtime.harness.snapshot(LearningActivity,r.chat.id,ctx),v=>v?.lastReview?.status==='completed');assert.equal(after!.lastReview!.taskId,before!.activeTask);
  await runtime.learning.flush();const receipt=await runtime.harness.snapshot(LearningReceipts,r.chat.id,String(status.id),ctx);assert.equal(receipt?.taskId,before!.activeTask);
 }finally{await runtime.close();r.state.close();}
});

test('later automatic review excludes input and output from disabled-learning turns',{timeout:20000},async()=>{
 const r=await setup();try{
  await settings(r,{enabled:false,memoryInterval:1});
  r.faux.setResponses([fauxAssistantMessage('DISABLED_OUTPUT_SECRET')]);await send(r,'DISABLED_INPUT_SECRET');
  await settings(r,{enabled:true});const seen:string[]=[];
  r.faux.setResponses([fauxAssistantMessage('Public answer.'),request=>{seen.push(JSON.stringify(request.messages));return fauxAssistantMessage('Nothing to save.');}]);
  await send(r,'Eligible current turn');await until(()=>r.runtime.harness.snapshot(LearningActivity,r.chat.id,ctx),v=>v?.lastReview?.status==='completed');
  assert.equal(seen.length,1);assert.doesNotMatch(seen[0],/DISABLED_INPUT_SECRET|DISABLED_OUTPUT_SECRET/);assert.match(seen[0],/Eligible current turn/);
 }finally{await r.close();}
});

test('automatic memory proposals are surfaced from receipts without claiming a saved change',{timeout:20000},async()=>{
 const r=await setup();try{
  await settings(r,{memoryInterval:1,skillInterval:0});
  const {CuratedMemory}=await import('@bob-local/resources');
  await r.runtime.harness.commit(async tx=>{const m=await tx.doc(CuratedMemory,r.runtime.library.id);m.user.entries=['User prefers tea.'];m.user.revision=1;},ctx);
  r.faux.setResponses([fauxAssistantMessage('Understood.'),fauxAssistantMessage([fauxToolCall('memory',{action:'patch',target:'user',old_text:'tea',content:'coffee'})],{stopReason:'toolUse'}),fauxAssistantMessage('Proposed the correction.')]);
  await send(r,'I prefer coffee now.');
  const a=await until(()=>r.runtime.harness.snapshot(LearningActivity,r.chat.id,ctx),v=>v?.lastReview?.status==='completed');
  assert.equal(a!.lastReview!.changes?.proposals.length,1);assert.equal(a!.lastReview!.changes?.memory.length,0);
  const entries=await r.chat.entries({},100,undefined,ctx),notice=entries.items.find(e=>e.kind==='bob.learning-status');
  assert.match(JSON.stringify(notice?.data),/awaiting your approval/);assert.match(JSON.stringify(notice?.data),/\/memory approve/);
  assert.deepEqual((await r.runtime.harness.snapshot(CuratedMemory,r.runtime.library.id,ctx))!.user.entries,['User prefers tea.']);
 }finally{await r.close();}
});

test('optional consolidation stays off by default and runs only after explicit owner tool request',{timeout:20000},async()=>{
 const r=await setup();try{
  await settings(r,{enabled:false});let curatorSeen=false;
  const follow=(request:any)=>{const curator=JSON.stringify(request.messages).includes("Bob's background skill CURATOR");if(curator)curatorSeen=true;return fauxAssistantMessage(curator?'No managed candidate clusters.':'Consolidation queued.');};
  r.faux.setResponses([fauxAssistantMessage([fauxToolCall('learning',{action:'consolidate'})],{stopReason:'toolUse'}),follow,follow]);
  await send(r,'Please consolidate the managed skill library.');
  const a=await until(()=>r.runtime.harness.snapshot(LearningActivity,r.chat.id,ctx),v=>v?.lastReview?.status==='completed');assert.ok(curatorSeen);
  const children=await r.runtime.harness.commit(tx=>tx.scanConversations({},100),ctx),child=children.items.find(c=>c.owner?.taskId===a!.lastReview!.taskId)!;
  const w=await r.runtime.harness.snapshot(LearningWorker,child.id,ctx);assert.equal(w?.curator,true);assert.equal(w?.explicit,true);
  const agent=await (await r.runtime.harness.conversation(child.id,ctx))!.agent(ctx);assert.ok(!agent.callable.some(t=>t.name==='memory'||t.name==='bash'||t.name==='codemode'));
 }finally{await r.close();}
});

test('nested code-mode skill mutations have distinct durable operation identities',{timeout:20000},async()=>{
 const r=await setup();try{
  await settings(r,{enabled:false});
  const {mutateSkill}=await import('@bob-local/resources');
  await r.runtime.library.commit(tx=>mutateSkill(tx,r.runtime.library.id,r.chat.id,{action:'create',name:'nested',description:'Nested receipt test.',markdown:'A'}),ctx);
  const code=`text(await tools.skill_manage({action:'patch',name:'nested',old_string:'A',new_string:'AB'})); text(await tools.skill_manage({action:'patch',name:'nested',old_string:'AB',new_string:'ABC'}));`;
  r.faux.setResponses([fauxAssistantMessage([fauxToolCall('codemode',{code})],{stopReason:'toolUse'}),fauxAssistantMessage('Both patches complete.')]);
  await send(r,'Apply both requested patches.');
  assert.equal((await r.runtime.harness.snapshot(Library,r.runtime.library.id,ctx))!.skills.nested.markdown,'ABC');
  const entries=await r.chat.entries({},100,undefined,ctx);assert.doesNotMatch(JSON.stringify(entries.items.filter(e=>e.kind==='pi.tool-result')),/identity conflict/);
 }finally{await r.close();}
});

for(const explicit of [true,false])test(`${explicit?'explicit':'automatic'} review follow-up cancellation policy`,{timeout:20000},async()=>{
 const r=await setup();let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let started=false;
 try{
  await settings(r,{enabled:explicit?false:true,memoryInterval:1,skillInterval:0});
  const reply=async(request:any)=>{
   if(JSON.stringify(request.messages).includes('<completed-work-evidence>')){started=true;await gate;return fauxAssistantMessage('Nothing to save.');}
   return fauxAssistantMessage('Acknowledged.');
  };
  r.faux.setResponses([reply,reply,reply]);
  await send(r,explicit?'/refine':'Completed workflow');await until(async()=>started,v=>v);
  const before=await r.runtime.harness.snapshot(LearningActivity,r.chat.id,ctx);assert.ok(before?.activeTask);
  // Prevent a replacement automatic review from obscuring the cancelled task.
  await settings(r,{memoryInterval:0});
  await send(r,'Did it work?');
  release();
  const settled=await until(()=>r.runtime.harness.snapshot(LearningActivity,r.chat.id,ctx),v=>['completed','cancelled','failed'].includes(v?.lastReview?.status??''));
  assert.equal(settled?.lastReview?.taskId,before.activeTask);
  assert.equal(settled?.lastReview?.status,explicit?'completed':'cancelled');
 }finally{release();await r.close();}
});

for(const replacement of [false,true])test(`explicit review ${replacement?'replacement keeps current status':'still obeys tree Stop'}`,{timeout:20000},async()=>{
 const r=await setup();let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let started=false;
 try{
  await settings(r,{enabled:false});
  const reply=async(request:any)=>{
   if(JSON.stringify(request.messages).includes('<completed-work-evidence>')){started=true;await gate;return fauxAssistantMessage('Nothing to save.');}
   return fauxAssistantMessage('Queued.');
  };
  r.faux.setResponses(Array.from({length:5},()=>reply));await send(r,'/refine');await until(async()=>started,v=>v);
  const before=await r.runtime.harness.snapshot(LearningActivity,r.chat.id,ctx);assert.ok(before?.activeTask);
  if(replacement){
   await send(r,'/refine focus on testing');
   const current=await r.runtime.harness.snapshot(LearningActivity,r.chat.id,ctx);assert.ok(current?.activeTask);assert.notEqual(current.activeTask,before.activeTask);
   release();
   const after=await until(()=>r.runtime.harness.snapshot(LearningActivity,r.chat.id,ctx),v=>v?.lastReview?.status==='completed');
   assert.equal(after?.lastReview?.taskId,current.activeTask);
   const old=await r.runtime.harness.getTask(before.activeTask as any,ctx);assert.equal(old?.state.status,'terminal');assert.equal(old?.abortRequested,true);
  }else{
   const stopping=r.chat.abort(ctx,{background:true});release();await stopping;
   const after=await until(()=>r.runtime.harness.snapshot(LearningActivity,r.chat.id,ctx),v=>v?.lastReview?.status==='cancelled');assert.equal(after?.activeTask,undefined);
  }
 }finally{release();await r.close();}
});

test('bounded tails require a recovered owner boundary; absent, peer and opt-out boundaries fail closed',()=>{
 const e=(kind:string,text:string):EntryRecord=>({kind,model:[{role:kind==='pi.user'||kind==='bob.peer-message'?'user':'assistant',content:text}]} as any);
 const tail=[e('pi.assistant','Retained verified result')];
 assert.equal(learningTranscript(tail),'');
 assert.match(learningTranscript(tail,60000,e('pi.user','Older owner task')),/Retained verified result/);
 for(const boundary of [e('pi.user','Private #nomem'),e('pi.user','Private #skip'),e('bob.peer-message','Peer task')])assert.equal(learningTranscript(tail,60000,boundary),'');
 const mixed=learningTranscript([...tail,e('bob.peer-message','Peer task'),e('pi.assistant','Peer result'),e('pi.user','Public task'),e('pi.assistant','Public result')],60000,e('pi.user','Older #nomem'));
 assert.doesNotMatch(mixed,/Retained|Peer|Older/);assert.match(mixed,/Public result/);
});

test('500-entry cutoff recovers the enclosing owner for automatic learning without restoring omitted evidence',{timeout:25000},async()=>{
 const r=await setup();try{
  await settings(r,{memoryInterval:1,skillInterval:0});let seen='';
  r.faux.setResponses([async()=>{
   await r.runtime.harness.commit(async tx=>{
    for(let i=0;i<520;i++)await tx.appendEntry(r.chat.id,{kind:'pi.assistant',model:[fauxAssistantMessage(i<20?'OMITTED_OLDER_EVIDENCE':`Retained procedure ${i}`)]});
   },ctx);
   return fauxAssistantMessage('VERIFIED_LONG_TASK_RESULT');
  },request=>{seen=JSON.stringify(request.messages);return fauxAssistantMessage('Nothing to save.');}]);
  await send(r,'OWNER_BOUNDARY_OUTSIDE_WINDOW');
  await until(()=>r.runtime.harness.snapshot(LearningActivity,r.chat.id,ctx),v=>v?.lastReview?.status==='completed');
  assert.match(seen,/VERIFIED_LONG_TASK_RESULT/);assert.match(seen,/Retained procedure 519/);assert.doesNotMatch(seen,/OWNER_BOUNDARY_OUTSIDE_WINDOW|OMITTED_OLDER_EVIDENCE/);
 }finally{await r.close();}
});

for(const boundary of ['Private #nomem','Private #skip','peer','disabled'])test(`long-task cutoff preserves ${boundary} exclusion in a later automatic review`,{timeout:25000},async()=>{
 const r=await setup();try{
  await settings(r,{enabled:boundary!=='disabled',memoryInterval:1,skillInterval:0});
  r.faux.setResponses([async()=>{
   await r.runtime.harness.commit(async tx=>{
    for(let i=0;i<520;i++)await tx.appendEntry(r.chat.id,{kind:'pi.assistant',model:[fauxAssistantMessage('PRIVATE_LONG_TASK_RESULT')]});
   },ctx);
   return fauxAssistantMessage('PRIVATE_FINAL_ANSWER');
  }]);
  if(boundary==='peer'){
   const sub=await r.chat.submit({type:'input',content:'PRIVATE_PEER_INPUT',entry:{kind:'bob.peer-message'}},ctx);await sub.wait(ctx);await r.runtime.learning.flush();
  }else await send(r,boundary);
  assert.equal((await r.runtime.harness.snapshot(LearningActivity,r.chat.id,ctx))?.activeTask,undefined);
  await settings(r,{enabled:true});let seen='';
  r.faux.setResponses([fauxAssistantMessage('PUBLIC_CURRENT_RESULT'),request=>{seen=JSON.stringify(request.messages);return fauxAssistantMessage('Nothing to save.');}]);
  await send(r,'Public current owner task');await until(()=>r.runtime.harness.snapshot(LearningActivity,r.chat.id,ctx),v=>v?.lastReview?.status==='completed');
  assert.match(seen,/PUBLIC_CURRENT_RESULT/);assert.doesNotMatch(seen,/PRIVATE_LONG_TASK_RESULT|PRIVATE_FINAL_ANSWER|PRIVATE_PEER_INPUT/);
  // Explicit review uses boundary recovery too, without the automatic policy filter.
  if(boundary!=='disabled'){
   let explicit='';r.faux.setResponses([fauxAssistantMessage('Queued.'),request=>{explicit=JSON.stringify(request.messages);return fauxAssistantMessage('Nothing to save.');}]);
   await send(r,'/refine');await until(()=>r.runtime.harness.snapshot(LearningActivity,r.chat.id,ctx),v=>v?.lastReview?.status==='completed');
   assert.doesNotMatch(explicit,/PRIVATE_LONG_TASK_RESULT|PRIVATE_FINAL_ANSWER|PRIVATE_PEER_INPUT/);assert.match(explicit,/PUBLIC_CURRENT_RESULT/);
  }
 }finally{await r.close();}
});

test('automatic review publishes one compact receipt-derived skill completion notice with supporting paths',{timeout:20000},async()=>{
 const r=await setup();try{
  await settings(r,{memoryInterval:1,skillInterval:0});
  r.faux.setResponses([
   fauxAssistantMessage('Verified workflow.'),
   fauxAssistantMessage([fauxToolCall('skill_save',{name:'notice-skill',description:'Notice workflow.',markdown:'Original',enabled:true})],{stopReason:'toolUse'}),
   fauxAssistantMessage([fauxToolCall('skill_manage',{action:'write_file',name:'notice-skill',file_path:'references/official-mobile-dashboard.md',file_content:'Reference'})],{stopReason:'toolUse'}),
   fauxAssistantMessage([fauxToolCall('skill_view',{name:'notice-skill'})],{stopReason:'toolUse'}),
   fauxAssistantMessage([fauxToolCall('skill_manage',{action:'patch',name:'notice-skill',old_string:'Original',new_string:'Improved'})],{stopReason:'toolUse'}),
   fauxAssistantMessage('MODEL_CLAIM_NOT_A_RECEIPT'),
  ]);
  await send(r,'Finish the workflow.');
  await until(()=>r.runtime.harness.snapshot(LearningActivity,r.chat.id,ctx),v=>v?.lastReview?.status==='completed');
  const notices=(await r.chat.entries({},100,undefined,ctx)).items.filter(e=>e.kind==='bob.learning-status');assert.equal(notices.length,1);
  assert.equal((notices[0].data as any).text,"💾 Self-improvement review: Skill 'notice-skill' created · Skill 'notice-skill' written (references/official-mobile-dashboard.md) · Skill 'notice-skill' patched");
  assert.equal(notices[0].model,undefined,'passive notice does not inject model messages or owner turns');
  assert.equal((notices[0].data as any).changes.skillChanges.length,3);
 }finally{await r.close();}
});

test('review timeout still reports saved skill changes without claiming completed review',{timeout:20000},async()=>{
 const r=await setup();try{
  await settings(r,{memoryInterval:1,skillInterval:0,timeoutMs:1200});
  r.faux.setResponses([fauxAssistantMessage('Done.'),fauxAssistantMessage([fauxToolCall('skill_save',{name:'partial-notice',description:'Partial notice.',markdown:'Saved',enabled:true})],{stopReason:'toolUse'}),async()=>{await sleep(2500);return fauxAssistantMessage('MODEL_UNFINISHED');}]);
  await send(r,'A workflow with a slow review');
  const a=await until(()=>r.runtime.harness.snapshot(LearningActivity,r.chat.id,ctx),v=>v?.lastReview?.status==='failed');
  assert.deepEqual(a?.lastReview?.changes?.skills,['partial-notice']);
  const notices=(await r.chat.entries({},100,undefined,ctx)).items.filter(e=>e.kind==='bob.learning-status');assert.equal(notices.length,1);
  assert.match((notices[0].data as any).text,/review failed/);assert.match((notices[0].data as any).text,/Saved changes: Skill 'partial-notice' created/);assert.doesNotMatch((notices[0].data as any).text,/MODEL_UNFINISHED|review completed/);
 }finally{await r.close();}
});

test('cancelled explicit review reports already-saved skill changes exactly once',{timeout:20000},async()=>{
 const r=await setup();let release!:()=>void,waiting=false,reviewRound=0;const gate=new Promise<void>(resolve=>{release=resolve;});
 try{
  await settings(r,{enabled:false});
  const reply=async(request:any)=>{
   if(!JSON.stringify(request.messages).includes('<completed-work-evidence>'))return fauxAssistantMessage('Queued.');
   if(++reviewRound===1)return fauxAssistantMessage([fauxToolCall('skill_save',{name:'cancelled-saved',description:'Saved before stop.',markdown:'Saved',enabled:true})],{stopReason:'toolUse'});
   waiting=true;await gate;return fauxAssistantMessage('Not completed.');
  };
  r.faux.setResponses([reply,reply,reply]);await send(r,'/refine');await until(async()=>waiting,v=>v);
  const activity=await r.runtime.harness.snapshot(LearningActivity,r.chat.id,ctx);assert.ok(activity?.activeTask);
  const stopping=r.chat.abort(ctx,{background:true});
  await until(()=>r.runtime.harness.getTask(activity.activeTask as any,ctx),v=>!!v?.abortRequested);
  release();await stopping;
  await until(()=>r.runtime.harness.snapshot(LearningActivity,r.chat.id,ctx),v=>v?.lastReview?.status==='cancelled');
  const notices=(await r.chat.entries({},100,undefined,ctx)).items.filter(e=>e.kind==='bob.learning-status');assert.equal(notices.length,1);
  assert.equal((notices[0].data as any).text,"⚠️ Self-improvement review cancelled. Saved changes: Skill 'cancelled-saved' created");
 }finally{release();await r.close();}
});
