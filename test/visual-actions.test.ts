import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
import {Harness,createRegistry,defineExtension,defineTool} from '@earendil-works/pi-durable';
import {openNodeSqliteStorage} from '@earendil-works/pi-durable/storage/sqlite/node';
import {NodeExecutionEnv} from '@earendil-works/pi-durable/env/node';
import {createInteractive as legacyInteractive,Interactive} from '@bob-local/interactive';
import {checkedVisualActions,checkedVisualUrl,VisualActions,withVisualActions,readVisualActions} from '../src/visual-actions.js';
import {visualDataTool} from '../src/visual-data.js';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {serve} from '../src/server.js';
import {createInteractive} from '../src/interactive.js';
import {createCodingWithCodemode} from '../src/codemode.js';

const navigate={id:'navigate',label:'Navigate now',type:'navigate' as const,latitude:51.3441012,longitude:19.5820604,destinationName:'AZÖA Döner Kebab',travelMode:'walking' as const};
const website={id:'website',label:'Restaurant website',type:'open_url' as const,url:'https://example.com/menu?language=en'};

test('visual action validation is bounded, exact and rejects unsafe schemes, labels and coordinates',()=>{
 assert.deepEqual(checkedVisualActions([navigate,website]),[navigate,website]);
 for(const line of readFileSync('test/fixtures/visual-action-urls.tsv','utf8').trim().split('\n')){const [input,normalized]=line.split('\t');assert.equal(checkedVisualUrl(input),normalized);}
 assert.equal(checkedVisualUrl('HTTPS://EXAMPLE.COM/menu'),'https://example.com/menu');
 assert.equal(checkedVisualUrl('https://bücher.example/'),'https://xn--bcher-kva.example/');
 assert.equal(checkedVisualUrl('https://[::1]:8443/'),'https://[::1]:8443/');
 assert.equal(checkedVisualUrl('https://example.com./'),'https://example.com./');
 for(const url of ['https://exa_mple.com/','https://-example.com/','https://example..com/','https://a.1a/','https://a.123a/'])assert.throws(()=>checkedVisualUrl(url),/valid DNS/);
 for(const url of ['https://example.com/%','https://example.com/%GG'])assert.throws(()=>checkedVisualUrl(url),/percent escapes/);
 assert.equal(checkedVisualUrl('https://example.com/[x]|^?q={x}`#a|b'),'https://example.com/%5Bx%5D%7C%5E?q=%7Bx%7D%60#a%7Cb');
 assert.equal(checkedVisualUrl('https://example.com/%2F%23%26%25?q=%2F%23%26%25#%2F%23%26%25'),'https://example.com/%2F%23%26%25?q=%2F%23%26%25#%2F%23%26%25');
 for(const url of ['javascript:alert(1)','http://example.com','file:///tmp/x','intent://x#Intent;end','data:text/html,x','geo:0,0','https:example.com','//example.com','https://user:secret@example.com','https://example.com\\@evil.example','https://example.com\n','https://exa\tmple.com','https://example.com/\u202e','https://example.com:99999/','https://example.com/'+ 'a'.repeat(2048)])assert.throws(()=>checkedVisualActions([{...website,url}]),undefined,url);
 for(const actions of [null,{},[navigate,navigate],[navigate,website,{...website,id:'third'}],[{...navigate,type:'call_tool'}],[{...navigate,latitude:NaN}],[{...navigate,longitude:Infinity}],[{...navigate,latitude:90.1}],[{...navigate,longitude:-180.1}],[{...navigate,travelMode:'teleport'}],[{...navigate,label:' '}],[{...navigate,label:'Invisible\u202e'}],[{...navigate,label:'Invisible\u061c'}],[{...navigate,label:'a'.repeat(41)}],[{...navigate,id:'__proto__'}],[{...navigate,destinationName:'a'.repeat(101)}],[{...navigate,destinationName:'\nPlace'}],[{...website,credentials:'secret'}]])assert.throws(()=>checkedVisualActions(actions));
 assert.deepEqual(checkedVisualActions([]),[]);
 assert.doesNotThrow(()=>checkedVisualActions([{...navigate,latitude:-90,longitude:180}]));
});

