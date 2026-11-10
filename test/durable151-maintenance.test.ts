import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {transformSync} from 'esbuild';
import {State} from '../src/state.js';
import {migrateControl} from '../src/control-migrations.js';
import {acquireOwner} from '../src/ownership.js';
import {MaintenanceStore,MaintenanceSupervisor,compatibilityFingerprint,rawCompatibilityFingerprint,type Release} from '../src/maintenance.js';
import * as policy from '../src/maintenance-migration.js';

const roots:string[]=[];
const temporary=(prefix:string)=>{const dir=mkdtempSync(join(tmpdir(),prefix));roots.push(dir);return dir;};
after(()=>{for(const dir of roots)rmSync(dir,{recursive:true,force:true});});
const stage=temporary('bob-151-old-policy-');
writeFileSync(join(stage,'package.json'),'{"type":"module"}');
for(const name of ['maintenance-migration','ownership']){
 const source=readFileSync(new URL(name==='ownership'?'../src/ownership.ts':'./fixtures/durable151-pi150-supervisor/maintenance-migration.ts',import.meta.url),'utf8');
 writeFileSync(join(stage,name+'.js'),transformSync(source,{loader:'ts',format:'esm',target:'node24'}).code);
}
const preBridge=await import(pathToFileURL(join(stage,'maintenance-migration.js')).href);
async function fixture({historical=false,lifecycle=0,bad=false}:{historical?:boolean;lifecycle?:number;bad?:boolean}={}){
 const dir=temporary('bob-151-maintenance-'),stateDir=join(dir,'state'),home=join(dir,'maintenance');
 const state=new State(stateDir);state.set('sentinel',{preserved:true});state.pair(state.invite().token,'Phone');
 if(lifecycle===2)migrateControl(state);else state.db.exec('PRAGMA user_version='+lifecycle);
 const backendId=state.id;state.close();
 const probe=createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));
 const port=(probe.address() as any).port;await new Promise<void>(resolve=>probe.close(()=>resolve()));
 const release=(id:string,durableVersion:string,compatibility:string,unhealthy=false):Release=>{
  const cli=join(dir,id,'dist','cli.js');mkdirSync(dirname(cli),{recursive:true});
  writeFileSync(join(dirname(dirname(cli)),'package.json'),JSON.stringify({name:'@bob-local/cli',type:'module',dependencies:{'@earendil-works/pi-durable':durableVersion}}));
  writeFileSync(cli,`import http from 'node:http';import {appendFileSync} from 'node:fs';appendFileSync(${JSON.stringify(join(dir,'spawns'))},process.env.BOB_RELEASE_ID+'\\n');${unhealthy?'process.exit(17);':`const s=http.createServer((req,res)=>{if(req.headers.authorization!=='Bearer '+process.env.BOB_HEALTH_TOKEN){res.writeHead(401);res.end();return;}res.setHeader('content-type','application/json');res.end(JSON.stringify({backendId:${JSON.stringify(backendId)},releaseId:process.env.BOB_RELEASE_ID,foreground:0}));});s.listen(${port},'127.0.0.1');process.on('SIGTERM',()=>s.close());`}`.replace("+'\\\\n'","+'\\n'"));
  return {id,cli,durableVersion,compatibility};
 };
 const previous=release('bridge','1.5.0',policy.pi150Fingerprint),candidate=release('candidate','1.5.1',policy.pi151Fingerprint,bad);
 const store=new MaintenanceStore(home);
 const native=new DatabaseSync(join(stateDir,'durable.sqlite'));native.exec("CREATE TABLE durable_schema(singleton INTEGER PRIMARY KEY,version INTEGER); INSERT INTO durable_schema VALUES(1,2); CREATE TABLE synthetic(value TEXT); INSERT INTO synthetic VALUES('unchanged')");native.close();
 if(historical){
  const original=release('pi14','1.4.0','328bbd2b3ec5505199382f781d7dc2dc5359e17b8356c92daef8be53155f8003');
  store.set('migrationIntent',{protocol:policy.supervisorProtocol,previous:original,candidate:previous,phase:'intent'});
  policy.preparePi15Floor(home,stateDir,store,store.get('migrationIntent')!);
  store.set('migrationIntent',{...store.get('migrationIntent') as object,phase:'complete'});
 }else{
  rmSync(join(stateDir,'durable.sqlite'));const lock=acquireOwner(stateDir);try{policy.prepareFreshPi15Floor(stateDir);}finally{lock();}
  const native=new DatabaseSync(join(stateDir,'durable.sqlite'));native.exec("CREATE TABLE durable_schema(singleton INTEGER PRIMARY KEY,version INTEGER); INSERT INTO durable_schema VALUES(1,2); CREATE TABLE synthetic(value TEXT); INSERT INTO synthetic VALUES('unchanged')");native.close();
 }
 const nativeBytes=readFileSync(join(stateDir,'durable.sqlite'));
 const before=new DatabaseSync(join(stateDir,'control.sqlite'),{readOnly:true});
 const originalTables=Object.fromEntries(['config','devices','invites','maintenance_runtime_floor',...(lifecycle===2?['schema_migrations']:[])].map(table=>[table,before.prepare('SELECT * FROM '+table).all()]));before.close();
 const originalIntent=store.get('migrationIntent');
 store.set('active',previous);store.set('supervisorEvidence',{supervisorProtocol:policy.supervisorProtocol,patchSupervisorProtocol:policy.patchSupervisorProtocol,pid:process.pid,release:previous,at:Date.now()});
 const supervisor=new MaintenanceSupervisor(home,{sourceRoot:dir,stateDir,backendId,node:process.execPath,serveArgs:[],origin:`http://127.0.0.1:${port}`,healthTimeoutMs:10000},store);
 const intent:policy.PatchMigrationIntent={protocol:policy.patchSupervisorProtocol,previous,candidate,phase:'intent'};
 return {dir,stateDir,home,previous,candidate,store,supervisor,intent,release,originalIntent,
  persist(){store.set('patchMigrationIntent',intent);store.set('transition',{previous,candidate});},
  spawns(){return existsSync(join(dir,'spawns'))?readFileSync(join(dir,'spawns'),'utf8').trim().split('\n'):[];},
  preserved(){const db=new DatabaseSync(join(stateDir,'control.sqlite'),{readOnly:true});try{for(const [table,rows] of Object.entries(originalTables))assert.deepEqual(db.prepare('SELECT * FROM '+table).all(),rows);}finally{db.close();}assert.deepEqual(readFileSync(join(stateDir,'durable.sqlite')),nativeBytes);assert.deepEqual(store.get('migrationIntent'),originalIntent);},
  async close(){await supervisor.stop();store.close();}
 };
}
function mutate(stateDir:string,sql:string){const db=new DatabaseSync(join(stateDir,'control.sqlite'));try{db.exec(sql);}finally{db.close();}}

