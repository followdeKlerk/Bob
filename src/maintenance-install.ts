import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {chmodSync,copyFileSync,cpSync,existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,readlinkSync,renameSync,rmSync,statSync,symlinkSync,writeFileSync} from 'node:fs';
import {delimiter,dirname,isAbsolute,join,relative,resolve} from 'node:path';
import {homedir} from 'node:os';
import {acquireOwner,inspectOwner} from './ownership.js';
import {MaintenanceStore,compatibilityFingerprint,sourceFingerprint,type MaintenanceConfig,type Release} from './maintenance.js';
import {assertFloorIntent,assertPatchFloorIntent,assertReleaseFloor,pi151Fingerprint,readControlFloor,verifiedBackup,type MigrationIntent,type PatchMigrationIntent} from './maintenance-migration.js';
import {setupUnitName,systemdQuote} from './setup-service.js';

/** Installation is deliberately OFFLINE. An external caller stops the standalone
 * service after its foreground work finishes. This module never stops that service,
 * migrates native state, builds/cleans source, or restores a database. Initialize a
 * fresh state with ordinary setup first (credentials and identity remain there). */
export type MaintenanceInstallOptions={
 sourceRoot:string;currentCli:string;node:string;stateDir:string;home?:string;
 origin:string;serveArgs:string[];unitDirectory:string;
 /** Exact known standalone unit bytes: arbitrary/manual units are not replaced. */
 standaloneUnit?:string;
 /** Required for migration-origin floors. Evidence is retained, never invented. */
 retainedJournalHome?:string;
 /** Stage immutable code while a standalone owner is live; no state writes.
  * Commit still always requires both ownership locks and an offline state. */
 allowLivePreparation?:boolean;
 javaHome?:string;androidHome?:string;signingProperties?:string;referenceApk?:string;
};
export type MaintenanceInstallPlan={
 options:MaintenanceInstallOptions;home:string;backendId:string;unitName:string;unitFile:string;
 config:MaintenanceConfig;runtimeRoot:string;sourceHash:string;compatibility:string;
 migrationIntent?:MigrationIntent;patchMigrationIntent?:PatchMigrationIntent;
};
export type PreparedMaintenanceInstall={plan:MaintenanceInstallPlan;release:Release;runtimeDigest:string};
export type MaintenancePackageActions={
 /** Trusted injection for isolated source compilation (tests/host capabilities). */
 compileSource?(input:{sourceRoot:string;directory:string;node:string}):Promise<string>;
 packageRuntime?(input:{runtimeRoot:string;directory:string;node:string}):Promise<string>;
 verifyPackage?(input:{cli:string;node:string;directory:string}):Promise<void>;
 inspectReferenceApk?(input:{apk:string;androidHome:string;node:string}):Promise<{certificate:string;badging:string}>;
};
export class MaintenanceInstallError extends Error{
 constructor(message:string,readonly recoverySafe:boolean,cause?:unknown){super(message,{cause});this.name='MaintenanceInstallError';}
}
export type MaintenanceInstallResult={home:string;unitName:string;release:Release;alreadyInstalled:boolean;backup?:string};
type InstallReceipt={phase:'prepared'|'complete';prepared:PreparedMaintenanceInstall;backup?:string};
const receiptName='installation.json';
function regular(path:string){const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink())throw Error('Expected regular file: '+path);}
function safePath(path:string){if(!isAbsolute(path)||/[\x00-\x1f\x7f]/.test(path))throw Error('Installation paths must be absolute without control characters');return resolve(path);}
function outside(parent:string,child:string){const path=relative(parent,child);return path==='..'||path.startsWith('../');}
function noSymlinks(path:string){let current=resolve(path);for(;;){let symlink=false;try{symlink=lstatSync(current).isSymbolicLink();}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}if(symlink)throw Error('Installation paths cannot traverse symlinks');const parent=dirname(current);if(parent===current)break;current=parent;}}
function json<T>(path:string):T{regular(path);return JSON.parse(readFileSync(path,'utf8'));}
function atomic(path:string,content:string){const temp=mkdtempSync(join(dirname(path),'.install-'));try{const file=join(temp,'value');writeFileSync(file,content,{mode:0o600,flag:'wx'});renameSync(file,path);}finally{rmSync(temp,{recursive:true,force:true});}}
function identity(stateDir:string){readControlFloor(stateDir,true);const db=new DatabaseSync(join(stateDir,'control.sqlite'),{readOnly:true});try{const get=(key:string)=>{const row=db.prepare('SELECT value FROM config WHERE key=?').get(key);return row?JSON.parse(String(row.value)):undefined;};const id=get('identity');setupUnitName(id);return {id:id as string,managed:get('maintenanceHome') as unknown};}finally{db.close();}}
function offline(directory:string){if(inspectOwner(directory)!=='available')throw Error('Offline installation requires no active owner or legacy lock');}
export function maintenanceHomeForBackend(backendId:string,base=join(homedir(),'.local/share/bob-maintenance')){setupUnitName(backendId);return join(safePath(base),backendId);}
export function renderMaintenanceService(node:string,home:string,backendId:string){
 setupUnitName(backendId);safePath(node);safePath(home);
 return `[Unit]\nDescription=Bob supervised backend ${backendId}\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nUMask=0077\nExecStart=${[node,join(home,'maintenance-loader.js'),home].map(systemdQuote).join(' ')}\nRestart=always\nRestartSec=5\nTimeoutStopSec=45\n\n[Install]\nWantedBy=default.target\n`;
}
function journalEvidence(home:string|undefined){
 if(!home)return {};
 safePath(home);noSymlinks(home);offline(join(home,'supervisor-owner'));
 const file=join(home,'journal.sqlite');regular(file);const db=new DatabaseSync(file,{readOnly:true});
 try{const get=<T>(key:string)=>{const row=db.prepare('SELECT value FROM settings WHERE key=?').get(key);return row?JSON.parse(String(row.value)) as T:undefined;};
  if(get('transition')||get('draining'))throw Error('Retained journal has an unfinished transition');
  const evidence={migrationIntent:get<MigrationIntent>('migrationIntent'),patchMigrationIntent:get<PatchMigrationIntent>('patchMigrationIntent')};
  for(const intent of [evidence.migrationIntent,evidence.patchMigrationIntent])if(intent)for(const release of [intent.previous,intent.candidate]){regular(release.cli);const manifest=json<any>(join(dirname(dirname(release.cli)),'package.json'));if(manifest.name!=='@bob-local/cli'||manifest.dependencies?.['@earendil-works/pi-durable']!==release.durableVersion)throw Error('Retained migration package identity mismatch');}
  return evidence;
 }finally{db.close();}
}
function validateFloor(plan:MaintenanceInstallPlan,release:Release){
 const floor=readControlFloor(plan.config.stateDir,true);
 if(floor.kind==='pi151'){
  assertPatchFloorIntent(floor,plan.patchMigrationIntent);
  const historical=readControlFloor(plan.config.stateDir,true,true);
  if(historical.kind==='pi15')assertFloorIntent(historical,plan.migrationIntent);
  else if(historical.kind!=='pi15-fresh'||plan.migrationIntent)throw Error('Historical floor/intent mismatch');
  assertReleaseFloor(floor,release,plan.migrationIntent,plan.patchMigrationIntent);
 }else{
  // A fresh setup control DB is allowed, but no native file may exist. The
  // ordinary supervisor bootstrap creates the real fresh floor, not this installer.
  if(!['legacy','pi15-fresh'].includes(floor.kind)||plan.migrationIntent||plan.patchMigrationIntent||['durable.sqlite','durable.sqlite-wal','durable.sqlite-shm'].some(p=>existsSync(join(plan.config.stateDir,p))))throw Error('Existing native state requires its committed v4 floor and retained migration evidence');
 }
}
/** Read-only preflight. No State constructor: even a failed plan must not rewrite
 * identity, credentials, floor metadata, or open native Durable. */
