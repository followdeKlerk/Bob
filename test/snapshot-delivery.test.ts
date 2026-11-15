import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as turn} from 'node:timers/promises';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createModels} from '@earendil-works/pi-ai/models';
import {LiveDoc} from '@earendil-works/pi-durable';
import {createSnapshotDelivery,snapshotDeliveryInterval} from '../src/snapshot-delivery.js';
import {State} from '../src/state.js';
import {ctx,openRuntime} from '../src/runtime.js';
import {serve} from '../src/server.js';
import {ChatMeta} from '../src/documents.js';
import {applySnapshotPatch} from '../apps/mobile/snapshot-patch.ts';

function fixture(heartbeats=true,overrides:Partial<Parameters<typeof createSnapshotDelivery<string>>[0]>={}) {
 const frames:string[]=[],reads:string[]=[];let ends=0;
 const delivery=createSnapshotDelivery<string>({heartbeats,authorized:()=>true,
  read:async value=>{reads.push(value);return value;},write:async frame=>{frames.push(frame);},
  heartbeat:()=>JSON.stringify({observedAt:Date.now()}),end:()=>{ends++;},...overrides});
 return {...delivery,frames,reads,get ends(){return ends;}};
}
const json=(value:unknown)=>JSON.stringify(value);
const data=(frame:string)=>JSON.parse(frame.slice(frame.indexOf('data: ')+6));

// Cross-component receiver uses the shipped mobile decoder, not a test-only
// splice implementation. Full frames reset sequence without changing the envelope.
function reconstruct(previous:{json:string;sequence:number}|undefined,frame:string){
 if(frame.startsWith('event: snapshot\n'))return {json:frame.slice(frame.indexOf('data: ')+6).trimEnd(),sequence:0};
 assert.match(frame,/^event: snapshot-patch\n/);assert.ok(previous);
 const patch=data(frame);
 assert.deepEqual(Object.keys(patch).sort(),['base','insert','length','prefix','remove','sequence']);
 assert.equal(patch.base,previous.sequence);assert.equal(patch.sequence,previous.sequence+1);
 assert.equal(patch.length,previous.json.length,'length describes the previous JSON in UTF-16 code units');
 assert.ok(patch.prefix>=0&&patch.remove>=0&&patch.prefix+patch.remove<=previous.json.length);
 return applySnapshotPatch(previous.json,previous.sequence,frame.slice(frame.indexOf('data: ')+6));
}

