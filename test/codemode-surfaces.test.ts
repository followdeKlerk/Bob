import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
import {defineExtension,defineTask,defineTool} from '@earendil-works/pi-durable';
import {Type} from '@earendil-works/pi-ai';
import {Interactive} from '@bob-local/interactive';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {nestedSurfaceWraps} from '../src/nested-surfaces.js';
import {createMcpFixture} from './mcp-fixture.js';

test('nested visual and genuine MCP App retain display-only anchors, native scope and recorded open across reopen',{timeout:30000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bob-codemode-surfaces-')),state=new State(dir),models=createModels(),faux=fauxProvider({tokensPerSecond:1000000}),mcp=await createMcpFixture();models.setProvider(faux.provider);
 state.set('mcpConnections',[{id:'fixture',endpoint:'http://127.0.0.1:49160/mcp',enabled:true,allowedTools:['show','increment']}]);
 let rt=await openRuntime(state,models,mcp.transport);
 try{
  const c=await rt.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);
  const run=async(name:string,args:Record<string,unknown>)=>{
   faux.setResponses([fauxAssistantMessage([fauxToolCall(name,args)],{stopReason:'toolUse'}),fauxAssistantMessage('Fixture completed')]);
   await(await c.submit({type:'input',content:'Create the requested test surfaces'},ctx)).wait(ctx);await c.waitForIdle(ctx);
  };
  await run('codemode',{code:`await tools.render_visual({title:'Nested visual',html:'<p>Nested visual</p>'});await tools.mcp_app({serverId:'fixture',tool:'show',arguments:{}});throw Error('later script failure must not hide committed surfaces');`});
  let entries=(await c.entries({order:'ascending'},100,undefined,ctx)).items;
  const anchors=entries.filter(e=>e.kind==='bob.nested-surface');assert.equal(anchors.length,2);
  const modelResult=entries.flatMap(e=>e.model??[]).find(m=>m.role==='toolResult'&&m.toolName==='codemode')!;assert.equal((modelResult as any).isError,true);
  const surfaces=await rt.interactive.list(rt.harness,c);assert.equal(surfaces.length,2);
  for(const entry of anchors){
   assert.equal(entry.model,undefined,'display receipt must not inject another model tool result');
   assert.deepEqual(Object.keys(entry.data!).sort(),['appId','parentToolCallId','toolName']);
   assert.equal(entry.data!.parentToolCallId,(modelResult as any).toolCallId);
   assert.ok(surfaces.some(surface=>surface.id===entry.data!.appId));
  }
  assert.deepEqual(anchors.map(e=>e.data!.toolName),['render_visual','mcp_app']);
  await run('render_visual',{title:'Direct visual',html:'<p>Direct still works</p>'});
  await run('codemode',{code:`await tools.mcp_app({serverId:'fixture',tool:'not-allowlisted'});`});
  entries=(await c.entries({order:'ascending'},100,undefined,ctx)).items;
  assert.equal(entries.filter(e=>e.kind==='bob.nested-surface').length,2,'no anchor for direct or failed calls');
  const device=state.pair(state.invite().token,'Surface fixture').deviceId,other=await rt.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
  for(const surface of surfaces){
   assert.ok((await rt.interactive.open(rt.harness,c,surface.id,device)).html.includes(surface.kind==='visual'?'Nested visual':'Real MCP App test'));
   await assert.rejects(()=>rt.interactive.open(rt.harness,other,surface.id,device),/not found/i);
  }
  assert.equal(mcp.counter,0,'opening never calls the MCP action');
  await rt.close();rt=await openRuntime(state,models,mcp.transport);
  const restored=(await rt.harness.conversation(c.id,ctx))!;
  assert.deepEqual((await restored.entries({order:'ascending'},100,undefined,ctx)).items.filter(e=>e.kind==='bob.nested-surface'),anchors);
  assert.equal((await rt.interactive.list(rt.harness,restored)).length,3);
  assert.equal(mcp.counter,0);
 }finally{await rt.close();state.close();await mcp.close();rmSync(dir,{recursive:true,force:true});}
});

test('surface publication receipt is atomic/idempotent and ignores absent, wrong-kind or cross-chat app IDs',{timeout:20000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bob-codemode-surface-receipt-')),state=new State(dir),rt=await openRuntime(state,undefined,undefined,{resume:false});
 try{
  const c=await rt.harness.createConversation({ownership:{kind:'ownerless'}},ctx),other=await rt.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
  const task=defineTask<null,{phase:'held'},null>({name:'codemode.surface.receipt-fixture',version:1,initial:()=>({phase:'held'}),phases:{held:async()=>{throw Error('must remain paused');}}});
  const taskId=await c.commit(tx=>tx.createTask(task,null,{ownership:{kind:'conversation'}}),ctx);
  await c.commit(async tx=>{const doc=await tx.doc(Interactive,c.id);doc.apps.own={id:'own',kind:'visual',title:'Own',html:'<p>Own</p>',allowedTools:[]};doc.apps.wrong={id:'wrong',kind:'mcp',title:'Wrong kind',html:'<p>Wrong</p>',allowedTools:[]};},ctx);
  await other.commit(async tx=>{(await tx.doc(Interactive,other.id)).apps.foreign={id:'foreign',kind:'visual',title:'Foreign',html:'<p>Foreign</p>',allowedTools:[]};},ctx);
  let appId='foreign';
  const original=defineTool({name:'render_visual',description:'Receipt boundary only',parameters:Type.Object({}),execute:async()=>({output:[],details:{appId}})});
  const wrapper=nestedSurfaceWraps(defineExtension({name:'receipt-fixture',tools:[original]}))[0] as any;
  const wrapped=wrapper.wrap(original),api={taskId,conversationId:c.id,commit:c.commit.bind(c),getTask:async()=>({input:{kind:'nested',parentCallId:'native-parent-call'}})};
  for(const id of ['foreign','missing','wrong']){appId=id;await wrapped.execute({},api,ctx);}
  assert.equal((await c.entries({},100,undefined,ctx)).items.filter(e=>e.kind==='bob.nested-surface').length,0);
  appId='own';await wrapped.execute({},api,ctx);await wrapped.execute({},api,ctx);
  const anchors=(await c.entries({},100,undefined,ctx)).items.filter(e=>e.kind==='bob.nested-surface');
  assert.equal(anchors.length,1);assert.deepEqual(anchors[0].data,{appId:'own',parentToolCallId:'native-parent-call',toolName:'render_visual'});
 }finally{await rt.close();state.close();rmSync(dir,{recursive:true,force:true});}
});
