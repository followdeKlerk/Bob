import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage,fauxToolCall,type FauxResponseFactory} from '@earendil-works/pi-ai/providers/faux';
import {type Conversation,LiveDoc} from '@earendil-works/pi-durable';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {ChatMeta,Library} from '../src/documents.js';
import {Subagents,SubagentTools} from '../src/subagents.js';
import {DelegationChild,DelegationSession,delegationSchema} from '../src/delegation.js';
import {DelegationConfig,saveDelegationConfig,readDelegationConfig,setDelegationSecret,saveDelegationMode} from '../src/delegation-config.js';
import {handleDelegationCommand,DelegationCommands} from '../src/delegation-command.js';
import {selectModules} from '../src/modules.js';

function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'bob-ad-test-')),state=new State(dir),models=createModels();
 const parent=fauxProvider({provider:'parent',models:[{id:'parent-1'}]}),worker=fauxProvider({provider:'worker',models:[{id:'worker-1'}]});models.setProvider(parent.provider);models.setProvider(worker.provider);
 return {state,models,parent,worker,dir,cleanup(){state.close();rmSync(dir,{recursive:true,force:true});}};
}
const config=()=>DelegationConfig.parse({mode:'model_map',defaultRoute:{provider:'worker',model:'worker-1'},modelMap:{options:[{name:'quick',description:'Bounded quick work',provider:'worker',model:'worker-1'}]}});
function answerWithSpawn(args:Record<string,unknown>):FauxResponseFactory{return (request)=>{const last=request.messages.findLast((m:any)=>m.role!=='system');return last?.role==='user'&&typeof last.content==='string'&&last.content==='start'?fauxAssistantMessage([fauxToolCall('subagent',{action:'spawn',name:'worker',message:'child work',...args})],{stopReason:'toolUse'}):fauxAssistantMessage('Parent finished');};}
async function spawn(chat:Conversation,allowed=true){const id=randomUUID();if(allowed)await chat.commit(async tx=>{(await tx.doc(ChatMeta,chat.id)).subagentRequests=[id];},ctx);const input=await chat.submit({type:'input',content:'start',requestId:id},ctx);await input.wait(ctx);}
async function settle(runtime:Awaited<ReturnType<typeof openRuntime>>){for(let i=0;i<20;i++){await runtime.harness.waitForIdle(ctx);const inspection=await runtime.harness.inspect(ctx);if(!inspection.tasks.length&&!inspection.submissions.length)return;await new Promise(r=>setTimeout(r,5));}throw Error('fixture failed to settle');}

test('AD model route is allowlisted, configured before delivery, reported, and cannot recurse',{timeout:15000},async()=>{
 const f=fixture();await saveDelegationConfig(f.state,f.models,config());f.parent.setResponses(Array.from({length:10},()=>answerWithSpawn({option:'quick'})));f.worker.setResponses([fauxAssistantMessage('Worker answer')]);
 const rt=await openRuntime(f.state,f.models);try{
  assert.equal(rt.modules.subagents.tasks,SubagentTools.tasks,'Original Anchor/Reporter objects are retained');
  const chat=await rt.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'parent',modelId:'parent-1'}}},ctx);
  const schema=(await chat.agent(ctx)).tools.find(t=>t.name==='subagent')!.parameters;
  assert.match(JSON.stringify(schema),/quick/);assert.doesNotMatch(JSON.stringify(schema),/worker-1|credential|baseUrl/);
  await spawn(chat);await settle(rt);
  const id=(await rt.harness.snapshot(Subagents,chat.id,ctx))!.agents.worker.conversationId,child=(await rt.harness.conversation(id,ctx))!,agent=await child.agent(ctx);
  assert.equal(agent.model?.modelId,'worker-1');assert.equal(agent.tools.some(t=>t.name==='subagent'),false);
  assert.equal((await rt.harness.snapshot(DelegationChild,id,ctx))!.observation?.label,'quick');
  assert.equal(f.worker.state.callCount,1);
  const history=await chat.entries({},100,undefined,ctx);
  assert.equal(history.items.filter(e=>e.kind==='pi.user'&&JSON.stringify(e.model).includes('[subagent worker answered')).length,1);
  assert.ok(history.items.some(e=>JSON.stringify(e.model).includes('Delegation route: quick: worker/worker-1')));
 }finally{await rt.close();f.cleanup();}
});

