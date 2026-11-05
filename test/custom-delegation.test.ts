import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import * as schema from '@earendil-works/pi-schema';
import {createModels,getSupportedThinkingLevels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
import type {Conversation} from '@earendil-works/pi-durable';
import {State} from '../src/state.js';
import {openRuntime,ctx,type Runtime} from '../src/runtime.js';
import {Subagents} from '../src/subagents.js';
import {Library} from '../src/documents.js';
import {DelegationChild,delegationSchema} from '../src/delegation.js';
import {DelegationConfig,readDelegationConfig,saveDelegationConfig,setDelegationSecret,fingerprint} from '../src/delegation-config.js';
import {CustomDelegation,customSelection,customDelegationModels} from '../src/delegation-custom.js';
import {DelegationChildTools,saveDelegationBehavior} from '../src/delegation-behavior.js';
import {DelegationBudget,registerDelegationOwner,revokeDelegation} from '../src/delegation-budget.js';

// Private disposable state and faux providers only. Never use production config or inference.
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'bob-custom-')),state=new State(dir),models=createModels({authContext:{env:async()=>undefined,fileExists:async()=>false}});
 const parent=fauxProvider({provider:'custom-parent',models:[{id:'parent'}],tokensPerSecond:1000000});
 const preset=fauxProvider({provider:'custom-preset',models:[{id:'preset'}],tokensPerSecond:1000000});
 const alternate=fauxProvider({provider:'custom-alternate',models:[{id:'alternate',reasoning:true},{id:'plain',reasoning:false}],tokensPerSecond:1000000});
 for(const p of [parent,preset,alternate])models.setProvider(p.provider);
 parent.setResponses(Array.from({length:100},()=>request=>{const last=request.messages.findLast(m=>m.role!=='system');return last?.role==='user'&&typeof last.content==='string'&&last.content.startsWith('call:')?fauxAssistantMessage(JSON.parse(last.content.slice(5)).map((args:Record<string,unknown>)=>fauxToolCall('subagent',args)),{stopReason:'toolUse'}):fauxAssistantMessage('Parent completed');}));
 preset.setResponses(Array.from({length:20},()=>fauxAssistantMessage('Preset answer')));
 alternate.setResponses(Array.from({length:20},()=>fauxAssistantMessage('Custom evidence')));
 setDelegationSecret(state,'preset-secret','fixture-only-preset-secret');
 const config=()=>DelegationConfig.parse({mode:'profile_routes',profileRoutes:{profiles:[{name:'researcher',description:'Read-only research'},{name:'worker',description:'Implementation'},{name:'reviewer',description:'Independent review'}],default:'worker'},profiles:['researcher','worker','reviewer'].map(name=>({name,route:{provider:'custom-preset',model:'preset',credential:{kind:'secret',name:'preset-secret'}},instructions:`BASE ${name}: keep the assigned scope.`,skills:['selected'],modules:['coding'],cwd:dir}))});
 return {dir,state,models,parent,preset,alternate,config,close(){state.close();rmSync(dir,{recursive:true,force:true});}};
}
const selection=(overrides:Record<string,unknown>={})=>({baseProfile:'reviewer',provider:'custom-alternate',model:'alternate',reasoning_effort:'high',instructions:'Review the narrow question; do not edit files.',...overrides});
const spawn=(name='specialist',overrides:Record<string,unknown>={})=>({action:'spawn',name,message:'Inspect the bounded issue and return evidence.',profile:'custom',custom:selection(),...overrides});
async function setup(f:ReturnType<typeof fixture>,behavior:Record<string,unknown>={}){
 await saveDelegationConfig(f.state,f.models,f.config());
 saveDelegationBehavior(f.state,{enabled:true,maxActive:2,maxDispatches:4,profileTools:{researcher:['read'],worker:['read','write','edit','bash'],reviewer:['read']},...behavior});
 const rt=await openRuntime(f.state,f.models);
 await rt.library.commit(async tx=>{(await tx.doc(Library,rt.library.id)).skills.selected={description:'Selected base skill',markdown:'BASE SELECTED SKILL',enabled:false};},ctx);
 const chat=await rt.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'custom-parent',modelId:'parent'}}},ctx);
 return {rt,chat};
}
async function call(f:ReturnType<typeof fixture>,chat:Conversation,args:Record<string,unknown>[],allow=true){
 const clientRequestId=randomUUID(),requestId=`device:custom-fixture:${clientRequestId}`;
 await registerDelegationOwner(f.state,chat,{requestId,clientRequestId,deviceId:'custom-fixture',allow});
 await (await chat.submit({type:'input',requestId,content:'call:'+JSON.stringify(args),entry:{kind:'bob.user',data:{requestId:clientRequestId,allowSubagents:allow}}},ctx)).wait(ctx);
}
async function settle(rt:Runtime){for(let i=0;i<100;i++){await rt.harness.waitForIdle(ctx);const pending=await rt.harness.inspect(ctx);if(!pending.tasks.length&&!pending.submissions.length)return;await delay(5);}throw Error('custom fixture did not settle');}
async function children(rt:Runtime,chat:Conversation){return (await rt.harness.snapshot(Subagents,chat.id,ctx))?.agents??{};}
async function results(chat:Conversation){return (await chat.entries({order:'ascending'},200,undefined,ctx)).items.flatMap(e=>e.model??[]).filter(m=>m.role==='toolResult');}

