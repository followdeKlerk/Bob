import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync,existsSync,readdirSync,cpSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {transformSync} from 'esbuild';
import {Harness,createRegistry,defineDoc,defineTask,defineExtension} from '@earendil-works/pi-durable';
import {openNodeSqliteStorage} from '@earendil-works/pi-durable/storage/sqlite/node';
import {createModels} from '@earendil-works/pi-ai/models';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';
import {State} from '../src/state.js';
import {migrateControl} from '../src/control-migrations.js';
import {prepareFreshPi15Floor,prepareFreshPi151Floor,pi151Fingerprint,readControlFloor} from '../src/maintenance-migration.js';
import {acquireOwner} from '../src/ownership.js';
import {backupState,restoreState,installedDurableVersion} from '../src/recovery.js';

const RecoveryDoc=defineDoc<{text:string}>({kind:'pi15.recovery-fixture',version:1,scope:'conversation',history:'rewindable',fork:'current',initial:()=>({text:''}),checkpointWhen:()=>true});
const HeldTask=defineTask<null,{phase:'held'},null>({name:'pi15.recovery-held',version:1,initial:()=>({phase:'held'}),phases:{held:async()=>{throw Error('Restore must never execute this paused task');}},abort:async()=>{}});
const FixtureExtension=defineExtension({name:'pi15.recovery-fixture',tasks:[HeldTask]});
const checksum=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
async function nativeOpen(directory:string) {
  const registry=createRegistry(); registry.install(FixtureExtension);
  return Harness.open(await openNodeSqliteStorage(join(directory,'durable.sqlite')),{registry,models:createModels(),settings:{extensions:[FixtureExtension]}},ctx);
}
async function fixture(patchFloor=false) {
  const dir=mkdtempSync(join(tmpdir(),'bob-pi15-recovery-')),state=new State(join(dir,'source'));
  migrateControl(state);
  const grant=state.pair(state.invite().token,'Recovery fixture phone');
  state.set('recoverySentinel',{text:'configured',revision:7});
  const release=acquireOwner(state.dir);
  try {
    if(patchFloor)prepareFreshPi151Floor(state.dir,{id:'recovery-fixture',cli:join(dir,'fixture/dist/cli.js'),durableVersion:'1.5.1',compatibility:pi151Fingerprint});
    else prepareFreshPi15Floor(state.dir);
  } finally { release(); }
  const native=await nativeOpen(state.dir);
  try {
    const c=await native.createConversation({ownership:{kind:'ownerless'}},ctx);
    await c.submit({type:'write',entry:{kind:'pi15.recovery-entry',data:{text:'native 1.5 history'}}},ctx);
    const taskId=await c.commit(async tx=>{
      (await tx.doc(RecoveryDoc,c.id)).text='native document survives';
      return tx.createTask(HeldTask,null,{ownership:{kind:'conversation'}});
    },ctx);
    mkdirSync(join(state.dir,'artifacts')); writeFileSync(join(state.dir,'artifacts/original.bin'),Buffer.from([0,1,17,255]));
    mkdirSync(join(state.dir,'custom-modules')); writeFileSync(join(state.dir,'custom-modules/archive.tgz'),'original package archive bytes');
    return {dir,state,grant,conversationId:c.id,taskId};
  } catch(error) { state.close(); rmSync(dir,{recursive:true,force:true}); throw error; }
  finally { await native.close(ctx); }
}
function changeControl(backup:string,sql:string) {
  const db=new DatabaseSync(join(backup,'control.sqlite'));
  try { db.exec(sql); } finally { db.close(); }
  const manifest=JSON.parse(readFileSync(join(backup,'manifest.json'),'utf8'));
  manifest.files['control.sqlite']=checksum(join(backup,'control.sqlite'));
  writeFileSync(join(backup,'manifest.json'),JSON.stringify(manifest));
}
function payloadBytes(directory:string,files:Record<string,string>) {
  return Object.fromEntries(Object.keys(files).map(name=>[name,readFileSync(join(directory,name))]));
}

