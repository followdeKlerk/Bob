import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {withCancel} from '@earendil-works/chord/context';
import {defineExtension,wrapTool} from '@earendil-works/pi-durable';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {serve} from '../src/server.js';
import {bindLocationDevice} from '../src/phone-location.js';
import {PHONE_ACTIONS,PhoneInput,PhoneRequests,PhoneAvailability,phoneToolsAvailability,phoneToolsView,claimPhoneTool,phoneOperation} from '../src/phone-tools.js';
const event={action:'calendar_create',calendarId:'1',title:'Test fixture',start:'2026-11-05T10:00:00+02:00',end:'2026-11-05T11:00:00+02:00',timeZone:'Africa/Johannesburg'};
async function next(runtime:Awaited<ReturnType<typeof openRuntime>>,chat:any,device:string){for(let n=0;n<200;n++){const item=(await phoneToolsView(runtime.harness,chat,device,ctx)).requests.find(r=>r.status==='pending');if(item)return item;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('No phone request');}
async function fixture(){const dir=mkdtempSync(join(tmpdir(),'bob-phone-tools-')),state=new State(dir),runtime=await openRuntime(state),device=state.pair(state.invite().token,'Source phone'),other=state.pair(state.invite().token,'Other phone'),chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx);await bindLocationDevice(chat,device.deviceId);return {state,runtime,device,other,chat,dir,close:async()=>{await runtime.close();state.close();rmSync(dir,{recursive:true,force:true});}};}

test('action contracts validate dates, exact fields, bounded pages and deliberate Android handoffs',()=>{
 assert.equal(PHONE_ACTIONS.length,19);assert.equal(PhoneInput.safeParse(event).success,true);
 for(const value of [{...event,command:'arbitrary'},{...event,start:'tomorrow'},{...event,end:event.start},{...event,timeZone:'not/a/zone'},{...event,calendarId:'x'},{...event,allDay:true},{action:'contacts_search',limit:101},{action:'calendar_events',start:event.start,end:'2028-01-01T00:00:00Z'},{action:'app_launch',packageName:'file:///private'},{action:'timer_set',durationSeconds:-1},{action:'volume_set',percent:101},{action:'dial',number:'tel:+123?secret'},{action:'sms_compose',number:'123',text:'x'.repeat(5001)},{action:'open_settings',panel:'install_unknown_apps'},{action:'calendar_delete',eventId:'1'}])assert.equal(PhoneInput.safeParse(value).success,false,JSON.stringify(value));
 assert.equal(PhoneInput.safeParse({...event,start:'2026-11-05T00:00:00Z',end:'2026-11-06T00:00:00Z',timeZone:'UTC',allDay:true}).success,true);
});

test('paired source, fresh availability, atomic claim, result identity and isolated snapshots',{timeout:20000},async()=>{
 const f=await fixture(),{runtime:r,state,chat,device,other}=f;
 try{
  assert.equal((await phoneOperation(state,r.harness,r.library,chat,'100',event,ctx)).status,'unavailable');
  await phoneToolsAvailability(r.library,device.deviceId,{enabled:true},ctx);
  const waiting=phoneOperation(state,r.harness,r.library,chat,'101',event,ctx,{pollMs:5}),request=await next(r,chat,device.deviceId);
  assert.deepEqual((await phoneToolsView(r.harness,chat,other.deviceId,ctx)).requests,[]);
  const different=await r.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
  await assert.rejects(()=>claimPhoneTool(r.harness,r.library,different,device.deviceId,{id:request.id,action:'result',result:{status:'ok'}},ctx),/unavailable/);
  await assert.rejects(()=>claimPhoneTool(r.harness,r.library,chat,other.deviceId,{id:request.id,action:'claim'},ctx),/unavailable/);
  assert.equal((await claimPhoneTool(r.harness,r.library,chat,device.deviceId,{id:request.id,action:'result',result:{status:'ok'}},ctx)).accepted,false);
  const claims=await Promise.all([1,2,3].map(()=>claimPhoneTool(r.harness,r.library,chat,device.deviceId,{id:request.id,action:'claim'},ctx)));
  assert.equal(claims.filter(result=>result.execute).length,1);
  const result={status:'ok',data:{eventId:'456',verified:true}};
  assert.equal((await claimPhoneTool(r.harness,r.library,chat,device.deviceId,{id:request.id,action:'result',result},ctx)).accepted,true);
  const done=await waiting;assert.equal(done.status,'ok');assert.equal((done as any).data.eventId,'456');
  assert.equal((await claimPhoneTool(r.harness,r.library,chat,device.deviceId,{id:request.id,action:'result',result},ctx)).accepted,true);
  await assert.rejects(()=>claimPhoneTool(r.harness,r.library,chat,device.deviceId,{id:request.id,action:'result',result:{status:'ok',data:{eventId:'999'}}},ctx),/identity conflict/);
  assert.deepEqual((await phoneToolsView(r.harness,chat,device.deviceId,ctx)).requests,[]);
  assert.deepEqual(await phoneOperation(state,r.harness,r.library,chat,'101',event,ctx),done);
  await assert.rejects(()=>phoneOperation(state,r.harness,r.library,chat,'101',{...event,title:'Different'},ctx),/identity conflict/);
  await phoneToolsAvailability(r.library,device.deviceId,{enabled:false},ctx);
  const receipt=await phoneOperation(state,r.harness,r.library,chat,'102',{action:'operation_status',requestId:request.id},ctx);assert.equal((receipt as any).result.status,'ok');
 }finally{await f.close();}
});

