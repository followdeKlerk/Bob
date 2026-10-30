import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createModels} from '@earendil-works/pi-ai/models';
import {Type} from '@earendil-works/pi-ai';
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
import {AgentDoc,defineExtension,defineTool,type Conversation} from '@earendil-works/pi-durable';
import {CodemodeStoreDoc,createCodemodeExtension} from '@earendil-works/pi-durable/codemode';
import {CodemodeSandbox} from '@earendil-works/pi-codemode';
import {CodingTools} from '@bob-local/coding';
import {State} from '../src/state.js';
import {openRuntime,ctx,type Runtime} from '../src/runtime.js';
import {Notes} from '../src/notes.js';
import {Subagents} from '../src/subagents.js';
import {DelegationBudget,registerDelegationOwner} from '../src/delegation-budget.js';
import {saveDelegationBehavior} from '../src/delegation-behavior.js';
import {saveDelegationConfig} from '../src/delegation-config.js';

const call=(name:string,args:Record<string,unknown>)=>fauxAssistantMessage([fauxToolCall(name,args)],{stopReason:'toolUse'});
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'bob-codemode-')),state=new State(dir),models=createModels();
 const faux=fauxProvider({tokensPerSecond:1000000});models.setProvider(faux.provider);state.set('cwd',dir);
 return {dir,state,models,faux,close(){state.close();rmSync(dir,{recursive:true,force:true});}};
}
async function chat(rt:Runtime){return rt.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);}
async function results(c:Conversation){return (await c.entries({order:'ascending'},200,undefined,ctx)).items.flatMap(e=>e.model??[]).filter(m=>m.role==='toolResult');}
async function execute(f:ReturnType<typeof fixture>,c:Conversation,code:string){
 f.faux.setResponses([call('codemode',{code}),fauxAssistantMessage('Finished')]);
 await (await c.submit({type:'input',content:'Execute the requested test script',requestId:randomUUID()},ctx)).wait(ctx);
 await c.waitForIdle(ctx);
 const result=(await results(c)).findLast(m=>m.toolName==='codemode');assert.ok(result);return result;
}
const text=(result:{content:readonly any[]})=>result.content.filter(b=>b.type==='text').map(b=>b.text).join('\n');

test('built-in prompt prefers suitable code mode workflows only when the tool is offered',{timeout:20000},async()=>{
 const f=fixture(),rt=await openRuntime(f.state,f.models),seen:string[]=[];
 try{
  f.faux.setResponses(Array.from({length:2},()=>request=>{
   seen.push(JSON.stringify(request.messages.filter(message=>message.role==='system')));
   return fauxAssistantMessage('Prompt verified');
  }));
  const enabled=await chat(rt),hidden=await chat(rt);
  await hidden.configure({modelTools:[rt.modules.coding.tools!.find(tool=>tool.name==='read')!]},ctx);
  for(const c of [enabled,hidden]){
   await(await c.submit({type:'input',content:'Inspect prompt fixture'},ctx)).wait(ctx);
   await c.waitForIdle(ctx);
  }
  assert.match(seen[0],/Prefer codemode by default for suitable multi-step tool workflows/);
  assert.match(seen[0],/do not wait for the owner to request it/);
  assert.match(seen[0],/Parallelize only independent operations/);
  assert.match(seen[0],/Use direct tools when simpler/);
  assert.match(seen[0],/existing consent and delegation rules still apply/);
  assert.doesNotMatch(seen[1],/Prefer codemode by default/);
 }finally{await rt.close();f.close();}
});

