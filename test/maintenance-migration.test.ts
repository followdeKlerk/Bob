import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {transformSync} from 'esbuild';
import {State} from '../src/state.js';
import {State as Pi14State} from './fixtures/pi14-state.js';
import {acquireOwner} from '../src/ownership.js';
import * as disabled from '../src/maintenance-migration.js';
import {MaintenanceStore} from '../src/maintenance.js';
import {updateStatus} from '../src/maintenance-port.js';

const from='a'.repeat(64),to='b'.repeat(64),other='c'.repeat(64);
// Positive crossing tests compile a DISPOSABLE COPY with synthetic pins. No runtime
// seam, request, env var or exported mutable allowlist can enable production policy.
const stage=mkdtempSync(join(tmpdir(),'bob-bridge-policy-'));
after(()=>rmSync(stage,{recursive:true,force:true}));
writeFileSync(join(stage,'package.json'),'{"type":"module"}');
for(const file of ['maintenance.ts','maintenance-migration.ts','ownership.ts','maintenance-build.ts','maintenance-ui.ts','maintenance-runner.ts','maintenance-loader.ts']){
 let source=readFileSync(new URL('../src/'+file,import.meta.url),'utf8');
 if(file==='maintenance-migration.ts'){
  const before=source;
  source=source.replace(/(const pi15Transitions[^\n]*=)Object\.freeze\([^\n]*\);/,`$1Object.freeze([{from:'${from}',to:'${to}'}]);`);
  assert.notEqual(source,before,'review private test pin seam if production declaration changes');
 }
 writeFileSync(join(stage,file),source);
 writeFileSync(join(stage,file.replace(/\.ts$/,'.js')),transformSync(source,{loader:'ts',format:'esm',target:'node24'}).code);
}
const enabled=await import(pathToFileURL(join(stage,'maintenance-migration.ts')).href);
const m=await import(pathToFileURL(join(stage,'maintenance.ts')).href);
async function fixture(version=0,badCandidate=false){
 const dir=mkdtempSync(join(tmpdir(),'bob-pi15-test-')),stateDir=join(dir,'state'),home=join(dir,'maintenance');
 const state=new State(stateDir);state.set('sentinel',{preserve:true});state.pair(state.invite().token,'Synthetic phone');
 if(version===2)state.db.exec('ALTER TABLE devices ADD COLUMN created_at INTEGER; ALTER TABLE devices ADD COLUMN revoked_at INTEGER; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL); INSERT INTO schema_migrations VALUES(2,\'historical\');');
 state.db.exec('PRAGMA user_version='+version);
 const before=Object.fromEntries(['config','devices','invites',...(version===2?['schema_migrations']:[])].map(table=>[table,state.db.prepare('SELECT * FROM '+table).all()]));
 const backendId=state.id;state.close();
 const durable=new DatabaseSync(join(stateDir,'durable.sqlite'));durable.exec('CREATE TABLE synthetic_native_state(value TEXT); INSERT INTO synthetic_native_state VALUES(\'unchanged\')');durable.close();
 const durableBytes=readFileSync(join(stateDir,'durable.sqlite'));
 const probe=createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=(probe.address() as any).port;await new Promise<void>(resolve=>probe.close(()=>resolve()));
 const release=(id:string,compatibility:string,durableVersion:string,bad=false)=>{
  const root=join(dir,id);mkdirSync(join(root,'dist'),{recursive:true});
  writeFileSync(join(root,'package.json'),JSON.stringify({name:'@bob-local/cli',dependencies:{'@earendil-works/pi-durable':durableVersion}}));
  const cli=join(root,'dist','cli.mjs');
  writeFileSync(cli,`import http from 'node:http';import {appendFileSync} from 'node:fs';appendFileSync(${JSON.stringify(join(dir,'spawns'))},process.env.BOB_RELEASE_ID+'\\n');${bad?'process.exit(17);':`const server=http.createServer((req,res)=>{if(req.headers.authorization!=='Bearer '+process.env.BOB_HEALTH_TOKEN){res.writeHead(401);res.end();return;}res.setHeader('content-type','application/json');res.end(JSON.stringify({backendId:${JSON.stringify(backendId)},releaseId:process.env.BOB_RELEASE_ID,foreground:0}));});server.listen(${port},'127.0.0.1');process.on('SIGTERM',()=>server.close());`}`);
  return {id,cli,compatibility,durableVersion};
 };
 const previous=release('old',from,'1.4.0'),candidate=release('new',to,'1.5.0',badCandidate),store=new m.MaintenanceStore(home);
 store.set('active',previous);store.set('supervisorEvidence',{supervisorProtocol:enabled.supervisorProtocol,pid:process.pid,release:previous,at:Date.now()});
 const supervisor=new m.MaintenanceSupervisor(home,{sourceRoot:dir,stateDir,backendId,node:process.execPath,serveArgs:[],origin:`http://127.0.0.1:${port}`,healthTimeoutMs:10000},store); // Healthy fixture startup must outlast the 3s request timeout under parallel test load.
 const intent={protocol:enabled.supervisorProtocol,previous,candidate,phase:'intent'};
 return {dir,stateDir,home,previous,candidate,store,supervisor,intent,before,durableBytes,release,
  persist(){store.set('migrationIntent',intent);store.set('transition',{previous,candidate});},
  spawns(){return existsSync(join(dir,'spawns'))?readFileSync(join(dir,'spawns'),'utf8').trim().split('\n'):[];},
  diagnostics(){const log=join(home,'backend.log');return `Synthetic child exit=${supervisor.child?.exitCode} signal=${supervisor.child?.signalCode}; ${existsSync(log)?readFileSync(log,'utf8').slice(-4096):'no fixture log'}`;},
  preserved(){const db=new DatabaseSync(join(stateDir,'control.sqlite'),{readOnly:true});try{for(const [table,rows] of Object.entries(before))assert.deepEqual(db.prepare('SELECT * FROM '+table).all(),rows);}finally{db.close();}assert.deepEqual(readFileSync(join(stateDir,'durable.sqlite')),durableBytes);},
  async close(){await supervisor.stop();store.close();rmSync(dir,{recursive:true,force:true});}
 };
}
function mutateControl(f:Awaited<ReturnType<typeof fixture>>,sql:string){const db=new DatabaseSync(join(f.stateDir,'control.sqlite'));try{db.exec(sql);}finally{db.close();}}

