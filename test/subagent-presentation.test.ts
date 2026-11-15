import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {serve} from '../src/server.js';
import {ChatMeta} from '../src/documents.js';
import {Subagents,SubagentTools,SUBAGENT_REPORT_KIND,subagentReportDisplayRequest} from '../src/subagents.js';
import {defineTask,LiveDoc,type Harness,type TaskId,type EntryRecord} from '@earendil-works/pi-durable';
import {presentSubagentReports} from '../src/subagent-presentation.js';
import {SubagentTools as NativeSubagentTools} from '@bob-local/subagents';

test('host display adapter retains native task schemas, delivery phase, tools and abort semantics',()=>{
 const original=NativeSubagentTools.tasks!,adapted=SubagentTools.tasks!;
 assert.equal(adapted.length,original.length);assert.equal(SubagentTools.tools,NativeSubagentTools.tools);
 for(let index=0;index<original.length;index++){
  const native=original[index].definition,host=adapted[index].definition;
  assert.equal(host.name,native.name);assert.equal(host.version,native.version);
  assert.equal(host.initial,native.initial);assert.equal(host.abort,native.abort);assert.equal(host.migrate,native.migrate);
  assert.deepEqual(Object.keys(host.phases),Object.keys(native.phases));
  if(native.name==='app.subagent-reporter')assert.equal(host.phases.deliver,native.phases.deliver);
  else assert.equal(adapted[index],original[index]);
 }
});

