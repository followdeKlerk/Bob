import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:net';

test('supervisor rejects an unhealthy release and restarts the known-good backend without restoring state',async()=>{
 const m=await import('../src/maintenance.js') as any;
 assert.equal(typeof m.MaintenanceSupervisor,'function','External update supervisor is missing');
 const home=mkdtempSync(join(tmpdir(),'bob-supervisor-'));
 const probe=createServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));const port=(probe.address() as any).port;await new Promise<void>(r=>probe.close(()=>r()));
 const good=join(home,'good');const bad=join(home,'bad');mkdirSync(good);mkdirSync(bad);
 writeFileSync(join(good,'cli.mjs'),`import http from 'node:http';const s=http.createServer((req,res)=>{if(req.headers.authorization!=='Bearer '+process.env.BOB_HEALTH_TOKEN){res.writeHead(401);res.end();return;}res.setHeader('content-type','application/json');res.end(JSON.stringify({backendId:'test-backend',releaseId:process.env.BOB_RELEASE_ID,foreground:0}));});s.listen(${port},'127.0.0.1');process.on('SIGTERM',()=>s.close());`);
 writeFileSync(join(bad,'cli.mjs'),'process.exit(17)');
 writeFileSync(join(home,'state-sentinel'),'history must survive');
 const store=new m.MaintenanceStore(home);
 const first={id:'good',cli:join(good,'cli.mjs')};store.set('active',first);
 const supervisor=new m.MaintenanceSupervisor(home,{sourceRoot:home,stateDir:home,backendId:'test-backend',node:process.execPath,serveArgs:[],origin:`http://127.0.0.1:${port}`,healthTimeoutMs:10000},store);
 try{
  await supervisor.start(first);assert.equal((await supervisor.health()).releaseId,'good');
  await assert.rejects(supervisor.activate({id:'bad',cli:join(bad,'cli.mjs')}),/roll.*back|unhealthy/i);
  assert.equal(store.get('active').id,'good');assert.equal((await supervisor.health()).releaseId,'good');
  assert.equal((await import('node:fs')).readFileSync(join(home,'state-sentinel'),'utf8'),'history must survive');
 }finally{await supervisor.stop();store.close();rmSync(home,{recursive:true,force:true});}
});
import {join} from 'node:path';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {serve} from '../src/server.js';
import {MaintenanceStore} from '../src/maintenance.js';

test('paired update API queues idempotently, denies anonymous access and exposes native self-update tool',async()=>{
 const home=mkdtempSync(join(tmpdir(),'bob-update-api-'));const state=new State(join(home,'state'));
 const maintenance=join(home,'maintenance');const store=new MaintenanceStore(maintenance);
 writeFileSync(join(maintenance,'config.json'),JSON.stringify({sourceRoot:home,stateDir:state.dir,backendId:state.id}));state.set('maintenanceHome',maintenance);
 const runtime=await openRuntime(state),app=await serve(state,{port:0,runtime});
 const device=state.pair(state.invite().token,'Test');const base=`http://127.0.0.1:${(app.server.address() as any).port}`;
 const headers={authorization:'Bearer '+device.credential,'x-bob-backend':state.id,'content-type':'application/json'};
 try{
  assert.equal((await fetch(base+'/v1/updates')).status,401);
  const read=await fetch(base+'/v1/updates',{headers});assert.equal(read.status,200);assert.equal((await read.json()).enabled,true);
  const body=JSON.stringify({id:'ui-test',action:'build',target:'all'});
  for(let i=0;i<2;i++)assert.equal((await fetch(base+'/v1/updates',{method:'POST',headers,body})).status,202);
  assert.equal(store.jobs().length,1);
  const conversation=await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
  assert.ok((await conversation.agent(ctx)).tools.some((t:any)=>t.name==='self_update'),'Native self-update tool must be available to Bob');
  store.set('draining',true);
  assert.equal((await fetch(base+`/v1/chats/${conversation.id}/messages`,{method:'POST',headers,body:'{}'})).status,503);
 }finally{await app.close();state.close();store.close();rmSync(home,{recursive:true,force:true});}
});

import {tmpdir} from 'node:os';

test('source fingerprints ignore build output but detect actual source edits',async()=>{
 const m=await import('../src/maintenance.js') as any;
 assert.equal(typeof m.sourceFingerprint,'function','Source change protection is missing');
 const root=mkdtempSync(join(tmpdir(),'bob-build-hash-'));mkdirSync(join(root,'src'));mkdirSync(join(root,'docs'));mkdirSync(join(root,'apps/mobile/android/app/build'),{recursive:true});
 try{writeFileSync(join(root,'src/a.ts'),'one');const before=m.sourceFingerprint(root);writeFileSync(join(root,'docs/private.txt'),'private');writeFileSync(join(root,'apps/mobile/android/app/build/output'),'generated');assert.equal(m.sourceFingerprint(root),before);writeFileSync(join(root,'src/a.ts'),'two');assert.notEqual(m.sourceFingerprint(root),before);}finally{rmSync(root,{recursive:true,force:true});}
});

test('self-update requests survive reopen and duplicate admission cannot start a second build',async()=>{
 const m=await import('../src/maintenance.js').catch(()=>({} as any));
 assert.equal(typeof m.MaintenanceStore,'function','Persistent self-update queue is missing');
 const home=mkdtempSync(join(tmpdir(),'bob-self-update-'));
 try{
  let store=new m.MaintenanceStore(home);
  const request={id:'test-request-1',action:'update',target:'all',conversationId:7};
  const first=store.enqueue(request);
  assert.equal(first.status,'queued');
  assert.equal(store.enqueue(request).id,first.id);
  assert.throws(()=>store.enqueue({...request,target:'backend'}),/conflict/i);
  store.close();store=new m.MaintenanceStore(home);
  assert.equal(store.jobs().length,1);
  assert.equal(store.jobs()[0].conversationId,7);
  store.close();
 }finally{rmSync(home,{recursive:true,force:true});}
});
