import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {defineTask} from '@earendil-works/pi-durable';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {moduleIds,moduleCatalog,listModules,selectModules,changeModule,validateModuleManifest} from '../src/modules.js';
import {Todos} from '../src/documents.js';
import {DelegationSession,delegationSnapshotName} from '../src/delegation.js';
import {serve} from '../src/server.js';

test('separate module compatibility, native selection, removal/reinstall and document preservation',async()=>{
 const state=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-modules-')));
 let runtime=await openRuntime(state,undefined,undefined,{resume:false});
 try {
  assert.equal(moduleCatalog().length,moduleIds.length);
  const manifest=JSON.parse(readFileSync('packages/web/package.json','utf8'));
  assert.throws(()=>validateModuleManifest({...manifest,bobExtension:{...manifest.bobExtension,durable:'2.0.0'}},'web'));
  assert.throws(()=>validateModuleManifest({...manifest,name:'@wrong/package'},'web'),/identity/);
  const chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx),id=chat.id;
  await chat.commit(async tx=>{(await tx.doc(Todos,id)).items=[{text:'Retained across package removal',done:false}];},ctx);
  await selectModules(state,runtime,chat,['resources']);
  const snapshot=(await runtime.harness.snapshot(DelegationSession,id,ctx))!;
  const expectedExtensions=['bob.resources',delegationSnapshotName(snapshot.config!)];
  // The internal wrapper retains this chat's routing schema; it grants no tools
  // while subagents are deselected and must not revive any disabled module.
  assert.deepEqual((await chat.agent(ctx)).extensions.map(e=>e.name),expectedExtensions);
  assert.equal((await chat.agent(ctx)).tools.some(t=>['browser','subagent'].includes(t.name)),false);
  assert.deepEqual((await listModules(state,runtime,chat)).filter(m=>m.selected).map(m=>m.id),['resources']);
  await assert.rejects(()=>selectModules(state,runtime,chat,['resources','resources']),/Duplicate/);
  await changeModule(state,runtime,'remove','web');
  assert.equal((await listModules(state,runtime)).find(m=>m.id==='web')?.installed,false);
  await runtime.close();runtime=await openRuntime(state,undefined,undefined,{resume:false});
  assert.equal(runtime.registry.snapshot().extension('bob.web'),undefined);
  assert.equal((await runtime.harness.snapshot(Todos,id,ctx))?.items[0].text,'Retained across package removal');
  await changeModule(state,runtime,'install','web');
  assert.equal((await listModules(state,runtime)).find(m=>m.id==='web')?.defaultSelected,false);
  await runtime.close();runtime=await openRuntime(state,undefined,undefined,{resume:false});
  assert.ok(runtime.registry.snapshot().extension('bob.web'));
  const restored=(await runtime.harness.conversation(id,ctx))!;
  assert.deepEqual((await restored.agent(ctx)).extensions.map(e=>e.name),expectedExtensions);
  assert.equal((await restored.agent(ctx)).tools.some(t=>['browser','subagent'].includes(t.name)),false);
  const held=defineTask<null,{phase:'wait'},null>({name:'test.module-held',version:1,initial:()=>({phase:'wait'}),phases:{wait:async()=>{throw Error('Paused fixture must not execute');}}});
  await restored.commit(tx=>tx.createTask(held,null,{ownership:{kind:'conversation'}}),ctx);
  await assert.rejects(()=>changeModule(state,runtime,'remove','web'),/Unfinished/);
  await assert.rejects(()=>selectModules(state,runtime,restored,moduleIds),/settle/);
 }finally{await runtime.close();state.close();}
});

test('authenticated module selection readback and CLI exclusive-owner guard',async()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR!,'bob-module-http-')),state=new State(dir),app=await serve(state,{port:0});
 const device=state.pair(state.invite().token,'Module test'),base=`http://127.0.0.1:${(app.server.address() as any).port}/v1`;
 const headers={authorization:'Bearer '+device.credential,'x-bob-backend':state.id,'content-type':'application/json'};
 try {
  assert.equal((await fetch(base+'/modules')).status,401);
  assert.equal((await(await fetch(base+'/modules',{headers})).json()).length,moduleIds.length);
  const created=await(await fetch(base+'/chats',{headers,method:'POST',body:JSON.stringify({title:'Modules'})})).json();
  const endpoint=base+'/chats/'+created.id+'/modules';
  const response=await fetch(endpoint,{headers,method:'PUT',body:JSON.stringify({ids:['resources']})});
  assert.equal(response.status,200,await response.clone().text());
  const observed=await(await fetch(endpoint,{headers})).json();assert.deepEqual(observed.filter((m:any)=>m.selected).map((m:any)=>m.id),['resources']);
  const blocked=spawnSync(process.execPath,['--import','tsx','src/cli.ts','--state',dir,'module','remove','web'],{encoding:'utf8'});
  assert.notEqual(blocked.status,0);assert.match(blocked.stderr,/already owned/);
 }finally{await app.close();state.close();}
 const execute=(args:string[])=>spawnSync(process.execPath,['--import','tsx','src/cli.ts','--state',dir,'module',...args],{encoding:'utf8'});
 for(const args of [['disable','web'],['remove','web'],['install','web'],['enable','web']]){const result=execute(args);assert.equal(result.status,0,result.stderr);}
 const listed=execute(['list']);assert.equal(listed.status,0);assert.equal(JSON.parse(listed.stdout).find((m:any)=>m.id==='web').defaultSelected,true);
 assert.notEqual(execute(['install','web','--version','999.0.0']).status,0);
});
