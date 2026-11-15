import {useEffect,useRef,useState} from 'react';
import {DeviceEventEmitter,Keyboard,NativeModules} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {useMobileRuntime,requestBackend,type Backend} from './use-mobile-runtime';
import {activateSession,EMPTY_SESSION_DECK,sessionKey,type SessionTarget} from './retained-sessions';
import {usePhoneTools,type PhoneToolRequest} from './phone-tools';
import {useKeepConnected} from './keep-connected';
import {usePhoneLocation} from './use-phone-location';
import {useAppDiagnostics} from './app-diagnostics';
import {stopSpeech} from './speech';
import {type BottomDestination} from './components/bottom-tabs';
import {touchCachedConversation} from './download-cache';

export type SessionDestination=BottomDestination|'Updates';
export type VisibleSessionContext={scope:string;screen:string;drawer:boolean;ordinaryChat:boolean;activeAgentCount?:number;child?:number;requests?:PhoneToolRequest[]};
const validChat=(id:unknown):id is number=>Number.isSafeInteger(id)&&(id as number)>0;

/** Navigation owns retained identities, not their local React state. Native
 * phone availability, notification selection and delivery have one owner even
 * when several transcript views remain mounted and receiving snapshots. */
export function useSessionShell(){
  useAppDiagnostics();
  const [backends,setBackends]=useState<Backend[]>([]);
  const [ready,setReady]=useState(false);
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
  function selectSession(target:SessionTarget,destination:SessionDestination='Chat'){
    if(!sessionKey(target))return;
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
    void(async()=>{
      const list=JSON.parse(await AsyncStorage.getItem('backends')??'[]') as Backend[];
      let last:{backendId?:string;chat?:number}|undefined;
      try{last=JSON.parse(await AsyncStorage.getItem('selection')??'null');}catch{/* Optional selection cannot make stored pairings unavailable. */}
      let saved:Record<string,unknown>={};
      try{const value=JSON.parse(await AsyncStorage.getItem('workstation-selections')??'{}');if(value&&typeof value==='object'&&!Array.isArray(value))saved=value;}catch{/* Optional per-workstation recovery must not prevent pairing hydration. */}
      const lastChats:Record<string,number>={};
      for(const value of list){const chat=saved[value.backendId];if(validChat(chat))lastChats[value.backendId]=chat;}
      const lastBackend=list.find(value=>value.backendId===last?.backendId);
      if(lastBackend&&validChat(last?.chat))lastChats[lastBackend.backendId]=last.chat;
      const notifications=(await AsyncStorage.getItem('notification-opt-in').catch(()=>null))!=='false';
      let notice:unknown;try{notice=await NativeModules.BobPlatform.takeNotificationTarget();}catch{/* An unavailable notification target cannot block normal startup. */}
      if(!alive)return;
      remembered.current=lastChats;setBackends(list);setNotifyEnabled(notifications);
      if(!notification.current(notice,list)){
        const value=list.find(item=>item.backendId===last?.backendId)??list[0];
        if(value)selectSession({backendId:value.backendId,chat:lastChats[value.backendId]});
      }
      setReady(true);
    })().catch(()=>{if(alive)setReady(true);});
    return()=>{alive=false;};
  },[]);
  useEffect(()=>{
    let alive=true;
    const listener=DeviceEventEmitter.addListener('BobNotificationOpen',()=>{
      void(async()=>{const notice=await NativeModules.BobPlatform.takeNotificationTarget();if(!alive)return;Keyboard.dismiss();notification.current(notice,paired.current);})().catch(()=>{});
    });
    return()=>{alive=false;listener.remove();};
  },[]);
  useEffect(()=>{
    if(!ready||!current)return;
    const last=JSON.stringify(current),lastChats=JSON.stringify(remembered.current);
    // Serialize navigation writes so a slower A save cannot overwrite B.
    storageTail.current=storageTail.current.catch(()=>{}).then(async()=>{
      await AsyncStorage.setItem('selection',last);
      await AsyncStorage.setItem('workstation-selections',lastChats);
    }).catch(()=>{});
  },[ready,activeKey,selection.revision]);
  // Disk-cache recency follows selection, never hidden streaming activity.
  useEffect(()=>{if(current?.chat)void touchCachedConversation(current.backendId,current.chat);},[scope]);
  useEffect(()=>{void stopSpeech();},[activeKey,context?.screen,context?.child]);
  useEffect(()=>()=>{void stopSpeech();},[]);
  useEffect(()=>{NativeModules.BobNotifications.setReplyNotifications?.(notifyEnabled);},[notifyEnabled]);
  useEffect(()=>{
    NativeModules.BobNotifications.setAppContext?.(backend?.backendId??'',context?.screen==='Chat'&&!context.drawer?current?.chat??0:0);
  },[backend?.backendId,current?.chat,context?.screen,context?.drawer]);
  const refreshBackend=(id:string)=>setConnectionRevisions(previous=>({...previous,[id]:(previous[id]??0)+1}));
  return {ready,selection,current,context,backends,setBackends,notifyEnabled,setNotifyEnabled,runtime,phoneTools,phoneLocation,keepConnected,selectSession,selectBackend,reportVisible,connectionRevisions,refreshBackend};
}
export type SessionShell=ReturnType<typeof useSessionShell>;