test('registered render_visual persists native destinations only in scoped authenticated opens; nested cards still anchor',{timeout:40000},async()=>{
 const state=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-visual-actions-http-'))),models=createModels(),faux=fauxProvider({tokensPerSecond:100000});models.setProvider(faux.provider);
 const runtime=await openRuntime(state,models),app=await serve(state,{port:0,runtime}),paired=state.pair(state.invite().token,'Visual action fixture');
 const base=`http://127.0.0.1:${(app.server.address() as any).port}/v1`,headers={authorization:`Bearer ${paired.credential}`,'x-bob-backend':state.id,'content-type':'application/json'};
 try{
  const chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx),other=await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
  const run=async(name:string,args:unknown)=>{faux.setResponses([fauxAssistantMessage([fauxToolCall(name,args as any)],{stopReason:'toolUse'}),fauxAssistantMessage('Fixture complete')]);await(await chat.submit({type:'input',content:'Run the requested visual fixture'},ctx)).wait(ctx);};
  const html='<p>Restaurant card</p>',args={title:'Restaurant',html,presentation:'inline',actions:[navigate,website]};
  await run('render_visual',args);
  const [surface]=await runtime.interactive.list(runtime.harness,chat);assert.ok(surface);
  assert.equal('actions' in surface,false,'legacy strict summaries stay unchanged');
  const url=base+`/chats/${chat.id}/ui/${surface.id}`;
  assert.equal((await fetch(url+'/open',{method:'POST',body:'{}'})).status,401);
  assert.equal((await fetch(base+`/chats/${other.id}/ui/${surface.id}/open`,{headers,method:'POST',body:'{}'})).status,404);
  const opened=await(await fetch(url+'/open',{headers,method:'POST',body:'{}'})).json() as any;
  assert.equal(opened.kind,'visual');assert.equal(opened.html,html);assert.deepEqual(opened.actions,[navigate,website]);assert.deepEqual(opened.allowedTools,[]);
  const call=await fetch(url+'/call',{headers,method:'POST',body:JSON.stringify({capability:opened.capability,requestId:randomUUID(),name:'navigate',arguments:{}})});
  assert.equal(call.status,403,'visual actions are not granted backend tools');
  const dataApi={taskId:91001,conversationId:chat.id,snapshot:runtime.harness.snapshot.bind(runtime.harness),commit:chat.commit.bind(chat)};
  await visualDataTool.execute({action:'update',id:surface.id,expectedRevision:0,data:{actions:[{...website,url:'https://different.example/'}]}},dataApi as any,ctx);
  const reopened=await(await fetch(url+'/open',{headers,method:'POST',body:'{}'})).json() as any;
  assert.deepEqual(reopened.actions,opened.actions,'visual data cannot change action targets');
  assert.equal(reopened.html,html);
  await run('codemode',{code:`await tools.render_visual(${JSON.stringify({...args,title:'Nested action card'})});throw Error('Later failure must not hide the card');`});
  const anchors=(await chat.entries({},100,undefined,ctx)).items.filter(entry=>entry.kind==='bob.nested-surface');
  assert.equal(anchors.length,1);assert.equal(anchors[0].data?.toolName,'render_visual');
  assert.equal((await runtime.interactive.list(runtime.harness,chat)).length,2);
  assert.deepEqual(await readVisualActions(runtime.harness,chat,String(anchors[0].data?.appId)),[navigate,website]);
  await run('render_visual',{title:'Legacy',html:'<p>Still isolated</p>'});
  const legacy=(await runtime.interactive.list(runtime.harness,chat)).find(s=>s.title==='Legacy')!;
  const legacyOpen=await runtime.interactive.open(runtime.harness,chat,legacy.id,String(paired.deviceId??'fixture'));
  assert.deepEqual(legacyOpen.actions,[]);
  await run('render_visual',{...args,actions:[{...website,url:'intent://unsafe'}]});
  assert.equal((await runtime.interactive.list(runtime.harness,chat)).length,3,'validation cannot save a partial card');
  const last=(await chat.entries({order:'descending'},1,undefined,ctx)).items[0];
  const fork=await chat.fork(last.id,{ownership:{kind:'ownerless'}},ctx);
  assert.deepEqual(await readVisualActions(runtime.harness,fork,surface.id),[],'forks do not inherit action authority');
  assert.deepEqual((await runtime.harness.snapshot(VisualActions,fork.id,ctx))?.values??{},{});
 }finally{await app.close();state.close();}
});