test('AD mode defaults and no-selection fallback do not combine with default override',{timeout:15000},async()=>{
 for(const mode of ['model_map','profile_routes','default'] as const){
  const f=fixture(),cfg=config();cfg.mode=mode;if(mode==='profile_routes'){cfg.profileRoutes={profiles:[{name:'person',description:'Own profile'}]};cfg.profiles=[{name:'person',route:{provider:'worker',model:'worker-1',credential:{kind:'provider',provider:'worker'}},instructions:'persona',skills:[],cwd:f.dir,modules:[]}];}
  await saveDelegationConfig(f.state,f.models,cfg);f.parent.setResponses(Array.from({length:10},()=>answerWithSpawn({})));f.worker.setResponses([fauxAssistantMessage('worker')]);const rt=await openRuntime(f.state,f.models);
  try{const chat=await rt.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'parent',modelId:'parent-1'}}},ctx);await spawn(chat);await settle(rt);const id=(await rt.harness.snapshot(Subagents,chat.id,ctx))!.agents.worker.conversationId;assert.equal((await rt.harness.snapshot(DelegationChild,id,ctx))!.observation?.provider,mode==='default'?'worker':'parent');}
  finally{await rt.close();f.cleanup();}
 }
});

test('AD keeps explicit native spawn authorization and rejects changed label binding without a child',{timeout:15000},async()=>{
 const f=fixture();await saveDelegationConfig(f.state,f.models,config());f.parent.setResponses(Array.from({length:15},()=>answerWithSpawn({option:'quick'})));const rt=await openRuntime(f.state,f.models);
 try{const chat=await rt.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'parent',modelId:'parent-1'}}},ctx);
  await spawn(chat,false);assert.deepEqual((await rt.harness.snapshot(Subagents,chat.id,ctx))?.agents??{},{});
  const updated=readDelegationConfig(f.state);updated.modelMap.options[0].provider='parent';updated.modelMap.options[0].model='parent-1';await saveDelegationConfig(f.state,f.models,updated);
  await spawn(chat);assert.deepEqual((await rt.harness.snapshot(Subagents,chat.id,ctx))?.agents??{},{});assert.equal(f.worker.state.callCount,0);
  assert.ok((await chat.entries({},100,undefined,ctx)).items.some(e=>JSON.stringify(e.model).includes('/delegation')));
 }finally{await rt.close();f.cleanup();}
});

