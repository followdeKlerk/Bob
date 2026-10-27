import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {serve} from '../src/server.js';
import {grantNetwork,connectNetwork} from '../src/network-pairing.js';

async function until(check:()=>Promise<boolean>){const deadline=Date.now()+10000;while(Date.now()<deadline){if(await check())return;await new Promise(r=>setTimeout(r,40));}assert.fail('Timed out waiting for native persisted reply');}
test('native reply watcher survives source runtime restart and never resends destination message',{timeout:30000},async()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR!,'bob-network-recovery-')),a=new State(join(dir,'a')),b=new State(join(dir,'b'));
 const ma=createModels(),mb=createModels(),fa=fauxProvider({tokensPerSecond:10000}),fb=fauxProvider({tokensPerSecond:10000});ma.setProvider(fa.provider);mb.setProvider(fb.provider);
 let ra=await openRuntime(a,ma);const rb=await openRuntime(b,mb),sb=await serve(b,{port:0,runtime:rb});
 const device=b.pair(b.invite().token,'Recovery fixture'),endpoint=`http://127.0.0.1:${(sb.server.address() as any).port}`;
 let release!:()=>void;const held=new Promise<void>(r=>release=r);
 try{
  await connectNetwork(a,{name:'Destination',handoff:grantNetwork(b,device.deviceId,{peerId:a.id,name:'Source',endpoint},true)},true);
  const destination=await rb.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);
  const source=await ra.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx),sourceId=source.id;
  fb.setResponses([async()=>{await held;return fauxAssistantMessage('DETERMINISTIC recovered remote answer');}]);
  fa.setResponses([fauxAssistantMessage(fauxToolCall('peer',{action:'send',peerId:b.id,conversationId:destination.id,text:'Recovery fixture question'}),{stopReason:'toolUse'}),fauxAssistantMessage('Waiting for existing agent'),fauxAssistantMessage('Received recovered answer')]);
  await(await source.submit({type:'input',content:'Ask the existing remote agent'},ctx)).wait(ctx);
  assert.ok((await ra.harness.inspect(ctx)).tasks.some(t=>t.record.kind==='bob.peer-reply'));
  await ra.close();ra=await openRuntime(a,ma);release();
  await until(async()=>{const chat=(await ra.harness.conversation(sourceId,ctx))!;return (await chat.entries({},100,undefined,ctx)).items.some(e=>e.kind==='bob.peer-reply');});
  const chat=(await ra.harness.conversation(sourceId,ctx))!;
  const replies=(await chat.entries({},100,undefined,ctx)).items.filter(e=>e.kind==='bob.peer-reply');assert.equal(replies.length,1);assert.ok(JSON.stringify(replies).includes('recovered remote answer'));
  assert.equal((await destination.entries({},100,undefined,ctx)).items.filter(e=>e.kind==='bob.peer-message').length,1);
 }finally{release();await ra.close();await sb.close();a.close();b.close();}
});

test('native peer tool messages an existing local sibling without per-chat grants',{timeout:15000},async()=>{
 const state=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-local-network-'))),models=createModels(),faux=fauxProvider({tokensPerSecond:10000});models.setProvider(faux.provider);
 const runtime=await openRuntime(state,models);
 try{
  const create=()=>runtime.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);
  const source=await create(),target=await create();
  faux.setResponses([fauxAssistantMessage(fauxToolCall('peer',{action:'send',peerId:state.id,conversationId:target.id,text:'Local sibling question'}),{stopReason:'toolUse'}),fauxAssistantMessage('DETERMINISTIC local answer'),fauxAssistantMessage('DETERMINISTIC local acknowledgement'),fauxAssistantMessage('DETERMINISTIC report')]);
  await(await source.submit({type:'input',content:'Ask another existing local chat'},ctx)).wait(ctx);
  await until(async()=>(await source.entries({},100,undefined,ctx)).items.some(e=>e.kind==='bob.peer-reply'));
  assert.equal((await target.entries({},100,undefined,ctx)).items.filter(e=>e.kind==='bob.peer-message').length,1);
  assert.equal((await runtime.harness.commit(tx=>tx.scanConversations({},100),ctx)).items.length,3);
 }finally{await runtime.close();state.close();}
});