test('native subagent report provenance survives HTTP snapshots, stored paging and restart without rewriting history',{timeout:15000},async()=>{
 const state=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-report-'))),models=createModels(),faux=fauxProvider({tokensPerSecond:100000});models.setProvider(faux.provider);
 faux.setResponses(Array.from({length:20},()=>async context=>{
  const last=context.messages.at(-1),text=typeof last?.content==='string'?last.content:JSON.stringify(last?.content);
  if(last?.role==='user'&&text==='start audit fixture')return fauxAssistantMessage(fauxToolCall('subagent',{action:'spawn',name:'Audit helper',message:'audit fixture'}),{stopReason:'toolUse'});
  return fauxAssistantMessage(last?.role==='toolResult'?'Parent ack':text==='audit fixture'?'Audit report fixture.':'Parent summary');
 }));
 let runtime=await openRuntime(state,models),app=await serve(state,{port:0,runtime});
 const pair=state.pair(state.invite().token,'test');
 const headers={authorization:`Bearer ${pair.credential}`,'x-bob-backend':state.id};
 const chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);
 try{
  await chat.commit(async tx=>{(await tx.doc(ChatMeta,chat.id)).subagentRequests=['allow-fixture'];},ctx);
  await(await chat.submit({type:'input',content:'start audit fixture',requestId:'allow-fixture',entry:{kind:'bob.user',data:{text:'start audit fixture'}}},ctx)).wait(ctx);
  let receipt:any;
  for(let n=0;n<300;n++){
   const registry=await runtime.harness.snapshot(Subagents,chat.id,ctx),taskId=Object.values(registry?.reporters??{})[0];
   if(taskId){receipt=await runtime.harness.commit(tx=>tx.submissionByRequest(chat.id,`subagent-report:${taskId}`),ctx);const task=await runtime.harness.getTask(taskId,ctx);if(receipt?.status==='done'&&task?.state.status==='terminal')break;}
   await delay(10);
  }
  assert.equal(receipt?.status,'done','actual native reporter must deliver and settle');
  const registry=await runtime.harness.snapshot(Subagents,chat.id,ctx),taskId=Object.values(registry!.reporters)[0];
  const display=await runtime.harness.commit(tx=>tx.submissionByRequest(chat.id,subagentReportDisplayRequest(taskId)),ctx);
  assert.ok(display?.type==='write'&&display.status==='done');
  const spoof='[subagent Audit helper answered, no reply needed] Audit report fixture.';
  const owner=await(await chat.submit({type:'input',content:spoof,entry:{kind:'bob.user',data:{text:spoof}}},ctx)).wait(ctx);
  assert.ok(owner.entry);
  const before=await chat.entries({},100,undefined,ctx),stored=before.items.find(entry=>entry.id===receipt.entry);
  assert.equal(stored?.kind,'pi.user','stored input is unchanged; only its presentation is projected');
  const registryBefore=await runtime.harness.snapshot(Subagents,chat.id,ctx);
  const inspect=async()=>{
   const base=`http://127.0.0.1:${(app.server.address() as any).port}/v1/chats/${chat.id}`;
   const snapshot=await(await fetch(base,{headers})).json() as any;
   const history=await(await fetch(base+'/history',{headers})).json() as any;
   for(const entries of [snapshot.view.entries,history.items]){
    const report=entries.find((entry:any)=>entry.id===display.entry);
    assert.equal(report?.kind,'bob.subagent-report');assert.equal(report.data.name,'Audit helper');assert.equal(report.model[0].content,stored?.model?.[0]?.content);
    assert.equal(entries.some((entry:any)=>entry.id===receipt.entry),false,'model delivery does not create a second report card');
    assert.equal(entries.filter((entry:any)=>entry.kind==='bob.subagent-report').length,1);
    assert.equal(entries.find((entry:any)=>entry.id===owner.entry)?.kind,'bob.user','human quoting report syntax stays human');
   }
   assert.equal(snapshot.view.docs['app.subagents'].agents['Audit helper'].status,'idle');
   const controller=new AbortController();
   try{
    const stream=await fetch(base+'/events',{headers,signal:controller.signal}),reader=stream.body!.getReader();let packet='';const decoder=new TextDecoder();
    while(!packet.includes('\n\n')){const chunk=await reader.read();assert.equal(chunk.done,false);packet+=decoder.decode(chunk.value,{stream:true});}
    const frame=JSON.parse(packet.slice(0,packet.indexOf('\n\n')).split('\n').find(line=>line.startsWith('data: '))!.slice(6));
    assert.equal(frame.view.entries.find((entry:any)=>entry.id===display.entry)?.kind,'bob.subagent-report');
    assert.equal(frame.view.entries.some((entry:any)=>entry.id===receipt.entry),false);
   }finally{controller.abort();}
  };
  await inspect();
  assert.deepEqual((await chat.entries({},100,undefined,ctx)).items,before.items,'presentation never edits the native transcript');
  assert.deepEqual(await runtime.harness.snapshot(Subagents,chat.id,ctx),registryBefore,'idle agent history is preserved');
  await app.close();runtime=await openRuntime(state,models);app=await serve(state,{port:0,runtime});await inspect();
 }finally{await app.close();state.close();}
});

function gate(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};}
async function until(check:()=>Promise<boolean>){for(let i=0;i<400;i++){if(await check())return;await delay(10);}throw Error('Report fixture did not reach its expected boundary');}