test('production refuses unreviewed pairs; exact from+to and protocol refuse caller-controlled or reverse pairs',async()=>{
 assert.throws(()=>disabled.assertPi15Pair(from,to),/compiled exact allowlist/);
 assert.doesNotThrow(()=>enabled.assertPi15Pair(from,to));
 for(const pair of [[to,from],[from,other],[other,to],[from,from],[undefined,to],['*',to]])assert.throws(()=>enabled.assertPi15Pair(...pair),/allowlist/);
 const f=await fixture();try{
  assert.throws(()=>enabled.validateIntent({...f.intent,protocol:'caller-bypass'}),/intent/);
  assert.throws(()=>disabled.preparePi15Floor(f.home,f.stateDir,f.store,f.intent),/allowlist/);
  assert.equal(enabled.readControlFloor(f.stateDir).kind,'legacy');
  assert.throws(()=>enabled.preparePi15Floor(f.home,f.stateDir,f.store,f.intent),/Persistent migration intent/);
 }finally{await f.close();}
});

for(const version of [0,1,2])test(`explicit control-v3 transaction preserves v${version} rows and separately records lifecycle version; real old State rejects it`,async()=>{
 const f=await fixture(version);try{
  f.persist();enabled.preparePi15Floor(f.home,f.stateDir,f.store,f.intent);
  const floor=enabled.readControlFloor(f.stateDir);
  assert.deepEqual(floor,{kind:'pi15',minDurable:'1.5.0',protocol:'bob-pi15-v1',from,to,migrationReleaseId:'new',migrationCli:f.candidate.cli,lifecycleSchemaVersion:version});
  f.preserved();assert.equal(f.store.get('migrationIntent').phase,'floor-committed');
  assert.equal(enabled.readControlFloor(f.store.get('lastBackup')).kind,'legacy');
  assert.throws(()=>new Pi14State(f.stateDir),/Unsupported newer control schema/);
  assert.throws(()=>disabled.readControlFloor(f.stateDir),/allowlist/,'disabled bridge cannot interpret a caller-supplied floor as authorization');
  await assert.rejects(f.supervisor.start(f.previous),/floor forbids/);assert.deepEqual(f.spawns(),[]);
 }finally{await f.close();}
});

