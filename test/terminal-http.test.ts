import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {defineExtension,defineTask,type Conversation} from '@earendil-works/pi-durable';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {serve} from '../src/server.js';
import {SessionUI} from '../src/session-controls.js';
import {RetiredChat} from '../src/retired-chat-profile.js';
import type {TerminalManager} from '../src/terminal.js';
const held=defineTask<null,{phase:'hold'},null>({name:'test.terminal-held',version:1,initial:()=>({phase:'hold'}),phases:{hold:async()=>{throw Error('No task should run');}},abort:async()=>{throw Error('No task should run');}});
async function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'bob-terminal-http-')),state=new State(dir),runtime=await openRuntime(state,undefined,undefined,{resume:false});
 const calls:{action:string;args:unknown[]}[]=[],sessionId=randomUUID();
 const terminal:TerminalManager={
  capabilities:async()=>({available:true,protocol:'mosh',maxSessions:8,portStart:60020,portEnd:60027}),
  status:async(...args)=>{calls.push({action:'status',args});return {available:true,cwd:args[2],connected:false};},
  connect:async(...args)=>{calls.push({action:'connect',args});return {sessionId,requestId:args[3],host:'127.0.0.1',port:60020,key:'abcdefghijklmnopqrstuv',cwd:args[2]};},
  disconnect:async(...args)=>{calls.push({action:'disconnect',args});return {ended:true};},
  reap:async()=>{},close:async()=>{calls.push({action:'close',args:[]});},
 };
 runtime.registry.install(defineExtension({name:'test.terminal-http',tasks:[held]}));
 const app=await serve(state,{port:0,runtime,terminal}),pair=state.pair(state.invite().token,'Terminal test');
 const headers={authorization:`Bearer ${pair.credential}`,'x-bob-backend':state.id,'content-type':'application/json'};
 const base=`http://127.0.0.1:${(app.server.address() as any).port}/v1`;
 const create=(cwd?:string)=>runtime.harness.createConversation({ownership:{kind:'ownerless'},agent:{cwd}},ctx);
 const request=(chat:Conversation|number,method='GET',body?:unknown,customHeaders=headers)=>fetch(`${base}/chats/${typeof chat==='number'?chat:chat.id}/terminal`,{method,headers:customHeaders,body:body===undefined?undefined:JSON.stringify(body)});
 return {dir,state,runtime,terminal,sessionId,calls,app,pair,headers,create,request,async close(){await app.close();state.close();rmSync(dir,{recursive:true,force:true});}};
}

test('terminal bootstrap uses paired device, selected effective cwd and no transcript writes',{timeout:30000},async()=>{
 const f=await fixture();try{
  const chat=await f.create('/tmp/project with spaces');
  const entries=await chat.entries({},20,undefined,ctx),before=await chat.agent(ctx),requestId=randomUUID();
  let response=await f.request(chat);assert.equal(response.status,200);assert.equal((await response.json()).cwd,'/tmp/project with spaces');
  response=await f.request(chat,'POST',{requestId});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(await response.json(),{sessionId:f.sessionId,requestId,host:'127.0.0.1',port:60020,key:'abcdefghijklmnopqrstuv',cwd:'/tmp/project with spaces'});
  assert.deepEqual(f.calls,[{action:'status',args:[f.pair.deviceId,String(chat.id),'/tmp/project with spaces']},{action:'connect',args:[f.pair.deviceId,String(chat.id),'/tmp/project with spaces',requestId]}]);
  assert.equal((await f.request(chat,'DELETE',{sessionId:f.sessionId})).status,200);
  assert.deepEqual(f.calls.at(-1),{action:'disconnect',args:[f.pair.deviceId,String(chat.id),f.sessionId]});
  assert.deepEqual(await chat.entries({},20,undefined,ctx),entries);assert.equal((await chat.agent(ctx)).cwd,before.cwd);assert.equal((await chat.agent(ctx)).instructions,before.instructions);
  f.state.set('cwd','/tmp/default');const defaults=await f.create();assert.equal((await (await f.request(defaults)).json()).cwd,'/tmp/default');
 }finally{await f.close();}
 assert.equal(f.calls.at(-1)?.action,'close');
});

test('terminal rejects unauthenticated, mismatched backend, reserved, retired, trashed and child access before host calls',{timeout:30000},async()=>{
 const f=await fixture();try{
  const chat=await f.create('/tmp'),retired=await f.create('/tmp'),trashed=await f.create('/tmp');
  await retired.commit(async tx=>{(await tx.doc(RetiredChat,retired.id)).profile='restricted-local';},ctx);
  await trashed.commit(async tx=>{(await tx.doc(SessionUI,trashed.id)).trashed=true;},ctx);
  const taskId=await chat.commit(tx=>tx.createTask(held,null,{ownership:{kind:'conversation'},background:true}),ctx);
  const child=await f.runtime.harness.createConversation({ownership:{kind:'task',taskId}},ctx);
  assert.equal((await f.request(chat,'GET',undefined,{} as typeof f.headers)).status,401);
  assert.equal((await f.request(chat,'GET',undefined,{...f.headers,'x-bob-backend':'wrong'})).status,409);
  for(const [target,status] of [[f.runtime.library,403],[retired,410],[trashed,403],[child,403]] as const){
   for(const method of ['GET','POST','DELETE'])assert.equal((await f.request(target,method,method==='GET'?undefined:method==='POST'?{requestId:randomUUID()}:{sessionId:f.sessionId})).status,status);
  }
  assert.equal((await f.request(999999)).status,404);assert.deepEqual(f.calls,[]);
  f.state.revoke(f.pair.deviceId);assert.equal((await f.request(chat,'POST',{requestId:randomUUID()})).status,401);assert.deepEqual(f.calls,[]);
 }finally{await f.close();}
});

test('terminal API never accepts caller-supplied shell, cwd, port or arbitrary end target',{timeout:30000},async()=>{
 const f=await fixture();try{
  const chat=await f.create('/tmp');
  for(const input of [{},{requestId:'invalid'},{requestId:randomUUID(),cwd:'/etc'},{requestId:randomUUID(),command:'id'},{requestId:randomUUID(),port:22}])assert.equal((await f.request(chat,'POST',input)).status,400);
  for(const input of [{},{sessionId:'../../other'},{sessionId:f.sessionId,command:'kill'}])assert.equal((await f.request(chat,'DELETE',input)).status,400);
  assert.equal((await f.request(chat,'PUT',{})).status,405);assert.deepEqual(f.calls,[]);
 }finally{await f.close();}
});
