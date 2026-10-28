import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {withCancel} from '@earendil-works/chord/context';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {serve} from '../src/server.js';
import {bindLocationDevice} from '../src/phone-location.js';
import {DiagnosticRequests,DiagnosticReport,requestDiagnostics,respondDiagnostics,diagnosticView} from '../src/app-diagnostics.js';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
const report=()=>({schema:1 as const,collectedAt:Date.now(),versionName:'0.3.76',versionCode:79,androidSdk:35,webViewVersion:'133.0.0',events:[{time:Date.now(),event:'activity.resume'}],exits:[],inline:[{time:Date.now(),event:'fallback-timeout',width:821,height:1102,requestedHeight:182}]});
async function pending(runtime:Awaited<ReturnType<typeof openRuntime>>,chat:any,device:string){for(let i=0;i<100;i++){const value=await diagnosticView(runtime.harness,chat,device);const item=value.requests.find(r=>r.status==='pending');if(item)return item;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('No consent request');}

test('native diagnostic tool waits for source-phone consent and returns one authenticated report in chat',{timeout:20000},async()=>{
 const state=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-diagnostic-tool-'))),models=createModels(),faux=fauxProvider({tokensPerSecond:100000});models.setProvider(faux.provider);
 faux.setResponses([fauxAssistantMessage([fauxToolCall('request_diagnostics',{purpose:'Diagnose inline card fallback'})],{stopReason:'toolUse'}),fauxAssistantMessage('Report received for analysis.')]);
 const runtime=await openRuntime(state,models),app=await serve(state,{port:0,runtime});const device=state.pair(state.invite().token,'Source'),other=state.pair(state.invite().token,'Other');
 const base=`http://127.0.0.1:${(app.server.address() as any).port}/v1`,headers={authorization:`Bearer ${device.credential}`,'x-bob-backend':state.id,'content-type':'application/json'},post=(path:string,data:unknown,auth=headers)=>fetch(base+path,{method:'POST',headers:auth,body:JSON.stringify(data)});
 try{
  const {id}=await(await post('/chats',{title:'Diagnostics',model:{provider:'faux',modelId:'faux-1'}})).json() as any;
  const chat=(await runtime.harness.conversation(id,ctx))!;
  assert.ok((await chat.agent(ctx)).tools.some(t=>t.name==='request_diagnostics'));
  await post(`/chats/${id}/messages`,{requestId:randomUUID(),text:'Diagnose the inline failure',mode:'steer'});
  const item=await pending(runtime,chat,device.deviceId),url=`/chats/${id}/diagnostics`;
  const snapshot=await(await fetch(base+`/chats/${id}`,{headers})).json() as any;
  assert.equal(snapshot.view.docs['bob.diagnostics'].requests[0].canRespond,true);
  const wrong=await(await fetch(base+`/chats/${id}`,{headers:{...headers,authorization:`Bearer ${other.credential}`}})).json() as any;
  assert.equal(wrong.view.docs['bob.diagnostics'].requests[0].canRespond,false);
  assert.equal((await post(url,{id:item.id,action:'approve'},{'x-bob-backend':state.id,'content-type':'application/json'} as any)).status,401);
  assert.equal((await post(url,{id:item.id,action:'approve'},{...headers,authorization:`Bearer ${other.credential}`})).status,404);
  assert.equal((await post(url,{id:item.id,action:'upload',report:report()})).status,410,'upload before consent rejected');
  assert.equal((await post(url,{id:item.id,action:'approve'})).status,200);
  assert.equal((await post(url,{id:item.id,action:'approve'})).status,200,'lost approval acknowledgement can reconcile');
  assert.equal((await post(url,{id:item.id,action:'upload',report:{...report(),token:'secret'}})).status,400);
  assert.equal((await post(url,{id:item.id,action:'upload',report:{...report(),collectedAt:1}})).status,400);
  const value=report();assert.equal((await post(url,{id:item.id,action:'upload',report:value})).status,200);
  assert.equal((await post(url,{id:item.id,action:'upload',report:value})).status,200);
  assert.equal((await post(url,{id:item.id,action:'upload',report:report()})).status,409);
  await chat.waitForIdle(ctx);
  const history=(await chat.entries({},100,undefined,ctx)).items;
  assert.equal(history.filter(e=>e.kind==='bob.diagnostic-report').length,1);
  assert.ok(JSON.stringify(history).includes('fallback-timeout'));
  assert.equal(JSON.stringify(await diagnosticView(runtime.harness,chat,device.deviceId)).includes('fallback-timeout'),false,'UI snapshot does not retransmit reports');
 }finally{await app.close();state.close();}
});

test('decline, Stop, expiry, restart receipts and conversation scoping do not upload or recapture',{timeout:20000},async()=>{
 const state=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-diagnostic-consent-')));let runtime=await openRuntime(state);const device=state.pair(state.invite().token,'Source');
 let chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx);const chatId=chat.id;
 try{
  await bindLocationDevice(chat,device.deviceId);
  const first=requestDiagnostics(state,chat,'10001','Investigate fallback',ctx),item=await pending(runtime,chat,device.deviceId);
  await respondDiagnostics(state,chat,device.deviceId,{id:item.id,action:'decline'});assert.equal((await first).status,'declined');
  const other=await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
  await assert.rejects(()=>respondDiagnostics(state,other,device.deviceId,{id:item.id,action:'approve'}),/not found/);
  await runtime.close();runtime=await openRuntime(state);chat=(await runtime.harness.conversation(chatId,ctx))!;
  assert.equal((await requestDiagnostics(state,chat,'10001','Investigate fallback',ctx)).status,'declined','replay cannot ask for consent again');
  const cancelled=withCancel(ctx),waiting=requestDiagnostics(state,chat,'10002','Stop case',cancelled.context);waiting.catch(()=>{});
  const stop=await pending(runtime,chat,device.deviceId);cancelled.cancel();await assert.rejects(waiting);
  await assert.rejects(()=>respondDiagnostics(state,chat,device.deviceId,{id:stop.id,action:'approve'}),/no longer/);
  const expiring=requestDiagnostics(state,chat,'10003','Expiry case',ctx),expiry=await pending(runtime,chat,device.deviceId);
  await chat.commit(async tx=>{(await tx.doc(DiagnosticRequests,chat.id)).requests[expiry.id].expiresAt=Date.now()-1;},ctx);
  assert.equal((await expiring).status,'expired');
  await assert.rejects(()=>respondDiagnostics(state,chat,device.deviceId,{id:expiry.id,action:'approve'}),/no longer/);
  assert.equal((await chat.entries({},100,undefined,ctx)).items.filter(e=>e.kind==='bob.diagnostic-report').length,0);
  for(let task=10004;task<=10012;task++){
   const waiting=requestDiagnostics(state,chat,String(task),'Bounded receipts',ctx),next=await pending(runtime,chat,device.deviceId);
   await respondDiagnostics(state,chat,device.deviceId,{id:next.id,action:'decline'});await waiting;
  }
  assert.equal(Object.keys((await runtime.harness.snapshot(DiagnosticRequests,chat.id,ctx))!.requests).length,8);
  await assert.rejects(()=>requestDiagnostics(state,chat,'10001','Investigate fallback',ctx),/cannot be recaptured/);
 }finally{await runtime.close();state.close();}
});

test('diagnostic schema rejects content, identifiers, arbitrary logs and unbounded samples',()=>{
 assert.equal(DiagnosticReport.safeParse(report()).success,true);
 for(const value of [{...report(),messages:['private']},{...report(),deviceId:randomUUID()},{...report(),inline:[{...report().inline[0],html:'private'}]},{...report(),events:[{time:Date.now(),event:'https://secret.invalid'}]},{...report(),inline:Array(65).fill(report().inline[0])}])assert.equal(DiagnosticReport.safeParse(value).success,false);
});
