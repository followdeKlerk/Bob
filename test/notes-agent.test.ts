import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {serve} from '../src/server.js';
import {notesOperation} from '../src/notes-agent.js';
import {readNotes,syncNote} from '../src/notes.js';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';

test('actual native notes tool creates a categorized note that the authenticated app endpoint sees',{timeout:15000},async()=>{
 const state=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-agent-note-'))),models=createModels(),faux=fauxProvider({tokensPerSecond:100000});models.setProvider(faux.provider);
 faux.setResponses([fauxAssistantMessage([fauxToolCall('notes',{action:'create',title:'Launch checklist',body:'## Release\n- [ ] Verify install\n- [ ] Check sync',categories:['Work'],pinned:true})],{stopReason:'toolUse'}),fauxAssistantMessage('Note saved.')]);
 const runtime=await openRuntime(state,models),app=await serve(state,{port:0,runtime}),device=state.pair(state.invite().token,'Agent notes fixture');
 const base=`http://127.0.0.1:${(app.server.address() as any).port}/v1`,headers={authorization:'Bearer '+device.credential,'x-bob-backend':state.id,'content-type':'application/json'};
 try{
  const created=await fetch(base+'/chats',{method:'POST',headers,body:JSON.stringify({title:'Agent note fixture',model:{provider:'faux',modelId:'faux-1'}})});const {id}=await created.json() as any;
  const chat=(await runtime.harness.conversation(id,ctx))!;
  const agent=await chat.agent(ctx);assert.ok(agent.tools.some(tool=>tool.name==='notes'));
  const sent=await fetch(base+`/chats/${id}/messages`,{method:'POST',headers,body:JSON.stringify({requestId:randomUUID(),text:'Save my release checklist under Work',mode:'steer'})});assert.equal(sent.status,202);await chat.waitForIdle(ctx);
  const notebook=await (await fetch(base+'/notes',{headers})).json() as any;
  assert.equal(notebook.notes.length,1);assert.equal(notebook.categories[0].name,'Work');
  assert.equal(notebook.notes[0].title,'Launch checklist');assert.equal(notebook.notes[0].pinned,true);assert.deepEqual(notebook.notes[0].categoryIds,[notebook.categories[0].id]);assert.match(notebook.notes[0].body,/- \[ \] Check sync/);
  const history=await (await fetch(base+`/chats/${id}/history`,{headers})).json() as any;
  assert.ok(JSON.stringify(history.items).includes('"persisted":true')||JSON.stringify(history.items).includes('\\"persisted\\":true'));
 }finally{await app.close();state.close();}
});

