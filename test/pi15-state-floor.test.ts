import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync,symlinkSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {transformSync} from 'esbuild';
import {State} from '../src/state.js';
import {State as Pi14State} from './fixtures/pi14-state.js';
import {controlSchema,migrateControl} from '../src/control-migrations.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {acquireOwner} from '../src/ownership.js';
import * as disabled from '../src/maintenance-migration.js';

// Synthetic positive pins exist ONLY in this private compiled copy. Production
// policy rejects these synthetic pairs; configuration/environment cannot pin it.
const from='a'.repeat(64),to='b'.repeat(64);
const stage=mkdtempSync(join(tmpdir(),'bob-pi15-state-policy-'));
after(()=>rmSync(stage,{recursive:true,force:true}));
writeFileSync(join(stage,'package.json'),'{"type":"module"}');
symlinkSync(fileURLToPath(new URL('../node_modules',import.meta.url)),join(stage,'node_modules'),'dir');
for(const file of ['maintenance-migration','ownership','state','control-migrations','runtime']){
 let source=readFileSync(new URL('../src/'+file+'.ts',import.meta.url),'utf8');
 if(file==='maintenance-migration'){
  const before=source;
  source=source.replace(/(const pi15Transitions[^\n]*=)Object\.freeze\([^\n]*\);/,`$1Object.freeze([{from:'${from}',to:'${to}'}]);`);
  assert.notEqual(source,before,'review private test pin seam if production declaration changes');
 }
 if(file==='runtime'){
  // Keep all unrelated runtime implementation/dependencies exactly as supplied.
  source=source.replace(/(['"])\.\/([^'"]+)\.js\1/g,(match,quote,name)=>['maintenance-migration','state','ownership'].includes(name)?match:quote+new URL('../src/'+name+'.ts',import.meta.url).href+quote);
 }
 writeFileSync(join(stage,file+'.js'),transformSync(source,{loader:'ts',format:'esm',target:'node24'}).code);
}
const enabled=await import(pathToFileURL(join(stage,'maintenance-migration.js')).href);
const {State:EnabledState}=await import(pathToFileURL(join(stage,'state.js')).href);
const enabledLifecycle=await import(pathToFileURL(join(stage,'control-migrations.js')).href);
const {openRuntime:enabledRuntime}=await import(pathToFileURL(join(stage,'runtime.js')).href);
function version(db:DatabaseSync){return Number(db.prepare('PRAGMA user_version').get()?.user_version);}
function mutate(dir:string,sql:string){const db=new DatabaseSync(join(dir,'control.sqlite'));try{db.exec(sql);}finally{db.close();}}
function freshFloor(state:State){const release=acquireOwner(state.dir);try{disabled.prepareFreshPi15Floor(state.dir);}finally{release();}}
function fixture(lifecycle=0){
 const dir=mkdtempSync(join(tmpdir(),'bob-pi15-floor-')),stateDir=join(dir,'state'),home=join(dir,'maintenance');
 const state=new State(stateDir);state.set('sentinel',{unchanged:true});
 if(lifecycle===2)migrateControl(state);
 else state.db.exec('PRAGMA user_version='+lifecycle);
 const id=state.id;state.close();mkdirSync(home);
 const db=new DatabaseSync(join(stateDir,'durable.sqlite'));
 db.exec('CREATE TABLE durable_schema(singleton INTEGER PRIMARY KEY,version INTEGER NOT NULL); INSERT INTO durable_schema VALUES(1,1);');db.close();
 const release=(name:string,durableVersion:string,compatibility:string)=>{
  const cli=join(dir,name,'dist','cli.js');mkdirSync(dirname(cli),{recursive:true});
  writeFileSync(join(dirname(dirname(cli)),'package.json'),JSON.stringify({name:'@bob-local/cli',dependencies:{'@earendil-works/pi-durable':durableVersion}}));
  return {id:name,cli,durableVersion,compatibility};
 };
 const previous=release('old','1.4.0',from),candidate=release('new','1.5.0',to);
 const intent={protocol:enabled.supervisorProtocol,previous,candidate,phase:'intent'};
 const values=new Map<string,unknown>([['migrationIntent',intent]]);
 const journal={get:(key:string)=>values.get(key),set:(key:string,value:unknown)=>{values.set(key,value);}};
 return {dir,stateDir,home,id,intent,journal,candidate,close(){rmSync(dir,{recursive:true,force:true});}};
}

for(const resume of [true,false])test(`legacy native v1 is rejected before native open (resume=${resume}) and ownership is released`,async()=>{
 const f=fixture();const state=new State(f.stateDir),native=readFileSync(join(f.stateDir,'durable.sqlite'));
 try{
  const lock=acquireOwner(f.stateDir);
  try{await assert.rejects(openRuntime(state,undefined,undefined,{resume}),/already owned/);}finally{lock();}
  await assert.rejects(openRuntime(state,undefined,undefined,{resume}),/Existing Durable state requires explicit Pi 1.5 maintenance migration/);
  assert.equal(version(state.db),0);assert.deepEqual(readFileSync(join(f.stateDir,'durable.sqlite')),native);
  assert.equal(disabled.readControlFloor(f.stateDir).kind,'legacy');
  const release=acquireOwner(f.stateDir);release();
 }finally{state.close();f.close();}
});

test('first native open establishes fresh origin under ownership; restart and old-code rejection preserve lifecycle',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bob-pi15-fresh-')),state=new State(dir);
 try{
  assert.equal(version(state.db),0);assert.equal(state.lifecycleSchemaVersion,0);assert.equal(controlSchema(state),1);
  const lock=acquireOwner(dir);
  try{await assert.rejects(openRuntime(state),/already owned/);assert.equal(version(state.db),0);assert.equal(existsSync(join(dir,'durable.sqlite')),false);}finally{lock();}
  const runtime=await openRuntime(state,undefined,undefined,{resume:false});
  const libraryId=runtime.library.id;await runtime.close();
  assert.deepEqual(disabled.readControlFloor(dir),{kind:'pi15-fresh',origin:'fresh',minDurable:'1.5.0',protocol:'bob-pi15-v1',lifecycleSchemaVersion:0});
  assert.equal(version(state.db),3);assert.equal(controlSchema(state),1);
  assert.throws(()=>new Pi14State(dir),/Unsupported newer control schema/);
  const reopened=await openRuntime(state,undefined,undefined,{resume:false});
  try{assert.equal(reopened.library.id,libraryId);}finally{await reopened.close();}
  const id=state.id;state.close();const reopenedState=new State(dir);
  try{assert.equal(reopenedState.id,id);assert.equal(reopenedState.lifecycleSchemaVersion,0);}finally{reopenedState.close();}
 }finally{try{state.close();}catch{}rmSync(dir,{recursive:true,force:true});}
});

for(const lifecycle of [0,1,2])for(const origin of ['fresh','migrated'])test(`${origin} floor retains lifecycle ${lifecycle}; pair/revoke and lifecycle migration never lower floor 3`,()=>{
 const f=fixture(lifecycle);let state:any;
 try{
  if(origin==='fresh'){
   rmSync(join(f.stateDir,'durable.sqlite'));state=new State(f.stateDir);freshFloor(state);
  }else{
   const native=readFileSync(join(f.stateDir,'durable.sqlite'));
   enabled.preparePi15Floor(f.home,f.stateDir,f.journal,f.intent);
   assert.deepEqual(readFileSync(join(f.stateDir,'durable.sqlite')),native);
   assert.throws(()=>new State(f.stateDir),/compiled exact allowlist/);
   state=new EnabledState(f.stateDir);
  }
  const floor=origin==='fresh'?disabled:enabled;
  assert.equal(state.id,f.id);assert.deepEqual(state.get('sentinel'),{unchanged:true});
  assert.equal(state.lifecycleSchemaVersion,lifecycle);assert.equal(enabledLifecycle.controlSchema(state),lifecycle||1);
  const pair=state.pair(state.invite().token,'Before lifecycle migration');state.revoke(pair.deviceId);
  const before=state.db.prepare('SELECT * FROM devices WHERE id=?').get(pair.deviceId);
  assert.equal(before.revoked,1);
  if(lifecycle===2){assert.equal(typeof before.created_at,'number');assert.equal(typeof before.revoked_at,'number');}
  else{assert.equal(before.created_at,undefined);assert.equal(before.revoked_at,undefined);}
  const result=enabledLifecycle.migrateControl(state);
  assert.equal(result.changed,lifecycle!==2);assert.equal(state.lifecycleSchemaVersion,2);assert.equal(version(state.db),3);
  assert.equal(floor.readControlFloor(f.stateDir).lifecycleSchemaVersion,2);
  const pair2=state.pair(state.invite().token,'After lifecycle migration');state.revoke(pair2.deviceId);
  const after=state.db.prepare('SELECT created_at,revoked_at FROM devices WHERE id=?').get(pair2.deviceId);
  assert.equal(typeof after.created_at,'number');assert.equal(typeof after.revoked_at,'number');
  if(lifecycle!==2)assert.equal(state.db.prepare('SELECT created_at FROM devices WHERE id=?').get(pair.deviceId).created_at,null);
  assert.throws(()=>new Pi14State(f.stateDir),/Unsupported newer control schema/);
 }finally{state?.close();f.close();}
});

test('recognized compiled migrated floor passes runtime barrier and opens native storage without resume',async()=>{
 const f=fixture();let state:any;
 try{
  // Use official 1.5 storage to exercise the positive runtime path without
  // inventing or rewriting a native schema version. The separate regression above
  // verifies that even a native v1 marker is never opened on the legacy path.
  rmSync(join(f.stateDir,'durable.sqlite'));state=new State(f.stateDir);
  const initial=await openRuntime(state,undefined,undefined,{resume:false}),root=initial.library.id;await initial.close();state.close();state=undefined;
  mutate(f.stateDir,'DROP TABLE maintenance_runtime_floor; PRAGMA user_version=0');
  enabled.preparePi15Floor(f.home,f.stateDir,f.journal,f.intent);state=new EnabledState(f.stateDir);
  const runtime=await enabledRuntime(state,undefined,undefined,{resume:false});
  try{assert.equal(runtime.library.id,root);}finally{await runtime.close();}
  assert.equal(enabled.readControlFloor(f.stateDir).kind,'pi15');
 }finally{state?.close();f.close();}
});

for(const corruption of ['unknown-version','missing-floor','mixed-floor','bad-origin','bad-protocol','bad-lifecycle','lifecycle-shape','missing-row','malformed-json'])test(`State fails closed before config writes for ${corruption}`,()=>{
 const dir=mkdtempSync(join(tmpdir(),'bob-pi15-corrupt-')),state=new State(dir);freshFloor(state);state.close();
 try{
  const sql:Record<string,string>={
   'unknown-version':'PRAGMA user_version=99',
   'missing-floor':'DROP TABLE maintenance_runtime_floor',
   'mixed-floor':'ALTER TABLE maintenance_runtime_floor ADD COLUMN from_fingerprint TEXT',
   'bad-origin':"PRAGMA ignore_check_constraints=ON; UPDATE maintenance_runtime_floor SET origin='migration'",
   'bad-protocol':"UPDATE maintenance_runtime_floor SET protocol='other'",
   'bad-lifecycle':'UPDATE maintenance_runtime_floor SET lifecycle_schema_version=9',
   'lifecycle-shape':'UPDATE maintenance_runtime_floor SET lifecycle_schema_version=2',
   'missing-row':'DELETE FROM maintenance_runtime_floor',
   'malformed-json':"UPDATE config SET value='not-json' WHERE key='identity'",
  };
  mutate(dir,sql[corruption]);const bytes=readFileSync(join(dir,'control.sqlite'));
  assert.throws(()=>new State(dir));assert.deepEqual(readFileSync(join(dir,'control.sqlite')),bytes);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('foreign control schema and absent control with existing native state are never bootstrapped',()=>{
 const dir=mkdtempSync(join(tmpdir(),'bob-pi15-foreign-'));
 try{
  const db=new DatabaseSync(join(dir,'control.sqlite'));
  db.exec("CREATE TABLE config(value TEXT,key TEXT); INSERT INTO config VALUES('preserved','foreign'); CREATE TABLE invites(hash TEXT,expires INTEGER,used INTEGER); CREATE TABLE devices(id TEXT,name TEXT,hash TEXT,revoked INTEGER)");db.close();
  const before=readFileSync(join(dir,'control.sqlite'));assert.throws(()=>new State(dir),/Unrecognized control table/);
  assert.deepEqual(readFileSync(join(dir,'control.sqlite')),before);
  rmSync(join(dir,'control.sqlite'));writeFileSync(join(dir,'durable.sqlite'),'existing');
  assert.throws(()=>new State(dir),/Missing control database/);assert.equal(existsSync(join(dir,'control.sqlite')),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('fresh supervisor floor requires manifest-proven exact 1.5 and no migration intent, never caller compatibility overrides',()=>{
 const f=fixture();const state=new State(f.stateDir);
 try{
  rmSync(join(f.stateDir,'durable.sqlite'));freshFloor(state);const floor=disabled.readControlFloor(f.stateDir);
  assert.doesNotThrow(()=>disabled.assertReleaseFloor(floor,f.candidate));
  assert.throws(()=>disabled.assertReleaseFloor(floor,{...f.candidate,durableVersion:'1.4.0'}),/floor forbids/);
  assert.throws(()=>disabled.assertReleaseFloor(floor,{...f.candidate,durableVersion:undefined}),/floor forbids/);
  assert.throws(()=>disabled.assertReleaseFloor(floor,f.candidate,f.intent),/must not have a migration intent/);
  writeFileSync(join(dirname(dirname(f.candidate.cli)),'package.json'),JSON.stringify({name:'@bob-local/cli',dependencies:{'@earendil-works/pi-durable':'1.4.0'}}));
  assert.throws(()=>disabled.assertReleaseFloor(floor,{...f.candidate,compatibility:'caller-override'}),/runtime identity/);
 }finally{state.close();f.close();}
});

for(const modules of ['[{"id":"old-unselected","selected":false}]','{}','null','not-json'])test(`customModules preflight rejects ${modules} before backup/floor without changing native DB or archives`,()=>{
 const f=fixture();
 try{
  const db=new DatabaseSync(join(f.stateDir,'control.sqlite'));db.prepare("INSERT INTO config VALUES('customModules',?)").run(modules);db.close();
  const archive=join(f.stateDir,'custom-modules','archived');mkdirSync(archive,{recursive:true});writeFileSync(join(archive,'index.js'),'immutable archive');
  const control=readFileSync(join(f.stateDir,'control.sqlite')),native=readFileSync(join(f.stateDir,'durable.sqlite'));
  assert.throws(()=>enabled.preparePi15Floor(f.home,f.stateDir,f.journal,f.intent),/custom-module migration|configuration JSON/);
  assert.deepEqual(readFileSync(join(f.stateDir,'control.sqlite')),control);assert.deepEqual(readFileSync(join(f.stateDir,'durable.sqlite')),native);
  assert.equal(readFileSync(join(archive,'index.js'),'utf8'),'immutable archive');assert.equal(existsSync(join(f.home,'backups')),false);
  assert.equal(f.journal.get('migrationIntent'),f.intent);const release=acquireOwner(f.stateDir);release();
 }finally{f.close();}
});

test('empty customModules is allowed; migrated metadata remains the original exact shape',()=>{
 const f=fixture();
 try{
  const state=new State(f.stateDir);state.set('customModules',[]);state.close();
  enabled.preparePi15Floor(f.home,f.stateDir,f.journal,f.intent);
  assert.deepEqual(enabled.readControlFloor(f.stateDir),{kind:'pi15',minDurable:'1.5.0',protocol:'bob-pi15-v1',from,to,migrationReleaseId:f.candidate.id,migrationCli:f.candidate.cli,lifecycleSchemaVersion:0});
 }finally{f.close();}
});