test('compiled target is raw, distinct, exact and not a caller/environment-defined alias',()=>{
 const root=new URL('..',import.meta.url).pathname;
 const target=policy.installedDurableVersion()==='1.5.1';
 assert.equal(rawCompatibilityFingerprint(root),target?policy.pi151Fingerprint:'95750e8918ed663e0607933a0e3867674fec8098d32981b45008b15806a072f9');
 assert.equal(compatibilityFingerprint(root),target?policy.pi151Fingerprint:policy.pi150Fingerprint);
 assert.notEqual(policy.pi150Fingerprint,policy.pi151Fingerprint);
 assert.doesNotThrow(()=>policy.assertPi151Pair(policy.pi150Fingerprint,policy.pi151Fingerprint));
 for(const [from,to] of [[policy.pi151Fingerprint,policy.pi150Fingerprint],[policy.pi150Fingerprint,'a'.repeat(64)],['a'.repeat(64),policy.pi151Fingerprint],[policy.pi150Fingerprint,policy.pi150Fingerprint]])assert.throws(()=>policy.assertPi151Pair(from,to),/compiled exact allowlist/);
});

test('ordinary old supervisor evidence is insufficient; build policy needs the actual patch-capable bridge identity',async()=>{
 const f=await fixture();try{
  const evidence=f.store.get<policy.SupervisorEvidence>('supervisorEvidence')!;
  assert.doesNotThrow(()=>policy.assertBridgeBuild(f.previous,f.candidate,evidence));
  for(const value of [undefined,{...evidence,patchSupervisorProtocol:undefined},{...evidence,release:f.candidate},{...evidence,at:Date.now()-16000}])assert.throws(()=>policy.assertBridgeBuild(f.previous,f.candidate,value),/bridge/);
  f.store.set('supervisorEvidence',{...evidence,patchSupervisorProtocol:undefined});
  await assert.rejects(f.supervisor.activate(f.candidate),/bridge/);assert.deepEqual(f.spawns(),[]);f.preserved();
 }finally{await f.close();}
});

