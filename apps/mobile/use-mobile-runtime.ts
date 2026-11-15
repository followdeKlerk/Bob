import {useCallback,useEffect,useRef,useState} from 'react';
import {SessionDrafts} from './session-drafts';
import {ConversationSettingsDrafts} from './conversation-settings-draft';
import {type DraftAttachment} from './components/attachment-thumbnail';
import {noteLoadedEntries} from './stream-diagnostics';
import {AppState,DeviceEventEmitter,NativeModules,Platform} from 'react-native';
import * as Keychain from 'react-native-keychain';
import {MessageOutbox,type OutgoingMessage} from './message-outbox';
import {OutboxDelivery,requireDeliveryDevice} from './outbox-delivery';
import {BackgroundOutbox,type BackgroundPort} from './background-outbox';
import {recoverBackgroundOutbox,notificationReplyBarriers} from './recover-background-outbox';
import {syncConnectedNetwork} from './connected-network';
import {responseData} from './network-policy';
import {useUpdateNotifications} from './use-update-notifications';
import {TransferLimits} from '../../src/contracts';
export type Backend={backendId:string;endpoint:string;name:string;alias?:string};
export async function requestBackend(
    path: string,
    method = 'GET',
    body?: unknown,
    b?:Backend,
    signal?:AbortSignal,
    deliveryDeviceId?:string,
  ) {
    if (!b) throw Error('Select a backend');
    const credential = await Keychain.getGenericPassword({
      service: `bob.${b.backendId}`,
    });
    if(deliveryDeviceId!==undefined)requireDeliveryDevice(deliveryDeviceId,credential?credential.username:undefined);
    if (!credential) throw Object.assign(Error('Pair again: device credential missing'),{httpStatus:401});
    const deadline=signal?undefined:new AbortController();
    const timeout=deadline?setTimeout(()=>deadline.abort(),20000):undefined;
    try {
    const r = await fetch(b.endpoint + '/v1/' + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + credential.password,
        'x-bob-backend': b.backendId,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal:signal??deadline?.signal,
    });
    return await responseData(r);
    }finally{if(timeout)clearTimeout(timeout);}
  }

/** One process-level owner for delivery and native queue recovery. Retained
 * session views subscribe to this owner; mounting a second view cannot create
 * a second sender, notification registration or network-sync loop. */
