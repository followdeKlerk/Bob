import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MemorySaves,type SaveReceipt} from '@bob-local/memory';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {serve} from '../src/server.js';
import {presentMemoryStatuses} from '../src/memory-presentation.js';

test('save indicators derive from scoped receipts on HTTP, paginated history, SSE and restart without rewriting history',{timeout:25000},async()=>{
 const state=new State(mkdtempSync(join(tmpdir(),'bob-memory-presentation-')));
 let runtime=await openRuntime(state),app=await serve(state,{port:0,runtime});
 const pair=state.pair(state.invite().token,'test');
 const headers={authorization:`Bearer ${pair.credential}`,'x-bob-backend':state.id};
 const chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
 const other=await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
 const definitions=[['queued','queued'],['accepted','accepted'],['completed','completed'],['failed','failed'],['cancelled','cancelled'],['warning','completed']] as const;
 try{
  // All document/table reads precede entry writes in the native transaction.
  await chat.commit(async tx=>{
   for(const [key,status] of definitions){const r=await tx.doc(MemorySaves,chat.id,key,null);Object.assign(r,{operationId:'operation-'+key,bank:'bob',documentId:'doc-'+key,status,updatedAt:1,error:'PRIVATE provider diagnostic',...(key==='warning'?{processingWarning:'PRIVATE extraction diagnostic'}:{})});}
   for(const [key] of definitions)await tx.appendEntry(chat.id,{kind:'bob.memory-status',data:{phase:'save-queued',receiptKey:key,text:'Hindsight — save queued'}});
   await tx.appendEntry(chat.id,{kind:'bob.memory-status',data:{phase:'save-queued',receiptKey:'missing'}});
   await tx.appendEntry(chat.id,{kind:'bob.memory-status',data:{phase:'save-queued'}});
   await tx.appendEntry(chat.id,{kind:'bob.memory-status',data:{phase:'recall',count:3}});
   await tx.appendEntry(chat.id,{kind:'bob.memory-status',data:{phase:'save-queued',receiptKey:'completed'},model:[{role:'user',content:'Not passive metadata',timestamp:1}]});
  },ctx);
  await other.commit(async tx=>{Object.assign(await tx.doc(MemorySaves,other.id,'missing',null),{operationId:'other-operation',status:'completed'});},ctx);
  const before=(await chat.entries({},100,undefined,ctx)).items;
  const expected:Record<string,string>={queued:'save-queued',accepted:'save-processing',completed:'save-completed',failed:'save-failed',cancelled:'save-cancelled',warning:'save-warning'};
  const base=()=>`http://127.0.0.1:${(app.server.address() as any).port}/v1/chats/${chat.id}`;
  const inspect=async()=>{
   const snapshot=await(await fetch(base(),{headers})).json() as any;
   const pages:any[]=[];let cursor:string|undefined;
   do{const page=await(await fetch(base()+'/history?limit=3'+(cursor?'&cursor='+encodeURIComponent(cursor):''),{headers})).json() as any;pages.push(...page.items);cursor=page.next;}while(cursor);
   for(const rows of [snapshot.view.entries,pages]){
    for(const [key,phase] of Object.entries(expected)){
     const row=rows.find((e:any)=>!e.model?.length&&e.data?.receiptKey===key);
     assert.equal(row?.data.phase,phase,key);
     assert.equal(row.id,before.find(e=>!e.model?.length&&(e.data as any)?.receiptKey===key)?.id);
    }
    assert.equal(rows.find((e:any)=>e.data?.receiptKey==='missing').data.phase,'save-queued','no cross-conversation receipt lookup');
    assert.equal(rows.find((e:any)=>e.model?.length)?.data.phase,'save-queued','model-bearing entries are not projected');
    assert.equal(rows.find((e:any)=>e.data?.phase==='recall')?.data.count,3);
    assert.ok(!JSON.stringify(rows).includes('PRIVATE'),'receipt diagnostic text is never exposed');
   }
  };
  await inspect();
  const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),10000);
  try{
   const stream=await fetch(base()+'/events',{headers,signal:controller.signal}),reader=stream.body!.getReader(),decoder=new TextDecoder();let buffered='';
   const frame=async()=>{
    while(!buffered.includes('\n\n')){const chunk=await reader.read();assert.equal(chunk.done,false);buffered+=decoder.decode(chunk.value,{stream:true});}
    const end=buffered.indexOf('\n\n'),packet=buffered.slice(0,end);buffered=buffered.slice(end+2);
    return JSON.parse(packet.split('\n').find(line=>line.startsWith('data: '))!.slice(6));
   };
   const first=await frame(),row=(data:any)=>data.view.entries.find((e:any)=>e.data?.receiptKey==='queued');
   assert.equal(row(first).data.phase,'save-queued');
   await chat.commit(async tx=>{const r=await tx.doc(MemorySaves,chat.id,'queued',null);r.status='completed';r.updatedAt=2;},ctx);
   let updated;do{updated=await frame();}while(row(updated).data.phase!=='save-completed');
   assert.equal(row(updated).id,row(first).id,'completion updates the original display row');
   expected.queued='save-completed';
  }finally{clearTimeout(deadline);controller.abort();}
  await inspect();
  // Retrying a failed save must not retain stale failure/success presentation.
  await chat.commit(async tx=>{(await tx.doc(MemorySaves,chat.id,'failed',null)).status='queued';},ctx);expected.failed='save-queued';await inspect();
  assert.deepEqual((await chat.entries({},100,undefined,ctx)).items,before,'stored entries and model history are unchanged');
  assert.equal(await runtime.harness.snapshot(MemorySaves,chat.id,'missing',ctx),undefined,'missing receipts are not materialized');
  // The presentation helper rejects foreign entries even if called with a mixed list.
  const foreign={...before.find(e=>(e.data as any)?.receiptKey==='completed')!,conversationId:other.id};
  assert.equal((await presentMemoryStatuses(runtime.harness,chat.id,[foreign]))[0],foreign);
  await app.close();runtime=await openRuntime(state);app=await serve(state,{port:0,runtime});await inspect();
  const reopened=await runtime.harness.conversation(chat.id,ctx);assert.deepEqual((await reopened!.entries({},100,undefined,ctx)).items,before);
 }finally{await app.close();state.close();}
});