test('exclusive runtime ownership blocks floor migration and every spawn, without changing control or Durable',async()=>{
 const f=await fixture();const releaseOwner=acquireOwner(f.stateDir);try{
  f.persist();assert.throws(()=>enabled.preparePi15Floor(f.home,f.stateDir,f.store,f.intent),/already owned/);
  await assert.rejects(f.supervisor.start(f.previous),/already owned/);
  assert.equal(enabled.readControlFloor(f.stateDir).kind,'legacy');f.preserved();assert.deepEqual(f.spawns(),[]);
 }finally{releaseOwner();await f.close();}
});

test('positive crossing: verified backup then floor then candidate, never old code after commit',async()=>{
 const f=await fixture();try{
  await f.supervisor.start(f.previous);await f.supervisor.activate(f.candidate);
  assert.deepEqual(f.spawns(),['old','new']);assert.equal(f.store.get('active').id,'new');assert.equal(f.store.get('migrationIntent').phase,'complete');f.preserved();
  await assert.rejects(f.supervisor.activate(f.previous),/allowlist/,'explicit rollback cannot cross back');
  await f.supervisor.stop();await assert.rejects(f.supervisor.start(f.previous),/floor forbids/);
  assert.equal(f.supervisor.recoveryRelease().id,'new');await f.supervisor.start(f.supervisor.recoveryRelease());assert.deepEqual(f.spawns(),['old','new','new']);
 }finally{await f.close();}
});

test('first candidate failure after barrier retains intent and forward-only recovery target',async()=>{
 const f=await fixture(0,true);try{
  await f.supervisor.start(f.previous);await assert.rejects(f.supervisor.activate(f.candidate),/floor committed/);
  assert.deepEqual(f.spawns(),['old','new']);assert.ok(f.store.get('migrationIntent'));assert.equal(f.store.get('active').id,'old');
  assert.equal(f.supervisor.recoveryRelease().id,'new');await assert.rejects(f.supervisor.start(f.supervisor.recoveryRelease()),/unhealthy/);
  assert.deepEqual(f.spawns(),['old','new','new']);f.preserved();
 }finally{await f.close();}
});

for(const phase of ['intent','backed-up','floor-committed','complete'])test(`crash matrix: committed database with journal phase ${phase} always chooses candidate`,async()=>{
 const f=await fixture();try{
  f.persist();enabled.preparePi15Floor(f.home,f.stateDir,f.store,f.intent);
  f.store.set('migrationIntent',{...f.store.get('migrationIntent'),phase});
  assert.equal(f.supervisor.recoveryRelease().id,'new');f.preserved();
 }finally{await f.close();}
});

for(const phase of ['intent','backed-up'])test(`crash matrix: verified legacy floor at ${phase} permits previous recovery only`,async()=>{
 const f=await fixture();try{
  f.persist();f.store.set('migrationIntent',{...f.intent,phase});
  assert.equal(f.supervisor.recoveryRelease().id,'old');assert.equal(f.store.get('migrationIntent'),null);f.preserved();
 }finally{await f.close();}
});

test('COMMIT before journal phase failure never falls through to old restart; old bridge runner recovers candidate',async()=>{
 const f=await fixture();const set=f.store.set.bind(f.store);try{
  await f.supervisor.start(f.previous);
  f.store.set=(key:string,value:any)=>{if(key==='migrationIntent'&&value?.phase==='floor-committed')throw Error('synthetic crash after COMMIT');set(key,value);};
  await assert.rejects(f.supervisor.activate(f.candidate),/floor committed/);
  assert.equal(f.store.get('migrationIntent').phase,'backed-up');assert.deepEqual(f.spawns(),['old']);
  // This is the old active bridge runner selected by the unchanged stable loader.
  assert.equal(f.store.get('active').id,'old');assert.equal(f.supervisor.recoveryRelease().id,'new');
  await f.supervisor.start(f.supervisor.recoveryRelease());assert.deepEqual(f.spawns(),['old','new']);f.preserved();
 }finally{f.store.set=set;await f.close();}
});

