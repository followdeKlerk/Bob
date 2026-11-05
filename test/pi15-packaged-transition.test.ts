import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {pathToFileURL} from 'node:url';

// Opt-in package proof. Paths select only disposable fixture installations; they
// cannot replace or enable a production transition policy. Both packages must
// already contain the reviewed compiled pins, and use their actual native deps.
const configured=process.env.BOB_PI15_PACKAGE_FIXTURES;
const fixturePackages=configured?JSON.parse(readFileSync(configured,'utf8')):undefined;
for(const boundary of ['complete','before-floor','commit-before-phase','native-write-before-health'])test(`actual packaged Pi 1.4 bridge to Pi 1.5: ${boundary}`,{skip:!configured,timeout:120000},async()=>{
 const {bridgeRoot,targetRoot,from,to}=fixturePackages;
 assert.equal(JSON.parse(readFileSync(join(bridgeRoot,'package.json'),'utf8')).dependencies['@earendil-works/pi-durable'],'1.4.0');
 assert.equal(JSON.parse(readFileSync(join(targetRoot,'package.json'),'utf8')).dependencies['@earendil-works/pi-durable'],'1.5.0');
 const url=(root:string,file:string)=>pathToFileURL(join(root,'dist',file+'.js')).href;
 const bridge=await import(url(bridgeRoot,'maintenance'));
 const policy=await import(url(bridgeRoot,'maintenance-migration'));
 policy.assertPi15Pair(from,to);
 const root=mkdtempSync(join(tmpdir(),'bob-real-pi15-')),stateDir=join(root,'state'),home=join(root,'maintenance');mkdirSync(home);
 const init=join(root,'init.mjs');
 writeFileSync(init,`import {State} from ${JSON.stringify(url(bridgeRoot,'state'))};import {openRuntime,ctx} from ${JSON.stringify(url(bridgeRoot,'runtime'))};import {ChatMeta} from ${JSON.stringify(url(bridgeRoot,'documents'))};
 const s=new State(${JSON.stringify(stateDir)});s.set('cwd',s.dir);s.set('openaiKey','synthetic-never-used');const device=s.pair(s.invite().token,'Synthetic fixture');const r=await openRuntime(s);try{const c=await r.harness.createConversation({ownership:{kind:'ownerless'}},ctx);s.set('fixtureChat',c.id);const ids=await c.commit(async tx=>{const ids=[];for(let i=0;i<241;i++)ids.push((await tx.appendEntry(c.id,{kind:'bob.user',data:{text:'Fixture '+i}})).id);(await tx.doc(ChatMeta,c.id)).title='Preserved migration fixture';return ids;},ctx);console.log(JSON.stringify({backendId:s.id,conversationId:c.id,credential:device.credential,ids}));}finally{await r.close();s.close();}`);
 const meta=JSON.parse(execFileSync(process.execPath,[init],{encoding:'utf8',timeout:30000}).trim());
 const net=createServer();await new Promise<void>(resolve=>net.listen(0,'127.0.0.1',resolve));const port=(net.address() as any).port;await new Promise<void>(resolve=>net.close(()=>resolve()));
 const previous={id:'bridge',cli:join(bridgeRoot,'dist/cli.js'),compatibility:from,durableVersion:'1.4.0',sourceHash:'fixture-bridge'};
 const candidate={id:'target',cli:join(targetRoot,'dist/cli.js'),compatibility:to,durableVersion:'1.5.0',sourceHash:'fixture-target'};
 if(boundary==='native-write-before-health'){
  candidate.cli=join(targetRoot,'dist/pi15-crash-fixture.js');
  writeFileSync(candidate.cli,`import{existsSync,writeFileSync}from'node:fs';import{join}from'node:path';import{State}from'./state.js';import{openRuntime,ctx}from'./runtime.js';import{LiveDoc}from'@earendil-works/pi-durable';const directory=process.argv[process.argv.indexOf('--state')+1],flag=join(directory,'native-write-complete');if(!existsSync(flag)){const s=new State(directory),r=await openRuntime(s);try{const c=await r.harness.conversation(s.get('fixtureChat'),ctx);await c.commit(async tx=>{await tx.doc(LiveDoc,c.id);await tx.appendEntry(c.id,{kind:'bob.fixture-upgrade',data:{written:true}});},ctx);}finally{await r.close();s.close();}writeFileSync(flag,'1');process.exit(87);}else await import('./cli.js');`);
 }
 const store=new bridge.MaintenanceStore(home);store.set('active',previous);store.set('previous',candidate);
 writeFileSync(join(home,'config.json'),JSON.stringify({sourceRoot:root,stateDir,backendId:meta.backendId,node:process.execPath,serveArgs:['--state',stateDir,'serve','--port',String(port)],origin:`http://127.0.0.1:${port}`,healthTimeoutMs:15000}));
 let runner:ReturnType<typeof spawn>|undefined,diagnostics='';
 const launch=()=>{runner=spawn(process.execPath,[join(bridgeRoot,'dist/maintenance-loader.js'),home],{stdio:['ignore','pipe','pipe']});runner.stderr!.on('data',chunk=>diagnostics+=String(chunk));return runner;};
 const wait=async(predicate:()=>boolean)=>{const end=Date.now()+30000;while(!predicate()){if(runner?.exitCode!==null)assert.fail('Runner exited: '+diagnostics);if(Date.now()>end)assert.fail('Packaged fixture condition timeout: '+diagnostics);await new Promise(r=>setTimeout(r,50));}};
 const stop=async()=>{if(runner&&runner.exitCode===null&&runner.signalCode===null){const exited=once(runner,'exit');runner.kill('SIGTERM');await exited;}};
 try{
  if(boundary==='before-floor'||boundary==='commit-before-phase'){
   const intent={protocol:'bob-pi15-v1',previous,candidate,phase:'intent'};store.set('migrationIntent',intent);store.set('transition',{previous,candidate});
   if(boundary==='commit-before-phase'){
    const crash=join(root,'crash.mjs');writeFileSync(crash,`import{MaintenanceStore}from ${JSON.stringify(url(bridgeRoot,'maintenance'))};import{preparePi15Floor}from ${JSON.stringify(url(bridgeRoot,'maintenance-migration'))};const s=new MaintenanceStore(${JSON.stringify(home)}),set=s.set.bind(s);s.set=(k,v)=>{if(k==='migrationIntent'&&v.phase==='floor-committed')process.exit(86);set(k,v);};preparePi15Floor(${JSON.stringify(home)},${JSON.stringify(stateDir)},s,s.get('migrationIntent'));`);
    const child=spawn(process.execPath,[crash],{stdio:['ignore','pipe','pipe']});let errors='';child.stderr.on('data',c=>errors+=String(c));assert.equal((await once(child,'exit'))[0],86,errors);
    assert.equal(store.get('migrationIntent').phase,'backed-up');assert.equal(policy.readControlFloor(stateDir).kind,'pi15');
   }
  }else store.enqueue({id:'activate-target',action:'rollback',target:'backend'}); // Activates the staged release through the real runner, without rebuilding packages.
  launch();
  if(boundary!=='before-floor'){
   const [exit]=await once(runner!,'exit');assert.equal(exit,boundary==='native-write-before-health'?1:0,diagnostics);
   if(boundary==='native-write-before-health'){
    assert.ok(existsSync(join(stateDir,'native-write-complete')));assert.equal(policy.readControlFloor(stateDir).kind,'pi15');
    assert.equal(store.get('active').id,'bridge','failed first activation never relabels an unhealthy candidate');
   }
   launch();
   // Interrupted recovery first starts target through old bridge, then hands off.
   if(boundary==='native-write-before-health'){assert.equal((await once(runner!,'exit'))[0],0,diagnostics);launch();}
  }
  const expected=boundary==='before-floor'?'bridge':'target';
  await wait(()=>store.get('supervisorEvidence')?.release.id===expected&&store.get('supervisorEvidence')?.pid===runner?.pid);
  assert.equal(store.get('active').id,expected);assert.equal(policy.runningBridge(store.get('supervisorEvidence'),store.get('active')),true);
  const response=await fetch(`http://127.0.0.1:${port}/v1/chats/${meta.conversationId}`,{headers:{authorization:'Bearer '+meta.credential,'x-bob-backend':meta.backendId}});assert.equal(response.status,200);
  const payload=await response.json() as any;assert.equal(payload.backendId,meta.backendId);const ids=new Set(payload.view.entries.map((e:any)=>e.id));for(const id of meta.ids)assert.ok(ids.has(id),'original native entry missing');
  assert.equal(payload.view.entries.filter((e:any)=>e.kind==='bob.fixture-upgrade').length,boundary==='native-write-before-health'?1:0);
  await stop();
  if(boundary==='before-floor'){assert.equal(policy.readControlFloor(stateDir).kind,'legacy');assert.equal(store.get('migrationIntent'),null);}
  else{
   const before=['control.sqlite','durable.sqlite'].map(name=>readFileSync(join(stateDir,name)));
   assert.throws(()=>execFileSync(process.execPath,[previous.cli,'--state',stateDir,'setup','--cwd',root],{stdio:'pipe'}),/Unsupported newer control schema/);
   for(const [i,name]of ['control.sqlite','durable.sqlite'].entries())assert.deepEqual(readFileSync(join(stateDir,name)),before[i]);
   assert.throws(()=>policy.assertReleaseFloor(policy.readControlFloor(stateDir),previous,store.get('migrationIntent')),/forbids/);
  }
 }finally{await stop();store.close();rmSync(root,{recursive:true,force:true});}
});