test('actual pinned native 1.5 backup/restore is byte-preserving, read-only until explicit reopen, and retains history/documents/tasks/grants',async()=>{
  assert.equal(JSON.parse(readFileSync(new URL('../package.json',import.meta.resolve('@earendil-works/pi-durable')),'utf8')).version,installedDurableVersion());
  const f=await fixture(),backup=join(f.dir,'backup'),destination=join(f.dir,'restored');
  try {
    const manifest=await backupState(f.state,backup);
    assert.equal(manifest.format,2); assert.equal(manifest.durable,installedDurableVersion());
    assert.equal(manifest.controlSchemaVersion,3); assert.equal(manifest.lifecycleSchemaVersion,2);
    assert.deepEqual(manifest.floor,readControlFloor(f.state.dir,true));
    const before=payloadBytes(backup,manifest.files);
    restoreState(backup,destination);
    assert.deepEqual(payloadBytes(destination,manifest.files),before,'restore must not change either SQLite database or payload bytes');
    assert.equal(existsSync(join(destination,'owner.sqlite')),false,'restore never constructs an owner/runtime');
    // SQLite may create empty WAL/SHM caches even for read-only WAL-mode snapshots;
    // these are not authority and must contain no native/control transactions.
    assert.deepEqual(readdirSync(destination).filter(name=>!/-wal$|-shm$/.test(name)).sort(),['artifacts','control.sqlite','custom-modules','durable.sqlite']);
    for(const name of ['control.sqlite-wal','durable.sqlite-wal']) if(existsSync(join(destination,name))) assert.equal(readFileSync(join(destination,name)).length,0);
    const restored=new State(destination);
    try {
      assert.equal(restored.id,f.state.id); assert.equal(restored.lifecycleSchemaVersion,2);
      assert.deepEqual(restored.get('recoverySentinel'),{text:'configured',revision:7});
      assert.equal(restored.authenticate(f.grant.credential)?.id,f.grant.deviceId);
      const h=await nativeOpen(destination);
      try {
        const c=await h.conversation(f.conversationId,ctx); assert.ok(c);
        assert.ok((await c.entries({},100,undefined,ctx)).items.some(e=>e.kind==='pi15.recovery-entry' && (e.data as any).text==='native 1.5 history'));
        assert.equal((await h.snapshot(RecoveryDoc,f.conversationId,ctx))?.text,'native document survives');
        const task=await h.getTask(f.taskId,ctx); assert.ok(task); assert.equal(task.state.status,'pending');
      } finally { await h.close(ctx); }
    } finally { restored.close(); }
    assert.deepEqual(payloadBytes(backup,manifest.files),before,'restore/reopen must leave the export immutable');
    const existing=payloadBytes(destination,manifest.files);
    assert.throws(()=>restoreState(backup,destination),/never overwrites/);
    assert.deepEqual(payloadBytes(destination,manifest.files),existing,'overwrite refusal must preserve existing state');
  } finally { f.state.close(); rmSync(f.dir,{recursive:true,force:true}); }
});

