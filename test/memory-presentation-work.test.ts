import test from 'node:test';
import assert from 'node:assert/strict';
import {Harness,MemoryStorage,createRegistry} from '@earendil-works/pi-durable';
import {createModels} from '@earendil-works/pi-ai/models';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';
import {MemorySaves} from '@bob-local/memory';
import {presentMemoryStatuses} from '../src/memory-presentation.js';
const phase=(row:{data?:unknown})=>(row.data as {phase?:string}|undefined)?.phase;
test('hydrated receipt presentation already reuses native storage reads and still observes edits and retirement',async t=>{
 const storage=new MemoryStorage(),calls:Record<string,number>={};
 const measured=new Proxy(storage,{get(target,key){const value=Reflect.get(target,key);return typeof value==='function'?(...args:any[])=>{calls[String(key)]=(calls[String(key)]??0)+1;return value.apply(target,args);}:value;}});
 const h=await Harness.open(measured,{registry:createRegistry(),models:createModels()},ctx);
 try{
  const chat=await h.createConversation({ownership:{kind:'ownerless'}},ctx);
  await h.commit(async tx=>{for(let i=0;i<4;i++)Object.assign(await tx.doc(MemorySaves,chat.id,`save:${i}`,null),{operationId:`fixture-${i}`,status:'accepted'});},ctx);
  const rows=Array.from({length:12},(_,i)=>({id:i+1,conversationId:chat.id,kind:'bob.memory-status',data:{phase:'save-queued',receiptKey:`save:${i%4}`}})) as any;
  let snapshots=0;const reader=new Proxy(h,{get(target,key){if(key==='snapshot')return (...args:any[])=>{snapshots++;return (h.snapshot as any)(...args);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  for(const key of Object.keys(calls))delete calls[key];
  for(let i=0;i<20;i++)assert.equal(phase((await presentMemoryStatuses(reader,chat.id,rows))[0]),'save-processing');
  t.diagnostic(JSON.stringify({snapshotApiCalls:snapshots,backingStorageCalls:calls}));
  assert.equal(snapshots,80);assert.deepEqual(calls,{},'native hydrated snapshots must not be mistaken for repeated storage I/O');
  for(const status of ['completed','failed','queued'] as const){await h.commit(async tx=>{(await tx.doc(MemorySaves,chat.id,'save:0',null)).status=status;},ctx);assert.equal(phase((await presentMemoryStatuses(h,chat.id,rows))[0]),`save-${status}`);}
  await h.commit(tx=>tx.retireDoc(MemorySaves,chat.id,'save:0'),ctx);assert.equal((await presentMemoryStatuses(h,chat.id,rows))[0],rows[0]);
  await h.commit(async tx=>{Object.assign(await tx.doc(MemorySaves,chat.id,'save:0',null),{operationId:'recreated',status:'completed',processingWarning:'private'});},ctx);
  const result=await presentMemoryStatuses(h,chat.id,rows);assert.equal(phase(result[0]),'save-warning');assert.ok(!JSON.stringify(result).includes('private'));assert.equal(rows[0].data.phase,'save-queued');
 }finally{await h.close(ctx);}
});
