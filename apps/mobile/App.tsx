import {FileAttachment} from './components/file-attachment';
import {emptyConversationMessage} from './empty-conversation';
import {DiagnosticCard,type DiagnosticRequest} from './components/diagnostic-card';
import {DiagnosticBoundary} from './components/diagnostic-boundary';
import {noteLoadedEntries} from './stream-diagnostics';
import {stopSpeech,openSpeechSettings} from './speech';
import 'react-native-get-random-values';
import './global.css';
import Animated from 'react-native-reanimated';
import {Button as KitButton} from './components/ui/button';
import {Text as KitText} from './components/ui/text';
import {Plus, ArrowUp, ArrowDown, Square, ChevronRight, ChevronDown, Users, Paperclip, X} from 'lucide-react-native';
import {colors} from './theme';
import {surfaceAnchors} from './surface-placement';
import {InlineSurface} from './components/inline-surface';
import {ConversationSettings,type ConversationChange,type SavedConversationSettings} from './components/conversation-settings';
import {SettingsGroup,SettingsRow,sectionStyles} from './components/section-ui';
import {Bell,Volume2,MapPin,SlidersHorizontal,Download,Stethoscope,Blocks} from 'lucide-react-native';
import {BottomTabs,type BottomDestination} from './components/bottom-tabs';
import {SideDrawer,type SessionAction} from './components/side-drawer';
import {BuildCard} from './components/build-card';
import {useBuildStatus} from './use-build-status';
import {MessageOutbox,visibleOutgoing,mergeOutgoing,outgoingAnchor,outgoingLabel,transcriptKey,type OutgoingMessage} from './message-outbox';
import {OutboxDelivery} from './outbox-delivery';
import {responseData} from './network-policy';
import {QuestionCard,type Question} from './components/question-card';
import {NotesScreen} from './components/notes-screen';
import {DraftInput,composerTransition} from './components/draft-input';
import {SkillPicker} from './components/skill-picker';
import {skillQuery,pickerRequest} from './skill-picker';
import {ComposerStatus} from './components/composer-status';
import {useBackNavigation} from './use-back-navigation';
import {useAppDiagnostics,copyAppDiagnostics} from './app-diagnostics';
import {useUpdateNotifications} from './use-update-notifications';
import {usePhoneLocation} from './use-phone-location';
import {ModelContent} from './components/model-content';
import {PeerAdmission} from './components/peer-admission';
import {AttachmentPicker} from './components/attachment-picker';
import {PlusMenu} from './components/plus-menu';
import {AttachmentThumbnail,type DraftAttachment} from './components/attachment-thumbnail';
import {useScopedSnapshot} from './use-scoped-snapshot';
import {useChatFollow} from './use-chat-follow';
import {ModelPicker,type ModelChoice} from './components/model-picker';
import {linkToolResults,type ToolMessage} from './tool-results';
import {hasInlineChatContent,isRecordedToolGeneration,inputAttribution,isActiveSubagent} from './chat-presentation';
import {ToolContent} from './components/tool-content';
import {CHAT_CONTENT_GAP} from './tool-presentation';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  AppState,
  NativeModules,
  useWindowDimensions,
  DeviceEventEmitter,
  Keyboard,
  PermissionsAndroid,
  Platform,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import {syncConnectedNetwork} from './connected-network';