test('strict format-2 metadata refuses runtime, control, lifecycle, identity and floor forgery before any destination is created',async()=>{
  const f=await fixture(),backup=join(f.dir,'backup');
  try {
    const original=await backupState(f.state,backup),bytes=payloadBytes(backup,original.files),manifestPath=join(backup,'manifest.json');
    const cases:[string,unknown,RegExp][]=[
      ['native-as-pi14',{...original,durable:'1.4.0'},/1.5.0/],
      ['future-runtime',{...original,durable:'1.6.0'},/1.5.0/],
      ['future-format',{...original,format:3},/2/],
      ['future-control',{...original,controlSchemaVersion:5},/Invalid/],
      ['control-disagreement',{...original,controlSchemaVersion:2},/control\/lifecycle metadata mismatch/],
      ['lifecycle-disagreement',{...original,lifecycleSchemaVersion:1},/control\/lifecycle metadata mismatch/],
      ['future-lifecycle',{...original,lifecycleSchemaVersion:3},/Invalid/],
      ['identity-forgery',{...original,backendId:'00000000-0000-4000-8000-000000000001'},/identity mismatch/],
      ['floor-disagreement',{...original,floor:{...original.floor,lifecycleSchemaVersion:1}},/floor metadata mismatch/],
      ['missing-floor',(({floor:_,...rest})=>rest)(original),/Invalid/],
      ['unknown-floor',{...original,floor:{...original.floor,kind:'future'}},/Invalid/],
      ['extra-field',{...original,forceMigration:true},/Unrecognized/],
    ];
    for(const [label,manifest,pattern] of cases) {
      writeFileSync(manifestPath,JSON.stringify(manifest)); const destination=join(f.dir,label);
      assert.throws(()=>restoreState(backup,destination),pattern,label); assert.equal(existsSync(destination),false,label);
      assert.deepEqual(payloadBytes(backup,original.files),bytes,label+' must not change native/control bytes');
    }
  } finally { f.state.close(); rmSync(f.dir,{recursive:true,force:true}); }
});

test('native 1.5 payload with missing, unknown or unreviewed migrated control floor is refused read-only even with recomputed checksums',async()=>{
  const f=await fixture(),backup=join(f.dir,'backup');
  try {
    const manifest=await backupState(f.state,backup);
    const cases:[string,string,RegExp][]=[
      ['missing-floor','DROP TABLE maintenance_runtime_floor; PRAGMA user_version=2',/committed control floor/],
      ['unknown-control','PRAGMA user_version=99',/Unknown control floor/],
      ['unknown-lifecycle','UPDATE maintenance_runtime_floor SET lifecycle_schema_version=99',/floor metadata/],
      ['forged-migrated-floor',`DROP TABLE maintenance_runtime_floor;
        CREATE TABLE maintenance_runtime_floor(singleton INTEGER PRIMARY KEY,min_durable TEXT,protocol TEXT,from_fingerprint TEXT,to_fingerprint TEXT,migration_release_id TEXT,migration_cli TEXT,lifecycle_schema_version INTEGER);
        INSERT INTO maintenance_runtime_floor VALUES(1,'1.5.0','bob-pi15-v1','${'a'.repeat(64)}','${'b'.repeat(64)}','forged','/forged/cli',2)`,/compiled exact allowlist/],
    ];
    for(const [label,sql,pattern] of cases) {
      const altered=join(f.dir,label+'-export'); cpSync(backup,altered,{recursive:true}); changeControl(altered,sql);
      const before=payloadBytes(altered,manifest.files),destination=join(f.dir,label+'-restore');
      assert.throws(()=>restoreState(altered,destination),pattern); assert.equal(existsSync(destination),false);
      assert.deepEqual(payloadBytes(altered,manifest.files),before);
    }
    // The export path also fails before creating a misleading backup, even though this
    // live State was constructed before the fixture's floor was deliberately removed.
    f.state.db.exec('DROP TABLE maintenance_runtime_floor; PRAGMA user_version=2');
    const before=readFileSync(join(f.state.dir,'durable.sqlite')),destination=join(f.dir,'bad-export');
    await assert.rejects(backupState(f.state,destination),/committed control floor/);
    assert.equal(existsSync(destination),false); assert.deepEqual(readFileSync(join(f.state.dir,'durable.sqlite')),before);
  } finally { f.state.close(); rmSync(f.dir,{recursive:true,force:true}); }
});

test('historical format-1 Pi 1.4 export is rejected with explicit matching-release migration guidance, never silently opened or relabeled',async()=>{
  const f=await fixture(),backup=join(f.dir,'backup');
  try {
    const current=await backupState(f.state,backup);
    const historical={format:1,bob:'0.3.0',durable:'1.4.0',backendId:current.backendId,createdAt:current.createdAt,coverage:current.coverage,files:current.files};
    const manifestPath=join(backup,'manifest.json');writeFileSync(manifestPath,JSON.stringify(historical));
    const before=payloadBytes(backup,current.files),destination=join(f.dir,'old-export');
    assert.throws(()=>restoreState(backup,destination),/matching Pi 1.4 Bob release.*fresh destination.*explicit migration/);
    assert.equal(existsSync(destination),false); assert.deepEqual(payloadBytes(backup,current.files),before);
    writeFileSync(manifestPath,JSON.stringify({...historical,durable:'1.5.0'}));
    assert.throws(()=>restoreState(backup,join(f.dir,'relabeled-old-export')),/will not restore or relabel/);
    assert.deepEqual(payloadBytes(backup,current.files),before);
  } finally { f.state.close(); rmSync(f.dir,{recursive:true,force:true}); }
});

