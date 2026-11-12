import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {chmodSync,cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,statSync,symlinkSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {State} from '../src/state.js';
import {MaintenanceStore,MaintenanceSupervisor,type Release} from '../src/maintenance.js';
import {acquireOwner} from '../src/ownership.js';
import {patchSupervisorProtocol,pi150Fingerprint,pi151Fingerprint,prepareFreshPi151Floor,preparePi15Floor,preparePi151Floor,readControlFloor,supervisorProtocol} from '../src/maintenance-migration.js';
import {MaintenanceInstallError,installMaintenanceSupervisor,maintenanceHomeForBackend,planMaintenanceInstall,prepareMaintenanceInstall,renderMaintenanceService,rollbackMaintenanceInstall,type MaintenanceInstallOptions,type MaintenancePackageActions} from '../src/maintenance-install.js';

const roots:string[]=[];
after(()=>{for(const root of roots)rmSync(root,{recursive:true,force:true});});
const repository=new URL('..',import.meta.url).pathname;
function fixture({v4=true,native=true}:{v4?:boolean;native?:boolean}={}){
 const root=mkdtempSync(join(tmpdir(),'bob-supervisor-install-'));roots.push(root);
 const sourceRoot=join(root,'source'),runtimeRoot=sourceRoot,stateDir=join(root,'state');
 for(const file of ['package.json','src/control-migrations.ts','packages/core/src/documents.ts','packages/subagents/src/index.ts','packages/peers/src/index.ts','packages/interactive/src/index.ts']){mkdirSync(dirname(join(sourceRoot,file)),{recursive:true});cpSync(join(repository,file),join(sourceRoot,file));}
 writeFileSync(join(sourceRoot,'src/dirty-local-file.ts'),'// deliberately uncommitted owner edit\n');
 const manifest=JSON.parse(readFileSync(join(repository,'package.json'),'utf8'));
 for(const workspace of manifest.workspaces){mkdirSync(join(sourceRoot,workspace,'dist'),{recursive:true});cpSync(join(repository,workspace,'package.json'),join(sourceRoot,workspace,'package.json'));writeFileSync(join(sourceRoot,workspace,'dist/index.js'),'// compiled workspace '+workspace+'\n');}
 mkdirSync(join(runtimeRoot,'dist'),{recursive:true});writeFileSync(join(runtimeRoot,'package.json'),JSON.stringify(manifest));
 for(const name of ['cli.js','maintenance-loader.js','maintenance-runner.js','maintenance.js','maintenance-migration.js','ownership.js'])writeFileSync(join(runtimeRoot,'dist',name),'// current compiled fixture '+name+'\n');
 const currentCli=join(runtimeRoot,'dist/cli.js');
 const state=new State(stateDir);state.set('sentinel',{preserved:true});state.set('providerKey','owner-secret');state.pair(state.invite().token,'Existing phone');const backendId=state.id;state.close();
 if(v4){const owner=acquireOwner(stateDir);try{prepareFreshPi151Floor(stateDir,{id:'standalone',cli:currentCli,compatibility:pi151Fingerprint,durableVersion:'1.5.1'});}finally{owner();}}
 if(native){const db=new DatabaseSync(join(stateDir,'durable.sqlite'));db.exec("CREATE TABLE durable_schema(singleton INTEGER PRIMARY KEY,version INTEGER); INSERT INTO durable_schema VALUES(1,2); CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES('official state stays here')");db.close();}
 const options:MaintenanceInstallOptions={sourceRoot,currentCli,node:process.execPath,stateDir,home:maintenanceHomeForBackend(backendId,join(root,'maintenance')),origin:'http://127.0.0.1:49999',serveArgs:['--state',stateDir,'serve','--host','127.0.0.1','--port','49999'],unitDirectory:join(root,'units')};
 let packaged=0,verified=0;
 const actions:MaintenancePackageActions={compileSource:async({directory})=>{const snapshot=join(directory,'source-verification');cpSync(sourceRoot,snapshot,{recursive:true});return snapshot;},packageRuntime:async({directory})=>{
  packaged++;const installation=join(directory,'installation'),pkg=join(installation,'node_modules/@bob-local/cli');mkdirSync(dirname(pkg),{recursive:true});cpSync(runtimeRoot,pkg,{recursive:true});
  for(const workspace of manifest.workspaces){const pkgManifest=JSON.parse(readFileSync(join(sourceRoot,workspace,'package.json'),'utf8'));cpSync(join(sourceRoot,workspace),join(installation,'node_modules',pkgManifest.name),{recursive:true});}
  const durable=join(installation,'node_modules/@earendil-works/pi-durable');mkdirSync(durable,{recursive:true});writeFileSync(join(durable,'package.json'),JSON.stringify({name:'@earendil-works/pi-durable',version:'1.5.1'}));
  return join(pkg,'dist/cli.js');
 },verifyPackage:async()=>{verified++;}};
 const original=configuration(stateDir),nativeBytes=native?readFileSync(join(stateDir,'durable.sqlite')):undefined,floor=readControlFloor(stateDir);
 function preserved(){assert.deepEqual(configuration(stateDir),original);assert.deepEqual(readControlFloor(stateDir),floor);if(nativeBytes)assert.deepEqual(readFileSync(join(stateDir,'durable.sqlite')),nativeBytes);assert.equal(readFileSync(join(sourceRoot,'src/dirty-local-file.ts'),'utf8'),'// deliberately uncommitted owner edit\n');}
 return {root,sourceRoot,runtimeRoot,stateDir,backendId,options,actions,preserved,counts:()=>({packaged,verified})};
}
function configuration(state:string){const db=new DatabaseSync(join(state,'control.sqlite'),{readOnly:true});try{return Object.fromEntries(['config','devices','invites'].map(table=>[table,db.prepare('SELECT * FROM '+table+(table==='config'?" WHERE key!='maintenanceHome'":'')).all()]));}finally{db.close();}}
function managed(state:string){const db=new DatabaseSync(join(state,'control.sqlite'),{readOnly:true});try{const row=db.prepare("SELECT value FROM config WHERE key='maintenanceHome'").get();return row?JSON.parse(String(row.value)):undefined;}finally{db.close();}}
function mutate(state:string,sql:string){const db=new DatabaseSync(join(state,'control.sqlite'));try{db.exec(sql);}finally{db.close();}}

test('home is backend-scoped; service renderer quotes arguments and uses stable loader with restart-always',()=>{
 const id='00112233-4455-6677-8899-aabbccddeeff';assert.equal(maintenanceHomeForBackend(id,'/tmp/base'),'/tmp/base/'+id);
 const unit=renderMaintenanceService('/tmp/node $x%','/tmp/bob "home"',id);
 assert.match(unit,/Restart=always/);assert.match(unit,/TimeoutStopSec=45/);assert.match(unit,/maintenance-loader\.js/);assert.ok(unit.includes('$$x%%'));assert.ok(unit.includes('\\"home\\"'));
 assert.throws(()=>maintenanceHomeForBackend('../bad','/tmp'),/identity/);assert.throws(()=>renderMaintenanceService('/tmp/node\nExecStart=bad','/tmp/home',id),/control/);
});

test('real standalone v4: package, install, idempotency and metadata-only rollback preserve identity/credentials/Durable/floor/dirty source',async()=>{
 const f=fixture(),plan=planMaintenanceInstall(f.options),before=readFileSync(join(f.stateDir,'control.sqlite'));
 assert.deepEqual(readFileSync(join(f.stateDir,'control.sqlite')),before);assert.equal(existsSync(plan.home),false);
 const prepared=await prepareMaintenanceInstall(plan,f.actions);
 assert.equal(managed(f.stateDir),undefined);assert.deepEqual(f.counts(),{packaged:1,verified:1});f.preserved();
 const preparedAgain=await prepareMaintenanceInstall(plan,f.actions);assert.deepEqual(preparedAgain,prepared);assert.deepEqual(f.counts(),{packaged:1,verified:1});
 const result=await installMaintenanceSupervisor(prepared);assert.equal(result.alreadyInstalled,false);assert.equal(managed(f.stateDir),plan.home);
 assert.ok(result.backup);assert.equal(statSync(result.backup).mode&0o777,0o700);assert.equal(statSync(join(result.backup,'control.sqlite')).mode&0o777,0o600);assert.equal(managed(result.backup),undefined,'snapshot must precede maintenanceHome mutation');
 assert.deepEqual(readFileSync(join(result.backup,'durable.sqlite')),readFileSync(join(f.stateDir,'durable.sqlite')));assert.equal(readControlFloor(result.backup).kind,'pi151');
 assert.equal(existsSync(plan.unitFile),false,'core must not orchestrate or write services');
 assert.deepEqual(JSON.parse(readFileSync(join(plan.home,'config.json'),'utf8')),plan.config);assert.equal(statSync(join(plan.home,'config.json')).mode&0o777,0o600);
 const store=new MaintenanceStore(plan.home);assert.deepEqual(store.get('active'),prepared.release);assert.equal(store.get('migrationIntent'),undefined);assert.equal(store.get('patchMigrationIntent'),undefined);
 const supervisor=new MaintenanceSupervisor(plan.home,plan.config,store);assert.deepEqual(supervisor.recoveryRelease(),prepared.release);store.close();
 assert.equal((await installMaintenanceSupervisor(prepared)).alreadyInstalled,true);f.preserved();
 await rollbackMaintenanceInstall(prepared);assert.equal(managed(f.stateDir),undefined);assert.equal(JSON.parse(readFileSync(join(plan.home,'installation.json'),'utf8')).backup,result.backup);assert.ok(existsSync(result.backup));assert.ok(existsSync(prepared.release.cli),'immutable recovery release is retained');f.preserved();
 await rollbackMaintenanceInstall(prepared);await installMaintenanceSupervisor(prepared);f.preserved();
});

test('fresh State-created control DB is accepted without forging a runtime floor; supervisor performs genuine fresh bootstrap',async()=>{
 const f=fixture({v4:false,native:false}),p=await prepareMaintenanceInstall(planMaintenanceInstall(f.options),f.actions);
 await installMaintenanceSupervisor(p);assert.equal(readControlFloor(f.stateDir).kind,'legacy');f.preserved();
 const store=new MaintenanceStore(p.plan.home);try{const supervisor=new MaintenanceSupervisor(p.plan.home,p.plan.config,store);assert.equal(supervisor.recoveryRelease().id,p.release.id);assert.equal(readControlFloor(f.stateDir).kind,'pi151');}finally{store.close();}
 await rollbackMaintenanceInstall(p);assert.equal(managed(f.stateDir),undefined);assert.equal(readControlFloor(f.stateDir).kind,'pi151','rollback must never lower a committed floor');
});

test('preflight rejects live owner, managed foreign state, incompatible source/runtime and old native floors without mutation',()=>{
 const f=fixture(),lock=acquireOwner(f.stateDir);try{assert.throws(()=>planMaintenanceInstall(f.options),/no active owner/);}finally{lock();}
 mutate(f.stateDir,"INSERT INTO config VALUES('maintenanceHome','\"/another/home\"')");assert.throws(()=>planMaintenanceInstall(f.options),/managed elsewhere/);mutate(f.stateDir,"DELETE FROM config WHERE key='maintenanceHome'");
 assert.throws(()=>planMaintenanceInstall({...f.options,currentCli:join(f.runtimeRoot,'src/cli.ts')}),/compiled current/);
 const manifest=join(f.runtimeRoot,'package.json'),old=readFileSync(manifest);writeFileSync(manifest,old.toString().replace('1.5.1','1.5.0'));assert.throws(()=>planMaintenanceInstall(f.options),/supported Durable/);writeFileSync(manifest,old);
 const persistence=join(f.sourceRoot,'packages/core/src/documents.ts'),content=readFileSync(persistence);writeFileSync(persistence,content+'\n// incompatible\n');assert.throws(()=>planMaintenanceInstall(f.options),/persistence identity/);writeFileSync(persistence,content);f.preserved();
 const oldState=fixture({v4:false});assert.throws(()=>planMaintenanceInstall(oldState.options),/Existing native state/);oldState.preserved();
});

test('preflight rejects path overlap, service mismatch, symlink traversal, corrupt floors and misdirected serve arguments',()=>{
 const f=fixture();assert.throws(()=>planMaintenanceInstall({...f.options,home:join(f.stateDir,'maintenance')}),/disjoint/);
 assert.throws(()=>planMaintenanceInstall({...f.options,serveArgs:['serve']}),/must begin/);
 const file=join(f.options.unitDirectory,`bob-${f.backendId}.service`);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,'unknown manual service');assert.throws(()=>planMaintenanceInstall(f.options),/Existing service differs/);
 assert.doesNotThrow(()=>planMaintenanceInstall({...f.options,standaloneUnit:'unknown manual service'}));rmSync(file);
 const link=join(f.root,'linked-home');symlinkSync(f.options.home!,link);assert.throws(()=>planMaintenanceInstall({...f.options,home:link}),/symlink/);
 mutate(f.stateDir,"UPDATE maintenance_pi151_floor SET to_fingerprint='bad'");assert.throws(()=>planMaintenanceInstall(f.options),/corrupt/);
});

