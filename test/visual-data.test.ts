import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
import {Harness,createRegistry} from '@earendil-works/pi-durable';
import {openNodeSqliteStorage} from '@earendil-works/pi-durable/storage/sqlite/node';
import {NodeExecutionEnv} from '@earendil-works/pi-durable/env/node';
import {createInteractive as legacyInteractive,Interactive} from '@bob-local/interactive';
import {VisualData,visualDataTool,readVisualData} from '../src/visual-data.js';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {serve} from '../src/server.js';

test('native visual_data tool updates one recorded visual through authenticated, scoped read-only delivery',{timeout:40000},async()=>{
 const state=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-visual-data-tool-'))),models=createModels(),faux=fauxProvider({tokensPerSecond:100000});models.setProvider(faux.provider);
 const runtime=await openRuntime(state,models),app=await serve(state,{port:0,runtime}),paired=state.pair(state.invite().token,'Visual data fixture');
 const base=`http://127.0.0.1:${(app.server.address() as any).port}/v1`,headers={authorization:`Bearer ${paired.credential}`,'x-bob-backend':state.id,'content-type':'application/json'};
 try{
  const chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx),other=await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
  const run=async(name:string,args:unknown)=>{faux.setResponses([fauxAssistantMessage([fauxToolCall(name,args as any)],{stopReason:'toolUse'}),fauxAssistantMessage('Fixture complete')]);await(await chat.submit({type:'input',content:'Run the requested visual fixture'},ctx)).wait(ctx);};
  const html='<p id="value">Waiting for data</p><script>bobVisual.subscribe(({data})=>{if(data)document.getElementById("value").textContent=data.value;});</script>';
  await run('render_visual',{title:'Live fixture',html,presentation:'inline'});
  const [surface]=await runtime.interactive.list(runtime.harness,chat);
  assert.ok((await chat.agent(ctx)).tools.some(tool=>tool.name==='visual_data'));
  const url=base+`/chats/${chat.id}/ui/${surface.id}`;
  let response=await fetch(url+'/data',{headers});assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{id:surface.id,conversationId:chat.id,revision:0,data:null,updatedAt:null});
  await run('visual_data',{action:'update',id:surface.id,expectedRevision:0,data:{value:'A live update',items:[1,2]}});
  response=await fetch(url+'/data?after=0',{headers});const value=await response.json() as any;
  assert.equal(value.revision,1);assert.deepEqual(value.data,{value:'A live update',items:[1,2]});assert.ok(value.updatedAt>0);
  assert.deepEqual(await(await fetch(url+'/data?after=1',{headers})).json(),{id:surface.id,conversationId:chat.id,revision:1,unchanged:true});
  assert.equal((await fetch(url+'/data?after=-1',{headers})).status,400);
  assert.equal((await fetch(url+'/data')).status,401);
  assert.equal((await fetch(base+`/chats/${other.id}/ui/${surface.id}/data`,{headers})).status,404);
  assert.ok((await fetch(url+'/data',{headers,method:'POST',body:'{}'})).status>=400,'no viewer write API');
  const opened=await(await fetch(url+'/open',{headers,method:'POST',body:'{}'})).json() as any;
  assert.equal(opened.html,html);assert.equal(opened.visualData.revision,1);assert.equal(opened.visualData.data.value,'A live update');
  assert.equal((await runtime.interactive.list(runtime.harness,chat)).length,1,'an update does not create a second card');
  await run('visual_data',{action:'update',id:surface.id,expectedRevision:0,data:{value:'Stale overwrite'}});
  assert.equal((await readVisualData(runtime.harness,chat,surface.id)).revision,1);
  const entries=await chat.entries({},100,undefined,ctx);
  assert.equal(entries.items.filter(entry=>entry.kind==='bob.visual-data').length,1);
  assert.ok(JSON.stringify(entries).includes('Visual revision conflict'));
  assert.equal((await runtime.harness.snapshot(Interactive,chat.id,ctx))!.apps[surface.id].html,html,'original generation/history remains unchanged');
 }finally{await app.close();state.close();}
});

