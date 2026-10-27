import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {serve} from '../src/server.js';
import {Harness,MemoryStorage,createRegistry,defineExtension,defineTool,defineTask,type ConversationId,type Harness as HarnessType} from '@earendil-works/pi-durable';
import {openNodeSqliteStorage} from '@earendil-works/pi-durable/storage/sqlite/node';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';
import {createModels} from '@earendil-works/pi-ai/models';
import {Type} from '@earendil-works/pi-ai';
import {fauxProvider,fauxAssistantMessage,fauxToolCall,fauxThinking} from '@earendil-works/pi-ai/providers/faux';
import {createHindsightMemory,MemoryActivity,MemoryPreferences,MemorySaves,MemoryInstallation,MemoryTurnPolicy,HindsightClient,memoryConfig,redact} from '@bob-local/memory';
import {State} from '../src/state.js';
import {openRuntime} from '../src/runtime.js';
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check:()=>Promise<boolean>,ms=4000){const end=Date.now()+ms;while(Date.now()<end){if(await check())return;await sleep(10);}throw Error('Timed out');}
function server(){
 const calls:{path:string;body:any}[]=[],ops=new Map<string,string>();let rejectSubmit=0,loseAck=false,down=false;
 const transport:typeof fetch=async(url,init)=>{
  const path=new URL(String(url)).pathname,body=init?.body?JSON.parse(String(init.body)):undefined;calls.push({path,body});
  if(down)throw Error('Offline');
  if(path.endsWith('/health'))return Response.json({status:'healthy'});
  if(path.endsWith('/memories/recall'))return Response.json({results:[{id:'fact-1',text:'Historic work used PostgreSQL.',type:'observation'},{id:'fact-duplicate',text:'Historic work used PostgreSQL.',type:'world'}]});
  if(path.endsWith('/reflect'))return Response.json({text:'Historic project context.'});
  if(path.endsWith('/memories')){
   if(rejectSubmit-->0)return Response.json({}, {status:503});
   ops.set(body.operation_id,'completed');
   if(loseAck){loseAck=false;throw Error('Acknowledgement lost');}
   return Response.json({success:true,async:true,operation_id:body.operation_id});
  }
  if(path.includes('/operations/'))return Response.json({status:ops.get(path.split('/').at(-1)!)??'not_found'});
  throw Error('Unexpected request '+path);
 };
 return {calls,ops,transport,setReject:(n:number)=>rejectSubmit=n,loseAck:()=>loseAck=true,setDown:(b:boolean)=>down=b};
}
async function setup(options:{storage?:any;fake?:ReturnType<typeof server>;extra?:any;attach?:boolean;ownerInputKinds?:string[]}={}){
 const fake=options.fake??server(),storage=options.storage??new MemoryStorage(),memory=createHindsightMemory({enabled:true,retryDelayMs:10,pollDelayMs:10},fake.transport,{ownerInputKinds:options.ownerInputKinds});
 const models=createModels(),faux=fauxProvider({tokensPerSecond:100000});models.setProvider(faux.provider);
 const registry=createRegistry();registry.install(memory.extension);if(options.extra)registry.install(options.extra);
 const h=await Harness.open(storage,{registry,models,settings:{extensions:[memory.extension,...(options.extra?[options.extra]:[])]}},ctx);await h.root(ctx);
 const attached=options.attach===false?undefined:await memory.attach(h,storage,'test-backend');
 return {fake,storage,memory,models,faux,h,attached,close:async()=>{await attached?.close();await h.close(ctx);}};
}
async function saves(h:HarnessType,id:ConversationId){const a=await h.snapshot(MemoryActivity,id,ctx);return Promise.all((a?.recentSaves??[]).map(async key=>({key,...(await h.snapshot(MemorySaves,id,key,ctx))!})));}
async function chat(h:HarnessType){return h.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);}

