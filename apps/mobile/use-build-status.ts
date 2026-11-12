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
  if(!backend)return;let stopped=false,timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined,running=false;
  json.current='';
  async function poll(){
   if(stopped||running||AppState.currentState!=='active')return;running=true;
   controller=new AbortController();const timeout=setTimeout(()=>controller?.abort(),12000);let working=false;
   try{
    const c=await Keychain.getGenericPassword({service:`bob.${backend!.backendId}`});if(!c)throw Error('Pairing credential unavailable');
    const response=await fetch(`${backend!.endpoint}/v1/updates`,{headers:{Authorization:`Bearer ${c.password}`,'x-bob-backend':backend!.backendId},signal:controller.signal});
    if(!response.ok)throw Error(`Build status unavailable (${response.status})`);
    const state=await response.json() as BuildState;if(stopped)return;
    working=!!activeBuild(state);const raw=JSON.stringify(state);if(raw!==json.current){json.current=raw;setValue({backendId:backend!.backendId,endpoint:backend!.endpoint,state});}setFailure(undefined);
   }catch(e){if(!stopped)setFailure({backendId:backend!.backendId,endpoint:backend!.endpoint,message:String((e as Error).message??e)});}
   finally{clearTimeout(timeout);running=false;if(!stopped)timer=setTimeout(()=>void poll(),working?3000:15000);}
  }
  void poll();const listener=AppState.addEventListener('change',state=>{if(state==='active'){clearTimeout(timer);void poll();}else{clearTimeout(timer);controller?.abort();}});
  return()=>{stopped=true;clearTimeout(timer);controller?.abort();listener.remove();};
 },[backend?.backendId,backend?.endpoint,tick]);
 return {state:value?.backendId===backend?.backendId&&value?.endpoint===backend?.endpoint?value?.state:undefined,error:failure?.backendId===backend?.backendId&&failure?.endpoint===backend?.endpoint?failure?.message??'':'',refresh:()=>setTick(n=>n+1)};
}
