import {readFileSync,mkdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {MaintenanceStore,MaintenanceSupervisor,type MaintenanceConfig,type Release} from './maintenance.js';
import {buildRelease} from './maintenance-build.js';
import {acquireOwner} from './ownership.js';
import {supervisorProtocol,patchSupervisorProtocol,type SupervisorEvidence} from './maintenance-migration.js';
const home=process.argv[2];if(!home)throw Error('Maintenance home required');
const config=JSON.parse(readFileSync(join(home,'config.json'),'utf8')) as MaintenanceConfig;
const ownerDir=join(home,'supervisor-owner');mkdirSync(ownerDir,{recursive:true,mode:0o700});
const releaseSupervisor=acquireOwner(ownerDir); // No competing runner can rewrite recovery decisions.
const store=new MaintenanceStore(home),supervisor=new MaintenanceSupervisor(home,config,store);
const loaded=store.get<Release>('active'),own=dirname(fileURLToPath(import.meta.url));
const runnerRelease=loaded&&dirname(loaded.cli)===own?loaded:undefined;
store.set('supervisorEvidence',null);
let stopping=false;
for(const signal of ['SIGTERM','SIGINT'] as const)process.on(signal,()=>{if(stopping)return;stopping=true;void supervisor.stop().then(()=>process.exit(0),()=>process.exit(1));});
let heartbeat:ReturnType<typeof setInterval>|undefined;
try{
 const active=supervisor.recoveryRelease();
 store.set('draining',false);
 for(const job of store.jobs())if(['building','activating'].includes(job.status))store.patch(job.id,{status:'failed',stage:'Interrupted; running state retained. Request a new build.',error:'Supervisor restarted during operation; build was not replayed.'});
 await supervisor.start(active);
 // Interrupted migration may have selected a different active release before
 // any queued job runs. Hand off after health; never stay an old runner forever.
 if(runnerRelease?.id!==active.id||runnerRelease?.cli!==active.cli){
  store.set('draining',true);await supervisor.stop();process.exit(0);
 }
 let restarting=false,restartFailure:Error|undefined;
 const beat=()=>{
  store.set('heartbeat',Date.now());
  if(runnerRelease)store.set('supervisorEvidence',{supervisorProtocol,patchSupervisorProtocol,pid:process.pid,release:{id:runnerRelease.id,cli:runnerRelease.cli,compatibility:runnerRelease.compatibility,sourceHash:runnerRelease.sourceHash},at:Date.now()} satisfies SupervisorEvidence);
 };
 heartbeat=setInterval(()=>{
  beat();
  if(!stopping&&!restarting&&!supervisor.transitioning&&!supervisor.expectedStop&&(supervisor.child?.exitCode!==null||supervisor.child?.signalCode!==null)){
   restarting=true;
   void (async()=>{
    try{await supervisor.start(supervisor.recoveryRelease());}
    catch(error){
     restartFailure=error instanceof Error?error:Error(String(error));stopping=true;
     try{await supervisor.stop();}catch(stopError){restartFailure=new AggregateError([restartFailure,stopError],'Backend recovery and cleanup failed');}
    }finally{restarting=false;}
   })();
  }
 },2000);beat();
 while(!stopping){
  if(restarting){await new Promise(r=>setTimeout(r,500));continue;}
  const job=store.jobs().reverse().find(j=>j.status==='queued');
  if(!job){await new Promise(r=>setTimeout(r,750));continue;}
  try{
   if(job.action==='rollback'){
    const previous=store.get<Release>('previous');if(!previous)throw Error('No previous release available');
    store.patch(job.id,{status:'activating',stage:'Waiting for active work, then restoring previous code'});await supervisor.activate(previous);
   }else{
    const release=await buildRelease(home,config,store,job);
    if(job.action==='update'&&job.target!=='android'){
     store.patch(job.id,{status:'activating',stage:'Waiting for active work, then restarting backend'});await supervisor.activate(release);
    }
   }
   store.patch(job.id,{status:'complete',stage:job.action==='rollback'?'Previous code restored; chat data retained':job.target==='backend'?'Backend update complete':'Ready — install the signed APK in chat'});
   const installed=supervisor.recoveryRelease(); // Re-exec choices obey the same read-only floor guard.
   const own=dirname(fileURLToPath(import.meta.url)),next=dirname(installed.cli);
   // Evidence must keep naming the actual runner. Even identical supervisor code
   // needs a handoff when the active release identity changes; never relabel it.
   if(runnerRelease?.id!==installed.id||runnerRelease?.cli!==installed.cli||['maintenance.js','maintenance-build.js','maintenance-runner.js','maintenance-migration.js'].some(file=>!readFileSync(join(own,file)).equals(readFileSync(join(next,file))))){
    store.set('draining',true);await supervisor.stop();process.exit(0); // systemd restarts through the stable loader into the active release.
   }
  }catch(error){store.patch(job.id,{status:'failed',stage:'Update stopped safely',error:error instanceof Error?error.message:String(error)});if(supervisor.expectedStop)throw error;}
 }
 if(restartFailure)throw restartFailure;
}finally{
 if(heartbeat)clearInterval(heartbeat);
 try{try{store.set('supervisorEvidence',null);}finally{await supervisor.stop();}}
 finally{try{store.close();}finally{releaseSupervisor();}}
}
