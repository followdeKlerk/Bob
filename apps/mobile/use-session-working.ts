import {useEffect,useRef,useState} from 'react';
import {AppState} from 'react-native';

type Backend={backendId:string;endpoint:string};
type Status={backendId:string;inspection:{tasks:{record:{conversationId:number;background:boolean}}[];submissions:{conversationId:number}[]}};
const empty:ReadonlySet<number>=new Set();
/** Durable inspection contains unfinished work, not historical tasks. Background
 * watchers must not make an otherwise idle conversation spin indefinitely. */
export function workingSessions(status:Status):ReadonlySet<number>{
 return new Set([...status.inspection.tasks.filter(task=>!task.record.background).map(task=>task.record.conversationId),...status.inspection.submissions.map(item=>item.conversationId)]);
}
/** One existing status read for the visible session list, never one stream per row.
 * Status is ephemeral: don't persist working flags in the offline history cache. */
export function useSessionWorking(backend:Backend|undefined,visible:boolean,request:(signal:AbortSignal)=>Promise<Status>){
 const read=useRef(request);read.current=request;
 const scope=backend?`${backend.backendId}:${backend.endpoint}`:'';
 const [value,setValue]=useState<{scope:string;ids:ReadonlySet<number>}>();
 useEffect(()=>{
  setValue(undefined);
  if(!backend||!visible)return;
  let stopped=false,timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined;
  const clear=()=>{clearTimeout(timer);controller?.abort();controller=undefined;};
  async function poll(){
   if(stopped||controller||AppState.currentState!=='active')return;
   const current=new AbortController();controller=current;
   const timeout=setTimeout(()=>current.abort(),12000);
   try{
    const status=await read.current(current.signal);
    if(stopped||current.signal.aborted||controller!==current)return;
    if(status.backendId!==backend!.backendId)throw Error('Session status identity mismatch');
    setValue({scope,ids:workingSessions(status)});
   }catch{if(!stopped&&controller===current)setValue(undefined);}
   finally{
    clearTimeout(timeout);
    if(!stopped&&controller===current){controller=undefined;timer=setTimeout(()=>void poll(),3000);}
   }
  }
  void poll();
  const listener=AppState.addEventListener('change',state=>{
   clear();setValue(undefined);
   if(state==='active')void poll();
  });
  return()=>{stopped=true;clear();listener.remove();};
 },[scope,visible]);
 return visible&&value?.scope===scope?value.ids:empty;
}