test('agent note writes are atomic, task-idempotent across reopen, revision-safe, and preserve unsupplied fields',{timeout:20000},async()=>{
 const state=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-note-agent-ops-')));let runtime=await openRuntime(state);
 const source=(await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx)).id;
 const call=(task:string,input:unknown)=>notesOperation(state,runtime.library,source,task,input,ctx) as Promise<any>;
 const input={action:'create',title:'Remember this',body:'Important body',categories:['Work','work'],pinned:true,color:'sage'};
 try{
  const saved=await call('create-1',input);assert.equal(saved.persisted,true);assert.equal(saved.note.revision,1);assert.equal(saved.note.categories.length,1);
  const id=saved.note.id,version=(await readNotes(runtime.library,state.id,0)).version;
  assert.deepEqual(await call('create-1',input),saved);assert.equal((await readNotes(runtime.library,state.id,0)).version,version);
  await assert.rejects(()=>call('create-1',{...input,body:'Altered request'}),/identity conflict/);
  await runtime.close();runtime=await openRuntime(state);
  assert.deepEqual(await call('create-1',input),saved,'task receipt survives a backend restart');
  const updated=await call('update-1',{action:'update',id,expectedRevision:1,title:'Renamed'});assert.equal(updated.note.revision,2);
  let full=await call('get-1',{action:'get',id});assert.equal(full.note.body,'Important body');assert.equal(full.note.pinned,true);assert.equal(full.note.color,'sage');assert.equal(full.note.categoryIds.length,1);
  await assert.rejects(()=>call('invalid-revision',{action:'update',id,body:'Not saved',categories:['Must not be created']}),/expectedRevision/);
  assert.equal((await readNotes(runtime.library,state.id,0)).categories.length,1);
  const categories=await call('categories',{action:'categories'});assert.equal(categories.items[0].name,'Work');
  const rename=await call('rename-category',{action:'update_category',id:categories.items[0].id,expectedRevision:1,name:'Projects'});assert.equal(rename.category.name,'Projects');
  full=await call('get-2',{action:'get',id});assert.deepEqual(full.note.categories,['Projects']);
  await syncNote(runtime.library,state.id,'fixture-mobile',{kind:'note',id,requestId:randomUUID(),conflictId:randomUUID(),baseRevision:2,editedAt:Date.now(),value:{title:'Renamed',body:'Mobile edit',categoryIds:full.note.categoryIds,pinned:true,trashed:false,color:'sage'}});
  const conflict=await call('stale-edit',{action:'update',id,expectedRevision:2,body:'Chat edit'});assert.equal(conflict.conflict,true);assert.notEqual(conflict.note.id,id);
  const book=await readNotes(runtime.library,state.id,0);assert.equal(book.notes.find((note:any)=>note.id===id).body,'Mobile edit');assert.equal(book.notes.find((note:any)=>note.id===conflict.note.id).body,'Chat edit');
  const trashed=await call('trash',{action:'trash',id,expectedRevision:3});assert.equal(trashed.note.trashed,true);
  assert.ok(!(await call('list',{action:'list'})).items.some((note:any)=>note.id===id));
  const restored=await call('restore',{action:'restore',id,expectedRevision:4});assert.equal(restored.note.trashed,false);
  const removed=await call('remove-category',{action:'remove_category',id:rename.category.id,expectedRevision:2});assert.equal(removed.category.deleted,true);
  assert.equal((await call('categories2',{action:'categories'})).items.length,0);
  assert.equal((await call('get3',{action:'get',id})).note.body,'Mobile edit','removing a category never removes its notes');
  const before=(await readNotes(runtime.library,state.id,0)).version;
  await assert.rejects(()=>call('empty',{action:'create',categories:['Rollback category']}),/title or body/);
  assert.equal((await readNotes(runtime.library,state.id,0)).version,before,'category auto-creation rolls back with a failed note');
 }finally{await runtime.close();state.close();}
});

test('note search is bounded and cursors cannot cross filters or a changed notebook',{timeout:15000},async()=>{
 const state=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-note-search-'))),runtime=await openRuntime(state);
 const source=(await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx)).id;
 const call=(task:string,input:unknown)=>notesOperation(state,runtime.library,source,task,input,ctx) as Promise<any>;
 try{
  for(let index=0;index<3;index++)await call(`create-${index}`,{action:'create',title:`Search ${index}`,body:'private body '.repeat(1000),categories:['Work']});
  const first=await call('list1',{action:'list',query:'Search',category:'Work',limit:1});assert.equal(first.items.length,1);assert.ok(first.next);assert.ok(JSON.stringify(first).length<3000);assert.equal(first.items[0].body,undefined);
  const second=await call('list2',{action:'list',query:'Search',category:'Work',limit:1,cursor:first.next});assert.notEqual(second.items[0].id,first.items[0].id);
  await assert.rejects(()=>call('wrong-filter',{action:'list',query:'Different',limit:1,cursor:first.next}),/cursor/);
  await call('extra',{action:'create',title:'Another note'});
  await assert.rejects(()=>call('stale-page',{action:'list',query:'Search',category:'Work',limit:1,cursor:first.next}),/changed during/);
  assert.equal((await call('none',{action:'list',category:'Nonexistent'})).items.length,0);
 }finally{await runtime.close();state.close();}
});
