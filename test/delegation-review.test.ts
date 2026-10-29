import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
import {defineTask,defineExtension,createRegistry,Harness,LiveDoc,InboxDoc,type Conversation} from '@earendil-works/pi-durable';
import {openNodeSqliteStorage} from '@earendil-works/pi-durable/storage/sqlite/node';
import {openRuntime,ctx,type Runtime} from '../src/runtime.js';
import {ChatMeta,Library,Questions} from '../src/documents.js';
import {Subagents,SubagentTools} from '../src/subagents.js';
import {DelegationSession,DelegationChild,delegationSchema,requireDelegationSettled} from '../src/delegation.js';
import {createDelegationModels} from '../src/delegation-providers.js';
import {DelegationCommands,handleDelegationCommand,parseDelegationCommand,recoverDelegationCommands} from '../src/delegation-command.js';
import {serve} from '../src/server.js';
import {createModels,type CreateModelsOptions} from '@earendil-works/pi-ai/models';
import {openaiProvider} from '@earendil-works/pi-ai/providers/openai';
import {anthropicProvider} from '@earendil-works/pi-ai/providers/anthropic';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai/utils/event-stream';
import {State} from '../src/state.js';
import {
  DelegationConfig,Route,readDelegationConfig,saveDelegationConfig,saveDelegationMode,
  setDelegationSecret,validateRoute,describeDelegation,delegationVersion,
  type DelegationConfig as Config,type DelegationRoute,
} from '../src/delegation-config.js';

// Independent review fixtures: private temporary control stores, native provider
// catalogs, synthetic credentials, and no inference or external HTTP requests.
const PARENT_KEY='sk-review-parent-DO-NOT-DISCLOSE';
const PROFILE_KEY='sk-review-profile-DO-NOT-DISCLOSE';
const ENDPOINT_KEY='sk-review-endpoint-DO-NOT-DISCLOSE';
type Credential=Exclude<Awaited<ReturnType<NonNullable<CreateModelsOptions['credentials']>['read']>>,undefined>;
function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'bob-delegation-review-')),state=new State(dir);
  const credentials=new Map<string,Credential>([['openai',{type:'api_key',key:PARENT_KEY}]]);
  const models=createModels({
    credentials:{
      read:async id=>credentials.get(id),
      list:async()=>[...credentials].map(([providerId,value])=>({providerId,type:value.type})),
      modify:async(id,fn)=>{const next=await fn(credentials.get(id));if(next)credentials.set(id,next);return credentials.get(id);},
      delete:async id=>{credentials.delete(id);},
    },
    authContext:{env:async()=>undefined,fileExists:async()=>false},
  });
  models.setProvider(openaiProvider());models.setProvider(anthropicProvider());
  setDelegationSecret(state,'review-profile',PROFILE_KEY);
  setDelegationSecret(state,'review-endpoint',ENDPOINT_KEY);
  const route:DelegationRoute={provider:'openai',model:'gpt-4.1-mini'};
  const full=():Config=>DelegationConfig.parse({
    version:1,mode:'model_map',defaultRoute:{...route,model:'gpt-4.1'},
    modelMap:{options:[{...route,name:'quick',description:'Small bounded tasks'},{...route,model:'gpt-4.1',name:'careful',description:'Detailed review'}],default:'quick'},
    profileRoutes:{profiles:[{name:'reviewer',description:'Independent review'}],default:'reviewer'},
    profiles:[{name:'reviewer',route:{...route,credential:{kind:'secret',name:'review-profile'}},instructions:'Review independently.',skills:[],cwd:dir,modules:['coding']}],
  });
  return {state,models,credentials,route,full,dir,close(){state.close();rmSync(dir,{recursive:true,force:true});}};
}
function endpoint(overrides:Partial<DelegationRoute>={}):DelegationRoute{
  return Route.parse({provider:'review-local',model:'owner-declared-model',credential:{kind:'secret',name:'review-endpoint'},endpoint:{baseUrl:'http://127.0.0.1:9876/v1',api:'openai-completions',contextWindow:8192,maxTokens:1024,thinkingLevels:['off']},...overrides});
}

