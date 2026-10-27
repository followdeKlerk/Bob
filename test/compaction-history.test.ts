import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage} from '@earendil-works/pi-ai/providers/faux';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {serve} from '../src/server.js';
import {HistoryPage} from '../src/contracts.js';

test('official manual compaction shortens context without losing paginated stored history through reset and reopen',{timeout:30000},async()=>{
 const state=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-compaction-history-')));
 const models=createModels(),faux=fauxProvider();models.setProvider(faux.provider);
 faux.setResponses([fauxAssistantMessage('DETERMINISTIC SUMMARY ONLY: prior fixture records remain in stored history.')]);
 let runtime=await openRuntime(state,models),app=await serve(state,{port:0,runtime});
 const device=state.pair(state.invite().token,'Compaction history test');
 const headers={authorization:'Bearer '+device.credential,'x-bob-backend':state.id};
 try{
  const chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);
  await chat.commit(async tx=>{
   for(let index=0;index<120;index++)await tx.appendEntry(chat.id,{kind:'bob.compaction-history-fixture',data:{index},model:[{role:'user',content:[{type:'text',text:`Original fixture ${index}: ${'preserved original history '.repeat(64)}`}],timestamp:Date.now()}]});
  },ctx);
  const taskId=await chat.compact('Deterministic stored-history acceptance; do not invent lost records.',ctx);
  const task=await runtime.harness.waitForTask(taskId,ctx);assert.equal(task.state.outcome.status,'completed');
  await chat.waitForIdle(ctx);
  const active=await chat.context(ctx);
  assert.ok(active.entries.some(entry=>entry.kind==='pi.compaction'));
  assert.ok(active.entries.filter(entry=>entry.kind==='bob.compaction-history-fixture').length<120);
  const scan=async()=>{
   const entries=new Map<number,any>();let cursor:string|undefined;
   do{
    const response=await fetch(`http://127.0.0.1:${(app.server.address() as any).port}/v1/chats/${chat.id}/history`+(cursor?'?cursor='+encodeURIComponent(cursor):''),{headers});assert.equal(response.status,200);
    const page=HistoryPage.parse(await response.json());for(const entry of page.items){assert.equal(entries.has(entry.id),false);entries.set(entry.id,entry);}cursor=page.next;
   }while(cursor);
   const records=[...entries.values()];assert.deepEqual(records.filter(entry=>entry.kind==='bob.compaction-history-fixture').map(entry=>entry.data.index).sort((a,b)=>a-b),Array.from({length:120},(_,index)=>index));
   assert.equal(records.filter(entry=>entry.kind==='pi.compaction').length,1);return records;
  };
  await scan();await chat.reset(undefined,ctx);await chat.waitForIdle(ctx);
  const before=await scan();assert.ok(before.some(entry=>entry.kind==='pi.reset'));
  await app.close();runtime=await openRuntime(state,models);app=await serve(state,{port:0,runtime});
  const after=await scan();assert.deepEqual(after.map(entry=>entry.id),before.map(entry=>entry.id));
 }finally{await app.close();state.close();}
});
