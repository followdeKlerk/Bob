import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {createModels,getSupportedThinkingLevels,calculateCost} from '@earendil-works/pi-ai/models';
import {openaiProvider} from '@earendil-works/pi-ai/providers/openai';
import {bobOpenAIProvider,terraModel} from '../src/openai-provider.js';
import {createBackendModels} from '../src/runtime.js';
import {State} from '../src/state.js';
import {saveDelegationConfig,readDelegationConfig} from '../src/delegation-config.js';

test('Terra compatibility entry retains native OpenAI authentication, dispatch and all model types',async()=>{
 const upstream=openaiProvider(),provider=bobOpenAIProvider(upstream);
 assert.equal(provider.auth,upstream.auth);assert.equal(provider.stream,upstream.stream);assert.equal(provider.streamSimple,upstream.streamSimple);
 assert.equal(provider.filterAllModels,upstream.filterAllModels);assert.equal(provider.classify,upstream.classify);
 const models=createModels({authContext:{env:async name=>name==='OPENAI_API_KEY'?'fixture-not-a-real-key':undefined,fileExists:async()=>false}});models.setProvider(provider);
 const terra=models.getModel('openai',terraModel.id)!;assert.ok(terra);assert.ok((await models.getAvailable('openai')).some(m=>m.id===terra.id));
 assert.deepEqual(getSupportedThinkingLevels(terra),['off','low','medium','high','xhigh','max']);
 assert.deepEqual(terra.input,['text','image']);assert.equal(terra.api,'openai-responses');assert.equal(terra.contextWindow,1050000);assert.equal(terra.maxTokens,128000);
 assert.equal(provider.getModels().filter(m=>m.id===terra.id).length,1);assert.equal(provider.getAllModels!().filter(m=>m.id===terra.id).length,1);
 for(const m of upstream.getAllModels!())assert.ok(provider.getAllModels!().includes(m));
 const usage={input:1000000,output:1000000,cacheRead:0,cacheWrite:0,totalTokens:2000000,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
 assert.equal(calculateCost(terra,{...usage,input:1000,output:1000,totalTokens:2000}).total,.006);
 assert.equal(calculateCost(terra,usage).total,9.5);
});

test('a future native Terra catalogue entry wins without duplication or metadata replacement',()=>{
 const native=openaiProvider(),future={...terraModel,name:'Upstream Terra',contextWindow:999999};
 const provider={...native,getModels:()=>[...native.getModels(),future],getAllModels:()=>[...native.getAllModels!(),future]};
 assert.equal(bobOpenAIProvider(provider),provider);assert.equal(bobOpenAIProvider(provider).getModels().find(m=>m.id===terraModel.id),future);
});

test('Terra delegation profile validates and survives control-store reopen without changing other profiles',async()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR!,'bob-terra-profile-'));let state=new State(dir);
 try{
  state.set('openaiKey','fixture-not-a-real-key');const models=createBackendModels(state);
  const profile=(name:string,model:string)=>({name,route:{provider:'openai',model,reasoning_effort:'high',credential:{kind:'provider',provider:'openai'}},cwd:dir,modules:['coding'],skills:[],instructions:'Preserve these instructions'});
  await saveDelegationConfig(state,models,{mode:'profile_routes',profileRoutes:{profiles:[{name:'researcher',description:'Research'},{name:'worker',description:'Implement'},{name:'reviewer',description:'Review'}],default:'worker'},profiles:[profile('researcher','gpt-6.1-terra'),profile('worker','gpt-6.1-sol'),profile('reviewer','gpt-6-astra')]});
  const saved=readDelegationConfig(state);state.close();state=new State(dir);
  assert.deepEqual(readDelegationConfig(state),saved);assert.ok(createBackendModels(state).getModel('openai','gpt-6.1-terra'));
  assert.deepEqual(saved.profiles.map(p=>p.route.model),['gpt-6.1-terra','gpt-6.1-sol','gpt-6-astra']);
 }finally{state.close();rmSync(dir,{recursive:true,force:true});}
});