// Regression: Zod 4 applies defaults even underneath optional fields. A partial
// update schema must not inject reset values for configuration fields absent in
// the owner's patch.
test('AD review: mode-only config edits preserve every inactive route/profile and child override',async()=>{
  const f=fixture();try{
    const original=await saveDelegationConfig(f.state,f.models,f.full());
    for(const mode of ['profile_routes','default','model_map'] as const){
      await saveDelegationConfig(f.state,f.models,{mode});
      assert.deepEqual(readDelegationConfig(f.state),{...original,mode});
    }
  }finally{f.close();}
});
test('AD review: an empty patch is a no-op, and editing one block preserves unrelated blocks',async()=>{
  const f=fixture();try{
    const original=await saveDelegationConfig(f.state,f.models,f.full());
    await saveDelegationConfig(f.state,f.models,{});
    assert.deepEqual(readDelegationConfig(f.state),original,'empty patch must not inject defaults');
    const modelMap={...original.modelMap,default:'careful'};
    await saveDelegationConfig(f.state,f.models,{modelMap});
    assert.deepEqual(readDelegationConfig(f.state),{...original,modelMap});
  }finally{f.close();}
});
test('AD review: mode operation identity is durable and an older replay cannot revert a later mode',async()=>{
  const f=fixture();try{
    const original=await saveDelegationConfig(f.state,f.models,f.full());
    saveDelegationMode(f.state,'profile_routes','owner-op-A');
    assert.deepEqual(readDelegationConfig(f.state),{...original,mode:'profile_routes'});
    saveDelegationMode(f.state,'default','owner-op-B');
    saveDelegationMode(f.state,'profile_routes','owner-op-A');
    assert.deepEqual(readDelegationConfig(f.state),{...original,mode:'default'});
    const reopened=new State(f.dir);try{
      saveDelegationMode(reopened,'profile_routes','owner-op-A');
      assert.deepEqual(readDelegationConfig(reopened),{...original,mode:'default'});
    }finally{reopened.close();}
  }finally{f.close();}
});
test('AD review: invalid allowlists/defaults are refused without changing existing configuration',async()=>{
  const f=fixture();try{
    const original=await saveDelegationConfig(f.state,f.models,f.full());
    const badConfigs:Config[]=[];
    let bad=structuredClone(original);bad.modelMap.options.push({...bad.modelMap.options[0]});badConfigs.push(bad);
    bad=structuredClone(original);bad.modelMap.default='missing';badConfigs.push(bad);
    bad=structuredClone(original);bad.profileRoutes.default='missing';badConfigs.push(bad);
    bad=structuredClone(original);bad.profileRoutes.profiles.push({...bad.profileRoutes.profiles[0]});badConfigs.push(bad);
    bad=structuredClone(original);bad.profiles=[];badConfigs.push(bad);
    bad=structuredClone(original);bad.modelMap={options:[]};badConfigs.push(bad);
    bad=structuredClone(original);bad.mode='profile_routes';bad.profileRoutes={profiles:[]};badConfigs.push(bad);
    for(const candidate of badConfigs){
      await assert.rejects(saveDelegationConfig(f.state,f.models,candidate));
      assert.deepEqual(readDelegationConfig(f.state),original);
    }
  }finally{f.close();}
});
test('AD review: unsupported config fields and inline secrets fail closed with redacted errors',async()=>{
  const f=fixture();try{
    const original=await saveDelegationConfig(f.state,f.models,f.full());
    for(const forbidden of [{api_key:ENDPOINT_KEY},{apiKey:ENDPOINT_KEY},{fallback_providers:['anthropic']},{base_url:'https://not-configured.invalid/v1'},{api_mode:'unimplemented'}]){
      const candidate={...original,defaultRoute:{...f.route,...forbidden}};
      await assert.rejects(saveDelegationConfig(f.state,f.models,candidate),(error:unknown)=>{
        assert.doesNotMatch(String(error),/DO-NOT-DISCLOSE|not-configured\.invalid/);
        return /Invalid delegation configuration/.test(String(error));
      });
      assert.deepEqual(readDelegationConfig(f.state),original);
    }
    for(const patch of [{mode:'invented'},{version:2},{unrecognized:ENDPOINT_KEY}]){
      await assert.rejects(saveDelegationConfig(f.state,f.models,patch));
      assert.deepEqual(readDelegationConfig(f.state),original);
    }
  }finally{f.close();}
});
test('AD review: endpoint routes cannot forward backend provider credentials or infer auth',async()=>{
  const f=fixture();try{
    for(const credential of [undefined,{kind:'provider',provider:'openai'}] as const){
      const route=endpoint();delete route.credential;if(credential)route.credential=credential;
      await assert.rejects(validateRoute(route,f.models,f.state),/explicit dedicated secret reference or keyless/);
    }
    await validateRoute(endpoint(),f.models,f.state);
    await validateRoute(endpoint({credential:{kind:'none'}}),f.models,f.state);
    await assert.rejects(validateRoute(endpoint({credential:{kind:'secret',name:'absent'}}),f.models,f.state),/credential reference is missing/);
    await assert.rejects(validateRoute({...f.route,credential:{kind:'none'}},f.models,f.state),/explicit custom endpoint/);
    await assert.rejects(validateRoute({...f.route,credential:{kind:'provider',provider:'anthropic'}},f.models,f.state),/must match/);
  }finally{f.close();}
});
test('AD review: unsafe/credential-bearing endpoints and invalid capability claims are rejected',async()=>{
  const f=fixture();try{
    for(const baseUrl of ['http://example.invalid/v1','https://user:DO-NOT-DISCLOSE@example.invalid/v1','https://example.invalid/v1?api_key=DO-NOT-DISCLOSE','https://example.invalid/v1#DO-NOT-DISCLOSE','file:///tmp/model.sock','not-a-url']){
      const route=endpoint();route.endpoint!.baseUrl=baseUrl;
      await assert.rejects(validateRoute(route,f.models,f.state),(error:unknown)=>{
        assert.doesNotMatch(String(error),/DO-NOT-DISCLOSE/);return /endpoint/.test(String(error));
      });
    }
    for(const baseUrl of ['http://localhost:9876/v1','http://[::1]:9876/v1','https://example.invalid/v1']){
      const route=endpoint();route.endpoint!.baseUrl=baseUrl;await validateRoute(route,f.models,f.state);
    }
    const tooLong=endpoint();tooLong.endpoint!.maxTokens=tooLong.endpoint!.contextWindow+1;
    await assert.rejects(validateRoute(tooLong,f.models,f.state),/maxTokens/);
    const duplicate=endpoint();duplicate.endpoint!.thinkingLevels=['off','off'];
    await assert.rejects(validateRoute(duplicate,f.models,f.state),/Duplicate endpoint thinking level/);
  }finally{f.close();}
});
test('AD review: missing auth never falls through to a different configured provider or secret',async()=>{
  const f=fixture();try{
    f.credentials.delete('openai');
    f.credentials.set('anthropic',{type:'api_key',key:'sk-ant-review-unused'});
    await assert.rejects(validateRoute(f.route,f.models,f.state),/authentication is not configured/);
    await validateRoute({...f.route,credential:{kind:'secret',name:'review-profile'}},f.models,f.state);
    await assert.rejects(validateRoute({...f.route,credential:{kind:'secret',name:'absent'}},f.models,f.state),/credential reference is missing/);
    await assert.rejects(validateRoute({...f.route,provider:'not-installed'},f.models,f.state),/unknown configured provider or model/);
    await assert.rejects(validateRoute({...f.route,model:'not-a-real-catalog-model'},f.models,f.state),/unknown configured provider or model/);
  }finally{f.close();}
});
test('AD review: unsupported reasoning and speed tiers are rejected rather than silently downgraded',async()=>{
  const f=fixture();try{
    await assert.rejects(validateRoute({...f.route,reasoning_effort:'high'},f.models,f.state),/thinking effort is unsupported/);
    await assert.rejects(validateRoute({...f.route,service_tier:'ultrafast'},f.models,f.state),/Ultrafast is not supported/);
    await assert.rejects(validateRoute({...endpoint(),service_tier:'fast'},f.models,f.state),/Fast requires/);
    await validateRoute({...f.route,service_tier:'normal'},f.models,f.state);
    await validateRoute({...f.route,service_tier:'fast'},f.models,f.state);
    // Metadata-only auth checks must not attempt token refresh or inference.
    f.credentials.set('openai',{type:'oauth',access:'review-only-access',refresh:'review-only-refresh',expires:Date.now()+3600000});
    await assert.rejects(validateRoute({...f.route,service_tier:'fast'},f.models,f.state),/subscription/);
    await validateRoute({...f.route,service_tier:'normal'},f.models,f.state);
  }finally{f.close();}
});
test('AD review: profiles must select credentials explicitly, forbid recursive modules and validate cwd',async()=>{
  const f=fixture();try{
    const original=await saveDelegationConfig(f.state,f.models,f.full());
    const badConfigs:Config[]=[];
    let bad=structuredClone(original);delete bad.profiles[0].route.credential;badConfigs.push(bad);
    bad=structuredClone(original);bad.profiles[0].modules=['subagents'];badConfigs.push(bad);
    bad=structuredClone(original);bad.profiles[0].modules=['coding','coding'];badConfigs.push(bad);
    bad=structuredClone(original);bad.profiles[0].skills=['same','same'];badConfigs.push(bad);
    bad=structuredClone(original);bad.profiles[0].cwd='relative';badConfigs.push(bad);
    bad=structuredClone(original);bad.profiles[0].cwd=join(f.dir,'does-not-exist');badConfigs.push(bad);
    for(const candidate of badConfigs){
      await assert.rejects(saveDelegationConfig(f.state,f.models,candidate));
      assert.deepEqual(readDelegationConfig(f.state),original);
    }
  }finally{f.close();}
});
test('AD review: persisted config and printable summaries contain references, never credential material',async()=>{
  const f=fixture();try{
    const config=f.full();config.modelMap.options.push({...endpoint(),name:'private',description:'Dedicated endpoint'});
    const saved=await saveDelegationConfig(f.state,f.models,config);
    for(const value of [JSON.stringify(saved),JSON.stringify(readDelegationConfig(f.state)),describeDelegation(saved)]){
      for(const secret of [PARENT_KEY,PROFILE_KEY,ENDPOINT_KEY])assert.equal(value.includes(secret),false);
    }
    assert.doesNotMatch(describeDelegation(saved),/127\.0\.0\.1|review-endpoint|review-profile/);
    assert.match(describeDelegation(saved),/quick/);
    assert.match(describeDelegation(saved),/reviewer/);
  }finally{f.close();}
});

