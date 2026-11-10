import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
import {GenerationTask,ToolTask,InboxDoc,configure,defineExtension,defineTask,defineTool,type Conversation} from '@earendil-works/pi-durable';
import * as schema from '@earendil-works/pi-schema';
import {MemoryActivity,MemoryPreferences} from '@bob-local/memory';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {serve} from '../src/server.js';
import {ChatMeta} from '../src/documents.js';
import {RetiredChat,RETIRED_LOCAL_PROFILE,isRetired,excludeRetiredModels} from '../src/retired-chat-profile.js';
import {conversationOperation} from '../src/conversation-network.js';
import {DelegationCommands} from '../src/delegation-command.js';
import {DelegationBehaviorCommands,recoverDelegationBehaviorCommands} from '../src/delegation-behavior-command.js';
import {behaviorRevision,readDelegationBehavior} from '../src/delegation-behavior.js';
import {delegationVersion} from '../src/delegation-config.js';
import {Schedules} from '../src/schedules.js';

const oldModel={provider:'bob-rc-fixture-removed',modelId:'local-old'};
const oldRoute={provider:'local-qwen',model:'local-old',credential:{kind:'none'},endpoint:{baseUrl:'http://127.0.0.1:9/v1',api:'openai-completions',contextWindow:8192,maxTokens:1024,thinkingLevels:['off']}};
async function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'bob-retired-local-')),state=new State(dir),models=createModels();
 const normal=fauxProvider({provider:'retirement-normal',models:[{id:'ordinary'}],tokensPerSecond:1000000});
 const old=fauxProvider({provider:oldModel.provider,models:[{id:oldModel.modelId}],tokensPerSecond:1000000});
 normal.setResponses(Array.from({length:20},()=>fauxAssistantMessage('Ordinary Bob works')));old.setResponses([fauxAssistantMessage('MUST NEVER RUN')]);
 models.setProvider(normal.provider);models.setProvider(old.provider);
 state.set('model',{provider:'retirement-normal',modelId:'ordinary'});
 let rt=await openRuntime(state,models,undefined,{resume:false});let app:Awaited<ReturnType<typeof serve>>|undefined;let toolCalls=0;
 const oldExtension=defineExtension({name:'bob.restricted-local',tools:['web_search','web_fetch','read_attachment'].map(name=>defineTool({name,description:'Old implementation fixture, must not survive retirement',parameters:schema.obj({}),replay:'safe',execute:async()=>{toolCalls++;return {output:[{type:'text',text:'MUST NEVER RUN'}]};}}))});
 rt.registry.install(oldExtension);
 async function legacy(marker=true){
  const chat=await rt.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
  await chat.commit(async tx=>{
   (await tx.doc(ChatMeta,chat.id)).title='Preserved local history';
   if(marker)Object.assign(await tx.doc(RetiredChat,chat.id),{profile:RETIRED_LOCAL_PROFILE,route:oldRoute});
   await configure(tx,chat.id,{model:oldModel,extensions:[oldExtension],tools:oldExtension.tools!,modelTools:oldExtension.tools!,maxTurns:12});
   await tx.appendEntry(chat.id,{kind:'bob.user',data:{text:'Historical owner text'},model:[{role:'user',content:'Historical owner text',timestamp:1}]});
   await tx.appendEntry(chat.id,{kind:'pi.assistant',data:{},model:[fauxAssistantMessage('Historical local answer')]});
  },ctx);
  state.set('restrictedLocalRoute:v1',oldRoute);
  return chat;
 }
 async function reopen(resume=true){await rt.close();rt=await openRuntime(state,models,undefined,{resume});return rt;}
 let base='',headers:Record<string,string>={};
 async function api(){app=await serve(state,{port:0,runtime:rt});const device=state.pair(state.invite().token,'Retirement fixture');base=`http://127.0.0.1:${(app.server.address() as any).port}/v1`;headers={authorization:'Bearer '+device.credential,'x-bob-backend':state.id,'content-type':'application/json'};}
 const request=(path:string,method='GET',data?:unknown)=>fetch(base+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)});
 return {state,models,normal,old,dir,legacy,reopen,api,request,get rt(){return rt;},get toolCalls(){return toolCalls;},async close(){if(app)await app.close();else await rt.close();state.close();rmSync(dir,{recursive:true,force:true});}};
}