test('prepare rejects changed source and mismatched installed runtime; no state metadata committed',async()=>{
 const f=fixture(),plan=planMaintenanceInstall(f.options);writeFileSync(join(f.sourceRoot,'src/dirty-local-file.ts'),'changed');await assert.rejects(prepareMaintenanceInstall(plan,f.actions),/plan changed/);assert.equal(managed(f.stateDir),undefined);
 const g=fixture(),pack=g.actions.packageRuntime!;await assert.rejects(prepareMaintenanceInstall(planMaintenanceInstall(g.options),{...g.actions,packageRuntime:async input=>{const cli=await pack(input);writeFileSync(cli,'different compiled runtime');return cli;}}),/differs/);g.preserved();
 const h=fixture(),packageH=h.actions.packageRuntime!;await assert.rejects(prepareMaintenanceInstall(planMaintenanceInstall(h.options),{...h.actions,packageRuntime:async input=>{const cli=await packageH(input);writeFileSync(join(input.directory,'installation/node_modules/@earendil-works/pi-durable/package.json'),'{"name":"@earendil-works/pi-durable","version":"1.5.0"}');return cli;}}),/native Durable package identity/);h.preserved();
 const j=fixture();await assert.rejects(prepareMaintenanceInstall(planMaintenanceInstall(j.options),{...j.actions,verifyPackage:async()=>{writeFileSync(join(j.sourceRoot,'src/during-build.ts'),'// edit');}}),/Source changed/);assert.equal(managed(j.stateDir),undefined);
});