function runtimeFixture(){
  const dir=mkdtempSync(join(tmpdir(),'bob-delegation-native-review-')),state=new State(dir);
  state.set('modules',{installed:['coding','resources','subagents'],defaults:['coding','resources','subagents']});
  setDelegationSecret(state,'review-profile',PROFILE_KEY);
  const calls:{model:string;provider:string;key?:string;context:any}[]=[];
  const models=createModels({authContext:{env:async()=>undefined,fileExists:async()=>false}});
  const faux=fauxProvider({provider:'review-faux',models:[{id:'parent'},{id:'child'},{id:'other'}],tokensPerSecond:1000000});
  let parentAuthenticated=true;
  models.setProvider({...faux.provider,auth:{apiKey:{name:'Review scoped auth',resolve:async()=>parentAuthenticated?{auth:{apiKey:PARENT_KEY}}:undefined}}});
  faux.setResponses(Array.from({length:150},()=>async(context,options,_state,model)=>{
    calls.push({model:model.id,provider:model.provider,key:options?.apiKey,context});
    const last=context.messages.findLast(m=>m.role!=='system');
    const text=typeof last?.content==='string'?last.content:JSON.stringify(last?.content);
    if(last?.role==='user'&&text.startsWith('review-call:'))return fauxAssistantMessage(fauxToolCall('subagent',JSON.parse(text.slice('review-call:'.length))),{stopReason:'toolUse'});
    return fauxAssistantMessage(model.id==='parent'?'Parent completed':'Reviewed child answer');
  }));
  const full=():Config=>DelegationConfig.parse({version:1,mode:'model_map',defaultRoute:{provider:'review-faux',model:'other'},
    modelMap:{options:[{name:'quick',description:'Quick work',provider:'review-faux',model:'child'},{name:'alternate',description:'Another model',provider:'review-faux',model:'other'}],default:'quick'},
    profileRoutes:{profiles:[{name:'reviewer',description:'Isolated reviewer'}],default:'reviewer'},
    profiles:[{name:'reviewer',route:{provider:'review-faux',model:'child',credential:{kind:'secret',name:'review-profile'}},instructions:'PROFILE_PERSONA_ONLY',skills:['review-selected'],cwd:dir,modules:['resources']}],
  });
  return {dir,state,models,faux,calls,full,disableParentAuth(){parentAuthenticated=false;},close(){state.close();rmSync(dir,{recursive:true,force:true});}};
}
async function createParent(runtime:Pick<Runtime,'harness'>){
  return runtime.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'review-faux',modelId:'parent'},thinkingLevel:'off'}},ctx);
}
function toolSchema(agent:Awaited<ReturnType<Conversation['agent']>>){
  const tool=agent.tools.find(t=>t.name==='subagent');assert.ok(tool,'subagent tool is selected');return tool.parameters as any;
}
async function callSubagent(runtime:Pick<Runtime,'harness'>,chat:Conversation,args:Record<string,unknown>,authorized=true){
  const requestId=randomUUID();
  if(authorized)await chat.commit(async tx=>{(await tx.doc(ChatMeta,chat.id)).subagentRequests=[requestId];},ctx);
  const submission=await chat.submit({type:'input',requestId,content:'review-call:'+JSON.stringify(args),entry:{kind:'bob.user',data:{text:'review fixture',requestId}}},ctx);
  const settled=await submission.wait(ctx);assert.equal(settled.status,'done');
  const entries=(await chat.entries({order:'descending'},100,undefined,ctx)).items;
  const result=entries.flatMap(entry=>entry.model??[]).find(message=>message.role==='toolResult'&&message.toolName==='subagent');
  assert.ok(result,'actual native subagent tool result exists');return result as any;
}
async function settleReporters(runtime:Runtime,chat:Conversation){
  for(const reporter of Object.values((await runtime.harness.snapshot(Subagents,chat.id,ctx))?.reporters??{}))await runtime.harness.waitForTask(reporter,ctx);
  await chat.waitForIdle(ctx);
}
async function counts(runtime:Runtime){
  return runtime.harness.commit(async tx=>({conversations:(await tx.scanConversations({},100)).items.length,tasks:(await tx.scanTasks({},100)).items.filter(t=>t.kind==='app.subagent-anchor'||t.kind==='app.subagent-reporter').length}),ctx);
}
async function installProfileSkills(runtime:Runtime){
  await runtime.library.commit(async tx=>{const library=await tx.doc(Library,runtime.library.id);
    library.instructions='GLOBAL_PERSONA_MUST_NOT_LEAK';
    library.skills['review-selected']={description:'Selected skill',markdown:'PROFILE_SELECTED_SKILL',enabled:false};
    library.skills['review-unselected']={description:'Unselected skill',markdown:'GLOBAL_UNSELECTED_SKILL_MUST_NOT_LEAK',enabled:true};
  },ctx);
}