for(const historical of [false,true])for(const lifecycle of [0,1,2])test(`v4 transaction preserves original floor/intent and lifecycle ${lifecycle}, historical=${historical}`,async()=>{
 const f=await fixture({historical,lifecycle});try{
  f.persist();policy.preparePi151Floor(f.home,f.stateDir,f.store,f.intent);
  assert.deepEqual(policy.readControlFloor(f.stateDir),{kind:'pi151',minDurable:'1.5.1',protocol:'bob-pi151-v1',origin:'migration',from:policy.pi150Fingerprint,to:policy.pi151Fingerprint,migrationReleaseId:f.candidate.id,migrationCli:f.candidate.cli,lifecycleSchemaVersion:lifecycle});
  f.preserved();assert.equal(f.store.get<policy.PatchMigrationIntent>('patchMigrationIntent')?.phase,'floor-committed');
  assert.throws(()=>preBridge.readControlFloor(f.stateDir),/Unknown control floor/);
  assert.throws(()=>policy.assertRuntimeFloor(policy.readControlFloor(f.stateDir),'1.5.0'),/forbids installed/);
  assert.doesNotThrow(()=>policy.assertRuntimeFloor(policy.readControlFloor(f.stateDir),'1.5.1'));
  await assert.rejects(f.supervisor.start(f.previous),/control floor forbids/);assert.deepEqual(f.spawns(),[]);
  assert.equal(policy.readControlFloor(f.store.get<string>('lastBackup')!).kind,historical?'pi15':'pi15-fresh');
 }finally{await f.close();}
});

for(const historical of [false,true])test(`positive activation and reverse rollback rejection, historical=${historical}`,async()=>{
 const f=await fixture({historical});try{
  await f.supervisor.start(f.previous);await f.supervisor.activate(f.candidate);
  assert.deepEqual(f.spawns(),['bridge','candidate']);assert.equal(f.store.get<Release>('active')?.id,'candidate');
  assert.equal(f.store.get<policy.PatchMigrationIntent>('patchMigrationIntent')?.phase,'complete');f.preserved();
  await assert.rejects(f.supervisor.activate(f.previous),/allowlist/);await f.supervisor.stop();
  assert.equal(f.supervisor.recoveryRelease().id,'candidate');await f.supervisor.start(f.supervisor.recoveryRelease());assert.deepEqual(f.spawns(),['bridge','candidate','candidate']);
 }finally{await f.close();}
});

for(const boundary of ['intent','backup-journal','commit-before-phase','candidate-start','complete-journal'] as const)test(`interruption boundary ${boundary} chooses only the permitted side of COMMIT`,async()=>{
 const f=await fixture({historical:true,bad:boundary==='candidate-start'});const set=f.store.set.bind(f.store);try{
  if(boundary==='intent'){
   f.persist();assert.equal(f.supervisor.recoveryRelease().id,'bridge');assert.equal(f.store.get('patchMigrationIntent'),null);f.preserved();return;
  }
  await f.supervisor.start(f.previous);
  const failPhase=boundary==='backup-journal'?'backed-up':boundary==='commit-before-phase'?'floor-committed':boundary==='complete-journal'?'complete':undefined;
  f.store.set=(key,value)=>{if(key==='patchMigrationIntent'&&(value as policy.PatchMigrationIntent)?.phase===failPhase&&failPhase)throw Error('synthetic interruption at '+failPhase);set(key,value);};
  await assert.rejects(f.supervisor.activate(f.candidate),boundary==='backup-journal'?/rolled back/:/1.5.1 floor committed/);
  f.store.set=set;
  if(boundary==='backup-journal'){
   assert.equal(policy.readControlFloor(f.stateDir).kind,'pi15');assert.equal(f.supervisor.recoveryRelease().id,'bridge');assert.deepEqual(f.spawns(),['bridge','bridge']);
  }else{
   assert.equal(policy.readControlFloor(f.stateDir).kind,'pi151');assert.equal(f.supervisor.recoveryRelease().id,'candidate');
   assert.deepEqual(f.spawns(),boundary==='commit-before-phase'?['bridge']:['bridge','candidate']);
   assert.ok(f.store.get('patchMigrationIntent'));await assert.rejects(f.supervisor.start(f.previous),/control floor forbids/);
  }
  f.preserved();
 }finally{f.store.set=set;await f.close();}
});