test('codemode is optional alongside direct tools; real native write/edit/read/bash and Notes mutation execute',{timeout:20000},async()=>{
 const f=fixture(),rt=await openRuntime(f.state,f.models);
 try{
  const c=await chat(rt),agent=await c.agent(ctx);
  for(const name of ['read','write','edit','bash','codemode','notes','subagent','browser'])assert.ok(agent.tools.some(t=>t.name===name),name);
  assert.equal(rt.modules.coding.name,CodingTools.name);
  const sandbox=new CodemodeSandbox();
  try{
   const official=createCodemodeExtension({sandbox});
   assert.deepEqual(rt.modules.coding.tasks,[...CodingTools.tasks??[],...official.tasks??[]]);
   assert.ok(rt.modules.coding.sections!.some(s=>s.key==='codemode'));
   assert.ok(rt.modules.coding.tools!.some(t=>t.name==='pi.codemode.models.generateImages'));
  }finally{await sandbox.close();}
  const expected=agent.callable.map(t=>t.name).filter(n=>!n.startsWith('pi.codemode.')).sort();
  const result=await execute(f,c,`
   text(ALL_TOOLS);
   await tools.write({path:'native.txt',content:'before'});
   await tools.edit({path:'native.txt',edits:[{oldText:'before',newText:'after'}]});
   text(await tools.read({path:'native.txt'}));
   const shell=await tools.bash({command:'printf shell-output; exit 7'});text({exitCode:shell.exitCode,output:shell.output});
   const raw=await tools.notes({action:'create',title:'Codemode native note',body:'Owner-requested test mutation'});
   text({rawType:typeof raw,persisted:JSON.parse(raw).persisted});
   store('enabled',ALL_TOOLS.map(tool=>tool.name));
  `);
  assert.equal(result.isError,false,text(result));
  assert.equal(readFileSync(join(f.dir,'native.txt'),'utf8'),'after');
  assert.match(text(result),/"exitCode":7/);assert.match(text(result),/"rawType":"string","persisted":true/);
  assert.deepEqual([...(await rt.harness.snapshot(CodemodeStoreDoc,c.id,ctx))!.values.enabled as string[]].sort(),expected);
  assert.equal(Object.values((await rt.harness.snapshot(Notes,rt.library.id,ctx))!.notes).filter(n=>n.title==='Codemode native note').length,1);
  assert.deepEqual((result.details as any).calls.map((r:any)=>[r.name,r.status]),[['write','ok'],['edit','ok'],['read','ok'],['bash','error'],['notes','ok']]);
  // Script intermediates are native nested calls, not additional model-visible result messages.
  assert.deepEqual((await results(c)).map(r=>r.toolName),['codemode']);
 }finally{await rt.close();f.close();}
});

test('existing coding selections gain codemode without rewriting tools/modelTools; exact tools scope also limits discovery and model helpers',{timeout:20000},async()=>{
 const f=fixture();let rt=await openRuntime(f.state,f.models);
 try{
  const legacy=await chat(rt),scoped=await chat(rt),hidden=await chat(rt),noCoding=await chat(rt);
  await noCoding.configure({extensions:[rt.modules.resources]},ctx);
  assert.equal((await noCoding.agent(ctx)).tools.some(t=>t.name==='codemode'),false);
  const tools=rt.modules.coding.tools!,read=tools.find(t=>t.name==='read')!,code=tools.find(t=>t.name==='codemode')!;
  await legacy.configure({extensions:[CodingTools]},ctx);
  await scoped.configure({extensions:[CodingTools],tools:[read,code],modelTools:[code]},ctx);
  await hidden.configure({extensions:[CodingTools],tools:[read],modelTools:[read]},ctx);
  const before=await rt.harness.snapshot(AgentDoc,scoped.id,ctx);
  await rt.close();rt=await openRuntime(f.state,f.models);
  const restored=(await rt.harness.conversation(scoped.id,ctx))!;
  assert.deepEqual(await rt.harness.snapshot(AgentDoc,scoped.id,ctx),before);
  assert.ok((await (await rt.harness.conversation(legacy.id,ctx))!.agent(ctx)).tools.some(t=>t.name==='codemode'));
  assert.deepEqual((await (await rt.harness.conversation(hidden.id,ctx))!.agent(ctx)).tools.map(t=>t.name),['read']);
  assert.deepEqual((await restored.agent(ctx)).tools.map(t=>t.name),['codemode']);
  assert.deepEqual((await restored.agent(ctx)).callable.map(t=>t.name),['read']);
  writeFileSync(join(f.dir,'allowed.txt'),'scoped read');
  const result=await execute(f,restored,`
   text(ALL_TOOLS);text(await tools.read({path:'allowed.txt'}));
   text({write:await describeTool('write'),recursive:await describeTool('codemode')});
   try {await tools.write({path:'forbidden.txt',content:'no'});} catch(e) {text('write refused');}
   try {await models.generateImages({provider:'faux',id:'faux-1'},{input:[{type:'text',text:'no'}]});} catch(e) {text('model helper refused: '+e.message);}
  `);
  assert.equal(result.isError,false,text(result));assert.match(text(result),/scoped read/);assert.match(text(result),/write refused/);assert.match(text(result),/model helper refused/);
  assert.equal(existsSync(join(f.dir,'forbidden.txt')),false);
  assert.ok((result.details as any).calls.some((r:any)=>r.name==='models.generateImages'&&r.status==='error'));
 }finally{await rt.close();f.close();}
});

