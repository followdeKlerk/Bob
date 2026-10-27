import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,statSync,chmodSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
import {createPeerTools,PeerOperations} from '@bob-local/peers';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {serve} from '../src/server.js';
import {grantPeer,connectPeer,listPeers,revokePeer,requestPeer,peerEndpoint} from '../src/peer-config.js';

test('actual native peer tool: lost response is not resent and remote work is not an owned child',async()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR!,'bob-peer-tool-')),a=new State(join(dir,'a')),b=new State(join(dir,'b'));
 const ma=createModels(),fa=fauxProvider(),mb=createModels(),fb=fauxProvider();ma.setProvider(fa.provider);mb.setProvider(fb.provider);
 const ra=await openRuntime(a,ma),rb=await openRuntime(b,mb),sa=await serve(a,{port:0,runtime:ra}),sb=await serve(b,{port:0,runtime:rb});
 let release!:()=>void,started!:()=>void;const held=new Promise<void>(r=>release=r),seen=new Promise<void>(r=>started=r);
 try{
  const destination=await rb.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);
  const source=await ra.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);
  const handoff=join(dir,'grant.json');grantPeer(b,{peerId:a.id,name:'Origin',endpoint:`http://127.0.0.1:${(sb.server.address() as any).port}`,read:[destination.id],message:[destination.id],output:handoff,devLoopback:true});connectPeer(a,handoff,'Destination',true);
  fb.setResponses([async()=>{started();await held;return fauxAssistantMessage('DETERMINISTIC held remote answer');}]);
  let sends=0;
  ra.registry.install(createPeerTools({list:()=>listPeers(a).outbound,request:async(id,action,request,signal)=>{const result=await requestPeer(a,id,action,request,signal);if(action==='message'){sends++;throw Error('TEST response lost AFTER actual remote admission');}return result;}}));
  const args={action:'send',peerId:b.id,conversationId:destination.id,text:'Native peer transport fixture'};
  fa.setResponses([fauxAssistantMessage(fauxToolCall('peer',args),{stopReason:'toolUse'}),fauxAssistantMessage(fauxToolCall('peer',args),{stopReason:'toolUse'}),fauxAssistantMessage('DETERMINISTIC: unknown outcome; no resend')]);
  await source.submit({type:'input',content:'Exercise the explicit peer fixture'},ctx);await ra.harness.waitForIdle(ctx);await seen;
  assert.equal(sends,1);
  const operations=Object.values((await ra.harness.snapshot(PeerOperations,source.id,ctx))!.operations);assert.equal(operations.length,1);assert.equal(operations[0].status,'unknown');
  await source.abort(ctx,{background:true});assert.ok((await rb.harness.inspect(ctx)).tasks.some(t=>!t.record.abortRequested));
  const receipt=await requestPeer(a,b.id,'operation',{conversationId:destination.id,requestId:operations[0].requestId});assert.ok(receipt.admission);
  release();await rb.harness.waitForIdle(ctx);
  const history=await destination.entries({},100,undefined,ctx);assert.equal(history.items.filter(e=>e.kind==='bob.peer-message').length,1);
 }finally{release();await sa.close();await sb.close();a.close();b.close();}
});

test('two genuine backends: private explicit trust, native remote admission/dedup, origin, scope and revocation',async()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR!,'bob-peers-')),a=new State(join(dir,'a')),b=new State(join(dir,'b'));
 const models=createModels(),faux=fauxProvider();models.setProvider(faux.provider);faux.setResponses([fauxAssistantMessage('DETERMINISTIC remote response')]);
 const serverA=await serve(a,{port:0}),runtimeB=await openRuntime(b,models),serverB=await serve(b,{port:0,runtime:runtimeB});
 try {
  const chat=await runtimeB.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);
  const other=await runtimeB.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
  const endpoint=`http://127.0.0.1:${(serverB.server.address() as any).port}`,handoff=join(dir,'handoff.json');
  assert.throws(()=>peerEndpoint(endpoint),/Tailscale/);
  grantPeer(b,{peerId:a.id,name:'Origin A',endpoint,read:[chat.id],message:[chat.id],output:handoff,devLoopback:true});
  assert.equal(statSync(handoff).mode&0o777,0o600);
  assert.throws(()=>connectPeer(b,handoff,'Wrong origin',true),/identity/);
  assert.throws(()=>connectPeer(a,handoff,'Destination B'),/Tailscale/);
  const linked=join(dir,'linked.json');symlinkSync(handoff,linked);assert.throws(()=>connectPeer(a,linked,'Symlink',true),/regular/);
  chmodSync(handoff,0o644);assert.throws(()=>connectPeer(a,handoff,'Public',true),/owner-only/);chmodSync(handoff,0o600);
  connectPeer(a,handoff,'Destination B',true);
  assert.ok(!JSON.stringify(listPeers(a)).includes('credential'));assert.ok(!JSON.stringify(listPeers(b)).includes('tokenHash'));
  await assert.rejects(()=>requestPeer(a,b.id,'history',{conversationId:other.id}),/scope/);
  const requestId=randomUUID(),request={conversationId:chat.id,originConversationId:serverA.runtime.library.id,requestId,text:'Authorized peer fixture message'};
  const admitted=await requestPeer(a,b.id,'message',request),again=await requestPeer(a,b.id,'message',request);
  assert.equal(admitted.admission.id,again.admission.id);
  await runtimeB.harness.waitForIdle(ctx);
  const history=await requestPeer(a,b.id,'history',{conversationId:chat.id});
  const origin=history.items.filter((e:any)=>e.kind==='bob.peer-message');assert.equal(origin.length,1);assert.equal(origin[0].data.originBackendId,a.id);assert.equal(origin[0].data.originName,'Origin A');
  const reconciled=await requestPeer(a,b.id,'operation',{conversationId:chat.id,requestId});assert.equal(reconciled.admission.id,admitted.admission.id);
  assert.equal((await runtimeB.harness.inspect(ctx)).tasks.length,0);
  revokePeer(b,a.id,'inbound');await assert.rejects(()=>requestPeer(a,b.id,'history',{conversationId:chat.id}),/403/);
  revokePeer(a,b.id,'outbound');assert.equal(a.get(`peerKey:${b.id}`),undefined);await assert.rejects(()=>requestPeer(a,b.id,'history',{conversationId:chat.id}),/not explicitly/);
  const listing=spawnSync(process.execPath,['--import','tsx','src/cli.ts','--state',a.dir,'peer','list'],{encoding:'utf8'});assert.equal(listing.status,0,listing.stderr);assert.equal(JSON.parse(listing.stdout).outbound[0].enabled,false);
 }finally{await serverA.close();await serverB.close();a.close();b.close();}
});
