jest.mock('../history-cache',()=>({readHistoryCache:jest.fn(),writeHistoryCache:jest.fn()}));
import {reuseSnapshotEntries} from '../snapshot-cache';
test('immutable stored entries retain object identity while new live documents and entries advance',()=>{
 const original={id:1,data:{text:'Original preserved reply'}},previous={entries:[original],docs:{live:'before'}};
 const next={entries:[{id:1,data:{text:'Original preserved reply'}},{id:2,data:{text:'New reply'}}],docs:{live:'after'}};
 const result=reuseSnapshotEntries(previous,next);expect(result.entries[0]).toBe(original);expect(result.entries[1]).toBe(next.entries[1]);expect(result.docs).toBe(next.docs);expect(previous.entries).toHaveLength(1);
});
test('a new scope has no reused objects and removed entries do not leak back in',()=>{
 const next={entries:[{id:2}]};expect(reuseSnapshotEntries(undefined,next)).toBe(next);expect(reuseSnapshotEntries({entries:[{id:1}]},next).entries.map(entry=>entry.id)).toEqual([2]);
});

test('unchanged heartbeats retain the entire snapshot and live markdown/tool identities',()=>{
 const previous={entries:[{id:1}],docs:{'pi.live':{generation:{message:{content:[{type:'text',text:'Streaming reply'}]}},tools:[{callId:'call',output:'Progress'}]}},work:[{id:12,state:'running'}]};
 expect(reuseSnapshotEntries(previous,JSON.parse(JSON.stringify(previous)))).toBe(previous);
});
test('unrelated document changes do not reparse an unchanged live reply',()=>{
 const previous={entries:[{id:1}],docs:{'pi.live':{generation:{message:{content:[{type:'text',text:'Reply'}]}}},'bob.todos':{items:[] as string[]}}};
 const next=JSON.parse(JSON.stringify(previous));next.docs['bob.todos'].items=['New todo'];
 const result=reuseSnapshotEntries(previous,next);expect(result.docs['pi.live']).toBe(previous.docs['pi.live']);expect(result.entries).toBe(previous.entries);expect(result.docs['bob.todos']).toBe(next.docs['bob.todos']);
});
test('cleared live generation is not resurrected by identity reuse',()=>{
 const previous={entries:[{id:1}],docs:{'pi.live':{generation:{message:{content:[]}}}}};
 const next={entries:[{id:1},{id:2}],docs:{'pi.live':{}}};const result=reuseSnapshotEntries(previous,next);expect(result.docs['pi.live']).toEqual({});expect(result.entries).toHaveLength(2);
});

test('passive receipt rows advance and retry while unchanged cells and heartbeat snapshots retain identity',()=>{
 const message={id:1,kind:'pi.assistant',data:{text:'unchanged'}};
 const queued={id:2,kind:'bob.memory-status',data:{phase:'save-queued',receiptKey:'input:1'}};
 let previous={entries:[message,queued],docs:{}};
 for(const phase of ['save-processing','save-completed','save-failed','save-queued','save-warning','save-cancelled']){
  const next={entries:[JSON.parse(JSON.stringify(message)),{...queued,data:{...queued.data,phase}}],docs:{}};
  const updated=reuseSnapshotEntries(previous,next);
  expect(updated.entries[0]).toBe(message);
  expect(updated.entries[1]).toBe(next.entries[1]);
  expect(updated.entries[1].id).toBe(2);
  expect(reuseSnapshotEntries(updated,JSON.parse(JSON.stringify(updated)))).toBe(updated);
  previous=updated;
 }
});