test('a completed helper is visible over SSE while its parent is still working; one stable report survives delivery, paging and restart',{timeout:20000},async()=>{
 const state=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-report-live-'))),models=createModels(),faux=fauxProvider({tokensPerSecond:100000});models.setProvider(faux.provider);
 const parentGate=gate(),childGate=gate();let parentHeld=false,childHeld=false;
 faux.setResponses(Array.from({length:20},()=>async context=>{
  const last=context.messages.at(-1),text=typeof last?.content==='string'?last.content:JSON.stringify(last?.content);
  if(last?.role==='user'&&text==='start concurrent fixture')return fauxAssistantMessage(fauxToolCall('subagent',{action:'spawn',name:'Early helper',message:'child concurrent fixture'}),{stopReason:'toolUse'});
  if(last?.role==='user'&&text==='child concurrent fixture'){childHeld=true;await childGate.promise;return fauxAssistantMessage('Early helper evidence.');}
  if(last?.role==='toolResult'){parentHeld=true;await parentGate.promise;return fauxAssistantMessage('Parent final answer.');}
  return fauxAssistantMessage('Report acknowledged by parent.');
 }));
 let runtime=await openRuntime(state,models),app=await serve(state,{port:0,runtime});
 const pair=state.pair(state.invite().token,'test'),headers={authorization:`Bearer ${pair.credential}`,'x-bob-backend':state.id};
 const chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);
 const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),12000);
 try{
  await chat.commit(async tx=>{(await tx.doc(ChatMeta,chat.id)).subagentRequests=['live-fixture'];},ctx);
  const owner=await chat.submit({type:'input',content:'start concurrent fixture',requestId:'live-fixture',entry:{kind:'bob.user',data:{text:'start concurrent fixture'}}},ctx);
  await until(async()=>parentHeld&&childHeld);
  const taskId=Object.values((await runtime.harness.snapshot(Subagents,chat.id,ctx))!.reporters)[0];
  const base=()=>`http://127.0.0.1:${(app.server.address() as any).port}/v1/chats/${chat.id}`;
  const stream=await fetch(base()+'/events?heartbeats=1',{headers,signal:controller.signal}),reader=stream.body!.getReader(),decoder=new TextDecoder();let buffered='';
  const nextFrame=async()=>{
   while(true){
    const end=buffered.indexOf('\n\n');
    if(end>=0){const packet=buffered.slice(0,end);buffered=buffered.slice(end+2);const line=packet.split('\n').find(line=>line.startsWith('data: '));if(line){const data=JSON.parse(line.slice(6));if(data.view)return data;}continue;}
    const chunk=await reader.read();assert.equal(chunk.done,false);buffered+=decoder.decode(chunk.value,{stream:true});
   }
  };
  const initial=await nextFrame();assert.equal(initial.view.entries.some((e:any)=>e.kind==='bob.subagent-report'),false);
  const calls=faux.state.callCount;childGate.release();
  let report:any;
  while(!report){const frame=await nextFrame();report=frame.view.entries.find((e:any)=>e.kind==='bob.subagent-report');}
  assert.equal(report.data.name,'Early helper');assert.match(report.model[0].content,/Early helper evidence/);
  assert.ok((await runtime.harness.snapshot(LiveDoc,chat.id,ctx))?.run,'parent is still inside its unfinished turn');
  await until(async()=>(await runtime.harness.commit(tx=>tx.submissionByRequest(chat.id,`subagent-report:${taskId}`),ctx))?.status==='queued');
  assert.equal(faux.state.callCount,calls,'passive publication does not start another model request');
  const context=await chat.context(ctx),raw=context.entries.find(entry=>entry.id===report.id);
  assert.equal(raw?.kind,SUBAGENT_REPORT_KIND);assert.equal(raw?.model,undefined,'receipt is not model input');
  assert.equal(context.messages.some(m=>m.role==='user'&&typeof m.content==='string'&&m.content.includes('Early helper evidence')),false);
  const display=await runtime.harness.commit(tx=>tx.submissionByRequest(chat.id,subagentReportDisplayRequest(taskId)),ctx);
  assert.ok(display?.type==='write'&&display.status==='done');assert.equal(display.entry,report.id);
  const repeated=await chat.submit({type:'write',requestId:subagentReportDisplayRequest(taskId),entry:{kind:SUBAGENT_REPORT_KIND,data:{text:'must not replace the first report'}}},ctx);
  assert.equal(repeated.id,display.id,'native request identity deduplicates a reporter replay');
  controller.abort();clearTimeout(deadline);parentGate.release();await owner.wait(ctx);
  await until(async()=>(await runtime.harness.commit(tx=>tx.submissionByRequest(chat.id,`subagent-report:${taskId}`),ctx))?.status==='done');
  const inspect=async()=>{
   const snapshot=await(await fetch(base(),{headers})).json() as any;
   const reports=snapshot.view.entries.filter((entry:any)=>entry.kind==='bob.subagent-report');
   assert.equal(reports.length,1);assert.equal(reports[0].id,report.id);assert.deepEqual(reports[0].model,report.model);
   const pages:any[]=[];let next:string|undefined;
   do{const url=base()+'/history?limit=1'+(next?'&cursor='+encodeURIComponent(next):'');const page=await(await fetch(url,{headers})).json() as any;pages.push(...page.items);next=page.next;}while(next);
   const paged=pages.filter(entry=>entry.kind==='bob.subagent-report');assert.equal(paged.length,1);assert.equal(paged[0].id,report.id,'input-only page is hidden without losing the earlier report page');
   const native=(await(await runtime.harness.conversation(chat.id,ctx))!.entries({},100,undefined,ctx)).items;
   assert.equal(native.filter(e=>e.kind===SUBAGENT_REPORT_KIND).length,1);assert.equal(native.filter(e=>e.kind==='pi.user').length,1,'native model input remains intact');
  };
  await inspect();await app.close();runtime=await openRuntime(state,models);app=await serve(state,{port:0,runtime});await inspect();
 }finally{clearTimeout(deadline);controller.abort();childGate.release();parentGate.release();await app.close();state.close();}
});