test('commit rechecks owners and immutable runtime, including hoisted dependencies',async()=>{
 const f=fixture(),p=await prepareMaintenanceInstall(planMaintenanceInstall(f.options),f.actions),lock=acquireOwner(f.stateDir);
 try{await assert.rejects(installMaintenanceSupervisor(p),/offline state ownership/);}finally{lock();}f.preserved();assert.equal(managed(f.stateDir),undefined);
 // Locate hoisted native dependency inside the immutable installation tree.
 const installation=p.release.cli.split('/node_modules/@bob-local/cli/')[0];writeFileSync(join(installation,'node_modules/@earendil-works/pi-durable/package.json'),'{"version":"tampered"}');
 await assert.rejects(installMaintenanceSupervisor(p),/runtime changed/);assert.equal(managed(f.stateDir),undefined);f.preserved();
});

test('commit failure rolls back only install-owned metadata; existing deployment files are never removed',async()=>{
 const f=fixture(),p=await prepareMaintenanceInstall(planMaintenanceInstall(f.options),f.actions);
 const trigger=new DatabaseSync(join(f.stateDir,'control.sqlite'));trigger.exec("CREATE TRIGGER reject_install BEFORE INSERT ON config WHEN NEW.key='maintenanceHome' BEGIN SELECT RAISE(ABORT,'injected commit failure'); END");trigger.close();
 await assert.rejects(installMaintenanceSupervisor(p),/metadata rolled back/);assert.equal(managed(f.stateDir),undefined);f.preserved();
 for(const name of ['config.json','journal.sqlite','maintenance-loader.js'])assert.equal(existsSync(join(p.plan.home,name)),false);
 mutate(f.stateDir,'DROP TRIGGER reject_install');
 writeFileSync(join(p.plan.home,'config.json'),'owner evidence');await assert.rejects(installMaintenanceSupervisor(p),/rollback was not verified|refusing to overwrite/);assert.equal(readFileSync(join(p.plan.home,'config.json'),'utf8'),'owner evidence');rmSync(join(p.plan.home,'config.json'));
 await installMaintenanceSupervisor(p);f.preserved();
});