// Native submit/wait APIs implicitly resume scheduling. Seed the public native
// submission and inbox shapes directly so recovery fixtures are genuinely paused.
async function queuedInput(chat:Conversation,text:string){return chat.commit(async tx=>{
 const submission=await tx.createSubmission({conversationId:chat.id,type:'input',status:'queued',requestId:randomUUID()});
 (await tx.doc(InboxDoc,chat.id)).items.push({id:submission.id,mode:'followUp',content:text});return submission;
},ctx);}

async function assertRetired(chat:Conversation){
 const agent=await chat.agent(ctx);
 assert.equal(agent.model?.provider,'bob-retired-local');assert.deepEqual(agent.tools,[]);assert.deepEqual(agent.callable,[]);assert.deepEqual(agent.extensions.map(e=>e.name),['bob.restricted-local']);
}

test('retirement preserves history and files, deletes route, rejects sends/configuration/setup and leaves ordinary Bob working',{timeout:30000},async()=>{
 const f=await fixture();try{
  const original=await f.legacy(),id=original.id,before=(await original.entries({order:'ascending'},100,undefined,ctx)).items;
  const bytes=Buffer.from('Preserved uploaded text'),fileId=randomUUID(),dir=join(f.dir,'artifacts',String(id));mkdirSync(dir,{recursive:true});writeFileSync(join(dir,fileId),bytes);
  const meta={id:fileId,conversationId:id,name:'saved.txt',mime:'text/plain',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};writeFileSync(join(dir,fileId+'.json'),JSON.stringify(meta));
  await f.reopen();await f.api();const chat=(await f.rt.harness.conversation(id,ctx))!;await assertRetired(chat);
  assert.equal(f.state.get('restrictedLocalRoute:v1'),undefined);assert.deepEqual(f.state.get('model'),{provider:'retirement-normal',modelId:'ordinary'});
  assert.equal((await f.rt.harness.snapshot(RetiredChat,id,ctx))?.route,undefined);
  const after=(await chat.entries({order:'ascending'},100,undefined,ctx)).items;for(const entry of before)assert.deepEqual(after.find(e=>e.id===entry.id),entry);
  const view=await(await f.request(`/chats/${id}`)).json();assert.equal(view.view.docs['bob.profile'].retired,true);assert.equal(view.view.docs['bob.profile'].readOnly,true);assert.equal(view.view.docs['bob.profile'].configured,false);assert.deepEqual(view.view.docs['bob.profile'].tools,[]);
  assert.match(await(await f.request(`/chats/${id}/history`)).text(),/Historical local answer/);
  const download=await f.request(`/chats/${id}/artifacts/${fileId}`);assert.equal(download.status,200);assert.equal(await download.text(),bytes.toString());assert.deepEqual(readFileSync(join(dir,fileId)),bytes);
  assert.equal((await f.request(`/chats/${id}/metadata`,'PUT',{archived:true})).status,200);
  assert.equal((await f.request(`/chats/${id}`,'DELETE')).status,200,'Soft trash remains owner-controlled');
  assert.equal((await f.request(`/chats/${id}/metadata`,'PUT',{trashed:false})).status,200);
  for(const [action,method,data]of [['messages','POST',{requestId:randomUUID(),text:'Do not send',mode:'followUp'}],['configure','PUT',{model:{provider:'retirement-normal',modelId:'ordinary'}}],['modules','PUT',{ids:['coding']}],['artifacts','POST',{}],['fork','POST',{}]] as const){const response=await f.request(`/chats/${id}/${action}`,method,data);assert.equal(response.status,410,await response.text());}
  for(const method of ['GET','PUT'])assert.equal((await f.request('/restricted-local-route',method,method==='PUT'?oldRoute:undefined)).status,410);
  assert.equal((await f.request('/chats','POST',{title:'No silent conversion',profile:'restricted-local'})).status,400);
  const catalog=await(await f.request('/chat-profiles')).json();assert.deepEqual(catalog.map((p:any)=>p.id),['normal']);
  const created=await f.request('/chats','POST',{title:'Ordinary Bob'});assert.equal(created.status,201);const normalId=(await created.json()).id;
  assert.equal((await f.request(`/chats/${normalId}/messages`,'POST',{requestId:randomUUID(),text:'Hello Bob',mode:'followUp'})).status,202);
  await(await f.rt.harness.conversation(normalId,ctx))!.waitForIdle(ctx);assert.equal(f.normal.state.callCount,1);assert.equal(f.old.state.callCount,0);assert.equal(f.toolCalls,0);
  assert.equal((await f.request(`/chats/${normalId}/configure`,'PUT',{model:oldModel})).status,403);
 }finally{await f.close();}
});