import {reuseSnapshotEntries} from './snapshot-cache';
import {snapshotStream,type SnapshotStream,type SnapshotLifecycle} from './snapshot-stream';
import {useStoredHistory} from './stored-history';
import {readHistoryCache,writeHistoryCache} from './history-cache';
import {useKeyboardInset} from './keyboard-inset';
import { v4 as uuid } from 'uuid';
import { PairingInvitation, Message, Attachment, TransferLimits, InteractiveSummary, McpConnection, NativeWork, ModuleInfo } from '../../src/contracts';
type Backend = { backendId: string; endpoint: string; name: string };
type Entry = {
  id: number;
  kind: string;
  model?: ToolMessage[];
  data?: unknown;
};
type Chat = { id: number; meta?: { title: string; pinned?:boolean;archived?:boolean;trashed?:boolean }; owner?: unknown };
const snapshotLifecycle:SnapshotLifecycle={
 active:()=>AppState.currentState!=='background'&&AppState.currentState!=='inactive',
 subscribe:listener=>AppState.addEventListener('change',state=>listener(state==='active')),
};
type Snapshot = { entries: Entry[]; docs: Record<string, any>; work?:ReturnType<typeof NativeWork.parse>[] };
function Button({label,onPress,disabled=false,accessibilityLabel}: {label:string;onPress:()=>void;disabled?:boolean;accessibilityLabel?:string}) {
  return <KitButton variant="secondary" accessibilityLabel={accessibilityLabel??label} accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={styles.button}><KitText style={styles.buttonText}>{label}</KitText></KitButton>;
}
function IconButton({icon:Icon,label,onPress,disabled=false,primary=false}:{icon:typeof Plus;label:string;onPress:()=>void;disabled?:boolean;primary?:boolean}) {
 return <KitButton variant="ghost" size="icon" accessibilityLabel={label} accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={{width:48,height:48,borderRadius:24,backgroundColor:'transparent',opacity:disabled?0.4:1}}>{primary?<View pointerEvents="none" style={{width:32,height:32,borderRadius:16,backgroundColor:'#ffffff',alignItems:'center',justifyContent:'center'}}><Icon size={Icon===Square?14:22} color="#000000" fill={Icon===Square?'#000000':'none'} strokeWidth={2.6}/></View>:<Icon size={22} color={colors.foreground}/>}</KitButton>;
}
function Disclosure({label,children}:{label:string;children:React.ReactNode}) {
 const [open,setOpen]=useState(false);
 return <View><KitButton variant="ghost" accessibilityLabel={label} accessibilityState={{expanded:open}} onPress={()=>setOpen(!open)} style={{minHeight:48,height:'auto',justifyContent:'flex-start',paddingHorizontal:0}}><KitText style={{color:colors.muted,fontSize:14,flexShrink:1}}>{label}</KitText>{open?<ChevronDown size={16} color={colors.muted}/>:<ChevronRight size={16} color={colors.muted}/>}</KitButton>{open&&children}</View>;
}
function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value))
    return value
      .map(v =>
        v.type === 'text'
          ? v.text
          : v.type === 'toolCall'
          ? `Tool: ${v.name}\n${JSON.stringify(v.arguments)}`
          : v.type === 'thinking'
          ? ''
          : JSON.stringify(v),
      )
      .join('\n');
  return JSON.stringify(value);
}
function Main() {
  useAppDiagnostics();
  const insets = useSafeAreaInsets();
  const windowSize = useWindowDimensions();
  const [visualWidth,setVisualWidth] = useState(0);
  const [updatesTarget,setUpdatesTarget]=useState<Backend>();
  const [sectionLoading,setSectionLoading]=useState(false),[sectionError,setSectionError]=useState(''),[modelLoading,setModelLoading]=useState(false);
  const sectionRequest=useRef(0);
  const [actionsMore,setActionsMore]=useState(false);
  const [attachmentPicker,setAttachmentPicker]=useState<{scope:string;tab:'gallery'|'files';limit:number}>();
  const keyboardInset = useKeyboardInset();
  const [composerHeight,setComposerHeight]=useState(84);
  const [backends, setBackends] = useState<Backend[]>([]),
    [backend, setBackend] = useState<Backend>(),
    [chat, setChat] = useState<number>(),
    [chats, setChats] = useState<Chat[]>([]),
    [chatCursor,setChatCursor]=useState<string>(),

    [draft, setDraft] = useState(''),
    [status, setStatus] = useState('Not paired'),
    [drawer, setDrawer] = useState(false),
    [orbit, setOrbit] = useState(false),
    [actions, setActions] = useState(false),
    [child, setChild] = useState<number>(),
    [childStatus,setChildStatus]=useState(''),
    [pairing, setPairing] = useState(''),
    [welcomeHelp, setWelcomeHelp] = useState(false),
    [welcomeManual, setWelcomeManual] = useState(false),
    [screen, setScreen] = useState('Chat'),
    [library, setLibrary] = useState<any>(),
    [instructions, setInstructions] = useState(''),
    [skillName, setSkillName] = useState(''),
    [skillText, setSkillText] = useState(''),
    [skillDescription, setSkillDescription] = useState(''),
    [skillEnabled, setSkillEnabled] = useState(true),
    [templateName, setTemplateName] = useState(''),
    [templateText, setTemplateText] = useState(''),
    [chatInstructions, setChatInstructions] = useState(''),
    [usesDefaultInstructions,setUsesDefaultInstructions]=useState(true),
    [workingDirectory, setWorkingDirectory] = useState(''),
    [todoText, setTodoText] = useState(''),
    [surfaces, setSurfaces] = useState<{backendId:string; value:ReturnType<typeof InteractiveSummary.parse>}[]>([]),
    [surfaceError, setSurfaceError] = useState(''),
    [mcpConnections, setMcpConnections] = useState<ReturnType<typeof McpConnection.parse>[]>([]),
    [moduleList,setModuleList]=useState<ReturnType<typeof ModuleInfo.parse>[]>([]),
    [networkErrors,setNetworkErrors]=useState<string[]>([]),
    [mcpId,setMcpId]=useState(''),[mcpEndpoint,setMcpEndpoint]=useState(''),[mcpTools,setMcpTools]=useState(''),[mcpEnabled,setMcpEnabled]=useState(false),
    [models, setModels] = useState<any[]>([]),
    [apiKey, setApiKey] = useState(''),
    [modelId, setModelId] = useState(''),
    [providerName,setProviderName]=useState('openai'),
    [notifyEnabled, setNotifyEnabled] = useState(true),
    [pending, setPending] = useState<string>();
  const [outbox]=useState(()=>new MessageOutbox());
  const [outgoing,setOutgoing]=useState(outbox.items),[outboxError,setOutboxError]=useState<string>();
  useEffect(()=>{const sync=()=>{setOutgoing(outbox.items);setOutboxError(outbox.storageError);};sync();return outbox.subscribe(sync);},[outbox]);
  const [bottomBarHeight,setBottomBarHeight]=useState(60);
  const [draftFocused,setDraftFocused]=useState(false),[slashDismissed,setSlashDismissed]=useState(false);
  useEffect(()=>setSlashDismissed(false),[draft,backend?.backendId,chat]);
  const slashQuery=skillQuery(draft);
  const skillPopupHeight=Math.max(0,Math.min(320,windowSize.height-keyboardInset-insets.top-insets.bottom-composerHeight-16-(keyboardInset<=0?bottomBarHeight:0)));
  const [draftAttachments,setDraftAttachments]=useState<Record<string,DraftAttachment[]>>({});
  useUpdateNotifications(backends);
  const build=useBuildStatus(backend);
  const phoneLocation=usePhoneLocation(backend);
  const selectedBackend = useRef('');
  selectedBackend.current = backend?.backendId ?? '';
  const identity = useRef(''),
    stream = useRef<SnapshotStream | null>(null),
    draftReady = useRef(false);
  const scope = backend && chat ? `${backend.backendId}:${chat}` : '';
  const [draftLoadedScope,setDraftLoadedScope]=useState('');
  const composerReady=!!scope&&draftLoadedScope===scope;
  useEffect(()=>{void stopSpeech();return()=>{void stopSpeech();};},[scope,child,orbit,screen]);
  identity.current = scope;
  const [view,setView]=useScopedSnapshot<Snapshot>(scope),[childView,setChildView]=useScopedSnapshot<Snapshot>(`${scope}:child:${child}`);
  const attachments=draftAttachments[scope]??[];
  const hasDraft=!!draft.trim()||attachments.length>0;
  const latestDraft=useRef(draft);latestDraft.current=draft;
  const [modelPickerTarget,setModelPickerTarget]=useState<{backend:Backend;chat:number;scope:string}>();
  const [modelChoice,setModelChoice]=useState<ModelChoice>({});
  useEffect(()=>{setModelPickerTarget(undefined);setAttachmentPicker(undefined);setActions(false);},[scope]);
  useEffect(()=>{if(!actions)setActionsMore(false);},[actions]);
  useEffect(()=>{if(updatesTarget){setBackend(updatesTarget);setScreen('Chat');setDrawer(false);}},[updatesTarget]);
  useEffect(()=>{NativeModules.BobNotifications.setReplyNotifications?.(notifyEnabled);},[notifyEnabled]);
  useEffect(()=>{NativeModules.BobNotifications.setAppContext?.(backend?.backendId??'',screen==='Chat'&&!drawer?chat??0:0);},[backend?.backendId,chat,screen,drawer]);
  const pendingOperations=useRef(new Map<string,string>());
  const parentFollow=useChatFollow<Entry>(scope,true),childFollow=useChatFollow<Entry>(`${scope}:child:${child}`,true);
  const parentList=parentFollow.list,childList=childFollow.list;
  const parentHistory=useStoredHistory(backend?.backendId,chat,(path,signal)=>request(path,'GET',undefined,backend,signal));
  const historyLatest=useRef(parentHistory);historyLatest.current=parentHistory;
  const childHistory=useStoredHistory(backend?.backendId,child,(path,signal)=>request(path,'GET',undefined,backend,signal));
  useEffect(()=>{if(updatesTarget)parentFollow.resume();},[updatesTarget]);
  useBackNavigation(()=>{
    if(actions){setActions(false);return true;}
    if(drawer){setDrawer(false);return true;}
    if(orbit){setOrbit(false);return true;}
    if(Keyboard.isVisible())return false;
    if(screen!=='Chat'){sectionRequest.current++;setSectionLoading(false);setScreen('Chat');return true;}
    return false;
  });
  async function sessionAction(id:string,action:SessionAction,title?:string){
    const b=backend;if(!b)throw Error('Select a workspace');
    const patch=action==='rename'?{title}:action==='pin'?{pinned:true}:action==='unpin'?{pinned:false}:action==='archive'?{archived:true}:action==='unarchive'?{archived:false}:{trashed:false,archived:false};
    const result=await request(`chats/${id}${action==='delete'?'':'/metadata'}`,action==='delete'?'DELETE':'PUT',action==='delete'?undefined:patch,b);
    if(selectedBackend.current!==b.backendId)return;
    setChats(previous=>{const items=previous.map(item=>item.id===Number(id)?{...item,meta:result.meta}:item);void AsyncStorage.setItem(`chats:${b.backendId}`,JSON.stringify(items)).catch(()=>{});return items;});
    if(action==='delete'&&chat===Number(id)){const next=chats.find(item=>item.id!==Number(id)&&!item.meta?.trashed&&!item.meta?.archived);setChat(next?.id);await AsyncStorage.setItem('selection',JSON.stringify({backendId:b.backendId,chat:next?.id}));}
  }
  async function request(
    path: string,
    method = 'GET',
    body?: unknown,
    b = backend,
    signal?:AbortSignal,
  ) {
    if (!b) throw Error('Select a backend');
    const credential = await Keychain.getGenericPassword({
      service: `bob.${b.backendId}`,
    });
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
  const run = (f: () => Promise<void>) => {
    void f().catch(e => Alert.alert('Bob', String(e.message ?? e)));
  };
  async function reconcilePending(b=backend,id=chat,current=scope) {
    if(!b||!id)return;
    const op=await AsyncStorage.getItem(`pending:${current}`);if(!op)return;
    const result=await request(`chats/${id}/operations/${op}`,'GET',undefined,b);
    if(identity.current!==current)return;
    if(!result.admission){setStatus('No admission found • outcome unknown, no resend');return;}
    const original=await AsyncStorage.getItem(`pending-text:${current}`);
    await AsyncStorage.removeMany([`pending:${current}`,`pending-text:${current}`]);pendingOperations.current.delete(current);
    if(identity.current!==current)return;
    setPending(undefined);if(original!==null&&latestDraft.current===original)setDraft('');setStatus('Admission confirmed');
  }
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
          try{return await request(path,method,value,b,requestAbort.signal);}
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
  useEffect(() => {
    void (async () => {
      const list = JSON.parse(
        (await AsyncStorage.getItem('backends')) ?? '[]',
      ) as Backend[];
      setBackends(list);
      setNotifyEnabled((await AsyncStorage.getItem('notification-opt-in')) !== 'false');
      const last = JSON.parse(
        (await AsyncStorage.getItem('selection')) ?? 'null',
      );
      const notice=await NativeModules.BobPlatform.takeNotificationTarget();
      const notificationBackend=notice?.screen==='updates'||(Number.isSafeInteger(notice?.conversationId)&&notice.conversationId>0)?list.find(b=>b.backendId===notice.backendId):undefined;
      const selected =
        notificationBackend??list.find(b => b.backendId === last?.backendId) ?? list[0];
      if (selected) {
        setBackend(selected);
        if(notificationBackend&&notice.screen==='updates')setUpdatesTarget(notificationBackend);
        if(notificationBackend&&notice.screen!=='updates')setChat(notice.conversationId);else if (last?.backendId === selected.backendId) setChat(last.chat);
      }
    })();
    return () => stream.current?.close();
  }, []);
  useEffect(()=>{
    const listener=DeviceEventEmitter.addListener('BobNotificationOpen',()=>{
      void(async()=>{
        const notice=await NativeModules.BobPlatform.takeNotificationTarget();
        if(!notice)return;
        if(notice.screen!=='updates'&&(!Number.isSafeInteger(notice.conversationId)||notice.conversationId<=0))return;
        const paired=JSON.parse(await AsyncStorage.getItem('backends')??'[]') as Backend[];
        const b=paired.find(item=>item.backendId===notice.backendId);if(!b)return;
        Keyboard.dismiss();
        if(notice.screen==='updates'){setUpdatesTarget(b);return;}
        setBackend(b);setChat(notice.conversationId);setScreen('Chat');setDrawer(false);setOrbit(false);
      })().catch(()=>setStatus('Notification destination unavailable; open its conversation manually'));
    });
    return()=>listener.remove();
  },[]);
  useEffect(() => {
    if (!backend) return;
    setLibrary(undefined); setModels([]); setScreen(previous=>previous==='Workstations'||previous==='Sessions'?previous:'Chat'); setSkillName(''); setSkillText(''); setApiKey(''); setModelId('');
    setMcpConnections([]); setMcpId(''); setMcpEndpoint(''); setMcpTools(''); setMcpEnabled(false);
    setStatus('Connecting');
    const b=backend;let cancelled=false;setChats([]);setChatCursor(undefined);
    void (async()=>{
      const cached=await AsyncStorage.getItem(`chats:${b.backendId}`);
      if(cancelled||selectedBackend.current!==b.backendId)return;
      if(cached)setChats(JSON.parse(cached));
      try {
        const result=await request('chats','GET',undefined,b);
        if(cancelled||selectedBackend.current!==b.backendId)return;
        const items=Array.from(new Map<string|number,Chat>([...(cached?JSON.parse(cached):[]),...result.items].map((c:Chat)=>[c.id,c])).values()).sort((a,b)=>b.id-a.id);
        setChats(items);setChatCursor(result.next);if(!identity.current)setStatus('Ready · select a conversation');await AsyncStorage.setItem(`chats:${b.backendId}`,JSON.stringify(items));
      }catch{if(!cancelled&&selectedBackend.current===b.backendId)setStatus('Offline • cached history');}
    })();
    return()=>{cancelled=true;};
  }, [backend?.backendId]);
  useEffect(() => {
    let cancelled=false,events:SnapshotStream|undefined,lastRaw:string|undefined;
    stream.current?.close();
    draftReady.current = false;
    setDraftLoadedScope('');
    setView(undefined);
    setPending(undefined);
    setDraft('');setChild(undefined);setChildView(undefined);setOrbit(false);
    if (!backend || !chat) return;
    setStatus('Connecting…');
    const current = scope,
      b = backend;
    void (async () => {
      const [saved, cached, op] = await Promise.all([
        AsyncStorage.getItem(`draft:${current}`).catch(()=>null),
        readHistoryCache(`history:${current}`),
        AsyncStorage.getItem(`pending:${current}`).catch(()=>null),
      ]);
      if (cancelled||identity.current !== current) return;
      setDraft(saved ?? '');
      draftReady.current = true;
      setDraftLoadedScope(current);
      if (cached) {
        try{const snapshot=JSON.parse(cached);if(Array.isArray(snapshot.entries)&&snapshot.docs&&typeof snapshot.docs==='object'){setView(snapshot);setStatus('Cached • reconnecting');}}catch{}
      }
      setPending(op ?? undefined);
      if(op)pendingOperations.current.set(current,op);else pendingOperations.current.delete(current);
      await AsyncStorage.setItem(
        'selection',
        JSON.stringify({ backendId: b.backendId, chat }),
      ).catch(()=>{});
      try {
        const credential = await Keychain.getGenericPassword({
          service: `bob.${b.backendId}`,
        });
        if (!credential) throw Error('Missing credential');
        if(cancelled||identity.current!==current)return;
        const es = snapshotStream(`${b.endpoint}/v1/chats/${chat}/events`,{Authorization:'Bearer '+credential.password,'x-bob-backend':b.backendId},raw => {
          if (cancelled||identity.current !== current) return;
          if(raw===lastRaw){setStatus('Connected');return;}
          const data = JSON.parse(raw);
          if (data.backendId !== b.backendId || data.conversationId !== chat) {
            es.close();
            setStatus('Identity mismatch');
            return;
          }
          lastRaw=raw;setView(previous=>reuseSnapshotEntries(previous,data.view));
          setStatus('Connected');
          void writeHistoryCache(
            `history:${current}`,
            JSON.stringify(data.view),
          );
        },nextStatus=>{if(identity.current===current)setStatus(nextStatus);},()=>{void reconcilePending(b,chat,current).catch(()=>{});void historyLatest.current.refresh().catch(()=>{});void drainLatest.current(true,b.backendId);},snapshotLifecycle);
        events=es;
        if(cancelled||identity.current!==current){es.close();return;}
        stream.current=es;

      } catch {
        if (identity.current === current) setStatus('Offline • cached history');
      }
    })();
    return () => {cancelled=true;events?.close();};
  }, [scope]);
  useEffect(()=>{
    setChildView(undefined);setChildStatus('Connecting child');
    if(!orbit||!child||!backend)return;
    const b=backend,current=scope,id=child;let cancelled=false,events:SnapshotStream|undefined;
    void (async()=>{
      try {
        const cached=await readHistoryCache(`history:${b.backendId}:${id}`);
        if(cancelled||identity.current!==current)return;
        if(cached){try{const snapshot=JSON.parse(cached);if(Array.isArray(snapshot.entries)&&snapshot.docs){setChildView(snapshot);setChildStatus('Cached child • reconnecting');}}catch{}}
        const credential=await Keychain.getGenericPassword({service:`bob.${b.backendId}`});if(!credential)throw Error('Missing credential');
        if(cancelled||identity.current!==current)return;
        events=snapshotStream(`${b.endpoint}/v1/chats/${id}/events`,{Authorization:'Bearer '+credential.password,'x-bob-backend':b.backendId},raw=>{
          if(cancelled||identity.current!==current)return;
          const data=JSON.parse(raw);
          if(data.backendId!==b.backendId||data.conversationId!==id){events?.close();setChildStatus('Child identity mismatch');return;}
          const snapshot=data.view as Snapshot;setChildView(previous=>reuseSnapshotEntries(previous,snapshot));
          setChildStatus(snapshot.work?.some(t=>t.state==='blocked')?'Child blocked':snapshot.docs['pi.live']?.run||snapshot.work?.some(t=>!t.background)?'Child working':'Child idle');
          void writeHistoryCache(`history:${b.backendId}:${id}`,JSON.stringify(snapshot));
        },nextStatus=>{if(!cancelled&&identity.current===current)setChildStatus(nextStatus);},undefined,snapshotLifecycle);
      }catch{if(!cancelled&&identity.current===current)setChildStatus('Child offline • last cached state');}
    })();
    return()=>{cancelled=true;events?.close();};
  },[scope,child,orbit]);
  useEffect(() => {
    if (scope && draftReady.current)
      void AsyncStorage.setItem(`draft:${scope}`, draft);
  }, [draft, scope]);
  async function pair(invitation = pairing) {
    const p = PairingInvitation.parse(JSON.parse(invitation));
    if (
      p.protocol !== 1 ||
      typeof p.backendId !== 'string' ||
      typeof p.endpoint !== 'string' ||
      p.expiresAt < Date.now()
    )
      throw Error('Invalid or expired invitation');
    const u = new URL(p.endpoint);
    if(u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('Pairing endpoint must be a clean origin');
    if (
      u.protocol !== 'https:' &&
      !(NativeModules.BobPlatform.loopbackTesting === true && u.protocol==='http:' && u.hostname==='127.0.0.1' && Number(u.port)>0)
    )
      throw Error('Verified HTTPS required');
    if (u.protocol === 'https:' && !u.hostname.endsWith('.ts.net'))
      throw Error('Tailscale endpoint required');
    const r = await fetch(p.endpoint + '/v1/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        backendId: p.backendId,
        invitation: p.invitation,
        name: 'Bob Android',
      }),
    });
    const result = await r.json();
    if (!r.ok || result.backendId !== p.backendId)
      throw Error(result.error ?? 'Backend identity mismatch');
    await Keychain.setGenericPassword(result.deviceId, result.credential, {
      service: `bob.${p.backendId}`,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    const b = {
      backendId: p.backendId,
      endpoint: p.endpoint,
      name: u.hostname,
    };
    const list = [...backends.filter(x => x.backendId !== b.backendId), b];
    await AsyncStorage.setItem('backends', JSON.stringify(list));
    setBackends(list);
    setBackend(b);
    setChat(undefined);
    setPairing('');
    setDrawer(false);
  }
  async function newChat() {
    const b=backend;if(!b)throw Error('Select a backend');
    const r = await request('chats', 'POST', { title: 'New conversation' },b);
    if(selectedBackend.current!==b.backendId)return;
    setChat(r.id);
    setScreen('Chat');
    setDrawer(false);
    const result=await request('chats','GET',undefined,b);
    if(selectedBackend.current!==b.backendId)return;
    const items=Array.from(new Map<number,Chat>([...chats,...result.items].map((c:Chat)=>[c.id,c])).values()).sort((a,b)=>b.id-a.id);
    setChats(items);setChatCursor(result.next);await AsyncStorage.setItem(`chats:${b.backendId}`,JSON.stringify(items));
  }
  async function submit(mode: 'steer' | 'followUp',answer?:{questionId:string;text:string}) {
    if (!backend || !chat || (!answer&&!hasDraft) || pending || pendingOperations.current.has(scope)) return;
    if(answer&&(view?.docs['bob.questions']?.pending?.id!==answer.questionId||outbox.items.some(item=>item.scope===scope&&item.message.questionId===answer.questionId&&(!item.rejected||item.admitted))))return;
    parentFollow.resume();
    const current=scope,files=answer?[]:attachments,op=uuid();
    const item:OutgoingMessage={id:op,scope:current,backend,chat,createdAt:Date.now(),afterEntryId:Math.max(0,...(view?.entries??[]).map(entry=>entry.id),...(parentHistory.page?.items??[]).map(entry=>entry.id)),localId:Math.min(-Date.now(),...outbox.items.map(item=>item.localId-1)),files,
      message:Message.parse({requestId:op,...(answer?{questionId:answer.questionId}:{}),text:answer?.text??(draft.trim()?draft:'Please look at the attached file'+(files.length===1?'.':'s.')),mode,allowSubagents:true,
        ...(visualWidth>0?{display:{inline:{width:Math.floor(visualWidth),height:420},fullscreen:{width:Math.max(1,Math.floor(windowSize.width-insets.left-insets.right)),height:Math.max(1,Math.floor(windowSize.height-insets.top-insets.bottom))}}}:{})})};
    // Publish the ordinary chat bubble and clear the composer before any await.
    const saved=outbox.add(item);
    Keyboard.dismiss();
    if(!answer){setDraft('');setDraftAttachments(previous=>({...previous,[current]:[]}));}
    try {await saved;void drainOutbox();}
    catch{/* Keep the local bubble and retry saving before any network send. */}
  }
  const transport=useRef({request,backends});transport.current={request,backends};
  const [delivery]=useState(()=>new OutboxDelivery(outbox,{
    backends:()=>transport.current.backends,
    request:(path,method,body,b)=>transport.current.request(path,method,body,b),
    async upload(item,b){
      const credential=await Keychain.getGenericPassword({service:`bob.${b.backendId}`});
      if(!credential)throw Object.assign(Error('Pair again: device credential missing'),{httpStatus:401});
      const limits=TransferLimits.parse(await transport.current.request('transfer-limits','GET',undefined,b));
      for(const file of item.files){
        await NativeModules.BobFiles.restoreAttachment(file.id,file.uri,file.name,file.mime);
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
  async function openAttachments(tab:'gallery'|'files'|'camera') {
    const b=backend,current=scope;if(!b||!chat||pending)return;
    setActions(false);Keyboard.dismiss();
    const limits=TransferLimits.parse(await request('transfer-limits','GET',undefined,b));
    if(identity.current!==current)return;
    if(tab==='camera'){
      const file=await NativeModules.BobFiles.captureAttachment(limits.uploadLimit) as DraftAttachment|null;
      if(file)setDraftAttachments(previous=>({...previous,[current]:[...(previous[current]??[]),file]}));
    }else setAttachmentPicker({scope:current,tab,limit:limits.uploadLimit});
  }
  async function attachmentAction(action: 'upload' | 'save' | 'preview', raw?: unknown) {
    const b = backend;
    if (!b || !chat) throw Error('Select a conversation');
    const artifact = action === 'upload' ? undefined : Attachment.parse(raw);
    const destination = artifact?.conversationId ?? chat;
    const credential = await Keychain.getGenericPassword({ service: `bob.${b.backendId}` });
    if (!credential) throw Error('Pair again: device credential missing');
    const limits = TransferLimits.parse(await request('transfer-limits', 'GET', undefined, b));
    const url = `${b.endpoint}/v1/chats/${destination}/artifacts${artifact ? '/' + artifact.id : ''}`;
    if (action === 'upload') {
      const current=`${b.backendId}:${chat}`;
      const selected=await NativeModules.BobFiles.chooseAttachment(limits.uploadLimit) as DraftAttachment|null;
      if(selected)setDraftAttachments(previous=>({...previous,[current]:[...(previous[current]??[]),selected]}));
    } else if (action === 'save' && artifact) {
      await NativeModules.BobFiles.save(url, credential.password, b.backendId, artifact.name, artifact.mime, Math.max(limits.uploadLimit, artifact.size));
    } else if (artifact) {
      await NativeModules.BobFiles.preview(url, credential.password, b.backendId, artifact.mime, Math.max(limits.uploadLimit, artifact.size));
    }
  }
  useEffect(() => {
    const current = scope, b = backend;
    if (!b || !chat) { setSurfaces([]); return; }
    let cancelled = false;
    void request(`chats/${chat}/ui`, 'GET', undefined, b).then(result => {
      if (cancelled || identity.current !== current) return;
      setSurfaces(InteractiveSummary.array().parse(result).map(value => ({ backendId:b.backendId, value })));
      setSurfaceError('');
    }).catch(() => { if (!cancelled && identity.current === current) setSurfaceError('Interactive surfaces unavailable while disconnected'); });
    return () => { cancelled = true; };
  }, [scope, view?.entries.length]);
  async function openSurface(item: {backendId:string; value:ReturnType<typeof InteractiveSummary.parse>}) {
    const b = backend;
    if (!b || b.backendId !== item.backendId) throw Error('Interactive surface belongs to another backend');
    const credential = await Keychain.getGenericPassword({service:`bob.${b.backendId}`});
    if (!credential) throw Error('Pair again');
    await NativeModules.BobInteractive.open(b.endpoint, b.backendId, credential.password, item.value.conversationId, item.value.id);
  }
  async function stop(tree: boolean) {
    const current = scope;
    setStatus('Stop requested • stopping');
    await request(`chats/${chat}/stop`, 'POST', {
      scope: tree ? 'tree' : 'root',
    });
    if (identity.current === current) setStatus('Stop settled');
  }
  async function openModelPicker(){
    const b=backend,id=chat,current=scope;if(!b||!id)throw Error('Open a conversation first');
    setActions(false);setModelLoading(true);setModelPickerTarget({backend:b,chat:id,scope:current});
    try{const [listed,configured]=await Promise.all([request('models','GET',undefined,b),request(`chats/${id}/configure`,'GET',undefined,b)]);
    if(identity.current!==current)return;setModels(listed);setModelChoice({model:configured.model,thinkingLevel:configured.thinkingLevel});}
    finally{if(identity.current===current)setModelLoading(false);}
  }
  async function applyModelChoice(choice:Required<ModelChoice>){
    const target=modelPickerTarget;if(!target||identity.current!==target.scope)throw Error('Conversation changed; reopen model selection');
    await request(`chats/${target.chat}/configure`,'PUT',choice,target.backend);
    const observed=await request(`chats/${target.chat}/configure`,'GET',undefined,target.backend);
    if(observed.model?.provider!==choice.model.provider||observed.model?.modelId!==choice.model.modelId||observed.thinkingLevel!==choice.thinkingLevel)throw Error('Selection could not be confirmed; reopen to check');
    if(identity.current!==target.scope)return;
    setModelChoice({model:observed.model,thinkingLevel:observed.thinkingLevel});setModelPickerTarget(undefined);
  }
  function navigate(tab:BottomDestination){
    if(screen===tab)return;
    Keyboard.dismiss();setActions(false);setOrbit(false);setDrawer(false);
    if(tab==='Settings'||tab==='Notes'){run(()=>openSection(tab));return;}
    sectionRequest.current++;setSectionLoading(false);setScreen(tab);
  }
  useEffect(()=>{
    if(screen!=='Sessions'||!backend)return;
    const b=backend;let cancelled=false;
    void request('chats','GET',undefined,b).then(result=>{if(cancelled||selectedBackend.current!==b.backendId)return;setChats(result.items);setChatCursor(result.next);void AsyncStorage.setItem(`chats:${b.backendId}`,JSON.stringify(result.items)).catch(()=>{});}).catch(()=>{});
    return()=>{cancelled=true;};
  },[screen,backend?.backendId]);
  async function openSection(name: string) {
    const selected = backend?.backendId;
    const current = scope;
    const ticket=++sectionRequest.current;setSectionError('');setSectionLoading(name!=='Settings'&&name!=='Notes');
    setScreen(name);setDrawer(false);
    try{
    if(name==='Modules') {
      if(!chat)throw Error('Select a conversation first');
      const entries=ModuleInfo.array().parse(await request(`chats/${chat}/modules`));
      if(identity.current!==current)return;setModuleList(entries);
    }
    if (name === 'MCP Apps') {
      const entries=McpConnection.array().parse(await request('mcp-connections'));
      if(selectedBackend.current!==selected)return;setMcpConnections(entries);
    }
    if (name === 'Prompts' || name === 'Skills') {
      const l = await request('library');
      if (selectedBackend.current !== selected) return;
      setLibrary(l);
      setInstructions(l.instructions);
    }
    }catch(e){if(sectionRequest.current===ticket)setSectionError(String((e as Error).message??e));}
    finally{if(sectionRequest.current===ticket)setSectionLoading(false);}
  }
  async function loadConversationSettings():Promise<SavedConversationSettings>{
    const b=backend,id=chat,current=scope,ticket=sectionRequest.current;
    if(!b||!id||identity.current!==current)throw Error('Conversation changed. Reopen settings.');
    const configured=await request(`chats/${id}/configure`,'GET',undefined,b);
    if(identity.current!==current||sectionRequest.current!==ticket)throw Error('Conversation changed. Reopen settings.');
    if(typeof configured?.cwd!=='string'||!(configured.instructions===null||typeof configured.instructions==='string'))throw Error('Could not load conversation settings. Try again.');
    setChatInstructions(configured.instructions??'');setUsesDefaultInstructions(configured.instructions===null);setWorkingDirectory(configured.cwd);
    return {instructions:configured.instructions,cwd:configured.cwd};
  }
  async function saveConversationSettings(change:ConversationChange):Promise<SavedConversationSettings>{
    const b=backend,id=chat,current=scope,ticket=sectionRequest.current;
    if(!b||!id||identity.current!==current)throw Error('Conversation changed. Reopen settings.');
    await request(`chats/${id}/configure`,'PUT',change,b);
    const observed=await request(`chats/${id}/configure`,'GET',undefined,b);
    if(typeof observed?.cwd!=='string'||!(observed.instructions===null||typeof observed.instructions==='string'))throw Error('Save could not be confirmed. Reopen settings to check before retrying.');
    if(('instructions' in change&&(observed.instructions??null)!==change.instructions)||('cwd' in change&&observed.cwd!==change.cwd))throw Error('Save could not be confirmed. Reopen settings to check before retrying.');
    if(identity.current!==current)throw Error('Conversation changed. Reopen settings to check the save.');
    if(sectionRequest.current!==ticket)return {instructions:observed.instructions,cwd:observed.cwd};
    // Saving one field must not erase an unsaved edit in the other field.
    if('instructions' in change){setChatInstructions(observed.instructions??'');setUsesDefaultInstructions(observed.instructions==null);}
    if('cwd' in change)setWorkingDirectory(observed.cwd);
    return {instructions:observed.instructions??null,cwd:observed.cwd??''};
  }
  async function changeMcp(method:'PUT'|'DELETE',value:unknown) {
    const b=backend;if(!b)throw Error('Select a backend');
    await request('mcp-connections',method,value,b);
    const entries=McpConnection.array().parse(await request('mcp-connections','GET',undefined,b));
    if(selectedBackend.current===b.backendId)setMcpConnections(entries);
  }
  const agents = Object.entries(view?.docs['app.subagents']?.agents ?? {}) as [
    string,
    { conversationId: number; status?:string },
  ][];
  const activeAgents=agents.filter(([,agent])=>isActiveSubagent(agent.status));
  const busy = !!view?.docs['pi.live']?.run || !!view?.work?.some(t=>t.kind==='bob.mcp-ui-action'&&!t.background);
  const showStop=busy&&!hasDraft;
  const linkedTranscript=(snapshot:Snapshot|undefined,page:typeof parentHistory.page)=>{
    const entries=page?Array.from(new Map([...(page.items as Entry[]),...(snapshot?.entries??[])].map(entry=>[entry.id,entry])).values()).sort((a,b)=>a.id-b.id):snapshot?.entries??[];
    const linked=linkToolResults(entries,snapshot?.docs['pi.live']),anchors=surfaceAnchors(entries,snapshot?.docs['pi.live']),surfaceEntries=new Set(anchors.values());
    return {...linked,rawEntries:entries,entries:linked.entries.filter(entry=>entry.kind!=='pi.system'&&(hasInlineChatContent(entry)||surfaceEntries.has(entry.id))).reverse(),surfaceAnchors:anchors};
  };
  const parentLinked=useMemo(()=>{
    const linked=linkedTranscript(view,parentHistory.page);
    return {...linked,entries:mergeOutgoing(linked.entries,outgoing,scope,item=>({id:item.localId,kind:'bob.user',data:{text:item.message.text,requestId:item.id,localDelivery:outgoingLabel(item),deliveryError:item.rejected?item.lastError:undefined}}))};
  },[view?.entries,view?.docs['pi.live'],parentHistory.page,outgoing,scope]);
  useEffect(()=>{
    const entries=[...(parentHistory.page?.items??[]),...(view?.entries??[])];
    for(const item of outgoing){
      if(item.scope!==scope)continue;
      if(!visibleOutgoing([item],scope,entries).length)void outbox.remove(item.id).catch(()=>{});
      else if(item.afterEntryId===undefined&&entries.length)void outbox.update(item.id,{afterEntryId:outgoingAnchor(item,entries)}).catch(()=>{});
    }
  },[outgoing,scope,view?.entries,parentHistory.page,outbox]);
  const childLinked=useMemo(()=>linkedTranscript(childView,childHistory.page),[childView?.entries,childView?.docs['pi.live'],childHistory.page]);
  useEffect(()=>noteLoadedEntries(parentLinked.rawEntries.length+childLinked.rawEntries.length),[parentLinked.rawEntries.length,childLinked.rawEntries.length]);
  const positionedSurfaces=useMemo(()=>{
    const grouped=new Map<number,typeof surfaces>();
    for(const item of surfaces){
      if(item.backendId!==backend?.backendId||item.value.conversationId!==chat)continue;
      const entryId=parentLinked.surfaceAnchors.get(item.value.id.toLowerCase());
      if(entryId!==undefined)grouped.set(entryId,[...(grouped.get(entryId)??[]),item]);
    }
    return grouped;
  },[surfaces,parentLinked.surfaceAnchors,backend?.backendId,chat]);
  function transcript(v?: Snapshot,isChild=false) {
    const history=!isChild?parentHistory:childHistory,stored=history.page;
    const follow=!isChild?parentFollow:childFollow;
    const linked=isChild?childLinked:parentLinked;
    return (
      <View style={{flex:1}}>
      {isChild&&<View style={{paddingHorizontal:24}}><Disclosure label="Conversation history">
        <View style={{flexDirection:'row',gap:8,alignItems:'center'}}>
          <View style={{flex:1}}><Button label={stored?(stored.next?'Load earlier stored history':'Refresh stored history'):'Load stored history'} disabled={!history.ready||history.loading} onPress={()=>run(history.load)} /></View>
          <Button label="↑" accessibilityLabel="Jump to oldest loaded entry" onPress={follow.oldest} />
        </View>
        {stored&&<Text style={styles.caption}>{stored.items.length} stored entries loaded · {stored.next?'more available':'end of last scan'}. Stored history is not unlimited model context.</Text>}
      </Disclosure></View>}
      <FlatList
        testID={isChild?'child-history-list':'chat-history-list'}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        ref={!isChild?parentList:childList}
        {...follow.props}
        key={!isChild?scope:`${scope}:child:${child}`}
        // Full-height viewport allows content to pass smoothly underneath the fade.
        style={{ flex: 1 }}
        // First native position is the latest message, even before any cell
        // heights are measured. No launch-time trip through older history.
        inverted
        initialScrollIndex={0}
        data={linked.entries}
        // Preserve an older-message reader's anchor. At latest, keep native
        // offset zero instead of preserving an old cell and scrolling it back.
        maintainVisibleContentPosition={follow.following?undefined:{minIndexForVisible:0}}
        keyExtractor={transcriptKey}
        contentContainerStyle={[styles.messages,!isChild&&{paddingTop:16,paddingBottom:16}]}
        ListFooterComponent={<View style={{gap:12}}>
          {stored?.next&&<Button label={history.loading?'Loading history…':'Load earlier messages'} disabled={history.loading} onPress={()=>{follow.pause();run(history.load);}}/>}
          {!!history.error&&<View style={{gap:8}}><Text accessibilityLiveRegion="polite" style={styles.caption}>Couldn’t load stored history: {history.error}</Text><Button label="Retry loading history" disabled={history.loading} onPress={()=>run(history.refresh)}/></View>}
        </View>}
        ListEmptyComponent={linked.rawEntries.length?undefined:<View style={{paddingVertical:24,gap:12}}>
          {isChild&&!!emptyConversationMessage(history)&&<Text accessibilityLiveRegion="polite" style={styles.caption}>{emptyConversationMessage(history)}</Text>}
        </View>}
        scrollIndicatorInsets={!isChild?{top:0,bottom:0}:undefined}

        ListHeaderComponent={<View style={{gap:CHAT_CONTENT_GAP}} onLayout={event=>{if(!isChild)setVisualWidth(event.nativeEvent.layout.width);}}>
          {!isChild && !!surfaceError && <Text style={styles.caption}>{surfaceError}</Text>}
          {/* Live text streams here. Tool boxes render only in their recorded
              entry slot below, so they never migrate from this transient header. */}
          {v?.docs['pi.live']?.generation?.message && !isRecordedToolGeneration(linked.rawEntries,v.docs['pi.live'].generation.message.content) && <ModelContent speakable={false} showTools={false} value={v.docs['pi.live'].generation.message.content} results={linked.results}/>}
          {!isChild&&backend&&<BuildCard key={backend.backendId} backend={backend} state={build.state} error={build.error} focus={updatesTarget?.backendId===backend.backendId} onDismiss={()=>setUpdatesTarget(undefined)} onRefresh={build.refresh}/>}
          {!isChild&&((v?.docs['bob.diagnostics']?.requests??[]) as DiagnosticRequest[]).filter(item=>['pending','approved'].includes(item.status)).map(item=><DiagnosticCard key={`${scope}:${item.id}`} request={item} respond={value=>request(`chats/${chat}/diagnostics`,'POST',value,backend!)}/>)}
          {!isChild&&v?.docs['bob.questions']?.pending&&!outgoing.some(item=>item.scope===scope&&item.message.questionId===v.docs['bob.questions'].pending.id&&(!item.rejected||item.admitted))&&<QuestionCard key={`${scope}:${v.docs['bob.questions'].pending.id}`} question={v.docs['bob.questions'].pending as Question} disabled={!!pending} onAnswer={text=>submit('steer',{questionId:v.docs['bob.questions'].pending.id,text})}/>}
          {/* Inverted header is the physical bottom of the chat. Keep live
              replies and the composer clearance here, below stored messages. */}
          {!isChild&&<View pointerEvents="none" accessible={false} style={{height:composerHeight+(activeAgents.length?80:44)}}/>}
        </View>}
        renderItem={({ item }) => {
          const attribution=inputAttribution(item),user=attribution.owner;
          const peerAdmission=item.kind==='bob.peer-admission';
          const artifact=(item.kind==='bob.artifact'||item.kind==='bob.file')&&Attachment.safeParse(item.data).success;
          const fallback=()=>textOf(item.data)||'Stored event has no displayable text.';
          const originalText=item.kind==='bob.user'&&item.data&&typeof item.data==='object'&&'text' in item.data&&typeof item.data.text==='string'?item.data.text:undefined;
          const body=originalText!==undefined?<Text selectable style={styles.message}>{originalText}</Text>:peerAdmission?<PeerAdmission data={item.data} peerName={backends.find(b=>b.backendId===(item.data as {peerId?:string}|undefined)?.peerId)?.name}/>:artifact&&backend?<FileAttachment backend={backend} artifact={Attachment.parse(item.data)} fromBob={item.kind==='bob.file'} onOpen={()=>run(()=>attachmentAction('preview',item.data))} onSave={()=>run(()=>attachmentAction('save',item.data))}/>:item.model?.length?<View style={{gap:CHAT_CONTENT_GAP}}>{item.model.map((m,i)=>m.role==='toolResult'?<ToolContent quiet key={m.toolCallId??i} name={m.toolName??'Result'} content="Arguments are outside the loaded history." result={{content:m.content,status:m.isError?'failed':'done',isError:m.isError}}/>:<ModelContent speakable={m.role==='assistant'} quietTools key={i} value={m.content} results={linked.results}/>)}</View>:<Text selectable style={styles.message}>{fallback()}</Text>;
          const delivery=item.id<0?(item.data as {localDelivery?:string}|undefined)?.localDelivery:item.kind==='bob.user'&&(item.data as {requestId?:string}|undefined)?.requestId?'Sent':undefined;
          const failed=item.id<0?outgoing.find(value=>value.localId===item.id&&value.rejected):undefined;
          const assistant=item.kind==='pi.assistant'||item.model?.some(m=>m.role==='assistant');
          return <View testID={`history-entry-${item.id}`}>{hasInlineChatContent(item)&&<View style={[styles.bubble,(user||(artifact&&item.kind==='bob.artifact'))&&styles.userBubble,!!delivery&&{minWidth:Math.min(180,Math.max(0,windowSize.width-insets.left-insets.right-96))}]}>{user||assistant||artifact||peerAdmission?body:<Disclosure label={attribution.label??item.kind.replace(/^(pi|bob)\./,'').replaceAll('-',' ')}>{body}</Disclosure>}{delivery&&<Text accessibilityLiveRegion={item.id<0?'polite':'none'} style={{color:colors.muted,fontSize:13,lineHeight:19,minHeight:19,marginTop:6,fontWeight:'500'}}>{delivery}</Text>}{failed&&<View style={{gap:4}}>{!!failed.lastError&&<Text style={{color:colors.muted,fontSize:13,lineHeight:19}}>{failed.lastError}</Text>}<Button label={failed.admitted?"Check delivery":"Retry sending"} onPress={()=>run(async()=>{await outbox.update(failed.id,{rejected:false,attempts:0,retryAt:undefined,retryAfterAt:undefined,lastError:undefined});await drainLatest.current(true,failed.backend.backendId);})}/></View>}</View>}
            {!isChild&&(positionedSurfaces.get(item.id)??[]).map(surface=><InlineSurface key={`${surface.backendId}:${surface.value.conversationId}:${surface.value.id}`} backend={backend!} surface={surface.value} onExpand={()=>run(()=>openSurface(surface))}/>)}
          </View>;
        }}
      />
      {isChild&&follow.showJump&&<Pressable accessibilityRole="button" accessibilityLabel="Scroll to latest child message" onPress={follow.resume} style={{position:'absolute',bottom:16,right:20,width:48,height:48,borderRadius:24,alignItems:'center',justifyContent:'center',backgroundColor:colors.surface,borderColor:colors.border,borderWidth:1}}><ArrowDown size={22} color={colors.foreground}/></Pressable>}
      </View>
    );
  }
  if (backends.length === 0) return (
    <SafeAreaView edges={Platform.OS==='android'?['left','right','bottom']:undefined} style={styles.root}>
      {Platform.OS!=='android'&&<StatusBar hidden barStyle="light-content" />}
      <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.welcome} keyboardShouldPersistTaps="handled">
        <View style={styles.welcomeArt}>
          <Image accessibilityLabel="Bob logo" accessibilityRole="image" source={require('./assets/bob-logo.png')} resizeMode="contain" style={styles.welcomeLogo}/>
        </View>
        <View style={styles.welcomeCopy}>
          <Text style={styles.welcomeTitle}>Your agents,{'\n'}anywhere.</Text>
          <Text style={styles.welcomeSubtitle}>Connect to Bob on your computer.</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Scan QR code" style={styles.welcomePrimary} onPress={()=>run(async()=>{const invitation=await NativeModules.BobPlatform.scanPairing();if(invitation)await pair(invitation);})}>
            <Text style={styles.welcomePrimaryText}>Scan QR code</Text>
          </Pressable>
          <Button label={welcomeHelp?'Where is the QR code? −':'Where is the QR code? +'} onPress={()=>setWelcomeHelp(!welcomeHelp)}/>
          {welcomeHelp&&<Text style={styles.welcomeSubtitle}>Run bob connect on your computer. Keep Tailscale connected on both devices, then scan the QR code.</Text>}
          <Button label={welcomeManual?'Hide manual pairing':'Paste pairing invitation'} onPress={()=>setWelcomeManual(!welcomeManual)}/>
          {welcomeManual&&<><TextInput accessibilityLabel="Pairing invitation" style={styles.input} placeholder="Paste invitation" placeholderTextColor={colors.muted} value={pairing} onChangeText={setPairing} multiline autoCapitalize="none"/><Button label="Connect" disabled={!pairing.trim()} onPress={()=>run(()=>pair())}/></>}
          {status!=='Not paired'&&<Text accessibilityLiveRegion="polite" style={styles.caption}>{status}</Text>}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
  return (
    <SafeAreaView edges={Platform.OS==='android'?['left','right','bottom']:undefined} style={[styles.root,{backgroundColor:keyboardInset>0?colors.background:'#ffffff'}]}>
      {/* BottomTabs draws the continuous rounded lower edge; rounding here would cut its neck. */}
      <View testID="rounded-app-surface" style={[styles.content,{backgroundColor:colors.background,overflow:'hidden',paddingBottom:Math.max(0,keyboardInset-insets.bottom)}]}>
      {Platform.OS!=='android'&&<StatusBar hidden barStyle="light-content" />}
      {/* Keep the same native list and viewport alive under section overlays.
          Unmounting here recreates FlatList at its initial offset on every return. */}
      <>
          <View testID="chat-viewport" pointerEvents={screen==='Chat'?'auto':'none'} accessibilityElementsHidden={screen!=='Chat'} importantForAccessibility={screen==='Chat'?'auto':'no-hide-descendants'} style={{flex:1,opacity:screen==='Chat'?1:0}}>
            {chat ? (
              transcript(view)
            ) : (
              <View style={styles.empty}>
                <Text style={styles.hero}>A conversation that stays.</Text>
                <Text style={styles.caption}>
                  {backend?'Choose a conversation from Sessions or start a new one.':'Pair your backend to begin. Your machine owns the work.'}
                </Text>
                {backend&&<BuildCard key={backend.backendId} backend={backend} state={build.state} error={build.error} focus={updatesTarget?.backendId===backend.backendId} onDismiss={()=>setUpdatesTarget(undefined)} onRefresh={build.refresh}/>}
                {backend && (
                  <Button
                    label="New conversation"
                    onPress={() => run(newChat)}
                  />
                )}
              </View>
            )}
            {parentFollow.showJump&&<Pressable accessibilityRole="button" accessibilityLabel="Scroll to latest message" onPress={parentFollow.resume} style={{position:'absolute',bottom:composerHeight+12,left:'50%',marginLeft:-24,width:48,height:48,borderRadius:24,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,alignItems:'center',justifyContent:'center',zIndex:30,elevation:4}}><ArrowDown size={23} color={colors.foreground}/></Pressable>}
            {activeAgents.length > 0 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Toggle subagents, ${activeAgents.length} active agents`}
                style={[styles.orbit,{bottom:composerHeight+12}]}
                onPress={() => setOrbit(!orbit)}
              >
                <Users size={18} color={colors.accent}/><Text style={styles.buttonText}>Agents · {activeAgents.length}</Text><ChevronRight size={16} color={colors.muted}/>
              </Pressable>
            )}
          </View>
          <Animated.View layout={composerTransition} testID="chat-composer" pointerEvents={screen==='Chat'?'box-none':'none'} accessibilityElementsHidden={screen!=='Chat'} importantForAccessibility={screen==='Chat'?'auto':'no-hide-descendants'} onLayout={event=>setComposerHeight(event.nativeEvent.layout.height)} style={[styles.composer,keyboardInset<=0&&styles.composerCompact,{opacity:screen==='Chat'?1:0,position:'absolute',left:0,right:0,bottom:Math.max(0,keyboardInset-insets.bottom),zIndex:20}]}>
            {!composerReady&&chat?<View testID="chat-opening" accessible accessibilityRole="progressbar" accessibilityLabel="Opening conversation" accessibilityState={{busy:true}} style={{minHeight:34,paddingBottom:11,alignItems:'center',justifyContent:'center'}}><ActivityIndicator size="small" color={colors.muted}/></View>:((!!outboxError||/pair again|identity|authorization|offline|disconnect|interrupted|reconnecting/i.test(status)||busy||outgoing.some(item=>item.scope===scope&&!item.rejected&&!item.admitted)||parentLinked.rawEntries.length>0)&&(
            <ComposerStatus animate={!outboxError&&!/pair again|identity|authorization/i.test(status)} text={outboxError?'Device storage issue • keep Bob open':/pair again|identity|authorization/i.test(status)?'Connection needs attention • pair again':/offline|disconnect|interrupted|reconnecting/i.test(status)?'Reconnecting…':/connecting|cached/i.test(status)?'Connecting…':outgoing.some(item=>item.scope===scope&&!item.rejected&&!item.admitted)?'Sending • automatic retry':busy?'Bob is working':status==='Connected'?'Connected':chat?'Connecting…':'Select a conversation'}/>
            ))}

            <Animated.View layout={composerTransition} style={[styles.composerCapsule,keyboardInset<=0&&styles.composerCapsuleCompact]}>
              {attachments.length>0&&<ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{gap:10,padding:12}} style={{maxHeight:136}}>
                {attachments.map(file=><AttachmentThumbnail key={file.id} name={file.name} mime={file.mime} source={{uri:file.uri}} disabled={!!pending} onRemove={()=>{
                  const current=scope;
                  setDraftAttachments(previous=>({...previous,[current]:(previous[current]??[]).filter(item=>item.id!==file.id)}));
                  void NativeModules.BobFiles.removeAttachment(file.id).catch(()=>{});
                }}/>) }
              </ScrollView>}
              <DraftInput scope={scope} editable={composerReady} onFocusChange={setDraftFocused} value={draft} onChangeText={setDraft} compact={keyboardInset<=0}
                maxHeight={Math.max(48,Math.min(260,windowSize.height-keyboardInset-insets.top-insets.bottom-48-48-40-(attachments.length?136:0)))}
                leading={<IconButton icon={Plus} label="Chat actions" disabled={!composerReady} onPress={()=>{setActionsMore(false);setActions(true);}}/>}
                trailing={<IconButton icon={showStop?Square:ArrowUp} label={showStop?'Stop Bob':'Send message'} primary disabled={!composerReady||(!showStop&&(!hasDraft||!!pending))} onPress={()=>run(()=>showStop?stop(false):submit('steer'))}/>}
              />
            </Animated.View>
          </Animated.View>
      </>
      {backend&&chat&&screen==='Chat'&&draftFocused&&!slashDismissed&&slashQuery!==null&&skillPopupHeight>=48&&!drawer&&!actions&&!orbit&&<SkillPicker key={scope} scope={scope} query={slashQuery}
        loadLibrary={()=>request('library','GET',undefined,backend)}
        bottom={Math.max(0,keyboardInset-insets.bottom)+composerHeight+6}
        maxHeight={skillPopupHeight}
        onDismiss={()=>setSlashDismissed(true)}
        onSelect={entry=>{setDraft(pickerRequest(entry));setSlashDismissed(true);}}
      />}
      {backend&&<NotesScreen key={backend.backendId} backendId={backend.backendId} request={(path,method,body)=>request(path,method,body,backend)} visible={screen==='Notes'} topInset={0}/>}
      {screen!=='Chat'&&screen!=='Notes'&&screen!=='Sessions'&&screen!=='Workstations'&&(
        <ScrollView testID="section-overlay" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" style={[StyleSheet.absoluteFill,{backgroundColor:colors.background,zIndex:25,bottom:Math.max(0,keyboardInset-insets.bottom)}]} showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.messages,{paddingTop:24,paddingHorizontal:20,paddingBottom:28,gap:18}]}>
          <Text accessibilityRole="header" style={sectionStyles.title}>{screen}</Text>
          {!!sectionError&&<View style={{gap:8}}><Text style={styles.caption}>{sectionError}</Text><Button label="Retry loading" onPress={()=>run(()=>openSection(screen))}/></View>}
          {screen === 'Todos' && <View>
            {(view?.docs['bob.todos']?.items ?? []).map((item: any, index: number) => <View key={index}>
              <Button label={`${item.done ? '✓' : '○'} ${item.text}`} onPress={() => run(async () => { const items = [...view!.docs['bob.todos'].items]; items[index] = { ...item, done: !item.done }; await request(`chats/${chat}/todos`, 'PUT', { items }); })} />
              <Button label={`Remove task ${index + 1}`} onPress={() => run(async () => { const items = view!.docs['bob.todos'].items.filter((_: unknown, i: number) => i !== index); await request(`chats/${chat}/todos`, 'PUT', { items }); })} />
            </View>)}
            <TextInput accessibilityLabel="New todo" style={styles.input} value={todoText} onChangeText={setTodoText} placeholder="Next task" placeholderTextColor={colors.muted} />
            <Button label="Add todo" disabled={!chat || !todoText.trim()} onPress={() => run(async () => { await request(`chats/${chat}/todos`, 'PUT', { items: [...(view?.docs['bob.todos']?.items ?? []), { text: todoText, done: false }] }); setTodoText(''); })} />
          </View>}
          {screen === 'Prompts' && (
            <>
              <Text style={styles.caption}>
                Backend default instructions (conversation overrides remain
                separate)
              </Text>
              <TextInput
                multiline
                style={styles.input}
                accessibilityLabel="Backend default instructions"
                value={instructions}
                onChangeText={setInstructions}
              />
              <Button
                label="Save instructions"
                onPress={() =>
                  run(async () => {
                    await request('library', 'PUT', {
                      instructions,
                      templates: library.templates,
                    });
                    setLibrary(await request('library'));
                  })
                }
              />
              <Text style={styles.title}>Message templates</Text>
              <TextInput accessibilityLabel="Template name" style={styles.input} value={templateName} onChangeText={setTemplateName} placeholder="Template name" placeholderTextColor={colors.muted} />
              <TextInput accessibilityLabel="Template message" style={styles.input} multiline value={templateText} onChangeText={setTemplateText} placeholder="Reusable message; separate from system instructions" placeholderTextColor={colors.muted} />
              <Button label="Save message template" onPress={() => run(async () => {
                if (!templateName.trim()) throw Error('Name the template');
                await request('library', 'PUT', { instructions: library.instructions, templates: { ...library.templates, [templateName]: templateText } });
                setLibrary(await request('library'));
              })} />
              {Object.entries(library?.templates ?? {}).map(([name, text]) => (
                <View key={name}>
                  <Button label={`Use template ${name}`} onPress={() => { setDraft(String(text)); setScreen('Chat'); }} />
                  <Button label={`Edit template ${name}`} onPress={() => { setTemplateName(name); setTemplateText(String(text)); }} />
                  <Button label={`Delete template ${name}`} onPress={() => run(async () => { const templates = { ...library.templates }; delete templates[name]; await request('library', 'PUT', { instructions: library.instructions, templates }); setLibrary(await request('library')); })} />
                </View>
              ))}
            </>
          )}
          {screen === 'Modules' && <>
            <Text style={styles.caption}>Native Durable capability selection for this conversation only. These trusted backend packages execute with the backend account's permissions; selection is not a sandbox. Stop and settle work before changing selection. Installation/removal and host defaults use bob module on the backend.</Text>
            {moduleList.map(module=><View key={module.id}>
              <Text style={styles.caption}>{module.packageName} {module.version} · Durable {module.durable}{'\n'}{module.installed?'Installed':'Not installed'} · {module.registered?'Registered':'Not registered'} · default {module.defaultSelected?'on':'off'}</Text>
              <Button label={`${module.selected?'Disable':'Enable'} module ${module.id}`} disabled={!module.installed||!module.registered} onPress={()=>run(async()=>{
                const b=backend,id=chat,current=scope;if(!b||!id)return;
                const ids=moduleList.filter(m=>m.id===module.id?!m.selected:m.selected).map(m=>m.id);
                await request(`chats/${id}/modules`,'PUT',{ids},b);
                const observed=ModuleInfo.array().parse(await request(`chats/${id}/modules`,'GET',undefined,b));
                if(identity.current===current)setModuleList(observed);
              })} />
            </View>)}
          </>}
          {screen === 'MCP Apps' && <>
            <Text style={styles.caption}>Explicit backend connections and tool grants. This is separate from phone pairing. MCP credentials are configured on the backend with bob mcp key; they never enter a surface.</Text>
            {mcpConnections.map(c=><View key={c.id}>
              <Button label={`${c.enabled?'Enabled':'Disabled'} MCP ${c.id}`} onPress={()=>{setMcpId(c.id);setMcpEndpoint(c.endpoint);setMcpTools(c.allowedTools.join(','));setMcpEnabled(c.enabled);}} />
              <Button label={`Remove MCP ${c.id}`} onPress={()=>Alert.alert('Remove connection?',`Remove ${c.id} and its stored backend credential? Existing app capabilities will no longer work.`,[{text:'Cancel',style:'cancel'},{text:'Remove',style:'destructive',onPress:()=>run(()=>changeMcp('DELETE',{id:c.id}))}])} />
            </View>)}
            <TextInput accessibilityLabel="MCP connection ID" style={styles.input} value={mcpId} onChangeText={setMcpId} placeholder="server-id" placeholderTextColor={colors.muted} />
            <TextInput accessibilityLabel="MCP endpoint" style={styles.input} value={mcpEndpoint} onChangeText={setMcpEndpoint} placeholder="https://server.example/mcp" placeholderTextColor={colors.muted} autoCapitalize="none" />
            <TextInput accessibilityLabel="Allowed MCP tools" style={styles.input} value={mcpTools} onChangeText={setMcpTools} placeholder="exact-tool-name,another-tool" placeholderTextColor={colors.muted} autoCapitalize="none" />
            <Button label={mcpEnabled?'Connection enabled — disable':'Connection disabled — enable'} onPress={()=>setMcpEnabled(!mcpEnabled)} />
            <Button label={mcpEnabled?'Grant listed MCP tools and save':'Save disabled MCP connection'} onPress={()=>run(()=>changeMcp('PUT',McpConnection.parse({id:mcpId,endpoint:mcpEndpoint,allowedTools:mcpTools.split(',').map(t=>t.trim()),enabled:mcpEnabled})))} />
            <Text style={styles.caption}>Visuals reopen with their saved HTML and latest saved data; MCP Apps show the original result snapshot. Reopening never reruns the original tool. Local inputs are transient; saved data and authorized tool results remain in conversation history.</Text>
          </>}
          {screen === 'Skills' && (
            <>
              <Text style={styles.caption}>
                Backend Markdown resources, not a regular-Pi loader.
              </Text>
              {Object.entries(library?.skills ?? {}).map(
                ([name, value]: [string, any]) => (
                  <Button
                    key={name}
                    label={`${value.enabled ? '✓' : '○'} ${name}`}
                    onPress={() => {
                      setSkillName(name);
                      setSkillText(value.markdown);
                      setSkillDescription(value.description);
                      setSkillEnabled(value.enabled);
                    }}
                  />
                ),
              )}
              <TextInput
                style={styles.input}
                accessibilityLabel="Skill name"
                value={skillName}
                onChangeText={setSkillName}
                placeholder="skill-name"
                placeholderTextColor={colors.muted}
              />
              <TextInput
                style={styles.input}
                accessibilityLabel="Skill Markdown"
                value={skillText}
                onChangeText={setSkillText}
                multiline
                placeholder="Markdown"
                placeholderTextColor={colors.muted}
              />
              <Button
                label="Save skill"
                onPress={() =>
                  run(async () => {
                    await request('skills', 'PUT', {
                      name: skillName,
                      description: skillDescription || skillName,
                      markdown: skillText,
                      enabled: skillEnabled,
                    });
                    setLibrary(await request('library'));
                  })
                }
              />
              <TextInput accessibilityLabel="Skill description" style={styles.input} value={skillDescription} onChangeText={setSkillDescription} placeholder="Skill description" placeholderTextColor={colors.muted} />
              <Button label={skillEnabled ? 'Skill enabled ✓' : 'Skill disabled'} onPress={() => setSkillEnabled(!skillEnabled)} />
              <Button label="Import Markdown skill (review before saving)" onPress={() => run(async () => setSkillText(await NativeModules.BobFiles.importMarkdown()))} />
              <Button label="Delete selected skill" disabled={!skillName} onPress={() => run(async () => { await request(`skills/${encodeURIComponent(skillName)}`, 'DELETE'); setLibrary(await request('library')); setSkillName(''); setSkillText(''); })} />
            </>
          )}
          {screen === 'Settings' && (
            <>
              {networkErrors.map((error,index)=><Text key={index} accessibilityLiveRegion="polite" style={styles.caption}>{error}</Text>)}
              <SettingsGroup title="Conversation">
                {chat&&<ConversationSettings key={scope} instructions={chatInstructions} folder={workingDirectory} inherited={usesDefaultInstructions} onInstructionsChange={setChatInstructions} onFolderChange={setWorkingDirectory} onLoad={loadConversationSettings} onSave={saveConversationSettings}/>}
                {!chat&&<Text style={[styles.caption,{paddingVertical:14}]}>Select a session to edit its settings.</Text>}
              </SettingsGroup>
              <SettingsGroup title="Notifications">
                <SettingsRow title="Reply notifications" label={notifyEnabled?'Last reply notifications: on':'Last reply notifications: off'} checked={notifyEnabled} icon={Bell} onPress={()=>run(async()=>{
                  if(!notifyEnabled&&Number(Platform.Version)>=33){const permission=await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);if(permission!==PermissionsAndroid.RESULTS.GRANTED)throw Error('Notification permission was not granted');}
                  const enabled=!notifyEnabled;NativeModules.BobNotifications.setReplyNotifications?.(enabled);await AsyncStorage.setItem('notification-opt-in',String(enabled));setNotifyEnabled(enabled);
                })}/>
                <SettingsRow title="Notification settings" label="Android notification settings" icon={Bell} onPress={()=>run(()=>NativeModules.BobNotifications.openSettings())}/>
                <Disclosure label="About notifications"><Text style={styles.caption}>Finished replies, questions and ready-to-install updates—not tool progress. Reply previews are silent by default. Android schedules background checks and may delay delivery; force-stop pauses them. Automatic location has its own visible service notification.</Text></Disclosure>
              </SettingsGroup>
              <SettingsGroup title="Voice">
                <SettingsRow title="Voice & speed" label="Android text-to-speech settings" icon={Volume2} onPress={()=>run(openSpeechSettings)}/>
                <Disclosure label="About read aloud"><Text style={styles.caption}>Use the speaker beside a reply. Selected text goes to your Android speech engine and an installed offline-capable voice. Reading stops when you leave Chat or background Bob. No automatic playback or audio export.</Text></Disclosure>
              </SettingsGroup>
              <SettingsGroup title="Location">
                <SettingsRow title="Automatic location" label={phoneLocation.busy?'Updating location…':phoneLocation.enabled?'Disable automatic location':'Enable automatic location'} checked={phoneLocation.enabled} loading={phoneLocation.busy} icon={MapPin} disabled={!backend||!phoneLocation.supported||phoneLocation.busy} onPress={()=>run(phoneLocation.toggle)}/>
                {!!phoneLocation.error&&<Text accessibilityLiveRegion="polite" style={styles.caption}>{phoneLocation.error}</Text>}
                <Disclosure label="Location privacy & permissions">
                  <Text style={styles.caption}>Fresh fixes for location questions, not continuous tracking. Coordinates go to your backend and model and stay in chat history. Background or locked-phone fixes need the visible Android service. Precise location and unrestricted battery use improve availability; reopen Bob if Android stops the service.</Text>
                  <SettingsRow title="Location permissions" label="Android location settings" icon={MapPin} onPress={()=>run(async()=>{await NativeModules.BobLocation?.openSettings('location');})}/>
                  <SettingsRow title="App & battery" label="Android app and battery settings" icon={SlidersHorizontal} onPress={()=>run(async()=>{await NativeModules.BobLocation?.openSettings('app');})}/>
                </Disclosure>
              </SettingsGroup>
              <SettingsGroup title="App">
                <SettingsRow title="Build & install" icon={Download} disabled={!backend} onPress={()=>{setUpdatesTarget(backend);navigate('Chat');}}/>
                <SettingsRow title="Copy app diagnostics" icon={Stethoscope} onPress={()=>run(async()=>{await copyAppDiagnostics();Alert.alert('Diagnostics copied','Paste the report into this chat. It contains sanitized lifecycle, exit and workload metadata, not chat text, credentials, URLs or location.');})}/>
                <Disclosure label="About diagnostics"><Text style={styles.caption}>If Bob closes unexpectedly, reopen it and copy this report. It includes bounded crash types and code positions, not exception messages or chat content. Workload samples are recorded about every 10 seconds while open. Reports stay on this phone until you share them.</Text></Disclosure>
              </SettingsGroup>
              <SettingsGroup title="Advanced">
                <SettingsRow title="Advanced modules" icon={Blocks} disabled={!chat} onPress={()=>run(()=>openSection('Modules'))}/>
              <Disclosure label="Provider connection">
              <Text style={styles.caption}>
                Credentials are sent only to the selected paired backend, never
                as chat messages.
              </Text>
              <TextInput
                secureTextEntry
                style={styles.input}
                accessibilityLabel="Provider API key"
                value={apiKey}
                onChangeText={setApiKey}
                placeholder={`${providerName} API key`}
                placeholderTextColor={colors.muted}
              />
              <TextInput
                style={styles.input}
                accessibilityLabel="Model ID"
                value={modelId}
                onChangeText={setModelId}
                placeholder="Model ID"
                placeholderTextColor={colors.muted}
              />
              <Button
                label="Configure backend provider"
                onPress={() =>
                  run(async () => {
                    await request('provider', 'PUT', {
                      provider: providerName,
                      key: apiKey,
                      modelId,
                    });
                    setApiKey('');
                  })
                }
              />
              <View style={styles.row}>{['openai','anthropic'].map(p=><Button key={p} label={p===providerName?`${p} ✓`:p} onPress={()=>setProviderName(p)}/>)}</View>
              </Disclosure>
              </SettingsGroup>
            </>
          )}
          {screen!=='Settings'&&<Button label="Back to settings" onPress={()=>run(()=>openSection('Settings'))}/> }
        </ScrollView>
      )}
      <Modal visible={actions} transparent animationType="none" onRequestClose={()=>setActions(false)}>
        <View style={styles.actionOverlay}>
          <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Dismiss chat actions" onPress={()=>setActions(false)}/>
          {!actionsMore?<PlusMenu bottom={Math.max(insets.bottom+12,keyboardInset+composerHeight+8)} maxHeight={Math.max(140,windowSize.height-Math.max(insets.bottom+12,keyboardInset+composerHeight+8)-insets.top-20)} disabled={!chat||!!pending} onCamera={()=>run(()=>openAttachments('camera'))} onGallery={()=>run(()=>openAttachments('gallery'))} onFiles={()=>run(()=>openAttachments('files'))} onModel={()=>{setActions(false);Keyboard.dismiss();run(openModelPicker);}} onMore={()=>{Keyboard.dismiss();setActionsMore(true);}}/>:<SafeAreaView edges={['bottom']} style={styles.actionSheet}>
            <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}><Text style={styles.title}>More actions</Text><IconButton icon={X} label="Close actions" onPress={()=>setActions(false)}/></View>
            <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text accessibilityLiveRegion="polite" style={styles.caption}>{backend?.name??'Workspace'} · {busy?'Working':status}</Text>
              <Disclosure label="Conversation history">
                <Button label={parentHistory.page?.next?'Load earlier messages':'Load / refresh stored history'} disabled={!chat||!parentHistory.ready||parentHistory.loading} onPress={()=>{setActions(false);run(parentHistory.load);}}/>
                <Button label="Jump to oldest loaded message" disabled={!chat} onPress={()=>{setActions(false);parentFollow.oldest();}}/>
                {parentHistory.page&&<Text style={styles.caption}>{parentHistory.page.items.length} stored entries loaded · {parentHistory.page.next?'more available':'end of last scan'}. Stored history is not unlimited model context.</Text>}
              </Disclosure>
              {busy&&<Button label="Steer Bob" disabled={!chat||!hasDraft||!!pending} onPress={()=>{setActions(false);run(()=>submit('steer'));}}/>}
              <Button label="Send on next" disabled={!chat||!hasDraft||!!pending} onPress={()=>{setActions(false);run(()=>submit('followUp'));}}/>
              <Button label="Build & install" disabled={!backend} onPress={()=>{setActions(false);setUpdatesTarget(backend);}}/>
              <Button label="Conversation settings" disabled={!chat} onPress={()=>{setActions(false);run(()=>openSection('Settings'));}}/>
              {busy&&<Button label="Stop Bob" onPress={()=>{setActions(false);run(()=>stop(false));}}/>}
              {agents.length>0&&<Button label="Agent history" onPress={()=>{setActions(false);setOrbit(true);}}/>}
              {(busy||activeAgents.length>0)&&<Button label="Stop Bob and subagents" onPress={()=>{setActions(false);run(()=>stop(true));}}/>}
            </ScrollView>
          </SafeAreaView>}
        </View>
      </Modal>
      {attachmentPicker&&attachmentPicker.scope===scope&&<AttachmentPicker key={attachmentPicker.scope} initialTab={attachmentPicker.tab} limit={attachmentPicker.limit} onClose={()=>setAttachmentPicker(undefined)} onAdd={files=>{
        const current=attachmentPicker.scope;
        setDraftAttachments(previous=>({...previous,[current]:[...(previous[current]??[]),...files]}));setAttachmentPicker(undefined);
      }}/>}
      {sectionLoading&&screen!=='Chat'&&screen!=='Settings'&&screen!=='Notes'&&<View testID="section-loading-overlay" style={[StyleSheet.absoluteFill,{backgroundColor:colors.background+'DD',alignItems:'center',justifyContent:'center',zIndex:40,gap:12}]}><ActivityIndicator color={colors.accent}/><Text style={styles.caption}>Loading {screen.toLowerCase()}…</Text></View>}
            <ModelPicker loading={modelLoading} visible={!!modelPickerTarget} models={models} current={modelChoice} onClose={()=>setModelPickerTarget(undefined)} onApply={applyModelChoice}/>
      {(screen==='Sessions'||screen==='Workstations')&&<SideDrawer key={screen+':'+(backend?.backendId??'')} embedded mode={screen==='Workstations'?'workstations':'sessions'} workspaceLabel={backend?.name} visible onClose={()=>setScreen('Chat')} disabled={!backend}
        onNew={()=>run(async()=>{await newChat();setDrawer(false);setScreen('Chat');})}
        onSettings={()=>run(()=>openSection('Settings'))}
        navigation={[]}
        workspaces={backends.map(b=>({id:b.backendId,label:backends.filter(item=>item.name===b.name).length>1?`${b.name} · ${b.backendId.slice(0,8)}`:b.name,selected:b.backendId===backend?.backendId,onPress:()=>{
          if(b.backendId!==backend?.backendId){setChats([]);setChatCursor(undefined);setBackend(b);setChat(undefined);}
          setScreen('Sessions');setDrawer(false);
        }}))}
        onSessionAction={sessionAction}
        conversations={chats.map(c=>({id:String(c.id),label:c.meta?.title||'Conversation',selected:c.id===chat,pinned:c.meta?.pinned,archived:c.meta?.archived,trashed:c.meta?.trashed,onPress:()=>{setChat(c.id);setScreen('Chat');setDrawer(false);}}))}
        loadMore={chatCursor?()=>run(async()=>{
          const b=backend;if(!b)return;
          const page=await request('chats?cursor='+encodeURIComponent(chatCursor),'GET',undefined,b);
          if(selectedBackend.current!==b.backendId)return;
          const items=Array.from(new Map<number,Chat>([...chats,...page.items].map((c:Chat)=>[c.id,c])).values()).sort((a,b)=>b.id-a.id);
          setChats(items);setChatCursor(page.next);await AsyncStorage.setItem(`chats:${b.backendId}`,JSON.stringify(items));
        }):undefined}
        pairing={<>
          <Text style={styles.caption}>Run bob connect on your computer.</Text>
          <Button label="Scan pairing QR" onPress={()=>run(async()=>{setPairing(await NativeModules.BobPlatform.scanPairing());})}/>
          <TextInput style={styles.input} multiline value={pairing} onChangeText={setPairing} accessibilityLabel="Pairing invitation" placeholder="Paste invitation" placeholderTextColor={colors.muted}/>
          <Button label="Pair this backend" onPress={()=>run(pair)}/>
        </>}
      />}
      <Modal
        visible={orbit}
        transparent
        animationType="none"
        onRequestClose={() => setOrbit(false)}
      >
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.title}>Subagents</Text>
            <Text style={styles.caption}>
              Closing this overlay never stops work.
            </Text>
            {agents.map(([name, a]) => (
              <Button
                key={name}
                label={`${name} · ${a.conversationId} · ${a.status??'unknown'}`}
                onPress={() => setChild(a.conversationId)}
              />
            ))}
            {!!child&&<Text accessibilityLiveRegion="polite" style={styles.caption}>{childStatus}</Text>}
            {child && transcript(childView,true)}
            <Button
              label="Collapse subagents"
              onPress={() => setOrbit(false)}
            />
          </View>
        </View>
      </Modal>
      </View>
      {keyboardInset<=0&&<BottomTabs selected={['Notes','Workstations','Chat','Sessions'].includes(screen)?screen:'Settings'} onSelect={navigate} onHeight={setBottomBarHeight}/>}
    </SafeAreaView>
  );
}
export default function App() {
  return (
    <DiagnosticBoundary><SafeAreaProvider>
      <Main />
    </SafeAreaProvider></DiagnosticBoundary>
  );
}
const styles = StyleSheet.create({
  welcome: {flexGrow:1,padding:24,gap:32,justifyContent:'space-between'},
  welcomeArt:{minHeight:240,flex:1,alignItems:'center',justifyContent:'center'},
  welcomeLogo:{width:'100%',maxWidth:400,aspectRatio:1},
  welcomeCopy:{gap:12,paddingBottom:12},
  welcomeTitle:{color:colors.foreground,fontSize:38,lineHeight:44,fontWeight:'600',letterSpacing:-1},
  welcomeSubtitle:{color:colors.muted,fontSize:16,lineHeight:24},
  welcomePrimary:{minHeight:58,borderRadius:29,backgroundColor:colors.accent,alignItems:'center',justifyContent:'center',marginTop:16},
  welcomePrimaryText:{color:colors.onAccent,fontSize:17,fontWeight:'600'},
  root:{flex:1,backgroundColor:colors.background},
  content:{flex:1,width:'100%',maxWidth:760,alignSelf:'center'},
  readingColumn:{width:'100%',maxWidth:760,alignSelf:'center',gap:10},
  title:{color:colors.foreground,fontSize:23,fontWeight:'600'},
  chatTitle:{color:colors.muted,fontSize:14,paddingHorizontal:24,paddingTop:18,paddingBottom:4},
  caption:{color:colors.muted,fontSize:13,lineHeight:20},
  status:{color:colors.muted,paddingHorizontal:24,paddingVertical:8,fontSize:14,lineHeight:21},
  button:{minHeight:48,height:'auto',paddingHorizontal:16,paddingVertical:12,borderRadius:14,marginVertical:4},
  buttonText:{color:colors.foreground,fontSize:15,textAlign:'center',flexShrink:1},
  messages:{paddingHorizontal:24,paddingTop:16,paddingBottom:80,gap:CHAT_CONTENT_GAP},
  bubble:{paddingVertical:0,marginBottom:0},
  userBubble:{backgroundColor:colors.surface,paddingHorizontal:16,paddingVertical:12,borderRadius:20,marginLeft:48,alignSelf:'flex-end',maxWidth:'88%'},
  kind:{color:colors.muted,fontSize:12,marginBottom:8},
  message:{color:colors.body,fontSize:18,lineHeight:28},
  empty:{padding:30,flex:1,justifyContent:'center',gap:20},
  hero:{fontSize:30,color:colors.foreground,fontWeight:'500'},
  composer:{paddingHorizontal:12,paddingTop:8,paddingBottom:12,backgroundColor:'transparent'},
  composerCompact:{paddingHorizontal:32,paddingBottom:28},
  composerCapsule:{padding:8,borderRadius:26,borderWidth:1,borderColor:colors.border,backgroundColor:colors.composer,gap:4},
  composerCapsuleCompact:{padding:0,gap:0},
  input:{color:colors.foreground,fontSize:16,padding:14,minHeight:50,maxHeight:180,borderRadius:14,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,marginVertical:6},
  row:{flexDirection:'row',gap:8,flexWrap:'wrap'},
  orbit:{position:'absolute',right:24,bottom:18,minHeight:48,borderRadius:24,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,flexDirection:'row',gap:8,paddingHorizontal:16,alignItems:'center',justifyContent:'center'},
  overlay:{flex:1,backgroundColor:'#00000088',padding:18,justifyContent:'center'},
  sheet:{height:'80%',width:'100%',maxWidth:760,alignSelf:'center',backgroundColor:colors.background,borderWidth:1,borderColor:colors.border,borderRadius:24,padding:20},
  actionOverlay:{flex:1,justifyContent:'flex-end',backgroundColor:'#00000088'},
  actionSheet:{maxHeight:'75%',backgroundColor:colors.background,borderTopLeftRadius:28,borderTopRightRadius:28,padding:24,gap:16},
});