test('Stop, expiry, late results and disabled/stale devices never authorize repeat mutations',{timeout:20000},async()=>{
 const f=await fixture(),{runtime:r,state,chat,device}=f;
 try{
  await phoneToolsAvailability(r.library,device.deviceId,{enabled:true},ctx);
  const stop=withCancel(ctx),waiting=phoneOperation(state,r.harness,r.library,chat,'201',event,stop.context,{pollMs:5});waiting.catch(()=>{});
  const request=await next(r,chat,device.deviceId);stop.cancel();await assert.rejects(waiting);
  assert.equal((await claimPhoneTool(r.harness,r.library,chat,device.deviceId,{id:request.id,action:'claim'},ctx)).execute,false);
  assert.equal((await phoneOperation(state,r.harness,r.library,chat,'201',event,ctx)).status,'unknown');
  const claimedStop=withCancel(ctx),claimed=phoneOperation(state,r.harness,r.library,chat,'202',event,claimedStop.context,{pollMs:5});claimed.catch(()=>{});
  const handed=await next(r,chat,device.deviceId);await claimPhoneTool(r.harness,r.library,chat,device.deviceId,{id:handed.id,action:'claim'},ctx);claimedStop.cancel();await assert.rejects(claimed);
  assert.equal((await phoneOperation(state,r.harness,r.library,chat,'202',event,ctx)).status,'unknown');
  await claimPhoneTool(r.harness,r.library,chat,device.deviceId,{id:handed.id,action:'result',result:{status:'ok',data:{eventId:'789'}}},ctx);
  assert.equal((await phoneOperation(state,r.harness,r.library,chat,'202',event,ctx)).status,'ok','late proof reconciles original receipt only');
  const timeout=phoneOperation(state,r.harness,r.library,chat,'203',event,ctx,{timeoutMs:40,pollMs:5}),expiring=await next(r,chat,device.deviceId);assert.equal((await timeout).status,'unavailable');
  assert.equal((await claimPhoneTool(r.harness,r.library,chat,device.deviceId,{id:expiring.id,action:'claim'},ctx)).execute,false);
  await r.library.commit(async tx=>{(await tx.doc(PhoneAvailability,r.library.id)).devices[device.deviceId].at=1;},ctx);
  assert.equal((await phoneOperation(state,r.harness,r.library,chat,'204',event,ctx)).status,'unavailable');
 }finally{await f.close();}
});

