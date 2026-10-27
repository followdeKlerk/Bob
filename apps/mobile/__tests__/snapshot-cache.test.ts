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
