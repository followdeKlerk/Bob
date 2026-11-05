// External fixture: resolve every Bob/native import from the selected installed
// package. Never copy this script into (or otherwise write to) an installation.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const [packageRoot,mode,dir]=process.argv.slice(2);
// The test enables Node's parent-aware ESM resolver; require.resolve would
// select CJS conditions and reject Pi AI's import-only package exports.
const native=specifier=>import(import.meta.resolve(specifier,pathToFileURL(join(packageRoot,'dist/cli.js')).href));
const local=file=>import(pathToFileURL(join(packageRoot,'dist',file+'.js')).href);
const {State}=await local('state'),{openRuntime,ctx}=await local('runtime');
const {Schedules}=await local('schedules');
const {defineExtension,defineTool,AgentDoc}=await native('@earendil-works/pi-durable');
const {CodemodeStoreDoc}=await native('@earendil-works/pi-durable/codemode');
const {createModels}=await native('@earendil-works/pi-ai/models');
const {fauxProvider,fauxAssistantMessage,fauxToolCall}=await native('@earendil-works/pi-ai/providers/faux');
const state=new State(dir),models=createModels();
const faux=fauxProvider({tokensPerSecond:1000000,models:[{id:'schema-package-exact-model',reasoning:true}]});
models.setProvider(faux.provider);
const entered=Promise.withResolvers();
const gate=defineExtension({name:'pi-schema-recovery-fixture',tools:[defineTool({
 name:'pi_schema_recovery_gate',description:'Synthetic package boundary',
 // Plain JSON Schema is accepted by both real native packages, without TypeBox.
 parameters:{type:'object',properties:{},additionalProperties:false},replay:'safe',
 execute:async(_args,_api,context)=>{
  entered.resolve();
  if(mode==='interrupt')await new Promise((_resolve,reject)=>{
   const stop=()=>reject(context.abortSignal?.reason??Error('closed'));
   if(context.abortSignal?.aborted)stop();else context.abortSignal?.addEventListener('abort',stop,{once:true});
  });
  return {output:[{type:'text',text:'gate complete'}]};
 }
})]});
const identity=task=>({id:task.id,kind:task.kind,version:task.version,background:task.background,input:task.input});
const metadataPath=join(dir,'schema-inflight.json');
let rt;
try{
 if(mode==='bootstrap'){
  // Synthetic *empty* native database, not a claim to exercise the 1.4 native
  // upgrade. The parent test then uses the original pinned migration API to
  // establish the historical migrated control floor, once, before any work.
  state.set('cwd',dir);
  const device=state.pair(state.invite().token,'Disposable schema proof');
  const {openNodeSqliteStorage}=await native('@earendil-works/pi-durable/storage/sqlite/node');
  const storage=await openNodeSqliteStorage(join(dir,'durable.sqlite'));await storage.close(ctx);
  console.log(JSON.stringify({backendId:state.id,credential:device.credential}));
 }else{
  rt=await openRuntime(state,models,undefined,{resume:false});rt.registry.install(gate);
  if(mode==='interrupt'){
   rt.harness.resume();
   const chat=await rt.harness.createConversation({ownership:{kind:'ownerless'},agent:{
    model:{provider:'faux',modelId:'schema-package-exact-model'},thinkingLevel:'high',
    cwd:dir,instructions:'Exact schema package settings #nomem',maxTurns:7
   }},ctx);
   const schedule=await rt.scheduling.mutate({action:'create',title:'Synthetic future reminder',kind:'reminder',text:'Fixture only',timezone:'UTC',firstRunAt:new Date(Date.now()+3600000).toISOString(),maxRuns:1,stopOnMatch:true},'schema-package-schedule',chat.id,ctx);
   await chat.configure({extensions:[rt.modules.coding,rt.modules.interactive,gate]},ctx);
   faux.setResponses([fauxAssistantMessage([fauxToolCall('codemode',{code:"await tools.bash({command:'printf x >> once.txt'}); await tools.render_visual({title:'Schema recovery fixture',html:'<p>Exactly once</p>'}); await tools.pi_schema_recovery_gate({}); store('schemaRecovered',true); text('resumed');"})],{stopReason:'toolUse'})]);
   const submission=await chat.submit({type:'input',content:'Synthetic package recovery #nomem',requestId:'schema-inflight'},ctx);
   await Promise.race([entered.promise,submission.wait(ctx).then(value=>{throw Error('Fixture settled before recovery gate: '+JSON.stringify(value));})]);
   assert.equal(readFileSync(join(dir,'once.txt'),'utf8'),'x');
   const surfaces=await rt.interactive.list(rt.harness,chat);assert.equal(surfaces.length,1);
   // Ensure the schedule is genuinely sleeping in the native scheduler, not
   // merely a document containing a future date.
   const until=Date.now()+5000;let inspection;
   do{inspection=await rt.harness.inspect(ctx);if(inspection.tasks.find(t=>t.record.id===schedule.taskId)?.state.kind==='sleeping')break;await new Promise(r=>setTimeout(r,10));}while(Date.now()<until);
   const sleeping=inspection.tasks.find(t=>t.record.id===schedule.taskId);assert.equal(sleeping?.state.kind,'sleeping');
   const tasks=inspection.tasks.map(t=>identity(t.record));
   assert.ok(tasks.some(t=>t.kind==='pi.tool'&&t.input.kind==='nested'&&t.input.call.name==='pi_schema_recovery_gate'),'missing native nested tool task');
   const entries=(await chat.entries({},200,undefined,ctx)).items;
   assert.ok(tasks.some(t=>t.kind==='pi.tool'&&t.input.kind==='model'&&entries.some(e=>e.id===t.input.assistant&&(e.model??[]).some(m=>m.role==='assistant'&&m.content.some(c=>c.type==='toolCall'&&c.id===t.input.callId&&c.name==='codemode')))),'missing native codemode tool task');
   const agent=await rt.harness.snapshot(AgentDoc,chat.id,ctx);
   const ids=entries.map(e=>e.id);
   writeFileSync(metadataPath,JSON.stringify({backendId:state.id,conversationId:chat.id,submissionId:submission.id,surfaces,schedule,tasks,agent,ids}),{mode:0o600});
   console.log(JSON.stringify({interruptedTasks:tasks,oneNativeSideEffect:true,conversationId:chat.id}));
  }else{
   const before=JSON.parse(readFileSync(metadataPath,'utf8'));
   assert.equal(state.id,before.backendId);
   const chat=await rt.harness.conversation(before.conversationId,ctx);assert.ok(chat);
   assert.deepEqual(await rt.harness.snapshot(AgentDoc,chat.id,ctx),before.agent,'native agent settings changed');
   const agent=await chat.agent(ctx);
   assert.deepEqual(agent.model,{provider:'faux',modelId:'schema-package-exact-model'});assert.equal(agent.thinkingLevel,'high');assert.equal(agent.maxTurns,7);assert.equal(agent.cwd,dir);
   if(mode==='recover'){
    for(const task of before.tasks)assert.deepEqual(identity(await rt.harness.getTask(task.id,ctx)),task,'native task identity/version changed before resume');
    faux.setResponses([fauxAssistantMessage('Recovered using the exact configured model')]);
    rt.harness.resume();await (await rt.harness.submission(before.submissionId,ctx)).wait(ctx);await chat.waitForIdle(ctx);
    assert.equal(faux.state.callCount,1,'recovery must not regenerate the original tool call');
   }else assert.equal(mode,'verify');
   assert.equal(readFileSync(join(dir,'once.txt'),'utf8'),'x');
   assert.equal((await rt.harness.snapshot(CodemodeStoreDoc,chat.id,ctx)).values.schemaRecovered,true);
   assert.deepEqual(await rt.interactive.list(rt.harness,chat),before.surfaces,'visual identity/content changed');
   const schedule=(await rt.harness.snapshot(Schedules,ctx)).jobs[before.schedule.id];
   assert.deepEqual(schedule,(({persisted,notification,...job})=>job)(before.schedule));
   const task=await rt.harness.getTask(schedule.taskId,ctx);assert.ok(task);assert.equal(task.background,true);
   const inspected=(await rt.harness.inspect(ctx)).tasks.find(t=>t.record.id===task.id);
   assert.equal(inspected?.state.kind,'sleeping');assert.equal(inspected.state.until,schedule.nextRunAt);
   const entries=(await chat.entries({},200,undefined,ctx)).items;
   for(const id of before.ids)assert.ok(entries.some(e=>e.id===id),'native entry ID lost');
   const results=entries.flatMap(e=>e.model??[]).filter(m=>m.role==='toolResult'&&m.toolName==='codemode');assert.equal(results.length,1);assert.equal(results[0].isError,false);
   assert.deepEqual(await rt.harness.snapshot(AgentDoc,chat.id,ctx),before.agent);
   console.log(JSON.stringify({nativeToolAndCodemodeRecovery:true,sideEffectCount:1,surfacePreserved:true,sleepingBackgroundSchedulePreserved:true,exactSettingsAndIds:true,conversationId:chat.id}));
  }
 }
}finally{if(rt)await rt.close();state.close();}