test('slim server image presentation replaces a same-ID legacy cache once, then preserves heartbeat identity',()=>{
 const legacy={id:1,kind:'pi.tool-result',model:[{role:'toolResult',toolCallId:'read-image',content:[{type:'image',data:'A'.repeat(3170000),mimeType:'image/png'}]}]};
 const unchanged={id:2,kind:'pi.assistant',data:{text:'Preserved reply'}};
 const previous={entries:[legacy,unchanged],docs:{}};
 const projected={...legacy,mobilePresentation:{version:1,omittedToolImages:true,originalEntryId:1},model:[{role:'toolResult',toolCallId:'read-image',content:[{type:'text',text:'Image bytes omitted; original retained in stored history.'}]}]};
 const next={entries:[projected,JSON.parse(JSON.stringify(unchanged))],docs:{}};
 const current=reuseSnapshotEntries(previous,next);
 expect(current.entries[0]).toBe(projected);expect(current.entries[1]).toBe(unchanged);
 expect(reuseSnapshotEntries(current,JSON.parse(JSON.stringify(current)))).toBe(current);
 const restored=reuseSnapshotEntries(current,previous);expect(restored.entries[0]).toBe(legacy);
 const revised={...projected,mobilePresentation:{...projected.mobilePresentation,version:2}};
 expect(reuseSnapshotEntries(current,{...next,entries:[revised,unchanged]}).entries[0]).toBe(revised);
 expect(legacy.model[0].content[0].data).toHaveLength(3170000);
});

test('native reply associations refresh live and cached entry identities exactly once',()=>{
 const file={id:3,kind:'bob.file',data:{name:'report.txt'}},answer={id:8,kind:'pi.assistant',model:[{role:'assistant',content:'Done'}]};
 const previous={entries:[file,answer],docs:{}},mobileReply={version:1,first:1,answer:8};
 const next={entries:[{...file,mobileReply},{...answer,mobileReply}],docs:{}};
 const updated=reuseSnapshotEntries(previous,next);
 expect(updated.entries[0]).toBe(next.entries[0]);expect(updated.entries[1]).toBe(next.entries[1]);
 expect(reuseSnapshotEntries(updated,JSON.parse(JSON.stringify(updated)))).toBe(updated);
 const {mergeLatestHistory}=require('../stored-history');
 const page={backendId:'11111111-1111-4111-8111-111111111111',conversationId:7,coverage:'stored-entries',items:previous.entries};
 expect(mergeLatestHistory(page,{...page,items:next.entries}).items[0].mobileReply).toEqual(mobileReply);
});

test('text tokens retain unchanged tool subtrees but changed, cleared and removed tools stay authoritative',()=>{
 const previous={entries:[{id:1}],docs:{'pi.live':{generation:{message:{content:[{type:'text',text:'A'}]}},tools:[{callId:'c',status:'running',output:'one'}],nestedTools:[{callId:'child',status:'running'}]}}};
 const next=JSON.parse(JSON.stringify(previous));next.docs['pi.live'].generation.message.content[0].text='AB';
 const updated=reuseSnapshotEntries(previous,next);
 expect(updated.docs['pi.live']).not.toBe(previous.docs['pi.live']);
 expect(updated.docs['pi.live'].tools).toBe(previous.docs['pi.live'].tools);
 expect(updated.docs['pi.live'].nestedTools).toBe(previous.docs['pi.live'].nestedTools);
 expect(updated.docs['pi.live'].generation.message.content[0].text).toBe('AB');
 const changed=JSON.parse(JSON.stringify(next));changed.docs['pi.live'].tools[0].output='two';changed.docs['pi.live'].nestedTools[0].status='done';
 const result=reuseSnapshotEntries(updated,changed);expect(result.docs['pi.live'].tools).toBe(changed.docs['pi.live'].tools);expect(result.docs['pi.live'].nestedTools).toBe(changed.docs['pi.live'].nestedTools);
 const cleared={entries:[{id:1}],docs:{'pi.live':{tools:[],nestedTools:[]}}};expect(reuseSnapshotEntries(result,cleared).docs['pi.live']).toEqual(cleared.docs['pi.live']);
 const removed={entries:[{id:1}],docs:{'pi.live':{}}};expect(reuseSnapshotEntries(result,removed).docs['pi.live']).toEqual({});
 expect(previous.docs['pi.live'].generation.message.content[0].text).toBe('A');
});
