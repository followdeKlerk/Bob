import {useEffect,useRef,useState} from 'react';
import {DeviceEventEmitter,Keyboard,NativeModules} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {useMobileRuntime,requestBackend,type Backend} from './use-mobile-runtime';
import {activateSession,EMPTY_SESSION_DECK,sessionKey,type SessionTarget} from './retained-sessions';
import {usePhoneTools,type PhoneToolRequest} from './phone-tools';
import {useKeepConnected} from './keep-connected';
import {usePhoneLocation} from './use-phone-location';
import {useAppDiagnostics,recordAppEvent} from './app-diagnostics';
import {stopSpeech} from './speech';
import {type BottomDestination} from './components/bottom-tabs';
import {touchCachedConversation} from './download-cache';
import type {ChatProfile} from './retired-chat-profile';
import {startupRead,savedBackends,savedSelection,savedChats,NOTIFICATION_STARTUP_TIMEOUT_MS} from './startup-recovery';

export type SessionDestination=BottomDestination|'Updates';
export type VisibleSessionContext={scope:string;screen:string;drawer:boolean;ordinaryChat:boolean;activeAgentCount?:number;child?:number;requests?:PhoneToolRequest[]};
const validChat=(id:unknown):id is number=>Number.isSafeInteger(id)&&(id as number)>0;

/** Navigation owns retained identities, not their local React state. Native
 * phone availability, notification selection and delivery have one owner even
 * when several transcript views remain mounted and receiving snapshots. */