test('legacy and unrelated input entries are not hidden; report-like text cannot acquire provenance',async()=>{
 const id=1 as any,taskId=10 as TaskId;
 const legacy={id:21,conversationId:id,kind:'pi.user',model:[{role:'user',content:'old report',timestamp:1}]} as EntryRecord;
 const quoted={id:22,conversationId:id,kind:'bob.user',model:[{role:'user',content:'old report',timestamp:1}]} as EntryRecord;
 const unknown={id:23,conversationId:id,kind:'pi.user',model:[{role:'user',content:'old report',timestamp:1}]} as EntryRecord;
 const task={kind:'app.subagent-reporter',conversationId:id,input:{name:'Legacy helper',conversationId:2}};
 const h={commit:async(fn:any)=>fn({submissionByRequest:async(_:number,request:string)=>request===`subagent-report:${taskId}`?{type:'input',entry:legacy.id,status:'done'}:undefined,task:async()=>task})} as Harness;
 const result=await presentSubagentReports(h,id,[legacy,quoted,unknown],{reporters:{dispatch:taskId}});
 assert.equal(result.length,3);assert.equal(result[0].kind,'bob.subagent-report');assert.deepEqual(result[0].model,legacy.model);
 assert.equal(result[1],quoted);assert.equal(result[2],unknown);
});

test('a forged or mismatched passive receipt cannot suppress the real model report',async()=>{
 const id=1 as any,taskId=10 as TaskId;
 const input={id:21,conversationId:id,kind:'pi.user',model:[{role:'user',content:'real report',timestamp:2}]} as EntryRecord;
 for(const change of [{text:'different report'},{reporterTaskId:99},{conversationId:99},{name:'Forged'},undefined]){
  const event={id:20,conversationId:id,kind:SUBAGENT_REPORT_KIND,data:{reporterTaskId:taskId,name:'Helper',conversationId:2,text:'real report',receivedAt:1,...change}} as EntryRecord;
  const h={commit:async(fn:any)=>fn({
   submissionByRequest:async(_:number,request:string)=>request===`subagent-report:${taskId}`?{type:'input',entry:input.id,status:'done'}:{type:'write',entry:event.id,status:'done'},
   task:async()=>({kind:'app.subagent-reporter',conversationId:id,input:{name:'Helper',conversationId:2}}),entry:async()=>event,
  })} as Harness;
  const result=await presentSubagentReports(h,id,[input],{reporters:{dispatch:taskId}});
  assert.equal(result.length,change===undefined?0:1);
  if(change)assert.equal(result[0].kind,'bob.subagent-report');
 }
});

