import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {mobileTranscriptEntries} from '../src/mobile-transcript.js';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {serve} from '../src/server.js';

const image='A'.repeat(3_170_000);
const tool=(id=100)=>({id,kind:'pi.tool-result',data:{callId:'exact-call'},model:[{role:'toolResult',toolName:'read',toolCallId:'exact-call',isError:false,timestamp:1,content:[{type:'image',data:image,mimeType:'image/png'},{type:'text',text:'Complete text survives '+ 'x'.repeat(10000)}]}]} as any);

test('phone presentation omits encoded tool images only, without mutating originals or call linkage',()=>{
 const original=tool(),raw=JSON.stringify(original),ordinary={id:101,kind:'fixture',data:{text:'unchanged'}} as any;
 const [slim,same]=mobileTranscriptEntries([original,ordinary]);
 assert.equal(same,ordinary);assert.notEqual(slim,original);
 assert.equal(slim.model[0].toolCallId,'exact-call');assert.equal(slim.model[0].isError,false);
 assert.equal(slim.model[0].content[1],original.model[0].content[1],'text is complete and retains identity');
 assert.equal(slim.model[0].content[0].type,'text');
 assert.match(slim.model[0].content[0].text,/3170000 encoded characters.*omitted.*retained in stored history/);
 assert.deepEqual(slim.mobilePresentation,{version:1,omittedToolImages:true,originalEntryId:100});
 assert.equal(JSON.stringify(original),raw,'presentation must not mutate official storage/model payloads');
 assert.equal(mobileTranscriptEntries([original])[0],slim,'repeat presentations retain projected object identity');
 assert.equal(JSON.stringify(slim).length<12000,true);
 const different=tool();different.model[0].content[1]={type:'text',text:'new object, same ID'};
 assert.notEqual(mobileTranscriptEntries([different])[0],slim,'cache is by immutable object, not IDs across revisions');
});

test('ordinary text, tool errors, user images and result metadata are untouched',()=>{
 const entries=[{id:1,kind:'fixture',model:[{role:'toolResult',toolCallId:'failed',isError:true,details:{audit:{calls:[{name:'read'}]}},content:[{type:'text',text:'Full failure output '+image}]}]},
 {id:2,kind:'fixture',model:[{role:'user',content:[{type:'image',data:image,mimeType:'image/png'}]}]}] as any;
 const result=mobileTranscriptEntries(entries);assert.equal(result[0],entries[0]);assert.equal(result[1],entries[1]);
 const mixed=tool();mixed.model[0].details={audit:{calls:[{name:'read'}]}};mixed.model[0].isError=true;
 const [projected]=mobileTranscriptEntries([mixed]);assert.equal(projected.model[0].details,mixed.model[0].details);assert.equal(projected.model[0].isError,true);
});

test('GET, SSE, history and reconnect are slim; explicit authenticated original retrieval is exact and scoped',{timeout:20000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'bob-mobile-images-')),state=new State(dir),runtime=await openRuntime(state),app=await serve(state,{port:0,runtime});
 let controller:AbortController|undefined;
 try{
  const device=state.pair(state.invite().token,'image transcript fixture');
  const base=`http://127.0.0.1:${(app.server.address() as any).port}/v1/chats`,headers={authorization:`Bearer ${device.credential}`,'x-bob-backend':state.id};
  const chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx),other=await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
  const fixture=tool();delete fixture.id;
  const original=await chat.commit(tx=>tx.appendEntry(chat.id,fixture),ctx);
  const originalJSON=JSON.stringify(original);
  async function get(path:string){const response=await fetch(`${base}/${chat.id}${path}`,{headers});assert.equal(response.status,200);const raw=await response.text();return {raw,value:JSON.parse(raw)};}
  function check(entry:any){assert.equal(entry.id,original.id);assert.equal(entry.model[0].toolCallId,'exact-call');assert.equal(entry.model[0].content[1].text,fixture.model[0].content[1].text);assert.equal(entry.mobilePresentation.omittedToolImages,true);}
  const initial=await get('');check(initial.value.view.entries.find((e:any)=>e.id===original.id));assert.ok(initial.raw.length<30000);
  const history=await get('/history');check(history.value.items.find((e:any)=>e.id===original.id));assert.ok(history.raw.length<30000);
  for(let reconnect=0;reconnect<2;reconnect++){
   controller=new AbortController();
   const response=await fetch(`${base}/${chat.id}/events`,{headers,signal:controller.signal});assert.equal(response.status,200);
   const reader=response.body!.getReader(),decoder=new TextDecoder();let text='';
   while(!text.includes('\n\n')){const chunk=await reader.read();assert.equal(chunk.done,false);text+=decoder.decode(chunk.value,{stream:true});}
   const first=text.slice(0,text.indexOf('\n\n'));assert.ok(first.startsWith('event: snapshot\ndata: '));
   const snapshot=JSON.parse(first.slice(first.indexOf('data: ')+6));check(snapshot.view.entries.find((e:any)=>e.id===original.id));assert.ok(first.length<30000);
   controller.abort();controller=undefined;
  }
  const exact=await get(`/history?entryId=${original.id}`);assert.equal(exact.value.coverage,'stored-entry');assert.deepEqual(exact.value.entry,original);
  assert.equal((await fetch(`${base}/${chat.id}/history?entryId=${original.id}`)).status,401);
  assert.equal((await fetch(`${base}/${other.id}/history?entryId=${original.id}`,{headers})).status,404);
  assert.equal((await fetch(`${base}/${runtime.library.id}/history?entryId=${original.id}`,{headers})).status,403);
  assert.equal((await fetch(`${base}/${chat.id}/history?entryId=invalid`,{headers})).status,400);
  assert.equal(JSON.stringify((await chat.entries({},10,undefined,ctx)).items.find(e=>e.id===original.id)),originalJSON,'GET/SSE/history cannot rewrite stored images');
 }finally{controller?.abort();await app.close();state.close();await rm(dir,{recursive:true,force:true});}
});
