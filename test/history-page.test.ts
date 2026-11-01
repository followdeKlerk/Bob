import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {historyPage,HISTORY_ITEMS_MAX_BYTES} from '../src/history-page.js';
import {conversationOperation} from '../src/conversation-network.js';

const record=(id:number,text:string)=>({id,conversationId:1,kind:'fixture.history',data:{text}} as any);
test('history byte budget includes UTF-8 and escaped JSON; oversized records are explicit previews',()=>{
 const entries=[record(3,'界'.repeat(5000)),record(2,'界'.repeat(5000)),record(1,'界'.repeat(5000))];
 const page=historyPage(entries);assert.equal(page.consumed,2);assert.equal(page.items.length,2);
 assert.ok(Buffer.byteLength(JSON.stringify(page.items))<=HISTORY_ITEMS_MAX_BYTES);
 for(const text of ['界'.repeat(50000),'"\\\n'.repeat(50000)]){
  const huge=historyPage([record(2,text),record(1,'small')]);
  assert.equal(huge.consumed,2);assert.equal((huge.items[0] as any).omitted,true);
  assert.ok((huge.items[0] as any).originalBytes>HISTORY_ITEMS_MAX_BYTES);
  assert.ok(Buffer.byteLength(JSON.stringify(huge.items))<=HISTORY_ITEMS_MAX_BYTES);
 }
 assert.deepEqual(historyPage([record(2,'other'),record(1,'MATCH')],'match').items,[record(1,'MATCH')]);
});

test('native direct and codemode history keep JSON valid, paginate without skips and honour filters',{timeout:30000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bob-history-bytes-')),state=new State(dir),models=createModels(),faux=fauxProvider({tokensPerSecond:1000000});models.setProvider(faux.provider);
 const rt=await openRuntime(state,models);
 try{
  const create=()=>rt.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);
  const source=await create(),destination=await create();
  const ids:number[]=[];
  for(let i=0;i<5;i++){
   const entry=await destination.commit(tx=>tx.appendEntry(destination.id,{kind:'fixture.medium',data:{text:'界'.repeat(5000),i}}),ctx);ids.push(Number(entry.id));
  }
  const huge=await destination.commit(tx=>tx.appendEntry(destination.id,{kind:'fixture.huge',data:{text:'oversized '.repeat(20000)}}),ctx);ids.push(Number(huge.id));
  const call=async(name:string,args:Record<string,unknown>)=>{
   let result:any;
   faux.setResponses([fauxAssistantMessage(fauxToolCall(name,args),{stopReason:'toolUse'}),context=>{result=context.messages.findLast(m=>m.role==='toolResult');return fauxAssistantMessage('History verified');}]);
   await(await source.submit({type:'input',content:'Inspect history fixture'},ctx)).wait(ctx);
   assert.ok(result);assert.equal(result.isError,false,JSON.stringify(result));return result.content.filter((c:any)=>c.type==='text').map((c:any)=>c.text).join('\n');
  };
  let cursor:string|undefined;const seen:any[]=[];
  do{
   const raw=await call('conversation_history',{mode:'page',conversationId:destination.id,limit:5,...(cursor?{cursor}:{})});
   assert.ok(Buffer.byteLength(raw)<50*1024);
   const p=JSON.parse(raw);seen.push(...p.items);cursor=p.next;
  }while(cursor);
  assert.deepEqual(seen.map(e=>e.id),ids.toReversed());assert.equal(seen[0].omitted,true);
  assert.equal(seen.filter(e=>e.omitted).length,1,'medium records remain complete');
  const scripted=await call('codemode',{code:`const p=JSON.parse(await tools.conversation_history({mode:'page',conversationId:${destination.id},limit:5}));text({valid:true,items:p.items.length,omitted:p.items[0].omitted,hasNext:!!p.next});`});
  assert.match(scripted,/"valid":true/);assert.match(scripted,/"omitted":true/);assert.match(scripted,/"hasNext":true/);
  const empty=JSON.parse(await call('conversation_history',{mode:'page',conversationId:destination.id,limit:1,query:'fixture.medium'}));
  assert.deepEqual(empty.items,[]);assert.ok(empty.next);
  const match=JSON.parse(await call('conversation_history',{mode:'page',conversationId:destination.id,limit:1,query:'FIXTURE.MEDIUM',cursor:empty.next}));
  assert.equal(match.items.length,1);assert.equal(match.items[0].kind,'fixture.medium');
  // Changing the query cannot silently reuse a cursor scoped to a different scan.
  faux.setResponses([fauxAssistantMessage(fauxToolCall('conversation_history',{mode:'page',conversationId:destination.id,query:'different',cursor:empty.next}),{stopReason:'toolUse'}),context=>{const result=context.messages.findLast(m=>m.role==='toolResult');assert.match(JSON.stringify(result),/wrong-scope/);return fauxAssistantMessage('Rejected');}]);
  await(await source.submit({type:'input',content:'Reject wrong query cursor'},ctx)).wait(ctx);

  // Force a concurrent append precisely between the page scan and the smaller
  // cursor scan. New entries must not shift that boundary and duplicate records.
  let scans=0;
  const racing={...rt,harness:{conversation:async()=>({entries:async(...args:Parameters<typeof destination.entries>)=>{
   if(++scans===2)await destination.commit(tx=>tx.appendEntry(destination.id,{kind:'fixture.concurrent',data:{text:'arrived between reads'}}),ctx);
   return destination.entries(...args);
  }})}} as any;
  const authority={originBackendId:state.id,name:'fixture',allConversations:true,read:[],message:[]};
  const request={destinationBackendId:state.id,originConversationId:source.id,conversationId:destination.id,limit:5};
  const raced=await conversationOperation(state,racing,authority,'history',request);
  const racedIds=raced.items.map((e:any)=>e.id);
  let next=raced.next;
  while(next){
   const p=await conversationOperation(state,rt,authority,'history',{...request,cursor:next});
   racedIds.push(...p.items.map((e:any)=>e.id));next=p.next;
  }
  assert.ok(scans>=2);assert.deepEqual(racedIds,ids.toReversed());
 }finally{await rt.close();state.close();rmSync(dir,{recursive:true,force:true});}
});