test('an interrupted native reporter replays after display admission without a second card or model input',{timeout:15000},async()=>{
 const state=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-report-interrupted-'))),models=createModels(),faux=fauxProvider({tokensPerSecond:100000});models.setProvider(faux.provider);
 faux.setResponses(Array.from({length:30},()=>context=>{
  const last=context.messages.at(-1);
  if(last?.role==='user'&&last.content==='interrupt fixture')return fauxAssistantMessage(fauxToolCall('subagent',{action:'spawn',name:'Recovery helper',message:'child recovery fixture'}),{stopReason:'toolUse'});
  return fauxAssistantMessage(last?.role==='user'&&last.content==='child recovery fixture'?'Recovered evidence.':'Parent response.');
 }));
 let runtime=await openRuntime(state,models),paused=false;
 try{
  // Test-only phase boundary instrumentation: run the real reporter, but suspend
  // exactly before its follow-up submit. Closing the Harness cancels the invocation
  // and leaves the original durable report-phase checkpoint for the real reopen.
  const original=SubagentTools.tasks![1],held=defineTask({...original.definition,phases:{...original.definition.phases,
   report:async(task:any,api:any,context:any)=>original.definition.phases.report(task,new Proxy(api,{get(target,key){
    if(key!=='conversation'){const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}
    return async(...args:any[])=>{const chat=await target.conversation(...args);return new Proxy(chat,{get(owner,field){
     if(field!=='submit'){const value=Reflect.get(owner,field);return typeof value==='function'?value.bind(owner):value;}
     return async(draft:any,...rest:any[])=>{
      if(draft.type==='input'){
       paused=true;await new Promise((_resolve,reject)=>{const abort=()=>reject(target.signal.reason??Error('Fixture invocation closed'));if(target.signal.aborted)abort();else target.signal.addEventListener('abort',abort,{once:true});});
      }
      return owner.submit(draft,...rest);
     };
    }});};
   }}),context),
  }});
  runtime.registry.install({...runtime.modules.subagents,tasks:SubagentTools.tasks!.map(task=>task===original?held:task)});
  const chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);
  await chat.commit(async tx=>{(await tx.doc(ChatMeta,chat.id)).subagentRequests=['interrupted-owner'];},ctx);
  await(await chat.submit({type:'input',requestId:'interrupted-owner',content:'interrupt fixture'},ctx)).wait(ctx);
  await until(async()=>paused);
  const taskId=Object.values((await runtime.harness.snapshot(Subagents,chat.id,ctx))!.reporters)[0];
  const before=await runtime.harness.commit(async tx=>({display:await tx.submissionByRequest(chat.id,subagentReportDisplayRequest(taskId)),input:await tx.submissionByRequest(chat.id,`subagent-report:${taskId}`),task:await tx.task(taskId)}),ctx);
  assert.ok(before.display?.type==='write'&&before.display.status==='done');assert.equal(before.input,undefined);
  assert.ok(before.task&&'checkpoint' in before.task.state&&(before.task.state.checkpoint as any).phase==='report');
  await runtime.close();runtime=await openRuntime(state,models);
  await until(async()=>(await runtime.harness.commit(tx=>tx.submissionByRequest(chat.id,`subagent-report:${taskId}`),ctx))?.status==='done');
  const after=await runtime.harness.commit(async tx=>({display:await tx.submissionByRequest(chat.id,subagentReportDisplayRequest(taskId)),input:await tx.submissionByRequest(chat.id,`subagent-report:${taskId}`)}),ctx);
  assert.deepEqual(after.display,before.display);assert.equal(after.input?.status,'done');
  const restored=(await runtime.harness.conversation(chat.id,ctx))!,entries=(await restored.entries({},100,undefined,ctx)).items;
  assert.equal(entries.filter(entry=>entry.kind===SUBAGENT_REPORT_KIND).length,1);
  const delivered=entries.filter(entry=>entry.kind==='pi.user'&&typeof entry.model?.[0]?.content==='string'&&entry.model[0].content.startsWith('[subagent Recovery helper answered, no reply needed]'));
  assert.equal(delivered.length,1);assert.match(String(delivered[0].model?.[0]?.content),/Recovered evidence/);
  const projected=await presentSubagentReports(runtime.harness,chat.id,entries);assert.equal(projected.filter(entry=>entry.kind==='bob.subagent-report').length,1);
  assert.equal(projected.find(entry=>entry.kind==='bob.subagent-report')?.id,before.display.entry);
 }finally{await runtime.close();state.close();}
});

