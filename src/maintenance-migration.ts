import {DatabaseSync} from 'node:sqlite';
import {constants,existsSync,mkdirSync,readFileSync,readdirSync,openSync,closeSync,fsyncSync,lstatSync,fstatSync,readSync,writeSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,dirname} from 'node:path';
import {acquireOwner} from './ownership.js';
import type {Release} from './maintenance.js';

export const supervisorProtocol='bob-pi15-v1' as const;
/** Only the explicitly reviewed compiled pair can authorize a crossing.
 * Never populate this from requests, configuration, journal metadata or environment. */
const pi15Transitions:readonly Readonly<{from:string;to:string}>[]=Object.freeze([{from:'328bbd2b3ec5505199382f781d7dc2dc5359e17b8356c92daef8be53155f8003',to:'5c798ab849e5ebf456f1aa4da70f8ef88f87af72bd8e709292083776ba1d0b45'}]);
const fingerprint=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function assertPi15Pair(from:unknown,to:unknown){
 if(!fingerprint(from)||!fingerprint(to)||from===to||!pi15Transitions.some(p=>p.from===from&&p.to===to))throw Error('Pi 1.5 transition is not in the compiled exact allowlist');
}
export type MigrationIntent={protocol:typeof supervisorProtocol;previous:Release;candidate:Release;phase:'intent'|'backed-up'|'floor-committed'|'complete';backup?:string};
type Journal={get<T>(key:string):T|undefined;set(key:string,value:unknown):void};
export type ControlFloor={kind:'legacy';lifecycleSchemaVersion:0|1|2}|{kind:'pi15-fresh';origin:'fresh';minDurable:'1.5.0';protocol:typeof supervisorProtocol;lifecycleSchemaVersion:0|1|2}|{kind:'pi15';minDurable:'1.5.0';protocol:typeof supervisorProtocol;from:string;to:string;migrationReleaseId:string;migrationCli:string;lifecycleSchemaVersion:0|1|2};
const snapshotFiles=['control.sqlite','control.sqlite-wal','durable.sqlite','durable.sqlite-wal','soul.md','core-prompt.md','setup-connection.json','hindsight.json','firebase-push.json'];
const snapshotDirectories=['artifacts','custom-modules'];
function entryStat(path:string){try{return lstatSync(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}}
function integrity(db:DatabaseSync){if(db.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok')throw Error('Control/state integrity check failed');}
/** Strictly read-only. Absence is only a fresh bootstrap when no Durable state exists. */
export function readControlFloor(stateDir:string,requireExisting=false):ControlFloor{
 const path=join(stateDir,'control.sqlite'),controlStat=entryStat(path);
 if(controlStat&&(controlStat.isSymbolicLink()||!controlStat.isFile()))throw Error('Control floor requires a regular database, not a symlink');
 if(!controlStat){
  if(requireExisting||[...snapshotFiles.filter(p=>p!=='control.sqlite'),'durable.sqlite-shm',...snapshotDirectories].some(p=>entryStat(join(stateDir,p))))throw Error('Missing control database for existing state; refusing any spawn');
  return {kind:'legacy',lifecycleSchemaVersion:0};
 }
 const db=new DatabaseSync(path,{readOnly:true});
 try{
  integrity(db);
  const version=Number(db.prepare('PRAGMA user_version').get()?.user_version);
  // Read required legacy tables as well: an empty/truncated replacement is not a verified old floor.
  validateTable(db,'config',['key','value']);validateTable(db,'invites',['hash','expires','used']);
  const config=db.prepare('SELECT key,value FROM config').all();
  for(const row of config){
   if(typeof row.key!=='string'||typeof row.value!=='string')throw Error('Corrupt control configuration');
   let value:unknown;try{value=JSON.parse(row.value);}catch{throw Error(row.key==='customModules'?'Corrupt customModules; explicit Pi 1.5 custom-module migration required':'Corrupt control configuration JSON');}
   if(row.key==='identity'&&(typeof value!=='string'||!value))throw Error('Corrupt control identity');
  }
  db.prepare('SELECT id,name,hash,revoked FROM devices LIMIT 1').all();
  db.prepare('SELECT hash,expires,used FROM invites LIMIT 1').all();
  const hasFloor=!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='maintenance_runtime_floor'").get();
  if(version===0||version===1||version===2){
   if(hasFloor)throw Error('Control floor metadata/version disagreement');
   validateLifecycle(db,version);
   return {kind:'legacy',lifecycleSchemaVersion:version};
  }
  if(version!==3||!hasFloor)throw Error('Unknown control floor; refusing any spawn');
  const columns=db.prepare('PRAGMA table_info(maintenance_runtime_floor)').all().map(r=>r.name).sort();
  const exactColumns=(names:string[])=>JSON.stringify(columns)===JSON.stringify(names.sort());
  const rows=db.prepare('SELECT * FROM maintenance_runtime_floor').all(),r=rows[0];
  if(exactColumns(['singleton','min_durable','protocol','origin','lifecycle_schema_version'])){
   if(rows.length!==1||r.singleton!==1||r.min_durable!=='1.5.0'||r.protocol!==supervisorProtocol||r.origin!=='fresh'||![0,1,2].includes(r.lifecycle_schema_version as number))throw Error('Missing or corrupt fresh Pi 1.5 floor metadata');
   const lifecycleSchemaVersion=r.lifecycle_schema_version as 0|1|2;validateLifecycle(db,lifecycleSchemaVersion);
   return {kind:'pi15-fresh',origin:'fresh',minDurable:'1.5.0',protocol:supervisorProtocol,lifecycleSchemaVersion};
  }
  if(!exactColumns(['singleton','min_durable','protocol','from_fingerprint','to_fingerprint','migration_release_id','migration_cli','lifecycle_schema_version']))throw Error('Unknown or mixed Pi 1.5 floor metadata');
  if(rows.length!==1||r.singleton!==1||r.min_durable!=='1.5.0'||r.protocol!==supervisorProtocol||!fingerprint(r.from_fingerprint)||!fingerprint(r.to_fingerprint)||typeof r.migration_release_id!=='string'||!r.migration_release_id||typeof r.migration_cli!=='string'||!r.migration_cli||![0,1,2].includes(r.lifecycle_schema_version as number))throw Error('Missing or corrupt Pi 1.5 floor metadata');
  assertPi15Pair(r.from_fingerprint,r.to_fingerprint);
  validateLifecycle(db,Number(r.lifecycle_schema_version));
  return {kind:'pi15',minDurable:'1.5.0',protocol:supervisorProtocol,from:r.from_fingerprint,to:r.to_fingerprint,migrationReleaseId:r.migration_release_id,migrationCli:r.migration_cli,lifecycleSchemaVersion:Number(r.lifecycle_schema_version) as 0|1|2};
 }finally{db.close();}
}
function validateTable(db:DatabaseSync,table:string,columns:string[]){
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)||JSON.stringify(db.prepare(`PRAGMA table_info(${table})`).all().map(r=>r.name))!==JSON.stringify(columns))throw Error('Unrecognized control table schema: '+table);
}
function validateLifecycle(db:DatabaseSync,version:number){
 validateTable(db,'devices',['id','name','hash','revoked',...(version===2?['created_at','revoked_at']:[])]);
 if(version===2)validateTable(db,'schema_migrations',['version','applied_at']);
}
/** Caller holds acquireOwner(stateDir). Only a database-absent bootstrap may acquire
 * this origin: it is NOT migration evidence and cannot authorize any existing 1.4 DB.
 * Never opens, rewrites or infers the version of a native Durable database. */
export function prepareFreshPi15Floor(stateDir:string){
 const floor=readControlFloor(stateDir,true);
 if(floor.kind!=='legacy')throw Error('Fresh bootstrap requires a legacy control floor');
 if(['durable.sqlite','durable.sqlite-wal','durable.sqlite-shm'].some(name=>entryStat(join(stateDir,name))))throw Error('Existing Durable state requires explicit Pi 1.5 maintenance migration before runtime open');
 const db=new DatabaseSync(join(stateDir,'control.sqlite'));
 try{
  db.exec('PRAGMA synchronous=FULL; BEGIN IMMEDIATE');
  try{
   db.exec(`CREATE TABLE maintenance_runtime_floor(singleton INTEGER PRIMARY KEY CHECK(singleton=1),min_durable TEXT NOT NULL,protocol TEXT NOT NULL,origin TEXT NOT NULL CHECK(origin='fresh'),lifecycle_schema_version INTEGER NOT NULL)`);
   db.prepare('INSERT INTO maintenance_runtime_floor VALUES(1,?,?,?,?)').run('1.5.0',supervisorProtocol,'fresh',floor.lifecycleSchemaVersion);
   db.exec('PRAGMA user_version=3');integrity(db);db.exec('COMMIT');
  }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
 }finally{db.close();}
}
export function validateIntent(value:MigrationIntent):MigrationIntent{
 if(!value||value.protocol!==supervisorProtocol||!['intent','backed-up','floor-committed','complete'].includes(value.phase)||!value.previous?.id||!value.previous.cli||!value.candidate?.id||!value.candidate.cli||value.previous.id===value.candidate.id||value.candidate.durableVersion!=='1.5.0')throw Error('Missing or corrupt migration intent');
 assertPi15Pair(value.previous.compatibility,value.candidate.compatibility);return value;
}
export function assertLegacyIntent(intent:MigrationIntent){
 validateIntent(intent);
 if(intent.phase==='floor-committed'||intent.phase==='complete')throw Error('Committed migration intent with legacy control floor; refusing old-code recovery');
}
export function assertFloorIntent(floor:Extract<ControlFloor,{kind:'pi15'}>,intent:MigrationIntent|undefined){
 if(!intent)throw Error('Pi 1.5 floor without persistent migration intent; manual compatible recovery required');
 validateIntent(intent);
 if(intent.previous.compatibility!==floor.from||intent.candidate.compatibility!==floor.to||intent.candidate.id!==floor.migrationReleaseId||intent.candidate.cli!==floor.migrationCli)throw Error('Pi 1.5 floor/intent identity mismatch');
}
function assertPi15Package(release:Release){
 const manifest=JSON.parse(readFileSync(join(dirname(dirname(release.cli)),'package.json'),'utf8'));
 if(manifest.name!=='@bob-local/cli'||manifest.dependencies?.['@earendil-works/pi-durable']!=='1.5.0')throw Error('Recovery package does not prove exact Pi 1.5 runtime identity');
}
/** Explicit cold-install bootstrap. Caller holds acquireOwner(stateDir).
 * Package proof and database absence are mandatory; this never substitutes for
 * migration intent on an existing native database. */
export function prepareFreshPi15ReleaseFloor(stateDir:string,release:Release,intent?:MigrationIntent){
 if(intent||release.durableVersion!=='1.5.0')throw Error('Fresh supervisor bootstrap requires exact Pi 1.5 and no migration intent');
 assertPi15Package(release);
 prepareFreshPi15Floor(stateDir);
 return readControlFloor(stateDir,true);
}
export function assertReleaseFloor(floor:ControlFloor,release:Release,intent?:MigrationIntent){
 if(floor.kind==='pi15'){
  assertFloorIntent(floor,intent);
  if(release.compatibility!==floor.to||release.durableVersion!=='1.5.0')throw Error('Control floor forbids Pi 1.4 or an unrecognized recovery release');
  assertPi15Package(release);
 }else if(floor.kind==='pi15-fresh'){
  if(intent)throw Error('Fresh Pi 1.5 floor must not have a migration intent');
  if(release.durableVersion!=='1.5.0')throw Error('Fresh control floor forbids Pi 1.4 or an unrecognized recovery release');
  assertPi15Package(release);
 }else{
  if(intent)assertLegacyIntent(intent);
  if(release.durableVersion&&release.durableVersion!=='1.4.0')throw Error('Pi 1.5 candidate requires the committed control-v3 floor');
 }
}
export type SupervisorEvidence={supervisorProtocol:typeof supervisorProtocol;pid:number;release:Pick<Release,'id'|'cli'|'compatibility'|'sourceHash'>;at:number};
export function runningBridge(evidence:SupervisorEvidence|undefined,active:Release|undefined,now=Date.now()){
 if(!evidence||evidence.supervisorProtocol!==supervisorProtocol||!Number.isInteger(evidence.pid)||evidence.pid<=0||!Number.isFinite(evidence.at)||evidence.at>now||now-evidence.at>=15000||!active||evidence.release?.id!==active.id||evidence.release.cli!==active.cli||evidence.release.compatibility!==active.compatibility||evidence.release.sourceHash!==active.sourceHash)return false;
 try{process.kill(evidence.pid,0);return true;}catch{return false;}
}
export function assertBridgeBuild(previous:Release,candidate:Pick<Release,'compatibility'|'durableVersion'>,evidence:SupervisorEvidence|undefined){
 assertPi15Pair(previous.compatibility,candidate.compatibility);
 if((previous.durableVersion&&previous.durableVersion!=='1.4.0')||candidate.durableVersion!=='1.5.0')throw Error('Bridge requires exact Pi 1.4 to 1.5 release identities');
 if(!runningBridge(evidence,previous))throw Error('Running bob-pi15-v1 supervisor proof required; ordinary heartbeat is insufficient');
}
export function assertBridgeActivation(previous:Release,candidate:Release,evidence:SupervisorEvidence|undefined){
 assertBridgeBuild(previous,candidate,evidence);assertPi15Package(candidate);
}
/** Caller has stopped the child and holds acquireOwner(stateDir). Never restores state.
 * Snapshot covers both SQLite databases/WAL, original artifacts, complete custom-module
 * archives, soul and legacy core prompt and known local connection/memory/push configuration files.
 * This is NOT a recovery.ts export: its explicit coverage/exclusions are persisted beside
 * the byte-verified payload. TLS/FCM/signing keys, external workspaces and dependencies
 * require separate owner-managed recovery. Ownership/provider locks and SQLite SHM are
 * coordination/cache data, not payload, and must never be restored as authority. */
export function verifiedBackup(home:string,stateDir:string,releaseId:string,requireDurable=false){
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(releaseId))throw Error('Invalid backup release identity');
 const source=entryStat(stateDir);if(!source?.isDirectory()||source.isSymbolicLink())throw Error('Backup requires a real state directory');
 if(requireDurable&&(!entryStat(join(stateDir,'control.sqlite'))||!entryStat(join(stateDir,'durable.sqlite'))))throw Error('Migration requires existing control and Durable databases');
 const backups=join(home,'backups');mkdirSync(backups,{recursive:true,mode:0o700});
 if(lstatSync(backups).isSymbolicLink()||!lstatSync(backups).isDirectory())throw Error('Backup refuses symlink directories');
 const backup=join(backups,releaseId+'-'+Date.now());mkdirSync(backup,{mode:0o700});
 const files:Record<string,string>={},buffer=Buffer.alloc(65536);
 const openRegular=(path:string)=>{
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  if(!fstatSync(fd).isFile()){closeSync(fd);throw Error('Backup requires regular files');}return fd;
 };
 const digest=(path:string)=>{
  const fd=openRegular(path),hash=createHash('sha256');
  try{let n:number;while((n=readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,n));return hash.digest('hex');}finally{closeSync(fd);}
 };
 const copy=(relative:string)=>{
  const input=openRegular(join(stateDir,relative));let output:number|undefined;
  try{
   output=openSync(join(backup,relative),'wx',0o600);const hash=createHash('sha256');let n:number;
   while((n=readSync(input,buffer,0,buffer.length,null))>0){hash.update(buffer.subarray(0,n));let written=0;while(written<n)written+=writeSync(output,buffer,written,n-written);}
   fsyncSync(output);files[relative]=hash.digest('hex');
  }finally{closeSync(input);if(output!==undefined)closeSync(output);}
  if(digest(join(backup,relative))!==files[relative])throw Error('State backup byte verification failed');
 };
 const walk=(relative:string,expectDirectory:boolean)=>{
  const stat=lstatSync(join(stateDir,relative));
  if(stat.isSymbolicLink())throw Error('Backup refuses symlinks');
  if(expectDirectory){
   if(!stat.isDirectory())throw Error('Backup requires real payload directories');
   mkdirSync(join(backup,relative),{mode:0o700});
   for(const name of readdirSync(join(stateDir,relative)).sort()){
    const child=join(relative,name),childStat=lstatSync(join(stateDir,child));
    if(childStat.isSymbolicLink())throw Error('Backup refuses symlinks');
    walk(child,childStat.isDirectory());
   }
  }else{if(!stat.isFile())throw Error('Backup requires regular files');copy(relative);}
 };
 for(const name of snapshotFiles)if(entryStat(join(stateDir,name)))walk(name,false);
 for(const name of snapshotDirectories)if(entryStat(join(stateDir,name)))walk(name,true);
 for(const name of ['control.sqlite','durable.sqlite'])if(existsSync(join(backup,name))){const db=new DatabaseSync(join(backup,name),{readOnly:true});try{integrity(db);}finally{db.close();}}
 writeFileSync(join(backup,'maintenance-backup.json'),JSON.stringify({
  format:'bob-maintenance-snapshot-v1',releaseId,createdAt:new Date().toISOString(),files,
  coverage:{included:'Control configuration/credentials/grants and Durable full SQLite history/documents/tasks with WAL; original artifact bytes and receipts; complete imported custom-module package archives; soul.md, legacy core-prompt.md, setup-connection.json, hindsight.json and firebase-push.json when present.',
   excluded:'Not a restoreState export. Excludes SQLite SHM, ownership/provider locks, maintenance journal/releases, Android caches/drafts, external workspaces, TLS/FCM service-account/signing key material (even if kept elsewhere in state), environment secrets, systemd units, browser executables and bundled dependencies. Reinstall the exact validated Bob package and recover excluded material separately. Never automatically restore this snapshot after the Pi 1.5 floor.'}
 },null,2),{flag:'wx',mode:0o600});
 const manifest=openSync(join(backup,'maintenance-backup.json'),'r');try{fsyncSync(manifest);}finally{closeSync(manifest);}
 const syncDirectories=(dir:string)=>{for(const e of readdirSync(dir,{withFileTypes:true}))if(e.isDirectory())syncDirectories(join(dir,e.name));const fd=openSync(dir,'r');try{fsyncSync(fd);}finally{closeSync(fd);}};
 syncDirectories(backup);for(const dir of [backups,home]){const fd=openSync(dir,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
 return backup;
}
/** Explicit owner-locked maintenance transaction, never a State startup migration.
 * Persistent intent precedes backup and COMMIT. COMMIT, not the journal phase, is the barrier. */
export function preparePi15Floor(home:string,stateDir:string,journal:Journal,intent:MigrationIntent){
 assertLegacyIntent(intent);assertPi15Package(intent.candidate);
 if(JSON.stringify(journal.get('migrationIntent'))!==JSON.stringify(intent))throw Error('Persistent migration intent required before floor migration');
 const releaseOwner=acquireOwner(stateDir);
 try{
  const floor=readControlFloor(stateDir,true);if(floor.kind!=='legacy')throw Error('Control floor already crossed; use compatible recovery');
  // 1.4 records (even unselected modules) cannot be loaded by the 1.5 catalog.
  // Reject a predictable boot failure before taking a backup or committing the floor;
  // archives remain untouched for an explicit, separately reviewed module migration.
  const preflight=new DatabaseSync(join(stateDir,'control.sqlite'),{readOnly:true});
  try{
   const row=preflight.prepare("SELECT value FROM config WHERE key='customModules'").get();
   if(row){
    let modules:unknown;try{modules=JSON.parse(String(row.value));}catch{throw Error('Corrupt customModules; explicit Pi 1.5 custom-module migration required');}
    if(!Array.isArray(modules)||modules.length!==0)throw Error('Existing customModules require explicit Pi 1.5 custom-module migration before floor commit');
   }
  }finally{preflight.close();}
  intent={...intent,phase:'backed-up',backup:verifiedBackup(home,stateDir,intent.candidate.id,true)};
  journal.set('migrationIntent',intent);journal.set('lastBackup',intent.backup);
  const db=new DatabaseSync(join(stateDir,'control.sqlite'));
  try{
   db.exec('PRAGMA synchronous=FULL; BEGIN IMMEDIATE');
   try{
    // Preserve config, grants and lifecycle schema verbatim; record their version independently.
    db.exec(`CREATE TABLE maintenance_runtime_floor(singleton INTEGER PRIMARY KEY CHECK(singleton=1),min_durable TEXT NOT NULL,protocol TEXT NOT NULL,from_fingerprint TEXT NOT NULL,to_fingerprint TEXT NOT NULL,migration_release_id TEXT NOT NULL,migration_cli TEXT NOT NULL,lifecycle_schema_version INTEGER NOT NULL)`);
    db.prepare('INSERT INTO maintenance_runtime_floor VALUES(1,?,?,?,?,?,?,?)').run('1.5.0',supervisorProtocol,intent.previous.compatibility!,intent.candidate.compatibility!,intent.candidate.id,intent.candidate.cli,floor.lifecycleSchemaVersion);
    db.exec('PRAGMA user_version=3');integrity(db);db.exec('COMMIT');
   }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
  }finally{db.close();}
  // A crash/failure here MUST NOT permit previous-code rollback. Recovery rereads control.sqlite.
  journal.set('migrationIntent',{...intent,phase:'floor-committed'});
 }finally{releaseOwner();}
}
