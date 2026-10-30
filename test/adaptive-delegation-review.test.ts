import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createModels} from '@earendil-works/pi-ai/models';
import {Type} from '@earendil-works/pi-ai';
import {fauxProvider,fauxAssistantMessage,fauxToolCall,type FauxResponseFactory} from '@earendil-works/pi-ai/providers/faux';
import {defineExtension,defineTool,wrapTool,AgentDoc,LiveDoc,type Conversation,type Tx,type ToolExecutionApi} from '@earendil-works/pi-durable';
import {State} from '../src/state.js';
import {openRuntime,ctx,type Runtime} from '../src/runtime.js';
import {serve} from '../src/server.js';
import {changeModule} from '../src/modules.js';
import {Subagents} from '../src/subagents.js';
import {saveDelegationConfig,readDelegationConfig} from '../src/delegation-config.js';
import {DelegationChild} from '../src/delegation.js';
import {DelegationChildTools,DelegationToolScopes,DelegationToolProvisioning,saveDelegationBehavior} from '../src/delegation-behavior.js';
import {DelegationBudget,registerDelegationOwner,revokeDelegation} from '../src/delegation-budget.js';

// Independent synthetic providers and temporary native state only. No live credentials,
// external inference, serving backend, application files or native task definitions change.
const call=(name:string,args:Record<string,unknown>)=>fauxAssistantMessage([fauxToolCall(name,args)],{stopReason:'toolUse'});
const spawn=(name:string)=>({action:'spawn',name,message:'Bounded evidence task'});
const command=(args:Record<string,unknown>)=>'review-dispatch:'+JSON.stringify(args);
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'bob-adaptive-review-')),state=new State(dir),models=createModels();
 const parent=fauxProvider({provider:'adaptive-review-parent',models:[{id:'parent'}],tokensPerSecond:1000000});
 const child=fauxProvider({provider:'adaptive-review-child',models:[{id:'child'}],tokensPerSecond:1000000});models.setProvider(parent.provider);models.setProvider(child.provider);
 let parentFlow:FauxResponseFactory|undefined;
 parent.setResponses(Array.from({length:100},()=>async(...args:Parameters<FauxResponseFactory>)=>{
  if(parentFlow)return parentFlow(...args);
  const last=args[0].messages.findLast(message=>message.role!=='system');
  if(last?.role==='user'&&typeof last.content==='string'&&last.content.startsWith('review-dispatch:'))return call('subagent',JSON.parse(last.content.slice('review-dispatch:'.length)));
  return fauxAssistantMessage('Parent evidence summary');
 }));
 child.setResponses(Array.from({length:50},()=>fauxAssistantMessage('Independent child evidence')));
 return {dir,state,models,parent,child,flow(fn:FauxResponseFactory){parentFlow=fn;},close(){state.close();rmSync(dir,{recursive:true,force:true});}};
}
async function setup(f:ReturnType<typeof fixture>,adaptive=true,profile=false){
 await saveDelegationConfig(f.state,f.models,profile?{
  mode:'profile_routes',profileRoutes:{profiles:[{name:'reviewer',description:'Evidence-focused review'}],default:'reviewer'},
  profiles:[{name:'reviewer',route:{provider:'adaptive-review-child',model:'child',credential:{kind:'provider',provider:'adaptive-review-child'}},instructions:'Inspect evidence; do not edit source. Bash is not a sandbox.',skills:[],cwd:f.dir,modules:['coding']}],
 }:{mode:'model_map',modelMap:{default:'evidence',options:[{name:'evidence',description:'Independent evidence',provider:'adaptive-review-child',model:'child'}]}});
 saveDelegationBehavior(f.state,{enabled:adaptive,maxActive:2,maxDispatches:6});
 const rt=await openRuntime(f.state,f.models),chat=await rt.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'adaptive-review-parent',modelId:'parent'}}},ctx);return {rt,chat};
}
async function owner(f:ReturnType<typeof fixture>,chat:Conversation,text:string,allow=true){
 const clientRequestId=randomUUID(),deviceId='independent-review-owner',requestId=`device:${deviceId}:${clientRequestId}`;
 await registerDelegationOwner(f.state,chat,{requestId,clientRequestId,deviceId,allow});
 return chat.submit({type:'input',requestId,content:text,whenBusy:'steer',entry:{kind:'bob.user',data:{text,requestId:clientRequestId,allowSubagents:allow}}},ctx);
}
async function registry(rt:Runtime,chat:Conversation){return (await rt.harness.snapshot(Subagents,chat.id,ctx))??{agents:{},reporters:{}};}
async function settled(rt:Runtime){for(let i=0;i<400;i++){await rt.harness.waitForIdle(ctx);const inspection=await rt.harness.inspect(ctx);if(!inspection.tasks.length&&!inspection.submissions.length)return;await delay(5);}throw Error('Independent fixture did not settle');}
async function until(check:()=>Promise<boolean>){for(let i=0;i<500;i++){if(await check())return;await delay(5);}throw Error('Independent fixture condition not reached');}
async function toolResults(chat:Conversation){return (await chat.entries({order:'ascending'},200,undefined,ctx)).items.flatMap(entry=>entry.model??[]).filter(message=>message.role==='toolResult');}
async function graphCount(rt:Runtime){return rt.harness.commit(async tx=>({children:(await tx.scanConversations({},100)).items.length,tasks:(await tx.scanTasks({},200)).items.filter(task=>['app.subagent-anchor','app.subagent-reporter'].includes(task.kind)).length}),ctx);}
function continuingFlow(request:Parameters<FauxResponseFactory>[0]){
 const last=request.messages.findLast(message=>message.role!=='system');
 if(last?.role==='user'&&typeof last.content==='string'){
  if(last.content.startsWith('review-dispatch:'))return call('subagent',JSON.parse(last.content.slice('review-dispatch:'.length)));
  if(last.content.startsWith('[subagent research '))return call('subagent',spawn('later-worker'));
 }
 return fauxAssistantMessage('Parent final');
}

