import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {serve} from '../src/server.js';

test('native local history: automatic sibling access, reset paging, reserved library and cursor scope',async()=>{
 const state=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-local-history-'))),models=createModels(),faux=fauxProvider({tokensPerSecond:10000});models.setProvider(faux.provider);
 const runtime=await openRuntime(state,models),server=await serve(state,{port:0,runtime});
 const pair=state.pair(state.invite().token,'history grant fixture'),base=`http://127.0.0.1:${(server.server.address() as any).port}/v1`;
 const create=()=>runtime.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);
 try{
  const source=await create(),otherSource=await create(),destination=await create();
  for(let i=0;i<105;i++){if(i===101)await destination.reset(undefined,ctx);await destination.commit(tx=>tx.appendEntry(destination.id,{kind:'fixture.history',data:{i}}),ctx);}
  const grant=async(id:number,read:number[])=>fetch(`${base}/chats/${id}/history-access`,{method:'PUT',headers:{authorization:`Bearer ${pair.credential}`,'x-bob-backend':state.id,'content-type':'application/json'},body:JSON.stringify({read})});
  const call=async(chat:typeof source,args:Record<string,unknown>)=>{
   let result:any;
   faux.setResponses([fauxAssistantMessage(fauxToolCall('conversation_history',args),{stopReason:'toolUse'}),(context)=>{result=context.messages.findLast(m=>m.role==='toolResult');return fauxAssistantMessage('DETERMINISTIC history tool inspected.');}]);
   await(await chat.submit({type:'input',content:'Exercise native history fixture'},ctx)).wait(ctx);
   assert.ok(result);return result;
  };
  assert.ok(!((await call(source,{conversationId:destination.id})).isError));
  assert.match(JSON.stringify(await call(source,{conversationId:runtime.library.id})),/Reserved/);
  assert.equal((await grant(source.id,[runtime.library.id])).status,410);
  assert.equal((await grant(source.id,[destination.id])).status,410);
  const listing=JSON.parse((await call(source,{})).content[0].text);assert.deepEqual(new Set(listing.items.map((i:any)=>i.id)),new Set([source.id,otherSource.id,destination.id]));assert.equal(listing.readOnly,true);
  const first=JSON.parse((await call(source,{conversationId:destination.id})).content[0].text);assert.equal(first.items.length,100);assert.ok(first.next);assert.equal(first.readOnly,true);
  const second=JSON.parse((await call(source,{conversationId:destination.id,cursor:first.next})).content[0].text);
  assert.equal([...first.items,...second.items].filter(e=>e.kind==='fixture.history').length,105);assert.equal(second.next,undefined);
  assert.equal((await grant(otherSource.id,[destination.id])).status,410);
  assert.match(JSON.stringify(await call(otherSource,{conversationId:destination.id,cursor:first.next})),/wrong-scope/);
  assert.equal((await grant(source.id,[])).status,410);
  assert.ok(!(await call(source,{conversationId:destination.id,cursor:first.next})).isError);
  assert.equal((await destination.entries({},200,undefined,ctx)).items.filter(e=>e.kind==='fixture.history').length,105,'read access never messages or modifies the target');
 }finally{state.revoke(pair.deviceId);await server.close();state.close();}
});