test('native module recalls both banks once per run, deduplicates, and retains only canonical user/final answer',{timeout:12000},async()=>{
 const extra=defineExtension({name:'fixture.tools',tools:[defineTool({name:'probe',parameters:Type.Object({}),execute:async()=>({output:[{type:'text',text:'RAW_TOOL_OUTPUT_SECRET'}]})})]});
 const r=await setup({extra}),seen:any[]=[];
 r.faux.setResponses([request=>{seen.push(request.messages);return fauxAssistantMessage([fauxThinking('HIDDEN_REASONING_SECRET'),fauxToolCall('probe',{})],{stopReason:'toolUse'});},request=>{seen.push(request.messages);return fauxAssistantMessage('The historical project used PostgreSQL.');}]);
 try{
  const c=await chat(r.h),sub=await c.submit({type:'input',content:'What did my old project use?\n\n[Bob display context for this request: SCREEN_SECRET]'},ctx);await sub.wait(ctx);await r.attached!.flush();
  await until(async()=>(await saves(r.h,c.id))[0]?.status==='completed');
  assert.equal(r.fake.calls.filter(c=>c.path.endsWith('/memories/recall')).length,2,'two banks, not two searches per tool round');
  assert.equal(seen.length,2);for(const messages of seen){const ref=messages.filter((m:any)=>m.role==='user'&&typeof m.content==='string'&&m.content.startsWith('Hindsight memory'));assert.equal(ref.length,1);assert.match(ref[0].content,/untrusted historical reference/);assert.equal((ref[0].content.match(/Historic work/g)??[]).length,1);}
  const retained=r.fake.calls.find(c=>c.path.endsWith('/memories'))!;
  assert.ok(retained.path.includes('/banks/bob/'));assert.match(retained.body.items[0].content,/User: What did my old project use/);assert.match(retained.body.items[0].content,/Assistant: The historical/);
  assert.doesNotMatch(retained.body.items[0].content,/RAW_TOOL_OUTPUT_SECRET|HIDDEN_REASONING_SECRET|SCREEN_SECRET|Hindsight memory/);
  const entries=await c.entries({},100,undefined,ctx);assert.equal(entries.items.some(e=>JSON.stringify(e.model).includes('untrusted historical reference')),false);
  assert.ok(r.fake.calls.every(c=>!c.path.includes('/banks/hermes/memories')||c.path.endsWith('/recall')),'legacy bank is never written');
 }finally{await r.close();}
});

