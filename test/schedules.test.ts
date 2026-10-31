import {ChatMeta,Questions} from '../src/documents.js';
import {Harness,createRegistry,defineExtension} from '@earendil-works/pi-durable';
import {openNodeSqliteStorage} from '@earendil-works/pi-durable/storage/sqlite/node';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {Schedules,createSchedules,schedulesView,scheduleAlerts,nextScheduleTime} from '../src/schedules.js';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
import {serve} from '../src/server.js';
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function until<T>(read:()=>Promise<T>,done:(v:T)=>boolean){for(let i=0;i<250;i++){const value=await read();if(done(value))return value;await sleep(20);}throw Error('Timed out');}
const input=(extra:Record<string,unknown>={})=>({action:'create',title:'Test reminder',kind:'reminder',text:'Remember the appointment',timezone:'Europe/Warsaw',firstRunAt:new Date(Date.now()+100).toISOString(),...extra});
function state(){return new State(mkdtempSync(join(process.env.TMPDIR!,'bob-schedules-')));}

test('fixed interval skips missed slots and remains anchored',()=>{assert.equal(nextScheduleTime(1000,60000,181001),241000);assert.equal(nextScheduleTime(1000,60000,1000),61000);});

test('one-off survives restart, catches up once, and saves an alert without inference',{timeout:20000},async()=>{
 const s=state();let runtime=await openRuntime(s,undefined,undefined,{resume:false});const chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
 try{
  const key=randomUUID(),request=input(),created=await runtime.scheduling.mutate(request,key,chat.id);
  assert.equal(created.persisted,true);assert.equal((await runtime.scheduling.mutate(request,key,chat.id)).id,created.id);
  await assert.rejects(()=>runtime.scheduling.mutate({...request,title:'different'},key,chat.id),/identity conflict/);
  await runtime.close();await sleep(150);runtime=await openRuntime(s);
  const book=await until(()=>runtime.harness.snapshot(Schedules,ctx),v=>v?.jobs[created.id]?.state==='finished');
  assert.equal(book!.jobs[created.id].runs,1);assert.equal(book!.jobs[created.id].history[0].outcome,'reminded');
  assert.equal((await scheduleAlerts(runtime.harness,0)).alerts.length,1);
  const entries=await (await runtime.harness.conversation(chat.id,ctx))!.entries({},100,undefined,ctx);
  assert.equal(entries.items.filter(e=>e.kind==='bob.schedule-alert').length,1);
  await runtime.close();runtime=await openRuntime(s);await sleep(100);assert.equal((await scheduleAlerts(runtime.harness,0)).alerts.length,1);
 }finally{await runtime.close();s.close();}
});

test('pause/resume/update/cancel are revision-fenced and abort the old driver',{timeout:15000},async()=>{
 const s=state(),r=await openRuntime(s),chat=await r.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
 try{
  const created=await r.scheduling.mutate(input({firstRunAt:new Date(Date.now()+60000).toISOString(),intervalSeconds:60,maxRuns:5}),randomUUID(),chat.id);
  const paused=await r.scheduling.mutate({action:'pause',id:created.id,expectedRevision:1},randomUUID());assert.equal(paused.state,'paused');
  await assert.rejects(()=>r.scheduling.mutate({action:'resume',id:created.id,expectedRevision:1},randomUUID()),/changed/);
  const edited=await r.scheduling.mutate({action:'update',id:created.id,expectedRevision:paused.revision,title:'Changed',maxRuns:6},randomUUID());assert.equal(edited.state,'paused');
  const resumed=await r.scheduling.mutate({action:'resume',id:created.id,expectedRevision:edited.revision},randomUUID());assert.notEqual(resumed.taskId,created.taskId);
  const cancelled=await r.scheduling.mutate({action:'cancel',id:created.id,expectedRevision:resumed.revision},randomUUID());assert.equal(cancelled.state,'cancelled');
  assert.equal((await schedulesView(r.harness)).jobs[0].health,'inactive');
  await assert.rejects(()=>r.scheduling.mutate({action:'resume',id:created.id,expectedRevision:cancelled.revision},randomUUID()),/cannot be changed/);
  assert.equal((await scheduleAlerts(r.harness,0)).alerts.length,0);
 }finally{await r.close();s.close();}
});