test('official response mechanics: nested image read is text-only, explicit image output reaches model, and failures remain errors',{timeout:20000},async()=>{
 const f=fixture(),rt=await openRuntime(f.state,f.models);
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB1sAAAAASUVORK5CYII=';
 try{
  const c=await chat(rt);writeFileSync(join(f.dir,'pixel.png'),Buffer.from(png,'base64'));
  const result=await execute(f,c,`text({nestedImage:await tools.read({path:'pixel.png'})});image({type:'image',mimeType:'image/png',data:${JSON.stringify(png)}});`);
  assert.equal(result.isError,false,text(result));assert.match(text(result),/"nestedImage":""/);
  assert.ok(result.content.some(b=>b.type==='image'&&b.data===png));
  const paths=text(result).match(/\/[^\s\]]+\.png/g)??[];
  assert.ok(paths.length);for(const path of paths){assert.deepEqual(readFileSync(path),Buffer.from(png,'base64'));rmSync(join(path,'..'),{recursive:true,force:true});}
  const failure=await execute(f,c,`await tools.read({path:'does-not-exist'});text('unreachable');`);
  assert.equal(failure.isError,true);assert.doesNotMatch(text(failure),/unreachable/);
  assert.equal((failure.details as any).calls[0].status,'error');
 }finally{await rt.close();f.close();}
});

test('runtime startup failure and cleanup failure both close sandbox and release isolated owner',{timeout:20000},async(t)=>{
 const f=fixture(),original=CodemodeSandbox.prototype.close;let closed=0;
 t.mock.method(CodemodeSandbox.prototype,'close',async function(this:CodemodeSandbox){closed++;return original.call(this);});
 try{
  f.state.set('modules',{installed:['unknown'],defaults:[]});
  await assert.rejects(()=>openRuntime(f.state,f.models),/Unknown installed module/);assert.equal(closed,1);
  f.state.set('modules',{installed:['coding'],defaults:['coding']});
  const rt=await openRuntime(f.state,f.models);
  rt.interactive.dispose=()=>{throw Error('fixture cleanup failure');};
  await assert.rejects(()=>rt.close(),/Runtime cleanup failed/);assert.equal(closed,2);
  const reopened=await openRuntime(f.state,f.models);await reopened.close();await reopened.close();assert.equal(closed,3);
 }finally{f.close();}
});

function gateExtension(onEnter:()=>void,wait:boolean){
 return defineExtension({name:'codemode-test-gate',tools:[defineTool({name:'codemode_test_gate',description:'Deterministic recovery boundary',parameters:Type.Object({}),replay:'safe',execute:async(_args,_api,context)=>{
  onEnter();
  if(wait)await new Promise<void>((_resolve,reject)=>{const stop=()=>reject(context.abortSignal?.reason??Error('aborted'));if(context.abortSignal?.aborted)stop();else context.abortSignal?.addEventListener('abort',stop,{once:true});});
  return {output:[{type:'text' as const,text:'gate finished'}]};
 }})]});
}

