import {noteSnapshot} from './stream-diagnostics';
import EventSource from 'react-native-sse';
import {retryDelay} from './network-policy';

// React Native XHR retains the entire responseText for an open SSE request.
// Bound each read connection rather than allowing already-consumed snapshots to
// accumulate until Hermes cannot append another string. This is not a per-frame
// size limit: one complete snapshot must still fit in memory.
export const SNAPSHOT_CONNECTION_MAX_CHARS=8*1024*1024;
export const SNAPSHOT_CONNECTION_MAX_MS=30000;
export type SnapshotStream = {close():void};
export type SnapshotLifecycle={active():boolean;subscribe(listener:(active:boolean)=>void):{remove():void}};
/** GET-only reconnection. Never owns, queues or resends a mutation. */
export function snapshotStream(url:string,headers:Record<string,string>,onSnapshot:(data:string)=>void,onStatus:(status:string)=>void,onReconnect?:()=>void,lifecyclePort?:SnapshotLifecycle):SnapshotStream {
 let events:EventSource<'snapshot'>|undefined,closed=false,connected=false,attempt=0,last=Date.now();
 let foreground=lifecyclePort?.active()??true;
 let retry:ReturnType<typeof setTimeout>|undefined,rotation:ReturnType<typeof setTimeout>|undefined;
 const detach=(continuation=false)=>{clearTimeout(rotation);rotation=undefined;const previous=events;events=undefined;previous?.close();previous?.removeAllEventListeners?.();if(!continuation)connected=false;};
 const stop=()=>{if(closed)return;closed=true;clearTimeout(retry);clearInterval(watchdog);lifecycle.remove();detach();};
 const reconnect=()=>{
  if(closed||retry||!foreground)return;
  detach();onStatus('Offline • reconnecting');
  retry=setTimeout(()=>{retry=undefined;open();},retryDelay(++attempt));
 };
 const rotate=()=>{
  if(closed||retry||!foreground)return;
  // Invalidate callbacks and abort the old XHR now; defer opening until the
  // current EventSource dispatch has unwound. Keep logical connection state so
  // routine buffer rotation does not invoke mutation/outbox reconciliation.
  detach(true);
  retry=setTimeout(()=>{retry=undefined;open(true);},0);
 };
 const open=(continuation=false)=>{
  if(closed||!foreground)return;
  detach(continuation);last=Date.now();let receivedChars=0;
  const current=new EventSource<'snapshot'>(url,{headers,pollingInterval:0,timeoutBeforeConnection:0});events=current;
  const valid=()=>!closed&&foreground&&events===current;
  rotation=setTimeout(()=>{if(valid())rotate();},SNAPSHOT_CONNECTION_MAX_MS);
  current.addEventListener('snapshot',event=>{
   if(!valid()||!event.data)return;
   const diagnosticStart=Date.now();
   try{
    onSnapshot(event.data);
    if(!valid())return;
    last=Date.now();attempt=0;
    if(!connected){connected=true;onReconnect?.();}
    receivedChars+=event.data.length+32;
    if(valid()&&receivedChars>=SNAPSHOT_CONNECTION_MAX_CHARS)rotate();
   }catch{reconnect();}
   finally{noteSnapshot(event.data.length,Date.now()-diagnosticStart);}
  });
  current.addEventListener('error',event=>{
   if(!valid())return;
   const code='xhrStatus' in event?event.xhrStatus:0;
   if(code===401||code===403||code===409){onStatus('Authorization or identity rejected • pair again');stop();return;}
   reconnect();
  });
 };
 // A suspended socket is not trustworthy on return. Start one fresh read stream,
 // rejecting late callbacks from the old connection without clearing the chat.
 const lifecycle=lifecyclePort?.subscribe(active=>{
  if(closed||active===foreground)return;
  foreground=active;clearTimeout(retry);retry=undefined;detach();
  if(active){attempt=0;onStatus('Reconnecting');open();}
 })??{remove(){}};
 // react-native-sse does not repoll status-0 errors or every clean EOF. The
 // backend emits a snapshot at least every three seconds; detect silent stalls.
 const watchdog=setInterval(()=>{if(!closed&&foreground&&Date.now()-last>15000)reconnect();},3000);
 open();return {close:stop};
}
