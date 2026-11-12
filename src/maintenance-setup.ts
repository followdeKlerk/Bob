import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {existsSync,lstatSync,readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {isIPv4} from 'node:net';
import {planMaintenanceInstall,prepareMaintenanceInstall,installMaintenanceSupervisor,rollbackMaintenanceInstall,renderMaintenanceService,MaintenanceInstallError,type MaintenanceInstallOptions} from './maintenance-install.js';
import {handoverMaintenanceService,unitDigest,type ServiceRun} from './maintenance-service.js';
import {setupUnitName} from './setup-service.js';
export type UpdateInstallArguments={
 stateDir:string;source:string;currentCli?:string;node?:string;home?:string;unitDirectory?:string;
 origin:string;endpoint?:string;host:string;port:number;cert?:string;key?:string;
 replaceStandalone?:boolean;expectedUnitSha256?:string;expectedDropinsSha256?:string;retainedJournalHome?:string;
 javaHome?:string;androidHome?:string;signingProperties?:string;referenceApk?:string;
};
function controlIdentity(stateDir:string){
 const db=new DatabaseSync(join(stateDir,'control.sqlite'),{readOnly:true});
 try{const row=db.prepare("SELECT value FROM config WHERE key='identity'").get();const id=row&&JSON.parse(String(row.value));setupUnitName(id);return String(id);}finally{db.close();}
}
export const systemctlUser:ServiceRun=args=>{
 const result=spawnSync('systemctl',['--user',...args],{encoding:'utf8',timeout:60000,maxBuffer:1024*1024});
 if(result.error||result.status!==0)throw Error(`systemctl ${args[0]} failed. Inspect this backend's service locally; no mutation was retried.`);
 return result.stdout;
};
/** No model request, no device grant, no trust bypass: identity probe plus actual runner evidence. */
export async function verifyMaintenanceReady(home:string,backendId:string,endpoint:string,timeoutMs=60000){
 const deadline=Date.now()+timeoutMs;let last:unknown;
 while(Date.now()<deadline){
  try{
   const db=new DatabaseSync(join(home,'journal.sqlite'),{readOnly:true});
   let active:any,evidence:any,heartbeat:number;
   try{const get=(key:string)=>{const row=db.prepare('SELECT value FROM settings WHERE key=?').get(key);return row?JSON.parse(String(row.value)):undefined;};active=get('active');evidence=get('supervisorEvidence');heartbeat=get('heartbeat');}finally{db.close();}
   if(!active||evidence?.release?.id!==active.id||evidence?.release?.cli!==active.cli||evidence?.patchSupervisorProtocol!=='bob-pi151-v1'||!Number.isFinite(heartbeat)||Date.now()-heartbeat>=15000)throw Error('Waiting for the installed supervisor evidence');
   const response=await fetch(new URL('/v1/pair',endpoint),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({backendId,invitation:'!'.repeat(43),name:'Update-service readiness check'}),signal:AbortSignal.timeout(3000)});
   if(response.status!==401||(await response.json() as {error?:string}).error!=='Invalid or expired invitation')throw Error('Backend identity readiness probe failed');
   return;
  }catch(error){last=error;if(Date.now()<deadline)await new Promise(ok=>setTimeout(ok,300));}
 }
 throw Error('The supervised backend did not become ready; original service recovery is required.',{cause:last});
}
export function updateInstallOptions(args:UpdateInstallArguments):MaintenanceInstallOptions{
 const stateDir=resolve(args.stateDir),sourceRoot=resolve(args.source),node=resolve(args.node??process.execPath),currentCli=resolve(args.currentCli??join(sourceRoot,'dist/cli.js'));
 if(!Number.isInteger(args.port)||args.port<1024||args.port>65535)throw Error('Use an unprivileged backend port.');
 const octets=args.host.split('.').map(Number);
 if(!isIPv4(args.host)||(args.host!=='127.0.0.1'&&!(octets[0]===100&&octets[1]>=64&&octets[1]<=127)))throw Error('Use loopback or a literal Tailscale IPv4 backend listener.');
 if((args.cert===undefined)!==(args.key===undefined))throw Error('TLS certificate and private-key paths must be supplied together.');
 const origin=new URL(args.origin);
 if(origin.protocol==='http:'&&!['127.0.0.1','localhost'].includes(origin.hostname))throw Error('Plain HTTP health checks are allowed only on loopback.');
 if(!['http:','https:'].includes(origin.protocol)||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw Error('Use a plain backend health origin.');
 const backendId=controlIdentity(stateDir),unitDirectory=resolve(args.unitDirectory??join(homedir(),'.config/systemd/user')),unit=join(unitDirectory,setupUnitName(backendId));
 let standaloneUnit:string|undefined;
 if(existsSync(unit)){
  if(!lstatSync(unit).isFile()||lstatSync(unit).isSymbolicLink())throw Error('Existing service is not a regular file.');
  standaloneUnit=readFileSync(unit,'utf8');
  if(!args.replaceStandalone||!args.expectedUnitSha256||unitDigest(standaloneUnit)!==args.expectedUnitSha256)throw Error('Replacing an existing service requires --replace-standalone and --expected-unit-sha256 matching its current bytes.');
 }
 const serveArgs=['--state',stateDir,'serve','--host',args.host,'--port',String(args.port)];
 if(args.cert)serveArgs.push('--cert',resolve(args.cert),'--key',resolve(args.key!));
 return {sourceRoot,currentCli,node,stateDir,unitDirectory,home:args.home?resolve(args.home):undefined,origin:origin.origin,serveArgs,standaloneUnit,allowLivePreparation:!!args.replaceStandalone,retainedJournalHome:args.retainedJournalHome,javaHome:args.javaHome,androidHome:args.androidHome,signingProperties:args.signingProperties,referenceApk:args.referenceApk};
}
/** Must be launched outside the affected Bob backend (for example a delayed user maintenance unit). */
export async function installUpdatesOnHost(args:UpdateInstallArguments,run:ServiceRun=systemctlUser){
 const options=updateInstallOptions(args),id=controlIdentity(options.stateDir);
 if(process.platform==='linux'&&readFileSync('/proc/self/cgroup','utf8').includes('/'+setupUnitName(id)))throw Error('Run update installation from an independent maintenance process, not from inside the backend being replaced.');
 const plan=planMaintenanceInstall(options);
 const content=renderMaintenanceService(options.node,plan.home,plan.backendId);
 const result=await handoverMaintenanceService({directory:options.unitDirectory,backendId:plan.backendId,content,replaceHash:args.replaceStandalone?args.expectedUnitSha256:undefined,dropInsHash:args.expectedDropinsSha256,
  prepare:()=>prepareMaintenanceInstall(plan),
  commit:async prepared=>{await installMaintenanceSupervisor(prepared);return {rollback:()=>rollbackMaintenanceInstall(prepared)};},
  commitFailedCleanly:error=>error instanceof MaintenanceInstallError&&error.recoverySafe,
  verify:()=>verifyMaintenanceReady(plan.home,plan.backendId,args.endpoint??options.origin),
 },run);
 return {...result,backendId:plan.backendId,maintenanceHome:plan.home,androidConfigured:!!(args.javaHome&&args.androidHome&&args.signingProperties&&args.referenceApk)};
}
