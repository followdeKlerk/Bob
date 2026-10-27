import {readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {MaintenanceStore,MaintenanceSupervisor,type MaintenanceConfig,type Release} from './maintenance.js';
import {buildRelease} from './maintenance-build.js';
const home=process.argv[2];if(!home)throw Error('Maintenance home required');
const config=JSON.parse(readFileSync(join(home,'config.json'),'utf8')) as MaintenanceConfig;
const store=new MaintenanceStore(home),supervisor=new MaintenanceSupervisor(home,config,store);
let stopping=false;
for(const signal of ['SIGTERM','SIGINT'] as const)process.on(signal,()=>{if(stopping)return;stopping=true;void supervisor.stop().then(()=>process.exit(0),()=>process.exit(1));});
const interrupted=store.get<{previous:Release;candidate:Release}>('transition');
if(interrupted){store.set('active',interrupted.previous);store.set('transition',null);}
store.set('draining',false);
for(const job of store.jobs())if(['building','activating'].includes(job.status))store.patch(job.id,{status:'failed',stage:'Interrupted; running state retained. Request a new build.',error:'Supervisor restarted during operation; build was not replayed.'});
const active=store.get<Release>('active');if(!active)throw Error('No installed backend release');
await supervisor.start(active);
let restarting=false;
const heartbeat=setInterval(()=>{
 store.set('heartbeat',Date.now());
 if(!stopping&&!restarting&&!supervisor.transitioning&&!supervisor.expectedStop&&(supervisor.child?.exitCode!==null||supervisor.child?.signalCode!==null)){
  restarting=true;void supervisor.start(store.get<Release>('active')!).catch(()=>process.exit(1)).finally(()=>{restarting=false;});
 }
},2000);store.set('heartbeat',Date.now());
try{
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
   const installed=store.get<Release>('active')!;
   const own=dirname(fileURLToPath(import.meta.url)),next=dirname(installed.cli);
   if(['maintenance.js','maintenance-build.js','maintenance-runner.js'].some(file=>!readFileSync(join(own,file)).equals(readFileSync(join(next,file))))){
    store.set('draining',true);await supervisor.stop();process.exit(0); // systemd restarts through the stable loader into the active release.
   }
  }catch(error){store.patch(job.id,{status:'failed',stage:'Update stopped safely',error:error instanceof Error?error.message:String(error)});}
 }
}finally{clearInterval(heartbeat);await supervisor.stop();store.close();}