test('shutdown/reopen replays official codemode journal without repeating a finished native side effect',{timeout:25000},async()=>{
 const f=fixture();let rt=await openRuntime(f.state,f.models);const entered=Promise.withResolvers<void>();
 try{
  const c=await chat(rt),gate=gateExtension(()=>entered.resolve(),true);rt.registry.install(gate);
  await c.configure({extensions:[rt.modules.coding,rt.modules.interactive,gate]},ctx);
  f.faux.setResponses([call('codemode',{code:`await tools.bash({command:'printf x >> once.txt'});await tools.render_visual({title:'Replay visual',html:'<p>Once</p>'});await tools.codemode_test_gate({});store('recovered',true);text('recovered');`}),fauxAssistantMessage('Recovered')]);
  const submission=await c.submit({type:'input',content:'Recovery fixture',requestId:'codemode-recovery'},ctx);
  await entered.promise;assert.equal(readFileSync(join(f.dir,'once.txt'),'utf8'),'x');
  await rt.close();
  rt=await openRuntime(f.state,f.models,undefined,{resume:false});rt.registry.install(gateExtension(()=>{},false));rt.harness.resume();
  await (await rt.harness.submission(submission.id,ctx))!.wait(ctx);await rt.harness.waitForIdle(ctx);
  assert.equal(readFileSync(join(f.dir,'once.txt'),'utf8'),'x');
  assert.equal((await rt.harness.snapshot(CodemodeStoreDoc,c.id,ctx))!.values.recovered,true);
  const recovered=(await rt.harness.conversation(c.id,ctx))!,result=(await results(recovered)).find(r=>r.toolName==='codemode')!;
  assert.equal(result.isError,false,text(result));assert.match(text(result),/recovered/);
  assert.equal((await recovered.entries({},100,undefined,ctx)).items.filter(e=>e.kind==='bob.nested-surface').length,1);
  assert.equal((await rt.interactive.list(rt.harness,recovered)).length,1);
 }finally{await rt.close();f.close();}
});

test('native Stop aborts sandbox and nested calls without admitting following writes',{timeout:20000},async()=>{
 const f=fixture(),rt=await openRuntime(f.state,f.models),entered=Promise.withResolvers<void>();
 try{
  const c=await chat(rt),gate=gateExtension(()=>entered.resolve(),true);rt.registry.install(gate);await c.configure({extensions:[rt.modules.coding,gate]},ctx);
  f.faux.setResponses([call('codemode',{code:`await tools.codemode_test_gate({});await tools.write({path:'after-stop',content:'forbidden'});`}),fauxAssistantMessage('Stopped')]);
  await c.submit({type:'input',content:'Cancellation fixture'},ctx);await entered.promise;await c.abort(ctx);await c.waitForIdle(ctx);
  assert.equal(existsSync(join(f.dir,'after-stop')),false);assert.equal((await rt.harness.inspect(ctx)).tasks.length,0);
  const result=await execute(f,c,`text('sandbox remains usable');`);assert.equal(result.isError,false,text(result));
 }finally{await rt.close();f.close();}
});

