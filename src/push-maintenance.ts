import type {State} from './state.js';
import {withMaintenance} from './maintenance-port.js';
import type {UpdateJob} from './maintenance.js';

/** The build supervisor is a separate process. Observe only its bounded deployment
 * journal; this is a notification transport relay, never a second task scheduler. */
export function watchPushMaintenance(
 state:State,
 attention:(key:string)=>unknown,
 options:{intervalMs?:number;read?:()=>UpdateJob[]}={},
){
 if(!state.get('maintenanceHome')&&!options.read)return ()=>{};
 const read=options.read??(()=>withMaintenance(state,store=>store.jobs()));
 const key='pushMaintenanceSeen';
 const terminal=(job:UpdateJob)=>job.status==='complete'||job.status==='failed';
 let stopped=false;
 const tick=()=>{
  if(stopped)return;
  try{
   const jobs=read().filter(terminal);
   const seen=state.get<string[]>(key);
   // An installation starts now; historical completed builds are not new alerts.
   if(!seen){state.set(key,jobs.map(job=>`${job.id}:${job.status}`));return;}
   const known=new Set(seen);
   for(const job of jobs){
    const id=`${job.id}:${job.status}`;
    if(known.has(id))continue;
    // Queue first. The sender coalesces/deduplicates this stable event key.
    attention(`maintenance:${id}`);
    known.add(id);
   }
   const next=[...known].slice(-200);
   if(next.length!==seen.length||next.some((value,index)=>value!==seen[index]))state.set(key,next);
  }catch{
   // Don't leak journal paths or credentials. Keep cursor unchanged and try later.
   console.error('[push] Build notification relay unavailable; will retry.');
  }
 };
 tick();
 const timer=setInterval(tick,options.intervalMs??2000);timer.unref();
 return ()=>{stopped=true;clearInterval(timer);};
}