test('explicit rollback refuses live owner, accepted update work, and foreign maintenanceHome',async()=>{
 const f=fixture(),p=await prepareMaintenanceInstall(planMaintenanceInstall(f.options),f.actions);await installMaintenanceSupervisor(p);
 const lock=acquireOwner(f.stateDir);try{await assert.rejects(rollbackMaintenanceInstall(p),/already owned/);}finally{lock();}
 const store=new MaintenanceStore(p.plan.home);store.enqueue({id:'accepted-job',action:'build',target:'backend'});store.close();await assert.rejects(rollbackMaintenanceInstall(p),/accepted work/);assert.equal(managed(f.stateDir),p.plan.home);f.preserved();
});

function migratedFixture(){
 const f=fixture({v4:false,native:false}),evidenceHome=join(f.root,'retained-journal'),store=new MaintenanceStore(evidenceHome);
 function release(id:string,version:string,compatibility:string):Release{const root=join(f.root,id);mkdirSync(join(root,'dist'),{recursive:true});writeFileSync(join(root,'dist/cli.js'),'// retained migration package\n');writeFileSync(join(root,'package.json'),JSON.stringify({name:'@bob-local/cli',dependencies:{'@earendil-works/pi-durable':version}}));return {id,cli:join(root,'dist/cli.js'),durableVersion:version,compatibility};}
 const original=release('pi14','1.4.0','328bbd2b3ec5505199382f781d7dc2dc5359e17b8356c92daef8be53155f8003'),bridge=release('bridge','1.5.0',pi150Fingerprint),candidate:Release={id:'standalone-migrated',cli:f.options.currentCli,durableVersion:'1.5.1',compatibility:pi151Fingerprint};
 // Genuine reviewed migration helpers create the actual v3/v4 floors.
 const native=new DatabaseSync(join(f.stateDir,'durable.sqlite'));native.exec('CREATE TABLE durable_schema(singleton INTEGER PRIMARY KEY,version INTEGER); INSERT INTO durable_schema VALUES(1,2); CREATE TABLE preserved(value TEXT); INSERT INTO preserved VALUES(42)');native.close();
 store.set('migrationIntent',{protocol:supervisorProtocol,previous:original,candidate:bridge,phase:'intent'});preparePi15Floor(evidenceHome,f.stateDir,store,store.get('migrationIntent')!);store.set('migrationIntent',{...store.get<any>('migrationIntent'),phase:'complete'});
 store.set('patchMigrationIntent',{protocol:patchSupervisorProtocol,previous:bridge,candidate,phase:'intent'});preparePi151Floor(evidenceHome,f.stateDir,store,store.get('patchMigrationIntent')!);store.set('patchMigrationIntent',{...store.get<any>('patchMigrationIntent'),phase:'complete'});
 const intents={migrationIntent:store.get('migrationIntent'),patchMigrationIntent:store.get('patchMigrationIntent')};store.close();
 return {...f,evidenceHome,intents,bridge,candidate};
}

