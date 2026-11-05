import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import type {ServerResponse} from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {connectionActivity,connectionStream} from '../src/connection-stream.js';
import {State} from '../src/state.js';
import {ctx,openRuntime} from '../src/runtime.js';
import {serve} from '../src/server.js';
import {Questions} from '../src/documents.js';
import {PhoneLocationSource,bindLocationDevice} from '../src/phone-location.js';
import {PhoneAvailability,phoneToolsAvailability} from '../src/phone-tools.js';
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
class Response extends EventEmitter{
 destroyed=false;headers:unknown;frames:string[]=[];blocked=false;ended=false;
 writeHead(_status:number,headers:unknown){this.headers=headers;}
 write(frame:string){this.frames.push(frame);return !this.blocked;}
 end(){if(this.ended)return;this.ended=true;this.emit('close');}
}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>resolve=yes);return {promise,resolve};}

test('connection activity uses authoritative booleans and waiting takes precedence',()=>{
 assert.equal(connectionActivity(false,false),'idle');assert.equal(connectionActivity(true,false),'working');assert.equal(connectionActivity(true,true),'waiting');assert.equal(connectionActivity(false,true),'waiting');
});
test('compact stream heartbeats, serializes reads and retires a delayed result after close',async()=>{
 const response=new Response(),streams=new Set<ServerResponse>(),blocked=deferred<'working'>();let calls=0;
 const ready=connectionStream(response as unknown as ServerResponse,{backendId:'paired',conversationId:7,streams,authorized:()=>true,read:async()=>{calls++;return blocked.promise;},pollMs:5,heartbeatMs:10});
 await delay(35);assert.equal(calls,1);response.end();blocked.resolve('working');await ready;await delay(15);assert.deepEqual(response.frames,[]);assert.equal(streams.size,0);assert.equal(calls,1);
});
test('revocation after an in-flight read emits no late status and closes the connection',async()=>{
 const response=new Response(),blocked=deferred<'idle'>();let authorized=true;
 const ready=connectionStream(response as unknown as ServerResponse,{backendId:'paired',conversationId:7,streams:new Set(),authorized:()=>authorized,read:()=>blocked.promise,pollMs:5});
 authorized=false;blocked.resolve('idle');await ready;assert.equal(response.ended,true);assert.deepEqual(response.frames,[]);
});
test('slow readers and read failures close without accumulating retries or writes',async()=>{
 for(const mode of ['backpressure','failure']){
  const response=new Response(),streams=new Set<ServerResponse>();response.blocked=mode==='backpressure';
  await connectionStream(response as unknown as ServerResponse,{backendId:'paired',conversationId:7,streams,authorized:()=>true,read:async()=>{if(mode==='failure')throw Error('private details');return 'idle';},pollMs:5});
  assert.equal(response.ended,true);assert.equal(streams.size,0);await delay(15);assert.equal(response.frames.length,mode==='backpressure'?1:0);assert.ok(!response.frames.join('').includes('private'));
 }
});
test('real authenticated background endpoint is bounded, scoped, revocable and cannot enable phone tools',{timeout:15000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bob-connection-')),state=new State(dir),runtime=await openRuntime(state),source=state.pair(state.invite().token,'Source'),reader=state.pair(state.invite().token,'Read-only background'),chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx),server=await serve(state,{port:0,runtime});
 const controller=new AbortController();let streamReader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 try{
  await bindLocationDevice(chat,source.deviceId);await phoneToolsAvailability(runtime.library,source.deviceId,{enabled:false},ctx);
  const before=await runtime.harness.snapshot(PhoneAvailability,runtime.library.id,ctx),binding=await runtime.harness.snapshot(PhoneLocationSource,chat.id,ctx);
  const port=(server.server.address() as {port:number}).port,base=`http://127.0.0.1:${port}/v1/chats/${chat.id}/connection`,headers={Authorization:`Bearer ${reader.credential}`,'x-bob-backend':state.id};
  assert.equal((await fetch(base,{headers:{...headers,'x-bob-backend':'wrong-backend'}})).status,409);
  assert.equal((await fetch(base,{headers:{...headers,Authorization:'Bearer rejected'}})).status,401);
  assert.equal((await fetch(base.replace(`/${chat.id}/`,'/999999/'),{headers})).status,404);
  assert.equal((await fetch(base.replace(`/${chat.id}/`,`/${runtime.library.id}/`),{headers})).status,403);
  const response=await fetch(base,{headers,signal:controller.signal});assert.equal(response.status,200);assert.match(response.headers.get('content-type')!,/text\/event-stream/);
  streamReader=response.body!.getReader();let pending='';
  const next=async()=>{while(!pending.includes('\n\n')){const part=await streamReader!.read();assert.equal(part.done,false);pending+=new TextDecoder().decode(part.value);}const end=pending.indexOf('\n\n'),frame=pending.slice(0,end);pending=pending.slice(end+2);assert.ok(Buffer.byteLength(frame)<1024);assert.match(frame,/^event: connection\ndata: /);return JSON.parse(frame.slice(frame.indexOf('data: ')+6));};
  const first=await next();assert.deepEqual(Object.keys(first).sort(),['backendId','conversationId','observedAt','state']);assert.equal(first.backendId,state.id);assert.equal(first.conversationId,chat.id);assert.equal(first.state,'idle');assert.ok(first.observedAt<=Date.now());
  await chat.commit(async tx=>{(await tx.doc(Questions,chat.id)).pending={id:'private-question',text:'NEVER_EXPOSE_THIS_PRIVATE_QUESTION'};},ctx);
  const waiting=await next();assert.equal(waiting.state,'waiting');assert.ok(!JSON.stringify(waiting).includes('PRIVATE_QUESTION'));
  assert.deepEqual(await runtime.harness.snapshot(PhoneAvailability,runtime.library.id,ctx),before);
  assert.deepEqual(await runtime.harness.snapshot(PhoneLocationSource,chat.id,ctx),binding);
  state.revoke(reader.deviceId);
  const ended=await streamReader.read();assert.equal(ended.done,true);
  assert.equal((await fetch(base,{headers})).status,401);
 }finally{controller.abort();await streamReader?.cancel().catch(()=>{});await server.close();state.close();rmSync(dir,{recursive:true,force:true});}
});