test('pre-barrier backup/journal failure rolls back only after verifying the actual legacy floor',async()=>{
 const f=await fixture();const set=f.store.set.bind(f.store);try{
  await f.supervisor.start(f.previous);
  f.store.set=(key:string,value:any)=>{if(key==='migrationIntent'&&value?.phase==='backed-up')throw Error('synthetic backup receipt failure');set(key,value);};
  await assert.rejects(f.supervisor.activate(f.candidate),(error:Error)=>{assert.match(error.message,/rolled back/,f.diagnostics());return true;});
  assert.deepEqual(f.spawns(),['old','old']);assert.equal(enabled.readControlFloor(f.stateDir).kind,'legacy');assert.equal(f.store.get('migrationIntent'),null);f.preserved();
 }finally{f.store.set=set;await f.close();}
});

test('same-fingerprint updates and unhealthy rollback remain valid above the floor',async()=>{
 const f=await fixture();try{
  f.persist();enabled.preparePi15Floor(f.home,f.stateDir,f.store,f.intent);f.supervisor.recoveryRelease();
  await f.supervisor.start(f.candidate);
  const bad=f.release('bad-compatible',to,'1.5.0',true);await assert.rejects(f.supervisor.activate(bad),/rolled back/);
  assert.deepEqual(f.spawns(),['new','bad-compatible','new']);assert.equal(f.store.get('active').id,'new');assert.ok(f.store.get('migrationIntent'));f.preserved();
 }finally{await f.close();}
});

for(const corruption of ['missing-row','bad-protocol','wrong-pair','missing-intent','wrong-intent','unknown-version','absent-control','corrupt-control','wrong-package','all-databases-missing'])test(`missing/corrupt metadata ${corruption} halts recovery and all old spawns`,async()=>{
 const f=await fixture();try{
  f.persist();enabled.preparePi15Floor(f.home,f.stateDir,f.store,f.intent);
  if(corruption==='missing-row')mutateControl(f,'DELETE FROM maintenance_runtime_floor');
  if(corruption==='bad-protocol')mutateControl(f,"UPDATE maintenance_runtime_floor SET protocol='caller-bypass'");
  if(corruption==='wrong-pair')mutateControl(f,`UPDATE maintenance_runtime_floor SET to_fingerprint='${other}'`);
  if(corruption==='missing-intent')f.store.set('migrationIntent',null);
  if(corruption==='wrong-intent')f.store.set('migrationIntent',{...f.intent,candidate:{...f.candidate,id:'impostor'}});
  if(corruption==='unknown-version')mutateControl(f,'PRAGMA user_version=99');
  if(corruption==='absent-control')for(const name of ['control.sqlite','control.sqlite-wal','control.sqlite-shm'])rmSync(join(f.stateDir,name),{force:true});
  if(corruption==='corrupt-control'){for(const name of ['control.sqlite-wal','control.sqlite-shm'])rmSync(join(f.stateDir,name),{force:true});writeFileSync(join(f.stateDir,'control.sqlite'),'not sqlite');}
  if(corruption==='all-databases-missing')for(const name of ['control.sqlite','control.sqlite-wal','control.sqlite-shm','durable.sqlite','durable.sqlite-wal','durable.sqlite-shm'])rmSync(join(f.stateDir,name),{force:true});
  if(corruption==='wrong-package')writeFileSync(join(f.dir,'new','package.json'),JSON.stringify({name:'@bob-local/cli',dependencies:{'@earendil-works/pi-durable':'1.4.0'}}));
  assert.throws(()=>f.supervisor.recoveryRelease());await assert.rejects(f.supervisor.start(f.previous));assert.deepEqual(f.spawns(),[]);
 }finally{await f.close();}
});

test('legacy floor contradictory to committed intent is not an old-code recovery authorization',async()=>{
 const f=await fixture();try{f.persist();f.store.set('migrationIntent',{...f.intent,phase:'floor-committed'});assert.throws(()=>f.supervisor.recoveryRelease(),/Committed migration intent/);await assert.rejects(f.supervisor.start(f.previous),/Committed migration intent/);assert.deepEqual(f.spawns(),[]);}finally{await f.close();}
});