export function useMobileRuntime(backends:Backend[],activeScope:string,activeBackendId:string){
  const identity=useRef(activeScope);identity.current=activeScope;
  const selectedBackend=useRef(activeBackendId);selectedBackend.current=activeBackendId;
  const [networkErrors,setNetworkErrors]=useState<string[]>([]);
  const [drafts]=useState(()=>new SessionDrafts());
  const [settingsDrafts]=useState(()=>new ConversationSettingsDrafts());
  const [draftAttachments,setDraftAttachments]=useState<Record<string,DraftAttachment[]>>({});
  const loaded=useRef(new Map<string,number>());
  const reportLoaded=useCallback((scope:string,count?:number)=>{
    if(count===undefined)loaded.current.delete(scope);else loaded.current.set(scope,count);
    noteLoadedEntries([...loaded.current.values()].reduce((sum,value)=>sum+value,0));
  },[]);
  const [outbox]=useState(()=>new MessageOutbox());
  const [backgroundOutbox]=useState(()=>NativeModules.BobOutbox?new BackgroundOutbox(NativeModules.BobOutbox as BackgroundPort,async id=>{const value=await Keychain.getGenericPassword({service:`bob.${id}`});return value?value.password:undefined;}):undefined);
  const [outgoing,setOutgoing]=useState(outbox.items),[outboxError,setOutboxError]=useState<string>();
  const [backgroundReady,setBackgroundReady]=useState<string[]>([]);
  useEffect(()=>{if(!backgroundOutbox)return;let current=true;setBackgroundReady([]);for(const b of backends)void backgroundOutbox.prepare(b.backendId).then(()=>{if(!current)return;if(backgroundOutbox.ready(b.backendId))setBackgroundReady(ids=>[...ids,b.backendId]);else if(selectedBackend.current===b.backendId)setOutboxError('Pair again: device credential missing');}).catch(()=>{if(current&&selectedBackend.current===b.backendId)setOutboxError('Pair again: device credential unavailable');});return()=>{current=false;};},[backgroundOutbox,backends]);
  useEffect(()=>{
    if(!backgroundOutbox)return;let current=true,running=false,again=false;
    const recover=async()=>{if(!current)return;if(running){again=true;return;}running=true;
      try{do{again=false;await recoverBackgroundOutbox(outbox,backgroundOutbox,()=>current);}while(current&&again);}
      catch{if(current)setOutboxError('Unable to recover background message queue');}
      finally{running=false;}
    };
    void recover();
    const state=AppState.addEventListener('change',value=>{if(value==='active')void recover();});
    const focus=Platform.OS==='android'?AppState.addEventListener('focus',()=>{void recover();}):undefined;
    const changes=DeviceEventEmitter.addListener('BobOutboxChanged',()=>{void recover();});
    return()=>{current=false;state.remove();focus?.remove();changes.remove();};
  },[backgroundOutbox,outbox]);
  useEffect(()=>{const sync=()=>{setOutgoing(outbox.items);setOutboxError(outbox.storageError);};sync();return outbox.subscribe(sync);},[outbox]);
  useEffect(()=>{
    const native=NativeModules.BobOutbox;if(!native?.setNotificationReplyBarriers)return;
    let current=true;
    const sync=()=>{if(!current||!outbox.isReady)return;for(const value of backends){
      // Invoke in the outbox publication callback, before its asynchronous JS persistence.
      void native.setNotificationReplyBarriers(value.backendId,notificationReplyBarriers(outbox.items,value.backendId))
        .catch(()=>{if(current)setOutboxError('Notification replies are waiting for foreground queue recovery');});
    }};
    const unsubscribe=outbox.subscribe(sync);
    void outbox.whenReady().then(sync).catch(()=>{});
    return()=>{current=false;unsubscribe();};
  },[outbox,backends]);
  useUpdateNotifications(backends,async backendId=>{
    await outbox.whenReady();
    if(NativeModules.BobOutbox?.setNotificationReplyBarriers)await NativeModules.BobOutbox.setNotificationReplyBarriers(backendId,notificationReplyBarriers(outbox.items,backendId));
  });
  const transport=useRef({request:requestBackend,backends});transport.current={request:requestBackend,backends};
  const [delivery]=useState(()=>new OutboxDelivery(outbox,{
    ...(backgroundOutbox?{background:(item:OutgoingMessage)=>{
      const preceding=outbox.items.slice(0,outbox.items.findIndex(value=>value.id===item.id));
      if(!item.notificationReply&&preceding.some(value=>value.scope===item.scope&&!value.rejected&&!value.admitted&&(value.files.length>0||value.foregroundOnly)))return Promise.resolve({state:'pending' as const});
      // Foreground ownership survives remounts and the later availability of native delivery.
      if(item.foregroundUnsent||item.foregroundDeviceId)return Promise.resolve(undefined);
      return backgroundOutbox.deliver(item);
    }}:{}),
    backends:()=>transport.current.backends,
    deviceId:async b=>{const credential=await Keychain.getGenericPassword({service:`bob.${b.backendId}`});return credential?credential.username:undefined;},
    request:(path,method,body,b,deviceId)=>transport.current.request(path,method,body,b,undefined,deviceId),
    async upload(item,b){
      const limits=TransferLimits.parse(await transport.current.request('transfer-limits','GET',undefined,b,undefined,item.foregroundDeviceId!));
      for(const file of item.files){
        await NativeModules.BobFiles.restoreAttachment(file.id,file.uri,file.name,file.mime);
        const credential=await Keychain.getGenericPassword({service:`bob.${b.backendId}`});
        requireDeliveryDevice(item.foregroundDeviceId!,credential?credential.username:undefined);
        if(!credential)throw Error('Device credential unavailable');
        await NativeModules.BobFiles.uploadAttachment(file.id,`${b.endpoint}/v1/chats/${item.chat}/artifacts?uploadId=${file.id}`,credential.password,b.backendId,limits.uploadLimit);
      }
    },
    async cleanup(item){for(const file of item.files)await NativeModules.BobFiles.removeAttachment(file.id).catch(()=>{});},
    async watch(item,b){
      const credential=await Keychain.getGenericPassword({service:`bob.${b.backendId}`});
      if(credential)await NativeModules.BobNotifications.watch(b.endpoint,b.backendId,credential.password,item.chat,item.id);
    },
  }));
  async function drainOutbox(force=false,forceBackendId?:string){
    if(AppState.currentState==='background'||AppState.currentState==='inactive')return;
    await delivery.drain({force:force&&!forceBackendId,forceBackendId,scope:identity.current}).catch(()=>{});
  }
  const drainLatest=useRef(drainOutbox);drainLatest.current=drainOutbox;
  useEffect(()=>{
    void drainLatest.current(true);
    const timer=setInterval(()=>{if(AppState.currentState==='active')void drainLatest.current();},1000);
    const listener=AppState.addEventListener('change',state=>{if(state==='active')void drainLatest.current(true);});
    return()=>{clearInterval(timer);listener.remove();};
  },[backends]);
  useEffect(()=>{
    if(backends.length<2){setNetworkErrors([]);return;}
    const lifetime=new AbortController();let busy=false;
    const sync=async()=>{
      if(busy||lifetime.signal.aborted)return;busy=true;
      try{
        const result=await syncConnectedNetwork(backends,async(path,method,value,b,signal)=>{
          const requestAbort=new AbortController();
          const abort=()=>requestAbort.abort();signal?.addEventListener('abort',abort);
          if(signal?.aborted)requestAbort.abort();
          const deadline=setTimeout(abort,20000);
          try{return await requestBackend(path,method,value,b,requestAbort.signal);}
          finally{clearTimeout(deadline);signal?.removeEventListener('abort',abort);}
        },lifetime.signal);
        if(!lifetime.signal.aborted)setNetworkErrors(result.errors);
      }finally{busy=false;}
    };
    void sync();
    const interval=setInterval(()=>{if(AppState.currentState==='active')void sync();},60000);
    const listener=AppState.addEventListener('change',state=>{if(state==='active')void sync();});
    return()=>{lifetime.abort();clearInterval(interval);listener.remove();};
  },[backends]);
  return {outbox,backgroundOutbox,outgoing,outboxError,backgroundReady,networkErrors,drainOutbox,drainLatest,drafts,settingsDrafts,draftAttachments,setDraftAttachments,reportLoaded};
}
export type MobileRuntime=ReturnType<typeof useMobileRuntime>;