test('revocation closes even when the initial document read remains indefinitely pending',async()=>{
 const response=new Response(),streams=new Set<ServerResponse>(),blocked=deferred<'idle'>();let authorized=true,checks=0;
 const ready=connectionStream(response as unknown as ServerResponse,{backendId:'paired',conversationId:7,streams,authorized:()=>{checks++;return authorized;},read:()=>blocked.promise,pollMs:5});
 authorized=false;for(let n=0;n<100&&!response.ended;n++)await delay(5);assert.equal(response.ended,true);assert.equal(streams.size,0);assert.ok(checks>=2);assert.deepEqual(response.frames,[]);blocked.resolve('idle');await ready;assert.deepEqual(response.frames,[]);
});
test('unchanged state emits a small heartbeat, activity changes emit without waiting for the heartbeat',async()=>{
 const response=new Response(),streams=new Set<ServerResponse>();let activity:'idle'|'working'='idle';
 await connectionStream(response as unknown as ServerResponse,{backendId:'paired',conversationId:7,streams,authorized:()=>true,read:async()=>activity,pollMs:5,heartbeatMs:30});
 try{
  assert.equal(response.frames.length,1);
  for(let n=0;n<100&&response.frames.length<2;n++)await delay(5);
  assert.ok(response.frames.length>=2);const data=(frame:string)=>JSON.parse(frame.slice(frame.indexOf('data: ')+6));
  const [first,heartbeat]=response.frames.slice(0,2).map(data);assert.equal(first.state,'idle');assert.equal(heartbeat.state,'idle');assert.ok(heartbeat.observedAt-first.observedAt>=30);
  const before=response.frames.length;activity='working';for(let n=0;n<100&&response.frames.length===before;n++)await delay(5);assert.equal(data(response.frames[before]).state,'working');assert.ok(response.frames.every(frame=>Buffer.byteLength(frame)<1024));
 }finally{response.end();}assert.equal(streams.size,0);
});
