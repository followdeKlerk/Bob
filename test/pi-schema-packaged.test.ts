import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync,realpathSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn,execFileSync,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';

// Explicit opt-in only: JSON file containing {oldRoot,bridgeRoot,targetRoot}.
// All three are already installed real packages. They are READ ONLY to this
// proof; scripts, journal, state, crash candidates and backups live under mkdtemp.
// No production state, credentials, provider calls, builds, or service restarts.
const configured=process.env.BOB_SCHEMA_PACKAGE_FIXTURES;
const fixtures=configured?JSON.parse(readFileSync(configured,'utf8')):undefined;
const canonical='5c798ab849e5ebf456f1aa4da70f8ef88f87af72bd8e709292083776ba1d0b45';
const legacy='328bbd2b3ec5505199382f781d7dc2dc5359e17b8356c92daef8be53155f8003';
const script=new URL('./fixtures/pi-schema-inflight.mjs',import.meta.url).pathname;
const url=(root:string,file:string)=>pathToFileURL(join(root,'dist',file+'.js')).href;
const release=(root:string,id:string)=>({id,cli:join(root,'dist/cli.js'),compatibility:canonical,durableVersion:'1.5.0',sourceHash:'fixture-'+id});
function packages(){
 const roots=fixtures as {oldRoot:string;bridgeRoot:string;targetRoot:string};
 for(const root of Object.values(roots)){
  assert.equal(typeof root,'string');assert.ok(isAbsolute(root));
  const manifest=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
  assert.equal(manifest.name,'@bob-local/cli');
  for(const name of ['@earendil-works/pi-durable','@earendil-works/pi-ai','@earendil-works/chord'])assert.equal(manifest.dependencies[name],'1.5.0');
  for(const file of ['cli','runtime','maintenance','maintenance-runner','maintenance-loader','maintenance-migration'])assert.ok(existsSync(join(root,'dist',file+'.js')));
 }
 assert.equal(new Set(Object.values(roots).map(root=>realpathSync(root))).size,3,'select three distinct installations');
 assert.ok(JSON.parse(readFileSync(join(roots.oldRoot,'package.json'),'utf8')).dependencies.typebox,'old package must retain TypeBox');
 assert.equal(JSON.parse(readFileSync(join(roots.targetRoot,'package.json'),'utf8')).dependencies['@earendil-works/pi-schema'],'1.5.0');
 return roots;
}
function run(root:string,mode:string,stateDir:string){
 return JSON.parse(execFileSync(process.execPath,['--experimental-import-meta-resolve',script,root,mode,stateDir],{encoding:'utf8',timeout:60000,env:{...process.env,HOME:stateDir}}).trim().split('\n').at(-1)!);
}
function floorRow(stateDir:string){
 const db=new DatabaseSync(join(stateDir,'control.sqlite'),{readOnly:true});
 try{return {version:db.prepare('PRAGMA user_version').get(),schema:db.prepare("SELECT sql FROM sqlite_master WHERE name='maintenance_runtime_floor'").get(),rows:db.prepare('SELECT * FROM maintenance_runtime_floor').all()};}finally{db.close();}
}
async function bootstrap(root:string,oldRoot:string){
 const stateDir=join(root,'state'),home=join(root,'maintenance');mkdirSync(stateDir);mkdirSync(home);
 const meta=run(oldRoot,'bootstrap',stateDir);
 const policy=await import(url(oldRoot,'maintenance-migration'));
 const {MaintenanceStore}=await import(url(oldRoot,'maintenance'));
 const store=new MaintenanceStore(home),old=release(oldRoot,'original-pi15');
 // A historical Pi1.4 descriptor is required by the ORIGINAL migration pins,
 // but is deliberately not an executable package and can never be started.
 const forbidden=join(root,'forbidden-pi14.js'),marker=join(root,'pi14-was-started');
 writeFileSync(forbidden,`require('node:fs').writeFileSync(${JSON.stringify(marker)},'forbidden');process.exit(99);`);
 const previous={id:'historical-pi14',cli:forbidden,compatibility:legacy,durableVersion:'1.4.0'};
 const intent={protocol:'bob-pi15-v1',previous,candidate:old,phase:'intent'};
 store.set('migrationIntent',intent);policy.preparePi15Floor(home,stateDir,store,intent);
 store.set('migrationIntent',{...store.get('migrationIntent'),phase:'complete'});
 assert.equal(policy.readControlFloor(stateDir).kind,'pi15');
 const originalIntent=store.get('migrationIntent'),originalFloor=floorRow(stateDir);
 const unchanged=()=>{
  assert.deepEqual(floorRow(stateDir),originalFloor,'schema-only transition rewrote original control floor');
  assert.deepEqual(store.get('migrationIntent'),originalIntent,'schema-only transition rewrote historical migration intent');
  assert.equal(existsSync(marker),false,'Pi1.4 must never be spawned');
  assert.throws(()=>policy.assertReleaseFloor(policy.readControlFloor(stateDir),previous,originalIntent),/forbids/);
 };
 return {stateDir,home,meta,store,policy,old,unchanged};
}

