import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {serve} from '../src/server.js';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage} from '@earendil-works/pi-ai/providers/faux';

test('model picker exposes real effort capabilities and persists only the selected conversation',{timeout:15000},async()=>{
 const s=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-model-picker-')));const runtime=await openRuntime(s),app=await serve(s,{port:0,runtime});const d=s.pair(s.invite().token,'Fixture');
 const base=`http://127.0.0.1:${(app.server.address() as any).port}/v1`,headers={authorization:'Bearer '+d.credential,'x-bob-backend':s.id,'content-type':'application/json'};
 const read=(path:string)=>fetch(base+path,{headers}).then(r=>r.json());
 const put=(id:number,value:unknown)=>fetch(base+`/chats/${id}/configure`,{method:'PUT',headers,body:JSON.stringify(value)});
 let id:number;
 try{
  const a=await runtime.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'openai',modelId:'gpt-6-luna'},instructions:'Keep these instructions',thinkingLevel:'low'}},ctx);
  const b=await runtime.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'openai',modelId:'gpt-6-luna'},thinkingLevel:'medium'}},ctx);id=a.id;
  const models=await read('/models'),astra=models.find((m:any)=>m.modelId==='gpt-6-astra');assert.ok(astra);assert.ok(astra.thinkingLevels.includes('high'));assert.ok(!astra.thinkingLevels.includes('off'));assert.equal(astra.available,false,'No configured credential in fixture');
  const terra=models.find((m:any)=>m.modelId==='gpt-6.1-terra');assert.ok(terra);assert.ok(terra.thinkingLevels.includes('high'));assert.ok(terra.thinkingLevels.includes('off'));assert.equal(terra.available,false);
  assert.equal((await put(a.id,{model:{provider:'openai',modelId:'gpt-6-astra'},thinkingLevel:'high'})).status,200);
  let selected=await read(`/chats/${a.id}/configure`);assert.equal(selected.model.modelId,'gpt-6-astra');assert.equal(selected.thinkingLevel,'high');assert.equal(selected.instructions,'Keep these instructions');
  assert.equal((await read(`/chats/${b.id}/configure`)).thinkingLevel,'medium');
  assert.equal((await put(a.id,{thinkingLevel:'off'})).status,400);assert.equal((await read(`/chats/${a.id}/configure`)).thinkingLevel,'high');
  assert.equal((await put(a.id,{thinkingLevel:'bogus'})).status,400);
  assert.equal((await put(a.id,{model:{provider:'openai',modelId:'not-a-real-model'}})).status,400);
  assert.equal((await put(a.id,{model:{provider:'openai',modelId:'gpt-6.1-terra'},thinkingLevel:'high'})).status,200);
  selected=await read(`/chats/${a.id}/configure`);assert.equal(selected.model.modelId,'gpt-6.1-terra');assert.equal(selected.thinkingLevel,'high');assert.equal(selected.instructions,'Keep these instructions');
 }finally{await app.close();}
 const reopened=await openRuntime(s);try{const chat=(await reopened.harness.conversation(id! as any,ctx))!;assert.equal((await chat.agent(ctx)).thinkingLevel,'high');assert.equal((await chat.agent(ctx)).model?.modelId,'gpt-6.1-terra');}finally{await reopened.close();s.close();}
});

test('Bob prompt receives actual configured model and thinking level through native sections',async()=>{
 const s=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-model-identity-'))),models=createModels(),faux=fauxProvider();models.setProvider(faux.provider);const runtime=await openRuntime(s,models);let observed='';
 try{
  faux.setResponses([context=>{observed=JSON.stringify(context);return fauxAssistantMessage('DETERMINISTIC identity fixture');}]);
  const chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);
  await(await chat.submit({type:'input',content:'Which model are you?'},ctx)).wait(ctx);
  assert.ok(observed.includes('Configured model: faux/faux-1'));assert.ok(observed.includes('Thinking effort:'));
  assert.ok((await chat.entries({},100,undefined,ctx)).items.some(e=>e.kind==='pi.system'),'System metadata remains authoritative even though the chat UI hides it');
 }finally{await runtime.close();s.close();}
});