test('adaptive review upgrade: a settled pre-behavior profile child must not prevent opening the backend',{timeout:20000},async()=>{
 const f=fixture();let rt:Runtime|undefined;
 try{
  const initial=await setup(f,false,true);rt=initial.rt;const chat=initial.chat;
  await (await owner(f,chat,command(spawn('legacy-reviewer')))).wait(ctx);await settled(rt);
  const childId=(await registry(rt,chat)).agents['legacy-reviewer'].conversationId,child=(await rt.harness.conversation(childId,ctx))!;
  assert.ok((await child.agent(ctx)).tools.some(tool=>tool.name==='write'),'legacy profile originally allowed the full coding module');
  const coding=rt.modules.coding.tools!,read=coding.find(tool=>tool.name==='read')!,write=coding.find(tool=>tool.name==='write')!,bash=coding.find(tool=>tool.name==='bash')!;
  await child.configure({tools:{remove:[write]},modelTools:[read]},ctx);
  const entries=await child.entries({order:'ascending'},100,undefined,ctx),fork=await child.fork(entries.items.at(-1)!.id,{ownership:{kind:'ownerless'}},ctx);
  await fork.configure({tools:[read,bash],modelTools:[read]},ctx);
  const legacy=[child,fork],previous=[];
  for(const item of legacy){const agent=await item.agent(ctx);previous.push({tools:agent.tools.map(tool=>tool.name),callable:agent.callable.map(tool=>tool.name)});}
  assert.deepEqual(previous[0].tools,['read']);assert.deepEqual(previous[0].callable,coding.filter(tool=>tool.name!=='write'&&(!tool.callers||tool.callers.includes('tools'))).map(tool=>tool.name));
  // Native-state upgrade fixture, not an old-release binary: none of these documents
  // or the new explicit policy-required marker existed in pre-behavior AD.
  await rt.harness.commit(async tx=>{
   await tx.retireDoc(DelegationToolProvisioning,rt!.library.id);
   for(const item of legacy){await tx.retireDoc(DelegationChildTools,item.id);delete (await tx.doc(DelegationChild,item.id)).toolPolicyVersion;await tx.retireDoc(DelegationToolScopes,item.id);await tx.retireDoc(DelegationBudget,item.id);}
   await tx.retireDoc(DelegationToolScopes,chat.id);await tx.retireDoc(DelegationBudget,chat.id);
  },ctx);
  assert.equal(await rt.harness.snapshot(DelegationChildTools,childId,ctx),undefined);
  // New defaults must not retroactively rewrite either enabled or model-visible tools.
  saveDelegationBehavior(f.state,{profileTools:{reviewer:['read']}});
  await rt.close();rt=undefined;
  for(let reopen=0;reopen<2;reopen++){
   rt=await openRuntime(f.state,f.models);
   for(const [index,item] of legacy.entries()){
    const restored=(await rt.harness.conversation(item.id,ctx))!,agent=await restored.agent(ctx);
    assert.deepEqual({tools:agent.tools.map(tool=>tool.name),callable:agent.callable.map(tool=>tool.name)},previous[index]);
    assert.equal((await rt.harness.snapshot(DelegationChildTools,item.id,ctx))?.policy?.legacy,true);
   }
   assert.equal((await rt.harness.inspect(ctx)).tasks.length,0);
   assert.equal((await rt.harness.snapshot(DelegationToolProvisioning,rt.library.id,ctx))?.complete,true);
   if(reopen===0){await rt.close();rt=undefined;}
  }
  // Even removal of both child fields cannot reopen a completed migration window.
  await rt!.harness.commit(async tx=>{await tx.retireDoc(DelegationChildTools,childId);delete (await tx.doc(DelegationChild,childId)).toolPolicyVersion;},ctx);
  await rt!.close();rt=undefined;
  await assert.rejects(async()=>{rt=await openRuntime(f.state,f.models);},/policy is missing/);
 }finally{await rt?.close();f.close();}
});

