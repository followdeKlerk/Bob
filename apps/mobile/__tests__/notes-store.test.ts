import AsyncStorage from '@react-native-async-storage/async-storage';
import {NotesStore} from '../notes-store';
import {formatNote,toggleNoteTask} from '../notes-format';
import type {NotesMutation} from '../../../src/notes-contracts';
jest.mock('@react-native-async-storage/async-storage',()=>{const values=new Map();return{getItem:jest.fn(async(key:string)=>values.get(key)??null),setItem:jest.fn(async(key:string,value:string)=>{values.set(key,value);}),clear:jest.fn(async()=>values.clear())};});
jest.mock('uuid',()=>{let next=1;return{v4:()=>`00000000-0000-4000-8000-${String(next++).padStart(12,'0')}`};});
const backend='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const value={title:'Offline note',body:'Important information',categoryIds:[] as string[],pinned:false,trashed:false,color:'sage' as const};
function server(){
 let version=0,online=true,loseResponse=false;
 const notes:Record<string,any>={},categories:Record<string,any>={},receipts=new Map<string,any>();
 const post=jest.fn((op:NotesMutation)=>{
  if(receipts.has(op.requestId)){const receipt=receipts.get(op.requestId);return {...receipt,entity:(op.kind==='note'?notes:categories)[receipt.entity.id]};}
  const table=op.kind==='note'?notes:categories,current=table[op.id],conflict=(current?.revision??0)!==op.baseRevision;
  const id=conflict?op.conflictId:op.id,revision=conflict?1:(current?.revision??0)+1;
  table[id]={...op.value,id,revision,updatedAt:Date.now(),changeSeq:++version,...(conflict?{conflictOf:op.id}:{})};
  const result={backendId:backend,requestId:op.requestId,kind:op.kind,entity:table[id],appliedRevision:revision,conflict,...(conflict&&current?{original:current}:{})};receipts.set(op.requestId,result);return result;
 });
 const transport=jest.fn(async(path:string,method?:string,body?:unknown)=>{
  if(!online)throw Error('Offline');
  if(method==='POST'){
   const result=post(body as NotesMutation);
   if(loseResponse){loseResponse=false;throw Error('Response lost after commit');}
   return result;
  }
  const since=Number(path.split('since=')[1]??0);
  return {backendId:backend,version,notes:Object.values(notes).filter(note=>note.changeSeq>since),categories:Object.values(categories).filter(category=>category.changeSeq>since)};
 });
 return {notes,categories,post,transport,offline:()=>{online=false;},online:()=>{online=true;},lose:()=>{loseResponse=true;}};
}
beforeEach(async()=>{await AsyncStorage.clear();});
test('notes save offline, reopen from cache, and sync to the correct backend without data loss',async()=>{
 const remote=server();remote.offline();const store=new NotesStore(backend,remote.transport);await store.loaded;
 const id=await store.saveNote(value);await store.sync();
 expect(store.notes[0].body).toBe(value.body);expect(store.pendingCount).toBe(1);
 const reopened=new NotesStore(backend,remote.transport);await reopened.loaded;expect(reopened.notes[0].id).toBe(id);
 const isolated=new NotesStore(other,remote.transport);await isolated.loaded;expect(isolated.notes).toEqual([]);
 remote.online();await reopened.sync();expect(reopened.pendingCount).toBe(0);expect(remote.notes[id].revision).toBe(1);
 const final=new NotesStore(backend,remote.transport);await final.loaded;expect(final.notes[0].body).toBe(value.body);expect(final.pendingCount).toBe(0);
});
test('lost responses replay the saved request ID rather than creating duplicate notes',async()=>{
 const remote=server(),store=new NotesStore(backend,remote.transport);await store.loaded;remote.lose();
 const id=await store.saveNote(value);await store.sync();expect(store.pendingCount).toBe(1);expect(Object.keys(remote.notes)).toEqual([id]);
 await store.sync();expect(store.pendingCount).toBe(0);expect(Object.keys(remote.notes)).toEqual([id]);
 expect(remote.post.mock.calls[0][0].requestId).toBe(remote.post.mock.calls[1][0].requestId);expect(remote.notes[id].revision).toBe(1);
});
test('server updates are preserved beneath offline edits and stale edits become a separate conflict copy',async()=>{
 const remote=server(),store=new NotesStore(backend,remote.transport);await store.loaded;
 const id=await store.saveNote(value);await store.sync();
 remote.offline();await store.saveNote({...value,body:'Offline version'},id);await store.sync();
 remote.post({kind:'note',id,baseRevision:1,requestId:'remote-edit',conflictId:'remote-copy',editedAt:Date.now(),value:{...value,body:'Server version'}});
 remote.online();await store.sync();expect(store.pendingCount).toBe(0);expect(store.notes).toHaveLength(2);
 expect(store.notes.find(note=>note.id===id)!.body).toBe('Server version');
 expect(store.notes.find(note=>note.conflictOf===id)!.body).toBe('Offline version');
});
test('several offline edits to the same note rebase on their own receipts rather than generating false conflicts',async()=>{
 const remote=server();remote.offline();const store=new NotesStore(backend,remote.transport);await store.loaded;
 const id=await store.saveNote(value);await store.sync();
 await store.saveNote({...value,title:'New title'},id);await store.sync();
 await store.saveNote({...value,title:'Final title',body:'Final body'},id);await store.sync();
 remote.online();await store.sync();expect(store.pendingCount).toBe(0);expect(store.notes).toHaveLength(1);expect(store.notes[0].revision).toBe(3);expect(store.notes[0].body).toBe('Final body');
});
test('category conflict copies retarget queued note assignments without changing the original category',async()=>{
 const remote=server(),store=new NotesStore(backend,remote.transport);await store.loaded;
 const category=await store.saveCategory({name:'Work',deleted:false});await store.sync();remote.offline();
 await store.saveCategory({name:'My work',deleted:false},category);await store.sync();await store.saveNote({...value,categoryIds:[category]});await store.sync();
 remote.post({kind:'category',id:category,baseRevision:1,requestId:'remote-category',conflictId:'remote-copy',editedAt:Date.now(),value:{name:'Remote work',deleted:false}});
 remote.online();await store.sync();const fork=store.categories.find(item=>item.conflictOf===category)!;
 expect(fork.name).toBe('My work');expect(store.notes[0].categoryIds).toEqual([fork.id]);expect(store.categories.find(item=>item.id===category)!.name).toBe('Remote work');
});
test('an editor can submit its opening revision so a background refresh cannot overwrite a remote edit',async()=>{
 const remote=server(),store=new NotesStore(backend,remote.transport);await store.loaded;
 const id=await store.saveNote(value);await store.sync();const openedRevision=store.notes[0].revision;
 remote.post({kind:'note',id,baseRevision:1,requestId:'remote-editor',conflictId:'remote-copy',editedAt:Date.now(),value:{...value,body:'Changed while editor was open'}});await store.sync();
 await store.saveNote({...value,body:'Editor draft'},id,openedRevision);await store.sync();expect(store.notes).toHaveLength(2);expect(store.notes.find(note=>note.id===id)!.body).toBe('Changed while editor was open');
});
test('corrupt caches are not overwritten, and server identity mismatches do not merge data',async()=>{
 await AsyncStorage.setItem(`notes:v1:${backend}`,'broken');const store=new NotesStore(backend,server().transport);await store.loaded;await store.sync();expect(store.ready).toBe(false);expect(await AsyncStorage.getItem(`notes:v1:${backend}`)).toBe('broken');
 await AsyncStorage.clear();const mismatch=new NotesStore(backend,async()=>({backendId:other,version:10,notes:[],categories:[]}));await mismatch.loaded;await mismatch.sync();expect(mismatch.notes).toEqual([]);expect(mismatch.error).toBeTruthy();
});
test('formatting wraps a selection, prefixes lines and toggles checklists without changing other text',()=>{
 expect(formatNote('Hello world',6,11,'bold').text).toBe('Hello **world**');
 expect(formatNote('One\nTwo',0,7,'checklist').text).toBe('- [ ] One\n- [ ] Two');
 expect(formatNote('Title',0,0,'heading').text).toBe('## Title');
 expect(toggleNoteTask('- [ ] One\n- [x] Two',0)).toBe('- [x] One\n- [x] Two');
});