test('ordinary heartbeat is not bridge proof; protocol, live pid, fresh timestamp and exact running release are required',async()=>{
 const f=await fixture();try{
  f.store.set('supervisorEvidence',null);f.store.set('heartbeat',Date.now());
  await assert.rejects(f.supervisor.activate(f.candidate),/supervisor proof/);
  const proof={supervisorProtocol:enabled.supervisorProtocol,pid:process.pid,release:f.previous,at:Date.now()};
  assert.equal(enabled.runningBridge(proof,f.previous),true);
  for(const change of [{supervisorProtocol:'old'},{pid:-1},{at:Date.now()-16000},{at:Date.now()+10000},{release:f.candidate}])assert.equal(enabled.runningBridge({...proof,...change},f.previous),false);
  const state=new State(f.stateDir);state.set('maintenanceHome',f.home);writeFileSync(join(f.home,'config.json'),JSON.stringify({backendId:state.id,stateDir:f.stateDir}));
  try{
   const store=new MaintenanceStore(f.home);try{
    assert.equal(updateStatus(state).bridgeReady,false);store.set('supervisorEvidence',proof);
    const status=updateStatus(state);assert.equal(status.bridgeReady,true);assert.equal(status.supervisorProtocol,'bob-pi15-v1');assert.equal(status.supervisorPid,process.pid);assert.equal(status.supervisorRelease?.id,'old');
   }finally{store.close();}
  }finally{state.close();}
 }finally{await f.close();}
});


test('unchanged stable loader recovers candidate, hands off to its real runner, and gates queued rollback',{timeout:20000},async()=>{
 const f=await fixture();let runner:ReturnType<typeof spawn>|undefined;try{
  f.persist();enabled.preparePi15Floor(f.home,f.stateDir,f.store,f.intent);
  f.store.set('migrationIntent',{...f.store.get('migrationIntent'),phase:'backed-up'});
  f.store.set('previous',f.previous);
  const dist=join(f.dir,'old','dist');
  for(const directory of [dist,join(f.dir,'new','dist')])for(const name of ['maintenance','maintenance-migration','ownership','maintenance-build','maintenance-ui','maintenance-runner','maintenance-loader'])writeFileSync(join(directory,name+'.js'),readFileSync(join(stage,name+'.js')));
  writeFileSync(join(f.home,'config.json'),JSON.stringify(f.supervisor.config));
  runner=spawn(process.execPath,[join(dist,'maintenance-loader.js'),f.home],{stdio:['ignore','pipe','pipe']});
  let diagnostics='';runner.stderr!.on('data',chunk=>{diagnostics+=String(chunk);});
  assert.equal((await once(runner,'exit'))[0],0,diagnostics);
  runner=spawn(process.execPath,[join(dist,'maintenance-loader.js'),f.home],{stdio:['ignore','pipe','pipe']});
  runner.stderr!.on('data',chunk=>{diagnostics+=String(chunk);});
  const wait=async(predicate:()=>boolean)=>{const until=Date.now()+10000;while(!predicate()){if(runner!.exitCode!==null)assert.fail('Runner exited: '+diagnostics);if(Date.now()>until)assert.fail('Runner condition timed out: '+diagnostics);await new Promise(r=>setTimeout(r,50));}};
  await wait(()=>f.store.get('supervisorEvidence')?.pid===runner!.pid);
  const evidence=f.store.get('supervisorEvidence');
  assert.equal(f.store.get('active').id,'new');assert.equal(evidence.supervisorProtocol,'bob-pi15-v1');assert.equal(evidence.release.id,'new','evidence identifies the actual recovered release runner after handoff');
  assert.deepEqual(f.spawns(),['new','new']);
  f.store.enqueue({id:'blocked-old-rollback',action:'rollback',target:'backend'});
  await wait(()=>f.store.job('blocked-old-rollback')?.status==='failed');
  assert.match(f.store.job('blocked-old-rollback').error,/allowlist/);assert.deepEqual(f.spawns(),['new','new']);f.preserved();
 }finally{
  if(runner&&runner.exitCode===null&&runner.signalCode===null){const exited=once(runner,'exit');runner.kill('SIGTERM');await exited;}
  await f.close();
 }
});