test('nested subagent uses unchanged owner permission and dispatch hooks; no delegation grant is synthesized',{timeout:25000},async()=>{
 const f=fixture();saveDelegationBehavior(f.state,{enabled:true,maxActive:2,maxDispatches:4});
 const rt=await openRuntime(f.state,f.models);
 try{
  const c=await chat(rt);
  const denied=await execute(f,c,`await tools.subagent({action:'spawn',name:'denied',message:'Synthetic test helper'});`);
  assert.equal(denied.isError,true);assert.deepEqual((await rt.harness.snapshot(Subagents,c.id,ctx))?.agents??{},{});
  const clientRequestId=randomUUID(),deviceId='codemode-fixture',requestId=`device:${deviceId}:${clientRequestId}`;
  await registerDelegationOwner(f.state,c,{requestId,clientRequestId,deviceId,allow:true});
  f.faux.setResponses([call('codemode',{code:`text(await tools.subagent({action:'spawn',name:'allowed',message:'Synthetic test helper'}));`}),...Array.from({length:10},()=>fauxAssistantMessage('Synthetic fixture complete'))]);
  await (await c.submit({type:'input',content:'Explicitly start a synthetic helper',requestId,entry:{kind:'bob.user',data:{text:'Explicitly start a synthetic helper',requestId:clientRequestId,allowSubagents:true}}},ctx)).wait(ctx);
  await rt.harness.waitForIdle(ctx);
  assert.ok((await rt.harness.snapshot(Subagents,c.id,ctx))?.agents.allowed);
  assert.equal(Object.keys((await rt.harness.snapshot(DelegationBudget,c.id,ctx))!.dispatches).length,1);
  assert.equal((await results(c)).findLast(r=>r.toolName==='codemode')!.isError,false);
 }finally{await rt.close();f.close();}
});

test('profile-scoped child does not acquire codemode outside its captured native tool selection',{timeout:25000},async()=>{
 const f=fixture(),childProvider=fauxProvider({provider:'codemode-child',models:[{id:'child'}],tokensPerSecond:1000000});f.models.setProvider(childProvider.provider);
 await saveDelegationConfig(f.state,f.models,{
  mode:'profile_routes',profileRoutes:{profiles:[{name:'reader',description:'Scoped fixture'}],default:'reader'},
  profiles:[{name:'reader',route:{provider:'codemode-child',model:'child',credential:{kind:'provider',provider:'codemode-child'}},instructions:'Read the fixture',skills:[],cwd:f.dir,modules:['coding']}],
 });
 saveDelegationBehavior(f.state,{enabled:true,profileTools:{reader:['read']}});
 let rt=await openRuntime(f.state,f.models);
 try{
  writeFileSync(join(f.dir,'scope.txt'),'profile evidence');
  const c=await chat(rt),clientRequestId=randomUUID(),deviceId='scope-fixture',requestId=`device:${deviceId}:${clientRequestId}`;
  await registerDelegationOwner(f.state,c,{requestId,clientRequestId,deviceId,allow:true});
  childProvider.setResponses([call('codemode',{code:`text(await tools.read({path:'scope.txt'}));text(ALL_TOOLS.map(t=>t.name));try {await tools.write({path:'escaped.txt',content:'no'});} catch(e) {text('write refused');}`}),fauxAssistantMessage('Scoped evidence done')]);
  f.faux.setResponses([call('subagent',{action:'spawn',name:'scoped-reader',message:'Read the fixture'}),...Array.from({length:10},()=>fauxAssistantMessage('Fixture summary'))]);
  await(await c.submit({type:'input',requestId,content:'Start the scoped reader',entry:{kind:'bob.user',data:{text:'Start the scoped reader',requestId:clientRequestId,allowSubagents:true}}},ctx)).wait(ctx);await rt.harness.waitForIdle(ctx);
  const childId=(await rt.harness.snapshot(Subagents,c.id,ctx))!.agents['scoped-reader'].conversationId,child=(await rt.harness.conversation(childId,ctx))!;
  await child.waitForIdle(ctx);
  assert.deepEqual((await child.agent(ctx)).tools.map(t=>t.name),['read']);
  assert.deepEqual((await child.agent(ctx)).callable.map(t=>t.name),['read']);
  const result=(await results(child)).find(r=>r.toolName==='codemode')!;assert.ok(result);assert.equal(result.isError,true,text(result));
  assert.equal(existsSync(join(f.dir,'escaped.txt')),false);
  await rt.close();rt=await openRuntime(f.state,f.models);
  assert.deepEqual((await (await rt.harness.conversation(childId,ctx))!.agent(ctx)).callable.map(t=>t.name),['read']);
 }finally{await rt.close();f.close();}
});
