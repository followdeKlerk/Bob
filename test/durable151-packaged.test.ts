import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,cpSync,existsSync,readdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn,execFileSync,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {pathToFileURL} from 'node:url';

// Explicit installed-package evidence, separate from default synthetic fixtures.
// No production state/services/providers and no writes to these installations.
const configured=process.env.BOB_PI151_PACKAGE_FIXTURES;
const packages=configured?JSON.parse(readFileSync(configured,'utf8')):undefined;
const url=(root:string,name:string)=>pathToFileURL(join(root,'dist',name+'.js')).href;

for(const boundary of ['complete','native-write-before-health'] as const)test(`installed old loader -> 1.5.0 bridge -> 1.5.1 forward-only handoff: ${boundary}`,{skip:!configured,timeout:150000},async()=>{
 const {oldRoot,bridgeRoot,targetRoot}=packages as {oldRoot:string;bridgeRoot:string;targetRoot:string};
 for(const [root,version]of [[oldRoot,'1.5.0'],[bridgeRoot,'1.5.0'],[targetRoot,'1.5.1']])assert.equal(JSON.parse(readFileSync(join(root,'package.json'),'utf8')).dependencies['@earendil-works/pi-durable'],version);
 const old=await import(url(oldRoot,'maintenance')),bridge=await import(url(bridgeRoot,'maintenance')),policy=await import(url(bridgeRoot,'maintenance-migration'));
 // The PRE-BRIDGE code decides whether it can build the first bridge. Testing
 // activation descriptors alone misses its source-fingerprint gate.
 assert.equal(old.compatibilityFingerprint(packages.bridgeSourceRoot),policy.pi150Fingerprint,'running pre-bridge build policy must accept the actual bridge source');
 assert.equal(bridge.compatibilityFingerprint(packages.targetSourceRoot),policy.pi151Fingerprint,'reviewed target source must match compiled transition pin');
 const root=mkdtempSync(join(tmpdir(),'bob-pi151-packaged-')),stateDir=join(root,'state'),home=join(root,'maintenance');mkdirSync(home);
 const seed=join(root,'seed.mjs');
 writeFileSync(seed,`import {State} from ${JSON.stringify(url(oldRoot,'state'))};import {openRuntime,ctx} from ${JSON.stringify(url(oldRoot,'runtime'))};import {ChatMeta} from ${JSON.stringify(url(oldRoot,'documents'))};const state=new State(${JSON.stringify(stateDir)});state.set('cwd',state.dir);const device=state.pair(state.invite().token,'Synthetic package fixture'),runtime=await openRuntime(state);try{const chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx);const ids=await chat.commit(async tx=>{const ids=[];for(let i=0;i<241;i++)ids.push((await tx.appendEntry(chat.id,{kind:'bob.user',data:{text:'Synthetic retained '+i}})).id);(await tx.doc(ChatMeta,chat.id)).title='Retained package fixture';return ids;},ctx);state.set('fixtureChat',chat.id);console.log(JSON.stringify({backendId:state.id,conversationId:chat.id,credential:device.credential,ids}));}finally{await runtime.close();state.close();}`);
 const meta=JSON.parse(execFileSync(process.execPath,[seed],{encoding:'utf8',timeout:30000}).trim());
 const net=createServer();await new Promise<void>(resolve=>net.listen(0,'127.0.0.1',resolve));const port=(net.address() as any).port;await new Promise<void>(resolve=>net.close(()=>resolve()));
 const config={sourceRoot:root,stateDir,backendId:meta.backendId,node:process.execPath,serveArgs:['--state',stateDir,'serve','--port',String(port)],origin:`http://127.0.0.1:${port}`,healthTimeoutMs:10000};writeFileSync(join(home,'config.json'),JSON.stringify(config));
 const initial={id:'original',cli:join(oldRoot,'dist/cli.js'),compatibility:'5c798ab849e5ebf456f1aa4da70f8ef88f87af72bd8e709292083776ba1d0b45',durableVersion:'1.5.0',sourceHash:'fixture-original'};
 const bridgeRelease={id:'bridge',cli:join(bridgeRoot,'dist/cli.js'),compatibility:policy.pi150Fingerprint,durableVersion:'1.5.0',sourceHash:'fixture-bridge'};
 const target={id:'target',cli:join(targetRoot,'dist/cli.js'),compatibility:policy.pi151Fingerprint,durableVersion:'1.5.1',sourceHash:'fixture-target'};
 assert.equal(bridgeRelease.compatibility,initial.compatibility);assert.notEqual(target.compatibility,initial.compatibility);
 if(boundary==='native-write-before-health'){
  const isolated=join(root,'target');mkdirSync(isolated);cpSync(join(targetRoot,'dist'),join(isolated,'dist'),{recursive:true});cpSync(join(targetRoot,'package.json'),join(isolated,'package.json'));const {symlinkSync}=await import('node:fs');
  // Installed bundled workspace packages resolve from this exact target tree.
  const modules=join(isolated,'node_modules');mkdirSync(modules);
  const linkModules=(source:string)=>{if(!existsSync(source))return;for(const name of readdirSync(source)){if(name.startsWith('@')){mkdirSync(join(modules,name),{recursive:true});for(const child of readdirSync(join(source,name))){const dest=join(modules,name,child);if(!existsSync(dest))symlinkSync(join(source,name,child),dest,'dir');}}else{const dest=join(modules,name);if(!existsSync(dest))symlinkSync(join(source,name),dest,'dir');}}};
  linkModules(join(targetRoot,'node_modules'));linkModules(dirname(dirname(targetRoot)));
  target.cli=join(isolated,'dist/fail-once.js');writeFileSync(target.cli,`import{existsSync,writeFileSync}from'node:fs';import{join}from'node:path';import{State}from'./state.js';import{openRuntime,ctx}from'./runtime.js';const dir=process.argv[process.argv.indexOf('--state')+1],flag=join(dir,'candidate-wrote-state');if(!existsSync(flag)){const s=new State(dir),r=await openRuntime(s);try{const c=await r.harness.conversation(s.get('fixtureChat'),ctx);await c.commit(async tx=>{await tx.appendEntry(c.id,{kind:'bob.pi151-fixture',data:{written:true}});},ctx);}finally{await r.close();s.close();}writeFileSync(flag,'1');process.exit(87);}else await import('./cli.js');`);
 }
 const store=new old.MaintenanceStore(home);store.set('active',initial);store.set('previous',bridgeRelease);store.enqueue({id:'activate-bridge',action:'rollback',target:'backend'});
 let runner:ChildProcess|undefined,errors='';
 const launch=()=>{runner=spawn(process.execPath,[join(oldRoot,'dist/maintenance-loader.js'),home],{stdio:['ignore','pipe','pipe'],env:{...process.env,NODE_OPTIONS:''}});runner.stderr!.on('data',c=>errors+=String(c));return runner;};
 const stop=async()=>{if(runner&&runner.exitCode===null&&runner.signalCode===null){const exited=once(runner,'exit');runner.kill('SIGTERM');await exited;}};
 const ready=async(id:string)=>{const until=Date.now()+30000;while(Date.now()<until){if(runner?.exitCode!==null)assert.fail('runner exited before ready: '+errors);if(store.get('supervisorEvidence')?.release.id===id&&store.get('active')?.id===id)return;await new Promise(r=>setTimeout(r,50));}assert.fail('runner ready timeout: '+errors);};
 const response=async()=>{const r=await fetch(config.origin+`/v1/chats/${meta.conversationId}`,{headers:{authorization:'Bearer '+meta.credential,'x-bob-backend':meta.backendId}});assert.equal(r.status,200);return r.json() as Promise<any>;};
 try{
  launch();assert.equal((await once(runner!,'exit'))[0],0,errors);launch();await ready('bridge');
  assert.equal(policy.runningBridge(store.get('supervisorEvidence'),store.get('active')),true);
  const originalFloor=policy.readControlFloor(stateDir);assert.equal(originalFloor.kind,'pi15-fresh');
  store.set('previous',target);store.enqueue({id:'activate-target',action:'rollback',target:'backend'});
  const [exit]=await once(runner!,'exit');assert.equal(exit,boundary==='complete'?0:1,errors);
  launch();
  if(boundary==='native-write-before-health'){assert.equal((await once(runner!,'exit'))[0],0,errors);launch();}
  await ready('target');const payload=await response(),ids=new Set(payload.view.entries.map((e:any)=>e.id));for(const id of meta.ids)assert.ok(ids.has(id),'native history lost in package handoff');
  assert.equal(payload.view.entries.filter((e:any)=>e.kind==='bob.pi151-fixture').length,boundary==='native-write-before-health'?1:0);
  assert.equal(policy.readControlFloor(stateDir).minDurable,'1.5.1');
  assert.equal(store.get('active').durableVersion,'1.5.1');assert.equal(store.get('supervisorEvidence').release.id,'target');
  await stop();
  const bytes=['control.sqlite','durable.sqlite'].map(name=>readFileSync(join(stateDir,name)));
  assert.throws(()=>execFileSync(process.execPath,[initial.cli,'--state',stateDir,'setup','--cwd',root],{stdio:'pipe',timeout:10000}),/Command failed/);
  // The upgraded bridge understands floor 4 for supervision, but its installed
  // 1.5.0 State must still refuse BEFORE opening a writer or changing config.
  const oldBridgeState=join(root,'reject-bridge-state.mjs');writeFileSync(oldBridgeState,`import {State} from ${JSON.stringify(url(bridgeRoot,'state'))};new State(${JSON.stringify(stateDir)});throw Error('UNSAFE bridge State opened');`);
  try{execFileSync(process.execPath,[oldBridgeState],{stdio:'pipe',timeout:10000});assert.fail('bridge State accepted newer runtime floor');}catch(error){assert.match(String((error as any).stderr),/1\.5\.1.*forbids.*1\.5\.0/);}
  assert.throws(()=>policy.assertReleaseFloor(policy.readControlFloor(stateDir),bridgeRelease,store.get('migrationIntent')),/forbid|floor|1\.5\.1/i);
  for(const [i,name]of ['control.sqlite','durable.sqlite'].entries())assert.deepEqual(readFileSync(join(stateDir,name)),bytes[i],'old runtime modified newer state');
 }finally{await stop();store.close();rmSync(root,{recursive:true,force:true});}
});