test('AD review native: schemas reveal only allowlisted names/descriptions and remain frozen across reopen', {timeout:20000},async()=>{
  const f=runtimeFixture();let runtime:Runtime|undefined;
  try{
    const initial=await saveDelegationConfig(f.state,f.models,f.full());
    runtime=await openRuntime(f.state,f.models,undefined,{resume:false});
    const first=await createParent(runtime),before=toolSchema(await first.agent(ctx));
    const encoded=JSON.stringify(before);
    assert.equal(before.additionalProperties,false);
    assert.ok(before.properties.option);assert.equal(before.properties.profile,undefined);
    assert.match(encoded,/quick/);assert.match(encoded,/alternate/);
    assert.doesNotMatch(encoded,/review-faux|review-profile|PROFILE_PERSONA_ONLY|DO-NOT-DISCLOSE/);
    const changed={...initial,mode:'profile_routes' as const};
    await saveDelegationConfig(f.state,f.models,changed);
    const second=await createParent(runtime);
    assert.ok(toolSchema(await second.agent(ctx)).properties.profile);
    assert.deepEqual(toolSchema(await first.agent(ctx)),before);
    assert.deepEqual((await runtime.harness.snapshot(DelegationSession,first.id,ctx))?.config,initial);
    await runtime.close();runtime=await openRuntime(f.state,f.models,undefined,{resume:false});
    const reopened=(await runtime.harness.conversation(first.id,ctx))!;
    assert.deepEqual(toolSchema(await reopened.agent(ctx)),before);
    assert.ok(toolSchema(await (await runtime.harness.conversation(second.id,ctx))!.agent(ctx)).properties.profile);
    assert.deepEqual(delegationSchema(initial),before);
  }finally{await runtime?.close();f.close();}
});
test('AD review native: selected route executes with original provider identity; reports retain native exact-once provenance', {timeout:20000},async()=>{
  const f=runtimeFixture();let runtime:Runtime|undefined;
  try{
    await saveDelegationConfig(f.state,f.models,f.full());runtime=await openRuntime(f.state,f.models);
    const chat=await createParent(runtime);
    const result=await callSubagent(runtime,chat,{action:'spawn',name:'route-child',message:'child-task',option:'quick'});
    assert.equal(result.isError,false,JSON.stringify(result.content));
    await settleReporters(runtime,chat);
    const state=(await runtime.harness.snapshot(Subagents,chat.id,ctx))!,childId=state.agents['route-child'].conversationId;
    const child=(await runtime.harness.conversation(childId,ctx))!,agent=await child.agent(ctx);
    assert.equal(agent.model?.modelId,'child');assert.equal(agent.tools.some(t=>t.name==='subagent'),false);assert.equal(agent.callable.some(t=>t.name==='subagent'),false);
    assert.ok(f.calls.some(call=>call.model==='child'&&call.provider==='review-faux'&&call.key===PARENT_KEY));
    const observation=(await runtime.harness.snapshot(DelegationChild,childId,ctx))?.observation;
    assert.equal(observation?.label,'quick');assert.equal(observation?.model,'child');
    assert.match(JSON.stringify(result),/quick/);assert.match(JSON.stringify(result),/review-faux/);
    const reporterIds=Object.values(state.reporters);assert.equal(reporterIds.length,1);
    const receipt=await runtime.harness.commit(tx=>tx.submissionByRequest(chat.id,'subagent-report:'+reporterIds[0]),ctx);assert.equal(receipt?.status,'done');
    const report=await runtime.harness.commit(tx=>tx.entry(receipt!.entry!),ctx);assert.match(JSON.stringify(report?.model),/Delegation route: quick/);
    assert.equal(runtime.registry.snapshot().task('app.subagent-anchor'),SubagentTools.tasks![0]);
    assert.equal(runtime.registry.snapshot().task('app.subagent-reporter'),SubagentTools.tasks![1]);
    assert.equal(runtime.modules.subagents.tools![0].replay,'unsafe');
    const before=(await chat.entries({},100,undefined,ctx)).items;
    await runtime.close();runtime=await openRuntime(f.state,f.models);
    const restored=(await runtime.harness.conversation(chat.id,ctx))!;await restored.waitForIdle(ctx);
    assert.deepEqual((await restored.entries({},100,undefined,ctx)).items,before,'restart must not repeat a native report');
    const status=await callSubagent(runtime,restored,{action:'status',name:'route-child'},false);assert.match(JSON.stringify(status.content),/quick/);
    // Adaptive delegation intentionally extends native-run authorization to send as well
    // as spawn. A denial must not schedule work; an explicitly authorized send still works.
    const beforeDeniedSend=await counts(runtime);
    const deniedSend=await callSubagent(runtime,restored,{action:'send',name:'route-child',message:'unauthorized child-task',followUp:true},false);
    assert.equal(deniedSend.isError,true);assert.match(JSON.stringify(deniedSend.content),/authority|authorization/i);
    assert.deepEqual(await counts(runtime),beforeDeniedSend,'unauthorized send must not create a reporter or child');
    const sent=await callSubagent(runtime,restored,{action:'send',name:'route-child',message:'second child-task',followUp:true});assert.equal(sent.isError,false);
    await settleReporters(runtime,restored);
    const stopped=await callSubagent(runtime,restored,{action:'stop',name:'route-child'},false);assert.equal(stopped.isError,false);
    const afterward=(await runtime.harness.conversation(childId,ctx))!;assert.equal((await afterward.agent(ctx)).tools.some(t=>t.name==='subagent'),false);
  }finally{await runtime?.close();f.close();}
});
test('AD review native: failed validation and in-commit profile skill failure create no child, anchor or reporter', {timeout:20000},async()=>{
  const f=runtimeFixture();let runtime:Runtime|undefined;
  try{
    const config=f.full();config.mode='profile_routes';config.profiles[0].skills=['does-not-exist'];
    await saveDelegationConfig(f.state,f.models,config);runtime=await openRuntime(f.state,f.models);
    const chat=await createParent(runtime),before=await counts(runtime);
    let result=await callSubagent(runtime,chat,{action:'spawn',name:'rolled-back',message:'child-task',profile:'reviewer'});
    assert.equal(result.isError,true);assert.match(JSON.stringify(result.content),/skill is missing/);
    assert.deepEqual(await counts(runtime),before,'failure after native creation must rollback all creation writes');
    assert.equal((await runtime.harness.snapshot(Subagents,chat.id,ctx))?.agents['rolled-back'],undefined);
    f.state.delete('delegationSecret:review-profile');
    result=await callSubagent(runtime,chat,{action:'spawn',name:'missing-credential',message:'child-task',profile:'reviewer'});
    assert.equal(result.isError,true);assert.match(JSON.stringify(result.content),/credential reference is missing/);
    assert.deepEqual(await counts(runtime),before);
    result=await callSubagent(runtime,chat,{action:'spawn',name:'unauthorized',message:'child-task'},false);
    assert.equal(result.isError,true);assert.deepEqual(await counts(runtime),before);
  }finally{await runtime?.close();f.close();}
});
test('AD review native: same-label route edits and changed modes fail closed without changing the frozen schema', {timeout:20000},async()=>{
  const f=runtimeFixture();let runtime:Runtime|undefined;
  try{
    const config=await saveDelegationConfig(f.state,f.models,f.full());runtime=await openRuntime(f.state,f.models);
    const chat=await createParent(runtime),schema=toolSchema(await chat.agent(ctx)),before=await counts(runtime);
    const changed=structuredClone(config);changed.modelMap.options[0].model='other';await saveDelegationConfig(f.state,f.models,changed);
    let result=await callSubagent(runtime,chat,{action:'spawn',name:'stale-label',message:'child-task',option:'quick'});
    assert.equal(result.isError,true);assert.match(JSON.stringify(result.content),/--now/);assert.deepEqual(await counts(runtime),before);
    await saveDelegationConfig(f.state,f.models,{...config,mode:'profile_routes'});
    result=await callSubagent(runtime,chat,{action:'spawn',name:'stale-mode',message:'child-task',option:'quick'});
    assert.equal(result.isError,true);assert.match(JSON.stringify(result.content),/--now/);assert.deepEqual(await counts(runtime),before);
    assert.deepEqual(toolSchema(await chat.agent(ctx)),schema);
    assert.equal(f.calls.some(call=>call.model!=='parent'),false,'no model route may run after a stale selection');
  }finally{await runtime?.close();f.close();}
});
test('AD review native: profiles isolate auth/persona/skills/modules and retain credential isolation after reopen', {timeout:20000},async()=>{
  const f=runtimeFixture();let runtime:Runtime|undefined;
  try{
    const config=f.full();config.mode='profile_routes';await saveDelegationConfig(f.state,f.models,config);
    runtime=await openRuntime(f.state,f.models);await installProfileSkills(runtime);
    const chat=await createParent(runtime),result=await callSubagent(runtime,chat,{action:'spawn',name:'isolated',message:'child-task',profile:'reviewer'});
    assert.equal(result.isError,false,JSON.stringify(result.content));await settleReporters(runtime,chat);
    const registry=(await runtime.harness.snapshot(Subagents,chat.id,ctx))!,id=registry.agents.isolated.conversationId;
    const child=(await runtime.harness.conversation(id,ctx))!,agent=await child.agent(ctx);
    assert.equal(agent.cwd,f.dir);assert.match(agent.instructions??'',/PROFILE_PERSONA_ONLY/);
    assert.equal(agent.tools.some(tool=>['subagent','bash','read','write'].includes(tool.name)),false);
    const childRequest=f.calls.find(call=>call.model==='child');assert.ok(childRequest);assert.equal(childRequest.key,PROFILE_KEY);
    const prompt=JSON.stringify(childRequest.context);
    assert.match(prompt,/PROFILE_PERSONA_ONLY/);assert.match(prompt,/PROFILE_SELECTED_SKILL/);
    assert.doesNotMatch(prompt,/GLOBAL_PERSONA_MUST_NOT_LEAK|GLOBAL_UNSELECTED_SKILL_MUST_NOT_LEAK|DO-NOT-DISCLOSE/);
    const ref=agent.model!;assert.equal((await runtime.models.getAuth(ref.provider))?.auth.apiKey,PROFILE_KEY);
    await runtime.close();runtime=await openRuntime(f.state,f.models,undefined,{resume:false});
    assert.equal((await runtime.models.getAuth(ref.provider))?.auth.apiKey,PROFILE_KEY);
    f.state.delete('delegationSecret:review-profile');
    assert.equal(await runtime.models.getAuth(ref.provider),undefined,'removed profile credential must not fall back to main credential');
    assert.equal((await runtime.models.getAuth('review-faux'))?.auth.apiKey,PARENT_KEY);
    assert.equal((await (await runtime.harness.conversation(id,ctx))!.agent(ctx)).tools.some(t=>t.name==='subagent'),false);
  }finally{await runtime?.close();f.close();}
});
test('AD review native: pending background tasks make a session unsettled before any --now change', {timeout:15000},async()=>{
  const f=runtimeFixture();let runtime:Runtime|undefined;
  try{
    runtime=await openRuntime(f.state,f.models,undefined,{resume:false});const chat=await createParent(runtime);
    const held=defineTask<null,{phase:'hold'},null>({name:'review.delegation-pending',version:1,initial:()=>({phase:'hold'}),phases:{hold:async()=>{throw Error('Paused test task must not execute');}}});
    runtime.registry.install(defineExtension({name:'review.pending-extension',tasks:[held]}));
    const task=await chat.commit(tx=>tx.createTask(held,null,{ownership:{kind:'conversation'},background:true}),ctx);
    assert.equal((await runtime.harness.getTask(task,ctx))?.state.status,'pending');
    await assert.rejects(chat.commit(tx=>requireDelegationSettled(tx,chat.id),ctx),/settle/);
  }finally{await runtime?.close();f.close();}
});
test('AD review native: authenticated module reselection retains the exact session routing schema', {timeout:20000},async()=>{
  const f=runtimeFixture();let runtime:Runtime|undefined,app:Awaited<ReturnType<typeof serve>>|undefined;
  try{
    await saveDelegationConfig(f.state,f.models,f.full());runtime=await openRuntime(f.state,f.models);
    const chat=await createParent(runtime),schema=toolSchema(await chat.agent(ctx));
    app=await serve(f.state,{port:0,runtime});const pair=f.state.pair(f.state.invite().token,'review owner');
    const headers={authorization:'Bearer '+pair.credential,'x-bob-backend':f.state.id,'content-type':'application/json'};
    const base=`http://127.0.0.1:${(app.server.address() as any).port}/v1/chats/${chat.id}/modules`;
    for(const ids of [['resources'],['resources','subagents']]){
      const response=await fetch(base,{method:'PUT',headers,body:JSON.stringify({ids})});assert.equal(response.status,200,await response.text());
    }
    assert.deepEqual(toolSchema(await chat.agent(ctx)),schema);
    const result=await callSubagent(runtime,chat,{action:'spawn',name:'after-modules',message:'child-task',option:'quick'});
    assert.equal(result.isError,false,JSON.stringify(result.content));await settleReporters(runtime,chat);
  }finally{if(app)await app.close();else await runtime?.close();f.close();}
});
test('AD review native: a fork preserves disabled modules instead of rebuilding from host defaults', {timeout:15000},async()=>{
  const f=runtimeFixture();let runtime:Runtime|undefined;
  try{
    await saveDelegationConfig(f.state,f.models,f.full());runtime=await openRuntime(f.state,f.models,undefined,{resume:false});
    const chat=await createParent(runtime),selection=await runtime.delegation.selectedExtensions(runtime.harness,chat,[runtime.modules.resources]);
    await chat.configure({extensions:selection},ctx);
    const entry=await chat.commit(tx=>tx.appendEntry(chat.id,{kind:'review.fork-point',data:{text:'fork here'}}),ctx);
    const fork=await chat.fork(entry.id,{ownership:{kind:'ownerless'}},ctx);
    assert.equal((await fork.agent(ctx)).tools.some(t=>t.name==='subagent'),false,'fork must not revive an explicitly disabled module');
    assert.equal((await fork.agent(ctx)).tools.some(t=>t.name==='bash'),false);
    assert.deepEqual((await runtime.harness.snapshot(DelegationSession,fork.id,ctx))?.config,(await runtime.harness.snapshot(DelegationSession,chat.id,ctx))?.config);
  }finally{await runtime?.close();f.close();}
});