test('bounded receipts retire a durable task watermark and cannot recreate a pruned side effect',{timeout:20000},async()=>{
 const f=await fixture(),{runtime:r,state,chat,device}=f;
 try{
  await phoneToolsAvailability(r.library,device.deviceId,{enabled:true},ctx);
  let first:any;
  for(let n=301;n<=333;n++){
   const waiting=phoneOperation(state,r.harness,r.library,chat,String(n),event,ctx,{pollMs:1}),item=await next(r,chat,device.deviceId);first??=item;
   await claimPhoneTool(r.harness,r.library,chat,device.deviceId,{id:item.id,action:'claim'},ctx);
   await claimPhoneTool(r.harness,r.library,chat,device.deviceId,{id:item.id,action:'result',result:{status:'ok',data:{eventId:String(n)}}},ctx);await waiting;
   await chat.commit(async tx=>{(await tx.doc(PhoneRequests,chat.id)).requests[item.id].expiresAt=Date.now()-1;},ctx);
  }
  const book=(await r.harness.snapshot(PhoneRequests,chat.id,ctx))!;assert.equal(Object.keys(book.requests).length,32);assert.ok(book.retiredThrough>=301);assert.equal(book.requests[first.id],undefined);
  const retired=await phoneOperation(state,r.harness,r.library,chat,'301',event,ctx);assert.equal(retired.status,'unknown');assert.match((retired as any).message,/retired/);
  assert.equal((await phoneToolsView(r.harness,chat,device.deviceId,ctx)).requests.length,0);
 }finally{await f.close();}
});

function publicationGate(target:any,entered:()=>void,wait:boolean){return defineExtension({name:'phone-publication-test',wraps:[wrapTool(target,original=>({...original,execute:async(args,api,context)=>{const result=await original.execute(args,api,context);entered();if(wait)await new Promise<void>((_resolve,reject)=>{const stop=()=>reject(context.abortSignal?.reason??Error('abort'));if(context.abortSignal?.aborted)stop();else context.abortSignal?.addEventListener('abort',stop,{once:true});});return result;}}))]});}

test('real native ToolTask shutdown/reopen after committed phone effect but before result publication does not redispatch',{timeout:25000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bob-phone-recovery-')),state=new State(dir),models=createModels(),faux=fauxProvider({tokensPerSecond:100000});models.setProvider(faux.provider);
 let r=await openRuntime(state,models);const device=state.pair(state.invite().token,'Source'),entered=Promise.withResolvers<void>();
 try{
  const chat=await r.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx),gate=publicationGate(r.modules.resources.tools!.find(tool=>tool.name==='phone')!,()=>entered.resolve(),true);r.registry.install(gate);await chat.configure({extensions:[r.modules.resources,gate]},ctx);
  await bindLocationDevice(chat,device.deviceId);await phoneToolsAvailability(r.library,device.deviceId,{enabled:true},ctx);
  faux.setResponses([fauxAssistantMessage([fauxToolCall('phone',event)],{stopReason:'toolUse'}),fauxAssistantMessage('Calendar recorded.')]);
  const submission=await chat.submit({type:'input',content:'Create fixture event'},ctx);const item=await next(r,chat,device.deviceId);
  assert.equal((await claimPhoneTool(r.harness,r.library,chat,device.deviceId,{id:item.id,action:'claim'},ctx)).execute,true);
  await claimPhoneTool(r.harness,r.library,chat,device.deviceId,{id:item.id,action:'result',result:{status:'ok',data:{eventId:'once'}}},ctx);await entered.promise;
  await r.close();r=await openRuntime(state,models,undefined,{resume:false});r.registry.install(publicationGate(r.modules.resources.tools!.find(tool=>tool.name==='phone')!,()=>{},false));r.harness.resume();
  await (await r.harness.submission(submission.id,ctx))!.wait(ctx);await r.harness.waitForIdle(ctx);
  const reopened=(await r.harness.conversation(chat.id,ctx))!,book=(await r.harness.snapshot(PhoneRequests,chat.id,ctx))!;
  assert.equal(Object.keys(book.requests).length,1);assert.equal(book.requests[item.id].result?.data?.eventId,'once');assert.equal((await phoneToolsView(r.harness,reopened,device.deviceId,ctx)).requests.length,0);
  assert.equal((await claimPhoneTool(r.harness,r.library,reopened,device.deviceId,{id:item.id,action:'claim'},ctx)).execute,false);
  const history=JSON.stringify((await reopened.entries({},100,undefined,ctx)).items);assert.match(history,/once/);assert.match(history,/Calendar recorded/);
 }finally{await r.close();state.close();rmSync(dir,{recursive:true,force:true});}
});

