import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import * as schema from '@earendil-works/pi-schema';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
import {defineExtension,defineTool,configure,InboxDoc} from '@earendil-works/pi-durable';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {serve} from '../src/server.js';

test('HTTP /btw runs alongside a native main task, stays tool-free and separate, and scopes receipts to device/chat',{timeout:20000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bob-btw-http-')),state=new State(dir),models=createModels(),faux=fauxProvider({tokensPerSecond:100000});models.setProvider(faux.provider);
 const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();
 const gate=defineTool({name:'btw_test_gate',description:'Synthetic test gate',parameters:schema.obj({}),replay:'unsafe',execute:async()=>{entered.resolve();await release.promise;return{output:[{type:'text' as const,text:'MAIN_TOOL_RESULT'}]};}});
 const extension=defineExtension({name:'btw-http-gate',tools:[gate]});let sideCalls=0;
 faux.setResponses([
  fauxAssistantMessage([fauxToolCall('btw_test_gate',{})],{stopReason:'toolUse'}),
  context=>{sideCalls++;assert.ok(!context.tools?.length);assert.match(JSON.stringify(context.messages),/MAIN ORIGINAL/);assert.doesNotMatch(JSON.stringify(context.messages),/MAIN_TOOL_RESULT/);return fauxAssistantMessage('SIDE ANSWER');},
  fauxAssistantMessage('MAIN ANSWER'),
 ]);
 const runtime=await openRuntime(state,models);runtime.registry.install(extension);
 const app=await serve(state,{port:0,runtime}),device=state.pair(state.invite().token,'BTW fixture'),other=state.pair(state.invite().token,'Other fixture');
 const base=`http://127.0.0.1:${(app.server.address() as {port:number}).port}/v1/`;
 const call=async(path:string,method='GET',body?:unknown,credential=device.credential)=>{
  const response=await fetch(base+path,{method,headers:{authorization:`Bearer ${credential}`,'x-bob-backend':state.id,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,body:await response.json() as any};
 };
 try{
  const {body:created}=await call('chats','POST',{title:'BTW fixture',model:{provider:'faux',modelId:'faux-1'}}),id=created.id;
  const chat=(await runtime.harness.conversation(id,ctx))!;await chat.commit(tx=>configure(tx,chat.id,{extensions:{add:[extension]}}),ctx);
  assert.equal((await call(`chats/${id}/messages`,'POST',{requestId:randomUUID(),text:'MAIN ORIGINAL',mode:'followUp',allowSubagents:false})).status,202);await entered.promise;
  const before=(await chat.context(ctx)).entries.map(entry=>entry.id);
  const {body:thread,status}=await call(`chats/${id}/btw`,'POST',{});assert.equal(status,201);assert.ok(thread.id);assert.equal(thread.snapshot.omitsLive,true);
  const op=randomUUID(),sent=await call(`chats/${id}/btw/${thread.id}/messages`,'POST',{requestId:op,text:'SIDE QUESTION'});assert.equal(sent.status,202);
  let receipt=sent.body;
  for(let i=0;i<100&&receipt.messages.at(-1)?.status==='running';i++){await delay(10);receipt=(await call(`chats/${id}/btw/${thread.id}`)).body;}
  assert.equal(receipt.messages.at(-1).answer,'SIDE ANSWER');assert.equal(sideCalls,1);
  assert.deepEqual((await chat.context(ctx)).entries.map(entry=>entry.id),before,'side request never entered main history');
  assert.deepEqual((await runtime.harness.snapshot(InboxDoc,chat.id,ctx))?.items??[],[],'side question never queued or steered main task');
  assert.deepEqual((await call(`chats/${id}/btw/${thread.id}?revision=${receipt.revision}`)).body,{unchanged:true});
  const repeated=await call(`chats/${id}/btw/${thread.id}/messages`,'POST',{requestId:op,text:'SIDE QUESTION'});assert.equal(repeated.status,202);assert.equal(sideCalls,1);
  assert.equal((await call(`chats/${id}/btw/${thread.id}`,'GET',undefined,other.credential)).status,404);
  const {body:second}=await call('chats','POST',{title:'Other chat',model:{provider:'faux',modelId:'faux-1'}});
  assert.equal((await call(`chats/${second.id}/btw/${thread.id}`)).status,404);
  assert.equal((await call(`chats/${id}/btw/${thread.id}/messages`,'POST',{requestId:randomUUID(),text:'x'.repeat(4001)})).status,400);
  assert.equal((await call(`chats/${id}/messages`,'POST',{requestId:randomUUID(),text:'/btw do not steer',mode:'steer',allowSubagents:false})).status,400);
  assert.deepEqual((await chat.context(ctx)).entries.map(entry=>entry.id),before);
  const library=await call('library');assert.ok(library.body.commands.some((command:any)=>command.name==='btw'));
  release.resolve();await chat.waitForIdle(ctx);
  const final=JSON.stringify((await chat.context(ctx)).entries);assert.match(final,/MAIN ANSWER/);assert.doesNotMatch(final,/SIDE ANSWER|SIDE QUESTION|do not steer/);
  assert.equal((await call(`chats/${id}/btw/${thread.id}`,'DELETE')).status,200);
  assert.equal((await call(`chats/${id}/btw/${thread.id}`)).status,404);
 }finally{release.resolve();await app.close();state.close();rmSync(dir,{recursive:true,force:true});}
});

test('supervised update health counts active side replies but not cancelled uncooperative adapters',{timeout:15000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bob-btw-drain-')),state=new State(dir),models=createModels(),faux=fauxProvider({tokensPerSecond:100000});models.setProvider(faux.provider);
 const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();
 faux.setResponses([async()=>{entered.resolve();await release.promise;return fauxAssistantMessage('Late side answer');}]);
 const previous=process.env.BOB_HEALTH_TOKEN;process.env.BOB_HEALTH_TOKEN='btw-health-fixture';
 const runtime=await openRuntime(state,models,undefined,{resume:false}),app=await serve(state,{port:0,runtime});
 const device=state.pair(state.invite().token,'Drain fixture'),base=`http://127.0.0.1:${(app.server.address() as {port:number}).port}`;
 const call=async(path:string,method='GET',body?:unknown)=>{
  const response=await fetch(base+'/v1/'+path,{method,headers:{authorization:`Bearer ${device.credential}`,'x-bob-backend':state.id,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});assert.ok(response.ok);return response.json() as Promise<any>;
 };
 const health=async()=>{const response=await fetch(base+'/internal/update-health',{headers:{authorization:'Bearer btw-health-fixture'}});assert.equal(response.status,200);return response.json() as Promise<any>;};
 try{
  const {id}=await call('chats','POST',{title:'Drain fixture',model:{provider:'faux',modelId:'faux-1'}}),thread=await call(`chats/${id}/btw`,'POST',{});
  const before=await health();await call(`chats/${id}/btw/${thread.id}/messages`,'POST',{requestId:randomUUID(),text:'Side work'});await entered.promise;
  assert.equal((await health()).foreground,before.foreground+1);
  await call(`chats/${id}/btw/${thread.id}/cancel`,'POST',{});
  assert.equal((await health()).foreground,before.foreground);
  const other=state.pair(state.invite().token,'Other drain fixture');
  const response=await fetch(base+`/v1/chats/${id}/btw`,{method:'POST',headers:{authorization:`Bearer ${other.credential}`,'x-bob-backend':state.id,'content-type':'application/json'},body:'{}'});const otherThread=await response.json() as any;
  assert.deepEqual(await call(`chats/${id}/btw/discard`,'POST',{allForDevice:true}),{discarded:1});
  assert.equal((await fetch(base+`/v1/chats/${id}/btw/${otherThread.id}`,{headers:{authorization:`Bearer ${other.credential}`,'x-bob-backend':state.id}})).status,200);
 }finally{release.resolve();await app.close();state.close();rmSync(dir,{recursive:true,force:true});if(previous===undefined)delete process.env.BOB_HEALTH_TOKEN;else process.env.BOB_HEALTH_TOKEN=previous;}
});
