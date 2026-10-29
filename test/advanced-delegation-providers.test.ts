import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage} from '@earendil-works/pi-ai/providers/faux';
import {State} from '../src/state.js';
import {Route,setDelegationSecret,validateRoute} from '../src/delegation-config.js';
import {createDelegationModels} from '../src/delegation-providers.js';

test('AD explicitly configured local endpoint uses actual adapter/model/key; missing key never falls back',{timeout:15000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bob-ad-endpoint-')),state=new State(dir),base=createModels(),calls:{url?:string;authorization?:string;body:any}[]=[];
 const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;calls.push({url:req.url,authorization:req.headers.authorization,body:JSON.parse(body)});res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'configured-local',choices:[{index:0,delta:{role:'assistant',content:'Local fixture answer'},finish_reason:null}]})+'\n\n');res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'configured-local',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:2,completion_tokens:3,total_tokens:5}})+'\n\n');res.end('data: [DONE]\n\n');});server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  setDelegationSecret(state,'local','endpoint-fixture-private');
  const route=Route.parse({provider:'local',model:'configured-local',credential:{kind:'secret',name:'local'},endpoint:{baseUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`,api:'openai-completions',contextWindow:4096,maxTokens:128,thinkingLevels:['off']}});
  await validateRoute(route,base,state);const adapter=createDelegationModels(base,state),ref=adapter.install(route),model=adapter.models.getModel(ref.provider,ref.modelId)!;
  const result=await adapter.models.completeSimple(model,{messages:[{role:'user',content:'fixture prompt',timestamp:Date.now()}]});assert.equal(result.stopReason,'stop');assert.match(JSON.stringify(result.content),/Local fixture answer/);
  assert.equal(calls.length,1);assert.equal(calls[0].url,'/v1/chat/completions');assert.equal(calls[0].authorization,'Bearer endpoint-fixture-private');assert.equal(calls[0].body.model,'configured-local');
  state.delete('delegationSecret:local');assert.equal(await adapter.models.getAuth(ref.provider),undefined);
  const rejected=await adapter.models.completeSimple(model,{messages:[{role:'user',content:'must fail',timestamp:Date.now()}]});assert.equal(rejected.stopReason,'error');assert.equal(calls.length,1);
 }finally{server.close();await once(server,'close');state.close();rmSync(dir,{recursive:true,force:true});}
});

test('AD fast tier sets priority, requires provider confirmation and rejects normal/missing acknowledgement',{timeout:15000},async()=>{
 for(const actualTier of ['priority','default',undefined]){
  const dir=mkdtempSync(join(tmpdir(),'bob-ad-tier-')),state=new State(dir),base=createModels(),faux=fauxProvider({provider:'openai',api:'openai-responses',models:[{id:'tier-fixture'}]});base.setProvider(faux.provider);
  try{
   let payload:any,provider:string|undefined;
   faux.setResponses([async(context,options,_state,model)=>{provider=model.provider;payload=await options!.onPayload!({model:model.id},model);if(actualTier)await options!.onProviderStreamEvent!({type:'response.completed',response:{service_tier:actualTier}},model);return fauxAssistantMessage('Fixture answer');}]);
   const route=Route.parse({provider:'openai',model:'tier-fixture',service_tier:'fast'});await validateRoute(route,base,state);const adapter=createDelegationModels(base,state),ref=adapter.install(route),model=adapter.models.getModel(ref.provider,ref.modelId)!;
   const result=await adapter.models.completeSimple(model,{messages:[{role:'user',content:'fixture',timestamp:Date.now()}]});
   assert.equal(provider,'openai');assert.equal(payload.service_tier,'priority');assert.equal(result.stopReason,actualTier==='priority'?'stop':'error');
   if(actualTier!=='priority'){assert.deepEqual(result.content,[]);assert.match(result.errorMessage!,/priority tier/);}
  }finally{state.close();rmSync(dir,{recursive:true,force:true});}
 }
});

test('AD provider error text does not disclose supplied credentials',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bob-ad-errors-')),state=new State(dir),base=createModels(),faux=fauxProvider({provider:'worker',models:[{id:'fixture'}]});base.setProvider(faux.provider);
 try{setDelegationSecret(state,'worker','fixture-secret-NEVER-ECHO');faux.setResponses([fauxAssistantMessage('credential-bearing error content: fixture-secret-NEVER-ECHO',{stopReason:'error',errorMessage:'invalid key fixture-secret-NEVER-ECHO'})]);const adapter=createDelegationModels(base,state),ref=adapter.install(Route.parse({provider:'worker',model:'fixture',credential:{kind:'secret',name:'worker'}})),model=adapter.models.getModel(ref.provider,ref.modelId)!;const stream=adapter.models.streamSimple(model,{messages:[{role:'user',content:'fixture',timestamp:Date.now()}]});const events=[];for await(const event of stream)events.push(structuredClone(event));const result=await stream.result();assert.equal(result.stopReason,'error');assert.deepEqual(result.content,[]);assert.doesNotMatch(JSON.stringify({events,result}),/NEVER-ECHO/);}
 finally{state.close();rmSync(dir,{recursive:true,force:true});}
});