async function commandReply(runtime:Runtime,chat:Conversation,requestId:string){
  const receipt=await runtime.harness.commit(tx=>tx.submissionByRequest(chat.id,requestId),ctx);
  assert.ok(receipt);assert.equal(receipt.type,'input');assert.equal(receipt.status,'done');
  const answer=await runtime.harness.commit(tx=>tx.entry((receipt as any).answer),ctx);
  return {receipt,text:JSON.stringify(answer?.model),answer};
}
async function addPendingCommand(runtime:Runtime,chat:Conversation,state:State,requestId:string,mode:'default'|'model_map'|'profile_routes',now:boolean){
  const intent={text:`/delegation ${mode}${now?' --now':''}`,clientRequestId:randomUUID(),mode,now,expected:delegationVersion(state)};
  await chat.commit(async tx=>{(await tx.doc(DelegationCommands,chat.id)).pending[requestId]=intent;},ctx);
  return intent;
}
async function addHeldTask(runtime:Runtime,chat:Conversation){
  const held=defineTask<null,{phase:'hold'},null>({name:'review.command-held',version:1,initial:()=>({phase:'hold'}),phases:{hold:async()=>{throw Error('Paused fixture should never run');}}});
  runtime.registry.install(defineExtension({name:'review.command-held-extension',tasks:[held]}));
  return chat.commit(tx=>tx.createTask(held,null,{ownership:{kind:'conversation'},background:true}),ctx);
}

