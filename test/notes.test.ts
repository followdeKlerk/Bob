import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {State} from '../src/state.js';
import {serve} from '../src/server.js';
import {Notes} from '../src/notes.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {Questions} from '../src/documents.js';
const value={title:'Important information',body:'## Heading\n**Bold** and a list\n- [ ] Follow up',categoryIds:[] as string[],pinned:false,trashed:false,color:'sage'};
const mutation=(kind:'note'|'category',id:string,baseRevision:number,content:any)=>({kind,id,baseRevision,value:content,requestId:randomUUID(),conflictId:randomUUID(),editedAt:Date.now()});
test('authenticated native notes: categories, Markdown, incremental sync, idempotence, trash and restart persistence',{timeout:20000},async()=>{
 const state=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-notes-')));let app=await serve(state,{port:0});
 const device=state.pair(state.invite().token,'Notes fixture');
 let base=`http://127.0.0.1:${(app.server.address() as any).port}/v1`;
 const headers={authorization:'Bearer '+device.credential,'x-bob-backend':state.id,'content-type':'application/json'};
 const get=async(since=0)=>{const response=await fetch(base+`/notes?since=${since}`,{headers});assert.equal(response.status,200);return response.json() as Promise<any>;};
 const post=async(operation:any)=>{const response=await fetch(base+'/notes/sync',{method:'POST',headers,body:JSON.stringify(operation)});assert.equal(response.status,200,await response.clone().text());return response.json() as Promise<any>;};
 try{
  assert.equal((await fetch(base+'/notes')).status,401);
  assert.equal((await fetch(base+'/notes',{headers:{...headers,'x-bob-backend':randomUUID()}})).status,409);
  assert.equal((await fetch(base+'/notes?since=-1',{headers})).status,400);
  assert.deepEqual((await get()).notes,[]);
  const categoryId=randomUUID(),noteId=randomUUID();
  const category=await post(mutation('category',categoryId,0,{name:'Work',deleted:false}));assert.equal(category.entity.revision,1);
  const create=mutation('note',noteId,0,{...value,categoryIds:[categoryId]});
  const saved=await post(create);assert.equal(saved.entity.body,value.body);assert.equal(saved.entity.color,'sage');
  const version=(await get()).version;
  assert.deepEqual((await get(version)).notes,[]);
  assert.equal((await post(create)).entity.id,noteId);assert.equal((await get()).version,version);
  assert.equal((await fetch(base+'/notes/sync',{method:'POST',headers,body:JSON.stringify({...create,value:{...create.value,title:'Different payload, same request'}})})).status,409);
  const updated=await post(mutation('note',noteId,1,{...create.value,pinned:true}));assert.equal(updated.entity.revision,2);
  const delta=await get(version);assert.equal(delta.notes.length,1);assert.equal(delta.categories.length,0);assert.equal(delta.notes[0].pinned,true);
  await post(mutation('note',noteId,2,{...create.value,pinned:true,trashed:true}));assert.equal((await get()).notes[0].trashed,true);
  await post(mutation('note',noteId,3,{...create.value,trashed:false}));
  const unicode=mutation('note',randomUUID(),0,{...value,title:'Unicode',body:'漢'.repeat(100000)});
  const unicodeSaved=await post(unicode);assert.equal(unicodeSaved.entity.body.length,100000,'valid note size is measured in characters, not accidentally rejected by the general request byte limit');
  const originalChat=await app.runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
  await originalChat.commit(async tx=>{(await tx.doc(Questions,originalChat.id)).pending={id:'legacy-question',text:'Keep this existing data'};},ctx);
  const chatId=originalChat.id;
  assert.equal((await app.runtime.harness.snapshot(Notes,app.runtime.library.id,ctx))!.notes[noteId].revision,4);
  await app.close();app=await serve(state,{port:0});base=`http://127.0.0.1:${(app.server.address() as any).port}/v1`;
  const reopened=await get();assert.equal(reopened.notes[0].body,value.body);assert.equal(reopened.notes[0].trashed,false);assert.equal(reopened.categories[0].name,'Work');
  assert.equal((await app.runtime.harness.snapshot(Questions,chatId,ctx))!.pending!.id,'legacy-question');
  assert.equal((await post(create)).appliedRevision,1,'receipt survives restart even when note now has a newer revision');
 }finally{await app.close();state.close();}
});
test('concurrent note/category edits preserve both versions and conflict retries do not create extra copies',{timeout:15000},async()=>{
 const state=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-note-conflict-'))),runtime=await openRuntime(state);
 const {syncNote,readNotes}=await import('../src/notes.js');
 const sync=(operation:any)=>syncNote(runtime.library,state.id,'device-one',operation);
 try{
  const id=randomUUID();await sync(mutation('note',id,0,value));
  await sync(mutation('note',id,1,{...value,title:'Server edit',body:'Keep server text'}));
  const stale=mutation('note',id,1,{...value,title:'Offline edit',body:'Keep offline text'});
  const result=await sync(stale);assert.equal(result.conflict,true);assert.equal(result.entity.id,stale.conflictId);assert.equal(result.entity.conflictOf,id);
  const repeated=await sync(stale);assert.equal(repeated.entity.id,result.entity.id);
  const notes=(await readNotes(runtime.library,state.id,0)).notes;
  assert.equal(notes.length,2);assert.equal(notes.find(note=>note.id===id)!.body,'Keep server text');assert.equal(notes.find(note=>note.id===stale.conflictId)!.body,'Keep offline text');
  const racingId=randomUUID();await sync(mutation('note',racingId,0,value));
  const racing=await Promise.all([sync(mutation('note',racingId,1,{...value,body:'Concurrent A'})),sync(mutation('note',racingId,1,{...value,body:'Concurrent B'}))]);
  assert.deepEqual(racing.map(result=>result.conflict).sort(),[false,true],'concurrent native commits must not overwrite each other');
  const categoryId=randomUUID();await sync(mutation('category',categoryId,0,{name:'Original',deleted:false}));await sync(mutation('category',categoryId,1,{name:'Remote rename',deleted:false}));
  const categoryConflict=await sync(mutation('category',categoryId,1,{name:'Offline rename',deleted:false}));assert.equal(categoryConflict.conflict,true);assert.equal((await readNotes(runtime.library,state.id,0)).categories.length,2);
 }finally{await runtime.close();state.close();}
});