test('legacy queued owner inputs and pending native model/tool recovery are aborted before they can execute',{timeout:30000},async()=>{
 const f=await fixture();try{
  const chat=await f.legacy(),id=chat.id,second=await f.legacy();
  await queuedInput(second,'Second queued obsolete turn');
  const queued=await queuedInput(chat,'Previously queued local turn');
  const assistant=await chat.commit(tx=>tx.appendEntry(id,{kind:'pi.assistant',data:{},model:[fauxAssistantMessage([fauxToolCall('web_search',{})],{stopReason:'toolUse'})]}),ctx);
  const call=(assistant.model![0] as any).content.find((part:any)=>part.type==='toolCall');
  // Create the official persisted task shape at both initial and recovered-intent phases.
  await chat.commit(tx=>tx.createTask(ToolTask,{kind:'model',assistant:assistant.id,callId:call.id},{ownership:{kind:'conversation'}}),ctx);
  const recoveringTool=defineTask({name:ToolTask.definition.name,version:ToolTask.definition.version,initial:()=>({phase:'execute',arguments:{},replay:'safe' as const}),phases:{execute:async()=>{throw Error('Fixture code must not be registered or run');}}});
  await chat.commit(tx=>tx.createTask(recoveringTool,{kind:'model',assistant:assistant.id,callId:call.id},{ownership:{kind:'conversation'}}),ctx);
  const recoveringGeneration=defineTask({name:GenerationTask.definition.name,version:GenerationTask.definition.version,initial:()=>({phase:'request',attempt:0,model:{provider:'retirement-normal',modelId:'ordinary'},thinkingLevel:'off',streamOptions:{},cutoff:assistant.id}),phases:{request:async()=>{throw Error('Fixture code must not be registered or run');}}});
  await chat.commit(tx=>tx.createTask(recoveringGeneration,{}, {ownership:{kind:'conversation'}}),ctx);
  const requestId=queued.id;assert.equal((await f.rt.harness.inspect(ctx)).scheduling,'paused');await f.reopen();const restored=(await f.rt.harness.conversation(id,ctx))!;await assertRetired(restored);await restored.waitForIdle(ctx);
  assert.equal(f.old.state.callCount,0);assert.equal(f.normal.state.callCount,0);assert.equal(f.toolCalls,0);
  const inspection=await f.rt.harness.inspect(ctx);assert.equal(inspection.tasks.some(task=>task.record.conversationId===id),false);assert.equal(inspection.submissions.some(submission=>submission.id===requestId),false);
 }finally{await f.close();}
});