test('adaptive review upgrade: cutoff, required marker and native lineage independently close legacy eligibility',{timeout:25000},async()=>{
 for(const scenario of ['after-cutoff','required-marker','unowned-imitation'] as const){
  const f=fixture();let rt:Runtime|undefined;
  try{
   const initial=await setup(f,false,true);rt=initial.rt;const chat=initial.chat;
   await (await owner(f,chat,command(spawn('existing')))).wait(ctx);await settled(rt);
   const id=(await registry(rt,chat)).agents.existing.conversationId;
   if(scenario==='unowned-imitation'){
    const fake=await rt.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'adaptive-review-parent',modelId:'parent'},extensions:[rt.modules.coding,rt.registry.snapshot().extension('bob.delegation.child')!]}},ctx);
    const data={...(await rt.harness.snapshot(DelegationChild,id,ctx))!};delete data.toolPolicyVersion;
    await rt.harness.commit(async tx=>{Object.assign(await tx.doc(DelegationChild,fake.id),data);await tx.retireDoc(DelegationToolProvisioning,rt!.library.id);},ctx);
   }else{
    await rt.harness.commit(async tx=>{
     const provisioning=await tx.doc(DelegationToolProvisioning,rt!.library.id);provisioning.complete=false;
     assert.ok(provisioning.cutoff!<id);
     if(scenario==='required-marker')provisioning.cutoff=id;
     else delete (await tx.doc(DelegationChild,id)).toolPolicyVersion;
     await tx.retireDoc(DelegationChildTools,id);
    },ctx);
   }
   await rt.close();rt=undefined;
   await assert.rejects(async()=>{rt=await openRuntime(f.state,f.models);},scenario==='unowned-imitation'?/Unverified legacy child\/fork lineage/:/Saved child tool policy is missing/);
  }finally{await rt?.close();f.close();}
 }
});