export function planMaintenanceInstall(input:MaintenanceInstallOptions):MaintenanceInstallPlan{
 const options={...input,sourceRoot:safePath(input.sourceRoot),currentCli:safePath(input.currentCli),node:safePath(input.node),stateDir:safePath(input.stateDir),unitDirectory:safePath(input.unitDirectory),serveArgs:[...input.serveArgs]};
 for(const path of [options.stateDir,options.unitDirectory])noSymlinks(path);
 if(!options.allowLivePreparation)offline(options.stateDir);else if(!['available','owned'].includes(inspectOwner(options.stateDir)))throw Error('Live preparation requires known state ownership');
 const {id:backendId,managed}=identity(options.stateDir);
 const home=safePath(options.home??maintenanceHomeForBackend(backendId));noSymlinks(home);
 if(!outside(options.stateDir,home)||!outside(home,options.stateDir))throw Error('Maintenance home and state directory must be disjoint');
 if(managed&&managed!==home)throw Error('State is already supervisor-managed elsewhere');
 offline(join(home,'supervisor-owner'));
 const origin=new URL(options.origin);if(!['http:','https:'].includes(origin.protocol)||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw Error('A plain backend health origin is required');
 if(!options.serveArgs.length||options.serveArgs.some(v=>!v||/[\x00-\x1f\x7f]/.test(v)))throw Error('Explicit safe serve arguments are required');
 if(options.serveArgs[0]!=='--state'||options.serveArgs[1]!==options.stateDir||options.serveArgs[2]!=='serve'||options.serveArgs.slice(2).includes('--state'))throw Error('Serve arguments must begin --state <exact stateDir> serve');
 const runtimeRoot=dirname(dirname(options.currentCli));if(options.currentCli!==join(runtimeRoot,'dist/cli.js'))throw Error('Use the compiled current runtime CLI, not a source/tsx entry');
 if(runtimeRoot!==options.sourceRoot)throw Error('Current compiled runtime must belong to sourceRoot');
 regular(options.currentCli);const manifest=json<any>(join(runtimeRoot,'package.json'));
 if(manifest.name!=='@bob-local/cli'||manifest.dependencies?.['@earendil-works/pi-durable']!=='1.5.1')throw Error('Current runtime must be the supported Durable 1.5.1 package');
 const compatibility=compatibilityFingerprint(options.sourceRoot);if(compatibility!==pi151Fingerprint)throw Error('Source persistence identity is not the compiled supported Durable 1.5.1 identity');
 const config:MaintenanceConfig={sourceRoot:options.sourceRoot,stateDir:options.stateDir,backendId,node:options.node,serveArgs:options.serveArgs,origin:origin.origin};
 for(const key of ['javaHome','androidHome','signingProperties','referenceApk'] as const)if(options[key])config[key]=safePath(options[key]!);
 const unitName=setupUnitName(backendId),unitFile=join(options.unitDirectory,unitName);
 const plan:MaintenanceInstallPlan={options,home,backendId,unitName,unitFile,config,runtimeRoot,sourceHash:sourceFingerprint(options.sourceRoot),compatibility,...journalEvidence(options.retainedJournalHome)};
 validateFloor(plan,{id:'preflight',cli:options.currentCli,compatibility,durableVersion:'1.5.1'});
 if(existsSync(unitFile)){regular(unitFile);const bytes=readFileSync(unitFile,'utf8');if(bytes!==options.standaloneUnit&&bytes!==renderMaintenanceService(options.node,home,backendId))throw Error('Existing service differs from the explicitly approved standalone unit');}
 if(managed&&!completed(plan))throw Error('Supervisor-managed state cannot be adopted without this installer’s matching completed receipt');
 return plan;
}
function digestTree(directory:string){const hash=createHash('sha256');const visit=(dir:string)=>{for(const name of readdirSync(dir).sort()){const file=join(dir,name),st=lstatSync(file);if(st.isSymbolicLink()){const target=readlinkSync(file),resolved=resolve(dirname(file),target),rel=relative(directory,resolved);if(isAbsolute(target)||rel==='..'||rel.startsWith('../'))throw Error('Release symlink escapes immutable installation: '+file);hash.update(relative(directory,file)+'\0link\0'+target);continue;}if(st.isDirectory())visit(file);else if(st.isFile())hash.update(relative(directory,file)+'\0').update(readFileSync(file));else throw Error('Release contains special files');}};visit(directory);return hash.digest('hex');}
function digestCompiledRuntime(directory:string){const hash=createHash('sha256');const visit=(path:string)=>{for(const name of readdirSync(path).sort()){const file=join(path,name),entry=lstatSync(file);if(entry.isDirectory()&&!entry.isSymbolicLink())visit(file);else if(name.endsWith('.js')){regular(file);hash.update(relative(directory,file)+'\0').update(readFileSync(file));}}};visit(directory);return hash.digest('hex');}
function completed(plan:MaintenanceInstallPlan):PreparedMaintenanceInstall|undefined{
 const file=join(plan.home,receiptName);if(!existsSync(file))return;
 const receipt=json<{phase:string;prepared:PreparedMaintenanceInstall}>(file),p=receipt.prepared;
 if(receipt.phase!=='complete'||p.plan.backendId!==plan.backendId||JSON.stringify(p.plan.config)!==JSON.stringify(plan.config))return;
 validatePrepared(p);return p;
}
async function command(file:string,args:string[],cwd:string,node:string,timeoutMs:number){
 return await new Promise<string>((ok,fail)=>{
  const child=spawn(file,args,{cwd,env:{...process.env,PATH:dirname(node)+delimiter+(process.env.PATH??'')},detached:true,stdio:['ignore','pipe','pipe']});
  let output='',stdout='',timedOut=false,finished=false,killTimer:ReturnType<typeof setTimeout>|undefined;
  const kill=(signal:NodeJS.Signals)=>{try{if(child.pid)process.kill(-child.pid,signal);}catch{}};
  const timer=setTimeout(()=>{timedOut=true;kill('SIGTERM');killTimer=setTimeout(()=>kill('SIGKILL'),5000);},timeoutMs);
  const finish=(error?:Error)=>{if(finished)return;finished=true;clearTimeout(timer);if(killTimer)clearTimeout(killTimer);error?fail(error):ok(stdout);};
  child.stdout!.on('data',chunk=>{if(stdout.length<1048576)stdout+=String(chunk);else{kill('SIGKILL');finish(Error('Packaging command output exceeded limit'));}});
  child.stderr!.on('data',chunk=>{output=(output+String(chunk)).slice(-4000);});
  child.once('error',error=>finish(error));
  child.once('close',code=>finish(timedOut?Error(`Packaging command timed out after ${timeoutMs}ms`):code===0?undefined:Error(`Packaging command failed (${code}): ${output}`)));
 });
}
function workspaces(root:string){
 const manifest=json<{workspaces:string[];bundleDependencies:string[]}>(join(root,'package.json'));
 if(!Array.isArray(manifest.workspaces)||!Array.isArray(manifest.bundleDependencies)||!manifest.workspaces.length)throw Error('Explicit bundled workspace manifests are required');
 const rows=manifest.workspaces.map(path=>{if(!/^packages\/[a-z][a-z0-9-]*$/.test(path))throw Error('Unsupported workspace path');const pkg=json<{name:string}>(join(root,path,'package.json'));return {path,name:pkg.name};});
 if(new Set(rows.map(row=>row.name)).size!==rows.length||JSON.stringify(rows.map(row=>row.name).sort())!==JSON.stringify([...manifest.bundleDependencies].sort()))throw Error('All runtime workspaces must be explicitly bundled');
 return rows;
}
async function compileSource({sourceRoot,directory,node}:{sourceRoot:string;directory:string;node:string}){
 const snapshot=join(directory,'source-verification');mkdirSync(snapshot,{mode:0o700});
 const copy=(path:string)=>{const from=join(sourceRoot,path);noSymlinks(from);if(lstatSync(from).isDirectory())digestTree(from);else regular(from);mkdirSync(dirname(join(snapshot,path)),{recursive:true,mode:0o700});cpSync(from,join(snapshot,path),{recursive:true});};
 for(const file of ['src','package.json','package-lock.json','tsconfig.json'])copy(file);
 // Carry only the package's declared non-generated assets into the private
 // build. Packaging this snapshot excludes stale checkout dist leftovers.
 for(const file of json<{files:string[]}>(join(sourceRoot,'package.json')).files??[]){if(file.startsWith('dist/'))continue;if(isAbsolute(file)||file.split('/').includes('..')||file.includes('*'))throw Error('Unsupported package asset path');if(existsSync(join(sourceRoot,file)))copy(file);}
 const packages=workspaces(sourceRoot);
 for(const row of packages){
  for(const path of ['src','package.json','tsconfig.json'])copy(join(row.path,path));
  for(const file of json<{files:string[]}>(join(sourceRoot,row.path,'package.json')).files??[]){if(file.startsWith('dist/'))continue;if(isAbsolute(file)||file.split('/').includes('..')||file.includes('*'))throw Error('Unsupported workspace asset path');copy(join(row.path,file));}
 }
 // Isolate workspace resolution too: a link to the checkout's whole node_modules
 // would typecheck against stale checkout workspace outputs instead of this build.
 const modules=join(snapshot,'node_modules');mkdirSync(modules,{mode:0o700});
 for(const name of readdirSync(join(sourceRoot,'node_modules')))if(name!=='.bin'&&name!=='@bob-local')symlinkSync(join(sourceRoot,'node_modules',name),join(modules,name));
 mkdirSync(join(modules,'@bob-local'),{mode:0o700});
 for(const row of packages){if(!/^@bob-local\/[a-z][a-z0-9-]*$/.test(row.name))throw Error('Unsupported bundled workspace name');symlinkSync(join(snapshot,row.path),join(modules,row.name));}
 const req=createRequire(join(sourceRoot,'package.json')),compiler=join(dirname(req.resolve('typescript/package.json')),'bin/tsc');
 for(const row of packages)await command(node,[compiler,'--project',join(snapshot,row.path,'tsconfig.json')],snapshot,node,120000);
 await command(node,[compiler,'--project',join(snapshot,'tsconfig.json')],snapshot,node,120000);
 return snapshot;
}
function emittedFilesMatch(emitted:string,runtime:string){return readdirSync(emitted).filter(name=>name.endsWith('.js')).every(name=>{const file=join(runtime,name);regular(file);return readFileSync(join(emitted,name)).equals(readFileSync(file));});}
function assertCompiledProvenance(sourceRoot:string,compiled:string,installed?:string){
 if(!emittedFilesMatch(join(compiled,'dist'),join(sourceRoot,'dist')))throw Error('Root compiled runtime does not match isolated source compilation');
 if(installed&&digestCompiledRuntime(join(compiled,'dist'))!==digestCompiledRuntime(join(installed,'dist')))throw Error('Packaged root runtime does not match isolated source compilation');
 for(const row of workspaces(sourceRoot)){
  const expected=digestCompiledRuntime(join(compiled,row.path,'dist'));
  if(!emittedFilesMatch(join(compiled,row.path,'dist'),join(sourceRoot,row.path,'dist')))throw Error('Workspace compiled runtime does not match isolated source compilation: '+row.name);
  if(installed){const nested=join(installed,'node_modules',row.name),root=existsSync(nested)?nested:join(resolve(installed,'../..'),row.name);const pkg=json<{name:string}>(join(root,'package.json'));if(pkg.name!==row.name||expected!==digestCompiledRuntime(join(root,'dist')))throw Error('Packaged workspace does not match isolated source compilation: '+row.name);}
 }
}
async function packageRuntime({runtimeRoot,directory,node}: {runtimeRoot:string;directory:string;node:string}){
 const manifest=json<{version:string}>(join(runtimeRoot,'package.json'));if(!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(manifest.version))throw Error('Invalid package version');
 await command('npm',['pack','--silent','--ignore-scripts','--pack-destination',directory],runtimeRoot,node,120000);
 await command('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--omit=dev','--prefix',join(directory,'installation'),join(directory,'bob-local-cli-'+manifest.version+'.tgz')],runtimeRoot,node,180000);
 return join(directory,'installation/node_modules/@bob-local/cli/dist/cli.js');
}
async function verifyPackage({cli,node,directory}:{cli:string;node:string;directory:string}){
 const state=join(directory,'verification-state');
 await command(node,[cli,'--state',state,'setup','--cwd',directory],directory,node,60000);
 await command(node,[cli,'--state',state,'doctor'],directory,node,60000);
 await command(node,[cli,'--state',state,'module','list'],directory,node,60000);
}
async function inspectReferenceApk({apk,androidHome,node}:{apk:string;androidHome:string;node:string}){
 const tools=join(androidHome,'build-tools/36.0.0'),cwd=dirname(apk);
 return {certificate:await command(join(tools,'apksigner'),['verify','--print-certs',apk],cwd,node,60000),badging:await command(join(tools,'aapt'),['dump','badging',apk],cwd,node,60000)};
}
function referenceApkMetadata(path:string,evidence:{certificate:string;badging:string}):NonNullable<Release['apk']>{
 const signer=evidence.certificate.match(/Signer #1 certificate SHA-256 digest: ([a-fA-F0-9]{64})/)?.[1]?.toLowerCase();
 const identity=evidence.badging.match(/package: name='com\.bobmobile' versionCode='(\d+)' versionName='([^']+)'/);
 const versionCode=Number(identity?.[1]),versionName=identity?.[2];
 if(!signer||/Signer #2 certificate/.test(evidence.certificate)||!Number.isSafeInteger(versionCode)||versionCode<1||versionCode>2100000000||!versionName||!/^\d+\.\d+\.\d+$/.test(versionName))throw Error('Reference APK package, signing certificate, or version identity is invalid');
 return {path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex'),size:statSync(path).size,versionCode,versionName,signer};
}
function writeReceipt(prepared:PreparedMaintenanceInstall,phase:InstallReceipt['phase'],backup?:string){const file=join(prepared.plan.home,receiptName);if(backup===undefined&&existsSync(file))backup=json<InstallReceipt>(file).backup;atomic(file,JSON.stringify({phase,prepared,backup},null,2)+'\n');}
function installationDirectory(p:PreparedMaintenanceInstall){const rel=relative(join(p.plan.home,'releases'),p.release.cli),parts=rel.split('/');if(!/^initial-[A-Za-z0-9]+$/.test(parts[0])||parts.slice(1).join('/')!=='installation/node_modules/@bob-local/cli/dist/cli.js')throw Error('Prepared release is outside immutable installation home');return join(p.plan.home,'releases',parts[0],'installation');}
function validatePrepared(p:PreparedMaintenanceInstall){
 noSymlinks(installationDirectory(p));noSymlinks(p.plan.config.stateDir);
 if(digestTree(installationDirectory(p))!==p.runtimeDigest)throw Error('Packaged runtime changed after preparation');
 if(p.release.apk){const apk=p.release.apk;if(apk.path!==join(dirname(installationDirectory(p)),'bob.apk'))throw Error('Reference APK is outside immutable release');regular(apk.path);if(statSync(apk.path).size!==apk.size||createHash('sha256').update(readFileSync(apk.path)).digest('hex')!==apk.sha256)throw Error('Reference APK changed after preparation');}
 validateFloor(p.plan,p.release);
}
/** Package the current compiled runtime, not a mutable checkout launch path.
 * Source may be dirty; no git checkout/reset, dependency changes, or build runs.
 * Injected actions are trusted host capabilities (tests use isolated packages). */
export async function prepareMaintenanceInstall(plan:MaintenanceInstallPlan,actions:MaintenancePackageActions={}):Promise<PreparedMaintenanceInstall>{
 const fresh=planMaintenanceInstall(plan.options);if(JSON.stringify(fresh)!==JSON.stringify(plan))throw Error('Installation plan changed; replan before preparing');
 const done=completed(plan);if(done)return done;
 mkdirSync(plan.home,{recursive:true,mode:0o700});mkdirSync(join(plan.home,'supervisor-owner'),{recursive:true,mode:0o700});
 const supervisorOwner=acquireOwner(join(plan.home,'supervisor-owner'));let stateOwner:(()=>void)|undefined;
 try{
  if(!plan.options.allowLivePreparation)stateOwner=acquireOwner(plan.config.stateDir);
  if(identity(plan.config.stateDir).managed)throw Error('State is already supervisor-managed');
  const receipt=join(plan.home,receiptName);
  if(existsSync(receipt)){
   const old=json<{phase:string;prepared:PreparedMaintenanceInstall}>(receipt);
   if(old.phase==='prepared'&&JSON.stringify(old.prepared.plan)===JSON.stringify(plan)){validatePrepared(old.prepared);return old.prepared;}
   throw Error('Installation home has an incomplete/different receipt; inspect it before retrying');
  }
  for(const file of ['config.json','journal.sqlite','maintenance-loader.js'])if(existsSync(join(plan.home,file)))throw Error('Maintenance home already contains unmanaged deployment files');
  const releases=join(plan.home,'releases');mkdirSync(releases,{recursive:true,mode:0o700});
  const directory=mkdtempSync(join(releases,'initial-'));
  try{
   const compiled=await (actions.compileSource??compileSource)({sourceRoot:plan.config.sourceRoot,directory,node:plan.config.node});
   if(!resolve(compiled).startsWith(directory+'/'))throw Error('Compiler returned output outside staging');
   assertCompiledProvenance(plan.config.sourceRoot,compiled);
   const cli=await (actions.packageRuntime??packageRuntime)({runtimeRoot:compiled,directory,node:plan.config.node});
   const root=dirname(dirname(cli));if(!resolve(root).startsWith(directory+'/'))throw Error('Packager returned a runtime outside staging');
   const manifest=json<any>(join(root,'package.json'));
   if(manifest.name!=='@bob-local/cli'||manifest.dependencies?.['@earendil-works/pi-durable']!=='1.5.1')throw Error('Packaged Durable identity mismatch');
   regular(cli);for(const name of ['maintenance-loader.js','maintenance-runner.js','maintenance.js','maintenance-migration.js','ownership.js'])regular(join(root,'dist',name));
   if(digestCompiledRuntime(join(root,'dist'))!==digestCompiledRuntime(join(compiled,'dist')))throw Error('Packaged compiled runtime differs from the current runtime');
   assertCompiledProvenance(plan.config.sourceRoot,compiled,root);
   const req=createRequire(join(root,'package.json'));const native=json<any>(req.resolve('@earendil-works/pi-durable/package.json'));
   if(native.name!=='@earendil-works/pi-durable'||native.version!=='1.5.1')throw Error('Installed native Durable package identity mismatch');
   await (actions.verifyPackage??verifyPackage)({cli,node:plan.config.node,directory});
   if(sourceFingerprint(plan.config.sourceRoot)!==plan.sourceHash)throw Error('Source changed during preparation; no release published');
   const release:Release={id:directory.split('/').at(-1)!,cli,sourceHash:plan.sourceHash,compatibility:plan.compatibility,durableVersion:'1.5.1'};
   if(plan.config.referenceApk){if(!plan.config.androidHome)throw Error('Android SDK build-tools are required to validate the reference APK');regular(plan.config.referenceApk);const apk=join(directory,'bob.apk');copyFileSync(plan.config.referenceApk,apk);chmodSync(apk,0o600);release.apk=referenceApkMetadata(apk,await (actions.inspectReferenceApk??inspectReferenceApk)({apk,androidHome:plan.config.androidHome,node:plan.config.node}));}
   validateFloor(plan,release);
   const current=identity(plan.config.stateDir);if(current.id!==plan.backendId||current.managed)throw Error('State identity or management changed during preparation');
   const prepared={plan,release,runtimeDigest:digestTree(join(directory,'installation'))};
   validatePrepared(prepared);
   writeReceipt(prepared,'prepared');return prepared;
  }catch(error){rmSync(directory,{recursive:true,force:true});throw error;}
 }finally{stateOwner?.();supervisorOwner();}
}
/** Commit only while holding both OS-backed ownership locks. The parent owns
 * unit replacement/start/readiness and must call rollbackMaintenanceInstall only
 * after stopping any newly started supervisor. No service commands occur here. */
export async function installMaintenanceSupervisor(prepared:PreparedMaintenanceInstall):Promise<MaintenanceInstallResult>{
 const {plan,release}=prepared;validatePrepared(prepared);
 const managed=identity(plan.config.stateDir).managed,done=completed(plan);
 if(managed===plan.home&&done)return {home:plan.home,unitName:plan.unitName,release:done.release,alreadyInstalled:true,backup:json<InstallReceipt>(join(plan.home,receiptName)).backup};
 if(managed)throw Error('State is already supervisor-managed');
 const releaseSupervisor=acquireOwner(join(plan.home,'supervisor-owner'));let releaseState:(()=>void)|undefined,store:MaintenanceStore|undefined;
 let committed=false,touched=false,backup:string|undefined;
 const originalFloor=readControlFloor(plan.config.stateDir,true);
 const proveClean=()=>{if(identity(plan.config.stateDir).managed||identity(plan.config.stateDir).id!==plan.backendId||JSON.stringify(readControlFloor(plan.config.stateDir,true))!==JSON.stringify(originalFloor)||['config.json','journal.sqlite','maintenance-loader.js'].some(name=>existsSync(join(plan.home,name))))throw Error('Clean standalone metadata/floor rollback could not be verified');};
 try{
  releaseState=acquireOwner(plan.config.stateDir);
  validatePrepared(prepared);if(identity(plan.config.stateDir).managed)throw Error('State became supervisor-managed');
  const receipt=json<{phase:string;prepared:PreparedMaintenanceInstall}>(join(plan.home,receiptName));
  if(receipt.phase!=='prepared'||JSON.stringify(receipt.prepared)!==JSON.stringify(prepared))throw Error('Matching prepared receipt is required');
  for(const file of ['config.json','journal.sqlite','maintenance-loader.js'])if(existsSync(join(plan.home,file)))throw Error('Maintenance home contains deployment files; refusing to overwrite');
  // The state lock remains held for the entire verified, quiescent snapshot.
  // No deployment/control metadata is changed until this succeeds.
  if(existsSync(join(plan.config.stateDir,'durable.sqlite'))){backup=verifiedBackup(plan.home,plan.config.stateDir,release.id,true);writeReceipt(prepared,'prepared',backup);}
  touched=true;store=new MaintenanceStore(plan.home);
  store.set('active',release);store.set('release:'+release.id,release);if(release.apk)store.set('latestApk',release);
  if(plan.migrationIntent)store.set('migrationIntent',plan.migrationIntent);
  if(plan.patchMigrationIntent)store.set('patchMigrationIntent',plan.patchMigrationIntent);
  store.set('draining',false);if(backup)store.set('lastBackup',backup);store.close();store=undefined;
  atomic(join(plan.home,'config.json'),JSON.stringify(plan.config,null,2)+'\n');
  copyFileSync(join(dirname(release.cli),'maintenance-loader.js'),join(plan.home,'maintenance-loader.js'));chmodSync(join(plan.home,'maintenance-loader.js'),0o600);
  const db=new DatabaseSync(join(plan.config.stateDir,'control.sqlite'));
  try{db.prepare('INSERT INTO config VALUES(?,?)').run('maintenanceHome',JSON.stringify(plan.home));committed=true;}finally{db.close();}
  writeReceipt(prepared,'complete',backup);
  return {home:plan.home,unitName:plan.unitName,release,alreadyInstalled:false,backup};
 }catch(error){
  store?.close();store=undefined;
  // If either ownership acquisition failed, no deployment bytes were touched.
  if(!releaseState)throw new MaintenanceInstallError('Installation could not acquire offline state ownership; recovery requires review',false,error);
  try{if(touched){if(committed)clearManaged(plan);clearDeployment(plan);writeReceipt(prepared,'prepared');}proveClean();}
  catch(rollbackError){throw new MaintenanceInstallError('Installation failed; clean metadata/floor rollback was not verified. Inspect retained evidence before recovery.',false,new AggregateError([error,rollbackError]));}
  throw new MaintenanceInstallError('Supervisor installation failed; state retained and install metadata rolled back',true,error);
 }finally{store?.close();releaseState?.();releaseSupervisor();}
}
function clearManaged(plan:MaintenanceInstallPlan){
 const db=new DatabaseSync(join(plan.config.stateDir,'control.sqlite'));
 try{const row=db.prepare("SELECT value FROM config WHERE key='maintenanceHome'").get();if(row?.value!==JSON.stringify(plan.home))throw Error('Managed state changed; rollback refused');db.prepare("DELETE FROM config WHERE key='maintenanceHome'").run();}finally{db.close();}
}
function clearDeployment(plan:MaintenanceInstallPlan){for(const name of ['config.json','maintenance-loader.js','journal.sqlite','journal.sqlite-wal','journal.sqlite-shm'])rmSync(join(plan.home,name),{force:true});}
/** Metadata-only rollback of this exact installation. Never removes releases,
 * rewrites floor/intent history, restores a DB, or restarts a standalone service. */
export async function rollbackMaintenanceInstall(prepared:PreparedMaintenanceInstall):Promise<void>{
 const {plan}=prepared;validatePrepared(prepared);
 const releaseSupervisor=acquireOwner(join(plan.home,'supervisor-owner'));let releaseState:(()=>void)|undefined;
 try{
  releaseState=acquireOwner(plan.config.stateDir);
  const done=completed(plan),managed=identity(plan.config.stateDir).managed;
  if(!managed){const r=json<{phase:string;prepared:PreparedMaintenanceInstall}>(join(plan.home,receiptName));if(r.phase==='prepared'&&JSON.stringify(r.prepared)===JSON.stringify(prepared))return;throw Error('No matching installation to roll back');}
  if(managed!==plan.home||!done||JSON.stringify(done)!==JSON.stringify(prepared))throw Error('Installation changed; rollback refused');
  // Do not roll a newer deployment back into standalone mode.
  const db=new DatabaseSync(join(plan.home,'journal.sqlite'),{readOnly:true});
  try{const active=db.prepare("SELECT value FROM settings WHERE key='active'").get();if(active?.value!==JSON.stringify(prepared.release)||db.prepare("SELECT 1 FROM jobs LIMIT 1").get())throw Error('Supervisor has accepted work or advanced release; rollback refused');}finally{db.close();}
  clearManaged(plan);clearDeployment(plan);
  writeReceipt(prepared,'prepared');
 }finally{releaseState?.();releaseSupervisor();}
}
