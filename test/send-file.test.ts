import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,unlinkSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {serve} from '../src/server.js';
import {sendFile} from '../src/send-file.js';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';

test('native send_file publishes downloadable original bytes, scoped to the conversation',{timeout:20000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bob-send-file-')),state=new State(dir),path=join(dir,'CV.pdf'),bytes=Buffer.from('%PDF-1.7\nExample CV\n');writeFileSync(path,bytes);
 const models=createModels(),faux=fauxProvider({tokensPerSecond:100000});models.setProvider(faux.provider);
 faux.setResponses([fauxAssistantMessage([fauxToolCall('send_file',{path,name:'My CV.pdf'})],{stopReason:'toolUse'}),fauxAssistantMessage('Attached.')]);
 const runtime=await openRuntime(state,models),app=await serve(state,{port:0,runtime}),device=state.pair(state.invite().token,'Files test');
 const base=`http://127.0.0.1:${(app.server.address() as any).port}/v1`,headers={authorization:'Bearer '+device.credential,'x-bob-backend':state.id,'content-type':'application/json'};
 try{
  const {id}=await (await fetch(base+'/chats',{method:'POST',headers,body:JSON.stringify({title:'File fixture',model:{provider:'faux',modelId:'faux-1'}})})).json() as any;
  const chat=(await runtime.harness.conversation(id,ctx))!;
  assert.ok((await chat.agent(ctx)).tools.some(tool=>tool.name==='send_file'));
  assert.equal((await fetch(base+`/chats/${id}/messages`,{method:'POST',headers,body:JSON.stringify({requestId:randomUUID(),text:'Send my CV',mode:'steer'})})).status,202);
  await chat.waitForIdle(ctx);
  const history=await (await fetch(base+`/chats/${id}/history`,{headers})).json() as any;
  const files=history.items.filter((entry:any)=>entry.kind==='bob.file');assert.equal(files.length,1);
  const meta=files[0].data;assert.equal(meta.name,'My CV.pdf');assert.equal(meta.mime,'application/pdf');assert.equal(meta.sha256,createHash('sha256').update(bytes).digest('hex'));
  const url=base+`/chats/${id}/artifacts/${meta.id}`;
  const download=await fetch(url,{headers});assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);
  assert.match(download.headers.get('content-disposition')!,/My%20CV.pdf/);
  assert.equal((await fetch(url)).status,401);
  const other=await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
  assert.equal((await fetch(base+`/chats/${other.id}/artifacts/${meta.id}`,{headers})).status,404);
 }finally{await app.close();state.close();}
});

test('file snapshots and task replay survive restart without duplicating or rereading source',{timeout:20000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bob-file-replay-')),state=new State(dir),path=join(dir,'report.txt');writeFileSync(path,'Original');
 let runtime=await openRuntime(state);let chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx);const chatId=chat.id;
 try{
  const first=await sendFile(state,chat,'task-one',{path},ctx);await chat.waitForIdle(ctx);
  unlinkSync(path);
  assert.deepEqual(await sendFile(state,chat,'task-one',{path},ctx),first);
  await assert.rejects(()=>sendFile(state,chat,'task-one',{path,name:'Changed'},ctx),/identity conflict/);
  await runtime.close();runtime=await openRuntime(state);chat=(await runtime.harness.conversation(chatId,ctx))!;
  assert.deepEqual(await sendFile(state,chat,'task-one',{path},ctx),first);
  assert.equal(readFileSync(join(dir,'artifacts',String(chatId),first.artifact.id),'utf8'),'Original');
 }finally{await runtime.close();state.close();}
});

test('file sending rejects invalid names, missing files, directories, symlinks and oversized files',{timeout:15000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bob-file-invalid-')),state=new State(dir);state.set('uploadLimit',4);
 const runtime=await openRuntime(state),chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx),path=join(dir,'large.txt');writeFileSync(path,'Too long');symlinkSync(path,join(dir,'link'));
 const call=(input:unknown)=>sendFile(state,chat,randomUUID(),input,ctx);
 try{
  await assert.rejects(()=>call({path:'relative.txt'}),/absolute/);
  await assert.rejects(()=>call({path,name:'../escape'}));
  await assert.rejects(()=>call({path:join(dir,'missing')}),/ENOENT/);
  await assert.rejects(()=>call({path:dir}),/regular files/);
  await assert.rejects(()=>call({path:join(dir,'link')}),/ELOOP/);
  await assert.rejects(()=>call({path}),/limit/);
 }finally{await runtime.close();state.close();}
});