test('#nomem, disabled preferences, custom/peer inputs and task-owned conversations do not export turns',{timeout:12000},async()=>{
 const r=await setup({ownerInputKinds:['pi.user','bob.user']});r.faux.setResponses(Array.from({length:5},()=>fauxAssistantMessage('A normal answer.')));
 try{
  const c=await chat(r.h);await(await c.submit({type:'input',content:'Private request #nomem'},ctx)).wait(ctx);
  await c.commit(async tx=>{const p=await tx.doc(MemoryPreferences,c.id);p.autoRecall=false;p.autoRetain=false;},ctx);
  await(await c.submit({type:'input',content:'Another private request'},ctx)).wait(ctx);
  await c.commit(async tx=>{const p=await tx.doc(MemoryPreferences,c.id);p.autoRecall=true;p.autoRetain=true;},ctx);
  await(await c.submit({type:'input',content:'Remote agent input',entry:{kind:'bob.peer-message'}},ctx)).wait(ctx);
  const owner=await c.commit(tx=>tx.createTask(defineTask<null,{phase:'wait'},null>({name:'fixture.owner',version:1,initial:()=>({phase:'wait'}),phases:{wait:async()=>{throw Error('Not scheduled');}}}),null,{ownership:{kind:'conversation'},background:true}),ctx);
  const child=await r.h.createConversation({ownership:{kind:'task',taskId:owner},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);
  // The owner is deliberately never scheduled; abort it before submitting the child fixture.
  await r.h.abortTask(owner,ctx);
  await(await child.submit({type:'input',content:'Background child request',entry:{kind:'bob.user'}},ctx)).wait(ctx);
  await r.attached!.flush();assert.equal((await saves(r.h,c.id)).length,0);assert.equal(r.fake.calls.length,0);
 }finally{await r.close();}
});

test('lost retain acknowledgement and transient errors reuse one operation/document identity',{timeout:12000},async()=>{
 const r=await setup();r.fake.setReject(1);r.fake.loseAck();r.faux.setResponses([fauxAssistantMessage('Remembered answer.')]);
 try{const c=await chat(r.h);await(await c.submit({type:'input',content:'I use PostgreSQL'},ctx)).wait(ctx);await r.attached!.flush();await until(async()=>(await saves(r.h,c.id))[0]?.status==='completed');
  const writes=r.fake.calls.filter(c=>c.path.endsWith('/memories'));assert.equal(writes.length,3);assert.equal(new Set(writes.map(c=>c.body.operation_id)).size,1);assert.equal(new Set(writes.map(c=>c.body.items[0].document_id)).size,1);assert.equal(r.fake.ops.size,1);
 }finally{await r.close();}
});

test('outage never fails the answer; bounded failed saves remain inspectable',{timeout:12000},async()=>{
 const r=await setup();r.fake.setDown(true);r.faux.setResponses([fauxAssistantMessage('Answer without memory.')]);
 try{const c=await chat(r.h);assert.equal((await(await c.submit({type:'input',content:'A request while offline'},ctx)).wait(ctx)).status,'done');await r.attached!.flush();await until(async()=>(await saves(r.h,c.id))[0]?.status==='failed');const s=(await saves(r.h,c.id))[0];assert.equal(s.attempts,5);assert.ok(s.error);assert.deepEqual((await r.h.snapshot(MemoryActivity,c.id,ctx))?.lastRecall?.unavailable,['bob','hermes']);}finally{await r.close();}
});

test('startup reconciliation captures settled turns missed before process exit, without exporting pre-install history',{timeout:15000},async()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR!,'bob-memory-reconcile-')),path=join(dir,'session.sqlite'),fake=server();
 let r=await setup({storage:await openNodeSqliteStorage(path),fake,attach:false});
 r.faux.setResponses([fauxAssistantMessage('Historical answer.')]);const c=await chat(r.h);await(await c.submit({type:'input',content:'Pre-install historical request'},ctx)).wait(ctx);
 const attached=await r.memory.attach(r.h,r.storage,'test-backend');await attached.close();
 r.faux.setResponses([fauxAssistantMessage('Completed before the observer can capture.')]);const missed=await c.submit({type:'input',content:'New request needing catch-up'},ctx);await missed.wait(ctx);
 // Simulate the generation-time consent checkpoint that a real crash leaves behind, without a live capture observer.
 await c.commit(tx=>tx.doc(MemoryTurnPolicy,c.id,String(missed.id),true),ctx);await r.h.close(ctx);
 r=await setup({storage:await openNodeSqliteStorage(path),fake});r.h.resume();
 try{await until(async()=>(await saves(r.h,c.id))[0]?.status==='completed');assert.equal((await saves(r.h,c.id)).length,1);assert.match(fake.calls.find(c=>c.path.endsWith('/memories'))!.body.items[0].content,/New request needing catch-up/);assert.equal(fake.calls.filter(c=>c.path.endsWith('/memories')).length,1);}finally{await r.close();}
 r=await setup({storage:await openNodeSqliteStorage(path),fake});try{r.h.resume();await sleep(50);assert.equal(fake.calls.filter(c=>c.path.endsWith('/memories')).length,1,'reconciliation receipts prevent duplicate export');}finally{await r.close();}
});

test('queued durable retention resumes after reopen with the same identity',{timeout:15000},async()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR!,'bob-memory-reopen-')),path=join(dir,'session.sqlite'),fake=server();
 let r=await setup({storage:await openNodeSqliteStorage(path),fake});fake.setDown(true);r.faux.setResponses([fauxAssistantMessage('A durable answer.')]);const c=await chat(r.h);await(await c.submit({type:'input',content:'Persist across restart'},ctx)).wait(ctx);await r.attached!.flush();const before=(await saves(r.h,c.id))[0];await r.close();fake.setDown(false);
 r=await setup({storage:await openNodeSqliteStorage(path),fake});r.h.resume();try{await until(async()=>(await saves(r.h,c.id))[0]?.status==='completed');const after=(await saves(r.h,c.id))[0];assert.equal(after.operationId,before.operationId);assert.equal(after.documentId,before.documentId);}finally{await r.close();}
});