test('actual packages recover interrupted native tool/codemode exactly once and retain a sleeping schedule',{skip:!configured,timeout:120000},async()=>{
 const {bridgeRoot,targetRoot,from,to}=fixturePackages;
 const policy=await import(pathToFileURL(join(bridgeRoot,'dist/maintenance-migration.js')).href);
 const {MaintenanceStore}=await import(pathToFileURL(join(bridgeRoot,'dist/maintenance.js')).href);
 const root=mkdtempSync(join(tmpdir(),'bob-real-inflight-')),stateDir=join(root,'state'),home=join(root,'maintenance');mkdirSync(stateDir);
 const source=readFileSync(new URL('./fixtures/pi15-inflight.mjs',import.meta.url),'utf8');
 for(const packageRoot of [bridgeRoot,targetRoot])writeFileSync(join(packageRoot,'dist/pi15-inflight-fixture.mjs'),source);
 const run=(packageRoot:string,mode:string)=>JSON.parse(execFileSync(process.execPath,[join(packageRoot,'dist/pi15-inflight-fixture.mjs'),mode,stateDir],{encoding:'utf8',timeout:60000}).trim().split('\n').at(-1)!);
 let store:any;
 try{
  const before=run(bridgeRoot,'legacy');assert.equal(before.oneNativeSideEffect,true);
  store=new MaintenanceStore(home);
  const previous={id:'bridge',cli:join(bridgeRoot,'dist/cli.js'),compatibility:from,durableVersion:'1.4.0'};
  const candidate={id:'target',cli:join(targetRoot,'dist/cli.js'),compatibility:to,durableVersion:'1.5.0'};
  const intent={protocol:'bob-pi15-v1',previous,candidate,phase:'intent'};store.set('migrationIntent',intent);
  policy.preparePi15Floor(home,stateDir,store,intent);
  const after=run(targetRoot,'upgrade');
  assert.equal(after.nativeToolAndCodemodeRecovery,true);assert.equal(after.sideEffectCount,1);assert.equal(after.surfaceIdPreserved,true);assert.equal(after.sleepingBackgroundSchedulePreserved,true);assert.equal(after.toolResultSuccess,true);
 }finally{store?.close();rmSync(root,{recursive:true,force:true});}
});