test('retired forks and alias-only historical records remain inert across restart and new memory provisioning',{timeout:30000},async()=>{
 const f=await fixture();try{
  const chat=await f.legacy(),aliasOnly=await f.legacy(false),boundary=(await chat.entries({order:'ascending'},100,undefined,ctx)).items.at(-1)!;
  const fork=await chat.fork(boundary.id,{ownership:{kind:'ownerless'}},ctx);await assertRetired(fork);
  f.state.set('hindsightConfig',{enabled:true,baseUrl:'http://127.0.0.1:1',recallTimeoutMs:10,requestTimeoutMs:10,maxAttempts:1});
  await f.reopen();
  for(const id of [chat.id,fork.id,aliasOnly.id]){
   const restored=(await f.rt.harness.conversation(id,ctx))!;await assertRetired(restored);assert.equal(await isRetired(f.rt.harness,id),true);
   assert.deepEqual(await f.rt.harness.snapshot(MemoryPreferences,id,ctx),{autoRecall:false,autoRetain:false});assert.equal(await f.rt.harness.snapshot(MemoryActivity,id,ctx),undefined);
  }
  assert.equal(f.old.state.callCount,0);assert.equal(f.normal.state.callCount,0);
 }finally{await f.close();}
});

test('model fence blocks captured obsolete aliases even if a stale provider is handed to runtime',{timeout:30000},async()=>{
 const f=await fixture();try{
  const blocked=excludeRetiredModels(f.models),model=f.models.getModel(oldModel.provider,oldModel.modelId)!;
  assert.equal(blocked.getModel(oldModel.provider,oldModel.modelId),undefined);assert.equal(await blocked.getAuth(oldModel.provider),undefined);assert.equal(blocked.getProvider(oldModel.provider),undefined);
  assert.equal(blocked.getModels().some(m=>m.provider===oldModel.provider),false);assert.equal(blocked.getProviders().some(p=>p.id===oldModel.provider),false);
  assert.throws(()=>blocked.streamSimple(model,{messages:[{role:'user',content:'Do not contact local server',timestamp:1}]}),/removed/);
  assert.equal(f.old.state.callCount,0);
 }finally{await f.close();}
});

test('peer messages cannot reactivate retired history; history remains readable',{timeout:30000},async()=>{
 const f=await fixture();try{
  const chat=await f.legacy();await f.reopen();
  const ordinary=await f.rt.harness.createConversation({ownership:{kind:'ownerless'}},ctx),authority={originBackendId:f.state.id,name:'Owner peer',allConversations:true,read:[],message:[]};
  await assert.rejects(()=>conversationOperation(f.state,f.rt,authority,'message',{destinationBackendId:f.state.id,originConversationId:ordinary.id,conversationId:chat.id,text:'Activate local model',requestId:randomUUID()}),/removed; history is read-only/);
  const history=await conversationOperation(f.state,f.rt,authority,'history',{destinationBackendId:f.state.id,originConversationId:ordinary.id,conversationId:chat.id});assert.match(JSON.stringify(history),/Historical local answer/);
  await assert.rejects(()=>conversationOperation(f.state,f.rt,authority,'conversations',{destinationBackendId:f.state.id,originConversationId:chat.id}),/Retired chats cannot access/);
  assert.equal(f.old.state.callCount,0);assert.equal(f.normal.state.callCount,0);
 }finally{await f.close();}
});

test('pre-upgrade alias-only ancestry, old ordinary fork boundaries and cold post-upgrade forks fail closed',{timeout:30000},async()=>{
 const f=await fixture();try{
  const parent=await f.rt.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
  const boundary=await parent.commit(tx=>tx.appendEntry(parent.id,{kind:'fixture.old-boundary',data:{text:'Boundary before old alias'}}),ctx);
  const preUpgradeFork=await parent.fork(boundary.id,{ownership:{kind:'ownerless'}},ctx);
  // Reproduce persisted alias-only parent + earlier normal-agent child, without
  // changing native storage or relying on today's creation fence to simulate old code.
  await parent.configure({model:oldModel},ctx);
  assert.equal((await f.rt.harness.snapshot(RetiredChat,parent.id,ctx))?.profile,undefined);
  await f.reopen();
  for(const id of [parent.id,preUpgradeFork.id])await assertRetired((await f.rt.harness.conversation(id,ctx))!);
  await f.reopen();
  const cold=(await f.rt.harness.conversation(preUpgradeFork.id,ctx))!;
  const fork=await cold.fork(boundary.id,{ownership:{kind:'ownerless'}},ctx);await assertRetired(fork);
  assert.equal((await f.rt.harness.snapshot(RetiredChat,fork.id,ctx))?.profile,RETIRED_LOCAL_PROFILE);
  assert.equal(f.normal.state.callCount,0);assert.equal(f.old.state.callCount,0);
 }finally{await f.close();}
});