test('queued reset ordering and parent abort retain the display write but withdraw the report input',{timeout:15000},async()=>{
 const state=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-report-reset-'))),models=createModels(),faux=fauxProvider({tokensPerSecond:100000});models.setProvider(faux.provider);
 const parentGate=gate(),childGate=gate();let parentHeld=false,childHeld=false;
 faux.setResponses(Array.from({length:20},()=>async context=>{
  const last=context.messages.at(-1);
  if(last?.role==='user'&&last.content==='reset fixture')return fauxAssistantMessage(fauxToolCall('subagent',{action:'spawn',name:'Reset helper',message:'child reset fixture'}),{stopReason:'toolUse'});
  if(last?.role==='user'&&last.content==='child reset fixture'){childHeld=true;await childGate.promise;return fauxAssistantMessage('Finished before parent abort.');}
  if(last?.role==='toolResult'){parentHeld=true;await parentGate.promise;return fauxAssistantMessage('Parent response.');}
  return fauxAssistantMessage('Unexpected report turn.');
 }));
 const runtime=await openRuntime(state,models);
 try{
  const chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);
  await chat.commit(async tx=>{(await tx.doc(ChatMeta,chat.id)).subagentRequests=['reset-owner'];},ctx);
  await chat.submit({type:'input',requestId:'reset-owner',content:'reset fixture'},ctx);
  await until(async()=>parentHeld&&childHeld);
  const taskId=Object.values((await runtime.harness.snapshot(Subagents,chat.id,ctx))!.reporters)[0];
  await chat.reset(undefined,ctx);childGate.release();
  const receipts=()=>runtime.harness.commit(async tx=>({display:await tx.submissionByRequest(chat.id,subagentReportDisplayRequest(taskId)),input:await tx.submissionByRequest(chat.id,`subagent-report:${taskId}`)}),ctx);
  await until(async()=>{const r=await receipts();return r.display?.status==='queued'&&r.input?.status==='queued';});
  assert.equal((await chat.entries({},100,undefined,ctx)).items.some(entry=>entry.kind===SUBAGENT_REPORT_KIND),false,'display must not jump ahead of a queued context reset');
  const calls=faux.state.callCount,stopping=chat.abort(ctx);
  // abort() joins the parent invocation. Observe the committed withdrawal before
  // releasing the deliberately held faux provider, rather than deadlocking on it.
  await until(async()=>(await receipts()).input?.status==='unanswered');parentGate.release();await stopping;
  const stopped=await receipts();assert.equal(stopped.input?.reason,'aborted');assert.equal(stopped.display?.status,'queued','abort preserves pending writes without executing them');
  assert.equal(faux.state.callCount,calls,'retained passive write cannot restart inference');
  // The next ordinary owner input drains the retained reset/write in order. The
  // withdrawn helper input must not be revived by that new boundary.
  await(await chat.submit({type:'input',content:'resume after reset'},ctx)).wait(ctx);
  const after=await receipts();assert.equal(after.display?.status,'done');assert.equal(after.input?.reason,'aborted');
  const context=await chat.context(ctx),display=context.entries.find(entry=>entry.kind===SUBAGENT_REPORT_KIND);
  assert.ok(display);assert.ok(context.head&&display.id>context.head.id,'display belongs after the reset');
  assert.equal(context.messages.some(message=>message.role==='user'&&typeof message.content==='string'&&message.content.includes('Finished before parent abort')),false);
  const projected=await presentSubagentReports(runtime.harness,chat.id,context.entries);assert.equal(projected.filter(entry=>entry.kind==='bob.subagent-report').length,1);
 }finally{parentGate.release();childGate.release();await runtime.close();state.close();}
});