test('AD review command: authenticated HTTP replay/readback needs no model credentials, preserves questions, and displays native entries', {timeout:20000},async()=>{
  const f=runtimeFixture();let runtime:Runtime|undefined,app:Awaited<ReturnType<typeof serve>>|undefined;
  try{
    f.disableParentAuth();runtime=await openRuntime(f.state,f.models,undefined,{resume:false});
    const chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
    const pending={id:'unrelated-owner-question',text:'Which existing question answer?'};
    await chat.commit(async tx=>{(await tx.doc(Questions,chat.id)).pending=pending;},ctx);
    app=await serve(f.state,{port:0,runtime});const device=f.state.pair(f.state.invite().token,'command-review');
    const headers={authorization:'Bearer '+device.credential,'x-bob-backend':f.state.id,'content-type':'application/json'};
    const base=`http://127.0.0.1:${(app.server.address() as any).port}/v1/chats/${chat.id}`;
    const requestId=randomUUID(),message={requestId,text:'/delegation default --now',mode:'steer',allowSubagents:true};
    assert.equal((await fetch(base+'/messages',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(message)})).status,401);
    const responses=await Promise.all(Array.from({length:3},()=>fetch(base+'/messages',{method:'POST',headers,body:JSON.stringify(message)})));
    const receipts=[];for(const response of responses){assert.equal(response.status,200,await response.clone().text());receipts.push(await response.json() as any);}
    assert.ok(receipts[0].id);assert.equal(receipts[0].status,'done');assert.equal(receipts[0].type,'input');assert.ok(receipts[0].entry);assert.ok(receipts[0].answer);
    assert.ok(receipts.every(receipt=>receipt.id===receipts[0].id&&receipt.answer===receipts[0].answer));
    const version=delegationVersion(f.state);
    const readback=await(await fetch(base+'/operations/'+requestId,{headers})).json() as any;
    assert.equal(readback.admission.id,receipts[0].id);assert.equal(readback.reply.id,receipts[0].answer);assert.match(readback.reply.text,/No inference was used/);
    assert.equal(readback.question.id,pending.id);assert.deepEqual((await runtime.harness.snapshot(Questions,chat.id,ctx))?.pending,pending);
    const entries=(await chat.entries({},100,undefined,ctx)).items;
    assert.equal(entries.filter(entry=>entry.kind==='bob.user'&&(entry.data as any)?.requestId===requestId).length,1);
    assert.equal(entries.filter(entry=>entry.kind==='pi.assistant'&&(entry.data as any)?.command==='delegation').length,1);
    assert.equal((await runtime.harness.snapshot(ChatMeta,chat.id,ctx))?.subagentRequests?.length??0,0,'command must not grant spawn authorization');
    assert.equal((await runtime.harness.snapshot(LiveDoc,chat.id,ctx))?.run,undefined);
    assert.deepEqual((await runtime.harness.snapshot(InboxDoc,chat.id,ctx))?.items,[]);
    assert.equal(f.faux.state.callCount,0);
    const repeated=await fetch(base+'/messages',{method:'POST',headers,body:JSON.stringify(message)});assert.equal(repeated.status,200);
    assert.deepEqual(delegationVersion(f.state),version);
    for(const text of ['How does /delegation work?','/delegationary is not a command']){
      assert.equal(parseDelegationCommand(text),undefined);
      const normal=await fetch(base+'/messages',{method:'POST',headers,body:JSON.stringify({...message,requestId:randomUUID(),text})});
      assert.equal(normal.status,412,'ordinary owner text must continue through normal model admission');
    }
    assert.deepEqual((await runtime.harness.snapshot(Questions,chat.id,ctx))?.pending,pending);
  }finally{if(app)await app.close();else await runtime?.close();f.close();}
});
test('AD review command: initial busy --now refusal leaves config/snapshot/intents unchanged and is idempotent', {timeout:15000},async()=>{
  const f=runtimeFixture();let runtime:Runtime|undefined;
  try{
    await saveDelegationConfig(f.state,f.models,f.full());runtime=await openRuntime(f.state,f.models,undefined,{resume:false});
    const chat=await createParent(runtime);await addHeldTask(runtime,chat);
    const config=readDelegationConfig(f.state),version=delegationVersion(f.state),snapshot=await runtime.harness.snapshot(DelegationSession,chat.id,ctx);
    const requestId='device:review:'+randomUUID(),client=randomUUID();
    const first=await handleDelegationCommand(f.state,runtime.harness,runtime.delegation,chat,'/delegation default --now',requestId,client);
    assert.equal(first?.status,'done');
    assert.deepEqual(readDelegationConfig(f.state),config);assert.deepEqual(delegationVersion(f.state),version);
    assert.deepEqual(await runtime.harness.snapshot(DelegationSession,chat.id,ctx),snapshot);
    assert.deepEqual((await runtime.harness.snapshot(DelegationCommands,chat.id,ctx))?.pending??{},{});
    assert.match((await commandReply(runtime,chat,requestId)).text,/No settings changed/);
    const repeat=await handleDelegationCommand(f.state,runtime.harness,runtime.delegation,chat,'/delegation default --now',requestId,client);
    assert.deepEqual(repeat,first);assert.deepEqual(delegationVersion(f.state),version);assert.equal(f.faux.state.callCount,0);
  }finally{await runtime?.close();f.close();}
});
test('AD review command: a persisted intent that becomes busy saves only future defaults and explains the skipped refresh', {timeout:15000},async()=>{
  const f=runtimeFixture();let runtime:Runtime|undefined;
  try{
    await saveDelegationConfig(f.state,f.models,f.full());runtime=await openRuntime(f.state,f.models,undefined,{resume:false});
    const chat=await createParent(runtime),snapshot=await runtime.harness.snapshot(DelegationSession,chat.id,ctx),requestId='review-race:'+randomUUID();
    await addPendingCommand(runtime,chat,f.state,requestId,'default',true);
    const task=await addHeldTask(runtime,chat);
    await recoverDelegationCommands(f.state,runtime.harness,runtime.delegation);
    assert.equal(readDelegationConfig(f.state).mode,'default');
    assert.deepEqual(await runtime.harness.snapshot(DelegationSession,chat.id,ctx),snapshot);
    assert.match((await commandReply(runtime,chat,requestId)).text,/saved for new chats.*became busy/);
    assert.equal((await runtime.harness.getTask(task,ctx))?.state.status,'pending');
    assert.deepEqual((await runtime.harness.snapshot(DelegationCommands,chat.id,ctx))?.pending,{});
    assert.equal(f.faux.state.callCount,0);
  }finally{await runtime?.close();f.close();}
});
test('AD review command: reopen recovers intent before or after control effect exactly once without inference', {timeout:20000},async()=>{
  for(const controlAlreadySaved of [false,true]){
    const f=runtimeFixture();let runtime:Runtime|undefined;
    try{
      await saveDelegationConfig(f.state,f.models,f.full());runtime=await openRuntime(f.state,f.models,undefined,{resume:false});
      const chat=await createParent(runtime),requestId='review-recover:'+randomUUID();
      const intent=await addPendingCommand(runtime,chat,f.state,requestId,'default',true);
      if(controlAlreadySaved)saveDelegationMode(f.state,intent.mode,`${chat.id}:${requestId}`,intent.expected);
      await runtime.close();runtime=await openRuntime(f.state,f.models,undefined,{resume:false});
      const restored=(await runtime.harness.conversation(chat.id,ctx))!;
      assert.equal(readDelegationConfig(f.state).mode,'default');
      assert.equal((await runtime.harness.snapshot(DelegationSession,restored.id,ctx))?.config?.mode,'default');
      const result=await commandReply(runtime,restored,requestId);assert.match(result.text,/saved and applied/);
      const version=delegationVersion(f.state),entries=(await restored.entries({},100,undefined,ctx)).items;
      await recoverDelegationCommands(f.state,runtime.harness,runtime.delegation);
      const repeated=await handleDelegationCommand(f.state,runtime.harness,runtime.delegation,restored,intent.text,requestId,intent.clientRequestId);
      assert.deepEqual(repeated,result.receipt);assert.deepEqual(delegationVersion(f.state),version);
      assert.deepEqual((await restored.entries({},100,undefined,ctx)).items,entries);
      assert.deepEqual((await runtime.harness.snapshot(DelegationCommands,restored.id,ctx))?.pending,{});
      assert.equal(f.faux.state.callCount,0);
    }finally{await runtime?.close();f.close();}
  }
});
test('AD review command: stale pending intents and old applied effects never overwrite newer global settings or schemas', {timeout:20000},async()=>{
  for(const controlAlreadySaved of [false,true]){
    const f=runtimeFixture();let runtime:Runtime|undefined;
    try{
      await saveDelegationConfig(f.state,f.models,f.full());runtime=await openRuntime(f.state,f.models,undefined,{resume:false});
      const chat=await createParent(runtime),requestId='review-superseded:'+randomUUID(),snapshot=await runtime.harness.snapshot(DelegationSession,chat.id,ctx);
      const intent=await addPendingCommand(runtime,chat,f.state,requestId,'default',true);
      if(controlAlreadySaved)saveDelegationMode(f.state,intent.mode,`${chat.id}:${requestId}`,intent.expected);
      saveDelegationMode(f.state,'profile_routes','newer-owner-change');const version=delegationVersion(f.state);
      await runtime.close();runtime=await openRuntime(f.state,f.models,undefined,{resume:false});
      const restored=(await runtime.harness.conversation(chat.id,ctx))!;
      assert.equal(readDelegationConfig(f.state).mode,'profile_routes');assert.deepEqual(delegationVersion(f.state),version);
      assert.deepEqual(await runtime.harness.snapshot(DelegationSession,chat.id,ctx),snapshot);
      assert.match((await commandReply(runtime,restored,requestId)).text,/superseded/);
      assert.equal(f.faux.state.callCount,0);
    }finally{await runtime?.close();f.close();}
  }
});