for(const outcome of ['no_change','match','failed'] as const)test(`check ${outcome}: restricted callable tools, structured result, silence or alert`,{timeout:20000},async()=>{
 const s=state(),models=createModels(),faux=fauxProvider({tokensPerSecond:100000});models.setProvider(faux.provider);
 faux.setResponses([fauxAssistantMessage([fauxToolCall('schedule_result',{outcome,message:'Verified evidence'})],{stopReason:'toolUse'}),fauxAssistantMessage('Done.')]);
 const r=await openRuntime(s,models),chat=await r.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);
 try{
  const created=await r.scheduling.mutate(input({kind:'check',intervalSeconds:60,maxRuns:3,text:'Check the supplied evidence, report no change or a match.'}),randomUUID(),chat.id);
  const book=await until(()=>r.harness.snapshot(Schedules,ctx),v=>v?.jobs[created.id]?.history[0]?.finishedAt!==undefined);
  const job=book!.jobs[created.id];assert.equal(job.history[0].outcome,outcome);assert.equal(job.state,outcome==='match'?'finished':outcome==='failed'?'paused':'active');
  assert.equal((await scheduleAlerts(r.harness,0)).alerts.length,outcome==='no_change'?0:1);
  const children=await r.harness.commit(tx=>tx.scanConversations({},100),ctx);const worker=children.items.find(c=>c.owner?.taskId===created.taskId)!;assert.ok(worker);
  const agent=await (await r.harness.conversation(worker.id,ctx))!.agent(ctx);
  assert.ok(agent.callable.some(t=>t.name==='schedule_result'));
  for(const tool of agent.callable)assert.ok(['read','web_search','conversation_history','hindsight_recall','schedule_result'].includes(tool.name),tool.name);
 }finally{await r.close();s.close();}
});

test('missing structured result fails closed rather than claiming no change',{timeout:20000},async()=>{
 const s=state(),models=createModels(),faux=fauxProvider({tokensPerSecond:100000});models.setProvider(faux.provider);faux.setResponses([fauxAssistantMessage('Nothing new')]);
 const r=await openRuntime(s,models),chat=await r.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);
 try{const created=await r.scheduling.mutate(input({kind:'check',intervalSeconds:60}),randomUUID(),chat.id);const book=await until(()=>r.harness.snapshot(Schedules,ctx),v=>v?.jobs[created.id]?.state==='paused');assert.equal(book!.jobs[created.id].history[0].outcome,'failed');assert.equal((await scheduleAlerts(r.harness,0)).alerts.length,1);}finally{await r.close();s.close();}
});

test('HTTP schedules require paired authentication and explicit source; invalid timing rejected',{timeout:15000},async()=>{
 const s=state(),r=await openRuntime(s),app=await serve(s,{port:0,runtime:r}),device=s.pair(s.invite().token,'Phone'),base=`http://127.0.0.1:${(app.server.address() as any).port}/v1`,headers={'content-type':'application/json',authorization:`Bearer ${device.credential}`,'x-bob-backend':s.id};
 try{
  assert.equal((await fetch(base+'/schedules')).status,401);
  const chat=await r.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
  const body={requestId:randomUUID(),conversationId:chat.id,operation:input({firstRunAt:new Date(Date.now()+60000).toISOString()})};
  let response=await fetch(base+'/schedules',{method:'POST',headers,body:JSON.stringify(body)});assert.equal(response.status,200);const created=await response.json() as any;
  response=await fetch(base+'/schedules',{method:'POST',headers,body:JSON.stringify(body)});assert.equal((await response.json() as any).id,created.id);
  assert.equal((await (await fetch(base+'/schedules',{headers})).json() as any).jobs.length,1);
  for(const extra of [{timezone:'invalid-zone'},{firstRunAt:'2026-10-28T09:00:00'},{intervalSeconds:0}])await assert.rejects(()=>r.scheduling.mutate(input(extra),randomUUID(),chat.id));
  const child=await r.harness.createConversation({ownership:{kind:'task',taskId:created.taskId as any}},ctx);
  await assert.rejects(()=>r.scheduling.mutate(input(),randomUUID(),child.id),/owner conversation/);
 }finally{await app.close();s.close();}
});

test('pause during a running check aborts its subtree without a late result',{timeout:15000},async()=>{
 const s=state(),models=createModels(),faux=fauxProvider({tokensPerSecond:20});models.setProvider(faux.provider);faux.setResponses([fauxAssistantMessage('Still checking. '.repeat(200))]);
 const r=await openRuntime(s,models),chat=await r.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);
 try{
  const created=await r.scheduling.mutate(input({kind:'check',intervalSeconds:60}),randomUUID(),chat.id);
  const book=await until(()=>r.harness.snapshot(Schedules,ctx),v=>!!v?.jobs[created.id]?.workerId);const running=book!.jobs[created.id];
  await until(()=>r.harness.commit(tx=>tx.submissionByRequest(running.workerId! as any,`schedule:${created.taskId}:1`),ctx),v=>v?.status==='placed');
  const paused=await r.scheduling.mutate({action:'pause',id:created.id,expectedRevision:running.revision},randomUUID());assert.equal(paused.state,'paused');
  await until(()=>r.harness.commit(tx=>tx.task(created.taskId as any),ctx),v=>v?.state.status==='terminal');
  assert.equal((await scheduleAlerts(r.harness,0)).alerts.length,0);assert.equal((await r.harness.snapshot(Schedules,ctx))!.jobs[created.id].history[0].outcome,'cancelled');
 }finally{await r.close();s.close();}
});

