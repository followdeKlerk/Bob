import assert from 'node:assert/strict';
import test from 'node:test';
import {createReplyPresentation} from '../src/reply-presentation.js';
function presenter(reader:any){
 let observer:any;const present=createReplyPresentation(reader,{observeCommits(value){observer=value;return {detach(){}};}});
 return Object.assign(present,{publish(){observer.advance({changes:[{type:'submission',value:{conversationId:7}}]});}});
}
const entry=(id:number,kind='pi.assistant')=>({id,conversationId:7,kind,model:kind==='pi.assistant'?[{role:'assistant',content:'Answer'}]:undefined}) as any;
test('native done input settlements bind file/call/answer display without changing official entries',async()=>{
 const original=[entry(10,'bob.user'),entry(12,'bob.artifact'),entry(20,'bob.file'),entry(22),entry(50)];
 const before=JSON.stringify(original);let scans=0;
 const reader={scanSubmissions:async()=>{scans++;return {items:[{conversationId:7,type:'input',status:'done',entry:10,answer:50},{conversationId:7,type:'input',status:'done',entry:25,answer:50}]};},entry:async(id:number)=>({entry:original.find(e=>e.id===id),commitSeq:1})};
 const present=presenter(reader),result=await present(7 as any,original);
 assert.equal(result[0],original[0]);assert.equal(result[1],original[1]);
 for(const item of result.slice(2))assert.deepEqual(item.mobileReply,{version:1,first:10,answer:50});
 assert.equal(JSON.stringify(original),before);
 assert.equal((await present(7 as any,original))[2],result[2]);assert.equal(scans,1,'stream-only changes do not rescan the same window');
});
test('unproven, cross-conversation and overlapping answers do not invent attachment ownership',async()=>{
 const original=[entry(20,'bob.file'),entry(50),entry(60)];
 const subs=[{conversationId:8,type:'input',status:'done',entry:1,answer:50},{conversationId:7,type:'write',status:'done',entry:20},{conversationId:7,type:'input',status:'done',entry:60,answer:50}];
 const reader={scanSubmissions:async()=>({items:subs}),entry:async(id:number)=>({entry:original.find(e=>e.id===id),commitSeq:1})};
 assert.deepEqual(await presenter(reader)(7 as any,original),original);
 subs.push({conversationId:7,type:'input',status:'done',entry:10,answer:50} as any,{conversationId:7,type:'input',status:'done',entry:15,answer:60} as any);
 const overlapping=await presenter(reader)(7 as any,original);assert.ok(overlapping.every(e=>e.mobileReply===undefined),'an overlapping prefix invalidates the entire answer range');
});
test('new committed answer advances projection and scan work has a hard bound',async()=>{
 let scans=0,complete=false;
 const reader={scanSubmissions:async()=>{scans++;return {items:complete?[{conversationId:7,type:'input',status:'done',entry:1,answer:50}]:[],next:{offset:scans}};},entry:async(id:number)=>({entry:entry(id),commitSeq:1})};
 const present=presenter(reader),file=entry(20,'bob.file');
 assert.equal((await present(7 as any,[file]))[0].mobileReply,undefined);assert.equal(scans,10);
 complete=true;present.publish();assert.deepEqual((await present(7 as any,[file,entry(50)]))[0].mobileReply,{version:1,first:1,answer:50});assert.equal(scans,20);
});

test('a newly settled answer invalidates older incomplete window caches',async()=>{
 let complete=false;const file=entry(20,'bob.file');
 const reader={scanSubmissions:async()=>({items:complete?[{conversationId:7,type:'input',status:'done',entry:1,answer:50}]:[]}),entry:async(id:number)=>({entry:entry(id),commitSeq:1})};
 const present=presenter(reader);assert.equal((await present(7 as any,[file]))[0].mobileReply,undefined);
 complete=true;present.publish();await present(7 as any,[entry(50)]);
 assert.deepEqual((await present(7 as any,[file]))[0].mobileReply,{version:1,first:1,answer:50});
});

test('an answer-only page cannot certify a range overlapping an earlier unloaded answer',async()=>{
 const reader={scanSubmissions:async()=>({items:[{conversationId:7,type:'input',status:'done',entry:10,answer:30},{conversationId:7,type:'input',status:'done',entry:20,answer:40}]}),entry:async(id:number)=>({entry:entry(id),commitSeq:1})};
 const present=presenter(reader);
 assert.equal((await present(7 as any,[entry(40)]))[0].mobileReply,undefined);
 assert.equal((await present(7 as any,[entry(25,'bob.file')]))[0].mobileReply,undefined);
});