test('actual packaged Pi 1.5 cold supervisor bootstraps control-only state',{skip:!configured,timeout:60000},async()=>{
 const {targetRoot,to}=fixturePackages;
 const {MaintenanceStore}=await import(pathToFileURL(join(targetRoot,'dist/maintenance.js')).href);
 const policy=await import(pathToFileURL(join(targetRoot,'dist/maintenance-migration.js')).href);
 const root=mkdtempSync(join(tmpdir(),'bob-real-fresh-')),stateDir=join(root,'state'),home=join(root,'maintenance');mkdirSync(home);
 const cli=join(targetRoot,'dist/cli.js'),meta=JSON.parse(execFileSync(process.execPath,[cli,'--state',stateDir,'setup','--cwd',root],{encoding:'utf8',timeout:15000}));
 assert.equal(existsSync(join(stateDir,'durable.sqlite')),false);
 const net=createServer();await new Promise<void>(resolve=>net.listen(0,'127.0.0.1',resolve));const port=(net.address() as any).port;await new Promise<void>(resolve=>net.close(()=>resolve()));
 const store=new MaintenanceStore(home),active={id:'fresh',cli,compatibility:to,durableVersion:'1.5.0',sourceHash:'fresh-fixture'};store.set('active',active);
 writeFileSync(join(home,'config.json'),JSON.stringify({sourceRoot:root,stateDir,backendId:meta.backendId,node:process.execPath,serveArgs:['--state',stateDir,'serve','--port',String(port)],origin:`http://127.0.0.1:${port}`,healthTimeoutMs:15000}));
 const runner=spawn(process.execPath,[join(targetRoot,'dist/maintenance-loader.js'),home],{stdio:['ignore','pipe','pipe']});let diagnostics='';runner.stderr.on('data',c=>diagnostics+=String(c));
 try{
  const until=Date.now()+25000;while(store.get('supervisorEvidence')?.pid!==runner.pid){if(runner.exitCode!==null)assert.fail(diagnostics);if(Date.now()>until)assert.fail('Cold package timeout: '+diagnostics);await new Promise(r=>setTimeout(r,50));}
  assert.equal(policy.readControlFloor(stateDir).kind,'pi15-fresh');assert.equal(store.get('migrationIntent'),undefined);assert.equal(policy.runningBridge(store.get('supervisorEvidence'),active),true);
 }finally{if(runner.exitCode===null&&runner.signalCode===null){const exited=once(runner,'exit');runner.kill('SIGTERM');await exited;}store.close();rmSync(root,{recursive:true,force:true});}
});
