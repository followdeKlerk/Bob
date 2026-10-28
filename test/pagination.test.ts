import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {serve} from '../src/server.js';
import {HistoryPage} from '../src/contracts.js';

test('stored history and conversations paginate completely with scoped tamper-resistant cursors',async()=>{
 const state=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-history-'))),runtime=await openRuntime(state);
 const app=await serve(state,{port:0,runtime}),device=state.pair(state.invite().token,'Pagination test');
 const base=`http://127.0.0.1:${(app.server.address() as any).port}/v1`,headers={authorization:'Bearer '+device.credential,'x-bob-backend':state.id};
 try {
  const chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
  const other=await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
  await chat.commit(async tx=>{for(let i=0;i<235;i++)await tx.appendEntry(chat.id,{kind:'bob.history-fixture',data:{index:i,text:'Committed deterministic history fixture'}});},ctx);
  await chat.reset(undefined,ctx);
  await chat.commit(async tx=>{for(let i=235;i<250;i++)await tx.appendEntry(chat.id,{kind:'bob.history-fixture',data:{index:i}});},ctx);
  let cursor:string|undefined,firstCursor:string|undefined;const entries=new Map<number,any>();let pages=0;
  do {
   const response=await fetch(base+`/chats/${chat.id}/history`+(cursor?'?cursor='+encodeURIComponent(cursor):''),{headers});assert.equal(response.status,200);
   const page=HistoryPage.parse(await response.json());assert.equal(page.conversationId,chat.id);assert.ok(page.items.length<=100);
   for(const entry of page.items){assert.equal(entries.has(entry.id),false);entries.set(entry.id,entry);}
   firstCursor??=page.next;cursor=page.next;pages++;
  }while(cursor);
  assert.ok(pages>=3);assert.equal([...entries.values()].filter(e=>e.kind==='bob.history-fixture').length,250);
  const filtered=await fetch(base+`/chats/${chat.id}/history?limit=12&query=deterministic`,{headers});assert.equal(filtered.status,200);const filteredPage=await filtered.json();assert.ok(filteredPage.items.length<=12);assert.equal(filteredPage.filtered,true);
  for(const path of [`/chats/${other.id}/history?cursor=${firstCursor}`,`/chats?cursor=${firstCursor}`,`/chats/${chat.id}/history?cursor=${firstCursor}x`,`/chats/${chat.id}/history?cursor=not-json`])assert.equal((await fetch(base+path,{headers})).status,400);
  for(let i=0;i<105;i++)await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
  const ids=new Set<number>();cursor=undefined;
  do {const response=await fetch(base+'/chats'+(cursor?'?cursor='+encodeURIComponent(cursor):''),{headers});assert.equal(response.status,200);const page=await response.json();for(const c of page.items){assert.equal(ids.has(c.id),false);ids.add(c.id);}cursor=page.next;}while(cursor);
  assert.equal(ids.size,107);assert.equal(ids.has(runtime.library.id),false);
 }finally{await app.close();state.close();}
});
