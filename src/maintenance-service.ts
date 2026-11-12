import {createHash} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {setupUnitName} from './setup-service.js';
export const unitDigest=(content:string)=>createHash('sha256').update(content).digest('hex');
export function dropInDigest(paths:string[]){
 const hash=createHash('sha256');
 for(const path of [...paths].sort()){
  if(!path.startsWith('/')||/[\s\x00-\x1f]/.test(path))throw Error('Drop-in paths with whitespace or control characters require manual review.');
  hash.update(path+'\0').update(regular(path)).update('\0');
 }
 return hash.digest('hex');
}
export type ServiceRun=(args:string[])=>string;
export type MaintenanceHandover<T>={
 directory:string;backendId:string;content:string;replaceHash?:string;dropInsHash?:string;
 prepare:()=>Promise<T>;
 commit:(prepared:T)=>Promise<{rollback:()=>Promise<void>|void}>;
 /** Explicit proof from the provisioning core, never error-message matching. */
 commitFailedCleanly?:(error:unknown)=>boolean;
 verify:()=>Promise<void>;
};
function validateEnvironmentDropIn(text:string){
 let service=false;
 for(const raw of text.split(/\r?\n/)){
  const line=raw.trim();if(!line||line.startsWith('#')||line.startsWith(';'))continue;
  if(line==='[Service]'){service=true;continue;}
  if(!service||!line.startsWith('Environment=')||line.endsWith('\\'))throw Error('Only explicit single-line [Service] Environment drop-ins are supported; runtime/service overrides require manual review.');
  // Do not allow environment overrides to disable TLS or preload arbitrary code.
  if(/(?:NODE_OPTIONS|NODE_TLS_REJECT_UNAUTHORIZED|LD_PRELOAD|BOB_\w+)\s*=/.test(line))throw Error('Drop-in changes runtime authority; automatic conversion refused.');
 }
}
function regular(file:string){const st=lstatSync(file);if(!st.isFile()||st.isSymbolicLink())throw Error('Service must be a regular file, not a symlink.');return readFileSync(file,'utf8');}
/** Run from an independent maintenance process, never inside the backend being replaced. */
export async function handoverMaintenanceService<T>(options:MaintenanceHandover<T>,run:ServiceRun){
 const {directory,backendId,content,replaceHash}=options,name=setupUnitName(backendId),file=join(directory,name);
 const previous=existsSync(file)?regular(file):undefined;
 if(previous!==undefined&&previous!==content&&(!replaceHash||unitDigest(previous)!==replaceHash))throw Error('Existing service differs. Explicit replacement requires its current SHA-256; nothing was stopped.');
 if(previous===undefined&&replaceHash)throw Error('Expected standalone service is missing; nothing was stopped.');
 const known=run(['list-unit-files',name,'--no-legend','--no-pager']).trim();
 if(known){
  const fragment=run(['show',name,'--property=FragmentPath','--value']).trim();
  if(fragment!==resolve(file))throw Error('Service is managed elsewhere; nothing was stopped.');
  const dropIns=run(['show',name,'--property=DropInPaths','--value']).trim().split(/\s+/).filter(Boolean);
  if(dropIns.length&&(!options.dropInsHash||dropInDigest(dropIns)!==options.dropInsHash))throw Error('Service has additional configuration; its exact drop-in digest is required.');
  for(const path of dropIns)validateEnvironmentDropIn(regular(path));
 }
 const active=known?run(['show',name,'--property=ActiveState','--value']).trim():'inactive';
 if(!['active','inactive','failed'].includes(active))throw Error('Service is transitioning; wait before installing updates.');
 if(active==='active'&&(!replaceHash||previous===content))throw Error('An active service is not automatically replaced. Use its existing update flow.');
 const enabled=known?run(['show',name,'--property=UnitFileState','--value']).trim():'';
 const prepared=await options.prepare(); // Package and validate before taking the chat offline.
 if((previous!==undefined?regular(file):existsSync(file)?'appeared':undefined)!==previous)throw Error('Service changed during preparation; nothing was stopped.');
 if(known){const paths=run(['show',name,'--property=DropInPaths','--value']).trim().split(/\s+/).filter(Boolean);if((paths.length||options.dropInsHash)&&dropInDigest(paths)!==options.dropInsHash)throw Error('Service drop-ins changed during preparation; nothing was stopped.');}
 let stopped=false,changed=false,commitStarted=false,rollback:(()=>Promise<void>|void)|undefined;
 const write=(value:string)=>{mkdirSync(directory,{recursive:true,mode:0o700});const temp=mkdtempSync(join(directory,'.bob-unit-'));try{const staged=join(temp,'unit');writeFileSync(staged,value,{mode:0o600,flag:'wx'});renameSync(staged,file);}finally{rmSync(temp,{recursive:true,force:true});}};
 try{
  if(active==='active'){run(['stop',name]);stopped=true;}
  commitStarted=true;const installed=await options.commit(prepared);rollback=installed.rollback;
  write(content);changed=true;run(['daemon-reload']);run(['enable','--now',name]);
  await options.verify();
  return {name,file,supervised:true as const};
 }catch(error){
  const failures:unknown[]=[error];
  if(commitStarted&&!rollback&&!options.commitFailedCleanly?.(error))throw new AggregateError(failures,'Supervisor commit did not confirm clean rollback. Original service was not restarted; inspect retained installation evidence.');
  if(changed){
   try{if(regular(file)!==content)throw Error('Service changed externally; recovery requires owner review.');run(['stop',name]);}catch(stopError){throw new AggregateError([...failures,stopError],'Supervisor installation failed; could not safely stop the candidate. State was not rolled back.');}
  }
  try{await rollback?.();}catch(rollbackError){throw new AggregateError([...failures,rollbackError],'Supervisor installation failed; state cleanup needs review. Previous service was not restarted.');}
  try{
   if(changed){if(previous===undefined){run(['disable',name]);rmSync(file);}else write(previous);run(['daemon-reload']);if(previous!==undefined&&enabled!=='enabled')run(['disable',name]);}
   if(stopped)run(['start',name]);
  }catch(recoveryError){failures.push(recoveryError);}
  throw new AggregateError(failures,'Supervisor installation failed; original service recovery was attempted. See the local error details.');
 }
}
