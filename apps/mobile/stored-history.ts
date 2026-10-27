import {useEffect,useRef,useState} from 'react';
import {AppState} from 'react-native';
import {HistoryPage} from '../../src/contracts';
import {retryDelay,retryableError} from './network-policy';
import {readHistoryCache,writeHistoryCache} from './history-cache';
type Page=ReturnType<typeof HistoryPage.parse>;
type Session={scope:string;backendId?:string;conversationId?:number;ready:boolean;loading:boolean;page?:Page;error?:string;controller?:AbortController;retry?:ReturnType<typeof setTimeout>;attempts?:number;retryAfterAt?:number};
const sorted=(items:Page['items'])=>Array.from(new Map(items.map(entry=>[entry.id,entry])).values()).sort((a,b)=>a.id-b.id);
export function mergeLatestHistory(previous:Page|undefined,page:Page):Page{
 if(!previous?.items.length)return {...page,items:sorted(page.items)};
 if(!page.items.length)return previous;
 const known=new Map(previous.items.map(item=>[item.id,item]));
 // If more than a page arrived while offline, do not jump over the missing middle.
 if(!page.items.some(item=>known.has(item.id)))return {...page,items:sorted(page.items)};
 const older=Math.min(...previous.items.map(item=>item.id))<Math.min(...page.items.map(item=>item.id));
 // Durable entries are immutable. A resume refresh must not replace identical
 // message objects and force all the variable-height cells to measure again.
 const items=sorted([...previous.items,...page.items.map(item=>known.get(item.id)??item)]),next=older?previous.next:page.next;
 if(next===previous.next&&items.length===previous.items.length&&items.every((item,index)=>item===previous.items[index]))return previous;
 return {...page,items,next};
}
/** Restore cached history immediately, then fetch the latest stored page on every conversation open. */
export function useStoredHistory(backendId:string|undefined,conversationId:number|undefined,request:(path:string,signal?:AbortSignal)=>Promise<unknown>){
 const scope=backendId&&conversationId?`${backendId}:${conversationId}`:'';
 const active=useRef<Session|undefined>(undefined),requestRef=useRef(request);requestRef.current=request;
 const scopeRef=useRef(scope);scopeRef.current=scope;
 const [state,setState]=useState<Session>({scope:'',ready:false,loading:false});
 function publish(session:Session){if(active.current===session&&scopeRef.current===session.scope)setState({...session});}
 async function fetchPage(session:Session,older=false){
  if(!session.scope||session.loading||active.current!==session||scopeRef.current!==session.scope)return;
  if((session.retryAfterAt??0)>Date.now()){
   if(!session.retry)session.retry=setTimeout(()=>{session.retry=undefined;if(AppState.currentState!=='background'&&AppState.currentState!=='inactive')void fetchPage(session,older).catch(()=>{});},session.retryAfterAt!-Date.now());
   return;
  }
  clearTimeout(session.retry);session.retry=undefined;session.loading=true;publish(session);
  const previous=session.page,controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);session.controller=controller;
  try{
   const cursor=older?previous?.next:undefined;
   const page=HistoryPage.parse(await requestRef.current(`chats/${session.conversationId}/history${cursor?'?cursor='+encodeURIComponent(cursor):''}`,controller.signal));
   if(page.backendId!==session.backendId||page.conversationId!==session.conversationId)throw Object.assign(Error('History identity mismatch'),{httpStatus:409});
   if(active.current!==session||scopeRef.current!==session.scope)return;
   session.page=older&&previous?{...page,items:sorted([...previous.items,...page.items])}:mergeLatestHistory(previous,page);
   session.ready=true;session.error=undefined;session.attempts=0;session.retryAfterAt=undefined;publish(session);
   void writeHistoryCache(`history-pages:${session.scope}`,JSON.stringify(session.page));
  }catch(error){
   if(active.current===session&&scopeRef.current===session.scope){session.error=String((error as Error).message??error);session.ready=true;publish(session);
    if(retryableError(error)&&AppState.currentState!=='background'&&AppState.currentState!=='inactive'){
     session.attempts=(session.attempts??0)+1;
     const minimum=(error as {retryAfterMs?:number}).retryAfterMs??0;
     session.retryAfterAt=Number.isFinite(minimum)&&minimum>0?Date.now()+minimum:undefined;
     const delay=Math.max(retryDelay(session.attempts),minimum);
     session.retry=setTimeout(()=>{session.retry=undefined;if(AppState.currentState!=='background'&&AppState.currentState!=='inactive')void fetchPage(session,older).catch(()=>{});},delay);
    }}
   throw error;
  }finally{clearTimeout(timeout);session.controller=undefined;session.loading=false;publish(session);}
 }
 useEffect(()=>{
  const session:Session={scope,backendId,conversationId,ready:false,loading:false};active.current=session;publish(session);
  if(!scope)return;
  void(async()=>{
   try{
    const cached=await readHistoryCache(`history-pages:${scope}`);
    if(cached){const page=HistoryPage.parse(JSON.parse(cached));if(page.backendId===backendId&&page.conversationId===conversationId)session.page={...page,items:sorted(page.items)};}
   }catch{/* Invalid local cache cannot block authoritative history loading. */}
   if(active.current!==session||scopeRef.current!==scope)return;
   session.ready=true;publish(session);
   await fetchPage(session).catch(()=>{});
  })();
  const listener=AppState.addEventListener('change',state=>{clearTimeout(session.retry);session.retry=undefined;if(state==='active'&&session.ready)void fetchPage(session).catch(()=>{});});
  return()=>{listener.remove();clearTimeout(session.retry);session.controller?.abort();if(active.current===session)active.current=undefined;};
 },[scope]);
 const visible=state.scope===scope?state:undefined;
 return {page:visible?.page,ready:!!scope&&!!visible?.ready,loading:!!visible?.loading,error:visible?.error,
  async load(){const session=active.current;if(session&&session.scope===scope)await fetchPage(session,!!session.page?.next);},
  async refresh(){const session=active.current;if(session&&session.scope===scope)await fetchPage(session);}
 };
}
