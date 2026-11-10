import {useCallback,useEffect,useRef,useState} from 'react';
import {AppState} from 'react-native';
export type SessionFilter='all'|'archived'|'trash';
export type AgentStatus='working'|'stopping'|'idle'|'unknown';
export type OverviewAgent={name:string;conversationId:number;status:AgentStatus};
export type AgentSession={conversationId:number;title:string;status:AgentStatus;agents:OverviewAgent[];pinned?:boolean;archived?:boolean;trashed?:boolean;readOnly?:boolean};
export type AgentOverviewPage={backendId:string;sessions:AgentSession[];next?:string};
type Backend={backendId:string;endpoint:string};
function checkedPage(value:AgentOverviewPage,backendId:string){
 const id=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>0;
 const status=(value:unknown)=>['working','stopping','idle','unknown'].includes(String(value));
 if(value?.backendId!==backendId||!Array.isArray(value.sessions)||value.sessions.some(s=>!id(s.conversationId)||typeof s.title!=='string'||!status(s.status)||['pinned','archived','trashed','readOnly'].some(key=>(s as any)[key]!==undefined&&typeof (s as any)[key]!=='boolean')||!Array.isArray(s.agents)||s.agents.some(a=>!id(a.conversationId)||typeof a.name!=='string'||!status(a.status)))||(value.next!==undefined&&typeof value.next!=='string'))throw Error('Invalid agent overview');
 return value;
}
/** One bounded, metadata-only overview poll; only the explicitly opened helper
 * gets a transcript stream. Old results cannot cross workstation/visibility changes. */
export function useAgentOverview(backend:Backend|undefined,visible:boolean,request:(path:string,signal:AbortSignal)=>Promise<AgentOverviewPage>,filter?:SessionFilter){
 const read=useRef(request);read.current=request;
 const scope=backend?backend.backendId+':'+backend.endpoint+':'+(filter??''):'';
 const [state,setState]=useState<{scope:string;sessions:AgentSession[];next?:string;loading:boolean;error?:string}>();
 const [version,setVersion]=useState(0),pages=useRef(1),refresh=useRef<()=>void>(()=>{});
 useEffect(()=>{pages.current=1;},[scope]);
 useEffect(()=>{
  setState(old=>old?.scope===scope?old:undefined);
  if(!backend||!visible)return;
  let stopped=false,timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined;
  const clear=()=>{clearTimeout(timer);controller?.abort();controller=undefined;};
  async function poll(){
   if(stopped||controller||AppState.currentState!=='active')return;
   const current=new AbortController();controller=current;
   setState(old=>({scope,sessions:old?.scope===scope?old.sessions:[],next:old?.scope===scope?old.next:undefined,loading:true}));
   const timeout=setTimeout(()=>current.abort(),15000);
   try{
    let next:string|undefined;const sessions=new Map<number,AgentSession>(),cursors=new Set<string>();
    for(let page=0;page<pages.current;page++){
     const result=checkedPage(await read.current('agent-overview'+((filter||next)?'?'+[filter?'filter='+filter:'',next?'cursor='+encodeURIComponent(next):''].filter(Boolean).join('&'):''),current.signal),backend!.backendId);
     if(stopped||current.signal.aborted||controller!==current)return;
     for(const session of result.sessions)sessions.set(session.conversationId,session);
     next=result.next;if(!next)break;
     if(cursors.has(next))throw Error('Repeated overview cursor');cursors.add(next);
    }
    setState({scope,sessions:[...sessions.values()],next,loading:false});
   }catch{
    if(!stopped&&controller===current)setState(old=>({scope,sessions:old?.scope===scope?old.sessions.map(s=>({...s,status:'unknown',agents:s.agents.map(a=>({...a,status:'unknown'}))})):[],next:old?.next,loading:false,error:'Could not refresh agents. Status may be out of date.'}));
   }finally{
    clearTimeout(timeout);
    if(!stopped&&controller===current){controller=undefined;timer=setTimeout(()=>void poll(),5000);}
   }
  }
  refresh.current=()=>{clear();void poll();};void poll();
  const listener=AppState.addEventListener('change',value=>{clear();if(value==='active')void poll();});
  return()=>{stopped=true;clear();refresh.current=()=>{};listener.remove();};
 },[scope,visible,version]);
 const retry=useCallback(()=>refresh.current(),[]);
 const loadMore=useCallback(()=>{if(state?.next&&!state.loading){pages.current++;setVersion(value=>value+1);}},[state?.next,state?.loading]);
 return {sessions:visible&&state?.scope===scope?state.sessions:[],loading:visible&&(!state||state.scope!==scope||state.loading),error:state?.scope===scope?state.error:undefined,next:state?.scope===scope?state.next:undefined,retry,loadMore};
}
