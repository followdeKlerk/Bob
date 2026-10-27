import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {State} from '../src/state.js';
import {serve} from '../src/server.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage} from '@earendil-works/pi-ai/providers/faux';
const fresh=()=>new State(mkdtempSync(join(process.env.TMPDIR!,'bob-test-')));
test('pairing single use, expiry, revocation and identity persistence',()=>{
 const s=fresh(),invite=s.invite(),pair=s.pair(invite.token,'Test device');assert.ok(s.authenticate(pair.credential));assert.throws(()=>s.pair(invite.token,'reuse'));
 const expired=s.invite();s.db.prepare('UPDATE invites SET expires=0').run();assert.throws(()=>s.pair(expired.token,'expired'));
 s.revoke(pair.deviceId);assert.equal(s.authenticate(pair.credential),undefined);const id=s.id,dir=s.dir;s.close();const reopened=new State(dir);assert.equal(reopened.id,id);assert.equal(reopened.authenticate(pair.credential),undefined);reopened.close();
});
test('real Durable HTTP auth, native request admission, reconciliation, restart and reset history (deterministic model only)',async()=>{
 const s=fresh(),models=createModels(),faux=fauxProvider();models.setProvider(faux.provider);faux.setResponses([fauxAssistantMessage('Deterministic test response')]);
 const runtime=await openRuntime(s,models);const app=await serve(s,{port:0,runtime});const port=(app.server.address() as {port:number}).port,base=`http://127.0.0.1:${port}`;
 const invite=s.invite();let r=await fetch(base+'/v1/pair',{method:'POST',body:JSON.stringify({backendId:s.id,invitation:invite.token,name:'test'})});assert.equal(r.status,201);const pair=await r.json() as {credential:string};
 const headers={'authorization':`Bearer ${pair.credential}`,'x-bob-backend':s.id,'content-type':'application/json'};
 const call=(path:string,method='GET',value?:unknown)=>fetch(base+'/v1/'+path,{method,headers,body:value===undefined?undefined:JSON.stringify(value)});
 try{
 assert.equal((await fetch(base+'/v1/chats')).status,401);
 assert.equal((await fetch(base+'/v1/chats',{headers:{...headers,'x-bob-backend':randomUUID()}})).status,409);
 r=await call('chats','POST',{title:'Integration',model:{provider:'faux',modelId:'faux-1'}});assert.equal(r.status,201);const {id}=await r.json() as {id:number};
 const requestId=randomUUID(),input={requestId,text:'Test',mode:'steer',allowSubagents:false};r=await call(`chats/${id}/messages`,'POST',input);assert.equal(r.status,202);const first=await r.json() as {id:number};
 r=await call(`chats/${id}/messages`,'POST',input);assert.equal((await r.json() as {id:number}).id,first.id);
 await runtime.harness.waitForIdle(ctx);r=await call(`chats/${id}/operations/${requestId}`);const outcome=await r.json() as any;assert.equal(outcome.admission.id,first.id);assert.equal(outcome.reply.text,'Deterministic test response');assert.equal(outcome.reply.id,outcome.admission.answer);
 const chat=(await runtime.harness.conversation(id as any,ctx))!;await chat.reset(undefined,ctx);const history=await chat.entries({},100,undefined,ctx);assert.ok(history.items.some(e=>e.kind==='pi.assistant'));
 await app.close();const reopened=await openRuntime(s,models);try{assert.ok(await reopened.harness.conversation(id as any,ctx));const record=await reopened.harness.commit(tx=>tx.submissionByRequest(id as any,`device:${(s.authenticate(pair.credential)!).id}:${requestId}`),ctx);assert.equal(record?.id,first.id);}finally{await reopened.close();}
 }finally{if(app.server.listening)await app.close();s.close();}
});