test('startup reconciles a persisted pause even when the abort call was interrupted',{timeout:15000},async()=>{
 const s=state();let r=await openRuntime(s,undefined,undefined,{resume:false});const chat=await r.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
 try{
  const created=await r.scheduling.mutate(input({firstRunAt:new Date(Date.now()+60000).toISOString()}),randomUUID(),chat.id);
  // Simulate loss after the native pause commit and before the separate abort request.
  await r.harness.commit(async tx=>{const j=(await tx.doc(Schedules)).jobs[created.id];j.state='paused';delete j.nextRunAt;},ctx);
  await r.close();r=await openRuntime(s);
  await until(()=>r.harness.commit(tx=>tx.task(created.taskId as any),ctx),v=>v?.state.status==='terminal');
  assert.equal((await scheduleAlerts(r.harness,0)).alerts.length,0);assert.equal((await schedulesView(r.harness)).jobs[0].state,'paused');
 }finally{await r.close();s.close();}
});

for(const [outcome,stopOnMatch,maxRuns,expected] of [['no_change',true,1,'finished'],['match',false,3,'active']] as const)test(`check limits: ${outcome}, stopOnMatch ${stopOnMatch}, maxRuns ${maxRuns}`,{timeout:15000},async()=>{
 const s=state(),models=createModels(),faux=fauxProvider({tokensPerSecond:100000});models.setProvider(faux.provider);faux.setResponses([fauxAssistantMessage([fauxToolCall('schedule_result',{outcome,message:'Evidence'})],{stopReason:'toolUse'}),fauxAssistantMessage('Done')]);
 const r=await openRuntime(s,models),chat=await r.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);
 try{const created=await r.scheduling.mutate(input({kind:'check',intervalSeconds:60,stopOnMatch,maxRuns}),randomUUID(),chat.id);const book=await until(()=>r.harness.snapshot(Schedules,ctx),v=>!!v?.jobs[created.id]?.history[0]?.finishedAt);assert.equal(book!.jobs[created.id].state,expected);if(expected==='active')assert.ok(book!.jobs[created.id].nextRunAt!>Date.now());else assert.equal(book!.jobs[created.id].nextRunAt,undefined);}finally{await r.close();s.close();}
});

test('native checkpoint deadline aborts a hung check, alerts, and pauses (accelerated Harness clock)',{timeout:15000},async()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR!,'bob-schedule-clock-')),models=createModels(),faux=fauxProvider({tokensPerSecond:20});models.setProvider(faux.provider);faux.setResponses([fauxAssistantMessage('Still checking. '.repeat(500))]);
 let h!:Harness,now=Date.now();const scheduling=createSchedules(()=>h),registry=createRegistry();const resources=defineExtension({...scheduling.extension,name:'bob.resources'});registry.install(resources);
 h=await Harness.open(await openNodeSqliteStorage(join(dir,'durable.sqlite')),{models,registry,settings:{extensions:[resources]},now:()=>now,setTimer:(callback,ms)=>{const timer=setTimeout(callback,Math.min(ms,20));return()=>clearTimeout(timer);}},ctx);
 try{
  const chat=await h.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);
  const created=await scheduling.mutate(input({kind:'check',intervalSeconds:60}),randomUUID(),chat.id);now=Math.max(now+200,Date.now()+200);h.resume();
  await until(()=>h.snapshot(Schedules,ctx),v=>!!v?.jobs[created.id]?.workerId);
  // Same persisted phase/deadline, but five minutes elapse on the public Harness clock.
  now+=300001;
  const book=await until(()=>h.snapshot(Schedules,ctx),v=>v?.jobs[created.id]?.state==='paused');
  assert.equal(book!.jobs[created.id].history[0].outcome,'failed');assert.match(book!.jobs[created.id].history[0].message!,/five-minute/);assert.equal((await scheduleAlerts(h,0)).alerts.length,1);
 }finally{await h.close(ctx);}
});

test('schedule notification metadata obtains pending-question state independently of preview publication',async()=>{
 const s=state(),r=await openRuntime(s,undefined,undefined,{resume:false});
 try{
  const chat=await r.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
  await r.harness.commit(async tx=>{
   (await tx.doc(ChatMeta,chat.id)).title='Recruiter follow-ups';
   (await tx.doc(Questions,chat.id)).pending={id:'pending-question',text:'Choose an option'};
   const book=await tx.doc(Schedules);book.sequence=1;book.alerts=[{sequence:1,jobId:'fixture',conversationId:chat.id,title:'Daily check',text:'A result',at:Date.now()}];
  },ctx);
  const pending=await scheduleAlerts(r.harness,0);assert.equal(pending.alerts[0].conversationTitle,'Recruiter follow-ups');assert.equal(pending.alerts[0].questionPending,true);
  await r.harness.commit(async tx=>{delete (await tx.doc(Questions,chat.id)).pending;},ctx);
  assert.equal((await scheduleAlerts(r.harness,0)).alerts[0].questionPending,false);
  assert.equal(Object.hasOwn((await r.harness.snapshot(Schedules,ctx))!.alerts[0],'questionPending'),false,'metadata does not rewrite native schedule-alert records');
 }finally{await r.close();s.close();}
});