test('nested, touching and equal-start settlements stay ambiguous even outside the loaded window',async()=>{
 const ranges=[[1,100],[10,20],[30,40],[110,120],[120,130],[140,150],[140,160],[170,180]];
 const subs=ranges.map(([first,answer])=>({conversationId:7,type:'input',status:'done',entry:first,answer})).reverse();
 const reader={scanSubmissions:async()=>({items:subs}),entry:async(id:number)=>({entry:entry(id),commitSeq:1})};
 const present=presenter(reader);
 // Every first/answer boundary is inclusive. An unloaded outer or touching
 // range must invalidate the whole candidate, not just the overlapping slice.
 for(const id of [1,10,20,30,40,100,110,119,120,130,140,150,160,169,181]){
  assert.equal((await present(7 as any,[entry(id,'bob.file')]))[0].mobileReply,undefined,`entry ${id}`);
 }
 for(const id of [170,175,180])assert.deepEqual((await present(7 as any,[entry(id,'bob.file')]))[0].mobileReply,{version:1,first:170,answer:180});
});

test('indexed reply association matches exhaustive overlap rejection for seeded unordered settlements',async()=>{
 let seed=93821;const random=(max:number)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%max;};
 for(let trial=0;trial<80;trial++){
  const subs=Array.from({length:50},(_,index)=>{
   const first=index*10+1+random(4),answer=first+random(trial%3===0?18:7);
   return {conversationId:7,type:'input',status:'done',entry:first,answer};
  });
  // Multiple admitted inputs may share one final answer; keep its earliest input.
  for(const sub of subs.slice(0,5))subs.push({...sub,entry:sub.answer});
  for(let i=subs.length-1;i>0;i--){const at=random(i+1);[subs[i],subs[at]]=[subs[at],subs[i]];}
  const grouped=new Map<number,{version:1;first:number;answer:number}>();
  for(const sub of subs)grouped.set(sub.answer,{version:1,first:Math.min(grouped.get(sub.answer)?.first??sub.entry,sub.entry),answer:sub.answer});
  const all=[...grouped.values()];
  const valid=all.filter(group=>!all.some(other=>other!==group&&group.first<=other.answer&&other.first<=group.answer));
  const reader={scanSubmissions:async()=>({items:subs}),entry:async(id:number)=>({entry:entry(id),commitSeq:1})};
  const originals=Array.from({length:504},(_,i)=>entry(i+1,'bob.file'));
  // Input presentation order is independent of chronological order.
  if(trial%2)originals.reverse();
  const before=JSON.stringify(originals),result=await presenter(reader)(7 as any,originals);
  for(let i=0;i<result.length;i++){
   const expected=valid.find(group=>result[i].id>=group.first&&result[i].id<=group.answer);
   assert.deepEqual(result[i].mobileReply,expected,`trial ${trial}, entry ${result[i].id}`);
   if(!expected)assert.equal(result[i],originals[i]);
  }
  assert.equal(JSON.stringify(originals),before,'presentation must not mutate native entries');
 }
});

test('unchanged large-history presentation does logarithmic rather than full-range lookup',async()=>{
 const count=1000,subs=Array.from({length:count},(_,i)=>({conversationId:7,type:'input',status:'done',entry:i*4+1,answer:i*4+3}));
 let scans=0,answerReads=0;
 const reader={scanSubmissions:async(_filter:unknown,size:number,cursor?:{offset:number})=>{
  scans++;const offset=cursor?.offset??0;return {items:subs.slice(offset,offset+size),next:offset+size<subs.length?{offset:offset+size}:undefined};
 },entry:async(id:number)=>{answerReads++;return {entry:entry(id),commitSeq:1};}};
 const present=presenter(reader),originals=subs.map(sub=>entry(sub.answer,'bob.file'));
 const first=await present(7 as any,originals);assert.equal(scans,10);assert.equal(answerReads,count);
 // Count reads of the actual reused range objects, not elapsed time or a
 // reimplementation of the algorithm. Instrumentation never changes values.
 let rangeReads=0;
 for(const row of first)for(const name of ['first','answer']){
  const value=row.mobileReply[name];
  Object.defineProperty(row.mobileReply,name,{get:()=>{rangeReads++;return value;},configurable:true,enumerable:true});
 }
 const again=await present(7 as any,originals);
 assert.ok(again.every((row,i)=>row===first[i]),'retain immutable projected entry identity');
 assert.equal(scans,10);assert.equal(answerReads,count,'unchanged windows retain existing read reuse');
 assert.ok(rangeReads<count*16,`${rangeReads} range-field reads must fit logarithmic lookup; a full range scan is quadratic`);
});