test('adaptive review: native revocation after the original spawn auth transaction prevents a report-derived creation',{timeout:20000},async()=>{
 const f=fixture();f.flow(continuingFlow);const {rt,chat}=await setup(f);let reached=false;
 const interception=defineExtension({name:'adaptive-review-revoke-race',wraps:[wrapTool(rt.modules.subagents.tools![0],original=>({...original,execute:async(raw,api,context)=>{
  if((raw as {name?:string}).name!=='later-worker')return original.execute(raw,api,context);
  let commits=0;const adapted:ToolExecutionApi={...api,commit:async(change,callContext)=>{
   const value=await api.commit(change,callContext);
   // First commit is preliminary host grant; second is original native authorization.
   if(++commits===2){reached=true;await chat.commit(tx=>revokeDelegation(tx,chat.id,'Independent test: revoke before creation'),ctx);}
   return value;
  }};return original.execute(raw,adapted,context);
 } }))]});
 rt.registry.install(interception);await chat.configure({extensions:[...(await chat.agent(ctx)).extensions,interception]},ctx);
 try{
  await (await owner(f,chat,command(spawn('research')))).wait(ctx);await settled(rt);
  assert.equal(reached,true,'race must occur after genuine native authorization');
  assert.deepEqual(Object.keys((await registry(rt,chat)).agents),['research']);
  const budget=(await rt.harness.snapshot(DelegationBudget,chat.id,ctx))!;
  assert.match(budget.revoked??'',/before creation/);assert.deepEqual(budget.grants,[]);assert.equal(Object.keys(budget.dispatches).length,1);
  assert.ok((await toolResults(chat)).some(result=>result.isError&&JSON.stringify(result.content).includes('authority')));
  assert.equal((await graphCount(rt)).tasks,2,'only the original research anchor and reporter exist');
 }finally{await rt.close();f.close();}
});

test('adaptive review: a global config change inside native creation rolls child, reporter and budget back',{timeout:20000},async()=>{
 const f=fixture();const {rt,chat}=await setup(f);let changed=false;
 const interception=defineExtension({name:'adaptive-review-config-race',wraps:[wrapTool(rt.modules.subagents.tools![0],original=>({...original,execute:async(raw,api,context)=>{
  const adapted:ToolExecutionApi={...api,commit:(change,callContext)=>api.commit(tx=>change(new Proxy(tx,{get(target,key){
   if(key==='createTask')return async(...args:Parameters<Tx['createTask']>)=>{
    const result=await target.createTask(...args);
    if((args[0] as any).definition?.name==='app.subagent-reporter'){changed=true;saveDelegationBehavior(f.state,{enabled:false});}
    return result;
   };
   const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }})),callContext)};return original.execute(raw,adapted,context);
 } }))]});
 rt.registry.install(interception);await chat.configure({extensions:[...(await chat.agent(ctx)).extensions,interception]},ctx);
 try{
  const before=await graphCount(rt);await (await owner(f,chat,command(spawn('raced')))).wait(ctx);await settled(rt);
  assert.equal(changed,true,'must change control config after native Reporter creation begins');
  assert.deepEqual(await graphCount(rt),before);assert.deepEqual((await registry(rt,chat)).agents,{});
  assert.equal(Object.keys((await rt.harness.snapshot(DelegationBudget,chat.id,ctx))!.dispatches).length,0);
  assert.ok((await toolResults(chat)).some(result=>result.isError));
 }finally{await rt.close();f.close();}
});

test('adaptive review: exact child tools reject forbidden direct and nested calls, not merely hide their schemas',{timeout:25000},async()=>{
 const f=fixture();let {rt,chat}=await setup(f,false,true);let nestedObserved=false;
 try{
  saveDelegationBehavior(f.state,{profileTools:{reviewer:['read','bash']}});
  chat=await rt.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'adaptive-review-parent',modelId:'parent'}}},ctx);
  const path=join(f.dir,'must-not-be-written');
  // Test-only wrapper uses a genuinely allowed tool as the caller of a forbidden tool.
  // No shell runs. The same native ToolTask nested-call resolver must enforce the filter.
  rt.registry.install(defineExtension({...rt.modules.coding,wraps:[wrapTool(rt.modules.coding.tools!.find(tool=>tool.name==='bash')!,tool=>({...tool,execute:async(_raw,api,context)=>{
   const result=await api.executeTool('write',{path,content:'forbidden nested write'},context,{key:'review-forbidden'});
   nestedObserved=true;assert.equal(result.isError,true);assert.ok(result.diagnostics.some(item=>item.code==='tool_unavailable'));
   return {output:[{type:'text',text:'Nested write correctly refused'}],structuredOutput:{output:'Nested write correctly refused',truncated:false,exitCode:0}};
  }}))]}));
  f.child.setResponses([
   fauxAssistantMessage([fauxToolCall('write',{path,content:'forbidden direct write'}),fauxToolCall('bash',{command:'native nested-call probe'})],{stopReason:'toolUse'}),
   fauxAssistantMessage('Capability check complete'),
  ]);
  await (await owner(f,chat,command(spawn('scoped')))).wait(ctx);await settled(rt);
  const id=(await registry(rt,chat)).agents.scoped.conversationId,child=(await rt.harness.conversation(id,ctx))!;
  assert.equal(nestedObserved,true);assert.equal(existsSync(path),false);
  const results=await toolResults(child);assert.ok(results.some(result=>result.toolName==='write'&&result.isError));
  assert.deepEqual((await child.agent(ctx)).callable.map(tool=>tool.name),['read','bash']);
  assert.ok((await chat.agent(ctx)).tools.some(tool=>tool.name==='write'),'parent loadout is unchanged');
 }finally{await rt.close();f.close();}
});