for(const phase of ['intent','backed-up','floor-committed','complete'] as const)test(`committed floor overrides patch phase ${phase}`,async()=>{
 const f=await fixture({historical:true});try{
  f.persist();policy.preparePi151Floor(f.home,f.stateDir,f.store,f.intent);
  f.store.set('patchMigrationIntent',{...f.store.get<policy.PatchMigrationIntent>('patchMigrationIntent'),phase});
  assert.equal(f.supervisor.recoveryRelease().id,'candidate');assert.deepEqual(f.spawns(),[]);f.preserved();
 }finally{await f.close();}
});

for(const corruption of ['missing-patch-table','missing-patch-row','wrong-target','wrong-from','wrong-protocol','wrong-origin','wrong-id','wrong-cli','wrong-version','mixed-columns','historical-table','historical-intent','missing-intent','committed-with-old-floor'] as const)test(`corruption ${corruption} refuses all recovery/spawn without native mutation`,async()=>{
 const f=await fixture({historical:true});try{
  f.persist();policy.preparePi151Floor(f.home,f.stateDir,f.store,f.intent);
  const sql:Record<string,string>={
   'missing-patch-table':'DROP TABLE maintenance_pi151_floor','missing-patch-row':'DELETE FROM maintenance_pi151_floor',
   'wrong-target':"UPDATE maintenance_pi151_floor SET to_fingerprint='"+'a'.repeat(64)+"'",'wrong-from':"UPDATE maintenance_pi151_floor SET from_fingerprint='"+'a'.repeat(64)+"'",
   'wrong-protocol':"UPDATE maintenance_pi151_floor SET protocol='bob-pi15-v1'",'wrong-origin':"UPDATE maintenance_pi151_floor SET origin='fresh'",
   'wrong-id':"UPDATE maintenance_pi151_floor SET migration_release_id='other'",'wrong-cli':"UPDATE maintenance_pi151_floor SET migration_cli='/other/cli.js'",
   'wrong-version':'PRAGMA user_version=3','mixed-columns':'ALTER TABLE maintenance_pi151_floor ADD COLUMN injected TEXT',
   'historical-table':'DELETE FROM maintenance_runtime_floor','committed-with-old-floor':'DROP TABLE maintenance_pi151_floor; PRAGMA user_version=3',
  };
  if(sql[corruption])mutate(f.stateDir,sql[corruption]);
  if(corruption==='historical-intent')f.store.set('migrationIntent',null);
  if(corruption==='missing-intent')f.store.set('patchMigrationIntent',null);
  assert.throws(()=>f.supervisor.recoveryRelease());await assert.rejects(f.supervisor.start(f.previous));await assert.rejects(f.supervisor.start(f.candidate));assert.deepEqual(f.spawns(),[]);
  const db=new DatabaseSync(join(f.stateDir,'durable.sqlite'),{readOnly:true});try{assert.equal(db.prepare('SELECT value FROM synthetic').get()?.value,'unchanged');}finally{db.close();}
 }finally{await f.close();}
});

for(const modules of ['[{"id":"old-unselected","selected":false}]','{}','null','not-json'])test(`nonempty/invalid customModules ${modules} is rejected before backup and barrier`,async()=>{
 const f=await fixture();try{
  mutate(f.stateDir,"INSERT INTO config VALUES('customModules',"+"'"+modules.replaceAll("'","''")+"')");f.persist();
  assert.throws(()=>policy.preparePi151Floor(f.home,f.stateDir,f.store,f.intent),/custom-module migration|configuration JSON/);
  assert.equal(existsSync(join(f.home,'backups')),false);assert.equal(f.store.get<policy.PatchMigrationIntent>('patchMigrationIntent')?.phase,'intent');
  if(modules!=='not-json')assert.equal(policy.readControlFloor(f.stateDir).kind,'pi15-fresh');
 }finally{await f.close();}
});