test('AD profile credentials/persona/skills/modules/cwd isolate from parent; failed apply rolls back native creation',{timeout:15000},async()=>{
 const f=fixture();setDelegationSecret(f.state,'personal','fixture-private-profile-key');const cfg=DelegationConfig.parse({mode:'profile_routes',profileRoutes:{profiles:[{name:'person',description:'Specialist'}],default:'person'},profiles:[{name:'person',route:{provider:'worker',model:'worker-1',credential:{kind:'secret',name:'personal'}},instructions:'ISOLATED PERSONA',skills:['selected'],cwd:f.dir,modules:['coding']}]});
 await saveDelegationConfig(f.state,f.models,cfg);let credential:string|undefined,system='';f.parent.setResponses(Array.from({length:10},()=>answerWithSpawn({})));f.worker.setResponses([(request,options)=>{credential=options?.apiKey;system=JSON.stringify(request.messages.filter((m:any)=>m.role==='system'));return fauxAssistantMessage('Profile answer');}]);
 const rt=await openRuntime(f.state,f.models);try{
  await rt.library.commit(async tx=>{const library=await tx.doc(Library,rt.library.id);library.instructions='PARENT PERSONA';library.skills.selected={enabled:false,description:'Chosen',markdown:'SELECTED SKILL'};library.skills.other={enabled:true,description:'Other',markdown:'UNSELECTED SKILL'};},ctx);
  const chat=await rt.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'parent',modelId:'parent-1'},instructions:'PARENT CHAT INSTRUCTIONS'}},ctx);await spawn(chat);await settle(rt);
  const id=(await rt.harness.snapshot(Subagents,chat.id,ctx))!.agents.worker.conversationId,child=(await rt.harness.conversation(id,ctx))!,agent=await child.agent(ctx);
  assert.equal(agent.cwd,f.dir);assert.deepEqual(agent.tools.map(t=>t.name).sort(),rt.modules.coding.tools!.map(t=>t.name).sort());assert.equal(credential,'fixture-private-profile-key');
  assert.match(system,/ISOLATED PERSONA/);assert.match(system,/SELECTED SKILL/);assert.match(system,/Follow the current delegation policy and permissions/);assert.match(system,/You cannot start subagents/);assert.doesNotMatch(system,/PARENT PERSONA|PARENT CHAT INSTRUCTIONS|UNSELECTED SKILL|fixture-private-profile-key/);
  assert.doesNotMatch(JSON.stringify((await chat.entries({},100,undefined,ctx)).items),/fixture-private-profile-key/);
  // Missing selected skill throws after the original native callback staged creation.
  await rt.library.commit(async tx=>{delete (await tx.doc(Library,rt.library.id)).skills.selected;},ctx);
  const broken=await rt.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'parent',modelId:'parent-1'}}},ctx);await spawn(broken);
  assert.deepEqual((await rt.harness.snapshot(Subagents,broken.id,ctx))?.agents??{},{});
  const tasks=await rt.harness.commit(tx=>tx.scanTasks({conversationId:broken.id},100),ctx);assert.equal(tasks.items.some(t=>t.kind==='app.subagent-anchor'||t.kind==='app.subagent-reporter'),false);
 }finally{await rt.close();f.cleanup();}
});

test('AD frozen snapshot survives edits, module reselection, and reopen; --now explicitly refreshes',{timeout:15000},async()=>{
 const f=fixture();await saveDelegationConfig(f.state,f.models,config());let rt=await openRuntime(f.state,f.models);let chat=await rt.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'parent',modelId:'parent-1'}}},ctx);
 try{
  const id=chat.id,before=JSON.stringify((await chat.agent(ctx)).tools.find(t=>t.name==='subagent')!.parameters);
  const updated=readDelegationConfig(f.state);updated.modelMap.options.push({...updated.modelMap.options[0],name:'another',description:'Second choice'});await saveDelegationConfig(f.state,f.models,updated);
  assert.equal(JSON.stringify((await chat.agent(ctx)).tools.find(t=>t.name==='subagent')!.parameters),before);
  await selectModules(f.state,rt,chat,['subagents','resources']);assert.equal(JSON.stringify((await chat.agent(ctx)).tools.find(t=>t.name==='subagent')!.parameters),before);
  await rt.close();rt=await openRuntime(f.state,f.models);chat=(await rt.harness.conversation(id,ctx))!;assert.equal(JSON.stringify((await chat.agent(ctx)).tools.find(t=>t.name==='subagent')!.parameters),before);
  const op=randomUUID(),receipt=await handleDelegationCommand(f.state,rt.harness,rt.delegation,chat,'/delegation models --now',op,op);assert.equal(receipt?.status,'done');
  assert.match(JSON.stringify((await chat.agent(ctx)).tools.find(t=>t.name==='subagent')!.parameters),/another/);
 }finally{await rt.close();f.cleanup();}
});

test('AD default schemas never expose arbitrary provider/model/endpoint/key selection',()=>{
 for(const mode of ['default','model_map','profile_routes'] as const){const cfg=config();cfg.mode=mode;cfg.profileRoutes={profiles:[{name:'person',description:'Specialist'}]};const schema=delegationSchema(cfg) as any;assert.equal(schema.additionalProperties,false);for(const key of ['provider','model','endpoint','api_key','credential','service_tier'])assert.equal(schema.properties[key],undefined);assert.equal('option' in schema.properties,mode==='model_map');assert.equal('profile' in schema.properties,mode==='profile_routes');}
});