test('negotiated patches reconstruct large active snapshots with >99% incremental byte savings',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:0});
 const f=fixture(true,{patches:true});t.after(f.stop);
 const transcript='Synthetic retained transcript. '.repeat(35000);
 const snapshot=(progress:string)=>json({backendId:'fixture',conversationId:1,view:{entries:[transcript],docs:{live:progress}}});
 let expected=snapshot(''),received:ReturnType<typeof reconstruct>|undefined;
 f.offer(expected);await turn();received=reconstruct(received,f.frames[0]);assert.equal(received.json,expected);
 let actualBytes=0,fullBytes=0;
 for(let i=1;i<=100;i++){
  expected=snapshot('Streamed token '.repeat(i));
  t.mock.timers.tick(i===1?2000:350);f.offer(expected);await turn();
  const frame=f.frames.at(-1)!;assert.match(frame,/^event: snapshot-patch\n/);
  received=reconstruct(received,frame);assert.equal(received.json,expected);assert.equal(received.sequence,i);
  actualBytes+=Buffer.byteLength(frame);fullBytes+=Buffer.byteLength(`event: snapshot\ndata: ${expected}\n\n`);
 }
 t.diagnostic(`100 live updates: ${actualBytes} patch bytes versus ${fullBytes} full-snapshot bytes (initial snapshot excluded)`);
 assert.equal(f.frames.length,101);assert.ok(actualBytes<fullBytes/100,`${actualBytes} patch bytes vs ${fullBytes} full snapshot bytes`);
 assert.ok(actualBytes<32768,'100 active updates transfer less than 32KiB after initial snapshot');
});
test('patch Unicode splice boundaries, escaped text and full fallback reset reconstruct exactly',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:0});
 const f=fixture(true,{patches:true});t.after(f.stop);
 const make=(text:string)=>json({text,padding:'Retained suffix. '.repeat(3000)});
 const values=[make('🙂 quoted " line\n漢字'),make('😀 quoted " line\n漢字'),make('😀 quoted " line\n漢字 + é'),
  json({reset:'B'.repeat(50000)}),json({reset:'B'.repeat(50000)+'終🙂'})];
 let received:ReturnType<typeof reconstruct>|undefined;
 for(const expected of values){
  t.mock.timers.tick(2000);f.offer(expected);await turn();received=reconstruct(received,f.frames.at(-1)!);assert.equal(received.json,expected);assert.deepEqual(JSON.parse(received.json),JSON.parse(expected));
 }
 assert.match(f.frames[1],/^event: snapshot-patch\n/);
 const surrogatePatch=data(f.frames[1]);assert.equal(surrogatePatch.remove,1);assert.equal(surrogatePatch.insert.length,1,'shared high surrogate can remain in prefix');
 assert.equal(data(f.frames[2]).base,1);
 assert.match(f.frames[3],/^event: snapshot\n/,'replacement larger as a JSON-escaped patch falls back to full');
 assert.equal(data(f.frames[4]).base,0);assert.equal(data(f.frames[4]).sequence,1);
 assert.ok(Buffer.byteLength(f.frames[1])<Buffer.byteLength(`event: snapshot\ndata: ${values[1]}\n\n`));
});
test('patch selection compares UTF-8 frame bytes rather than UTF-16 string lengths',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:0});
 const f=fixture(true,{patches:true});t.after(f.stop);
 const make=(live:string)=>json({shared:'漢'.repeat(50),live});
 f.offer(make('a'));await turn();t.mock.timers.tick(350);f.offer(make('b'));await turn();
 const patch=f.frames[1],full=`event: snapshot\ndata: ${make('b')}\n\n`;
 assert.match(patch,/^event: snapshot-patch\n/);
 assert.ok(patch.length>full.length,'a code-unit comparison would incorrectly choose full');
 assert.ok(Buffer.byteLength(patch)<Buffer.byteLength(full));
 assert.equal(reconstruct(reconstruct(undefined,f.frames[0]),patch).json,make('b'));
});
test('patch-enabled legacy keepalive sends a full reset, not a no-op patch',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:0});
 const f=fixture(false,{patches:true});t.after(f.stop);
 const make=(live:number)=>json({shared:'stable'.repeat(1000),live});
 f.offer(make(0));await turn();t.mock.timers.tick(2000);f.offer(make(1));await turn();
 assert.equal(data(f.frames[1]).sequence,1);
 t.mock.timers.tick(9000);f.offer(make(1),true);await turn();assert.match(f.frames[2],/^event: snapshot\n/);
 t.mock.timers.tick(2000);f.offer(make(2));await turn();assert.equal(data(f.frames[3]).base,0);
});
test('negotiated patches retain only latest pending value and chain bases after slow drain',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:0});
 const drained=Promise.withResolvers<void>(),frames:string[]=[];
 const f=fixture(true,{patches:true,write:async frame=>{frames.push(frame);if(frames.length===2)await drained.promise;}});t.after(f.stop);
 const snapshot=(progress:number)=>json({entries:['large stable history '.repeat(5000)],progress});
 f.offer(snapshot(0));await turn();t.mock.timers.tick(2000);f.offer(snapshot(1));await turn();
 for(let i=2;i<=100;i++)f.offer(snapshot(i));
 t.mock.timers.tick(10000);await turn();assert.equal(f.reads.length,2);assert.equal(frames.length,2);
 drained.resolve();await turn();assert.equal(f.reads.length,3);assert.equal(frames.length,3);
 let received:ReturnType<typeof reconstruct>|undefined;
 for(const frame of frames)received=reconstruct(received,frame);
 assert.equal(received!.json,snapshot(100));assert.equal(received!.sequence,2);assert.equal(data(frames[2]).base,1);
});
test('heartbeat-only clients never receive unnegotiated patch frames',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:0});
 const f=fixture();t.after(f.stop);f.offer(json({large:'stable'.repeat(10000),live:0}));await turn();
 t.mock.timers.tick(2000);f.offer(json({large:'stable'.repeat(10000),live:1}));await turn();
 assert.equal(f.frames.length,2);assert.ok(f.frames.every(frame=>frame.startsWith('event: snapshot\n')));
});