test('migration-origin v4 requires retained matching historical journal and preserves exact CLI identities',async()=>{
 const f=migratedFixture(),floor=readControlFloor(f.stateDir),native=readFileSync(join(f.stateDir,'durable.sqlite')),control=configuration(f.stateDir);
 assert.equal(floor.kind,'pi151');assert.throws(()=>planMaintenanceInstall(f.options),/persistent patch migration intent/);
 const options={...f.options,retainedJournalHome:f.evidenceHome},p=await prepareMaintenanceInstall(planMaintenanceInstall(options),f.actions);await installMaintenanceSupervisor(p);
 const store=new MaintenanceStore(p.plan.home);try{assert.deepEqual(store.get('migrationIntent'),f.intents.migrationIntent);assert.deepEqual(store.get('patchMigrationIntent'),f.intents.patchMigrationIntent);const supervisor=new MaintenanceSupervisor(p.plan.home,p.plan.config,store);assert.equal(supervisor.recoveryRelease().id,p.release.id);}finally{store.close();}
 assert.deepEqual(readControlFloor(f.stateDir),floor);assert.deepEqual(configuration(f.stateDir),control);assert.deepEqual(readFileSync(join(f.stateDir,'durable.sqlite')),native);
 await rollbackMaintenanceInstall(p);assert.deepEqual(readControlFloor(f.stateDir),floor);assert.deepEqual(readFileSync(join(f.stateDir,'durable.sqlite')),native);assert.ok(existsSync(f.candidate.cli));assert.ok(existsSync(f.bridge.cli));
});