test('migrated format-2 floor restores only under the same compiled exact pair policy and preserves lifecycle/native bytes',async()=>{
  const f=await fixture(),stage=join(f.dir,'compiled-recovery');
  try {
    mkdirSync(stage); writeFileSync(join(stage,'package.json'),'{"type":"module"}');
    symlinkSync(fileURLToPath(new URL('../node_modules',import.meta.url)),join(stage,'node_modules'),'dir');
    const from='a'.repeat(64),to='b'.repeat(64);
    // Positive policy exists ONLY in this disposable compiled copy. No runtime
    // request, env variable or persisted manifest can authorize production pairs.
    for(const name of ['recovery','maintenance-migration','ownership']) {
      let source=readFileSync(new URL('../src/'+name+'.ts',import.meta.url),'utf8');
      if(name==='maintenance-migration') {
        const before=source;
        source=source.replace(/(const pi15Transitions[^\n]*=)Object\.freeze\([^\n]*\);/,`$1Object.freeze([{from:'${from}',to:'${to}'}]);`);
        assert.notEqual(source,before,'review private compiled policy seam if production declaration changes');
      }
      writeFileSync(join(stage,name+'.js'),transformSync(source,{loader:'ts',format:'esm',target:'node24'}).code);
    }
    const policy=await import(pathToFileURL(join(stage,'maintenance-migration.js')).href);
    const recovery=await import(pathToFileURL(join(stage,'recovery.js')).href);
    const nativeBefore=readFileSync(join(f.state.dir,'durable.sqlite'));
    // Build a legacy-control fixture around already official native 1.5 bytes;
    // never rewrite or forge the native SQLite schema/version for migration tests.
    f.state.db.exec('DROP TABLE maintenance_runtime_floor; PRAGMA user_version=2');
    const release=(id:string,version:string,compatibility:string)=>{
      const root=join(f.dir,id);mkdirSync(join(root,'dist'),{recursive:true});
      writeFileSync(join(root,'package.json'),JSON.stringify({name:'@bob-local/cli',dependencies:{'@earendil-works/pi-durable':version}}));
      return {id,cli:join(root,'dist/cli.js'),durableVersion:version,compatibility};
    };
    const intent={protocol:policy.supervisorProtocol,previous:release('old','1.4.0',from),candidate:release('candidate','1.5.0',to),phase:'intent'};
    const values=new Map<string,unknown>([['migrationIntent',intent]]),journal={get:(key:string)=>values.get(key),set:(key:string,value:unknown)=>{values.set(key,value);}};
    const home=join(f.dir,'maintenance');mkdirSync(home);
    policy.preparePi15Floor(home,f.state.dir,journal,intent);
    assert.deepEqual(readFileSync(join(f.state.dir,'durable.sqlite')),nativeBefore);
    const backup=join(f.dir,'migrated-export'),manifest=await recovery.backupState(f.state,backup);
    assert.equal(manifest.floor.kind,'pi15');assert.equal(manifest.controlSchemaVersion,3);assert.equal(manifest.lifecycleSchemaVersion,2);
    assert.deepEqual(manifest.floor,policy.readControlFloor(f.state.dir));
    const before=payloadBytes(backup,manifest.files),destination=join(f.dir,'migrated-restore');
    recovery.restoreState(backup,destination);assert.deepEqual(payloadBytes(destination,manifest.files),before);
    assert.throws(()=>restoreState(backup,join(f.dir,'production-rejects-unreviewed')),/compiled exact allowlist/);
    assert.equal(existsSync(join(f.dir,'production-rejects-unreviewed')),false);
    const reopened=await nativeOpen(destination);
    try {assert.equal((await reopened.snapshot(RecoveryDoc,f.conversationId,ctx))?.text,'native document survives');}
    finally {await reopened.close(ctx);}
  } finally {f.state.close();rmSync(f.dir,{recursive:true,force:true});}
});