test('Custom schema is additive only for profiles, keeps native required fields, and strictly excludes credentials/endpoints',()=>{
 const f=fixture();try{
  const config=f.config(),contract=delegationSchema(config),validate=schema.compile(contract);
  assert.deepEqual(contract.required,['action']);
  assert.equal(validate.check({action:'status'}),true);assert.equal(validate.check({action:'spawn',name:'standard',message:'work',profile:'reviewer'}),true);
  assert.equal(validate.check(spawn()),true);assert.equal(validate.check({action:'models',modelQuery:{provider:'custom-alternate',offset:0}}),true);
  for(const extra of [{endpoint:{}},{credential:{kind:'secret',name:'preset-secret'}},{service_tier:'fast'},{modules:['coding']},{cwd:'/tmp'},{model:'x'.repeat(201)},{reasoning_effort:'invented'}])assert.equal(validate.check(spawn('bad',{custom:selection(extra)})),false,JSON.stringify(extra));
  for(const mode of ['default','model_map'] as const){const other={...config,mode};const properties=delegationSchema(other).properties;assert.equal(properties.custom,undefined);assert.equal(properties.modelQuery,undefined);assert.equal(schema.compile(delegationSchema(other)).check({action:'models'}),false);assert.throws(()=>customSelection(other,{profile:'custom',custom:selection() as CustomDelegation}),/unavailable/);}
  const named=f.config();named.profileRoutes.profiles.push({name:'custom',description:'Existing owner preset'});named.profiles.push({...named.profiles[0],name:'custom'});
  assert.ok(delegationSchema(named).properties.custom);assert.equal(customSelection(named,{profile:'custom'}),undefined,'do not steal an existing preset name');
  assert.equal(customSelection(named,{profile:'custom',custom:selection() as CustomDelegation})?.label,'custom');
  assert.throws(()=>customSelection(config,{profile:'custom'}),/complete/);
  assert.throws(()=>customSelection(config,{custom:selection() as CustomDelegation}),/complete/);
  assert.throws(()=>customSelection(config,{profile:'custom',custom:selection({baseProfile:'not-allowlisted'}) as CustomDelegation}),/allowlisted/);
  assert.throws(()=>customSelection(config,{profile:'custom',custom:selection({provider:'bob-ad-private'}) as CustomDelegation}),/aliases/);
  config.profiles[2].route.endpoint={baseUrl:'http://127.0.0.1:9876/v1',api:'openai-completions',contextWindow:8192,maxTokens:1024,thinkingLevels:['off']};
  const chosen=customSelection(config,{profile:'custom',custom:selection() as CustomDelegation})!;
  assert.deepEqual(chosen.profile,config.profiles[2]);assert.deepEqual(chosen.route.credential,{kind:'provider',provider:'custom-alternate'});assert.equal(chosen.route.endpoint,undefined);assert.equal(chosen.route.service_tier,'normal');assert.doesNotMatch(JSON.stringify(chosen.route),/preset-secret|9876|baseUrl/);
 }finally{f.close();}
});