test('retirement marks every background ownership branch before scheduler resume, including normal-provider descendants',{timeout:30000},async()=>{
 const f=await fixture();try{
  const parent=await f.legacy();
  const owner=defineTask({name:'fixture.retired-background',version:1,initial:()=>({phase:'held'}),phases:{held:async()=>{throw Error('Must not run');}}});
  const task=await parent.commit(tx=>tx.createTask(owner,{}, {ownership:{kind:'conversation'},background:true}),ctx);
  const child=await f.rt.harness.createConversation({ownership:{kind:'task',taskId:task}},ctx);
  await child.configure({model:{provider:'retirement-normal',modelId:'ordinary'},extensions:[f.rt.registry.snapshot().extension('bob.resources')!]},ctx);
  const boundary=await child.commit(tx=>tx.appendEntry(child.id,{kind:'fixture.child-history',data:{}}),ctx);
  const recovering=defineTask({name:GenerationTask.definition.name,version:GenerationTask.definition.version,initial:()=>({phase:'request',attempt:0,model:{provider:'retirement-normal',modelId:'ordinary'},thinkingLevel:'off',streamOptions:{},cutoff:boundary.id}),phases:{request:async()=>{throw Error('Must not run fixture code');}}});
  await child.commit(tx=>tx.createTask(recovering,{}, {ownership:{kind:'conversation'}}),ctx);
  // Both task-owned work and task-owned conversations must be fenced; an
  // unrelated ordinary conversation is not part of either branch.
  const carrier=await f.rt.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
  await parent.commit(tx=>tx.createTask(recovering,{}, {ownership:{kind:'task',taskId:task}}),ctx);
  await f.reopen();
  await assertRetired((await f.rt.harness.conversation(parent.id,ctx))!);await assertRetired((await f.rt.harness.conversation(child.id,ctx))!);
  assert.equal(await isRetired(f.rt.harness,carrier.id),false,'Unrelated carrier history is not retired');
  assert.equal((await f.rt.harness.inspect(ctx)).tasks.length,0);assert.equal(f.normal.state.callCount,0);assert.equal(f.old.state.callCount,0);assert.equal(f.toolCalls,0);
 }finally{await f.close();}
});

test('obsolete pending delegation mode and behavior intents are preserved, never replayed into global settings',{timeout:30000},async()=>{
 const f=await fixture();try{
  const chat=await f.legacy(),beforeMode=delegationVersion(f.state),beforeBehavior=readDelegationBehavior(f.state),revision=behaviorRevision(f.state);
  const mode={text:'/delegation default --now',clientRequestId:randomUUID(),mode:'default' as const,now:true,expected:beforeMode};
  const behavior={text:'/delegation auto on',client:randomUUID(),enabled:true,revision};
  await chat.commit(async tx=>{(await tx.doc(DelegationCommands,chat.id)).pending['obsolete-mode']=mode;(await tx.doc(DelegationBehaviorCommands,chat.id)).pending['obsolete-behavior']=behavior;},ctx);
  await f.reopen();
  assert.deepEqual(delegationVersion(f.state),beforeMode);assert.deepEqual(readDelegationBehavior(f.state),beforeBehavior);assert.equal(behaviorRevision(f.state),revision);
  assert.deepEqual((await f.rt.harness.snapshot(DelegationCommands,chat.id,ctx))?.pending,{'obsolete-mode':mode});
  assert.deepEqual((await f.rt.harness.snapshot(DelegationBehaviorCommands,chat.id,ctx))?.pending,{'obsolete-behavior':behavior});
  let receipts=0;await recoverDelegationBehaviorCommands(f.state,f.rt.harness,chat.id,async()=>{receipts++;throw Error('Must not replay');});assert.equal(receipts,0);
  await assertRetired((await f.rt.harness.conversation(chat.id,ctx))!);assert.equal(f.normal.state.callCount,0);
 }finally{await f.close();}
});

