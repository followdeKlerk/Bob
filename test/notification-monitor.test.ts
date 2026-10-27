import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {serve} from '../src/server.js';
import {Questions} from '../src/documents.js';

test('notification status remains bounded above the Android transcript limit and includes clarification identity',async()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR!,'bob-monitor-')),state=new State(dir),runtime=await openRuntime(state),app=await serve(state,{port:0,runtime});
 try{
  const chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
  await chat.submit({type:'write',entry:{kind:'bob.large-fixture',data:{text:'x'.repeat(2200000)}}},ctx);
  await chat.commit(async tx=>{(await tx.doc(Questions,chat.id)).pending={id:'fixture-question',text:'A bounded clarification'+'.'.repeat(5000)};},ctx);
  const device=state.pair(state.invite().token,'Monitor fixture');
  const base=`http://127.0.0.1:${(app.server.address() as any).port}/v1/chats/${chat.id}`;
  const headers={authorization:'Bearer '+device.credential,'x-bob-backend':state.id};
  const full=await fetch(base,{headers});assert.ok(Buffer.byteLength(await full.text())>2097152,'Reproduces the real Android limit');
  const response=await fetch(base+'/operations/'+randomUUID(),{headers});assert.equal(response.status,200);
  const text=await response.text(),status=JSON.parse(text);assert.ok(Buffer.byteLength(text)<4096);
  assert.deepEqual(status.question,{id:'fixture-question',text:('A bounded clarification'+'.'.repeat(5000)).slice(0,1000)});assert.equal(status.admission,null);assert.equal(status.reply,null);assert.equal(status.view,undefined);
  assert.equal((await fetch(base+'/operations/'+randomUUID())).status,401);
 }finally{await app.close();state.close();rmSync(dir,{recursive:true,force:true});}
});