test('empty customModules passes crossing; exclusive owner blocks it before backup',async()=>{
 const f=await fixture();try{
  mutate(f.stateDir,"INSERT INTO config VALUES('customModules','[]')");f.persist();const unlock=acquireOwner(f.stateDir);
  try{assert.throws(()=>policy.preparePi151Floor(f.home,f.stateDir,f.store,f.intent),/already owned/);}finally{unlock();}
  assert.equal(existsSync(join(f.home,'backups')),false);policy.preparePi151Floor(f.home,f.stateDir,f.store,f.intent);assert.equal(policy.readControlFloor(f.stateDir).kind,'pi151');
 }finally{await f.close();}
});

for(const lifecycle of [0,1,2])test(`lifecycle migration never lowers physical v4 (initial ${lifecycle})`,async()=>{
 const f=await fixture({historical:true,lifecycle});let state:State|undefined;try{
  f.persist();policy.preparePi151Floor(f.home,f.stateDir,f.store,f.intent);
  if(policy.installedDurableVersion()==='1.5.0'){
   const bytes=readFileSync(join(f.stateDir,'control.sqlite'));assert.throws(()=>new State(f.stateDir),/forbids installed/);assert.deepEqual(readFileSync(join(f.stateDir,'control.sqlite')),bytes);return;
  }
  state=new State(f.stateDir);migrateControl(state);assert.equal(state.db.prepare('PRAGMA user_version').get()?.user_version,4);assert.equal(state.lifecycleSchemaVersion,2);
  assert.equal(policy.readControlFloor(f.stateDir).kind,'pi151');assert.equal(policy.readControlFloor(f.stateDir,true,true).kind,'pi15');
  const phone=state.pair(state.invite().token,'after');state.revoke(phone.deviceId);assert.equal(typeof state.db.prepare('SELECT revoked_at FROM devices WHERE id=?').get(phone.deviceId)?.revoked_at,'number');
 }finally{state?.close();await f.close();}
});

for(const native of [false,true])test(`fresh target bootstrap is permitted only with no native state (native=${native})`,async()=>{
 const f=await fixture();try{
  f.store.set('active',f.candidate);
  if(!native)rmSync(join(f.stateDir,'durable.sqlite'));
  if(native){assert.throws(()=>f.supervisor.recoveryRelease(),/Existing Durable state/);await assert.rejects(f.supervisor.start(f.candidate),/Existing Durable state/);assert.deepEqual(f.spawns(),[]);}
  else{assert.equal(f.supervisor.recoveryRelease().id,'candidate');assert.equal(policy.readControlFloor(f.stateDir).kind,'pi151');await f.supervisor.start(f.candidate);assert.deepEqual(f.spawns(),['candidate']);}
 }finally{await f.close();}
});

function installRunner(dist:string,old=false){
 for(const name of ['maintenance','maintenance-migration','maintenance-build','maintenance-runner','maintenance-ui','maintenance-loader','ownership']){
  const archived=old&&['maintenance','maintenance-migration','maintenance-build','maintenance-runner'].includes(name);
  const source=readFileSync(new URL(archived?'./fixtures/durable151-pi150-supervisor/'+name+'.ts':'../src/'+name+'.ts',import.meta.url),'utf8');
  writeFileSync(join(dist,name+'.js'),transformSync(source,{loader:'ts',format:'esm',target:'node24'}).code);
 }
}