test('AD review provider: synchronous adapter failures cannot expose credential material in model errors',async()=>{
  const f=fixture();try{
    const original=f.models.getProvider('openai')!;
    f.models.setProvider({...original,streamSimple(){throw Error('Adapter rejected '+PROFILE_KEY);},stream(){throw Error('Adapter rejected '+PROFILE_KEY);}});
    const aliases=createDelegationModels(f.models,f.state),ref=aliases.install({...f.route,credential:{kind:'secret',name:'review-profile'}});
    const model=aliases.models.getModel(ref.provider,ref.modelId)!;
    const response=await aliases.models.completeSimple(model,{messages:[{role:'user',content:'local fixture',timestamp:Date.now()}]});
    assert.equal(response.stopReason,'error');
    assert.equal(JSON.stringify(response).includes(PROFILE_KEY),false,'synchronous provider throws must be sanitized too');
  }finally{f.close();}
});
test('AD review native: a fork of an actual child remains unable to delegate after restart or module reselection', {timeout:20000},async()=>{
  const f=runtimeFixture();let runtime:Runtime|undefined;
  try{
    const config=f.full();config.mode='profile_routes';config.profiles[0].modules=['coding'];
    await saveDelegationConfig(f.state,f.models,config);runtime=await openRuntime(f.state,f.models);await installProfileSkills(runtime);
    const chat=await createParent(runtime);assert.equal((await callSubagent(runtime,chat,{action:'spawn',name:'child-fork-source',message:'child-task',profile:'reviewer'})).isError,false);
    await settleReporters(runtime,chat);
    const id=(await runtime.harness.snapshot(Subagents,chat.id,ctx))!.agents['child-fork-source'].conversationId;
    const child=(await runtime.harness.conversation(id,ctx))!,entries=(await child.entries({order:'descending'},100,undefined,ctx)).items;
    const fork=await child.fork(entries[0].id,{ownership:{kind:'ownerless'}},ctx);
    assert.equal((await fork.agent(ctx)).tools.some(t=>t.name==='subagent'),false);
    assert.match(JSON.stringify(f.calls.find(call=>call.model==='child')?.context),/Follow the current delegation policy and permissions/);
    assert.match(JSON.stringify(f.calls.find(call=>call.model==='child')?.context),/You cannot start subagents/);
    assert.doesNotMatch(JSON.stringify(f.calls.find(call=>call.model==='child')?.context),/GLOBAL_UNSELECTED_SKILL_MUST_NOT_LEAK/);
    await assert.rejects(runtime.delegation.selectedExtensions(runtime.harness,fork,[runtime.modules.subagents]),/recursive/);
    await runtime.close();runtime=await openRuntime(f.state,f.models,undefined,{resume:false});
    const restored=(await runtime.harness.conversation(fork.id,ctx))!;
    assert.equal((await restored.agent(ctx)).tools.some(t=>t.name==='subagent'),false);
    await assert.rejects(runtime.delegation.selectedExtensions(runtime.harness,restored,[runtime.modules.subagents]),/recursive/);
  }finally{await runtime?.close();f.close();}
});
test('AD review native: an in-flight native reporter and child recover without duplicate delivery/report', {timeout:25000},async()=>{
  const f=runtimeFixture();let runtime:Runtime|undefined;
  try{
    const slow=fauxProvider({provider:'review-slow',models:[{id:'slow-child'}],tokensPerSecond:500});
    slow.setResponses([fauxAssistantMessage('Long unfinished child answer '.repeat(5000)),fauxAssistantMessage('Recovered child answer')]);f.models.setProvider(slow.provider);
    const config=f.full();config.modelMap.options[0]={...config.modelMap.options[0],provider:'review-slow',model:'slow-child'};
    await saveDelegationConfig(f.state,f.models,config);runtime=await openRuntime(f.state,f.models);
    const chat=await createParent(runtime),result=await callSubagent(runtime,chat,{action:'spawn',name:'recover-child',message:'child-task',option:'quick'});
    assert.equal(result.isError,false,JSON.stringify(result.content));
    const registry=(await runtime.harness.snapshot(Subagents,chat.id,ctx))!,childId=registry.agents['recover-child'].conversationId,reporter=Object.values(registry.reporters)[0];
    for(let i=0;i<100&&slow.state.callCount===0;i++)await delay(5);
    assert.equal(slow.state.callCount,1);assert.ok((await runtime.harness.snapshot(LiveDoc,childId,ctx))?.run);
    const delivered=await runtime.harness.commit(tx=>tx.submissionByRequest(childId,`subagent:${reporter}`),ctx);assert.ok(delivered);
    await chat.abort(ctx);assert.ok((await runtime.harness.snapshot(LiveDoc,childId,ctx))?.run,'parent stop must preserve background child');
    await runtime.close();runtime=await openRuntime(f.state,f.models);
    const restored=(await runtime.harness.conversation(chat.id,ctx))!;await settleReporters(runtime,restored);
    const sameDelivery=await runtime.harness.commit(tx=>tx.submissionByRequest(childId,`subagent:${reporter}`),ctx);assert.equal(sameDelivery?.id,delivered.id);
    const receipt=await runtime.harness.commit(tx=>tx.submissionByRequest(chat.id,`subagent-report:${reporter}`),ctx);assert.equal(receipt?.status,'done');
    const all=(await restored.entries({},100,undefined,ctx)).items;
    assert.equal(all.filter(entry=>entry.kind==='pi.user'&&JSON.stringify(entry.model).includes('[subagent recover-child answered')).length,1);
    assert.equal((await runtime.harness.snapshot(Subagents,chat.id,ctx))?.agents['recover-child'].reported.length,1);
    assert.equal(slow.state.callCount,2,'only the interrupted model request is retried, not child delivery');
    assert.equal((await (await runtime.harness.conversation(childId,ctx))!.agent(ctx)).tools.some(t=>t.name==='subagent'),false);
  }finally{await runtime?.close();f.close();}
});

test('AD review upgrade: original native pending child/reporter resume with legacy defaults, not newly configured routes', {timeout:25000},async()=>{
  const f=runtimeFixture();let legacy:Harness|undefined,runtime:Runtime|undefined;
  try{
    // This is a minimal pre-AD native host, not an old release binary. It writes
    // only original SubagentTools/AgentDoc/ChatMeta state to an isolated fixture.
    const original=f.models.getProvider('review-faux')!;
    const slow=fauxProvider({provider:'review-faux',models:[{id:'parent'}],tokensPerSecond:500});
    slow.setResponses([fauxAssistantMessage('Legacy child still working '.repeat(5000)),fauxAssistantMessage('Legacy child recovered')]);
    f.models.setProvider({...original,streamSimple(model,context,options){
      const last=context.messages.findLast(message=>message.role!=='system');
      return last?.role==='user'&&last.content==='legacy-child'?slow.provider.streamSimple(model,context,options):original.streamSimple(model,context,options);
    }});
    const registry=createRegistry();registry.install(SubagentTools);
    legacy=await Harness.open(await openNodeSqliteStorage(join(f.dir,'durable.sqlite')),{models:f.models,registry,settings:{extensions:[SubagentTools]},conversationCreated:async(tx,conversation)=>{await tx.doc(ChatMeta,conversation.id);}},ctx);
    const root=await legacy.root(ctx);await root.commit(async tx=>{await tx.doc(Library,root.id);},ctx);
    const chat=await createParent({harness:legacy});
    const result=await callSubagent({harness:legacy},chat,{action:'spawn',name:'legacy',message:'legacy-child'});assert.equal(result.isError,false);
    const agents=(await legacy.snapshot(Subagents,chat.id,ctx))!,id=agents.agents.legacy.conversationId,reporter=Object.values(agents.reporters)[0];
    for(let i=0;i<100&&slow.state.callCount===0;i++)await delay(5);
    assert.equal(slow.state.callCount,1);assert.ok((await legacy.snapshot(LiveDoc,id,ctx))?.run);
    assert.equal(await legacy.snapshot(DelegationSession,chat.id,ctx),undefined);
    const delivery=await legacy.commit(tx=>tx.submissionByRequest(id,`subagent:${reporter}`),ctx);assert.ok(delivery);
    await legacy.close(ctx);legacy=undefined;
    // A newly configured default applies to future sessions, not old tasks.
    await saveDelegationConfig(f.state,f.models,f.full());runtime=await openRuntime(f.state,f.models);
    const restored=(await runtime.harness.conversation(chat.id,ctx))!;await settleReporters(runtime,restored);
    assert.equal((await runtime.harness.snapshot(DelegationSession,chat.id,ctx))?.config?.mode,'default');
    assert.equal(toolSchema(await restored.agent(ctx)).properties.option,undefined);
    const child=(await runtime.harness.conversation(id,ctx))!;
    assert.deepEqual((await child.agent(ctx)).model,{provider:'review-faux',modelId:'parent'});
    assert.equal((await child.agent(ctx)).tools.some(tool=>tool.name==='subagent'),false);
    assert.equal((await runtime.harness.commit(tx=>tx.submissionByRequest(id,`subagent:${reporter}`),ctx))?.id,delivery.id);
    assert.equal((await runtime.harness.commit(tx=>tx.submissionByRequest(chat.id,`subagent-report:${reporter}`),ctx))?.status,'done');
    assert.equal((await restored.entries({},100,undefined,ctx)).items.filter(entry=>entry.kind==='pi.user'&&JSON.stringify(entry.model).includes('[subagent legacy answered')).length,1);
    assert.equal(slow.state.callCount,2);
  }finally{await legacy?.close(ctx);await runtime?.close();f.close();}
});

