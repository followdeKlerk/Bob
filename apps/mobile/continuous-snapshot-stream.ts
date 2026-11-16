import {DeviceEventEmitter,NativeModules,Platform} from 'react-native';
import {snapshotStream,type SnapshotLifecycle,type SnapshotStream} from './snapshot-stream';
import {retryDelay} from './network-policy';
import {noteSnapshot} from './stream-diagnostics';

type NativeStream={readStream:(backendId:string,chat:number,observerId:string,afterRevision:number)=>Promise<string>;releaseStream:(observerId:string)=>Promise<unknown>};
type Scope={backendId:string;chat:number};
type State={backendId:string;conversationId:number;enabled:boolean;selected:boolean;status:'off'|'connecting'|'connected'|'reconnecting'|'attention';revision:number;epoch:number;snapshot?:string;heartbeatAgeMs?:number;error?:string};
const native=()=>NativeModules.BobConnection as NativeStream|undefined;
export const continuousSnapshotSupported=()=>Platform.OS==='android'&&typeof native()?.readStream==='function'&&typeof native()?.releaseStream==='function';
const processId=`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
let observerSequence=0;
function parse(raw:string,scope:Scope):State{
 const value=JSON.parse(raw) as State;
 if(!value||typeof value!=='object'||Array.isArray(value)||value.backendId!==scope.backendId||value.conversationId!==scope.chat||
  typeof value.enabled!=='boolean'||typeof value.selected!=='boolean'||!['off','connecting','connected','reconnecting','attention'].includes(value.status)||
  !Number.isSafeInteger(value.revision)||value.revision<0||!Number.isSafeInteger(value.epoch)||value.epoch<0||
  value.snapshot!==undefined&&typeof value.snapshot!=='string')throw Error('Invalid native stream state');
 return value;
}
/** Reads the native stream's latest state, never the network. Native retains one
 * complete snapshot while the UI sleeps; invalidations carry no transcript and
 * are acknowledged/coalesced by readStream. Unmount removes only this observer. */
export function nativeSnapshotStream(scope:Scope,onSnapshot:(data:string)=>void,onStatus:(status:string)=>void,onReconnect:(()=>void)|undefined,lifecycle:SnapshotLifecycle,onDisabled:()=>void):SnapshotStream{
 const bridge=native()!,observerId=`stream-${processId}-${++observerSequence}`;
 let closed=false,foreground=lifecycle.active(),reading=false,dirty=false,visit=0,revision=0,epoch=0,hasSnapshot=false,attempt=0;
 let retry:ReturnType<typeof setTimeout>|undefined;
 const release=()=>{void bridge.releaseStream(observerId).catch(()=>{});};
 const status=(value:State)=>{
  if(value.status==='attention')return /^(authorization|identity)$/.test(value.error??'')?'Authorization or identity rejected • pair again':'Connection needs attention • open Connection settings';
  if(value.status==='reconnecting')return 'Offline • reconnecting';
  return value.status==='connected'?'Connected':'Connecting…';
 };
 async function refresh(){
  if(closed)return;
  dirty=true;if(reading||!foreground)return;
  clearTimeout(retry);retry=undefined;reading=true;
  try{
   while(dirty&&foreground&&!closed){
    dirty=false;const currentVisit=visit;
    const raw=await bridge.readStream(scope.backendId,scope.chat,observerId,revision);
    if(closed){release();return;}
    if(!foreground||currentVisit!==visit)continue;
    const value=parse(raw,scope);
    if(!value.enabled){onDisabled();return;}
    // A selection change retires native ownership. Do not publish the previous
    // chat's retained snapshot, even before React finishes changing adapters.
    if(!value.selected){onStatus('Connecting…');continue;}
    if(value.snapshot!==undefined&&value.revision!==revision){
     const began=Date.now();
     // The receiving App callback parses and validates identity/shape once.
     // It must reject synchronously before this observer accepts the revision.
     onSnapshot(value.snapshot);
     if(closed)return;
     noteSnapshot(value.snapshot.length,Date.now()-began);revision=value.revision;hasSnapshot=true;
    }
    const fresh=value.status==='connected'&&hasSnapshot&&value.revision===revision&&value.epoch>0&&typeof value.heartbeatAgeMs==='number'&&Number.isFinite(value.heartbeatAgeMs)&&value.heartbeatAgeMs>=0&&value.heartbeatAgeMs<=20000;
    onStatus(value.status==='connected'&&!fresh?'Offline • reconnecting':status(value));
    if(fresh&&value.epoch!==epoch){epoch=value.epoch;onReconnect?.();}
    attempt=0;
   }
  }catch{
   if(!closed&&foreground){
    onStatus('Connection needs attention • open Connection settings');
    // Retry only this local bridge read, never a message or a network restart.
    retry=setTimeout(()=>{retry=undefined;void refresh();},retryDelay(++attempt));
   }
  }finally{reading=false;}
 }
 const notices=DeviceEventEmitter.addListener('BobConnectionStream',value=>{
  if(value?.backendId!==scope.backendId||value?.conversationId!==scope.chat||value.observerId&&value.observerId!==observerId)return;
  void refresh();
 });
 const visibility=lifecycle.subscribe(active=>{
  if(closed||active===foreground)return;
  foreground=active;visit++;clearTimeout(retry);retry=undefined;
  // No socket close, new GET, history reload or outbox reconciliation here.
  // A fresh read on return consumes the state already received by native code.
  if(active)void refresh();
 });
 void refresh();
 return {close(){if(closed)return;closed=true;clearTimeout(retry);notices.remove();visibility.remove();release();}};
}

export type ChatSnapshotStream=SnapshotStream&{setContinuous(enabled:boolean):void};
/** Transport choice is independent of the mounted transcript/draft. Only the
 * selected owner's opt-in uses native continuity; other retained chats keep the
 * existing foreground-only read transport. Older apps retain their safe path. */
export function chatSnapshotStream(url:string,headers:Record<string,string>,scope:Scope,onSnapshot:(data:string)=>void,onStatus:(status:string)=>void,onReconnect:(()=>void)|undefined,lifecycle:SnapshotLifecycle,continuous=false):ChatSnapshotStream{
 let closed=false,generation=0,mode:boolean|undefined,current:SnapshotStream|undefined;
 const choose=(enabled:boolean)=>{
  if(closed)return;
  const next=enabled&&continuousSnapshotSupported();if(next===mode)return;
  mode=next;const ticket=++generation;current?.close();
  const valid=()=>!closed&&generation===ticket;
  const snapshot=(data:string)=>{if(valid())onSnapshot(data);};
  const status=(value:string)=>{if(valid())onStatus(value);};
  const reconnect=()=>{if(valid())onReconnect?.();};
  current=next?nativeSnapshotStream(scope,snapshot,status,reconnect,lifecycle,()=>{if(valid())choose(false);}):snapshotStream(url,headers,snapshot,status,reconnect,lifecycle);
 };
 choose(continuous);
 return {setContinuous:choose,close(){if(closed)return;closed=true;generation++;current?.close();}};
}
