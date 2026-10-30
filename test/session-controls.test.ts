import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {serve} from '../src/server.js';
import {SessionUI} from '../src/session-controls.js';
import {ChatMeta} from '../src/documents.js';
import {defineTask} from '@earendil-works/pi-durable';
test('session metadata controls are durable, recoverable and preserve all conversation entries',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'bob-sessions-')),state=new State(dir),runtime=await openRuntime(state),app=await serve(state,{port:0,runtime}),server=app.server;
 try{
  const device=state.pair(state.invite().token,'Session controls test');
  const endpoint=`http://127.0.0.1:${(server.address() as any).port}/v1`,headers={authorization:'Bearer '+device.credential,'x-bob-backend':state.id,'content-type':'application/json'};
  async function request(path:string,method='GET',data?:unknown){const response=await fetch(endpoint+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)});return {status:response.status,value:await response.json() as any};}
  const created=await request('/chats','POST',{title:'Original'}),id=created.value.id;
  const chat=(await runtime.harness.conversation(id,ctx))!;
  const ownerDefinition=defineTask({name:'session-list-owner',version:1,initial:()=>({phase:'wait'}),phases:{wait:async()=>({status:'completed' as const,result:null})},abort:async()=>{}});
  const ownerTask=await runtime.harness.commit(tx=>tx.createTask(ownerDefinition,null,{conversationId:id,ownership:{kind:'conversation',conversationId:id}}),ctx);
  const child=await runtime.harness.createConversation({ownership:{kind:'task',taskId:ownerTask}},ctx);
  const listed=(await request('/chats')).value.items.map((item:any)=>item.id);
  assert.ok(listed.includes(id),'ownerless regular session stays visible');assert.ok(!listed.includes(child.id),'owned child is excluded from regular Sessions');assert.ok(!listed.includes(runtime.library.id),'library stays excluded');
  assert.equal((await request(`/chats/${child.id}`)).status,200,'owned child transcript endpoint remains available');
  await runtime.harness.commit(async tx=>{const page=await tx.scanConversations({ownerConversationId:id},20);assert.ok(page.items.some(c=>c.id===child.id));},ctx);
  const snapshot=async()=>{const view=await chat.viewState(ctx);try{return{entries:view.value.entries,docs:{'bob.chat':{...(await runtime.harness.snapshot(ChatMeta,id,ctx))!,...await runtime.harness.snapshot(SessionUI,id,ctx)}}};}finally{view.dispose();}};
  await chat.commit(tx=>tx.appendEntry(id,{kind:'bob.session-fixture',data:{text:'This original message must survive Trash and reopen.'}}),ctx);
  const before=await snapshot();
  assert.equal(before.docs['bob.chat'].pinned,undefined,'legacy documents need no destructive migration');
  const entries=before.entries.map(entry=>entry.id);
  let result=await request(`/chats/${id}/metadata`,'PUT',{title:'  Renamed  ',pinned:true});assert.equal(result.status,200);assert.equal(result.value.meta.title,'Renamed');assert.equal(result.value.meta.pinned,true);
  await request(`/chats/${id}/metadata`,'PUT',{archived:true});
  const archived=(await request('/chats')).value.items.find((item:any)=>item.id===id);assert.equal(archived.meta.archived,true);
  for(let i=0;i<2;i++){result=await request(`/chats/${id}`,'DELETE');assert.equal(result.status,200);assert.equal(result.value.recoverable,true);}
  let stored=await snapshot();assert.equal(stored.docs['bob.chat'].trashed,true);assert.equal(stored.docs['bob.chat'].pinned,false);assert.equal(stored.docs['bob.chat'].archived,false);assert.deepEqual(stored.entries.map(entry=>entry.id),entries);
  assert.equal((await request(`/chats/${id}`)).status,200,'trash is recoverable, not a storage deletion');
  await request(`/chats/${id}/metadata`,'PUT',{trashed:false,archived:false});
  stored=await snapshot();assert.equal(stored.docs['bob.chat'].title,'Renamed');assert.equal(stored.docs['bob.chat'].trashed,false);
  assert.equal((await request(`/chats/${id}/metadata`,'PUT',{title:''})).status,400);
  assert.equal((await request(`/chats/${id}/metadata`,'PUT',{title:'x'.repeat(161)})).status,400);
  assert.equal((await request(`/chats/${id}/metadata`,'PUT',{allowSubagents:false})).status,400,'controls cannot rewrite unrelated session authority');
  assert.equal((await request(`/chats/${runtime.library.id}`,'DELETE')).status,403);
  const meta=await runtime.harness.snapshot(ChatMeta,id,ctx);assert.equal(meta?.title,'Renamed');
  await app.close();const reopened=await openRuntime(state);const reopenedApp=await serve(state,{port:0,runtime:reopened});
  try{const reopenedBase=`http://127.0.0.1:${(reopenedApp.server.address() as any).port}/v1/chats`;const reopenedList=await(await fetch(reopenedBase,{headers})).json() as any;assert.ok(reopenedList.items.some((item:any)=>item.id===id));assert.ok(!reopenedList.items.some((item:any)=>item.id===child.id));assert.equal((await reopened.harness.snapshot(SessionUI,id,ctx))?.trashed,false);assert.equal((await reopened.harness.snapshot(ChatMeta,id,ctx))?.title,'Renamed');const restored=(await reopened.harness.conversation(id,ctx))!;const history=await restored.entries({},100,undefined,ctx);assert.ok(history.items.some(entry=>entry.kind==='bob.session-fixture'));}finally{await reopenedApp.close();await reopened.close();}
 }finally{if(server.listening)await app.close();state.close();await rm(dir,{recursive:true,force:true});}
});