test('mismatched or missing migration evidence fails closed without manufacturing journal history',()=>{
 const f=migratedFixture(),store=new MaintenanceStore(f.evidenceHome);store.set('patchMigrationIntent',{...store.get<any>('patchMigrationIntent'),candidate:{...f.candidate,id:'different-id'}});store.close();
 assert.throws(()=>planMaintenanceInstall({...f.options,retainedJournalHome:f.evidenceHome}),/identity mismatch/);assert.equal(managed(f.stateDir),undefined);assert.equal(existsSync(f.options.home!),false);
 const g=migratedFixture();rmSync(g.bridge.cli);assert.throws(()=>planMaintenanceInstall({...g.options,retainedJournalHome:g.evidenceHome}),/ENOENT/);assert.equal(managed(g.stateDir),undefined);
});


test('explicit live preparation stages only code; commit refuses until standalone ownership is released',async()=>{
 const f=fixture(),lock=acquireOwner(f.stateDir);let p;
 try{const options={...f.options,allowLivePreparation:true};const plan=planMaintenanceInstall(options);p=await prepareMaintenanceInstall(plan,f.actions);assert.equal(managed(f.stateDir),undefined);f.preserved();await assert.rejects(installMaintenanceSupervisor(p),/offline state ownership/);}
 finally{lock();}
 await installMaintenanceSupervisor(p!);assert.equal(managed(f.stateDir),p!.plan.home);f.preserved();
});


test('verified backup failure aborts before any deployment metadata or state mutation',async()=>{
 const f=fixture(),p=await prepareMaintenanceInstall(planMaintenanceInstall(f.options),f.actions);
 symlinkSync(join(f.root,'outside-artifacts'),join(f.stateDir,'artifacts'));
 await assert.rejects(installMaintenanceSupervisor(p),error=>error instanceof MaintenanceInstallError&&error.recoverySafe&&(error.cause as Error).message.includes('Backup refuses symlinks'));
 assert.equal(managed(f.stateDir),undefined);for(const name of ['config.json','journal.sqlite','maintenance-loader.js'])assert.equal(existsSync(join(p.plan.home,name)),false);f.preserved();
 assert.equal(JSON.parse(readFileSync(join(p.plan.home,'installation.json'),'utf8')).phase,'prepared');
});

test('default packaging resolves npm with the selected private Node bin first, not the caller PATH',async()=>{
 const f=fixture(),bin=join(f.root,'private-node'),marker=join(f.root,'selected-npm-ran');mkdirSync(bin);symlinkSync(process.execPath,join(bin,'node'));
 writeFileSync(join(bin,'npm'),'#!/bin/sh\nprintf selected > '+JSON.stringify(marker)+'\nexit 17\n');chmodSync(join(bin,'npm'),0o700);
 const plan=planMaintenanceInstall({...f.options,node:join(bin,'node')});
 await assert.rejects(prepareMaintenanceInstall(plan,{compileSource:f.actions.compileSource}),/Packaging command failed \(17\)/);assert.equal(readFileSync(marker,'utf8'),'selected');assert.equal(managed(f.stateDir),undefined);f.preserved();
});


test('isolated source provenance rejects stale root output and stale/mutated bundled workspace output',async()=>{
 const f=fixture();await assert.rejects(prepareMaintenanceInstall(planMaintenanceInstall(f.options),{...f.actions,compileSource:async input=>{const compiled=await f.actions.compileSource!(input);writeFileSync(join(compiled,'dist/cli.js'),'// newly compiled source differs');return compiled;}}),/Root compiled runtime/);
 const g=fixture();await assert.rejects(prepareMaintenanceInstall(planMaintenanceInstall(g.options),{...g.actions,compileSource:async input=>{const compiled=await g.actions.compileSource!(input);writeFileSync(join(compiled,'packages/core/dist/index.js'),'// source emitted different workspace');return compiled;}}),/Workspace compiled runtime/);
 const h=fixture();await assert.rejects(prepareMaintenanceInstall(planMaintenanceInstall(h.options),{...h.actions,packageRuntime:async input=>{const cli=await h.actions.packageRuntime!(input);const installation=cli.split('/node_modules/@bob-local/cli/')[0];writeFileSync(join(installation,'node_modules/@bob-local/core/dist/index.js'),'// corrupt installed workspace');return cli;}}),/Packaged workspace/);
 assert.throws(()=>planMaintenanceInstall({...h.options,currentCli:join(repository,'dist/cli.js')}),/must belong to sourceRoot/);f.preserved();g.preserved();h.preserved();
});

