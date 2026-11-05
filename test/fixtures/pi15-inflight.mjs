// Copied only into disposable installed packages by the package transition test.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {State} from './state.js';
import {openRuntime,ctx} from './runtime.js';
import {Schedules} from './schedules.js';
import {defineExtension,defineTool} from '@earendil-works/pi-durable';
import {CodemodeStoreDoc} from '@earendil-works/pi-durable/codemode';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
const [mode,dir]=process.argv.slice(2),state=new State(dir),models=createModels(),faux=fauxProvider({tokensPerSecond:1000000});models.setProvider(faux.provider);state.set('cwd',dir);
const entered=Promise.withResolvers();
const gate=defineExtension({name:'pi15-recovery-fixture',tools:[defineTool({name:'pi15_recovery_gate',description:'Synthetic migration boundary',parameters:{type:'object',properties:{}},replay:'safe',execute:async(_args,_api,context)=>{
 entered.resolve();if(mode==='legacy')await new Promise((resolve,reject)=>{const stop=()=>reject(context.abortSignal?.reason??Error('closed'));if(context.abortSignal?.aborted)stop();else context.abortSignal?.addEventListener('abort',stop,{once:true});});return {output:[{type:'text',text:'gate complete'}]};
}})]});
let rt;
try{
 rt=await openRuntime(state,models,undefined,{resume:false});rt.registry.install(gate);
 if(mode==='legacy'){
  rt.harness.resume();const chat=await rt.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);
  const schedule=await rt.scheduling.mutate({action:'create',title:'Synthetic future reminder',kind:'reminder',text:'Fixture only',timezone:'UTC',firstRunAt:new Date(Date.now()+3600000).toISOString(),maxRuns:1,stopOnMatch:true},'migration-fixture-schedule',chat.id,ctx);
  await chat.configure({extensions:[rt.modules.coding,rt.modules.interactive,gate]},ctx);
  faux.setResponses([fauxAssistantMessage([fauxToolCall('codemode',{code:"await tools.bash({command:'printf x >> once.txt'}); await tools.render_visual({title:'Recovery fixture',html:'<p>Exactly once</p>'}); await tools.pi15_recovery_gate({}); store('migrated',true); text('resumed');"})],{stopReason:'toolUse'})]);
  const submission=await chat.submit({type:'input',content:'Synthetic inflight migration fixture #nomem',requestId:'pi15-inflight'},ctx);await Promise.race([entered.promise,submission.wait(ctx).then(value=>{throw Error('Fixture settled before recovery gate: '+JSON.stringify(value));})]);
  assert.equal(readFileSync(join(dir,'once.txt'),'utf8'),'x');const surface=(await rt.interactive.list(rt.harness,chat))[0];assert.ok(surface);
  const tasks=(await rt.harness.inspect(ctx)).tasks.map(t=>({id:t.record.id,kind:t.record.kind,version:t.record.version,background:t.record.background}));
  writeFileSync(join(dir,'inflight.json'),JSON.stringify({conversationId:chat.id,submissionId:submission.id,surfaceId:surface.id,schedule,tasks}),{mode:0o600});
  console.log(JSON.stringify({stage:mode,interruptedTasks:tasks,oneNativeSideEffect:true,futureSchedule:true}));
 }else{
  const before=JSON.parse(readFileSync(join(dir,'inflight.json'),'utf8'));faux.setResponses([fauxAssistantMessage('Recovered after native upgrade')]);rt.harness.resume();
  await (await rt.harness.submission(before.submissionId,ctx)).wait(ctx);const chat=await rt.harness.conversation(before.conversationId,ctx);await chat.waitForIdle(ctx);
  assert.equal(readFileSync(join(dir,'once.txt'),'utf8'),'x');assert.equal((await rt.harness.snapshot(CodemodeStoreDoc,chat.id,ctx)).values.migrated,true);
  const surfaces=await rt.interactive.list(rt.harness,chat);assert.equal(surfaces.length,1);assert.equal(surfaces[0].id,before.surfaceId);
  const schedule=(await rt.harness.snapshot(Schedules,ctx)).jobs[before.schedule.id];assert.deepEqual(schedule,(({persisted,notification,...job})=>job)(before.schedule));
  const task=await rt.harness.getTask(schedule.taskId,ctx);assert.ok(task);assert.equal(task.background,true);
  const entries=(await chat.entries({},200,undefined,ctx)).items,result=entries.flatMap(e=>e.model??[]).find(m=>m.role==='toolResult'&&m.toolName==='codemode');assert.ok(result);assert.equal(result.isError,false);
  console.log(JSON.stringify({stage:mode,nativeToolAndCodemodeRecovery:true,sideEffectCount:1,surfaceIdPreserved:true,sleepingBackgroundSchedulePreserved:true,toolResultSuccess:true}));
 }
}finally{if(rt)await rt.close();state.close();}