test('explicit retain/settings/status run as native tools; queue receipt never claims extraction complete',{timeout:12000},async()=>{
 const r=await setup();r.faux.setResponses([fauxAssistantMessage([fauxToolCall('hindsight_retain',{content:'The owner uses PostgreSQL.',tags:['project:test']})],{stopReason:'toolUse'}),fauxAssistantMessage('The save is queued.')]);
 try{const c=await chat(r.h);await(await c.submit({type:'input',content:'Remember that I use PostgreSQL.'},ctx)).wait(ctx);await r.attached!.flush();await until(async()=>(await saves(r.h,c.id)).every(s=>s.status==='completed'));
  const history=JSON.stringify((await c.entries({},100,undefined,ctx)).items);assert.match(history,/extractionCompleted/);assert.match(history,/queued/);
  r.faux.setResponses([fauxAssistantMessage([fauxToolCall('hindsight_memory',{action:'configure',autoRetain:false,autoRecall:false})],{stopReason:'toolUse'}),fauxAssistantMessage('Memory disabled here.')]);await(await c.submit({type:'input',content:'Disable memory in this conversation.'},ctx)).wait(ctx);assert.deepEqual(await r.h.snapshot(MemoryPreferences,c.id,ctx),{autoRetain:false,autoRecall:false});
 }finally{await r.close();}
});

test('client bounds/deduplicates merged results and redacts known secret formats',async()=>{
 const fake=server(),client=new HindsightClient(memoryConfig({enabled:true,maxTokens:100}),fake.transport);const recalled=await client.recall('test',['bob','hermes']);assert.equal(recalled.facts.length,1);
 assert.equal(memoryConfig().enabled,false);assert.throws(()=>memoryConfig({baseUrl:'http://example.com'}),/HTTPS/);assert.throws(()=>memoryConfig({writeBank:'../hermes'}));assert.throws(()=>memoryConfig({maxAttempts:0}));
 const text=redact('api_key=secretvalue password="private" sk-abcdefghijklmnopqrstuvw Bearer abcdefghijklmnop');assert.doesNotMatch(text,/secretvalue|private|sk-abcdefghijkl|abcdefghijklmnop/);
});

test('Bob host exposes removable standalone memory module but default unconfigured states make no memory calls',async()=>{
 const state=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-memory-host-')));const runtime=await openRuntime(state,undefined,undefined,{resume:false});try{assert.ok(runtime.registry.snapshot().extension('bob.memory'));const c=await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx);assert.ok((await c.agent(ctx)).tools.some(t=>t.name==='hindsight_memory'));await c.configure({extensions:{remove:[runtime.modules.memory]}},ctx);assert.equal((await c.agent(ctx)).tools.some(t=>t.name==='hindsight_memory'),false);}finally{await runtime.close();state.close();}
});

for(const kind of ['pi.user','bob.user'])test(`late opt-out in a steered ${kind} run revokes automatic retention for every input sharing its final answer`,{timeout:12000},async()=>{
 let release!:()=>void,entered!:()=>void;const started=new Promise<void>(r=>entered=r),blocked=new Promise<void>(r=>release=r);
 const extra=defineExtension({name:'fixture.blocker',tools:[defineTool({name:'block',parameters:Type.Object({}),execute:async()=>{entered();await blocked;return {};}})]});
 const r=await setup({extra,ownerInputKinds:['pi.user','bob.user']});r.faux.setResponses([fauxAssistantMessage([fauxToolCall('block',{})],{stopReason:'toolUse'}),fauxAssistantMessage('This final answer includes private steered context.')]);
 try{
  const c=await chat(r.h),first=await c.submit({type:'input',content:'Original non-private request',...(kind==='pi.user'?{}:{entry:{kind}})},ctx);await started;
  const steer=await c.submit({type:'input',content:'Private steering context #nomem',whenBusy:'steer',...(kind==='pi.user'?{}:{entry:{kind}})},ctx);release();await first.wait(ctx);await steer.wait(ctx);await r.attached!.flush();
  assert.equal((await saves(r.h,c.id)).length,0,'no original input can export a final answer containing opted-out context');
 }finally{release();await r.close();}
});