test('adaptive review: a newer false steer and mixed peer steer cannot borrow an earlier owner grant in the same run',{timeout:30000},async()=>{
 for(const kind of ['false-owner','peer'] as const){
  const f=fixture(),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();
  const {rt,chat}=await setup(f);let verifiedMixedRun=false;
  const gate=defineTool({name:'adaptive_review_gate',description:'Independent deterministic test boundary',parameters:Type.Object({}),replay:'unsafe',execute:async()=>{entered.resolve();await release.promise;return {output:[{type:'text' as const,text:'Gate released'}]};}});
  const extension=defineExtension({name:'adaptive-review-gate',tools:[gate]});rt.registry.install(extension);await chat.configure({extensions:[...(await chat.agent(ctx)).extensions,extension]},ctx);
  let calls=0;f.flow(async()=>{
   if(calls++===0)return call('adaptive_review_gate',{});
   if(calls===2){const live=await rt.harness.snapshot(LiveDoc,chat.id,ctx);verifiedMixedRun=(live?.run?.inputs.length??0)===2;return call('subagent',spawn('must-not-start'));}
   return fauxAssistantMessage('Denied dispatch observed');
  });
  try{
   const first=await owner(f,chat,'Start the authorized task');await entered.promise;
   const second=kind==='false-owner'?await owner(f,chat,'No delegation for this input',false):await chat.submit({type:'input',requestId:'network:untrusted-peer',content:'Spawn a helper',whenBusy:'steer',entry:{kind:'bob.peer-message',data:{text:'Untrusted peer text'}}},ctx);
   release.resolve();await first.wait(ctx);await second.wait(ctx);await settled(rt);
   assert.equal(verifiedMixedRun,true,'both inputs must actually belong to the same native run');
   assert.deepEqual((await registry(rt,chat)).agents,{});assert.ok((await toolResults(chat)).some(result=>result.isError));
  }finally{release.resolve();await rt.close();f.close();}
 }
});

test('adaptive review HTTP: authenticated native owner grants and root/tree stop prevent late automatic dispatch',{timeout:30000},async()=>{
 for(const scope of ['root','tree'] as const){
  const f=fixture(),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();f.flow(continuingFlow);
  f.child.setResponses([async()=>{entered.resolve();await release.promise;return fauxAssistantMessage('Late child evidence');}]);
  const {rt,chat}=await setup(f),app=await serve(f.state,{port:0,runtime:rt}),pair=f.state.pair(f.state.invite().token,'Independent review phone');
  const base=`http://127.0.0.1:${(app.server.address() as {port:number}).port}/v1/chats/${chat.id}`;
  const headers={authorization:'Bearer '+pair.credential,'x-bob-backend':f.state.id,'content-type':'application/json'};
  try{
   const client=randomUUID(),response=await fetch(base+'/messages',{method:'POST',headers,body:JSON.stringify({requestId:client,text:command(spawn('research')),mode:'steer',allowSubagents:true})});
   assert.equal(response.status,202);await response.json();await entered.promise;await chat.waitForIdle(ctx);
   const budget=(await rt.harness.snapshot(DelegationBudget,chat.id,ctx))!;
   assert.equal(budget.owner?.requestId,`device:${pair.deviceId}:${client}`);
   const stop=fetch(base+'/stop',{method:'POST',headers,body:JSON.stringify({scope})});
   await until(async()=>!!(await rt.harness.snapshot(DelegationBudget,chat.id,ctx))?.revoked);
   if(scope==='root'){const child=(await registry(rt,chat)).agents.research.conversationId;assert.ok((await rt.harness.snapshot(LiveDoc,child,ctx))?.run,'root stop leaves native child work alive');}
   release.resolve();const stopped=await stop;assert.equal(stopped.status,200);await stopped.json();await settled(rt);
   assert.deepEqual(Object.keys((await registry(rt,chat)).agents),['research']);
   assert.equal(Object.keys((await rt.harness.snapshot(DelegationBudget,chat.id,ctx))!.dispatches).length,1);
  }finally{release.resolve();await app.close();f.close();}
 }
});