for(const direction of ['old-to-new','new-to-old'])test(`installed schema conversion recovers interrupted native tool/codemode ${direction}`,{skip:!configured,timeout:150000},async()=>{
 const {oldRoot,targetRoot}=packages(),root=mkdtempSync(join(tmpdir(),'bob-schema-native-'));
 let f:Awaited<ReturnType<typeof bootstrap>>|undefined;
 try{
  f=await bootstrap(root,oldRoot);
  const from=direction==='old-to-new'?oldRoot:targetRoot,to=direction==='old-to-new'?targetRoot:oldRoot;
  const before=run(from,'interrupt',f.stateDir);assert.equal(before.oneNativeSideEffect,true);f.unchanged();
  const after=run(to,'recover',f.stateDir);
  assert.deepEqual(after,{nativeToolAndCodemodeRecovery:true,sideEffectCount:1,surfacePreserved:true,sleepingBackgroundSchedulePreserved:true,exactSettingsAndIds:true,conversationId:before.conversationId});f.unchanged();
  // Reopen on the writing side too: no hidden one-way native repair or replay.
  assert.deepEqual(run(from,'verify',f.stateDir),after);f.unchanged();
 }finally{f?.store.close();rmSync(root,{recursive:true,force:true});}
});

for(const boundary of ['two-stage-handoff','failed-candidate','interrupted-transition'])test(`installed schema conversion supervisor: ${boundary}`,{skip:!configured,timeout:150000},async()=>{
 const {oldRoot,bridgeRoot,targetRoot}=packages(),root=mkdtempSync(join(tmpdir(),'bob-schema-supervisor-'));
 let f:Awaited<ReturnType<typeof bootstrap>>|undefined,runner:ChildProcess|undefined,diagnostics='';
 const stop=async()=>{if(runner&&runner.exitCode===null&&runner.signalCode===null){const exited=once(runner,'exit');runner.kill('SIGTERM');await exited;}};
 try{
  f=await bootstrap(root,oldRoot);const {store,stateDir,home,meta}=f;
  // Only settled faux-provider work and a future sleeping reminder enter serve.
  run(oldRoot,'interrupt',stateDir);run(oldRoot,'recover',stateDir);
  const nativeMeta=JSON.parse(readFileSync(join(stateDir,'schema-inflight.json'),'utf8'));
  const bridge=release(bridgeRoot,'schema-bridge'),target=release(targetRoot,'schema-target');
  const net=createServer();await new Promise<void>(resolve=>net.listen(0,'127.0.0.1',resolve));
  const port=(net.address() as any).port;await new Promise<void>(resolve=>net.close(()=>resolve()));
  writeFileSync(join(home,'config.json'),JSON.stringify({sourceRoot:root,stateDir,backendId:meta.backendId,node:process.execPath,serveArgs:['--state',stateDir,'serve','--port',String(port)],origin:`http://127.0.0.1:${port}`,healthTimeoutMs:10000}));
  const launch=()=>{
   runner=spawn(process.execPath,[join(oldRoot,'dist/maintenance-loader.js'),home],{cwd:root,env:{...process.env,HOME:stateDir},stdio:['ignore','pipe','pipe']});
   runner.stderr!.on('data',c=>diagnostics+=String(c));runner.stdout!.on('data',c=>diagnostics+=String(c));return runner;
  };
  const wait=async(predicate:()=>boolean)=>{
   const until=Date.now()+30000;
   while(!predicate()){
    if(runner&&(runner.exitCode!==null||runner.signalCode!==null))assert.fail('Runner exited: '+diagnostics);
    if(Date.now()>until)assert.fail('Package supervisor timeout: '+diagnostics+'\n'+(existsSync(join(home,'backend.log'))?readFileSync(join(home,'backend.log'),'utf8'):''));
    await new Promise(r=>setTimeout(r,40));
   }
  };
  const healthy=async(expected:ReturnType<typeof release>)=>{
   await wait(()=>store.get('supervisorEvidence')?.pid===runner?.pid&&store.get('supervisorEvidence')?.release.id===expected.id);
   assert.deepEqual(store.get('active'),expected);
   assert.equal(f!.policy.runningBridge(store.get('supervisorEvidence'),expected),true);f!.unchanged();
   const response=await fetch(`http://127.0.0.1:${port}/v1/chats/${nativeMeta.conversationId}`,{headers:{authorization:'Bearer '+meta.credential,'x-bob-backend':meta.backendId},signal:AbortSignal.timeout(5000)});
   assert.equal(response.status,200);const body=await response.json() as any;assert.equal(body.backendId,meta.backendId);
   for(const id of nativeMeta.ids)assert.ok(body.view.entries.some((e:any)=>e.id===id),'native entry ID missing from served package');
   return body;
  };
  if(boundary==='two-stage-handoff'){
   store.set('active',f.old);store.set('previous',bridge);store.enqueue({id:'stage-bridge',action:'rollback',target:'backend'});
   launch();assert.equal((await once(runner!,'exit'))[0],0,diagnostics);
   assert.equal(store.job('stage-bridge').status,'complete');assert.deepEqual(store.get('active'),bridge);f.unchanged();
   launch();await healthy(bridge);
   // Fresh proof belongs to the actual bridge runner before target activation.
   const bridgePid=runner!.pid;store.set('previous',target);store.enqueue({id:'stage-target',action:'rollback',target:'backend'});
   assert.equal((await once(runner!,'exit'))[0],0,diagnostics);assert.equal(store.job('stage-target').status,'complete');f.unchanged();
   launch();await healthy(target);assert.notEqual(runner!.pid,bridgePid);assert.deepEqual(store.get('previous'),bridge);
  }else if(boundary==='failed-candidate'){
   const badRoot=join(root,'failed-package'),badCli=join(badRoot,'dist/cli.js');mkdirSync(join(badRoot,'dist'),{recursive:true});
   writeFileSync(join(badRoot,'package.json'),readFileSync(join(targetRoot,'package.json')));
   // A real native write by target code before failing health. The rollback
   // must retain it; no database restore or Pi1.4 fallback is permitted.
   writeFileSync(badCli,`import{writeFileSync}from'node:fs';import{State}from ${JSON.stringify(url(targetRoot,'state'))};import{openRuntime,ctx}from ${JSON.stringify(url(targetRoot,'runtime'))};const s=new State(${JSON.stringify(stateDir)}),r=await openRuntime(s,undefined,undefined,{resume:false});try{const c=await r.harness.conversation(${nativeMeta.conversationId},ctx);await c.commit(tx=>tx.appendEntry(c.id,{kind:'bob.schema-candidate-write',data:{retained:true}}),ctx);}finally{await r.close();s.close();}writeFileSync(${JSON.stringify(join(stateDir,'candidate-wrote'))},'1');process.exit(87);`);
   const bad={...target,id:'failed-target',cli:badCli};store.set('active',bridge);store.set('previous',bad);
   launch();await healthy(bridge);const pid=runner!.pid;store.enqueue({id:'failed-target',action:'rollback',target:'backend'});
   await wait(()=>store.job('failed-target')?.status==='failed');assert.match(store.job('failed-target').error,/Unhealthy candidate rolled back/);
   assert.equal(runner!.pid,pid);assert.equal(existsSync(join(stateDir,'candidate-wrote')),true);
   const body=await healthy(bridge);assert.equal(body.view.entries.filter((e:any)=>e.kind==='bob.schema-candidate-write').length,1);assert.equal(store.get('transition'),null);
  }else{
   // Crash after active changed but before transition was cleared: compatible
   // previous Pi1.5 wins, not the historical Pi1.4 migration predecessor.
   store.set('active',target);store.set('transition',{previous:bridge,candidate:target});
   store.enqueue({id:'interrupted',action:'rollback',target:'backend'});store.patch('interrupted',{status:'activating'});
   launch();assert.equal((await once(runner!,'exit'))[0],0,diagnostics);
   assert.deepEqual(store.get('active'),bridge);assert.equal(store.get('transition'),null);assert.equal(store.job('interrupted').status,'failed');f.unchanged();
   launch();await healthy(bridge);
  }
  await stop();assert.equal(run(targetRoot,'verify',stateDir).exactSettingsAndIds,true);assert.equal(run(oldRoot,'verify',stateDir).sideEffectCount,1);f.unchanged();
 }finally{await stop();f?.store.close();rmSync(root,{recursive:true,force:true});}
});