test('model discovery is paginated, reports supported efforts, sanitizes failures and makes no inference calls',async()=>{
 const f=fixture();try{
  const many=fauxProvider({provider:'many',models:Array.from({length:63},(_,i)=>({id:`m${String(i).padStart(3,'0')}`}))});f.models.setProvider(many.provider);
  const first=await customDelegationModels(f.models,{provider:'many'}),second=await customDelegationModels(f.models,{provider:'many',offset:first.nextOffset});
  assert.equal(first.models.length,50);assert.equal(first.nextOffset,50);assert.equal(second.models.length,13);assert.equal(second.nextOffset,undefined);assert.equal(new Set([...first.models,...second.models].map(m=>m.model)).size,63);
  const choices=await customDelegationModels(f.models,{provider:'custom-alternate'});
  assert.deepEqual(choices.models.find(m=>m.model==='alternate')?.thinkingLevels,getSupportedThinkingLevels(f.alternate.getModel('alternate')!));
  assert.deepEqual(choices.models.find(m=>m.model==='plain')?.thinkingLevels,['off']);
  assert.equal(f.alternate.state.callCount+f.preset.state.callCount+many.state.callCount,0);
  await assert.rejects(()=>customDelegationModels(f.models,{provider:'missing'}),/Unknown configured/);
  await assert.rejects(()=>customDelegationModels(f.models,{offset:-1}),/Invalid models query/);
  const broken=new Proxy(f.models,{get(target,key){return key==='getAvailable'?async()=>{throw Error('fixture-only-secret-token');}:Reflect.get(target,key);}});
  await assert.rejects(()=>customDelegationModels(broken,{}),error=>error instanceof Error&&!error.message.includes('secret-token'));
 }finally{f.close();}
});

test('Custom native spawn records the actual model/effort while preserving base scope, skills, cwd, presets and parent; send/reopen/fork keep it immutable',{timeout:20000},async()=>{
 const f=fixture();let system='',actualModel='',actualEffort='',actualKey:string|undefined;
 f.alternate.setResponses(Array.from({length:5},()=>((request,options,_state,model)=>{system=JSON.stringify(request.messages.filter(m=>m.role==='system'));actualModel=model.id;actualEffort=String(options?.reasoning);actualKey=options?.apiKey;return fauxAssistantMessage('Custom evidence');})));
 let {rt,chat}=await setup(f);try{
  const configBefore=readDelegationConfig(f.state),parentBefore=await chat.agent(ctx);
  await call(f,chat,[spawn()]);await settle(rt);
  const id=(await children(rt,chat)).specialist.conversationId,child=(await rt.harness.conversation(id,ctx))!,agent=await child.agent(ctx),receipt=(await rt.harness.snapshot(DelegationChild,id,ctx))!;
  assert.equal(actualModel,'alternate');assert.equal(actualEffort,'high');assert.notEqual(actualKey,'fixture-only-preset-secret');assert.equal(f.preset.state.callCount,0);
  assert.equal(agent.thinkingLevel,'high');assert.equal(agent.model?.modelId,'alternate');assert.equal(agent.cwd,f.dir);assert.deepEqual(agent.tools.map(t=>t.name),['read']);
  assert.match(system,/BASE reviewer/);assert.match(system,/BASE SELECTED SKILL/);assert.match(system,/Review the narrow question/);assert.match(system,/You cannot start subagents/);assert.doesNotMatch(system,/fixture-only-preset-secret/);
  assert.deepEqual(receipt.profile,configBefore.profiles[2]);assert.equal(receipt.route?.provider,'custom-alternate');assert.equal(receipt.observation?.label,'custom');assert.equal(receipt.observation?.profile,'reviewer');
  assert.equal((await rt.harness.snapshot(DelegationChildTools,id,ctx))?.policy?.profileFingerprint,fingerprint(configBefore.profiles[2]));
  assert.deepEqual(readDelegationConfig(f.state),configBefore);assert.deepEqual((await chat.agent(ctx)).model,parentBefore.model);
  const history=JSON.stringify((await chat.entries({},150,undefined,ctx)).items);assert.match(history,/custom: custom-alternate\/alternate · effort high · tier normal · profile reviewer/);assert.doesNotMatch(history,/fixture-only-preset-secret/);
  await call(f,chat,[{action:'send',name:'specialist',message:'Attempt mutation',profile:'custom',custom:selection({model:'plain',reasoning_effort:'off'})}]);await settle(rt);
  assert.equal((await child.agent(ctx)).model?.modelId,'alternate');assert.equal(f.alternate.state.callCount,1);assert.ok((await results(chat)).some(m=>m.isError&&JSON.stringify(m.content).includes('spawn only')));
  const last=(await child.entries({order:'descending'},1,undefined,ctx)).items[0];const fork=await child.fork(last.id,{ownership:{kind:'ownerless'}},ctx),forkId=fork.id,chatId=chat.id;
  assert.deepEqual((await fork.agent(ctx)).tools.map(t=>t.name),['read']);
  await rt.close();rt=await openRuntime(f.state,f.models);chat=(await rt.harness.conversation(chatId,ctx))!;
  for(const childId of [id,forkId]){const restored=(await rt.harness.conversation(childId,ctx))!,a=await restored.agent(ctx);assert.equal(a.model?.modelId,'alternate');assert.equal(a.thinkingLevel,'high');assert.deepEqual(a.tools.map(t=>t.name),['read']);assert.deepEqual(await rt.harness.snapshot(DelegationChild,childId,ctx),receipt);}
  await call(f,chat,[{action:'send',name:'specialist',message:'Continue original narrow task'}]);await settle(rt);assert.equal(f.alternate.state.callCount,2);assert.equal(actualModel,'alternate');assert.equal(actualEffort,'high');
  await call(f,chat,[{action:'spawn',name:'standard',message:'Use unchanged preset',profile:'reviewer'}]);await settle(rt);assert.equal(f.preset.state.callCount,1);assert.equal((await rt.harness.snapshot(DelegationChild,(await children(rt,chat)).standard.conversationId,ctx))?.observation?.label,'reviewer');
 }finally{await rt.close();f.close();}
});