test('adaptive review: adaptive profile routing refuses a frozen default-session parent fallback; off retains explicit legacy behavior',{timeout:25000},async()=>{
 for(const adaptive of [true,false]){
  const f=fixture();const {rt}=await setup(f,adaptive);
  try{
   await saveDelegationConfig(f.state,f.models,{mode:'default',defaultRoute:null});
   const old=await rt.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'adaptive-review-parent',modelId:'parent'}}},ctx);
   await saveDelegationConfig(f.state,f.models,{mode:'profile_routes',profileRoutes:{profiles:[{name:'reviewer',description:'Focused review'}],default:'reviewer'},profiles:[{name:'reviewer',route:{provider:'adaptive-review-child',model:'child',credential:{kind:'provider',provider:'adaptive-review-child'}},instructions:'Review evidence',skills:[],cwd:f.dir,modules:['coding']}]});
   saveDelegationBehavior(f.state,{profileTools:{reviewer:['read','bash']}});
   const before=await graphCount(rt);await (await owner(f,old,command(spawn('stale-fallback')))).wait(ctx);await settled(rt);
   if(adaptive){
    assert.deepEqual((await registry(rt,old)).agents,{},'standing policy must not spawn a full-parent helper through the frozen default schema');
    assert.deepEqual(await graphCount(rt),before);assert.ok((await toolResults(old)).some(result=>result.isError));
    // No silent migration: the owner explicitly refreshes this settled session.
    await old.commit(tx=>rt.delegation.refreshSession(tx,old.id,readDelegationConfig(f.state)),ctx);
    await (await owner(f,old,command(spawn('after-refresh')))).wait(ctx);await settled(rt);
    const child=(await rt.harness.conversation((await registry(rt,old)).agents['after-refresh'].conversationId,ctx))!;
    assert.equal((await child.agent(ctx)).model?.modelId,'child');assert.deepEqual((await child.agent(ctx)).tools.map(tool=>tool.name),['read','bash']);
   }else{
    const child=(await rt.harness.conversation((await registry(rt,old)).agents['stale-fallback'].conversationId,ctx))!;
    assert.equal((await child.agent(ctx)).model?.modelId,'parent','default-off keeps explicit legacy parent inheritance');
   }
  }finally{await rt.close();f.close();}
 }
});

test('adaptive review: an empty helper name cannot bypass dispatch accounting or profile application',{timeout:20000},async()=>{
 const f=fixture();let {rt,chat}=await setup(f,true,true);
 try{
  saveDelegationBehavior(f.state,{maxActive:2,maxDispatches:1,profileTools:{reviewer:['read','bash']}});
  chat=await rt.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'adaptive-review-parent',modelId:'parent'}}},ctx);
  const invalid=[spawn(''),spawn(' \t '),{action:'send',name:'',message:'Refuse blank send'}];
  f.flow(request=>{const last=request.messages.findLast(message=>message.role!=='system');return last?.role==='user'&&last.content==='empty-names'?fauxAssistantMessage([fauxToolCall('subagent',spawn('named')),...invalid.map(args=>fauxToolCall('subagent',args))],{stopReason:'toolUse'}):fauxAssistantMessage('Done');});
  await (await owner(f,chat,'empty-names')).wait(ctx);await settled(rt);
  const agents=await registry(rt,chat);
  assert.equal(Object.hasOwn(agents.agents,''),false,'empty identity must not produce an unconfigured, uncharged parent-inheriting child');
  assert.deepEqual(Object.keys(agents.agents),['named']);
  assert.equal(Object.keys((await rt.harness.snapshot(DelegationBudget,chat.id,ctx))!.dispatches).length,1);
  const child=(await rt.harness.conversation(agents.agents.named.conversationId,ctx))!;
  assert.equal((await child.agent(ctx)).model?.modelId,'child');assert.deepEqual((await child.agent(ctx)).tools.map(tool=>tool.name),['read','bash']);
  const errors=(await toolResults(chat)).filter(result=>result.isError);
  assert.equal(errors.length,invalid.length);for(const error of errors)assert.match(JSON.stringify(error.content),/non-empty.*name/,'blank names are refused at the name guard, not accidentally by the exhausted budget');
 }finally{await rt.close();f.close();}
});