test('malformed or unbacked metadata cannot create successful presentation or trigger unrelated receipt reads',async()=>{
 const reads:string[]=[];
 const harness={snapshot:async(_family:unknown,_id:number,key:string)=>{
  reads.push(key);
  return key==='empty'?{operationId:'',status:'completed'}:{operationId:'id',status:'toString'};
 }} as any;
 const rows:any[]=[
  {id:1,conversationId:7,kind:'bob.memory-status',data:null},
  {id:2,conversationId:7,kind:'bob.memory-status',data:[]},
  {id:3,conversationId:7,kind:'bob.memory-status',data:{phase:'save-queued',receiptKey:42}},
  {id:4,conversationId:7,kind:'bob.memory-status',data:{phase:'save-queued',receiptKey:''}},
  {id:5,conversationId:7,kind:'bob.memory-status',data:{phase:'save-queued',receiptKey:'x'.repeat(257)}},
  {id:6,conversationId:7,kind:'bob.memory-status',data:{phase:'other',receiptKey:'unused'}},
  {id:7,conversationId:7,kind:'bob.memory-status',data:{phase:'save-queued',receiptKey:'empty'}},
  {id:8,conversationId:7,kind:'bob.memory-status',data:{phase:'save-queued',receiptKey:'invalid'}},
 ];
 const projected=await presentMemoryStatuses(harness,7 as any,rows);
 assert.deepEqual(reads,['empty','invalid']);
 assert.ok(projected.every((entry,index)=>entry===rows[index]));
});