test('action card record and immutable destinations commit atomically, replay safely and survive old/new runtime reopen',{timeout:40000},async()=>{
 const state=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-visual-actions-replay-')));let runtime=await openRuntime(state),closed=false;
 const chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
 const original=legacyInteractive(state).extension.tools!.find(tool=>tool.name==='render_visual')!,tool=withVisualActions(original);
 const call=async(taskId:number,args:any)=>{const current=(await runtime.harness.conversation(chat.id,ctx))!;return tool.execute(args,{taskId,conversationId:chat.id,snapshot:runtime.harness.snapshot.bind(runtime.harness),commit:current.commit.bind(current)} as any,ctx);};
 const args={title:'Action card',html:'<p>Immutable HTML</p>',presentation:'inline' as const,actions:[navigate,website]};
 try{
  const first=await call(10001,args),id=String(first.details?.appId);assert.match(id,/^[a-f0-9-]{36}$/);
  assert.deepEqual(await call(10001,args),first);
  await assert.rejects(()=>call(10001,{...args,actions:[{...navigate,latitude:52}]}),/identity conflict/);
  await assert.rejects(()=>call(10001,{...args,actions:[]}),/identity conflict/);
  assert.equal((await runtime.interactive.list(runtime.harness,chat)).length,1);
  const record=(await runtime.harness.snapshot(Interactive,chat.id,ctx))!.apps[id];
  assert.equal('actions' in record,false,'legacy Interactive document shape stays unchanged');
  const actions=(await runtime.harness.snapshot(VisualActions,chat.id,ctx))!;
  assert.deepEqual(actions.values[id],[navigate,website]);assert.equal(actions.receipts['10001'].id,id);
  await assert.rejects(()=>call(10002,{...args,actions:[{...navigate,label:'\u202eSpoof'}]}));
  assert.equal((await runtime.interactive.list(runtime.harness,chat)).length,1);
  const before=await runtime.harness.snapshot(Interactive,chat.id,ctx),history=(await chat.entries({},100,undefined,ctx)).items;
  await assert.rejects(()=>tool.execute({...args,title:'Abort before commit'},{taskId:10003,conversationId:chat.id,commit:(fn:any)=>chat.commit(async tx=>{await fn(tx);throw Error('Injected transaction abort');},ctx)} as any,ctx),/Injected transaction abort/);
  assert.deepEqual(await runtime.harness.snapshot(Interactive,chat.id,ctx),before,'failed commit leaves no orphan HTML');
  assert.deepEqual(await runtime.harness.snapshot(VisualActions,chat.id,ctx),actions,'failed commit leaves no targets or receipt');
  await runtime.close();closed=true;
  const oldInteractive=legacyInteractive(state),registry=createRegistry();registry.install(oldInteractive.extension);
  const old=await Harness.open(await openNodeSqliteStorage(join(state.dir,'durable.sqlite')),{models:createModels(),registry,env:()=>new NodeExecutionEnv({cwd:process.cwd()})},ctx);
  try{
   assert.deepEqual(await old.snapshot(Interactive,chat.id,ctx),before);
   const oldChat=(await old.conversation(chat.id,ctx))!;assert.deepEqual((await oldChat.entries({},100,undefined,ctx)).items,history);
   const oldOpened=await oldInteractive.open(old,oldChat,id,'legacy-device');assert.equal(oldOpened.html,args.html);assert.equal('actions' in oldOpened,false);
  }finally{await old.close(ctx);}
  runtime=await openRuntime(state);closed=false;
  assert.deepEqual(await call(10001,args),first);
  const current=(await runtime.harness.conversation(chat.id,ctx))!;
  assert.deepEqual(await readVisualActions(runtime.harness,current,id),[navigate,website]);
  assert.deepEqual((await runtime.harness.snapshot(VisualActions,chat.id,ctx))!,actions);
  const other=await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
  assert.deepEqual(await readVisualActions(runtime.harness,other,id),[]);
 }finally{if(!closed)await runtime.close();state.close();}
});