type ChatMetadata={title:string;pinned?:boolean;archived?:boolean;trashed?:boolean;profile?:ChatProfile};
type MetadataUpdate={scope:string;id:number;meta:ChatMetadata;sequence:number};
/** Confirmed metadata mutations are shared between retained views, not owners or profiles. */
function metadataUpdates(){
 let sequence=0;const latest=new Map<string,MetadataUpdate>(),listeners=new Set<(event:MetadataUpdate)=>void>();
 return {
  version:()=>sequence,
  since:(scope:string,after:number)=>[...latest.values()].filter(event=>event.scope===scope&&event.sequence>after).sort((a,b)=>a.sequence-b.sequence),
  publish:(scope:string,id:number,meta:ChatMetadata)=>{const event={scope,id,meta,sequence:++sequence};latest.set(JSON.stringify([scope,id]),event);listeners.forEach(listener=>listener(event));},
  subscribe:(listener:(event:MetadataUpdate)=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};},
 };
}
export function useSessionShell(){
  const metadata=useRef<ReturnType<typeof metadataUpdates>|null>(null);if(!metadata.current)metadata.current=metadataUpdates();
  useAppDiagnostics();
  const [backends,setBackends]=useState<Backend[]>([]);
  const [ready,setReady]=useState(false),[startupError,setStartupError]=useState(''),[startupAttempt,setStartupAttempt]=useState(0);
  const navigationTouched=useRef(false);
  const retryStartup=()=>{setStartupError('');setStartupAttempt(value=>value+1);};
  const [selection,setSelection]=useState({deck:EMPTY_SESSION_DECK,revision:0,destination:'Chat' as SessionDestination});
  const [notifyEnabled,setNotifyEnabled]=useState(true);
  const [visible,setVisible]=useState<VisibleSessionContext&{revision:number}>();
  const [connectionRevisions,setConnectionRevisions]=useState<Record<string,number>>({});
  const remembered=useRef<Record<string,number>>({});
  const paired=useRef(backends);paired.current=backends;
  const current=selection.deck.targets.find(target=>sessionKey(target)===selection.deck.active);
  const backend=backends.find(item=>item.backendId===current?.backendId);
  const scope=current?.chat?sessionKey(current):'';
  const activeKey=selection.deck.active;
  const selectedKey=useRef({key:activeKey,revision:selection.revision});selectedKey.current={key:activeKey,revision:selection.revision};
  const storageTail=useRef<Promise<unknown>>(Promise.resolve());
  const runtime=useMobileRuntime(backends,scope,backend?.backendId??'');
  const context=visible?.scope===activeKey&&visible.revision===selection.revision?visible:undefined;
  // Hidden live sessions never announce phone availability or execute requests.
  const phoneTools=usePhoneTools({backend,chat:context?.ordinaryChat?current?.chat:undefined,requests:context?.ordinaryChat?context.requests:undefined,request:requestBackend});
  const phoneLocation=usePhoneLocation(backend);
  const keepConnected=useKeepConnected(backend,current?.chat,context?.screen==='Connection');
  function selectSession(target:SessionTarget,destination:SessionDestination='Chat',persist=true){
    if(!sessionKey(target))return;
    if(persist)navigationTouched.current=true;
    if(target.chat)remembered.current={...remembered.current,[target.backendId]:target.chat};
    setSelection(previous=>({deck:activateSession(previous.deck,target),revision:previous.revision+1,destination}));
  }
  function selectBackend(value:Backend){
    const chat=remembered.current[value.backendId];
    selectSession({backendId:value.backendId,chat},chat?'Chat':'Agents');
  }
  function reportVisible(value:VisibleSessionContext){
    if(value.scope===selectedKey.current.key&&selection.revision===selectedKey.current.revision)setVisible({...value,revision:selection.revision});
  }
  function applyNotification(notice:any,list:Backend[]){
    const value=list.find(item=>item.backendId===notice?.backendId);
    if(!value)return false;
    if(notice.screen==='updates')selectSession({backendId:value.backendId,chat:remembered.current[value.backendId]},'Updates');
    else if(notice.screen==='sessions')selectSession({backendId:value.backendId},'Agents');
    else if(validChat(notice.conversationId))selectSession({backendId:value.backendId,chat:notice.conversationId});
    else return false;
    return true;
  }
  const notification=useRef(applyNotification);notification.current=applyNotification;
  useEffect(()=>{
    let alive=true;
    setReady(false);setStartupError('');
    void startupRead(async()=>{
      const [profiles,last,rememberedChats,notifications]=await Promise.all(['backends','selection','workstation-selections','notification-opt-in'].map(key=>AsyncStorage.getItem(key)));
      const list=savedBackends(profiles,NativeModules.BobPlatform?.loopbackTesting===true);
      const selected=savedSelection(last),saved=savedChats(rememberedChats);
      if(notifications!==null&&notifications!=='true'&&notifications!=='false')throw Error('Invalid saved notifications');
      return {list,selected,saved,notifications};
    }).then(({list,selected,saved,notifications})=>{
      if(!alive)return;
      const lastChats:Record<string,number>={};
      for(const value of list){const chat=saved[value.backendId];if(validChat(chat))Object.defineProperty(lastChats,value.backendId,{value:chat,enumerable:true,writable:true,configurable:true});}
      const lastBackend=list.find(value=>value.backendId===selected?.backendId);
      if(lastBackend&&validChat(selected?.chat))lastChats[lastBackend.backendId]=selected.chat;
      remembered.current=lastChats;setBackends(list);setNotifyEnabled(notifications!=='false');
      const value=lastBackend??list[0];
      if(value)selectSession({backendId:value.backendId,chat:lastChats[value.backendId]},'Chat',false);
      setReady(true);recordAppEvent('startup.session-ready');
    }).catch(()=>{if(alive)setStartupError('Saved workstations could not be opened on this phone. Nothing was removed. Retry to read them again.');});
    return()=>{alive=false;};
  },[startupAttempt]);
  useEffect(()=>{
    if(!ready)return;
    let alive=true;
    async function readNotice(){
      const revision=selectedKey.current.revision;
      try{
        const notice=await startupRead(()=>NativeModules.BobPlatform?.takeNotificationTarget?.(),NOTIFICATION_STARTUP_TIMEOUT_MS);
        if(!alive||selectedKey.current.revision!==revision)return;
        if(notification.current(notice,paired.current))Keyboard.dismiss();
      }catch{/* Notification routing is optional and must never block ordinary startup. */}
    }
    void readNotice();
    const listener=DeviceEventEmitter.addListener('BobNotificationOpen',()=>void readNotice());
    return()=>{alive=false;listener.remove();};
  },[ready]);
  useEffect(()=>{
    if(!ready||!current||!navigationTouched.current)return;
    const last=JSON.stringify(current),lastChats=JSON.stringify(remembered.current);
    // No hydration writes: a failed read/retry must never erase saved recovery data.
    // Serialize explicit navigation writes so a slower A save cannot overwrite B.
    storageTail.current=storageTail.current.catch(()=>{}).then(async()=>{
      await AsyncStorage.setItem('selection',last);
      await AsyncStorage.setItem('workstation-selections',lastChats);
    }).catch(()=>{});
  },[ready,activeKey,selection.revision]);
  // Disk-cache recency follows selection, never hidden streaming activity.
  useEffect(()=>{if(current?.chat)void touchCachedConversation(current.backendId,current.chat);},[scope]);
  useEffect(()=>{void stopSpeech();},[activeKey,context?.screen,context?.child]);
  useEffect(()=>()=>{void stopSpeech();},[]);
  useEffect(()=>{if(ready)NativeModules.BobNotifications.setReplyNotifications?.(notifyEnabled);},[ready,notifyEnabled]);
  useEffect(()=>{
    NativeModules.BobNotifications.setAppContext?.(backend?.backendId??'',context?.screen==='Chat'&&!context.drawer?current?.chat??0:0);
  },[backend?.backendId,current?.chat,context?.screen,context?.drawer]);
  const refreshBackend=(id:string)=>setConnectionRevisions(previous=>({...previous,[id]:(previous[id]??0)+1}));
  return {metadata:metadata.current,ready,startupError,retryStartup,selection,current,context,backends,setBackends,notifyEnabled,setNotifyEnabled,runtime,phoneTools,phoneLocation,keepConnected,selectSession,selectBackend,reportVisible,connectionRevisions,refreshBackend};
}
export type SessionShell=ReturnType<typeof useSessionShell>;
