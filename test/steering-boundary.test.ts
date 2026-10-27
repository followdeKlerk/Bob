import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Type} from '@earendil-works/pi-ai';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
import {defineExtension,defineTool,configure,InboxDoc,LiveDoc} from '@earendil-works/pi-durable';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {serve} from '../src/server.js';

// Deterministic provider-boundary test, NOT a claim of live model compliance.
test('HTTP steering joins the same native run after tool output; follow-up stays queued until answer',{timeout:15000},async()=>{
 const state=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-steer-boundary-')));
 const models=createModels(),faux=fauxProvider({tokensPerSecond:100000});models.setProvider(faux.provider);
 const entered=[Promise.withResolvers<void>(),Promise.withResolvers<void>()],release=[Promise.withResolvers<void>(),Promise.withResolvers<void>()];
 const gate=defineTool({name:'acceptance_gate',description:'Deterministic test gate',parameters:Type.Object({stage:Type.Number()}),replay:'unsafe',execute:async(args)=>{const i=args.stage-1;entered[i]!.resolve();await release[i]!.promise;return{output:[{type:'text' as const,text:`TOOL_RESULT_${args.stage}`} ]};}});
 const extension=defineExtension({name:'acceptance-steering-boundary',tools:[gate]});
 const seen:any[]=[];
 const reply=(value:any)=>(context:any)=>{seen.push(structuredClone(context.messages));return value;};
 faux.setResponses([
  reply(fauxAssistantMessage([fauxToolCall('acceptance_gate',{stage:1})],{stopReason:'toolUse'})),
  reply(fauxAssistantMessage([fauxToolCall('acceptance_gate',{stage:2})],{stopReason:'toolUse'})),
  reply(fauxAssistantMessage('DETERMINISTIC ROOT ANSWER')),
  reply(fauxAssistantMessage('DETERMINISTIC FOLLOW-UP ANSWER')),
 ]);
 const runtime=await openRuntime(state,models);runtime.registry.install(extension);
 const app=await serve(state,{port:0,runtime}),device=state.pair(state.invite().token,'Steering regression');
 const headers={authorization:`Bearer ${device.credential}`,'x-bob-backend':state.id,'content-type':'application/json'};
 const base=`http://127.0.0.1:${(app.server.address() as {port:number}).port}/v1/`;
 const call=async(path:string,body?:unknown)=>{const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});assert.ok(r.ok);return r.json() as Promise<any>;};
 try{
  const{id}=await call('chats',{title:'Deterministic steering boundary',model:{provider:'faux',modelId:'faux-1'}});
  const chat=(await runtime.harness.conversation(id,ctx))!;
  await chat.commit(tx=>configure(tx,chat.id,{extensions:{add:[extension]}}),ctx);
  const send=(text:string,mode:string)=>{const requestId=randomUUID();return call(`chats/${id}/messages`,{requestId,text,mode,allowSubagents:false}).then(admission=>({requestId,admission}));};
  const first=await send('ORIGINAL','followUp');await entered[0]!.promise;
  const initial=(await runtime.harness.snapshot(LiveDoc,chat.id,ctx))!.run!;
  const steer=await send('STEERED','steer'),follow=await send('FOLLOWUP','followUp');
  const queued=(await runtime.harness.snapshot(InboxDoc,chat.id,ctx))!.items;
  assert.deepEqual(queued.map(i=>({id:i.id,mode:i.mode})),[{id:steer.admission.id,mode:'steer'},{id:follow.admission.id,mode:'followUp'}]);
  release[0]!.resolve();await entered[1]!.promise;
  const during=(await runtime.harness.snapshot(LiveDoc,chat.id,ctx))!.run!;
  // taskId identifies the current generation task, not a stable logical run.
  assert.deepEqual(initial.inputs,[first.admission.id]);
  assert.ok(during.inputs.includes(first.admission.id)&&during.inputs.includes(steer.admission.id));
  assert.ok(!during.inputs.includes(follow.admission.id));
  assert.deepEqual((await runtime.harness.snapshot(InboxDoc,chat.id,ctx))!.items.map(i=>i.id),[follow.admission.id]);
  const messages=seen[1],steered=messages.findIndex((m:any)=>m.role==='user'&&m.content==='STEERED');
  assert.ok(steered>0);assert.equal(messages[steered-1].role,'toolResult');
  assert.ok(JSON.stringify(messages[steered-1].content).includes('TOOL_RESULT_1'));
  assert.equal(messages.at(-1).role,'user');assert.equal(messages.at(-1).content,'STEERED');
  assert.ok(!messages.some((m:any)=>m.role==='user'&&m.content==='FOLLOWUP'));
  release[1]!.resolve();await chat.waitForIdle(ctx);
  const outcomes=await Promise.all([first,steer,follow].map(x=>call(`chats/${id}/operations/${x.requestId}`)));
  assert.ok(outcomes.every(o=>o.admission.status==='done'));
  assert.equal(outcomes[0].admission.answer,outcomes[1].admission.answer);
  assert.notEqual(outcomes[1].admission.answer,outcomes[2].admission.answer);
  assert.equal(seen.length,4);assert.equal(seen[3].at(-1).role,'user');assert.equal(seen[3].at(-1).content,'FOLLOWUP');
 }finally{for(const r of release)r.resolve();await app.close();state.close();}
});