test('synthetic real processes: unchanged pre-bridge loader -> old-compatible bridge -> committed target runner, with correct evidence',{timeout:60000},async()=>{
 const f=await fixture({historical:true});let runner:ReturnType<typeof spawn>|undefined;let diagnostics='';
 const shutdown=async()=>{if(runner&&runner.exitCode===null&&runner.signalCode===null){const exit=once(runner,'exit');runner.kill('SIGTERM');await exit;}};
 try{
  const old=f.release('prebridge','1.5.0',policy.pi150Fingerprint);
  installRunner(dirname(old.cli),true);installRunner(dirname(f.previous.cli));installRunner(dirname(f.candidate.cli));
  writeFileSync(join(f.home,'config.json'),JSON.stringify(f.supervisor.config));f.store.set('active',old);f.store.set('previous',f.previous);
  const launch=()=>{runner=spawn(process.execPath,[join(dirname(old.cli),'maintenance-loader.js'),f.home],{stdio:['ignore','pipe','pipe']});runner.stderr!.on('data',chunk=>{diagnostics+=String(chunk);});return runner;};
  f.store.enqueue({id:'install-old-compatible-bridge',action:'rollback',target:'backend'});
  launch();assert.equal((await once(runner!,'exit'))[0],0,diagnostics);
  assert.equal(f.store.get<Release>('active')?.id,'bridge');assert.equal(f.store.job('install-old-compatible-bridge')?.status,'complete');
  assert.equal(policy.readControlFloor(f.stateDir).kind,'pi15');assert.deepEqual(f.spawns(),['prebridge','bridge']);
  const wait=async(predicate:()=>boolean)=>{const end=Date.now()+10000;while(!predicate()){if(runner!.exitCode!==null)assert.fail(diagnostics);if(Date.now()>end)assert.fail('Runner condition timed out: '+diagnostics);await new Promise(r=>setTimeout(r,50));}};
  launch();await wait(()=>f.store.get<policy.SupervisorEvidence>('supervisorEvidence')?.pid===runner!.pid);
  assert.equal(f.store.get<policy.SupervisorEvidence>('supervisorEvidence')?.patchSupervisorProtocol,policy.patchSupervisorProtocol);
  assert.equal(f.store.get<policy.SupervisorEvidence>('supervisorEvidence')?.release.id,'bridge');
  f.store.set('previous',f.candidate);f.store.enqueue({id:'cross-to-target',action:'rollback',target:'backend'});
  assert.equal((await once(runner!,'exit'))[0],0,diagnostics);assert.equal(f.store.job('cross-to-target')?.status,'complete');
  assert.equal(policy.readControlFloor(f.stateDir).kind,'pi151');assert.equal(f.store.get<Release>('active')?.id,'candidate');
  launch();await wait(()=>f.store.get<policy.SupervisorEvidence>('supervisorEvidence')?.pid===runner!.pid);
  assert.equal(f.store.get<policy.SupervisorEvidence>('supervisorEvidence')?.release.id,'candidate');
  f.store.set('previous',old);f.store.enqueue({id:'forbidden-old-rollback',action:'rollback',target:'backend'});
  await wait(()=>f.store.job('forbidden-old-rollback')?.status==='failed');assert.match(f.store.job('forbidden-old-rollback')!.error!,/allowlist/);
  assert.deepEqual(f.spawns(),['prebridge','bridge','bridge','candidate','candidate']);f.preserved();
 }finally{await shutdown();await f.close();}
});

test('bridge State rejects v4 before writer/config mutation; target State may inspect legacy/v3',async()=>{
 const f=await fixture();try{
  // Private facade simulates ONLY the installed-version result. State's real
  // constructor and real strict floor parser remain unchanged. Packaged native
  // 1.5.0/1.5.1 execution is a separate parent-owned acceptance gate.
  const privateDir=temporary('bob-151-state-gate-');writeFileSync(join(privateDir,'package.json'),'{"type":"module"}');
  const implementation=new URL('../src/maintenance-migration.ts',import.meta.url).href;
  writeFileSync(join(privateDir,'maintenance-migration.js'),`import * as p from ${JSON.stringify(implementation)};export const readControlFloor=p.readControlFloor;export const assertRuntimeFloor=floor=>p.assertRuntimeFloor(floor,'1.5.0');`);
  writeFileSync(join(privateDir,'state.js'),transformSync(readFileSync(new URL('../src/state.ts',import.meta.url),'utf8'),{loader:'ts',format:'esm',target:'node24'}).code);
  const {State:BridgeState}=await import(pathToFileURL(join(privateDir,'state.js')).href);
  const old=new BridgeState(f.stateDir);old.close(); // v3 remains available to bridge.
  const targetPreflight=new State(f.stateDir);targetPreflight.close(); // Target may preflight v3.
  f.persist();policy.preparePi151Floor(f.home,f.stateDir,f.store,f.intent);
  const control=readFileSync(join(f.stateDir,'control.sqlite')),native=readFileSync(join(f.stateDir,'durable.sqlite'));
  assert.throws(()=>new BridgeState(f.stateDir),/forbids installed Pi 1.5.0 runtime/);
  assert.deepEqual(readFileSync(join(f.stateDir,'control.sqlite')),control);assert.deepEqual(readFileSync(join(f.stateDir,'durable.sqlite')),native);
  if(policy.installedDurableVersion()==='1.5.1'){const target=new State(f.stateDir);target.close();}
 }finally{await f.close();}
});