test('turns made with saving disabled stay excluded after re-enabling, including catch-up on restart',{timeout:12000},async()=>{
 const r=await setup();r.faux.setResponses([fauxAssistantMessage('Not for memory.')]);
 try{const c=await chat(r.h);await c.commit(async tx=>{(await tx.doc(MemoryPreferences,c.id)).autoRetain=false;},ctx);const sub=await c.submit({type:'input',content:'Private while disabled'},ctx);await sub.wait(ctx);
 await c.commit(async tx=>{(await tx.doc(MemoryPreferences,c.id)).autoRetain=true;},ctx);await r.attached!.flush();assert.equal((await saves(r.h,c.id)).length,0);assert.equal((await r.h.snapshot(MemoryTurnPolicy,c.id,String(sub.id),ctx))?.autoRetain,false);
 }finally{await r.close();}
});

test('real Bob host provisions configured module once, preserves selections, and backs up configuration in control state',{timeout:20000},async()=>{
 const {createServer}=await import('node:http');const fake=server();
 const http=createServer(async(req,res)=>{try{const parts:Buffer[]=[];for await(const b of req)parts.push(b);const response=await fake.transport('http://127.0.0.1'+req.url,{method:req.method,body:parts.length?Buffer.concat(parts).toString():undefined});res.statusCode=response.status;res.setHeader('content-type','application/json');res.end(await response.text());}catch{res.statusCode=500;res.end('{}');}});
 await new Promise<void>(r=>http.listen(0,'127.0.0.1',r));
 const state=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-memory-configured-'))),models=createModels(),faux=fauxProvider({tokensPerSecond:100000});models.setProvider(faux.provider);
 state.set('modules',{installed:['resources'],defaults:['resources']});let runtime=await openRuntime(state,models,{ } as any,{resume:false});
 const c=await runtime.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'},extensions:[runtime.modules.resources]}},ctx);await runtime.close();
 const configuration={enabled:true,baseUrl:`http://127.0.0.1:${(http.address() as any).port}`,pollDelayMs:10,retryDelayMs:10};writeFileSync(join(state.dir,'hindsight.json'),JSON.stringify(configuration),{mode:0o600});
 runtime=await openRuntime(state,models);
 try{
  const restored=(await runtime.harness.conversation(c.id,ctx))!;assert.deepEqual((await restored.agent(ctx)).extensions.map(e=>e.name),['bob.resources','bob.memory']);assert.deepEqual(state.get('hindsightConfig'),configuration);
  faux.setResponses([fauxAssistantMessage('A new owner answer.')]);await(await restored.submit({type:'input',content:'A new owner request'},ctx)).wait(ctx);await until(async()=>(await saves(runtime.harness,c.id))[0]?.status==='completed');
  await restored.configure({extensions:{remove:[runtime.modules.memory]}},ctx);
 }finally{await runtime.close();}
 // A later restart does not silently undo an owner's per-chat module removal.
 runtime=await openRuntime(state,models);try{assert.deepEqual((await(await runtime.harness.conversation(c.id,ctx))!.agent(ctx)).extensions.map(e=>e.name),['bob.resources']);}finally{await runtime.close();state.close();await new Promise<void>(r=>http.close(()=>r()));}
});

test('processing failures from async child operations are visible instead of being reported as completed',{timeout:12000},async()=>{
 const fake=server(),transport:typeof fetch=async(url,init)=>String(url).includes('/operations/')?Response.json({status:'pending',child_operations:[{status:'pending',error_message:'CodexRefreshExpiredError: refresh_token_reused'}]}):fake.transport(url,init);
 const storage=new MemoryStorage(),memory=createHindsightMemory({enabled:true,pollDelayMs:10},transport),registry=createRegistry();registry.install(memory.extension);
 const models=createModels(),faux=fauxProvider({tokensPerSecond:100000});models.setProvider(faux.provider);faux.setResponses([fauxAssistantMessage('An answer pending extraction.')]);
 const h=await Harness.open(storage,{models,registry,settings:{extensions:[memory.extension]}},ctx);await h.root(ctx);const attached=await memory.attach(h,storage,'test-backend');
 try{const c=await chat(h);await(await c.submit({type:'input',content:'Save this normal turn'},ctx)).wait(ctx);await attached.flush();await until(async()=>Boolean((await saves(h,c.id))[0]?.processingWarning));const s=(await saves(h,c.id))[0];assert.equal(s.status,'accepted');assert.match(s.processingWarning!,/refresh_token_reused/);}finally{await attached.close();await h.close(ctx);}
});