test('due, submit and poll schedules from removed sources are cancelled; independent workers are retired without touching normal schedules',{timeout:30000},async()=>{
 const f=await fixture();try{
  const sources:Conversation[]=[],workers:Conversation[]=[],ids:string[]=[];
  for(const phase of ['due','submit','poll']){
   const source=await f.rt.harness.createConversation({ownership:{kind:'ownerless'}},ctx);sources.push(source);
   const made=await f.rt.scheduling.mutate({action:'create',title:`Obsolete ${phase}`,kind:'check',text:'Must not run',timezone:'UTC',firstRunAt:new Date(Date.now()+60000).toISOString()},`retire-schedule-${phase}`,source.id);
   const id=made.id;ids.push(id);
   const worker=await f.rt.harness.createConversation({ownership:{kind:'ownerless'}},ctx);workers.push(worker);
   await worker.configure({model:{provider:'retirement-normal',modelId:'ordinary'}},ctx);
   await queuedInput(worker,'Queued old independent check');
   const driver=defineTask({name:'bob.schedule-driver',version:1,initial:()=>({phase,...(phase==='due'?{}:{dueAt:Date.now()-1,deadline:Date.now()+60000})}),phases:{[phase]:async()=>{throw Error('Do not run fixture code');}}});
   await source.commit(async tx=>{
    const task=await tx.createTask(driver,{id},{ownership:{kind:'conversation'},background:true});
    const job=(await tx.doc(Schedules)).jobs[id];job.taskId=task;job.workerId=worker.id;job.history=[{number:1,dueAt:Date.now()-100,startedAt:Date.now()-50,outcome:'running',lateByMs:0}];job.runs=1;
    Object.assign(await tx.doc(RetiredChat,source.id),{profile:RETIRED_LOCAL_PROFILE,route:oldRoute});
   },ctx);
  }
  const normal=await f.rt.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
  const healthy=await f.rt.scheduling.mutate({action:'create',title:'Normal untouched reminder',kind:'reminder',text:'Keep me',timezone:'UTC',firstRunAt:new Date(Date.now()+60000).toISOString()},'normal-schedule',normal.id);
  assert.equal((await f.rt.harness.inspect(ctx)).scheduling,'paused');assert.equal(f.normal.state.callCount,0);
  await f.reopen();const jobs=(await f.rt.harness.snapshot(Schedules,ctx))!.jobs;
  for(const id of ids){assert.equal(jobs[id].state,'cancelled');assert.equal(jobs[id].nextRunAt,undefined);assert.equal(jobs[id].history.at(-1)?.outcome,'cancelled');}
  assert.equal(jobs[healthy.id].state,'active');assert.equal(jobs[healthy.id].revision,healthy.revision);
  for(const chat of [...sources,...workers])await assertRetired((await f.rt.harness.conversation(chat.id,ctx))!);
  assert.equal(f.normal.state.callCount,0);assert.equal(f.old.state.callCount,0);assert.equal(f.toolCalls,0);
  await assert.rejects(()=>f.rt.scheduling.mutate({action:'create',title:'No reactivation',kind:'reminder',text:'No',timezone:'UTC',firstRunAt:new Date(Date.now()+60000).toISOString()},'invalid-retired-source',sources[0].id),/removed/);
 }finally{await f.close();}
});