test('visual data commits are atomic, replay-safe, bounded and additive across old/new runtime reopen',{timeout:40000},async()=>{
 const state=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-visual-data-replay-')));let runtime=await openRuntime(state),closed=false;
 const chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx),id=randomUUID(),second=randomUUID(),mcp=randomUUID();
 await chat.commit(async tx=>{const doc=await tx.doc(Interactive,chat.id);for(const appId of [id,second,mcp])doc.apps[appId]={id:appId,title:'Original',kind:appId===mcp?'mcp':'visual',html:'<p>Original HTML</p>',presentation:'inline',allowedTools:[]};},ctx);
 const original=await runtime.harness.snapshot(Interactive,chat.id,ctx);
 const call=async(taskId:number,args:any)=>{
  const current=(await runtime.harness.conversation(chat.id,ctx))!;
  return visualDataTool.execute(args,{taskId,conversationId:chat.id,snapshot:runtime.harness.snapshot.bind(runtime.harness),commit:current.commit.bind(current)} as any,ctx);
 };
 const args={action:'update',id,expectedRevision:0,data:{value:'First'}};
 try{
  const first=await call(10001,args);assert.match(JSON.stringify(first),/persisted/);
  assert.deepEqual(await call(10001,args),first);
  await assert.rejects(()=>call(10001,{...args,data:{value:'Changed replay'}}),/identity conflict/);
  await call(10002,{action:'update',id,expectedRevision:1,data:{value:'Second'}});
  assert.deepEqual(await call(10001,args),first,'late replay returns its receipt without rolling current data back');
  assert.equal((await readVisualData(runtime.harness,chat,id) as any).data.value,'Second');
  await assert.rejects(()=>call(10003,{action:'update',id,data:{}}),/expectedRevision/);
  await assert.rejects(()=>call(10004,{action:'update',id,expectedRevision:2,data:{text:'🙂'.repeat(20000)}}),/64 KiB/);
  await assert.rejects(()=>call(10005,{action:'update',id,expectedRevision:2,data:[]}),/JSON object/);
  await assert.rejects(()=>call(10006,{action:'update',id:mcp,expectedRevision:0,data:{}}),/not found/);
  const races=await Promise.allSettled([call(10007,{action:'update',id:second,expectedRevision:0,data:{writer:'a'}}),call(10008,{action:'update',id:second,expectedRevision:0,data:{writer:'b'}})]);
  assert.equal(races.filter(result=>result.status==='fulfilled').length,1);assert.equal(races.filter(result=>result.status==='rejected').length,1);
  assert.equal((await readVisualData(runtime.harness,chat,second)).revision,1);
  const beforeHistory=(await chat.entries({},100,undefined,ctx)).items;
  assert.equal(beforeHistory.filter(entry=>entry.kind==='bob.visual-data').length,3);
  assert.deepEqual(await runtime.harness.snapshot(Interactive,chat.id,ctx),original,'no legacy document/task schema or content was changed');
  await runtime.close();closed=true;
  // Older code can open the same native state and read original surfaces/history.
  // It ignores the additive document; no migration, DB edits or rollback restore.
  const legacy=legacyInteractive(state),registry=createRegistry();registry.install(legacy.extension);
  const old=await Harness.open(await openNodeSqliteStorage(join(state.dir,'durable.sqlite')),{models:createModels(),registry,env:()=>new NodeExecutionEnv({cwd:process.cwd()})},ctx);
  try{
   assert.deepEqual(await old.snapshot(Interactive,chat.id,ctx),original);
   const oldChat=(await old.conversation(chat.id,ctx))!;assert.deepEqual((await oldChat.entries({},100,undefined,ctx)).items,beforeHistory);
  }finally{await old.close(ctx);}
  runtime=await openRuntime(state);closed=false;
  assert.deepEqual(await call(10001,args),first,'task receipt survives reopen and old-code reads');
  const reopened=(await runtime.harness.conversation(chat.id,ctx))!;
  assert.equal((await readVisualData(runtime.harness,reopened,id) as any).data.value,'Second');
  assert.equal((await runtime.harness.snapshot(VisualData,chat.id,ctx))!.values[id].revision,2);
  assert.equal((await reopened.entries({},100,undefined,ctx)).items.filter(entry=>entry.kind==='bob.visual-data').length,3);
 }finally{if(!closed)await runtime.close();state.close();}
});
