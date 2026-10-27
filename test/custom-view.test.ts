import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {State} from '../src/state.js';
import {serve} from '../src/server.js';
import {ctx} from '../src/runtime.js';
import {Questions, Todos} from '../src/documents.js';

test('HTTP and SSE explicitly expose native extension docs, including idle custom-only edits', {timeout:15000}, async()=>{
  const state=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-custom-view-')));
  const app=await serve(state,{port:0});
  const device=state.pair(state.invite().token,'view test');
  const base=`http://127.0.0.1:${(app.server.address() as {port:number}).port}`;
  const headers={authorization:`Bearer ${device.credential}`,'x-bob-backend':state.id};
  const cancel=new AbortController();
  try {
    const chat=await app.runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
    await chat.commit(async tx=>{(await tx.doc(Todos,chat.id)).items=[{text:'Native task',done:false}];},ctx);
    const response=await fetch(`${base}/v1/chats/${chat.id}`,{headers});
    const data=await response.json() as any;
    assert.equal(data.view.docs['bob.todos'].items[0].text,'Native task');
    const stream=await fetch(`${base}/v1/chats/${chat.id}/events`,{headers,signal:cancel.signal});
    const reader=stream.body!.getReader(), decoder=new TextDecoder();
    let text=decoder.decode((await reader.read()).value);
    assert.match(text,/Native task/);
    await chat.commit(async tx=>{(await tx.doc(Questions,chat.id)).pending={id:'fixture',text:'Idle question change'};},ctx);
    const timeout=setTimeout(()=>cancel.abort(),8000);
    try { while(!text.includes('Idle question change')) { const part=await reader.read();assert.equal(part.done,false);text+=decoder.decode(part.value); } }
    finally {clearTimeout(timeout);cancel.abort();}
    assert.match(text,/bob.questions/);
  } finally {cancel.abort();await app.close();state.close();}
});