test('a server that does not acknowledge the requested idempotency identity is not automatically resent',{timeout:12000},async()=>{
 let writes=0;const fake=server(),transport:typeof fetch=async(url,init)=>{if(String(url).endsWith('/memories')){writes++;return Response.json({success:true,async:true,operation_id:'wrong-identity'});}return fake.transport(url,init);};
 const storage=new MemoryStorage(),memory=createHindsightMemory({enabled:true,pollDelayMs:10,retryDelayMs:10},transport),registry=createRegistry();registry.install(memory.extension);const models=createModels(),faux=fauxProvider({tokensPerSecond:100000});models.setProvider(faux.provider);faux.setResponses([fauxAssistantMessage('A completed answer.')]);const h=await Harness.open(storage,{models,registry,settings:{extensions:[memory.extension]}},ctx);await h.root(ctx);const attached=await memory.attach(h,storage,'test-backend');
 try{const c=await chat(h);await(await c.submit({type:'input',content:'An ordinary request'},ctx)).wait(ctx);await attached.flush();await until(async()=>(await saves(h,c.id))[0]?.status==='failed');assert.equal(writes,1);assert.match((await saves(h,c.id))[0].error!,/no automatic resend/);}finally{await attached.close();await h.close(ctx);}
});

test('real SIGKILL after server acceptance recovers retention with the original operation identity',{timeout:30000},async()=>{
 const {createServer}=await import('node:http'),{spawn}=await import('node:child_process'),{once}=await import('node:events');
 const dir=mkdtempSync(join(process.env.TMPDIR!,'bob-memory-sigkill-')),path=join(dir,'session.sqlite'),writes:string[]=[];
 let accepted!:()=>void;const firstAccepted=new Promise<void>(r=>accepted=r);
 const http=createServer(async(req,res)=>{const parts:Buffer[]=[];for await(const b of req)parts.push(b);const data=parts.length?JSON.parse(Buffer.concat(parts).toString()):undefined;res.setHeader('content-type','application/json');
  if(req.url?.endsWith('/memories/recall'))return res.end(JSON.stringify({results:[]}));
  if(req.url?.endsWith('/memories')){writes.push(data.operation_id);if(writes.length===1){accepted();return;}return res.end(JSON.stringify({success:true,async:true,operation_id:data.operation_id}));}
  if(req.url?.includes('/operations/'))return res.end(JSON.stringify({status:'completed'}));res.statusCode=404;res.end('{}');
 });await new Promise<void>(r=>http.listen(0,'127.0.0.1',r));
 const baseUrl=`http://127.0.0.1:${(http.address() as any).port}`;
 const source=`import {createHindsightMemory} from '@bob-local/memory';import {Harness,createRegistry} from '@earendil-works/pi-durable';import {openNodeSqliteStorage} from '@earendil-works/pi-durable/storage/sqlite/node';import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';import {createModels} from '@earendil-works/pi-ai/models';import {fauxProvider,fauxAssistantMessage} from '@earendil-works/pi-ai/providers/faux';const storage=await openNodeSqliteStorage(${JSON.stringify(path)}),memory=createHindsightMemory({enabled:true,baseUrl:${JSON.stringify(baseUrl)},pollDelayMs:10,retryDelayMs:10}),registry=createRegistry();registry.install(memory.extension);const models=createModels(),f=fauxProvider({tokensPerSecond:100000});models.setProvider(f.provider);f.setResponses([fauxAssistantMessage('A final answer before the crash.')]);const h=await Harness.open(storage,{models,registry,settings:{extensions:[memory.extension]}},ctx);await h.root(ctx);await memory.attach(h,storage,'crash-test-backend');const c=await h.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);console.log(JSON.stringify({chat:c.id}));await(await c.submit({type:'input',content:'Persist this user turn across the process crash.'},ctx)).wait(ctx);`;
 const child=spawn(process.execPath,['--input-type=module','-e',source],{cwd:process.cwd(),stdio:['ignore','pipe','pipe']});
 try{
  let output='';const admitted=new Promise<{chat:ConversationId}>((resolve,reject)=>{child.stdout.on('data',b=>{output+=b;if(output.includes('\n'))resolve(JSON.parse(output.split('\n')[0]));});child.once('error',reject);child.once('exit',code=>{if(!output)reject(Error('Crash fixture exited '+code));});});
  const info=await admitted;await firstAccepted;const exit=once(child,'exit');child.kill('SIGKILL');await exit;
  const storage=await openNodeSqliteStorage(path),memory=createHindsightMemory({enabled:true,baseUrl,pollDelayMs:10,retryDelayMs:10}),registry=createRegistry();registry.install(memory.extension);const models=createModels(),h=await Harness.open(storage,{models,registry,settings:{extensions:[memory.extension]}},ctx);await h.root(ctx);const attached=await memory.attach(h,storage,'crash-test-backend');h.resume();
  try{await until(async()=>(await saves(h,info.chat))[0]?.status==='completed');assert.equal(writes.length,2);assert.equal(new Set(writes).size,1);assert.equal((await saves(h,info.chat)).length,1);}finally{await attached.close();await h.close(ctx);}
 }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');http.closeAllConnections();await new Promise<void>(r=>http.close(()=>r()));}
});


