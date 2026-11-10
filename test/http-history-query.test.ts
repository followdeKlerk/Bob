import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createModels} from '@earendil-works/pi-ai/models';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {serve} from '../src/server.js';

test('authenticated history filters Unicode words and preserves empty-page pagination',{timeout:15000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'bob-history-query-')),state=new State(dir);
 let app:Awaited<ReturnType<typeof serve>>|undefined,runtime:Awaited<ReturnType<typeof openRuntime>>|undefined;
 try{
  runtime=await openRuntime(state,createModels(),undefined,{resume:false});
  app=await serve(state,{port:0,runtime});
  const device=state.pair(state.invite().token,'History search fixture');
  const headers={authorization:`Bearer ${device.credential}`,'x-bob-backend':state.id};
  const chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
  const texts=['hello world','CV senior engineering','日本語 検索','café résumé','unrelated last record'];
  const entries=[];
  for(const text of texts)entries.push(await chat.commit(tx=>tx.appendEntry(chat.id,{kind:'fixture.search',data:{text}}),ctx));
  const url=`http://127.0.0.1:${(app.server.address() as {port:number}).port}/v1/chats/${chat.id}/history`;
  const get=async(params:Record<string,string>={})=>{
   const response=await fetch(`${url}?${new URLSearchParams(params)}`,{headers});
   assert.equal(response.status,200);return await response.json() as {items:{id:number}[];next?:string;filtered?:boolean;query?:string};
  };
  assert.equal((await fetch(url)).status,401);
  for(const [query,index] of [['HELLO',0],['unfindable engineering',1],['日本語',2],['RÉSUMÉ',3]] as const){
   const result=await get({query});assert.deepEqual(result.items.map(entry=>entry.id),[entries[index].id],query);
   assert.equal(result.filtered,true);assert.equal(result.query,query);
  }
  assert.deepEqual((await get({query:'nonexistentword'})).items,[]);
  assert.deepEqual((await get({query:'!!!'})).items,[],'nonempty queries with no eligible terms match nothing');
  for(const query of ['', '   ']){
   const result=await get({query});assert.equal(result.items.length,texts.length);assert.equal(result.filtered,undefined);
  }
  let next:string|undefined,matched:number[]=[],pages=0;
  do{
   const page=await get({query:'hello',limit:'1',...(next?{cursor:next}:{})});
   if(pages===0){assert.deepEqual(page.items,[]);assert.ok(page.next,'a filtered-empty page retains its scan cursor');}
   matched.push(...page.items.map(entry=>entry.id));next=page.next;pages++;
   assert.ok(pages<=texts.length+1,'pagination must terminate');
  }while(next);
  assert.deepEqual(matched,[entries[0].id]);
  assert.equal((await chat.entries({},100,undefined,ctx)).items.length,texts.length,'search does not mutate history');
 }finally{if(app)await app.close();else await runtime?.close();state.close();await rm(dir,{recursive:true,force:true});}
});