test('typed recovery authorization is issued only for verified clean rollback, not existing/unclean metadata',async()=>{
 const f=fixture(),p=await prepareMaintenanceInstall(planMaintenanceInstall(f.options),f.actions);
 mutate(f.stateDir,"CREATE TRIGGER deny_install BEFORE INSERT ON config WHEN NEW.key='maintenanceHome' BEGIN SELECT RAISE(ABORT,'fail'); END");
 await assert.rejects(installMaintenanceSupervisor(p),error=>error instanceof MaintenanceInstallError&&error.recoverySafe);
 mutate(f.stateDir,'DROP TRIGGER deny_install');writeFileSync(join(p.plan.home,'config.json'),'retained foreign metadata');
 await assert.rejects(installMaintenanceSupervisor(p),error=>error instanceof MaintenanceInstallError&&!error.recoverySafe);
 assert.equal(readFileSync(join(p.plan.home,'config.json'),'utf8'),'retained foreign metadata');f.preserved();
});

const referenceEvidence={certificate:'Signer #1 certificate SHA-256 digest: '+'a'.repeat(64),badging:"package: name='com.bobmobile' versionCode='178' versionName='0.3.175' platformBuildVersionName='x'"};
test('verified reference APK is copied immutably and seeds latestApk version178 for the first real upgrade',async()=>{
 const f=fixture(),apk=join(f.root,'reference.apk');writeFileSync(apk,'signed-fixture-owner-apk');
 const options={...f.options,referenceApk:apk,androidHome:join(f.root,'sdk')};
 const p=await prepareMaintenanceInstall(planMaintenanceInstall(options),{...f.actions,inspectReferenceApk:async()=>referenceEvidence});
 assert.equal(p.release.apk?.versionCode,178);assert.equal(p.release.apk?.versionName,'0.3.175');assert.notEqual(p.release.apk?.path,apk);assert.deepEqual(readFileSync(p.release.apk!.path),readFileSync(apk));
 await installMaintenanceSupervisor(p);const store=new MaintenanceStore(p.plan.home);try{assert.deepEqual(store.get('latestApk'),p.release);assert.deepEqual(store.get('release:'+p.release.id),p.release);}finally{store.close();}
 writeFileSync(apk,'owner may replace external reference later');assert.equal(readFileSync(p.release.apk!.path,'utf8'),'signed-fixture-owner-apk');await rollbackMaintenanceInstall(p);assert.ok(existsSync(p.release.apk!.path));f.preserved();
});

test('reference APK fails closed without SDK, wrong package/signature/version, or copied-byte integrity',async()=>{
 const f=fixture(),apk=join(f.root,'reference.apk');writeFileSync(apk,'apk fixture');
 await assert.rejects(prepareMaintenanceInstall(planMaintenanceInstall({...f.options,referenceApk:apk}),f.actions),/build-tools are required/);
 for(const evidence of [{...referenceEvidence,certificate:'unsigned'},{...referenceEvidence,badging:referenceEvidence.badging.replace('com.bobmobile','com.other')},{...referenceEvidence,badging:referenceEvidence.badging.replace("'178'","'9007199254740992'")}]){
  const g=fixture();await assert.rejects(prepareMaintenanceInstall(planMaintenanceInstall({...g.options,referenceApk:apk,androidHome:join(g.root,'sdk')}),{...g.actions,inspectReferenceApk:async()=>evidence}),/Reference APK package/);g.preserved();
 }
 const h=fixture(),p=await prepareMaintenanceInstall(planMaintenanceInstall({...h.options,referenceApk:apk,androidHome:join(h.root,'sdk')}),{...h.actions,inspectReferenceApk:async()=>referenceEvidence});writeFileSync(p.release.apk!.path,'tampered');await assert.rejects(installMaintenanceSupervisor(p),/Reference APK changed/);assert.equal(managed(h.stateDir),undefined);
});

// Keep both production entry points aligned; the builder fixture additionally
// checks the actual subprocess argv, and host fixtures exercise real npm packaging.
test('runtime packaging allows bounded registry cache misses before handover without package scripts',()=>{
 for(const file of ['maintenance-install.ts','maintenance-build.ts']){
  const source=readFileSync(join(repository,'src',file),'utf8');
  assert.match(source,/\['install','--prefer-offline','--fetch-retries=1','--fetch-timeout=30000','--ignore-scripts'/,file);
  assert.doesNotMatch(source,/\['install','--offline'/,file);
 }
});