test('authenticated app messages recall and retain bob.user, without exporting display metadata or duplicate requests',{timeout:20000},async()=>{
 const {createServer}=await import('node:http'),fake=server(),seen:any[]=[];
 const http=createServer(async(req,res)=>{try{const parts:Buffer[]=[];for await(const b of req)parts.push(b);const response=await fake.transport('http://127.0.0.1'+req.url,{method:req.method,body:parts.length?Buffer.concat(parts).toString():undefined});res.writeHead(response.status,{'content-type':'application/json'});res.end(await response.text());}catch{res.writeHead(500);res.end('{}');}});
 await new Promise<void>(r=>http.listen(0,'127.0.0.1',r));
 const state=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-memory-app-'))),models=createModels(),faux=fauxProvider({tokensPerSecond:100000});models.setProvider(faux.provider);
 writeFileSync(join(state.dir,'hindsight.json'),JSON.stringify({enabled:true,baseUrl:`http://127.0.0.1:${(http.address() as any).port}`,pollDelayMs:10,retryDelayMs:10}),{mode:0o600});
 const runtime=await openRuntime(state,models),app=await serve(state,{port:0,runtime}),device=state.pair(state.invite().token,'Memory app fixture');
 const base=`http://127.0.0.1:${(app.server.address() as any).port}/v1`,headers={authorization:'Bearer '+device.credential,'x-bob-backend':state.id,'content-type':'application/json'};
 try{
  const c=await chat(runtime.harness);
  faux.setResponses([request=>{seen.push(request.messages);return fauxAssistantMessage('The owner prefers PostgreSQL.');},fauxAssistantMessage('Private answer.'),fauxAssistantMessage('Disabled answer.'),fauxAssistantMessage('Peer answer.')]);
  const request={requestId:randomUUID(),text:'I prefer PostgreSQL for this project.',mode:'steer',display:{inline:{width:313,height:420},fullscreen:{width:361,height:754}}};
  const send=(value:any)=>fetch(base+`/chats/${c.id}/messages`,{method:'POST',headers,body:JSON.stringify(value)});
  const accepted=await send(request);assert.equal(accepted.status,202);const sub=await accepted.json() as any;
  await (await runtime.harness.submission(sub.id,ctx))!.wait(ctx);
  await until(async()=>(await saves(runtime.harness,c.id))[0]?.status==='completed');
  assert.equal((await c.entries({},100,undefined,ctx)).items.find(e=>e.id===sub.entry)?.kind,'bob.user');
  assert.equal((await runtime.harness.snapshot(MemoryTurnPolicy,c.id,String(sub.id),ctx))?.autoRetain,true);
  assert.equal(fake.calls.filter(c=>c.path.endsWith('/memories/recall')).length,2);
  assert.ok(seen[0].some((m:any)=>m.role==='user'&&typeof m.content==='string'&&m.content.startsWith('Hindsight memory')));
  const write=fake.calls.find(c=>c.path.endsWith('/memories'))!;assert.match(write.body.items[0].content,/User: I prefer PostgreSQL/);assert.match(write.body.items[0].content,/Assistant: The owner prefers PostgreSQL/);assert.doesNotMatch(write.body.items[0].content,/CSS-pixel|display context|width/);
  const duplicate=await send(request);assert.equal(duplicate.status,200);assert.equal((await duplicate.json() as any).id,sub.id);
  const privateReply=await send({requestId:randomUUID(),text:'Private app message #nomem',mode:'steer'});const privateSub=await privateReply.json() as any;await(await runtime.harness.submission(privateSub.id,ctx))!.wait(ctx);
  assert.equal((await runtime.harness.snapshot(MemoryTurnPolicy,c.id,String(privateSub.id),ctx))?.autoRetain,false);
  await c.commit(async tx=>{(await tx.doc(MemoryPreferences,c.id)).autoRetain=false;(await tx.doc(MemoryPreferences,c.id)).autoRecall=false;},ctx);
  const disabled=await send({requestId:randomUUID(),text:'Saving disabled app message',mode:'steer'});const disabledSub=await disabled.json() as any;await(await runtime.harness.submission(disabledSub.id,ctx))!.wait(ctx);
  await c.commit(async tx=>{(await tx.doc(MemoryPreferences,c.id)).autoRetain=true;(await tx.doc(MemoryPreferences,c.id)).autoRecall=true;},ctx);
  await(await c.submit({type:'input',content:'Peer input stays excluded',entry:{kind:'bob.peer-message'}},ctx)).wait(ctx);
  await runtime.harness.waitForIdle(ctx);await sleep(50);
  assert.equal((await saves(runtime.harness,c.id)).length,1);assert.equal(fake.calls.filter(c=>c.path.endsWith('/memories')).length,1);assert.equal(fake.calls.filter(c=>c.path.endsWith('/memories/recall')).length,2);
 }finally{await app.close();state.close();http.closeAllConnections();await new Promise<void>(r=>http.close(()=>r()));}
});