test('verified snapshot covers custom-module archives, artifacts and known local config, with explicit exclusions and bounded file hashing',async()=>{
 const f=await fixture();try{
  const archive=join(f.stateDir,'custom-modules','synthetic','1.0.0-hash','dist');mkdirSync(archive,{recursive:true});
  writeFileSync(join(archive,'index.js'),'export default "synthetic archive";');
  mkdirSync(join(f.stateDir,'artifacts','1'),{recursive:true});writeFileSync(join(f.stateDir,'artifacts','1','large-original'),Buffer.alloc(8*1024*1024,23));
  for(const name of ['soul.md','core-prompt.md','setup-connection.json','hindsight.json','firebase-push.json'])writeFileSync(join(f.stateDir,name),'synthetic config');
  writeFileSync(join(f.stateDir,'excluded-private-key'),'must not be silently claimed as covered');
  f.persist();enabled.preparePi15Floor(f.home,f.stateDir,f.store,f.intent);
  const backup=f.store.get('lastBackup'),manifest=JSON.parse(readFileSync(join(backup,'maintenance-backup.json'),'utf8'));
  assert.equal(manifest.format,'bob-maintenance-snapshot-v1');assert.ok(manifest.files['custom-modules/synthetic/1.0.0-hash/dist/index.js']);assert.ok(manifest.files['artifacts/1/large-original']);
  assert.equal(readFileSync(join(backup,'custom-modules/synthetic/1.0.0-hash/dist/index.js'),'utf8'),'export default "synthetic archive";');
  for(const name of ['soul.md','core-prompt.md','setup-connection.json','hindsight.json','firebase-push.json'])assert.ok(manifest.files[name]);
  assert.equal(existsSync(join(backup,'excluded-private-key')),false);assert.match(manifest.coverage.excluded,/TLS\/FCM.*signing/);f.preserved();
 }finally{await f.close();}
});

for(const payload of ['top-symlink','nested-symlink','dangling-symlink','nonregular','wrong-directory-type'])test(`snapshot refuses ${payload} before the floor and retains previous-code recovery`,async()=>{
 const f=await fixture();try{
  const modules=join(f.stateDir,'custom-modules');
  if(payload==='top-symlink')symlinkSync(f.dir,modules,'dir');
  else if(payload==='wrong-directory-type')writeFileSync(modules,'not directory');
  else{
   mkdirSync(modules);
   if(payload==='nested-symlink')symlinkSync(join(f.stateDir,'durable.sqlite'),join(modules,'link'));
   if(payload==='dangling-symlink')symlinkSync(join(f.dir,'missing'),join(modules,'link'));
   if(payload==='nonregular')execFileSync('mkfifo',[join(modules,'fifo')]);
  }
  f.persist();assert.throws(()=>enabled.preparePi15Floor(f.home,f.stateDir,f.store,f.intent),/symlink|regular|directories/);
  assert.equal(enabled.readControlFloor(f.stateDir).kind,'legacy');assert.equal(f.supervisor.recoveryRelease().id,'old');f.preserved();
 }finally{await f.close();}
});

test('missing control with custom-module archives is not a fresh bootstrap',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bob-missing-control-'));try{mkdirSync(join(dir,'custom-modules'));assert.throws(()=>disabled.readControlFloor(dir),/Missing control database/);}finally{rmSync(dir,{recursive:true,force:true});}
});

function installRunner(dist:string,pinned:boolean){
 for(const name of ['maintenance','maintenance-migration','ownership','maintenance-build','maintenance-ui','maintenance-runner','maintenance-loader']){
  const source=pinned?readFileSync(join(stage,name+'.js'),'utf8'):transformSync(readFileSync(new URL('../src/'+name+'.ts',import.meta.url),'utf8'),{loader:'ts',format:'esm',target:'node24'}).code;
  writeFileSync(join(dist,name+'.js'),source);
 }
}
for(const recovery of [false,true])test(`runner cleans up unhealthy-but-running child during ${recovery?'forward recovery':'initial startup'}, without systemd`,{timeout:30000},async()=>{
 const f=await fixture();f.supervisor.config.healthTimeoutMs=3000; // Deliberately unhealthy fixtures need a separate, bounded rejection window.
 let runner:ReturnType<typeof spawn>|undefined;let childPid:number|undefined;try{
  const chosen=recovery?f.candidate:f.previous,dist=join(f.dir,'old','dist'),pidFile=join(f.dir,'unhealthy-pid'),stopped=join(f.dir,'unhealthy-stopped');
  writeFileSync(chosen.cli,`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);process.on('SIGTERM',()=>{writeFileSync(${JSON.stringify(stopped)},'gracefully stopped');process.exit(0);});`);
  if(recovery){f.persist();enabled.preparePi15Floor(f.home,f.stateDir,f.store,f.intent);}
  installRunner(dist,recovery);writeFileSync(join(f.home,'config.json'),JSON.stringify(f.supervisor.config));
  runner=spawn(process.execPath,[join(dist,'maintenance-loader.js'),f.home],{stdio:['ignore','pipe','pipe']});let diagnostics='';runner.stderr!.on('data',chunk=>{diagnostics+=String(chunk);});
  const [code]=await once(runner,'exit');assert.equal(code,1);assert.match(diagnostics,/Candidate backend unhealthy/);
  assert.equal(readFileSync(stopped,'utf8'),'gracefully stopped');childPid=Number(readFileSync(pidFile,'utf8'));assert.throws(()=>process.kill(childPid!,0),/ESRCH/);
  assert.equal(f.store.get('supervisorEvidence'),null);if(recovery){assert.ok(f.store.get('migrationIntent'));assert.equal(f.store.get('active').id,'new');}
  const releaseLock=acquireOwner(join(f.home,'supervisor-owner'));releaseLock();
 }finally{
  if(runner&&runner.exitCode===null&&runner.signalCode===null){const exited=once(runner,'exit');runner.kill('SIGTERM');await exited;}
  if(childPid)try{process.kill(childPid,'SIGTERM');}catch{}
  await f.close();
 }
});