test('Custom catalog action is native read-only metadata, rejects spawn fields, and does not charge dispatches',{timeout:15000},async()=>{
 const f=fixture(),{rt,chat}=await setup(f);try{
  await call(f,chat,[{action:'models',modelQuery:{provider:'custom-alternate'}}],false);await settle(rt);
  const toolResults=await results(chat);assert.equal(toolResults[0].isError,false);const catalog=JSON.parse((toolResults[0].content[0] as {text:string}).text);assert.equal(catalog.models.length,2);
  assert.deepEqual(await children(rt,chat),{});assert.equal(Object.keys((await rt.harness.snapshot(DelegationBudget,chat.id,ctx))?.dispatches??{}).length,0);assert.equal(f.alternate.state.callCount,0);
  await call(f,chat,[{action:'models',name:'not-allowed'},{action:'status',modelQuery:{}},{action:'models',custom:selection()}]);await settle(rt);
  assert.ok((await results(chat)).slice(-3).every(r=>r.isError));
 }finally{await rt.close();f.close();}
});

test('Custom rejects unsupported/unavailable/stale routes before child creation, without fallback or charged dispatches',{timeout:20000},async()=>{
 const f=fixture(),{rt,chat}=await setup(f);try{
  for(const custom of [selection({provider:'unknown'}),selection({model:'missing'}),selection({model:'plain',reasoning_effort:'high'}),selection({reasoning_effort:'invented'}),selection({credential:{kind:'secret',name:'preset-secret'}})]){
   await call(f,chat,[spawn('rejected',{custom})]);await settle(rt);assert.deepEqual(await children(rt,chat),{});
  }
  const checkAuth=f.models.checkAuth.bind(f.models),getAvailable=f.models.getAvailable.bind(f.models);
  f.models.checkAuth=async(provider,options)=>provider==='custom-alternate'?undefined:checkAuth(provider,options);
  await call(f,chat,[spawn('no-auth')]);await settle(rt);assert.deepEqual(await children(rt,chat),{});f.models.checkAuth=checkAuth;
  f.models.getAvailable=async(provider,options)=>provider==='custom-alternate'?[]:getAvailable(provider,options);
  await call(f,chat,[spawn('unavailable')]);await settle(rt);assert.deepEqual(await children(rt,chat),{});f.models.getAvailable=getAvailable;
  const updated=readDelegationConfig(f.state);updated.profiles[2].instructions='Changed base identity';await saveDelegationConfig(f.state,f.models,updated);
  await call(f,chat,[spawn('stale')]);await settle(rt);assert.deepEqual(await children(rt,chat),{});
  assert.equal(f.alternate.state.callCount+f.preset.state.callCount,0);
  assert.equal(Object.keys((await rt.harness.snapshot(DelegationBudget,chat.id,ctx))?.dispatches??{}).length,0);
  const tasks=await rt.harness.commit(tx=>tx.scanTasks({conversationId:chat.id},100),ctx);assert.equal(tasks.items.some(t=>t.kind==='app.subagent-anchor'||t.kind==='app.subagent-reporter'),false);
 }finally{await rt.close();f.close();}
});

