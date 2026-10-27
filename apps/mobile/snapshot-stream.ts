import {noteSnapshot} from './stream-diagnostics';
import EventSource from 'react-native-sse';
import {retryDelay} from './network-policy';

export type SnapshotStream = {close():void};
export type SnapshotLifecycle={active():boolean;subscribe(listener:(active:boolean)=>void):{remove():void}};
/** GET-only reconnection. Never owns, queues or resends a mutation. */
export function snapshotStream(url:string,headers:Record<string,string>,onSnapshot:(data:string)=>void,onStatus:(status:string)=>void,onReconnect?:()=>void,lifecyclePort?:SnapshotLifecycle):SnapshotStream {
 let events:EventSource<'snapshot'>|undefined,closed=false,connected=false,attempt=0,last=Date.now();
 let foreground=lifecyclePort?.active()??true;
 let retry:ReturnType<typeof setTimeout>|undefined;
 const detach=()=>{const previous=events;events=undefined;previous?.close();connected=false;};
 const stop=()=>{if(closed)return;closed=true;clearTimeout(retry);clearInterval(watchdog);lifecycle.remove();detach();};
 const reconnect=()=>{
  if(closed||retry||!foreground)return;
  detach();onStatus('Offline • reconnecting');
  retry=setTimeout(()=>{retry=undefined;open();},retryDelay(++attempt));
 };
 const open=()=>{
  if(closed||!foreground)return;
  detach();last=Date.now();
  const current=new EventSource<'snapshot'>(url,{headers,pollingInterval:0,timeoutBeforeConnection:0});events=current;
  const valid=()=>!closed&&foreground&&events===current;
  current.addEventListener('snapshot',event=>{
   if(!valid()||!event.data)return;
   const diagnosticStart=Date.now();
   try{
    onSnapshot(event.data);
    if(!valid())return;
    last=Date.now();attempt=0;
    if(!connected){connected=true;onReconnect?.();}
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