for(const changedCode of [true,false])test(`empty-allowlist ordinary activation re-execs into its actual release (changed maintenance code: ${changedCode})`,{timeout:20000},async()=>{
 const f=await fixture();let runner:ReturnType<typeof spawn>|undefined;try{
  const bridge=f.release('bridge',from,'1.4.0'),oldDist=join(f.dir,'old','dist'),bridgeDist=join(f.dir,'bridge','dist');
  installRunner(oldDist,false);installRunner(bridgeDist,false);
  if(changedCode)writeFileSync(join(bridgeDist,'maintenance-runner.js'),readFileSync(join(bridgeDist,'maintenance-runner.js'),'utf8')+'\n// Synthetic preparatory runner revision\n');
  writeFileSync(join(f.home,'config.json'),JSON.stringify(f.supervisor.config));f.store.set('previous',bridge);
  // A queued ordinary rollback is an activation of a staged equal-fingerprint release,
  // exercising the same supervisor path without running a build/install in this test.
  f.store.enqueue({id:'prepare-bridge',action:'rollback',target:'backend'});
  runner=spawn(process.execPath,[join(oldDist,'maintenance-loader.js'),f.home],{stdio:['ignore','pipe','pipe']});let diagnostics='';runner.stderr!.on('data',chunk=>{diagnostics+=String(chunk);});
  const [code]=await once(runner,'exit');assert.equal(code,0,diagnostics);assert.equal(f.store.job('prepare-bridge').status,'complete');assert.equal(f.store.get('active').id,'bridge');
  assert.equal(disabled.readControlFloor(f.stateDir).kind,'legacy');assert.equal(f.store.get('migrationIntent'),undefined);assert.deepEqual(f.spawns(),['old','bridge']);
  runner=spawn(process.execPath,[join(oldDist,'maintenance-loader.js'),f.home],{stdio:['ignore','pipe','pipe']});runner.stderr!.on('data',chunk=>{diagnostics+=String(chunk);});
  const until=Date.now()+8000;
  while(f.store.get('supervisorEvidence')?.pid!==runner.pid){if(runner.exitCode!==null)assert.fail(diagnostics);if(Date.now()>until)assert.fail('Preparatory bridge restart timed out: '+diagnostics);await new Promise(r=>setTimeout(r,50));}
  assert.equal(f.store.get('supervisorEvidence').release.id,'bridge');assert.equal(f.store.get('supervisorEvidence').supervisorProtocol,'bob-pi15-v1');assert.deepEqual(f.spawns(),['old','bridge','bridge']);f.preserved();
 }finally{
  if(runner&&runner.exitCode===null&&runner.signalCode===null){const exited=once(runner,'exit');runner.kill('SIGTERM');await exited;}
  await f.close();
 }
});