test('Custom shares owner denial, active/dispatch bounds, immutable names and rollback of failed tool-policy binding',{timeout:20000},async()=>{
 const f=fixture(),{rt,chat}=await setup(f,{maxActive:1,maxDispatches:1});try{
  await call(f,chat,[spawn('denied')],false);await settle(rt);assert.deepEqual(await children(rt,chat),{});
  await call(f,chat,[spawn('first'),spawn('second')]);await settle(rt);assert.equal(Object.keys(await children(rt,chat)).length,1);assert.equal(f.alternate.state.callCount,1);
  await call(f,chat,[spawn('first',{custom:selection({model:'plain',reasoning_effort:'off'})})]);await settle(rt);assert.equal((await rt.harness.snapshot(DelegationChild,(await children(rt,chat)).first.conversationId,ctx))?.route?.model,'alternate');assert.equal(f.alternate.state.callCount,1);
  saveDelegationBehavior(f.state,{profileTools:{researcher:['read'],worker:['read','write','edit','bash'],reviewer:[]}});
  await call(f,chat,[spawn('stale-policy')]);await settle(rt);assert.equal((await children(rt,chat))['stale-policy'],undefined);assert.equal(f.alternate.state.callCount,1);
  const budget=(await rt.harness.snapshot(DelegationBudget,chat.id,ctx))!;assert.equal(Object.keys(budget.dispatches).length,0,'failed new owner scope remains uncharged');
  await chat.commit(tx=>revokeDelegation(tx,chat.id),ctx);
 }finally{await rt.close();f.close();}
});

test('Custom rechecks base identity and tool scope atomically after paused asynchronous route validation',{timeout:20000},async()=>{
 for(const change of ['profile','policy'] as const){
  const f=fixture(),{rt,chat}=await setup(f);let release!:()=>void,entered=false;
  const pause=new Promise<void>(resolve=>{release=resolve;}),checkAuth=f.models.checkAuth.bind(f.models);
  f.models.checkAuth=async(provider,options)=>{if(provider==='custom-alternate'&&!entered){entered=true;await pause;}return checkAuth(provider,options);};
  let pending:Promise<void>|undefined;
  try{
   pending=call(f,chat,[spawn('racing')]);
   for(let i=0;i<300&&!entered;i++)await delay(5);assert.equal(entered,true,'route validation reached the controlled pause');
   if(change==='profile'){const config=readDelegationConfig(f.state);config.profiles[2].instructions='Concurrent changed base';await saveDelegationConfig(f.state,f.models,config);}
   else saveDelegationBehavior(f.state,{profileTools:{researcher:['read'],worker:['read','write','edit','bash'],reviewer:[]}});
   release();await pending;await settle(rt);assert.deepEqual(await children(rt,chat),{});assert.equal(f.alternate.state.callCount,0);
   const tasks=await rt.harness.commit(tx=>tx.scanTasks({conversationId:chat.id},100),ctx);assert.equal(tasks.items.some(t=>t.kind==='app.subagent-anchor'||t.kind==='app.subagent-reporter'),false);
   assert.equal(Object.keys((await rt.harness.snapshot(DelegationBudget,chat.id,ctx))?.dispatches??{}).length,0);
  }finally{release();await pending;await rt.close();f.close();}
 }
});

test('Custom exact empty tools survive restart/fork, while missing policy never triggers permissive legacy repair',{timeout:20000},async()=>{
 const f=fixture();let {rt,chat}=await setup(f,{profileTools:{researcher:['read'],worker:['read','write','edit','bash'],reviewer:[]}}),closed=false;
 try{
  await call(f,chat,[spawn('empty')]);await settle(rt);const childId=(await children(rt,chat)).empty.conversationId,child=(await rt.harness.conversation(childId,ctx))!;
  assert.deepEqual((await child.agent(ctx)).tools,[]);
  const last=(await child.entries({order:'descending'},1,undefined,ctx)).items[0],fork=await child.fork(last.id,{ownership:{kind:'ownerless'}},ctx),forkId=fork.id;
  assert.deepEqual((await fork.agent(ctx)).tools,[]);assert.equal((await fork.agent(ctx)).callable.some(t=>t.name==='subagent'),false);
  await rt.close();rt=await openRuntime(f.state,f.models);
  for(const id of [childId,forkId]){const restored=(await rt.harness.conversation(id,ctx))!;assert.deepEqual((await restored.agent(ctx)).tools,[]);assert.deepEqual((await rt.harness.snapshot(DelegationChildTools,id,ctx))?.policy?.tools,[]);}
  await rt.harness.commit(async tx=>{delete (await tx.doc(DelegationChildTools,childId)).policy;},ctx);
  await rt.close();closed=true;
  await assert.rejects(async()=>{const unexpected=await openRuntime(f.state,f.models,undefined,{resume:false});await unexpected.close();},/Saved child tool policy is missing/);
 }finally{if(!closed)await rt.close();f.close();}
});
