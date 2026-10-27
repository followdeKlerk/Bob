import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {chromium} from 'playwright';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {Interactive} from '../src/interactive.js';
import {createMcpFixture} from './mcp-fixture.js';

test('real MCP Apps handshake and tools: native Durable records, scoped capabilities, idempotency, sandbox', {timeout:90000},async()=>{
 const fixture=await createMcpFixture(),state=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-interactive-')));
 state.set('mcpConnections',[{id:'fixture',endpoint:'http://127.0.0.1:49160/mcp',enabled:true,allowedTools:['show','increment']}]);
 const models=createModels(),faux=fauxProvider();models.setProvider(faux.provider);
 faux.setResponses([
   fauxAssistantMessage([fauxToolCall('render_visual',{title:'Visual fixture',html:'<h1>Native visual fixture</h1><button onclick="this.textContent=\'Clicked\'">Act</button>'})],{stopReason:'toolUse'}),fauxAssistantMessage('DETERMINISTIC MODEL: visual created'),
   fauxAssistantMessage([fauxToolCall('mcp_app',{serverId:'fixture',tool:'show',arguments:{}})],{stopReason:'toolUse'}),fauxAssistantMessage('DETERMINISTIC MODEL: MCP resource created'),
 ]);
 const runtime=await openRuntime(state,models,fixture.transport);
 let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined,site:ReturnType<typeof createServer>|undefined;
 try {
   const chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);
   const other=await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
   for(const content of ['visual','MCP']){await chat.submit({type:'input',content},ctx);await chat.waitForIdle(ctx);}
   const list=await runtime.interactive.list(runtime.harness,chat);assert.equal(list.length,2);
   const visual=list.find(a=>a.kind==='visual')!,app=list.find(a=>a.kind==='mcp')!;
   assert.deepEqual(app.allowedTools,['increment']);assert.equal('html'in app,false);
   const device=state.pair(state.invite().token,'MCP action test').deviceId,opened=await runtime.interactive.open(runtime.harness,chat,app.id,device);
   const call={capability:opened.capability,requestId:randomUUID(),name:'increment',arguments:{amount:1}};
   await assert.rejects(runtime.interactive.call(runtime.harness,other,app.id,device,call),/scope mismatch/);
   await assert.rejects(runtime.interactive.call(runtime.harness,chat,app.id,randomUUID(),call),/scope mismatch/);
   await assert.rejects(runtime.interactive.call(runtime.harness,chat,app.id,device,{...call,name:'show'}),/not granted/);
   const v=await runtime.interactive.open(runtime.harness,chat,visual.id,device);
   await assert.rejects(runtime.interactive.call(runtime.harness,chat,visual.id,device,{...call,capability:v.capability}),/not granted/);
   const result=await runtime.interactive.call(runtime.harness,chat,app.id,device,call);assert.equal(fixture.counter,1);
   const operation=(await runtime.harness.snapshot(Interactive,chat.id,ctx))!.operations[`${device}:${call.requestId}`];
   assert.ok(operation.taskId);const nativeTask=await runtime.harness.getTask(operation.taskId,ctx);
   assert.equal(nativeTask?.kind,'bob.mcp-ui-action');assert.equal(nativeTask?.conversationId,chat.id);assert.equal(nativeTask?.background,false);assert.equal(nativeTask?.state.status,'terminal');assert.equal(nativeTask?.state.outcome?.status,'completed');
   assert.deepEqual(await runtime.interactive.call(runtime.harness,chat,app.id,device,call),result);assert.equal(fixture.counter,1);
   await assert.rejects(runtime.interactive.call(runtime.harness,chat,app.id,device,{...call,arguments:{amount:2}}),/another action/);
   const unknownId=randomUUID();await chat.commit(async tx=>{(await tx.doc(Interactive,chat.id)).operations[`${device}:${unknownId}`]={appId:app.id,tool:'increment',requestHash:createHash('sha256').update(JSON.stringify({amount:1})).digest('hex'),status:'started'};},ctx);
   await assert.rejects(runtime.interactive.call(runtime.harness,chat,app.id,device,{...call,requestId:unknownId}),/unknown; no automatic resend/);assert.equal(fixture.counter,1);
   const host=readFileSync('apps/mobile/android/app/src/main/assets/bob-host.js','utf8').replaceAll('</script','<\\/script');
   const payload={kind:opened.kind,title:opened.title,html:opened.html,input:opened.input,result:opened.result,allowedTools:opened.allowedTools};
   const html=`<!doctype html><div id="status"></div><div id="surface" style="height:600px"></div><script>${host}</script><script>window.BobNative={request:(raw,nonce)=>window.testNative(raw,nonce).then(value=>window.__bobReply(JSON.parse(raw).id,value))};window.startBobSurface(${JSON.stringify(payload).replaceAll('<','\\u003c')},'fixture-nonce')</script>`;
   site=createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end(html);});site.listen(0,'127.0.0.1');await once(site,'listening');
   browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true});const page=await browser.newPage();
   await page.exposeFunction('testNative',async(raw:string,nonce:string)=>{
     assert.equal(nonce,'fixture-nonce');const p=JSON.parse(raw);
     try{return {result:await runtime.interactive.call(runtime.harness,chat,app.id,device,{capability:opened.capability,requestId:p.id,...p.params})};}
     catch(error){return {error:String(error)};}
   });
   const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`http://127.0.0.1:${(site.address() as any).port}`);
   const frame=page.frameLocator('iframe');await frame.getByText('Official MCP Apps handshake connected').waitFor({timeout:15000});
   await frame.getByRole('button',{name:'Increase real MCP counter'}).click();
   await frame.getByText('MCP counter: 2',{exact:true}).waitFor({timeout:15000});assert.equal(fixture.counter,2);
   const child=page.frames().find(f=>f!==page.mainFrame())!;
   assert.deepEqual(await child.evaluate(()=>(window as any).fixtureIsolation),{parentBlocked:true,storageBlocked:true,networkBlocked:true});
   assert.equal(errors.length,0,errors.join('\n'));
   await page.screenshot({path:'docs/mcp-real-browser.png'});
   runtime.interactive.close(opened.capability,device);
   await assert.rejects(runtime.interactive.call(runtime.harness,chat,app.id,device,{...call,requestId:randomUUID()}),/expired/);
   assert.equal(fixture.counter,2);
   const renewed=await runtime.interactive.open(runtime.harness,chat,app.id,device);
   state.set('mcpConnections',[{id:'fixture',endpoint:'http://127.0.0.1:49161/mcp',enabled:true,allowedTools:['show','increment']}]);
   await assert.rejects(runtime.interactive.call(runtime.harness,chat,app.id,device,{...call,capability:renewed.capability,requestId:randomUUID()}),/endpoint changed/);
   assert.equal(fixture.counter,2);
   state.set('mcpConnections',[{id:'fixture',endpoint:'http://127.0.0.1:49160/mcp',enabled:true,allowedTools:['show','increment']}]);
   const held=fixture.holdNextIncrement(),stoppedCall={...call,capability:renewed.capability,requestId:randomUUID()};
   const stopping=runtime.interactive.call(runtime.harness,chat,app.id,device,stoppedCall);
   const rejected=assert.rejects(stopping,/no automatic resend/);
   try {
     await held.started;
     assert.ok((await runtime.harness.inspect(ctx)).tasks.some(t=>t.record.conversationId===chat.id&&t.record.kind==='bob.mcp-ui-action'));
     await chat.abort(ctx);await rejected;
     const stopped=(await runtime.harness.snapshot(Interactive,chat.id,ctx))!.operations[`${device}:${stoppedCall.requestId}`];
     assert.equal(stopped.status,'unknown');assert.equal((await runtime.harness.getTask(stopped.taskId!,ctx))!.state.outcome?.status,'aborted');
     await assert.rejects(runtime.interactive.call(runtime.harness,chat,app.id,device,stoppedCall),/no automatic resend/);
     assert.equal(fixture.counter,2);
   }finally{held.release();}
 } finally {await browser?.close();site?.close();await runtime.close();await fixture.close();state.close();}
});