test('adaptive review: removing a settled scoped child module must not make the entire backend unopenable',{timeout:20000},async()=>{
 const f=fixture();let rt:Runtime|undefined;
 try{
  const initial=await setup(f,false,true);rt=initial.rt;
  saveDelegationBehavior(f.state,{profileTools:{reviewer:['read','bash']}});
  const chat=await rt.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'adaptive-review-parent',modelId:'parent'}}},ctx);
  await (await owner(f,chat,command(spawn('scoped')))).wait(ctx);await settled(rt);
  const id=(await registry(rt,chat)).agents.scoped.conversationId,policy=await rt.harness.snapshot(DelegationChildTools,id,ctx);
  await rt.close();rt=await openRuntime(f.state,f.models,undefined,{resume:false});
  await changeModule(f.state,rt,'remove','coding');
  await rt.close();rt=undefined;
  rt=await openRuntime(f.state,f.models);
  const child=(await rt.harness.conversation(id,ctx))!,parent=(await rt.harness.conversation(chat.id,ctx))!;
  assert.deepEqual((await child.agent(ctx)).tools,[],'missing coding module cannot enable a fallback capability');
  assert.deepEqual((await child.agent(ctx)).callable,[]);
  assert.deepEqual((await rt.harness.snapshot(AgentDoc,id,ctx))?.tools,[],'persist an explicit deny-all, not an inherited/default selection');
  assert.deepEqual(await rt.harness.snapshot(DelegationChildTools,id,ctx),policy,'startup intersection must not rewrite the captured policy');
  const before=await graphCount(rt);
  await (await owner(f,parent,command({action:'send',name:'scoped',message:'Unavailable tools must block this send'}))).wait(ctx);await settled(rt);
  await (await owner(f,parent,command(spawn('unavailable-new')))).wait(ctx);await settled(rt);
  assert.deepEqual(await graphCount(rt),before,'new send and spawn remain strict after tolerant startup');
  const errors=(await toolResults(parent)).filter(result=>result.isError);
  assert.equal(errors.length,2);for(const error of errors)assert.match(JSON.stringify(error.content),/unavailable/);
  await assert.rejects(rt.delegation.selectedExtensions(rt.harness,child,[]),/unavailable/);
  assert.deepEqual((await rt.harness.snapshot(AgentDoc,id,ctx))?.tools,[]);
  assert.deepEqual(await rt.harness.snapshot(DelegationChildTools,id,ctx),policy);
 }finally{await rt?.close();f.close();}
});

test('adaptive review: missing captured policy on a new scoped child refuses send without new work',{timeout:20000},async()=>{
 const f=fixture();let {rt,chat}=await setup(f,false,true);
 try{
  saveDelegationBehavior(f.state,{profileTools:{reviewer:['read','bash']}});
  chat=await rt.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'adaptive-review-parent',modelId:'parent'}}},ctx);
  await (await owner(f,chat,command(spawn('scoped')))).wait(ctx);await settled(rt);
  const id=(await registry(rt,chat)).agents.scoped.conversationId;
  await rt.harness.commit(async tx=>{delete (await tx.doc(DelegationChildTools,id)).policy;},ctx);
  const before=await graphCount(rt);await (await owner(f,chat,command({action:'send',name:'scoped',message:'Should be refused'}))).wait(ctx);await settled(rt);
  assert.deepEqual(await graphCount(rt),before);assert.ok((await toolResults(chat)).some(result=>result.isError&&/policy|scope/.test(JSON.stringify(result.content))));
 }finally{await rt.close();f.close();}
});
