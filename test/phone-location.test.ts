import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {withCancel} from '@earendil-works/chord/context';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {serve} from '../src/server.js';
import {bindLocationDevice,locationAvailability,pollLocations,pendingLocations,respondLocation,phoneLocation,PhoneLocations,LocationFix} from '../src/phone-location.js';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
const fix=()=>({latitude:0,longitude:0,accuracyMeters:1234,capturedAt:Date.now(),ageMs:0,permission:'approximate',mock:true});

test('real phone_location tool routes authenticated input to exactly its source phone and consumes an on-demand response',{timeout:20000},async()=>{
 const state=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-location-'))),models=createModels(),faux=fauxProvider({tokensPerSecond:100000});models.setProvider(faux.provider);
 faux.setResponses([fauxAssistantMessage([fauxToolCall('phone_location',{purpose:'Find nearby cafes for the owner'})],{stopReason:'toolUse'}),fauxAssistantMessage('Location received, with approximate accuracy.')]);
 const runtime=await openRuntime(state,models),app=await serve(state,{port:0,runtime}),device=state.pair(state.invite().token,'Source phone'),other=state.pair(state.invite().token,'Different phone');
 const base=`http://127.0.0.1:${(app.server.address() as any).port}/v1`,headers={authorization:'Bearer '+device.credential,'x-bob-backend':state.id,'content-type':'application/json'},otherHeaders={...headers,authorization:'Bearer '+other.credential};
 const post=(path:string,value:unknown,auth=headers)=>fetch(base+path,{method:'POST',headers:auth,body:JSON.stringify(value)});
 try{
  assert.equal((await fetch(base+'/location/poll',{headers:{'x-bob-backend':state.id}})).status,401);
  assert.equal((await fetch(base+'/location/poll',{headers:{...headers,'x-bob-backend':randomUUID()}})).status,409);
  assert.equal((await post('/location/availability',{enabled:true})).status,200);
  const {id}=await (await post('/chats',{title:'Location fixture',model:{provider:'faux',modelId:'faux-1'}})).json() as any;
  const chat=(await runtime.harness.conversation(id,ctx))!;assert.ok((await chat.agent(ctx)).tools.some(tool=>tool.name==='phone_location'));
  assert.equal((await post(`/chats/${id}/messages`,{requestId:randomUUID(),text:'Find cafes near me',mode:'steer'})).status,202);
  const polled=await (await fetch(base+'/location/poll',{headers})).json() as any;
  assert.equal(polled.requests.length,1);assert.match(polled.requests[0].purpose,/cafes/);const requestId=polled.requests[0].id;
  const wrong=await (await fetch(base+'/location/poll',{headers:otherHeaders})).json() as any;assert.deepEqual(wrong.requests,[]);
  assert.equal((await post('/location/response',{id:requestId,status:'ok',fix:fix()},otherHeaders)).status,410,'another paired phone cannot respond');
  assert.equal((await post('/location/response',{id:requestId,status:'ok',fix:{...fix(),ageMs:30001}})).status,400,'stale fixes are rejected');
  assert.equal((await post('/location/response',{id:requestId,status:'ok',fix:{...fix(),latitude:91}})).status,400);
  assert.equal((await post('/location/response',{id:requestId,status:'ok',fix:fix()})).status,200);
  await chat.waitForIdle(ctx);
  const history=JSON.stringify((await (await fetch(base+`/chats/${id}/history`,{headers})).json() as any).items);
  assert.ok(history.includes('Source phone'));assert.ok(history.includes('approximate'));assert.ok(history.includes('1234'));assert.ok(history.includes('Android phone location'));
  const book=await runtime.harness.snapshot(PhoneLocations,runtime.library.id,ctx);assert.equal(Object.keys(book?.requests??{}).length,0,'no accumulating fix journal');
 }finally{await app.close();state.close();}
});

test('disabled phone never receives a request; Stop and tool cancellation clear queued coordinates/work',{timeout:15000},async()=>{
 const state=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-location-stop-'))),runtime=await openRuntime(state),device=state.pair(state.invite().token,'Owner phone');
 const chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
 try{
  await bindLocationDevice(chat,device.deviceId);
  const unavailable=await phoneLocation(state,runtime.library,chat,'off',{purpose:'Local weather'},ctx) as any;assert.equal(unavailable.status,'unavailable');
  assert.deepEqual((await pendingLocations(runtime.library,device.deviceId)).requests,[]);
  await locationAvailability(runtime.library,device.deviceId,true);
  const cancelled=withCancel(ctx),waiting=phoneLocation(state,runtime.library,chat,'cancelled',{purpose:'Nearby places'},cancelled.context);waiting.catch(()=>{});
  let pending:any;for(let index=0;index<40;index++){pending=await pollLocations(runtime.library,device.deviceId);if(pending.requests.length)break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(pending.requests.length,1);cancelled.cancel();await assert.rejects(waiting);
  assert.deepEqual((await pendingLocations(runtime.library,device.deviceId)).requests,[]);
  await locationAvailability(runtime.library,device.deviceId,false);
  await assert.rejects(()=>respondLocation(runtime.library,device.deviceId,{id:pending.requests[0].id,status:'ok',fix:fix()}),/expired or unavailable/);
  assert.equal((await phoneLocation(state,runtime.library,chat,'stopped',{purpose:'Weather'},ctx) as any).status,'unavailable');
 }finally{await runtime.close();state.close();}
});

test('fix schema accepts zero coordinates but rejects non-finite data, stale samples and extra private fields',()=>{
 assert.equal(LocationFix.parse(fix()).latitude,0);
 for(const invalid of [{...fix(),longitude:181},{...fix(),accuracyMeters:Infinity},{...fix(),ageMs:-1},{...fix(),ageMs:30001},{...fix(),altitude:15},{...fix(),token:'secret'}])assert.equal(LocationFix.safeParse(invalid).success,false);
});
