import assert from 'node:assert/strict';
import test from 'node:test';
import {createReplyPresentation} from '../src/reply-presentation.js';
const entry=(id:number,kind='pi.assistant')=>({id,conversationId:7,kind,model:kind==='pi.assistant'?[{role:'assistant',content:'Answer'}]:undefined}) as any;
test('native done input settlements bind file/call/answer display without changing official entries',async()=>{
 const original=[entry(10,'bob.user'),entry(12,'bob.artifact'),entry(20,'bob.file'),entry(22),entry(50)];
 const before=JSON.stringify(original);let scans=0;
 const reader={scanSubmissions:async()=>{scans++;return {items:[{conversationId:7,type:'input',status:'done',entry:10,answer:50},{conversationId:7,type:'input',status:'done',entry:25,answer:50}]};},entry:async(id:number)=>({entry:original.find(e=>e.id===id),commitSeq:1})};
 const present=createReplyPresentation(reader as any),result=await present(7 as any,original);
 assert.equal(result[0],original[0]);assert.equal(result[1],original[1]);
 for(const item of result.slice(2))assert.deepEqual(item.mobileReply,{version:1,first:10,answer:50});
 assert.equal(JSON.stringify(original),before);
 assert.equal((await present(7 as any,original))[2],result[2]);assert.equal(scans,1,'stream-only changes do not rescan the same window');
});
test('unproven, cross-conversation and overlapping answers do not invent attachment ownership',async()=>{
 const original=[entry(20,'bob.file'),entry(50),entry(60)];
 const subs=[{conversationId:8,type:'input',status:'done',entry:1,answer:50},{conversationId:7,type:'write',status:'done',entry:20},{conversationId:7,type:'input',status:'done',entry:60,answer:50}];
 const reader={scanSubmissions:async()=>({items:subs}),entry:async(id:number)=>({entry:original.find(e=>e.id===id),commitSeq:1})};
 assert.deepEqual(await createReplyPresentation(reader as any)(7 as any,original),original);
 subs.push({conversationId:7,type:'input',status:'done',entry:10,answer:50} as any,{conversationId:7,type:'input',status:'done',entry:15,answer:60} as any);
 const overlapping=await createReplyPresentation(reader as any)(7 as any,original);assert.ok(overlapping.every(e=>e.mobileReply===undefined),'an overlapping prefix invalidates the entire answer range');
});
test('new committed answer advances projection and scan work has a hard bound',async()=>{
 let scans=0,complete=false;
 const reader={scanSubmissions:async()=>{scans++;return {items:complete?[{conversationId:7,type:'input',status:'done',entry:1,answer:50}]:[],next:{offset:scans}};},entry:async(id:number)=>({entry:entry(id),commitSeq:1})};
 const present=createReplyPresentation(reader as any),file=entry(20,'bob.file');
 assert.equal((await present(7 as any,[file]))[0].mobileReply,undefined);assert.equal(scans,10);
 complete=true;assert.deepEqual((await present(7 as any,[file,entry(50)]))[0].mobileReply,{version:1,first:1,answer:50});assert.equal(scans,20);
});

test('a newly settled answer invalidates older incomplete window caches',async()=>{
 let complete=false;const file=entry(20,'bob.file');
 const reader={scanSubmissions:async()=>({items:complete?[{conversationId:7,type:'input',status:'done',entry:1,answer:50}]:[]}),entry:async(id:number)=>({entry:entry(id),commitSeq:1})};
 const present=createReplyPresentation(reader as any);assert.equal((await present(7 as any,[file]))[0].mobileReply,undefined);
 complete=true;await present(7 as any,[entry(50)]);
 assert.deepEqual((await present(7 as any,[file]))[0].mobileReply,{version:1,first:1,answer:50});
});

test('an answer-only page cannot certify a range overlapping an earlier unloaded answer',async()=>{
 const reader={scanSubmissions:async()=>({items:[{conversationId:7,type:'input',status:'done',entry:10,answer:30},{conversationId:7,type:'input',status:'done',entry:20,answer:40}]}),entry:async(id:number)=>({entry:entry(id),commitSeq:1})};
 const present=createReplyPresentation(reader as any);
 assert.equal((await present(7 as any,[entry(40)]))[0].mobileReply,undefined);
 assert.equal((await present(7 as any,[entry(25,'bob.file')]))[0].mobileReply,undefined);
});