test('reviewed 1.5.0 and 1.5.1 export metadata restores read-only without relabeling payloads or granting runtime-open permission',async()=>{
 const f=await fixture(),backup=join(f.dir,'backup');
 try{
  const manifest=await backupState(f.state,backup),bytes=payloadBytes(backup,manifest.files),path=join(backup,'manifest.json');
  assert.equal(manifest.durable,installedDurableVersion());
  assert.equal(manifest.floor.kind,'pi15-fresh');
  if(manifest.floor.kind==='pi15-fresh')assert.equal(manifest.floor.minDurable,'1.5.0','historical minimum is not the exporter runtime version');
  // This checks the read-only metadata contract, not cross-runtime native opens.
  // Native upgrade/rollback compatibility is a separate physical-floor gate.
  for(const durable of ['1.5.0','1.5.1']){
   writeFileSync(path,JSON.stringify({...manifest,durable}));
   const originalManifest=readFileSync(path),destination=join(f.dir,'restored-'+durable);
   restoreState(backup,destination);
   assert.deepEqual(payloadBytes(destination,manifest.files),bytes);
   assert.deepEqual(payloadBytes(backup,manifest.files),bytes);
   assert.deepEqual(readFileSync(path),originalManifest,'restore never relabels an old export');
   assert.deepEqual(readControlFloor(destination,true),manifest.floor,'restore never installs or rewrites a floor');
  }
 }finally{f.state.close();rmSync(f.dir,{recursive:true,force:true});}
});

test('physical 1.5.1 control-v4 floor is exported and restored strictly, retaining the original 1.5.0 floor table unchanged',async()=>{
 const f=await fixture(true),backup=join(f.dir,'backup');
 try{
  const originalHistorical=readControlFloor(f.state.dir,true,true),manifest=await backupState(f.state,backup);
  assert.equal(manifest.controlSchemaVersion,4);assert.equal(manifest.floor.kind,'pi151');
  assert.equal(manifest.durable,installedDurableVersion());
  if(manifest.floor.kind!=='pi151')throw Error('Expected patch floor');
  assert.equal(manifest.floor.minDurable,'1.5.1');assert.equal(manifest.floor.origin,'fresh');
  assert.equal(originalHistorical.kind,'pi15-fresh');
  if(originalHistorical.kind==='pi15-fresh')assert.equal(originalHistorical.minDurable,'1.5.0');
  const bytes=payloadBytes(backup,manifest.files),destination=join(f.dir,'restored');
  restoreState(backup,destination);assert.deepEqual(payloadBytes(destination,manifest.files),bytes);
  assert.deepEqual(readControlFloor(destination,true,true),originalHistorical);
  assert.deepEqual(readControlFloor(destination,true),manifest.floor);
  const path=join(backup,'manifest.json');
  for(const [label,floor] of [
   ['historical-minimum',{...manifest.floor,minDurable:'1.5.0'}],
   ['forged-target',{...manifest.floor,to:'f'.repeat(64)}],
   ['mixed-origin',{...manifest.floor,from:'a'.repeat(64)}],
   ['unknown-protocol',{...manifest.floor,protocol:'bob-pi152-v1'}],
  ] as const){
   writeFileSync(path,JSON.stringify({...manifest,floor}));
   const rejected=join(f.dir,label);assert.throws(()=>restoreState(backup,rejected));assert.equal(existsSync(rejected),false);
   assert.deepEqual(payloadBytes(backup,manifest.files),bytes);
  }
 }finally{f.state.close();rmSync(f.dir,{recursive:true,force:true});}
});