test('build admissibility requires no installed CLI/cwd package, while activation still proves installed package identity',async()=>{
 const f=await fixture();try{
  const evidence={supervisorProtocol:enabled.supervisorProtocol,pid:process.pid,release:f.previous,at:Date.now()};
  assert.doesNotThrow(()=>enabled.assertBridgeBuild(f.previous,{compatibility:to,durableVersion:'1.5.0'},evidence));
  assert.throws(()=>enabled.assertBridgeActivation(f.previous,{...f.candidate,cli:join(f.dir,'missing','dist','cli.js')},evidence),/ENOENT/);
  writeFileSync(join(f.dir,'new','package.json'),JSON.stringify({name:'@bob-local/cli',dependencies:{'@earendil-works/pi-durable':'1.4.0'}}));
  assert.throws(()=>enabled.assertBridgeActivation(f.previous,f.candidate,evidence),/Pi 1.5 runtime identity/);
  assert.equal(enabled.readControlFloor(f.stateDir).kind,'legacy');assert.deepEqual(f.spawns(),[]);
 }finally{await f.close();}
});

for(const direct of [false,true])test(`cold supervisor bootstrap establishes fresh floor only for proven 1.5 (direct start: ${direct})`,async()=>{
 const f=await fixture();try{
  // Remove this test's synthetic placeholder, leaving only initialized control.
  rmSync(join(f.stateDir,'durable.sqlite'));f.store.set('active',f.candidate);
  if(!direct)assert.equal(f.supervisor.recoveryRelease().id,'new');
  await f.supervisor.start(f.candidate);
  assert.equal(enabled.readControlFloor(f.stateDir).kind,'pi15-fresh');
  assert.equal(f.store.get('migrationIntent'),undefined);assert.deepEqual(f.spawns(),['new']);
  await f.supervisor.stop();await assert.rejects(f.supervisor.start(f.previous),/forbids/);
 }finally{await f.close();}
});
for(const boundary of ['native','wal','shm','wrong-package','owned'])test(`cold supervisor cannot bootstrap ${boundary}`,async()=>{
 const f=await fixture();let unlock:(()=>void)|undefined;try{
  f.store.set('active',f.candidate);
  if(boundary!=='native')rmSync(join(f.stateDir,'durable.sqlite'));
  if(boundary==='wal'||boundary==='shm')writeFileSync(join(f.stateDir,'durable.sqlite-'+boundary),'existing-native');
  if(boundary==='wrong-package')writeFileSync(join(f.dir,'new','package.json'),JSON.stringify({name:'@bob-local/cli',dependencies:{'@earendil-works/pi-durable':'1.4.0'}}));
  if(boundary==='owned')unlock=acquireOwner(f.stateDir);
  assert.throws(()=>f.supervisor.recoveryRelease());await assert.rejects(f.supervisor.start(f.candidate));
  assert.equal(enabled.readControlFloor(f.stateDir).kind,'legacy');assert.deepEqual(f.spawns(),[]);
 }finally{unlock?.();await f.close();}
});

test('delayed rollback fixture still proves authenticated recovery and unchanged legacy state',{timeout:30000},async()=>{
 const f=await fixture();const set=f.store.set.bind(f.store);try{
  // Delay only the second start of the old fixture. This deterministically
  // exercises a healthy restart slower than the former 1.8s test-only budget.
  const source=readFileSync(f.previous.cli,'utf8');
  const delayed=source.replace("{appendFileSync}","{appendFileSync,readFileSync}").replace(/server\.listen\(([^;]+)\);/,(_,args)=>`const restarting=readFileSync(${JSON.stringify(join(f.dir,'spawns'))},'utf8').trim().split('\\n').length>1;const boot=setTimeout(()=>server.listen(${args}),restarting?2400:0);`).replace("()=>server.close()","()=>{clearTimeout(boot);server.close();}");
  assert.notEqual(delayed,source);writeFileSync(f.previous.cli,delayed);
  await f.supervisor.start(f.previous);
  f.store.set=(key:string,value:any)=>{if(key==='migrationIntent'&&value?.phase==='backed-up')throw Error('synthetic backup receipt failure');set(key,value);};
  await assert.rejects(f.supervisor.activate(f.candidate),(error:Error)=>{assert.match(error.message,/rolled back/,f.diagnostics());return true;});
  assert.deepEqual(f.spawns(),['old','old']);assert.equal((await f.supervisor.health()).releaseId,'old');
  assert.equal(f.store.get('migrationIntent'),null);assert.equal(enabled.readControlFloor(f.stateDir).kind,'legacy');f.preserved();
 }finally{f.store.set=set;await f.close();}
});
