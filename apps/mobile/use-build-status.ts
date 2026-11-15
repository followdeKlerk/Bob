import {useEffect,useRef,useState} from 'react';
import {AppState} from 'react-native';
import * as Keychain from 'react-native-keychain';
export type BuildBackend={backendId:string;endpoint:string;name:string};
export type BuildJob={id:string;status:string;stage:string;error?:string;conversationId?:number;target?:string};
export type BuildState={enabled:boolean;reason?:string;message?:string;installCommand?:string;androidBuild?:{configured:boolean;reason?:string};supervisorOnline?:boolean;draining?:boolean;jobs?:BuildJob[];apk?:{releaseId:string;sha256:string;size:number;versionCode:number;versionName:string}};
export const activeBuild=(state?:BuildState)=>state?.jobs?.find(job=>['queued','building','activating'].includes(job.status));
export function useBuildStatus(backend?:BuildBackend){
 const [value,setValue]=useState<{backendId:string;endpoint:string;state:BuildState}>(),[failure,setFailure]=useState<{backendId:string;endpoint:string;message:string}>(),[tick,setTick]=useState(0);
 const json=useRef('');
 useEffect(()=>{
  if(!backend)return;
  const source=backend;
  type Attempt={controller:AbortController;timeout?:ReturnType<typeof setTimeout>};
  let stopped=false,foreground=AppState.currentState==='active',timer:ReturnType<typeof setTimeout>|undefined,attempt:Attempt|undefined;
  json.current='';
  const current=(owned:Attempt)=>!stopped&&foreground&&attempt===owned;
  function retire(){
   const old=attempt;attempt=undefined;
   if(old){clearTimeout(old.timeout);old.controller.abort();}
  }
  function schedule(delay:number){clearTimeout(timer);if(!stopped&&foreground)timer=setTimeout(()=>void poll(),delay);}
  async function poll(){
   if(stopped||attempt||!foreground)return;
   const owned:Attempt={controller:new AbortController()};attempt=owned;
   // An owned deadline is a real status-read failure. Lifecycle cancellation is
   // silent and releases ownership immediately, even if native fetch settles late.
   owned.timeout=setTimeout(()=>{
    if(!current(owned))return;
    setFailure({backendId:source.backendId,endpoint:source.endpoint,message:'Build status request timed out'});
    retire();schedule(15000);
   },12000);
   let working=false;
   try{
    const c=await Keychain.getGenericPassword({service:`bob.${source.backendId}`});if(!current(owned))return;
    if(!c)throw Error('Pairing credential unavailable');
    const response=await fetch(`${source.endpoint}/v1/updates`,{headers:{Authorization:`Bearer ${c.password}`,'x-bob-backend':source.backendId},signal:owned.controller.signal});
    if(!current(owned))return;
    if(!response.ok)throw Error(`Build status unavailable (${response.status})`);
    const state=await response.json() as BuildState;if(!current(owned))return;
    working=!!activeBuild(state);const raw=JSON.stringify(state);if(raw!==json.current){json.current=raw;setValue({backendId:source.backendId,endpoint:source.endpoint,state});}setFailure(undefined);
   }catch(e){if(current(owned))setFailure({backendId:source.backendId,endpoint:source.endpoint,message:String((e as Error).message??e)});}
   finally{
    clearTimeout(owned.timeout);
    if(attempt===owned){attempt=undefined;schedule(working?3000:15000);}
   }
  }
  void poll();
  const listener=AppState.addEventListener('change',state=>{
   foreground=state==='active';clearTimeout(timer);
   if(foreground)void poll();else retire();
  });
  return()=>{stopped=true;clearTimeout(timer);retire();listener.remove();};
 },[backend?.backendId,backend?.endpoint,tick]);
 return {state:value?.backendId===backend?.backendId&&value?.endpoint===backend?.endpoint?value?.state:undefined,error:failure?.backendId===backend?.backendId&&failure?.endpoint===backend?.endpoint?failure?.message??'':'',refresh:()=>setTick(n=>n+1)};
}