test('a replay receipt rebases later edits onto its applied revision, not a newer remote revision',async()=>{
 const remote=server(),store=new NotesStore(backend,remote.transport);await store.loaded;
 const id=await store.saveNote(value);await store.sync();
 remote.lose();await store.saveNote({...value,body:'First local edit'},id);await store.sync();
 expect(store.pendingCount).toBe(1);
 remote.offline();await store.saveNote({...value,body:'Second local edit'},id);await store.sync();
 remote.post({kind:'note',id,baseRevision:2,requestId:'remote-between-replay',conflictId:'remote-copy',editedAt:Date.now(),value:{...value,body:'Remote edit after first local commit'}});
 remote.online();await store.sync();
 expect(store.pendingCount).toBe(0);expect(store.notes).toHaveLength(2);
 expect(store.notes.find(note=>note.id===id)!.body).toBe('Remote edit after first local commit');
 expect(store.notes.find(note=>note.conflictOf===id)!.body).toBe('Second local edit');
});

test('storage failures never send an unsaved mutation; retry preserves the local pending edit',async()=>{
 const remote=server(),store=new NotesStore(backend,remote.transport);await store.loaded;
 const write=(AsyncStorage.setItem as jest.Mock).getMockImplementation()!;
 (AsyncStorage.setItem as jest.Mock).mockRejectedValue(Error('Disk unavailable'));
 try{
  await expect(store.saveNote(value)).rejects.toThrow('Disk unavailable');await store.sync();
  expect(store.localError).toBe(true);expect(store.pendingCount).toBe(1);expect(remote.transport).not.toHaveBeenCalled();
 }finally{(AsyncStorage.setItem as jest.Mock).mockImplementation(write);}
 await store.sync();expect(store.localError).toBe(false);expect(store.pendingCount).toBe(0);expect(store.notes[0].body).toBe(value.body);
});