test('Bob owner kind is opt-in for other hosts, and missing consent checkpoints never backfill previously skipped app turns',{timeout:15000},async()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR!,'bob-memory-kind-reopen-')),path=join(dir,'session.sqlite'),fake=server();
 let r=await setup({storage:await openNodeSqliteStorage(path),fake});r.faux.setResponses([fauxAssistantMessage('Previously skipped app answer.')]);const c=await chat(r.h);
 const sub=await c.submit({type:'input',content:'Old app message',entry:{kind:'bob.user'}},ctx);await sub.wait(ctx);await r.attached!.flush();assert.equal(fake.calls.length,0);assert.equal(await r.h.snapshot(MemoryTurnPolicy,c.id,String(sub.id),ctx),undefined);await r.close();
 r=await setup({storage:await openNodeSqliteStorage(path),fake,ownerInputKinds:['pi.user','bob.user']});r.h.resume();
 try{
  await r.attached!.flush();assert.equal(fake.calls.length,0,'no retrospective consent inferred during upgrade');
  r.faux.setResponses([fauxAssistantMessage('New app answer.')]);const restored=(await r.h.conversation(c.id,ctx))!;
  await(await restored.submit({type:'input',content:'New app message',entry:{kind:'bob.user'}},ctx)).wait(ctx);await r.attached!.flush();await until(async()=>(await saves(r.h,c.id))[0]?.status==='completed');assert.equal((await saves(r.h,c.id)).length,1);
 }finally{await r.close();}
});