test('size-adaptive cadence has a 350ms floor, ~32KiB/s target and 2s latency cap',()=>{
 assert.equal(snapshotDeliveryInterval(1),350);
 assert.equal(snapshotDeliveryInterval(32768),1000);
 assert.equal(snapshotDeliveryInterval(65536),2000);
 assert.equal(snapshotDeliveryInterval(4*1024*1024),2000,'large full snapshots exceed the soft bandwidth target');
});
test('idle negotiated streams deduplicate exact JSON and send only tiny periodic heartbeats',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:0});
 const f=fixture(),view=json({view:{entries:['large transcript '.repeat(10000)],docs:{}}});t.after(f.stop);
 f.offer(view);await turn();
 for(let i=0;i<10;i++){
  t.mock.timers.tick(3000);f.offer(view,true);await turn();
  assert.match(f.frames.at(-1)!,/^event: heartbeat\ndata: /);
  assert.ok(Buffer.byteLength(f.frames.at(-1)!)<128);
 }
 assert.equal(f.frames.filter(frame=>frame.startsWith('event: snapshot')).length,1);
 assert.equal(f.frames.length,11);
 t.mock.timers.tick(3000);f.offer(view);await turn();assert.equal(f.frames.length,11,'identical watch callbacks are not heartbeats');
});
test('legacy streams preserve snapshot keepalive at 9s without 3s duplicates',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:0});
 const f=fixture(false);t.after(f.stop);f.offer('{}');await turn();
 for(let i=1;i<=6;i++){
  t.mock.timers.tick(3000);f.offer('{}',true);await turn();
  assert.equal(f.frames.length,1+Math.floor(i/3));
 }
 assert.ok(f.frames.every(frame=>frame.startsWith('event: snapshot')));
});
test('bursts replace one pending read and deliver changed docs and the latest final state',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:0});
 const f=fixture();t.after(f.stop);f.offer(json({entries:[],docs:{}}));await turn();
 for(let i=0;i<1000;i++)f.offer(json({entries:[],docs:{generation:i}}));
 await turn();assert.equal(f.reads.length,1);
 t.mock.timers.tick(349);await turn();assert.equal(f.frames.length,1);
 t.mock.timers.tick(1);await turn();assert.equal(f.reads.length,2);assert.equal(data(f.frames[1]).docs.generation,999);
 for(let i=0;i<1000;i++)f.offer(json({entries:[],docs:{generation:i}}));
 const final={entries:[{id:1,text:'Final answer'}],docs:{generation:null,questions:{pending:'Changed document'}}};
 f.offer(json(final));t.mock.timers.tick(350);await turn();
 assert.equal(f.reads.length,3);assert.deepEqual(data(f.frames[2]),final);
});
test('large snapshots coalesce at the 2s cap and UTF-8 bytes set the cadence',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:0});
 const f=fixture();t.after(f.stop);const large=json({text:'🙂'.repeat(20000)});
 f.offer(large);await turn();f.offer(json({final:true}));
 t.mock.timers.tick(1999);await turn();assert.equal(f.frames.length,1);
 t.mock.timers.tick(1);await turn();assert.deepEqual(data(f.frames[1]),{final:true});
});
test('slow transport never queues frames or projects pending values before drain',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:0});
 const drained=Promise.withResolvers<void>(),frames:string[]=[];
 const f=fixture(true,{write:async frame=>{frames.push(frame);await drained.promise;}});t.after(f.stop);
 f.offer('0');await turn();
 for(let i=1;i<=10000;i++)f.offer(String(i));
 t.mock.timers.tick(10000);await turn();assert.equal(f.reads.length,1);assert.equal(frames.length,1);
 drained.resolve();await turn();assert.deepEqual(f.reads,['0','10000']);assert.equal(frames.length,2);
});
test('close cancels trailing work and fences an in-flight read; failures close once',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:0});
 const held=Promise.withResolvers<string>();let reads=0;
 const f=fixture(true,{read:()=>{reads++;return held.promise;}});
 f.offer('old');f.offer('latest');f.stop();held.resolve('old');await turn();
 t.mock.timers.tick(10000);await turn();assert.equal(reads,1);assert.deepEqual(f.frames,[]);
 const broken=fixture(true,{read:async()=>{throw Error('synthetic read failure');}});
 broken.offer('0');await turn();broken.offer('1');await turn();assert.equal(broken.ends,1);assert.deepEqual(broken.frames,[]);
});
test('revocation before a delayed read or after an in-flight read emits no private data',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:0});
 let authorized=true;const f=fixture(true,{authorized:()=>authorized});t.after(f.stop);
 f.offer('0');await turn();f.offer('1');authorized=false;t.mock.timers.tick(350);await turn();
 assert.equal(f.ends,1);assert.deepEqual(f.reads,['0']);assert.equal(f.frames.length,1);
 const held=Promise.withResolvers<string>();authorized=true;
 const inflight=fixture(true,{authorized:()=>authorized,read:()=>held.promise});
 inflight.offer('private');authorized=false;held.resolve('"private"');await turn();
 assert.equal(inflight.ends,1);assert.deepEqual(inflight.frames,[]);
});

