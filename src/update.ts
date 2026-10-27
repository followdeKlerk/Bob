import {createHash} from 'node:crypto';
import {copyFileSync,createReadStream,existsSync,lstatSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {spawnSync} from 'node:child_process';
import {State} from './state.js';
import {backupState,restoreState} from './recovery.js';
import {controlSchema,migrateControl} from './control-migrations.js';
import {openRuntime,ctx} from './runtime.js';
import {requireDisjoint} from './custom-migration.js';

export const releaseVersion='0.3.0';
export async function migrateState(state:State,backup:string){
  // Loading only a paused harness preserves unfinished work without executing it.
  const runtime=await openRuntime(state,undefined,undefined,{resume:false});
  try{const inspection=await runtime.harness.inspect(ctx);if(inspection.tasks.length||inspection.submissions.length)throw Error('Settle all Durable work before migration');}
  finally{await runtime.close();}
  let result:ReturnType<typeof migrateControl>|undefined;
  await backupState(state,backup,async()=>{result=migrateControl(state);});
  return {...result,backup,releaseVersion,backendId:state.id};
}
const nested=(parent:string,child:string)=>{const rel=relative(parent,child);return rel===''||(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('../'));};
export type UpdateOptions={version:string;package:string;sha256:string;installation:string;destination:string;backup:string;trustReleaseCode:boolean};
/** Offline side-by-side upgrade. Original state and installation remain the rollback point. */
export async function updateRelease(state:State,options:UpdateOptions){
  if(options.version!==releaseVersion)throw Error('Version not Bob-validated; no dependency or database upgrade performed');
  if(!options.trustReleaseCode)throw Error('Explicit --trust-release-code required for executable release code');
  if(!/^[a-f0-9]{64}$/.test(options.sha256))throw Error('Expected exact lowercase SHA-256');
  const archive=resolve(options.package),installation=resolve(options.installation),destination=resolve(options.destination),backup=resolve(options.backup);
  if(!lstatSync(archive).isFile()||lstatSync(archive).isSymbolicLink()||lstatSync(archive).size>256*1024*1024)throw Error('Release archive must be a regular file under 256 MiB');
  const paths=[resolve(state.dir),installation,destination,backup];
  requireDisjoint(paths);
  if([installation,destination,backup].some(existsSync))throw Error('Update destinations must be new; no existing installation or state is overwritten');
  if([installation,destination,backup].some(p=>nested(p,archive)))throw Error('Archive must be outside output directories');
  const digest=createHash('sha256');for await(const chunk of createReadStream(archive))digest.update(chunk);
  if(digest.digest('hex')!==options.sha256)throw Error('Release archive checksum mismatch');
  const runtime=await openRuntime(state,undefined,undefined,{resume:false});
  try{const inspection=await runtime.harness.inspect(ctx);if(inspection.tasks.length||inspection.submissions.length)throw Error('Settle all Durable work before update');}
  finally{await runtime.close();}
  let result:object|undefined;
  await backupState(state,backup,async()=>{
    mkdirSync(installation,{mode:0o700,recursive:true});
    let restored=false;
    try{
      const pinned=join(installation,'release.tgz');copyFileSync(archive,pinned);
      const copied=createHash('sha256');for await(const chunk of createReadStream(pinned))copied.update(chunk);
      if(copied.digest('hex')!==options.sha256)throw Error('Release changed during preparation');
      const installed=spawnSync('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--omit=dev','--prefix',installation,pinned],{encoding:'utf8',timeout:120000,maxBuffer:1024*1024});
      if(installed.status!==0)throw Error('Offline package installation failed; original state and verified backup retained');
      const packageRoot=join(installation,'node_modules/@bob-local/cli');
      const manifest=JSON.parse(readFileSync(join(packageRoot,'package.json'),'utf8'));
      if(manifest.name!=='@bob-local/cli'||manifest.version!==options.version||manifest.dependencies?.['@earendil-works/pi-durable']!=='1.4.0')throw Error('Installed release identity/version/runtime mismatch');
      restoreState(backup,destination);
      restored=true;
      const cli=join(packageRoot,'dist/cli.js');
      const run=(args:string[])=>{const child=spawnSync(process.execPath,[cli,'--state',destination,...args],{encoding:'utf8',timeout:60000,maxBuffer:1024*1024});if(child.status!==0)throw Error('Candidate validation failed: '+args[0]+'; original state and backup retained');return JSON.parse(child.stdout);};
      const migration=run(['migrate','--backup',join(installation,'pre-migration')]);
      const health=run(['doctor']);
      if(health.backendId!==state.id||health.releaseVersion!==options.version||health.controlSchema!==2||health.ownership!=='available')throw Error('Candidate health/identity/schema mismatch');
      const modules=run(['module','list']);
      if(!Array.isArray(modules)||modules.length<6)throw Error('Candidate module catalog unavailable');
      result={version:options.version,previousVersion:'0.1.0-compatible',backendId:state.id,installation,state:destination,backup,migration,verified:true,activation:'Explicit cutover: keep the original service stopped. Invoke the new CLI with the migrated state, or install its scoped service. No service was restarted automatically.',command:[process.execPath,cli,'--state',destination],rollback:'Before accepting new work, discard only the new installation/state and use the untouched original. After accepting work, restoring the pre-update backup loses subsequent work; no automatic rollback or arbitrary downgrade.'};
      writeFileSync(join(installation,'update-receipt.json'),JSON.stringify(result,null,2),{mode:0o600,flag:'wx'});
    }catch(error){
      // These are new paths exclusively created by this invocation; original/backup never removed.
      if(restored)rmSync(destination,{recursive:true,force:true});rmSync(installation,{recursive:true,force:true});throw error;
    }
  });
  return result;
}
