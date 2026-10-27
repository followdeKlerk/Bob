import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {serve} from '../src/server.js';
import {syncConnectedNetwork} from '../apps/mobile/connected-network.js';
import {ChatMeta} from '../src/documents.js';

test('paired machines automatically discover, read and message native agents; identity and revocation stay enforced', {timeout:30000},async()=>{
 const root=mkdtempSync(join(process.env.TMPDIR!,'bob-network-'));
 const a=new State(join(root,'a')),b=new State(join(root,'b'));
 const ma=createModels(),mb=createModels(),fa=fauxProvider({tokensPerSecond:10000}),fb=fauxProvider({tokensPerSecond:10000});ma.setProvider(fa.provider);mb.setProvider(fb.provider);
 const ra=await openRuntime(a,ma),rb=await openRuntime(b,mb);
 const sa=await serve(a,{port:0,runtime:ra,devPeerLoopback:true} as any),sb=await serve(b,{port:0,runtime:rb,devPeerLoopback:true} as any);
 const ea=`http://127.0.0.1:${(sa.server.address() as any).port}`,eb=`http://127.0.0.1:${(sb.server.address() as any).port}`;
 const da=a.pair(a.invite().token,'Phone A'),db=b.pair(b.invite().token,'Phone B');
 const req=(s:State,e:string,credential:string,path:string,body?:unknown)=>fetch(e+'/v1/'+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+credential,'x-bob-backend':s.id,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
 try{
  const source=await ra.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);
  const destination=await rb.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}},init:async(tx,c)=>{(await tx.doc(ChatMeta,c)).title='Laptop build agent';}},ctx);
  await destination.commit(tx=>tx.appendEntry(destination.id,{kind:'fixture.network',data:{text:'Build is ready'}}),ctx);
  const grantBody={peerId:a.id,name:'Machine A',endpoint:eb};
  assert.equal((await req(b,eb,'wrong','network/grant',grantBody)).status,401);
  const granted=await req(b,eb,db.credential,'network/grant',grantBody);assert.equal(granted.status,200);
  const handoff=await granted.json();
  assert.equal((await req(b,eb,db.credential,'network/grant',grantBody).then(r=>r.json())).credential,handoff.credential,'bootstrap retry is stable');
  assert.equal((await req(b,eb,db.credential,'network/connect',{handoff,name:'Wrong origin'})).status,400);
  const connected=await req(a,ea,da.credential,'network/connect',{handoff,name:'Laptop'});assert.equal(connected.status,200);
  const overview=await req(a,ea,da.credential,'peers').then(r=>r.json());assert.equal(overview.outbound[0].allConversations,true);assert.ok(!JSON.stringify(overview).includes(handoff.credential));
  const sync=await syncConnectedNetwork([{backendId:a.id,endpoint:ea,name:'Machine A'},{backendId:b.id,endpoint:eb,name:'Laptop'}],async(path,method,body,backend)=>{
   const response=await req(backend.backendId===a.id?a:b,backend.endpoint,backend.backendId===a.id?da.credential:db.credential,path,body);
   if(!response.ok)throw Error('HTTP '+response.status);return response.json();
  });assert.deepEqual(sync.errors,[]);
  assert.equal((await req(b,eb,db.credential,'peers').then(r=>r.json())).outbound[0].id,a.id);
  const peer=(action:string,body:unknown)=>fetch(eb+'/v1/peer/'+action,{method:'POST',headers:{authorization:'Bearer '+handoff.credential,'x-bob-peer':a.id,'content-type':'application/json'},body:JSON.stringify({destinationBackendId:b.id,...body as object})});
  const found=await peer('conversations',{query:'build',limit:1}).then(r=>r.json());assert.equal(found.items[0].id,destination.id);assert.equal(found.items[0].title,'Laptop build agent');
  assert.equal((await peer('history',{conversationId:rb.library.id})).status,403);
  assert.equal((await peer('history',{conversationId:destination.id,destinationBackendId:randomUUID()})).status,403);
  const call=async(args:Record<string,unknown>)=>{
   let result:any;fa.setResponses([fauxAssistantMessage(fauxToolCall('peer',args),{stopReason:'toolUse'}),context=>{result=context.messages.findLast(m=>m.role==='toolResult');return fauxAssistantMessage('DETERMINISTIC network fixture complete');}]);
   await(await source.submit({type:'input',content:'Exercise connected agents'},ctx)).wait(ctx);assert.ok(result);assert.ok(!result.isError,JSON.stringify(result));return JSON.parse(result.content[0].text);
  };
  assert.ok((await call({action:'list'})).some((p:any)=>p.id===a.id&&p.local));
  assert.equal((await call({action:'conversations',peerId:b.id,query:'build'})).items[0].id,destination.id);
  assert.ok((await call({action:'history',peerId:b.id,conversationId:destination.id})).items.some((e:any)=>e.kind==='fixture.network'));
  fb.setResponses([fauxAssistantMessage('DETERMINISTIC remote reply: build ready')]);
  const sent=await call({action:'send',peerId:b.id,conversationId:destination.id,text:'What is the build status?'});assert.ok(sent.admitted.admission);
  await rb.harness.waitForIdle(ctx);
  const reconciled=await call({action:'operation',peerId:b.id,conversationId:destination.id,requestId:sent.requestId});assert.ok(reconciled.admission);
  assert.ok(JSON.stringify(await call({action:'history',peerId:b.id,conversationId:destination.id})).includes('DETERMINISTIC remote reply'));
  assert.equal((await peer('message',{conversationId:destination.id,originConversationId:source.id,requestId:sent.requestId,text:'What is the build status?'}).then(r=>r.json())).admission.id,sent.admitted.admission.id);
  assert.equal((await destination.entries({},100,undefined,ctx)).items.filter(e=>e.kind==='bob.peer-message').length,1);
  // Future conversations require no new grant.
  const future=await rb.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
  assert.equal((await peer('history',{conversationId:future.id})).status,200);
  const deadline=Date.now()+8000;
  while(Date.now()<deadline&&!(await source.entries({},100,undefined,ctx)).items.some(e=>e.kind==='bob.peer-reply'))await new Promise(r=>setTimeout(r,50));
  const returned=(await source.entries({},100,undefined,ctx)).items.filter(e=>e.kind==='bob.peer-reply');assert.equal(returned.length,1);assert.ok(JSON.stringify(returned).includes('DETERMINISTIC remote reply'));
  assert.equal((await rb.harness.commit(tx=>tx.scanConversations({},100),ctx)).items.length,3,'No new subagent created by messaging');
  b.revoke(db.deviceId);assert.equal((await peer('history',{conversationId:destination.id})).status,403);
  const replacement=b.pair(b.invite().token,'Re-paired phone');
  const repaired=await syncConnectedNetwork([{backendId:a.id,endpoint:ea,name:'Machine A'},{backendId:b.id,endpoint:eb,name:'Laptop'}],async(path,method,body,backend)=>{
   const response=await req(backend.backendId===a.id?a:b,backend.endpoint,backend.backendId===a.id?da.credential:replacement.credential,path,body);
   if(!response.ok)throw Error('HTTP '+response.status);return response.json();
  });assert.deepEqual(repaired.errors,[]);
  assert.equal((await peer('history',{conversationId:destination.id})).status,403,'Old peer credential stays invalid');
  assert.ok((await call({action:'history',peerId:b.id,conversationId:destination.id})).items.length);

 }finally{await sa.close();await sb.close();a.close();b.close();}
});