for(const patches of [false,true])test(`authenticated HTTP ${patches?'patch':'heartbeat-only'} stream deduplicates, refreshes docs/final state and reconnects`,{timeout:20000},async t=>{
 const dir=await mkdtemp(join(tmpdir(),'bob-snapshot-delivery-')),state=new State(dir);
 const runtime=await openRuntime(state,createModels(),undefined,{resume:false});
 const callbacks:(()=>void)[]=[],interval=globalThis.setInterval;
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 t.mock.method(globalThis,'setInterval',((callback:()=>void,ms:number,...args:unknown[])=>{
  if(ms===3000){callbacks.push(callback);return interval(callback,3600000,...args);}
  return interval(callback,ms,...args);
 }) as typeof setInterval);
 const app=await serve(state,{port:0,runtime}),device=state.pair(state.invite().token,'Snapshot fixture');
 const controllers:AbortController[]=[];
 const headers={authorization:`Bearer ${device.credential}`,'x-bob-backend':state.id};
 const chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
 await chat.commit(tx=>tx.appendEntry(chat.id,{kind:'bob.user',data:{text:'Stable HTTP transcript. '.repeat(10000)}}),ctx);
 const url=`http://127.0.0.1:${(app.server.address() as {port:number}).port}/v1/chats/${chat.id}/events?heartbeats=1${patches?'&patches=1':''}`;
 async function connect(){
  const controller=new AbortController();controllers.push(controller);
  const response=await fetch(url,{headers:{...headers,'last-event-id':'not-a-mutation'},signal:controller.signal});
  assert.equal(response.status,200);const reader=response.body!.getReader(),decoder=new TextDecoder();let buffer='',received:ReturnType<typeof reconstruct>|undefined;
  return {reader,snapshot(frame:string){received=reconstruct(received,frame);return JSON.parse(received.json);},async next(){
   const timeout=setTimeout(()=>controller.abort(),5000);
   try{
    while(!buffer.includes('\n\n')){const chunk=await reader.read();assert.equal(chunk.done,false);buffer+=decoder.decode(chunk.value,{stream:true});}
    const boundary=buffer.indexOf('\n\n'),frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);return frame;
   }finally{clearTimeout(timeout);}
  }};
 }
 try{
  assert.equal((await fetch(url)).status,401);
  assert.equal((await fetch(url,{headers:{...headers,'x-bob-backend':'wrong'}})).status,409);
  const stream=await connect(),first=await stream.next();assert.match(first,/^event: snapshot\n/);stream.snapshot(first);
  for(let i=0;i<3;i++){
   now+=3000;callbacks[0]();const heartbeat=await stream.next();assert.match(heartbeat,/^event: heartbeat/);
   assert.ok(Buffer.byteLength(heartbeat)<256);assert.equal(data(heartbeat).conversationId,chat.id);
  }
  now+=3000;
  await chat.commit(async tx=>{(await tx.doc(ChatMeta,chat.id)).title='Document-only update';},ctx);
  callbacks[0]();const changed=await stream.next();assert.match(changed,patches?/^event: snapshot-patch\n/:/^event: snapshot\n/);assert.equal(stream.snapshot(changed).view.docs['bob.chat'].title,'Document-only update');
  if(patches)assert.ok(Buffer.byteLength(changed)<Buffer.byteLength(first)/100,'HTTP doc change does not retransmit stable transcript');
  now+=3000;
  await chat.commit(async tx=>{(await tx.doc(LiveDoc,chat.id)).generation={attempt:1};},ctx);
  const active=stream.snapshot(await stream.next());assert.equal(active.view.docs['pi.live'].generation.attempt,1);
  now+=3000;
  const entry=await chat.commit(async tx=>{
   delete (await tx.doc(LiveDoc,chat.id)).generation;
   return tx.appendEntry(chat.id,{kind:'bob.user',data:{text:'Final persisted fixture'}});
  },ctx);
  const final=stream.snapshot(await stream.next());assert.equal(final.view.entries.at(-1).id,entry.id);assert.equal(final.view.docs['pi.live'].generation,undefined);
  controllers[0].abort();const reopened=await connect(),reconnectFrame=await reopened.next();assert.match(reconnectFrame,/^event: snapshot\n/);const snapshot=reopened.snapshot(reconnectFrame);
  assert.equal(snapshot.view.entries.at(-1).id,entry.id,'reconnect always begins with authoritative snapshot');
  state.revoke(device.deviceId);callbacks[1]();assert.equal((await reopened.reader.read()).done,true);
 }finally{for(const controller of controllers)controller.abort();await app.close();state.close();await rm(dir,{recursive:true,force:true});}
});