test('AD review provider: requested priority is sent and unconfirmed/downgraded responses are never published',async()=>{
  const f=fixture();try{
    const original=f.models.getProvider('openai')!;
    for(const actualTier of ['priority','default',undefined]){
      let payload:any;
      const stream=(model:any,_context:any,options:any)=>{
        const out=createAssistantMessageEventStream();
        void(async()=>{
          payload=await options.onPayload({model:model.id},model);
          const message={...fauxAssistantMessage('Tier fixture response'),api:model.api,provider:model.provider,model:model.id};
          out.push({type:'start',partial:message});
          await options.onProviderStreamEvent({type:'response.completed',response:actualTier?{service_tier:actualTier}:{}},model);
          out.push({type:'done',reason:'stop',message});out.end(message);
        })();
        return out;
      };
      f.models.setProvider({...original,stream,streamSimple:stream});
      const aliases=createDelegationModels(f.models,f.state),ref=aliases.install({...f.route,service_tier:'fast'}),model=aliases.models.getModel(ref.provider,ref.modelId)!;
      const response=aliases.models.streamSimple(model,{messages:[{role:'user',content:'local tier fixture',timestamp:Date.now()}]});
      const events=[];for await(const event of response)events.push(event);
      const result=await response.result();
      assert.equal(payload.service_tier,'priority');
      assert.equal(events.some(event=>event.type==='start'),false,'unverified partials are not exposed');
      if(actualTier==='priority'){assert.equal(result.stopReason,'stop');assert.equal(events.some(event=>event.type==='done'),true);}
      else{assert.equal(result.stopReason,'error');assert.deepEqual(result.content,[]);assert.match(result.errorMessage??'',/did not confirm/);assert.equal(events.some(event=>event.type==='done'),false);}
    }
  }finally{f.close();}
});
test('AD review command: --now does not overwrite a module selection committed after its agent read', {timeout:15000},async()=>{
  const f=runtimeFixture();let runtime:Runtime|undefined;
  try{
    await saveDelegationConfig(f.state,f.models,f.full());runtime=await openRuntime(f.state,f.models,undefined,{resume:false});
    const chat=await createParent(runtime),selection=await runtime.delegation.selectedExtensions(runtime.harness,chat,[runtime.modules.resources]);
    // Deterministic interleaving: commit an independent owner module edit
    // between native intent admission and the command's final transaction.
    // This still runs if the fix removes the stale out-of-transaction agent read.
    let interleaved=false,commandCommits=0;
    const concurrentChat=new Proxy(chat,{get(target,key){
      if(key==='commit')return async(change:any,context:typeof ctx)=>{if(++commandCommits===2){interleaved=true;await target.configure({extensions:selection},context);}return target.commit(change,context);};
      const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
    }});
    const id='review-module-race:'+randomUUID();
    await handleDelegationCommand(f.state,runtime.harness,runtime.delegation,concurrentChat,'/delegation default --now',id,randomUUID());
    assert.equal(interleaved,true);
    assert.equal((await chat.agent(ctx)).tools.some(tool=>tool.name==='subagent'),false,'refresh must not restore a concurrently disabled capability');
    assert.equal((await chat.agent(ctx)).tools.some(tool=>tool.name==='bash'),false);
    assert.equal((await runtime.harness.snapshot(DelegationSession,chat.id,ctx))?.config?.mode,'default');
  }finally{await runtime?.close();f.close();}
});

test('AD review command: inherited object property names are not mode aliases and cannot corrupt saved configuration', {timeout:15000},async()=>{
  const f=runtimeFixture();let runtime:Runtime|undefined;
  try{
    await saveDelegationConfig(f.state,f.models,f.full());runtime=await openRuntime(f.state,f.models,undefined,{resume:false});
    const chat=await createParent(runtime),before=readDelegationConfig(f.state),version=delegationVersion(f.state);
    for(const word of ['__proto__','constructor','hasOwnProperty','toString']){
      const id='review-invalid-mode:'+randomUUID();
      await handleDelegationCommand(f.state,runtime.harness,runtime.delegation,chat,'/delegation '+word,id,randomUUID());
      assert.deepEqual(readDelegationConfig(f.state),before,'unknown mode must not persist inherited object values');
      assert.deepEqual(delegationVersion(f.state),version);
      assert.match((await commandReply(runtime,chat,id)).text,/Unknown delegation mode/);
      assert.throws(()=>parseDelegationCommand('/delegation '+word),/Unknown delegation mode/);
    }
  }finally{await runtime?.close();f.close();}
});

test('AD review command: native picker changes nothing until timing is chosen and preserves unrelated questions', {timeout:15000},async()=>{
  const f=runtimeFixture();let runtime:Runtime|undefined;
  try{
    await saveDelegationConfig(f.state,f.models,f.full());runtime=await openRuntime(f.state,f.models,undefined,{resume:false});
    const chat=await createParent(runtime),before=readDelegationConfig(f.state),snapshot=await runtime.harness.snapshot(DelegationSession,chat.id,ctx);
    const command=async(text:string,questionId?:string)=>handleDelegationCommand(f.state,runtime!.harness,runtime!.delegation,chat,text,'review-picker:'+randomUUID(),randomUUID(),questionId);
    await command('/delegation');
    let picker=(await runtime.harness.snapshot(DelegationCommands,chat.id,ctx))?.picker;assert.equal(picker?.phase,'mode');
    assert.deepEqual(readDelegationConfig(f.state),before);
    await command('Profile routes',picker!.id);
    picker=(await runtime.harness.snapshot(DelegationCommands,chat.id,ctx))?.picker;assert.equal(picker?.phase,'when');
    assert.deepEqual(readDelegationConfig(f.state),before);
    await command('Next session (recommended)',picker!.id);
    assert.equal(readDelegationConfig(f.state).mode,'profile_routes');
    assert.deepEqual(await runtime.harness.snapshot(DelegationSession,chat.id,ctx),snapshot);
    assert.equal((await runtime.harness.snapshot(Questions,chat.id,ctx))?.pending,undefined);
    const after=readDelegationConfig(f.state);
    await command('/delegation');picker=(await runtime.harness.snapshot(DelegationCommands,chat.id,ctx))?.picker;
    await command('Cancel',picker!.id);assert.deepEqual(readDelegationConfig(f.state),after);
    const unrelated={id:'unrelated-question',text:'Answer this existing question'};
    await chat.commit(async tx=>{(await tx.doc(Questions,chat.id)).pending=unrelated;},ctx);
    await command('/delegation');
    assert.deepEqual((await runtime.harness.snapshot(Questions,chat.id,ctx))?.pending,unrelated);
    assert.equal((await runtime.harness.snapshot(DelegationCommands,chat.id,ctx))?.picker,undefined);
    assert.equal(f.faux.state.callCount,0);
  }finally{await runtime?.close();f.close();}
});

test('AD review provider: asynchronous error content and error-bearing partials never publish credentials',async()=>{
  const f=fixture();try{
    const original=f.models.getProvider('openai')!;
    const stream=(model:any)=>{
      const output=createAssistantMessageEventStream();
      queueMicrotask(()=>{
        const error={...fauxAssistantMessage('Raw adapter error content '+PROFILE_KEY,{stopReason:'error',errorMessage:'Raw adapter error '+PROFILE_KEY}),api:model.api,provider:model.provider,model:model.id};
        output.push({type:'start',partial:error});
        output.push({type:'error',reason:'error',error});
        output.end(error);
      });
      return output;
    };
    f.models.setProvider({...original,stream,streamSimple:stream});
    const aliases=createDelegationModels(f.models,f.state),ref=aliases.install({...f.route,credential:{kind:'secret',name:'review-profile'}});
    const response=aliases.models.streamSimple(aliases.models.getModel(ref.provider,ref.modelId)!,{messages:[{role:'user',content:'local error fixture',timestamp:Date.now()}]});
    const events=[];for await(const event of response)events.push(event);
    const result=await response.result();
    assert.equal(result.stopReason,'error');assert.deepEqual(result.content,[]);
    assert.match(result.errorMessage??'',/Delegation provider request failed/);
    assert.equal(JSON.stringify(events).includes(PROFILE_KEY),false,'persistable events cannot contain raw adapter credentials');
    assert.equal(JSON.stringify(result).includes(PROFILE_KEY),false);
    assert.equal(events.some(event=>event.type==='start'),false,'error-bearing partials must be withheld');
  }finally{f.close();}
});