for(const variant of ['direct-actions','nested-actions','nested-no-actions'] as const){
 test(`native ToolTask recovery after save before result/anchor: ${variant}`,{timeout:25000},async()=>{
  const state=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-visual-actions-recovery-'))),models=createModels(),faux=fauxProvider({tokensPerSecond:1000000});models.setProvider(faux.provider);
  const entered=Promise.withResolvers<void>();let enteredCount=0;
  const open=async(hold:boolean)=>{
   const coding=await createCodingWithCodemode(),interactive=createInteractive(state),registry=createRegistry();
   const extension=defineExtension({...interactive.extension,tools:interactive.extension.tools!.map(tool=>tool.name!=='render_visual'?tool:defineTool({...tool,execute:async(args,api,context)=>{
    const result=await tool.execute(args,api,context);enteredCount++;entered.resolve();
    // This is below the real nested-surface wrapper: save has committed, but
    // neither the native tool result nor the nested anchor has been published.
    if(hold)await new Promise<void>((_resolve,reject)=>{const stop=()=>reject(context.abortSignal?.reason??Error('closed'));if(context.abortSignal?.aborted)stop();else context.abortSignal?.addEventListener('abort',stop,{once:true});});
    return result;
   }}))});
   registry.install(coding.extension);registry.install(extension);
   const harness=await Harness.open(await openNodeSqliteStorage(join(state.dir,'durable.sqlite')),{models,registry,env:()=>new NodeExecutionEnv({cwd:state.dir})},ctx);
   return {harness,coding,interactive,extension,async close(){await harness.close(ctx);await coding.close();interactive.dispose();}};
  };
  let fixture=await open(true),closed=false;
  try{
   const chat=await fixture.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);
   await chat.configure({extensions:[fixture.coding.extension,fixture.extension]},ctx);
   const args={title:'Recovery card',html:'<p>One card</p>',...(variant==='nested-no-actions'?{}:{actions:[navigate]})};
   const toolName=variant==='direct-actions'?'render_visual':'codemode',input=toolName==='render_visual'?args:{code:`text(await tools.render_visual(${JSON.stringify(args)}));`};
   faux.setResponses([fauxAssistantMessage([fauxToolCall(toolName,input as any)],{stopReason:'toolUse'}),fauxAssistantMessage('Recovered')]);
   const submission=await chat.submit({type:'input',content:'Create the recovery fixture'},ctx);
   await entered.promise;
   const [saved]=await fixture.interactive.list(fixture.harness,chat);assert.ok(saved);
   assert.equal((await chat.entries({},100,undefined,ctx)).items.filter(entry=>entry.kind==='bob.nested-surface').length,0);
   assert.equal(fixture.extension.tools!.find(tool=>tool.name==='render_visual')!.replay,'safe');
   await fixture.close();closed=true;fixture=await open(false);closed=false;
   await(await fixture.harness.submission(submission.id,ctx))!.wait(ctx);await fixture.harness.waitForIdle(ctx);
   const restored=(await fixture.harness.conversation(chat.id,ctx))!,surfaces=await fixture.interactive.list(fixture.harness,restored);
   assert.equal(enteredCount,2,'Durable reran the interrupted ToolTask');
   assert.equal(surfaces.length,1);assert.equal(surfaces[0].id,saved.id,'recovery reuses exactly the committed card');
   assert.deepEqual(await readVisualActions(fixture.harness,restored,saved.id),variant==='nested-no-actions'?[]:[navigate]);
   const entries=(await restored.entries({},100,undefined,ctx)).items,anchors=entries.filter(entry=>entry.kind==='bob.nested-surface');
   assert.equal(anchors.length,variant==='direct-actions'?0:1);
   if(anchors.length)assert.equal(anchors[0].data?.appId,saved.id);
   const result=entries.flatMap(entry=>entry.model??[]).find(message=>message.role==='toolResult'&&message.toolName===toolName) as any;
   assert.ok(result);assert.equal(result.isError,false,JSON.stringify(result));
   assert.ok(JSON.stringify(result).includes(saved.id));
  }finally{if(!closed)await fixture.close();state.close();}
 });
}
