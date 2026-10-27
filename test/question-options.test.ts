import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {serve} from '../src/server.js';
import {Questions} from '../src/documents.js';
import {QuestionChoices} from '@bob-local/resources';

test('native ask_user stores choices; selected replies are scoped, deduplicated, and clear only their question',{timeout:15000},async()=>{
 const state=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-question-options-')));
 const models=createModels(),faux=fauxProvider({tokensPerSecond:100000});models.setProvider(faux.provider);
 faux.setResponses([fauxAssistantMessage([fauxToolCall('ask_user',{question:'Who can edit notes?',options:['Only me','Me and Bob'],multiple:false})],{stopReason:'toolUse'}),fauxAssistantMessage(''),fauxAssistantMessage('Answer received.')]);
 const runtime=await openRuntime(state,models),app=await serve(state,{port:0,runtime});
 const device=state.pair(state.invite().token,'Question fixture'),headers={authorization:'Bearer '+device.credential,'x-bob-backend':state.id,'content-type':'application/json'};
 const base=`http://127.0.0.1:${(app.server.address() as any).port}/v1`;
 try{
  const created=await fetch(base+'/chats',{method:'POST',headers,body:JSON.stringify({title:'Question fixture',model:{provider:'faux',modelId:'faux-1'}})});
  assert.equal(created.status,201);const {id}=await created.json() as any;
  const chat=(await runtime.harness.conversation(id,ctx))!;
  const send=(body:any)=>fetch(base+`/chats/${id}/messages`,{method:'POST',headers,body:JSON.stringify(body)});
  assert.equal((await send({requestId:randomUUID(),text:'Ask me',mode:'steer'})).status,202);
  await chat.waitForIdle(ctx);
  const question=(await runtime.harness.snapshot(Questions,id,ctx))!.pending!;
  assert.equal(question.text,'Who can edit notes?');
  const choices=(await runtime.harness.snapshot(QuestionChoices,id,ctx))!;
  assert.deepEqual(choices.options,['Only me','Me and Bob']);assert.equal(choices.multiple,false);assert.equal(choices.questionId,question.id);
  assert.deepEqual(Object.keys(question).sort(),['id','text'],'existing v1 question record stays unchanged');
  const view=await (await fetch(base+`/chats/${id}`,{headers})).json() as any;
  assert.deepEqual(view.view.docs['bob.questions'].pending,{...question,options:choices.options,multiple:false});
  assert.equal((await send({requestId:randomUUID(),questionId:'stale-question',text:'Wrong answer',mode:'steer'})).status,409);
  assert.equal((await runtime.harness.snapshot(Questions,id,ctx))!.pending!.id,question.id);
  const answer={requestId:randomUUID(),questionId:question.id,text:'Me and Bob',mode:'steer'};
  assert.equal((await send(answer)).status,202);await chat.waitForIdle(ctx);
  assert.equal((await runtime.harness.snapshot(Questions,id,ctx))!.pending,undefined);
  // A lost response may be replayed even though the question is now cleared.
  assert.equal((await send(answer)).status,200);
  const history=await (await fetch(base+`/chats/${id}/history`,{headers})).json() as any;
  assert.equal(history.items.filter((entry:any)=>entry.kind==='bob.user'&&entry.data.requestId===answer.requestId).length,1);
  await chat.commit(async tx=>{(await tx.doc(Questions,id)).pending={id:'legacy',text:'Old text-only question'};},ctx);
  assert.equal((await send({requestId:randomUUID(),questionId:question.id,text:'Late answer',mode:'steer'})).status,409);
  assert.equal((await runtime.harness.snapshot(Questions,id,ctx))!.pending!.id,'legacy');
  const legacy=await (await fetch(base+`/chats/${id}`,{headers})).json() as any;
  assert.deepEqual(legacy.view.docs['bob.questions'].pending,{id:'legacy',text:'Old text-only question'},'choices from an old question cannot leak into a newer one');
 }finally{await app.close();state.close();}
});