test('HTTP phone dispatch is authenticated and scoped to backend, source device and conversation',{timeout:20000},async()=>{
 const f=await fixture(),{runtime:r,state,chat,device,other}=f,app=await serve(state,{port:0,runtime:r});
 const base=`http://127.0.0.1:${(app.server.address() as any).port}/v1`,headers={authorization:`Bearer ${device.credential}`,'x-bob-backend':state.id,'content-type':'application/json'};
 const post=(path:string,value:unknown,auth:any=headers)=>fetch(base+path,{method:'POST',headers:auth,body:JSON.stringify(value)});
 try{
  assert.equal((await post('/phone-tools/availability',{enabled:true},{})).status,401);
  assert.equal((await post('/phone-tools/availability',{enabled:true},{...headers,'x-bob-backend':randomUUID()})).status,409);
  assert.equal((await post('/phone-tools/availability',{enabled:true,arbitrary:true})).status,400);
  assert.equal((await post('/phone-tools/availability',{enabled:true})).status,200);
  const waiting=phoneOperation(state,r.harness,r.library,chat,'401',event,ctx,{pollMs:5}),item=await next(r,chat,device.deviceId),path=`/chats/${chat.id}/phone-tools`;
  const snapshot=await(await fetch(base+`/chats/${chat.id}`,{headers})).json() as any;assert.equal(snapshot.view.docs['bob.phone-tools'].requests[0].id,item.id);
  const wrong=await(await fetch(base+`/chats/${chat.id}`,{headers:{...headers,authorization:`Bearer ${other.credential}`}})).json() as any;assert.deepEqual(wrong.view.docs['bob.phone-tools'].requests,[]);
  assert.equal((await post(path,{id:item.id,action:'claim'},{})).status,401);
  assert.equal((await(await post(path,{id:item.id,action:'claim'})).json() as any).execute,true);
  assert.equal((await post(path,{id:item.id,action:'result',result:{status:'ok'}},{...headers,authorization:`Bearer ${other.credential}`})).status,404);
  assert.equal((await post(path,{id:item.id,action:'result',result:{status:'ok',secret:'no'}})).status,400);
  assert.equal((await post(path,{id:item.id,action:'result',result:{status:'ok',data:{body:'x'.repeat(65536)}}})).status,413);
  assert.equal((await post(path,{id:item.id,action:'result',result:{status:'ok',data:{eventId:'done'}}})).status,200);assert.equal((await waiting).status,'ok');
 }finally{await app.close();state.close();rmSync(f.dir,{recursive:true,force:true});}
});


test('device rebind and disable races are rechecked atomically on the native claim mutation line',{timeout:20000},async()=>{
 const f=await fixture(),{runtime:r,state,chat,device,other}=f;
 try{
  for(const [index,change] of [async()=>bindLocationDevice(chat,other.deviceId),async()=>phoneToolsAvailability(r.library,device.deviceId,{enabled:false},ctx)].entries()){
   await bindLocationDevice(chat,device.deviceId);await phoneToolsAvailability(r.library,device.deviceId,{enabled:true},ctx);
   const stop=withCancel(ctx),waiting=phoneOperation(state,r.harness,r.library,chat,String(501+index),event,stop.context,{pollMs:5});waiting.catch(()=>{});
   const item=await next(r,chat,device.deviceId);
   // Interpose exactly before the claim transaction starts, after any outside snapshots.
   const raced={id:chat.id,commit:async(callback:any,context:any)=>{await change();return chat.commit(callback,context);}} as typeof chat;
   const result=await claimPhoneTool(r.harness,r.library,raced,device.deviceId,{id:item.id,action:'claim'},ctx);
   assert.equal(result.execute,false);assert.equal(result.status,'unavailable');
   assert.equal((await r.harness.snapshot(PhoneRequests,chat.id,ctx))!.requests[item.id].claimedAt,undefined);
   stop.cancel();await assert.rejects(waiting);
  }
 }finally{await f.close();}
});
