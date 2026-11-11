import {TerminalScreen} from './components/terminal-screen';
import {menuButtonChrome} from './menu-button-style';
import {recoverBackgroundOutbox,notificationReplyBarriers} from './recover-background-outbox';
import {SchedulesScreen,ScheduleReceipt,ScheduleAlert} from './components/schedules-screen';
import {Text,TextInput} from './components/app-text';
import {FileAttachment} from './components/file-attachment';
import {ImageAttachments} from './components/image-attachments';
import {imageAttachmentRows,type ImageAttachmentRow} from './image-attachment-rows';
import {emptyConversationMessage} from './empty-conversation';
import {readOnlyProfile,conversationProfileRecord,conversationReadOnlyMessage,useConversationProfile,type ChatProfile} from './retired-chat-profile';
import {DiagnosticCard,type DiagnosticRequest} from './components/diagnostic-card';
import {DiagnosticBoundary} from './components/diagnostic-boundary';
import {noteLoadedEntries} from './stream-diagnostics';
import {stopSpeech,openSpeechSettings} from './speech';
import 'react-native-get-random-values';
import './global.css';
import Animated from 'react-native-reanimated';
import {Button as KitButton} from './components/ui/button';
import {Text as KitText} from './components/ui/text';
import {Plus, ArrowUp, ArrowDown, Square, ChevronRight, ChevronDown, Paperclip, X} from 'lucide-react-native';
import {menuRadii,themed,useTheme,useThemedValue} from './theme';
import {ConversationSettingsDrafts} from './conversation-settings-draft';
import {surfaceAnchors} from './surface-placement';
import {replyOutputPlacement,replyOutputRows,withLiveResponse,type ReplyEntry} from './chat-replies';
import {ChatMotionProvider} from './chat-motion';
import {InlineSurface} from './components/inline-surface';
import {visualDisplayHeight} from './visual-display-capability';
import {ConversationSettings,type ConversationChange,type SavedConversationSettings} from './components/conversation-settings';
import {ThemeProvider} from './theme-provider';
import {AppearanceSettings} from './components/appearance-settings';
import {SettingsHome,SETTINGS_PAGES} from './components/settings-home';
import {SettingsGroup,SettingsRow,SectionHeading,SectionActions,SectionBody,RoundAction} from './components/section-ui';
import {Bell,Clock3,Volume2,MapPin,SlidersHorizontal,Download,Stethoscope,Blocks,Users,Settings as SettingsIcon} from 'lucide-react-native';
import {AgentsScreen} from './components/agents-screen';
import {type BottomDestination} from './components/bottom-tabs';
import {ChatNavigation} from './components/chat-navigation';
import {menuDestination} from './menu-navigation';
import {SideDrawer,type SessionAction} from './components/side-drawer';
import {useAgentOverview,type AgentSession,type OverviewAgent,type SessionFilter} from './use-agent-overview';
import {BuildCard} from './components/build-card';
import {LiveStatus} from './components/live-status';
import {HindsightActivity,AgentReportActivity,LearningActivity} from './components/passive-activity';
import {useBuildStatus} from './use-build-status';
import {MessageOutbox,visibleOutgoing,mergeOutgoing,outgoingAnchor,outgoingLabel,transcriptKey,type OutgoingMessage} from './message-outbox';
import {OutboxDelivery,requireDeliveryDevice} from './outbox-delivery';
import {BackgroundOutbox,type BackgroundPort} from './background-outbox';
import {responseData} from './network-policy';
import {QuestionCard,type Question} from './components/question-card';
import {NotesScreen} from './components/notes-screen';
import {DraftInput,composerTransition} from './components/draft-input';
import {SkillPicker} from './components/skill-picker';
import {skillQuery,pickerRequest} from './skill-picker';
import {ComposerStatus} from './components/composer-status';
import {composerActivity} from './composer-activity';
import {useBackNavigation} from './use-back-navigation';
import {usePhoneTools} from './phone-tools';
import {PhoneToolsSettings} from './components/phone-tools-settings';
import {useKeepConnected} from './keep-connected';
import {KeepConnectedSettings} from './components/keep-connected-settings';
import {useAppDiagnostics,copyAppDiagnostics} from './app-diagnostics';
import {useUpdateNotifications} from './use-update-notifications';
import {usePhoneLocation} from './use-phone-location';
import {ModelContent} from './components/model-content';
import {ChatBubble} from './components/chat-bubble';
import {PeerAdmission} from './components/peer-admission';
import {AttachmentPicker} from './components/attachment-picker';
import {PlusMenu} from './components/plus-menu';
import {AttachmentThumbnail,type DraftAttachment} from './components/attachment-thumbnail';
import {DrawingEditor} from './components/drawing-editor';
import {useScopedSnapshot} from './use-scoped-snapshot';
import {useChatFollow} from './use-chat-follow';
import {ModelPicker,type ModelChoice} from './components/model-picker';
import {linkToolResults} from './tool-results';
import {useTranscriptLiveTools} from './transcript-live-tools';
import {hasInlineChatContent,isRecordedToolGeneration,inputAttribution,isActiveSubagent,memoryStatusText,learningStatusText,compactMemoryStatuses,isCompactActivityEntry,chatEntryGap} from './chat-presentation';
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
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import {syncConnectedNetwork} from './connected-network';
import {reuseSnapshotEntries} from './snapshot-cache';
import {snapshotStream,type SnapshotStream,type SnapshotLifecycle} from './snapshot-stream';
import {useStoredHistory} from './stored-history';
import {readHistoryCache} from './history-cache';
import {snapshotPersistence} from './snapshot-persistence';
import {useKeyboardInset} from './keyboard-inset';
import { v4 as uuid } from 'uuid';
import { PairingInvitation, Message, Attachment, TransferLimits, InteractiveSummary, McpConnection, NativeWork, ModuleInfo } from '../../src/contracts';
type Backend = { backendId: string; endpoint: string; name: string };
type Entry = ImageAttachmentRow;
type Chat = { id: number; meta?: { title: string; pinned?:boolean;archived?:boolean;trashed?:boolean;profile?:ChatProfile }; owner?: {conversationId?:number;taskId?:number} };
// A list/metadata refresh may omit a historical immutable profile. Keep that
// evidence without retaining stale titles or other session metadata.
function preserveReadOnlyProfile(previous:Chat|undefined,current:Chat):Chat {
  const profile=conversationProfileRecord(previous?{profile:previous.meta?.profile}:undefined,{profile:current.meta?.profile})?.profile;
  return readOnlyProfile(profile)?{...current,meta:{...current.meta,title:current.meta?.title??previous?.meta?.title??'Conversation',profile}}:current;
}
function mergeChatRows(previous:Chat[],incoming:Chat[]):Chat[] {
  const rows=new Map(previous.map(row=>[row.id,row]));
  for(const row of incoming)rows.set(row.id,preserveReadOnlyProfile(rows.get(row.id),row));
  return Array.from(rows.values()).sort((a,b)=>b.id-a.id);
}
const snapshotLifecycle:SnapshotLifecycle={
 active:()=>AppState.currentState!=='background'&&AppState.currentState!=='inactive',
 subscribe:listener=>AppState.addEventListener('change',state=>listener(state==='active')),
};
type Snapshot = { entries: Entry[]; docs: Record<string, any>; work?:ReturnType<typeof NativeWork.parse>[] };
function Button({label,onPress,disabled=false,accessibilityLabel,menu=false}: {menu?:boolean;label:string;onPress:()=>void;disabled?:boolean;accessibilityLabel?:string}) {
 const styles=useThemedValue(stylesTheme);

  return <KitButton variant="secondary" accessibilityLabel={accessibilityLabel??label} accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={[styles.button,menu&&styles.menuButton]}><KitText style={[styles.buttonText,menu&&styles.menuButtonText]}>{label}</KitText></KitButton>;
}
function IconButton({icon:Icon,label,onPress,disabled=false,primary=false}:{icon:typeof Plus;label:string;onPress:()=>void;disabled?:boolean;primary?:boolean}) {
 const {colors}=useTheme();

 return <KitButton variant="ghost" size="icon" accessibilityLabel={label} accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={{width:48,height:48,borderRadius:24,backgroundColor:'transparent',opacity:disabled?0.4:1}}>{primary?<View pointerEvents="none" style={{width:32,height:32,borderRadius:16,backgroundColor:colors.accent,alignItems:'center',justifyContent:'center'}}><Icon size={Icon===Square?14:22} color={colors.onAccent} fill={Icon===Square?colors.onAccent:'none'} strokeWidth={2.6}/></View>:<Icon size={22} color={colors.foreground}/>}</KitButton>;
}
function Disclosure({label,children,menu=false}:{menu?:boolean;label:string;children:React.ReactNode}) {
 const {colors,shadows}=useTheme();

 const [open,setOpen]=useState(false);
 return <View><KitButton variant="ghost" accessibilityLabel={label} accessibilityState={{expanded:open}} onPress={()=>setOpen(!open)} style={[{minHeight:48,height:'auto',justifyContent:'flex-start',paddingHorizontal:0},menu&&menuButtonChrome({colors,shadows}).pill]}><KitText style={[{color:colors.muted,fontSize:13,flexShrink:1},menu&&menuButtonChrome({colors,shadows}).label]}>{label}</KitText>{open?<ChevronDown size={16} color={colors.muted}/>:<ChevronRight size={16} color={colors.muted}/>}</KitButton>{open&&children}</View>;
}
function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value))
    return value
      .map(v =>
        v?.type === 'text'
          ? v.text
          : v?.type === 'toolCall'
          ? `Tool: ${v.name}\n${JSON.stringify(v.arguments)}`
          : v?.type === 'thinking'
          ? ''
          : JSON.stringify(v),
      )
      .join('\n');
  return JSON.stringify(value);
}
function Main() {
 const {colors,scheme,shadows}=useTheme();
 const styles=useThemedValue(stylesTheme);

  useAppDiagnostics();
  const insets = useSafeAreaInsets();
  const windowSize = useWindowDimensions();
  const [visualWidth,setVisualWidth] = useState(0);
  const [updatesTarget,setUpdatesTarget]=useState<Backend>();
  const [sectionLoading,setSectionLoading]=useState(false),[sectionError,setSectionError]=useState(''),[modelLoading,setModelLoading]=useState(false);
  const sectionRequest=useRef(0);
  const [chatListBackend,setChatListBackend]=useState('');
  const [actionsMore,setActionsMore]=useState(false);
  const [attachmentPicker,setAttachmentPicker]=useState<{scope:string;tab:'gallery'|'files';limit:number}>();
  const [drawingEditor,setDrawingEditor]=useState(false);
  const keyboardInset = useKeyboardInset();
  const [composerHeight,setComposerHeight]=useState(84);
  const [composerRowHeight,setComposerRowHeight]=useState(50);
  const [backends, setBackends] = useState<Backend[]>([]),
    [backend, setBackend] = useState<Backend>(),
    [chat, setChat] = useState<number>(),
    [chats, setChats] = useState<Chat[]>([]),
    [chatCursor,setChatCursor]=useState<string>(),

    [draft, setDraft] = useState(''),
    [status, setStatus] = useState('Not paired'),
    [drawer, setDrawer] = useState(false),
    [navigationOpen,setNavigationOpen] = useState(false),
    [actions, setActions] = useState(false),
    [child, setChild] = useState<number>(),
    [agentTarget,setAgentTarget]=useState<{parentId:number;agent:OverviewAgent;title:string}>(),
    [childStatus,setChildStatus]=useState(''),
    [agentHistory,setAgentHistory]=useState(false),
    [sessionFilter,setSessionFilter]=useState<SessionFilter>('all'),
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
  const [settingsDrafts]=useState(()=>new ConversationSettingsDrafts());
  const sectionTrail=useRef<string[]>([]);
  const [outbox]=useState(()=>new MessageOutbox());
  const [backgroundOutbox]=useState(()=>NativeModules.BobOutbox?new BackgroundOutbox(NativeModules.BobOutbox as BackgroundPort,async id=>{const value=await Keychain.getGenericPassword({service:`bob.${id}`});return value?value.password:undefined;}):undefined);
  const [outgoing,setOutgoing]=useState(outbox.items),[outboxError,setOutboxError]=useState<string>();
  const [backgroundReady,setBackgroundReady]=useState<string[]>([]);
  useEffect(()=>{if(!backgroundOutbox)return;let current=true;setBackgroundReady([]);for(const b of backends)void backgroundOutbox.prepare(b.backendId).then(()=>{if(!current)return;if(backgroundOutbox.ready(b.backendId))setBackgroundReady(ids=>[...ids,b.backendId]);else if(selectedBackend.current===b.backendId)setStatus('Pair again: device credential missing');}).catch(()=>{if(current&&selectedBackend.current===b.backendId)setStatus('Pair again: device credential unavailable');});return()=>{current=false;};},[backgroundOutbox,backends]);
  const sendReady=!backgroundOutbox||backgroundReady.includes(backend?.backendId??'');
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
  const [draftFocused,setDraftFocused]=useState(false),[slashDismissed,setSlashDismissed]=useState(false);
  useEffect(()=>setSlashDismissed(false),[draft,backend?.backendId,chat]);
  const slashQuery=skillQuery(draft);
  const skillPopupHeight=Math.max(0,Math.min(320,windowSize.height-keyboardInset-insets.top-insets.bottom-composerHeight-16));
  const [draftAttachments,setDraftAttachments]=useState<Record<string,DraftAttachment[]>>({});
  useUpdateNotifications(backends,async backendId=>{
    await outbox.whenReady();
    if(NativeModules.BobOutbox?.setNotificationReplyBarriers)await NativeModules.BobOutbox.setNotificationReplyBarriers(backendId,notificationReplyBarriers(outbox.items,backendId));
  });
  const build=useBuildStatus(backend);
  const phoneLocation=usePhoneLocation(backend);
  const keepConnected=useKeepConnected(backend,chat,screen==='Connection');
  const selectedBackend = useRef('');
  selectedBackend.current = backend?.backendId ?? '';
  const identity = useRef(''),
    stream = useRef<SnapshotStream | null>(null),
    draftReady = useRef(false);
  const scope = backend && chat ? `${backend.backendId}:${chat}` : '';
  const draftVisit=useRef({scope});if(draftVisit.current.scope!==scope)draftVisit.current={scope};
  const currentDraftVisit=draftVisit.current;
  const [draftLoadedVisit,setDraftLoadedVisit]=useState<object>(),[pendingLoadedVisit,setPendingLoadedVisit]=useState<object>();
  const [draftError,setDraftError]=useScopedSnapshot<'load'|'save'>(scope);
  const [draftLoadAttempt,setDraftLoadAttempt]=useState(0);
  const draftWrites=useRef<Promise<void>>(Promise.resolve()),draftWriteVersion=useRef(0);
  const renderedDraftWriteVersion=draftWriteVersion.current;
  const composerReady=!!scope&&draftLoadedVisit===currentDraftVisit&&pendingLoadedVisit===currentDraftVisit;
  useEffect(()=>{void stopSpeech();return()=>{void stopSpeech();};},[scope,child,screen]);
  identity.current = scope;
  const [view,setView]=useScopedSnapshot<Snapshot>(scope),[childView,setChildView]=useScopedSnapshot<Snapshot>(`${scope}:child:${child}`);
  const listedChat=chatListBackend===backend?.backendId?chats.find(item=>item.id===chat):undefined;
  const knownProfile=conversationProfileRecord(
    view?.docs['bob.profile']!==undefined?{profile:view.docs['bob.profile']}:undefined,
    view?.docs['bob.chat']?{profile:view.docs['bob.chat'].profile}:undefined,
    listedChat?{profile:listedChat.meta?.profile}:undefined,
  );
  const conversationProfile=useConversationProfile(scope,knownProfile,()=>request(`chats/${chat}/configure`,'GET',undefined,backend));
  const readOnly=readOnlyProfile(conversationProfile.profile);
  const ordinaryChat=conversationProfile.known&&!readOnly;
  const readOnlyMessage=conversationReadOnlyMessage(conversationProfile.profile);
  const writableConversation=useRef({scope,ordinaryChat});writableConversation.current={scope,ordinaryChat};
  const canWriteConversation=(current=scope)=>writableConversation.current.scope===current&&writableConversation.current.ordinaryChat;
  const phoneTools=usePhoneTools({backend,chat:ordinaryChat?chat:undefined,requests:ordinaryChat?view?.docs['bob.phone-tools']?.requests:undefined,request});
  const attachments=draftAttachments[scope]??[];
  const hasDraft=!!draft.trim()||attachments.length>0;
  const latestDraft=useRef(draft);latestDraft.current=draft;
  const [modelPickerTarget,setModelPickerTarget]=useState<{backend:Backend;chat:number;scope:string}>();
  const [modelChoice,setModelChoice]=useState<ModelChoice>({});
  useEffect(()=>{setModelPickerTarget(undefined);setAttachmentPicker(undefined);setActions(false);setDrawingEditor(false);sectionTrail.current=[];},[scope]);
  useEffect(()=>{if(!ordinaryChat){setModelPickerTarget(undefined);setDrawingEditor(false);setAttachmentPicker(undefined);setActions(false);}},[ordinaryChat]);
  useEffect(()=>{if(!actions)setActionsMore(false);},[actions]);
  useEffect(()=>setNavigationOpen(false),[scope,screen]);
  useEffect(()=>{if(updatesTarget){if(selectedBackend.current!==updatesTarget.backendId)setChat(undefined);setBackend(updatesTarget);showChat();setDrawer(false);}},[updatesTarget]);
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
    if(navigationOpen){setNavigationOpen(false);return true;}
    if(actions){setActions(false);return true;}
    if(screen==='Agents'&&agentTarget){setChild(undefined);setAgentTarget(undefined);return true;}
    if(drawer){setDrawer(false);return true;}
    if(Keyboard.isVisible())return false;
    if(screen!=='Chat'){backSection();return true;}
    return false;
  });
  async function sessionAction(id:string,action:SessionAction,title?:string){
    const b=backend;if(!b)throw Error('Select a workspace');
    const patch=action==='rename'?{title}:action==='pin'?{pinned:true}:action==='unpin'?{pinned:false}:action==='archive'?{archived:true}:action==='unarchive'?{archived:false}:{trashed:false,archived:false};
    const result=await request(`chats/${id}${action==='delete'?'':'/metadata'}`,action==='delete'?'DELETE':'PUT',action==='delete'?undefined:patch,b);
    if(selectedBackend.current!==b.backendId)return;
    setChats(previous=>{const items=previous.map(item=>item.id===Number(id)?preserveReadOnlyProfile(item,{...item,meta:result.meta}):item);void AsyncStorage.setItem(`chats:${b.backendId}`,JSON.stringify(items)).catch(()=>{});return items;});
    if(action==='delete'&&chat===Number(id)){const next=chats.find(item=>item.id!==Number(id)&&!item.meta?.trashed&&!item.meta?.archived);setChat(next?.id);await AsyncStorage.setItem('selection',JSON.stringify({backendId:b.backendId,chat:next?.id}));}
  }
  async function request(
    path: string,
    method = 'GET',
    body?: unknown,
    b = backend,
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
      try{await NativeModules.BobNotifications.syncPushBackends?.(list.map(b=>b.backendId));}catch{/* A push scheduling failure must never block app hydration. */}
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
        setBackend(b);setChat(notice.conversationId);showChat();setDrawer(false);
      })().catch(()=>setStatus('Notification destination unavailable; open its conversation manually'));
    });
    return()=>listener.remove();
  },[]);
  useEffect(() => {
    if (!backend) return;
    setLibrary(undefined); setModels([]); setScreen(previous=>previous==='Workstations'||previous==='Agents'?previous:'Chat'); setSkillName(''); setSkillText(''); setApiKey(''); setModelId('');
    setMcpConnections([]); setMcpId(''); setMcpEndpoint(''); setMcpTools(''); setMcpEnabled(false);
    setStatus('Connecting');
    const b=backend;let cancelled=false;setChats([]);setChatListBackend(b.backendId);setChatCursor(undefined);
    void (async()=>{
      let cached:Chat[]=[];
      try{
        const parsed:unknown=JSON.parse(await AsyncStorage.getItem(`chats:${b.backendId}`)??'[]');
        if(Array.isArray(parsed)&&parsed.every(row=>{
          if(!row||typeof row!=='object'||!Number.isSafeInteger(row.id)||row.id<=0)return false;
          const {meta,owner}=row;
          const validMeta=meta===undefined||(
            meta&&typeof meta==='object'&&!Array.isArray(meta)&&typeof meta.title==='string'&&
            ['pinned','archived','trashed'].every(key=>meta[key]===undefined||typeof meta[key]==='boolean')
          );
          const validOwner=owner===undefined||(
            owner&&typeof owner==='object'&&!Array.isArray(owner)&&
            ['conversationId','taskId'].every(key=>owner[key]===undefined||(Number.isSafeInteger(owner[key])&&owner[key]>0))
          );
          // Profile evidence, including malformed restrictive markers, stays intact.
          return validMeta&&validOwner;
        }))cached=parsed;
      }catch{/* The chat list cache is optional; always try the authoritative load. */}
      if(cancelled||selectedBackend.current!==b.backendId)return;
      setChats(cached);
      try {
        const result=await request('chats','GET',undefined,b);
        if(cancelled||selectedBackend.current!==b.backendId)return;
        const items=mergeChatRows(cached,result.items);
        setChats(items);setChatCursor(result.next);if(!identity.current)setStatus('Ready · select a conversation');
        void AsyncStorage.setItem(`chats:${b.backendId}`,JSON.stringify(items)).catch(()=>{});
      }catch{if(!cancelled&&selectedBackend.current===b.backendId)setStatus('Offline • cached history');}
    })();
    return()=>{cancelled=true;};
  }, [backend?.backendId]);
  useEffect(() => {
    let cancelled=false,events:SnapshotStream|undefined,lastRaw:string|undefined;
    stream.current?.close();
    setView(undefined);
    setPending(undefined);setPendingLoadedVisit(undefined);
    setChild(undefined);setChildView(undefined);
    if (!backend || !chat) return;
    setStatus('Connecting…');
    const current = scope,
      b = backend;
    const cache=snapshotPersistence(`history:${current}`);
    const cacheLifecycle=AppState.addEventListener('change',state=>{if(state!=='active')void cache.flush();});
    void (async () => {
      const [cached, op] = await Promise.all([
        readHistoryCache(`history:${current}`),
        AsyncStorage.getItem(`pending:${current}`).catch(()=>null),
      ]);
      if (cancelled||identity.current !== current) return;
      if (cached) {
        try{const snapshot=JSON.parse(cached);if(Array.isArray(snapshot.entries)&&snapshot.docs&&typeof snapshot.docs==='object'){setView(snapshot);setStatus('Cached • reconnecting');}}catch{}
      }
      setPending(op ?? undefined);
      if(op)pendingOperations.current.set(current,op);else pendingOperations.current.delete(current);
      setPendingLoadedVisit(currentDraftVisit);
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
          cache.push(data.view,!data.view.docs?.['pi.live']?.run);
        },nextStatus=>{if(identity.current===current)setStatus(nextStatus);},()=>{void reconcilePending(b,chat,current).catch(()=>{});void historyLatest.current.refresh().catch(()=>{});void drainLatest.current(true,b.backendId);},snapshotLifecycle);
        events=es;
        if(cancelled||identity.current!==current){es.close();return;}
        stream.current=es;

      } catch {
        if (identity.current === current) setStatus('Offline • cached history');
      }
    })();
    return () => {cancelled=true;events?.close();cacheLifecycle.remove();void cache.close();};
  }, [scope]);
  useEffect(()=>{
    if(screen!=='Agents'||!child||!backend)return;
    setChildStatus('Connecting agent');
    const b=backend,current=scope,id=child;let cancelled=false,events:SnapshotStream|undefined,lastRaw:string|undefined,lastStatus='';
    const cache=snapshotPersistence(`history:${b.backendId}:${id}`);
    const cacheLifecycle=AppState.addEventListener('change',state=>{if(state!=='active')void cache.flush();});
    void (async()=>{
      try {
        const cached=await readHistoryCache(`history:${b.backendId}:${id}`);
        if(cancelled||identity.current!==current)return;
        if(cached){try{const snapshot=JSON.parse(cached);if(Array.isArray(snapshot.entries)&&snapshot.docs){setChildView(snapshot);setChildStatus('Cached child • reconnecting');}}catch{}}
        const credential=await Keychain.getGenericPassword({service:`bob.${b.backendId}`});if(!credential)throw Error('Missing credential');
        if(cancelled||identity.current!==current)return;
        events=snapshotStream(`${b.endpoint}/v1/chats/${id}/events`,{Authorization:'Bearer '+credential.password,'x-bob-backend':b.backendId},raw=>{
          if(cancelled||identity.current!==current)return;
          if(raw===lastRaw){setChildStatus(lastStatus);return;}
          const data=JSON.parse(raw);
          if(data.backendId!==b.backendId||data.conversationId!==id){events?.close();setChildStatus('Child identity mismatch');return;}
          const snapshot=data.view as Snapshot;setChildView(previous=>reuseSnapshotEntries(previous,snapshot));
          lastRaw=raw;lastStatus=snapshot.work?.some(t=>t.state==='blocked')?'Child blocked':snapshot.docs['pi.live']?.run||snapshot.work?.some(t=>!t.background)?'Child working':'Child idle';
          setChildStatus(lastStatus);
          cache.push(snapshot,!snapshot.docs['pi.live']?.run);
        },nextStatus=>{if(!cancelled&&identity.current===current)setChildStatus(nextStatus);},undefined,snapshotLifecycle);
      }catch{if(!cancelled&&identity.current===current)setChildStatus('Child offline • last cached state');}
    })();
    return()=>{cancelled=true;events?.close();cacheLifecycle.remove();void cache.close();};
  },[scope,child,screen]);
  // Draft storage is not an optional transcript cache: a failed read must not
  // expose a writable blank draft that can overwrite text we never recovered.
  useEffect(()=>{
    let cancelled=false;
    draftReady.current=false;setDraftLoadedVisit(undefined);setDraftError(undefined);setDraft('');
    if(!scope)return;
    const current=scope;
    void draftWrites.current.then(()=>AsyncStorage.getItem(`draft:${current}`)).then(saved=>{
      if(cancelled||identity.current!==current)return;
      setDraft(saved??'');draftReady.current=true;setDraftLoadedVisit(currentDraftVisit);
    }).catch(()=>{if(!cancelled&&identity.current===current)setDraftError('load');});
    return()=>{cancelled=true;};
  },[scope,draftLoadAttempt]);
  function persistDraft(current:string,value:string,expectedVersion?:number){
    // Fence admission, not just completion: an old Retry callback must not enqueue
    // captured text after newer edits or a return to the same scope (A→B→A).
    if(draftVisit.current!==currentDraftVisit||identity.current!==current||!draftReady.current||latestDraft.current!==value||(expectedVersion!==undefined&&expectedVersion!==draftWriteVersion.current))return Promise.resolve();
    const version=++draftWriteVersion.current;
    draftWrites.current=draftWrites.current.then(()=>AsyncStorage.setItem(`draft:${current}`,value)).then(()=>{
      if(draftVisit.current===currentDraftVisit&&draftWriteVersion.current===version)setDraftError(undefined);
    }).catch(()=>{
      if(draftVisit.current===currentDraftVisit&&draftWriteVersion.current===version)setDraftError('save');
    });
    return draftWrites.current;
  }
  useEffect(() => {
    if (scope && draftReady.current)void persistDraft(scope,draft);
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
  const pendingCreates=useRef(new Set<string>()),[creatingIds,setCreatingIds]=useState<ReadonlySet<string>>(new Set());
  async function newChat() {
    const b=backend;if(!b)throw Error('Select a backend');
    if(pendingCreates.current.has(b.backendId))return;
    pendingCreates.current.add(b.backendId);setCreatingIds(new Set(pendingCreates.current));
    try{
    const r = await request('chats', 'POST', { title: 'New conversation' },b);
    if(selectedBackend.current!==b.backendId)return;
    setChat(r.id);
    showChat();
    setDrawer(false);
    const result=await request('chats','GET',undefined,b);
    if(selectedBackend.current!==b.backendId)return;
    const items=mergeChatRows(chats,result.items);
    setChats(items);setChatCursor(result.next);await AsyncStorage.setItem(`chats:${b.backendId}`,JSON.stringify(items));
    }finally{pendingCreates.current.delete(b.backendId);setCreatingIds(new Set(pendingCreates.current));}
  }
  async function submit(mode: 'steer' | 'followUp',answer?:{questionId:string;text:string}) {
    if (!composerReady || !sendReady || !canWriteConversation() || !backend || !chat || (!answer&&!hasDraft) || pending || pendingOperations.current.has(scope)) return;
    if(answer&&(view?.docs['bob.questions']?.pending?.id!==answer.questionId||outbox.items.some(item=>item.scope===scope&&item.message.questionId===answer.questionId&&(!item.rejected||item.admitted))))return;
    parentFollow.resume();
    const current=scope,files=answer?[]:attachments,op=uuid();
    const foregroundOnly=files.length>0||outbox.items.some(item=>item.scope===current&&!item.rejected&&!item.admitted&&(item.files.length>0||item.foregroundOnly));
    const item:OutgoingMessage={id:op,scope:current,foregroundUnsent:!backgroundOutbox||foregroundOnly?true:undefined,foregroundOnly,backend,chat,createdAt:Date.now(),afterEntryId:Math.max(0,...(view?.entries??[]).map(entry=>entry.id),...(parentHistory.page?.items??[]).map(entry=>entry.id)),localId:Math.min(-Date.now(),...outbox.items.map(item=>item.localId-1)),files,
      message:Message.parse({requestId:op,...(answer?{questionId:answer.questionId}:{}),text:answer?.text??(draft.trim()?draft:'Please look at the attached file'+(files.length===1?'.':'s.')),mode,allowSubagents:true,
        ...(visualWidth>0?{display:{inline:{width:Math.floor(visualWidth),height:visualDisplayHeight(view?.docs?.['bob.display'])},fullscreen:{width:Math.max(1,Math.floor(windowSize.width-insets.left-insets.right)),height:Math.max(1,Math.floor(windowSize.height-insets.top-insets.bottom))}}}:{})})};
    // Publish the ordinary chat bubble and clear the composer before any await.
    const saved=outbox.add(item);
    // Dispatch to native before awaiting JS storage: locking may suspend JS immediately.
    const handedOff=backgroundOutbox?.enqueue(item);
    void handedOff?.catch(()=>{});
    Keyboard.dismiss();
    if(!answer){setDraft('');setDraftAttachments(previous=>({...previous,[current]:[]}));}
    try {await saved;void drainOutbox();}
    catch{/* Keep the local bubble and retry saving before any network send. */}
  }
  const transport=useRef({request,backends});transport.current={request,backends};
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
  async function addDrawing(dataUri:string){
    const current=scope,b=backend;if(!current||!b||!canWriteConversation())throw Error('Open a writable conversation before adding a drawing.');
    const transfer=TransferLimits.parse(await request('transfer-limits','GET',undefined,b));
    if(!canWriteConversation(current))throw Error('Conversation changed. Drawing was not attached.');
    const id=uuid(),name=`drawing-${id}.png`;
    const staged=await NativeModules.BobFiles.stageDataUri(id,dataUri,name,transfer.uploadLimit) as DraftAttachment;
    if(!canWriteConversation(current)){await NativeModules.BobFiles.removeAttachment(id).catch(()=>{});throw Error('Conversation changed. Drawing was not attached.');}
    setDraftAttachments(previous=>({...previous,[current]:[...(previous[current]??[]),{...staged,drawingData:dataUri}]}));
    setDrawingEditor(false);
  }
  async function openAttachments(tab:'gallery'|'files'|'camera') {
    const b=backend,current=scope;if(!b||!chat||pending||!canWriteConversation())return;
    setActions(false);Keyboard.dismiss();
    const limits=TransferLimits.parse(await request('transfer-limits','GET',undefined,b));
    if(!canWriteConversation(current))return;
    if(tab==='camera'){
      const file=await NativeModules.BobFiles.captureAttachment(limits.uploadLimit) as DraftAttachment|null;
      if(file&&canWriteConversation(current))setDraftAttachments(previous=>({...previous,[current]:[...(previous[current]??[]),file]}));
    }else setAttachmentPicker({scope:current,tab,limit:limits.uploadLimit});
  }
  async function attachmentAction(action: 'upload' | 'save' | 'preview', raw?: unknown) {
    const b = backend;
    if (!b || !chat) throw Error('Select a conversation');
    if(action==='upload'&&!canWriteConversation())return;
    const artifact = action === 'upload' ? undefined : Attachment.parse(raw);
    const destination = artifact?.conversationId ?? chat;
    const credential = await Keychain.getGenericPassword({ service: `bob.${b.backendId}` });
    if (!credential) throw Error('Pair again: device credential missing');
    const limits = TransferLimits.parse(await request('transfer-limits', 'GET', undefined, b));
    const url = `${b.endpoint}/v1/chats/${destination}/artifacts${artifact ? '/' + artifact.id : ''}`;
    if (action === 'upload') {
      const current=`${b.backendId}:${chat}`;
      if(!canWriteConversation(current))return;
      const selected=await NativeModules.BobFiles.chooseAttachment(limits.uploadLimit) as DraftAttachment|null;
      if(selected&&canWriteConversation(current))setDraftAttachments(previous=>({...previous,[current]:[...(previous[current]??[]),selected]}));
    } else if (action === 'save' && artifact) {
      await NativeModules.BobFiles.save(url, credential.password, b.backendId, artifact.name, artifact.mime, Math.max(limits.uploadLimit, artifact.size));
    } else if (artifact) {
      await NativeModules.BobFiles.preview(url, credential.password, b.backendId, artifact.mime, Math.max(limits.uploadLimit, artifact.size));
    }
  }
  useEffect(() => {
    const current = scope, b = backend;
    if (!b || !chat || !ordinaryChat) { setSurfaces([]);setSurfaceError(''); return; }
    let cancelled = false;
    void request(`chats/${chat}/ui`, 'GET', undefined, b).then(result => {
      if (cancelled || identity.current !== current) return;
      setSurfaces(InteractiveSummary.array().parse(result).map(value => ({ backendId:b.backendId, value })));
      setSurfaceError('');
    }).catch(() => { if (!cancelled && identity.current === current) setSurfaceError('Interactive surfaces unavailable while disconnected'); });
    return () => { cancelled = true; };
  }, [scope, view?.entries.length,ordinaryChat]);
  async function openSurface(item: {backendId:string; value:ReturnType<typeof InteractiveSummary.parse>}) {
    const b = backend;
    if(!canWriteConversation())return;
    if (!b || b.backendId !== item.backendId) throw Error('Interactive surface belongs to another backend');
    const credential = await Keychain.getGenericPassword({service:`bob.${b.backendId}`});
    if (!credential) throw Error('Pair again');
    await NativeModules.BobInteractive.open(b.endpoint, b.backendId, credential.password, item.value.conversationId, item.value.id);
  }
  async function stop(tree: boolean) {
    if(!canWriteConversation())return;
    const current = scope;
    setStatus('Stop requested • stopping');
    await request(`chats/${chat}/stop`, 'POST', {
      scope: tree ? 'tree' : 'root',
    });
    if (identity.current === current) setStatus('Stop settled');
  }
  async function openModelPicker(){
    const b=backend,id=chat,current=scope;if(!b||!id)throw Error('Open a conversation first');
    if(!canWriteConversation())throw Error('This conversation is read-only.');
    setActions(false);setModelLoading(true);setModelPickerTarget({backend:b,chat:id,scope:current});
    try{const [listed,configured]=await Promise.all([request('models','GET',undefined,b),request(`chats/${id}/configure`,'GET',undefined,b)]);
    if(!canWriteConversation(current))return;setModels(listed);setModelChoice({model:configured.model,thinkingLevel:configured.thinkingLevel});}
    finally{if(identity.current===current)setModelLoading(false);}
  }
  async function applyModelChoice(choice:Required<ModelChoice>){
    const target=modelPickerTarget;if(!target||!canWriteConversation(target.scope))throw Error('Conversation changed; reopen model selection');
    await request(`chats/${target.chat}/configure`,'PUT',choice,target.backend);
    const observed=await request(`chats/${target.chat}/configure`,'GET',undefined,target.backend);
    if(observed.model?.provider!==choice.model.provider||observed.model?.modelId!==choice.model.modelId||observed.thinkingLevel!==choice.thinkingLevel)throw Error('Selection could not be confirmed; reopen to check');
    if(identity.current!==target.scope)return;
    setModelChoice({model:observed.model,thinkingLevel:observed.thinkingLevel});setModelPickerTarget(undefined);
  }
  function showChat(){setNavigationOpen(false);sectionTrail.current=[];sectionRequest.current++;setSectionLoading(false);setScreen('Chat');}
  function navigate(tab:BottomDestination){
    if(tab==='Sessions')tab='Agents';
    setNavigationOpen(false);
    if(screen===tab)return;
    Keyboard.dismiss();setActions(false);setDrawer(false);sectionTrail.current=[];
    if(tab==='Settings'||tab==='Notes'){run(()=>openSection(tab,false));return;}
    sectionRequest.current++;setSectionLoading(false);setScreen(tab);
  }
  const agentOverview=useAgentOverview(backend,screen==='Agents',(path,signal)=>request(path,'GET',undefined,backend,signal),sessionFilter);
  function backSection(){
    Keyboard.dismiss();
    const parent=sectionTrail.current.pop()??(screen==='Modules'?'Settings':'Chat');
    run(()=>openSection(parent,false));
  }
  async function openSection(name: string,remember=true) {
    if(remember&&name!==screen)sectionTrail.current.push(screen);
    const selected = backend?.backendId;
    const current = scope;
    const ticket=++sectionRequest.current;setSectionError('');setSectionLoading(name!=='Settings'&&name!=='Notes'&&name!=='Schedules'&&!SETTINGS_PAGES.includes(name));
    setScreen(name);setDrawer(false);
    try{
    if(name==='Modules') {
      if(!canWriteConversation())throw Error('Modules are unavailable in this conversation.');
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
    if(!b||!id||!canWriteConversation(current))throw Error('Conversation settings are unavailable or fixed for this chat.');
    const configured=await request(`chats/${id}/configure`,'GET',undefined,b);
    if(identity.current!==current||sectionRequest.current!==ticket)throw Error('Conversation changed. Reopen settings.');
    if(typeof configured?.cwd!=='string'||!(configured.instructions===null||typeof configured.instructions==='string'))throw Error('Could not load conversation settings. Try again.');
    const draft=settingsDrafts.view(current,configured);
    setChatInstructions(draft.instructions??'');setUsesDefaultInstructions(configured.instructions===null);setWorkingDirectory(draft.cwd);
    return {instructions:configured.instructions,cwd:configured.cwd};
  }
  async function saveConversationSettings(change:ConversationChange):Promise<SavedConversationSettings>{
    const b=backend,id=chat,current=scope,ticket=sectionRequest.current;
    if(!b||!id||!canWriteConversation(current))throw Error('Conversation settings are unavailable or fixed for this chat.');
    const submittedDraft=settingsDrafts.capture(current);
    await request(`chats/${id}/configure`,'PUT',change,b);
    const observed=await request(`chats/${id}/configure`,'GET',undefined,b);
    if(typeof observed?.cwd!=='string'||!(observed.instructions===null||typeof observed.instructions==='string'))throw Error('Save could not be confirmed. Reopen settings to check before retrying.');
    if(('instructions' in change&&(observed.instructions??null)!==change.instructions)||('cwd' in change&&observed.cwd!==change.cwd))throw Error('Save could not be confirmed. Reopen settings to check before retrying.');
    settingsDrafts.acknowledge(current,'instructions' in change?'instructions':'cwd',submittedDraft);
    if(identity.current!==current)throw Error('Conversation changed. Reopen settings to check the save.');
    if(sectionRequest.current!==ticket)return {instructions:observed.instructions,cwd:observed.cwd};
    // Saving one field must not erase an unsaved edit in the other field.
    const draft=settingsDrafts.view(current,observed);
    if('instructions' in change){setChatInstructions(draft.instructions??'');setUsesDefaultInstructions(observed.instructions==null);}
    if('cwd' in change)setWorkingDirectory(draft.cwd);
    return {instructions:observed.instructions??null,cwd:observed.cwd??''};
  }
  async function changeMcp(method:'PUT'|'DELETE',value:unknown) {
    const b=backend;if(!b)throw Error('Select a backend');
    await request('mcp-connections',method,value,b);
    const entries=McpConnection.array().parse(await request('mcp-connections','GET',undefined,b));
    if(selectedBackend.current===b.backendId)setMcpConnections(entries);
  }
  const agents = Object.entries(ordinaryChat?view?.docs['app.subagents']?.agents??{}:{}) as [
    string,
    { conversationId: number; status?:string },
  ][];
  const activeAgents=agents.filter(([,agent])=>isActiveSubagent(agent.status));
  // Only the overview establishes parent/child membership. A live registry may
  // supply newer statuses, but must not reintroduce missing or wrong-parent IDs.
  const agentSessions:AgentSession[]=agentOverview.sessions.map(session=>{
    if(session.conversationId!==chat||!ordinaryChat||status!=='Connected')return session;
    return {...session,agents:session.agents.map(agent=>{
      const live=agents.find(([name,item])=>name===agent.name&&item.conversationId===agent.conversationId)?.[1];
      return live&&(live.status==='working'||live.status==='stopping'||live.status==='idle')?{...agent,status:live.status}:agent;
    })};
  });
  const displayedChild=agentTarget&&child===agentTarget.agent.conversationId?child:undefined;
  useEffect(()=>{setChild(undefined);setAgentTarget(undefined);setAgentHistory(false);},[scope]);
  useEffect(()=>{if(screen!=='Agents'){setChild(undefined);setAgentTarget(undefined);setAgentHistory(false);}},[screen]);
  const busy = !!view?.docs['pi.live']?.run || !!view?.work?.some(t=>t.kind==='bob.mcp-ui-action'&&!t.background);
  const showStop=busy&&!hasDraft;
  const waitingForAnswer=!!view?.docs['bob.questions']?.pending&&!outgoing.some(item=>item.scope===scope&&item.message.questionId===view.docs['bob.questions'].pending.id&&(!item.rejected||item.admitted));
  const activity=composerActivity({connection:status,hasConversation:!!chat,storageError:!!outboxError,sending:outgoing.some(item=>item.scope===scope&&!item.rejected&&!item.admitted),waitingForAnswer,live:view?.docs['pi.live'],work:view?.work});
  const parentLiveTools=useTranscriptLiveTools(view?.docs['pi.live']),childLiveTools=useTranscriptLiveTools(childView?.docs['pi.live']);
  const linkedTranscript=(snapshot:Snapshot|undefined,page:typeof parentHistory.page,liveTools:ReturnType<typeof useTranscriptLiveTools>)=>{
    const entries=page?Array.from(new Map([...(page.items as Entry[]),...(snapshot?.entries??[])].map(entry=>[entry.id,entry])).values()).sort((a,b)=>a.id-b.id):snapshot?.entries??[];
    const linked=linkToolResults(entries,liveTools),anchors=surfaceAnchors(entries,liveTools),placement=replyOutputPlacement(entries,anchors),surfaceEntries=new Set(placement.surfaces.values());
    return {...linked,rawEntries:entries,historyWindows:[page?.items??[],snapshot?.entries??[]],entries:compactMemoryStatuses((linked.entries as Entry[]).filter(entry=>entry.kind!=='pi.system'&&(hasInlineChatContent(entry)||surfaceEntries.has(entry.id)))).reverse(),surfaceAnchors:placement.surfaces,originalSurfaceAnchors:anchors,replyFiles:placement.files};
  };
  const parentLinked=useMemo(()=>{
    const linked=linkedTranscript(view,parentHistory.page,parentLiveTools);
    const merged=mergeOutgoing(linked.entries,outgoing,scope,item=>({id:item.localId,kind:'bob.user',data:{text:item.message.text,requestId:item.id,localDelivery:outgoingLabel(item),deliveryError:item.rejected?item.lastError:undefined}}));
    return {...linked,entries:merged};
  },[view?.entries,parentLiveTools,parentHistory.page,outgoing,scope]);
  useEffect(()=>{
    const entries=[...(parentHistory.page?.items??[]),...(view?.entries??[])];
    for(const item of outgoing){
      if(item.scope!==scope)continue;
      if(!visibleOutgoing([item],scope,entries).length)void(async()=>{await backgroundOutbox?.remove(item.id);await outbox.remove(item.id);})().catch(()=>{});
      else if(item.afterEntryId===undefined&&entries.length)void outbox.update(item.id,{afterEntryId:outgoingAnchor(item,entries)}).catch(()=>{});
    }
  },[outgoing,scope,view?.entries,parentHistory.page,outbox]);
  const childLinked=useMemo(()=>linkedTranscript(childView,childHistory.page,childLiveTools),[childView?.entries,childLiveTools,childHistory.page]);
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
  const parentImageRows=useRef<{scope:string;rows:readonly ImageAttachmentRow[]}|undefined>(undefined),childImageRows=useRef<{scope:string;rows:readonly ImageAttachmentRow[]}|undefined>(undefined);
  const parentImageScope=JSON.stringify([scope,backend?.endpoint]),childImageScope=JSON.stringify([backend?.backendId,backend?.endpoint,displayedChild]);
  const parentOutputEntries=useMemo(()=>imageAttachmentRows(replyOutputRows([...parentLinked.entries].reverse(),parentLinked.replyFiles,[...positionedSurfaces].flatMap(([at,items])=>items.map(item=>({id:item.value.id,at,source:parentLinked.originalSurfaceAnchors.get(item.value.id.toLowerCase())??at}))),scope),parentLinked.rawEntries,parentLinked.replyFiles,parentLinked.historyWindows,parentImageRows.current?.scope===parentImageScope?parentImageRows.current.rows:undefined).reverse(),[parentLinked,positionedSurfaces,scope,parentImageScope]);
  const childOutputEntries=useMemo(()=>imageAttachmentRows(replyOutputRows([...childLinked.entries].reverse(),childLinked.replyFiles),childLinked.rawEntries,childLinked.replyFiles,childLinked.historyWindows,childImageRows.current?.scope===childImageScope?childImageRows.current.rows:undefined).reverse(),[childLinked,childImageScope]);
  useEffect(()=>{parentImageRows.current={scope:parentImageScope,rows:parentOutputEntries};},[parentImageScope,parentOutputEntries]);
  useEffect(()=>{childImageRows.current={scope:childImageScope,rows:childOutputEntries};},[childImageScope,childOutputEntries]);
  const inlineSurfaceById=useMemo(()=>new Map([...positionedSurfaces.values()].flat().map(item=>[item.value.id,item])),[positionedSurfaces]);
  // Legacy/unloaded anchors stay reachable without becoming a permanent row
  // beneath every new reply in the inverted chat list.
  const unlinkedSurfaces=surfaces.filter(item=>item.backendId===backend?.backendId&&item.value.conversationId===chat&&!parentLinked.surfaceAnchors.has(item.value.id.toLowerCase()));
  function transcript(v?: Snapshot,isChild=false,footerClearance=0) {
    const history=!isChild?parentHistory:childHistory,stored=history.page;
    const follow=!isChild?parentFollow:childFollow;
    const recorded=isChild?childLinked:parentLinked,output=isChild?childOutputEntries:parentOutputEntries;
    // Attach the changing generation after stable history/output/image work.
    // Native generation identity and legacy fallback still use the full live doc.
    const live=withLiveResponse([...output].reverse(),recorded.rawEntries,v?.docs['pi.live']);
    const linked={...recorded,entries:live.entries.reverse() as ImageAttachmentRow[],legacyLive:live.legacyLive};
    // Native separators know only their leading item. Resolve the adjacent pair
    // from the actual inverted display order, without regrouping recorded rows.
    const entryGaps=new Map(linked.entries.map((entry,index)=>{
      const next=linked.entries[index+1];
      const surfaceBoundary=!!entry.inlineSurfaceId||!!next?.inlineSurfaceId;
      return [entry.id,surfaceBoundary?CHAT_CONTENT_GAP:chatEntryGap(entry,next)];
    }));
    return (
      <ChatMotionProvider active={isChild?screen==='Agents':screen==='Chat'&&!navigationOpen&&!actions&&!drawingEditor}>
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
        keyExtractor={item=>item.displayKey??transcriptKey(item)}
        contentContainerStyle={[styles.messages,{gap:0},!isChild?{paddingTop:16,paddingBottom:16}:{paddingTop:footerClearance+16}]}
        ItemSeparatorComponent={({leadingItem}:{leadingItem?:Entry})=><View testID="chat-entry-separator" style={{height:leadingItem?entryGaps.get(leadingItem.id)??CHAT_CONTENT_GAP:CHAT_CONTENT_GAP}}/>}
        ListHeaderComponentStyle={{paddingBottom:CHAT_CONTENT_GAP}}
        ListFooterComponentStyle={{paddingTop:CHAT_CONTENT_GAP}}
        ListFooterComponent={<View style={{gap:12}}>
          {stored?.next&&<Button label={history.loading?'Loading history…':'Load earlier messages'} disabled={history.loading} onPress={()=>{follow.pause();run(history.load);}}/>}
          {!!history.error&&<View style={{gap:8}}><Text accessibilityLiveRegion="polite" style={styles.caption}>Couldn’t load stored history: {history.error}</Text><Button label="Retry loading history" disabled={history.loading} onPress={()=>run(history.refresh)}/></View>}
        </View>}
        ListEmptyComponent={linked.rawEntries.length?undefined:<View style={{paddingVertical:24,gap:12}}>
          {isChild&&!!emptyConversationMessage(history)&&<Text accessibilityLiveRegion="polite" style={styles.caption}>{emptyConversationMessage(history)}</Text>}
        </View>}
        scrollIndicatorInsets={{top:0,bottom:isChild?footerClearance:0}}

        ListHeaderComponent={<View style={{gap:CHAT_CONTENT_GAP}} onLayout={event=>{if(!isChild)setVisualWidth(event.nativeEvent.layout.width);}}>
          {!isChild && !!surfaceError && <Text style={styles.caption}>{surfaceError}</Text>}
          <LiveStatus live={v?.docs['pi.live']} showProgress={isChild}/>
          {/* Native generation rows retain their list identity when committed.
              Older servers without a task identity keep the bounded legacy slot. */}
          {linked.legacyLive && v?.docs['pi.live']?.generation?.message && <ModelContent bubbleText streaming speakable={false} showTools={false} value={v.docs['pi.live'].generation.message.content} results={linked.results}/>}
          {!isChild&&backend&&<BuildCard key={backend.backendId} backend={backend} state={build.state} error={build.error} focus={updatesTarget?.backendId===backend.backendId} onDismiss={()=>setUpdatesTarget(undefined)} onRefresh={build.refresh}/>}
          {!isChild&&((v?.docs['bob.diagnostics']?.requests??[]) as DiagnosticRequest[]).filter(item=>['pending','approved'].includes(item.status)).map(item=><DiagnosticCard key={`${scope}:${item.id}`} request={item} respond={value=>request(`chats/${chat}/diagnostics`,'POST',value,backend!)}/>)}
          {!isChild&&waitingForAnswer&&v?.docs['bob.questions']?.pending&&<QuestionCard key={`${scope}:${v.docs['bob.questions'].pending.id}`} question={v.docs['bob.questions'].pending as Question} disabled={!ordinaryChat||!!pending} onAnswer={text=>submit('steer',{questionId:v.docs['bob.questions'].pending.id,text})}/>}
          {/* Inverted header is the physical bottom of the chat. Keep live
              replies and the composer clearance here, below stored messages. */}
          {!isChild&&<View pointerEvents="none" accessible={false} style={{height:composerHeight+8}}/>}
        </View>}
        renderItem={({ item }) => {
          if(item.inlineSurfaceId){const surface=inlineSurfaceById.get(item.inlineSurfaceId);return surface&&backend?<View testID={`surface-entry-${item.inlineSurfaceId}`}><InlineSurface backend={backend} surface={surface.value} onExpand={()=>run(()=>openSurface(surface))}/></View>:null;}
          const attribution=inputAttribution(item),user=attribution.owner;
          const memoryStatus=memoryStatusText(item),learningStatus=learningStatusText(item);
          const peerAdmission=item.kind==='bob.peer-admission';
          const artifact=(item.kind==='bob.artifact'||item.kind==='bob.file')&&Attachment.safeParse(item.data).success;
          const imageGroup=artifact?item.imageAttachments:undefined;
          const fallback=()=>textOf(item.data)||'Stored event has no displayable text.';
          const originalText=item.kind==='bob.user'&&item.data&&typeof item.data==='object'&&'text' in item.data&&typeof item.data.text==='string'?item.data.text:undefined;
          const scheduleReceipt=item.kind==='bob.schedule-receipt',scheduleAlert=item.kind==='bob.schedule-alert';
          const scheduleId=scheduleReceipt?(item.data as {id?:string}|undefined)?.id:undefined;
          const body=scheduleReceipt?<ScheduleReceipt job={scheduleId?v?.docs['bob.schedules']?.[scheduleId]:undefined} onOpen={()=>run(()=>openSection('Schedules'))}/>:scheduleAlert?<ScheduleAlert data={item.data} onOpen={()=>run(()=>openSection('Schedules'))}/>:originalText!==undefined?<Text selectable style={styles.message}>{originalText}</Text>:peerAdmission?<PeerAdmission data={item.data} peerName={backends.find(b=>b.backendId===(item.data as {peerId?:string}|undefined)?.peerId)?.name}/>:imageGroup&&backend?<ImageAttachments backend={backend} artifacts={imageGroup} active={isChild?screen==='Agents':screen==='Chat'&&!navigationOpen&&!actions&&!drawingEditor} fromBob={item.kind==='bob.file'} onOpen={image=>run(()=>attachmentAction('preview',image))} onSave={image=>run(()=>attachmentAction('save',image))}/>:artifact&&backend?<FileAttachment backend={backend} artifact={Attachment.parse(item.data)} active={isChild?screen==='Agents':screen==='Chat'&&!navigationOpen&&!actions} fromBob={item.kind==='bob.file'} onOpen={()=>run(()=>attachmentAction('preview',item.data))} onSave={()=>run(()=>attachmentAction('save',item.data))}/>:item.model?.length?<View style={{gap:isCompactActivityEntry(item)?0:CHAT_CONTENT_GAP}}>{item.model.map((m,i)=>m.role==='toolResult'?<ToolContent quiet key={m.toolCallId??i} name={m.toolName??'Result'} content="Arguments are outside the loaded history." result={(m.toolCallId?linked.results.get(m.toolCallId):undefined)??{content:m.content,status:m.isError?'failed':'done',isError:m.isError}}/>:<ModelContent bubbleText={m.role==='assistant'} speakable={m.role==='assistant'&&!item.liveResponse} streaming={!!item.liveResponse} showTools={!item.liveResponse} quietTools key={i} value={m.content} results={linked.results}/>)}</View>:<Text selectable style={styles.message}>{fallback()}</Text>;
          const delivery=item.id<0?(item.data as {localDelivery?:string}|undefined)?.localDelivery:item.kind==='bob.user'&&(item.data as {requestId?:string}|undefined)?.requestId?'Sent':undefined;
          const failed=item.id<0?outgoing.find(value=>value.localId===item.id&&value.rejected):undefined;
          const assistant=item.kind==='pi.assistant'||item.model?.some(m=>m.role==='assistant');
          return <View testID={`history-entry-${item.id}`}>{memoryStatus!==undefined?<HindsightActivity entry={item}/>:learningStatus!==undefined?<LearningActivity entry={item}/>:item.kind==='bob.subagent-report'?<AgentReportActivity entry={item}>{body}</AgentReportActivity>:hasInlineChatContent(item)&&<ChatBubble style={imageGroup?{width:'100%'}:undefined} variant={user?'owner':artifact&&item.kind==='bob.artifact'?'upload':'activity'}>{user||assistant||artifact||peerAdmission||scheduleReceipt||scheduleAlert?body:<Disclosure label={attribution.label??item.kind.replace(/^(pi|bob)\./,'').replaceAll('-',' ')}>{body}</Disclosure>}{delivery&&<Text accessibilityLiveRegion={item.id<0?'polite':'none'} style={{color:colors.bubbleMuted,fontSize:11,lineHeight:18,minHeight:18,marginTop:6,alignSelf:'flex-end'}}>{delivery}</Text>}{failed&&<View style={{gap:4}}>{!!failed.lastError&&<Text style={{color:colors.bubbleMuted,fontSize:12,lineHeight:19}}>{failed.lastError}</Text>}<Button disabled={!ordinaryChat} label={failed.admitted||failed.uncertain?"Check delivery":"Retry sending"} onPress={()=>run(async()=>{if(!canWriteConversation())return;if(!failed.foregroundUnsent&&!failed.foregroundDeviceId)await backgroundOutbox?.enqueue(failed,true);await outbox.update(failed.id,{rejected:false,attempts:0,retryAt:undefined,retryAfterAt:undefined,lastError:undefined});await drainLatest.current(true,failed.backend.backendId);})}/></View>}</ChatBubble>}
          </View>;
        }}
      />
      {isChild&&follow.showJump&&<Pressable accessibilityRole="button" accessibilityLabel="Scroll to latest child message" onPress={follow.resume} style={{position:'absolute',bottom:footerClearance+16,right:20,width:48,height:48,borderRadius:24,alignItems:'center',justifyContent:'center',backgroundColor:colors.surface,borderColor:colors.border,borderWidth:1}}><ArrowDown size={22} color={colors.foreground}/></Pressable>}
      </View>
      </ChatMotionProvider>
    );
  }
  // Root sections keep navigation in the same heading slot as Chat.
  const sectionMenu=screen!=='Chat'?<ChatNavigation framedTrigger selected={menuDestination(screen,sectionTrail.current)} open={navigationOpen} onOpen={()=>{Keyboard.dismiss();setActions(false);setNavigationOpen(true);}} onClose={()=>setNavigationOpen(false)} onSelect={navigate} activeAgentCount={activeAgents.length} readOnly={!!chat&&!ordinaryChat}/>:undefined;
  if (backends.length === 0) return (
    <SafeAreaView edges={Platform.OS==='android'?['left','right','bottom']:undefined} style={styles.root}>
      {Platform.OS!=='android'&&<StatusBar hidden barStyle={colors.background==='#000000'?'light-content':'dark-content'} />}
      <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.welcome} keyboardShouldPersistTaps="handled">
        <View style={styles.welcomeArt}>
          <Image accessibilityLabel="Bob logo" accessibilityRole="image" source={scheme==='light'?require('./assets/bob-wordmark.png'):require('./assets/bob-logo.png')} resizeMode="contain" style={[styles.welcomeLogo,scheme==='light'&&{tintColor:colors.foreground}]}/>
        </View>
        <View style={styles.welcomeCopy}>
          <Text style={styles.welcomeTitle}>Your agents,{'\n'}anywhere.</Text>
          <Text style={styles.welcomeSubtitle}>Connect to Bob on your computer.</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Scan QR code" style={styles.welcomePrimary} onPress={()=>run(async()=>{const invitation=await NativeModules.BobPlatform.scanPairing();if(invitation)await pair(invitation);})}>
            <Text style={styles.welcomePrimaryText}>Scan QR code</Text>
          </Pressable>
          <Button menu label={welcomeHelp?'Where is the QR code? −':'Where is the QR code? +'} onPress={()=>setWelcomeHelp(!welcomeHelp)}/>
          {welcomeHelp&&<Text style={styles.welcomeSubtitle}>Run bob connect on your computer. Keep Tailscale connected on both devices, then scan the QR code.</Text>}
          <Button menu label={welcomeManual?'Hide manual pairing':'Paste pairing invitation'} onPress={()=>setWelcomeManual(!welcomeManual)}/>
          {welcomeManual&&<><TextInput accessibilityLabel="Pairing invitation" style={styles.input} placeholder="Paste invitation" placeholderTextColor={colors.muted} value={pairing} onChangeText={setPairing} multiline autoCapitalize="none"/><Button menu label="Connect" disabled={!pairing.trim()} onPress={()=>run(()=>pair())}/></>}
          {status!=='Not paired'&&<Text accessibilityLiveRegion="polite" style={styles.caption}>{status}</Text>}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
  return (
    <SafeAreaView edges={Platform.OS==='android'?['left','right','bottom']:undefined} style={styles.root}>
      <View testID="rounded-app-surface" style={[styles.content,{backgroundColor:colors.background,overflow:'hidden',paddingBottom:Math.max(0,keyboardInset-insets.bottom)}]}>
      {Platform.OS!=='android'&&<StatusBar hidden barStyle={colors.background==='#000000'?'light-content':'dark-content'} />}
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
                  {backend?'Choose a conversation from Agents and Sessions or start a new one.':'Pair your backend to begin. Your machine owns the work.'}
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
            {parentFollow.showJump&&<Pressable accessibilityRole="button" accessibilityLabel="Scroll to latest message" onPress={parentFollow.resume} style={{position:'absolute',bottom:composerHeight+12,left:'50%',marginLeft:-24,width:48,height:48,borderRadius:24,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,alignItems:'center',justifyContent:'center',zIndex:30,...shadows.floating}}><ArrowDown size={23} color={colors.foreground}/></Pressable>}

          </View>
          <Animated.View layout={composerTransition} testID="chat-composer" pointerEvents={screen==='Chat'?'box-none':'none'} accessibilityElementsHidden={screen!=='Chat'} importantForAccessibility={screen==='Chat'?'auto':'no-hide-descendants'} onLayout={event=>{const height=event.nativeEvent.layout.height;if(Number.isFinite(height)&&height>0)setComposerHeight(previous=>Math.abs(previous-height)>.5?height:previous);}} style={[styles.composer,keyboardInset<=0&&styles.composerCompact,{opacity:screen==='Chat'?1:0,position:'absolute',left:0,right:0,bottom:Math.max(0,keyboardInset-insets.bottom),zIndex:20}]}>
            <View testID="composer-heading" style={styles.composerHeading}>
              <View style={{flex:1,minWidth:0}}>{!composerReady&&chat&&!draftError?<View testID="chat-opening" accessible accessibilityRole="progressbar" accessibilityLabel="Opening conversation" accessibilityState={{busy:true}} style={{minHeight:34,paddingBottom:11,alignItems:'center',justifyContent:'center'}}><ActivityIndicator size="small" color={colors.muted}/></View>:(((activity.phase!=='idle'&&activity.phase!=='connecting')||parentLinked.rawEntries.length>0)&&(
            <ComposerStatus animate={activity.animate&&screen==='Chat'} text={activity.text}/>
            ))}{draftError&&<View style={{gap:4}}><Text accessibilityLiveRegion="polite" style={styles.caption}>{draftError==='load'?'Saved draft could not be loaded. It has not been overwritten.':'Draft could not be saved. Keep this conversation open and retry.'}</Text><Button label={draftError==='load'?'Retry loading draft':'Retry saving draft'} onPress={()=>{if(draftVisit.current!==currentDraftVisit)return;if(draftError==='load'){if(!draftReady.current)setDraftLoadAttempt(value=>value+1);}else if(composerReady)void persistDraft(scope,draft,renderedDraftWriteVersion);}}/></View>}{readOnly&&<Text testID="read-only-conversation" style={styles.caption}>{readOnlyMessage}</Text>}{!!chat&&!conversationProfile.known&&<Text style={styles.caption}>{conversationProfile.error??'Checking conversation capabilities…'}</Text>}</View>
              <ChatNavigation showTrigger={screen==='Chat'} open={navigationOpen&&screen==='Chat'} onOpen={()=>{Keyboard.dismiss();setActions(false);setNavigationOpen(true);}} onClose={()=>setNavigationOpen(false)} onSelect={navigate} activeAgentCount={activeAgents.length} readOnly={!!chat&&!ordinaryChat}/>
            </View>
            <View testID="composer-row" onLayout={event=>{const height=event.nativeEvent.layout.height;if(Number.isFinite(height)&&height>0)setComposerRowHeight(previous=>Math.abs(previous-height)>.5?height:previous);}} style={styles.composerRow}>
            <Animated.View layout={composerTransition} style={[styles.composerCapsule,keyboardInset<=0&&styles.composerCapsuleCompact]}>
              {attachments.length>0&&<ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{gap:10,padding:12}} style={{maxHeight:136}}>
                {attachments.map(file=><AttachmentThumbnail key={file.id} name={file.name} mime={file.mime} source={file.drawingData?{uri:file.drawingData}:{uri:file.uri}} onOpen={file.drawingData&&ordinaryChat?()=>{setDrawingEditor(true);}:undefined} disabled={!ordinaryChat||!!pending} onRemove={()=>{
                  const current=scope;
                  setDraftAttachments(previous=>({...previous,[current]:(previous[current]??[]).filter(item=>item.id!==file.id)}));
                  void NativeModules.BobFiles.removeAttachment(file.id).catch(()=>{});
                }}/>) }
              </ScrollView>}
              <DraftInput scope={scope} editable={composerReady&&ordinaryChat} onFocusChange={setDraftFocused} value={draft} onChangeText={setDraft} compact={keyboardInset<=0}
                maxHeight={Math.max(48,Math.min(156,windowSize.height-keyboardInset-insets.top-insets.bottom-48-48-40-(attachments.length?136:0)))}
                leading={<IconButton icon={Plus} label="Chat actions" disabled={!composerReady||!ordinaryChat} onPress={()=>{if(!canWriteConversation())return;setActionsMore(false);setActions(true);}}/>}
                trailing={<IconButton icon={showStop?Square:ArrowUp} label={showStop?'Stop Bob':'Send message'} primary disabled={!composerReady||!ordinaryChat||(!showStop&&(!sendReady||!hasDraft||!!pending))} onPress={()=>run(()=>showStop?stop(false):submit('steer'))}/>}
              />
            </Animated.View>

            </View>
          </Animated.View>
      </>
      <DrawingEditor visible={drawingEditor&&screen==='Chat'} onCancel={()=>setDrawingEditor(false)} onAdd={addDrawing}/>
      {backend&&chat&&ordinaryChat&&screen==='Chat'&&draftFocused&&!slashDismissed&&slashQuery!==null&&skillPopupHeight>=48&&!drawer&&!actions&&!navigationOpen&&<SkillPicker key={scope} scope={scope} query={slashQuery}
        loadLibrary={()=>request('library','GET',undefined,backend)}
        bottom={Math.max(0,keyboardInset-insets.bottom)+composerHeight+6}
        maxHeight={skillPopupHeight}
        onDismiss={()=>setSlashDismissed(true)}
        onSelect={entry=>{setDraft(pickerRequest(entry));setSlashDismissed(true);}}
      />}
      {<AgentsScreen menu={screen==='Agents'?sectionMenu:undefined} key={'agents:'+String(backend?.backendId)} visible={screen==='Agents'&&!!backend} bottomInset={Math.max(0,keyboardInset-insets.bottom)} workstation={backend?.name} sessions={agentSessions} currentSessionId={chat} selected={agentTarget} onSelect={(parentId,id)=>{const session=agentSessions.find(item=>item.conversationId===parentId),agent=session?.agents.find(item=>item.conversationId===id);if(session&&agent){Keyboard.dismiss();setAgentTarget({parentId,agent,title:session.title});setChild(id);}}} onOpenSession={id=>{Keyboard.dismiss();setChat(id);showChat();}} onBack={()=>{setChild(undefined);setAgentTarget(undefined);}} history={agentHistory} onHistoryChange={setAgentHistory} onNew={()=>run(newChat)} newBusy={!!backend&&creatingIds.has(backend.backendId)} filter={sessionFilter} onFilterChange={setSessionFilter} onSessionAction={async(id,action,title)=>{await sessionAction(id,action,title);agentOverview.retry();}} onSchedules={()=>{Keyboard.dismiss();run(()=>openSection('Schedules'));}} status={childStatus} loading={agentOverview.loading} error={agentOverview.error} onRetry={agentOverview.retry} hasMore={!!agentOverview.next} onLoadMore={agentOverview.loadMore}>{clearance=>displayedChild&&transcript(childView,true,clearance)}</AgentsScreen>}
      <TerminalScreen menuOpen={navigationOpen} menu={screen==='Terminal'?sectionMenu:undefined} key={'terminal:'+scope} visible={screen==='Terminal'} bottomInset={Math.max(0,keyboardInset-insets.bottom)} target={backend&&chat?{backendId:backend.backendId,conversationId:chat,title:listedChat?.meta?.title??'Current conversation'}:undefined} workstation={backend?.name} allowed={ordinaryChat&&!listedChat?.meta?.trashed&&!listedChat?.owner} onBack={backSection} request={(path,method,body,signal)=>request(path,method,body,backend,signal)}/>
      {backend&&<NotesScreen menu={screen==='Notes'?sectionMenu:undefined} key={backend.backendId} backendId={backend.backendId} request={(path,method,body)=>request(path,method,body,backend)} visible={screen==='Notes'} topInset={0}/>}
      {backend&&<SchedulesScreen menu={screen==='Schedules'?sectionMenu:undefined} key={'schedules:'+backend.backendId} visible={screen==='Schedules'} onBack={backSection} request={(path,method,body,signal)=>request(path,method,body,backend,signal)} onCompose={text=>{setDraft(previous=>previous.trim()?`${previous}\n\n${text}`:text);showChat();}} onOpenChat={id=>{setChat(id);showChat();}}/>}
      {screen!=='Terminal'&&screen!=='Schedules'&&screen!=='Chat'&&screen!=='Notes'&&screen!=='Workstations'&&screen!=='Agents'&&(
        <View testID="section-overlay" style={[StyleSheet.absoluteFill,{backgroundColor:colors.background,zIndex:25,bottom:Math.max(0,keyboardInset-insets.bottom)}]}>
          <SectionHeading title={screen}/>
          <SectionBody footer={<SectionActions overlay menu={sectionMenu} onBack={screen!=='Settings'||sectionTrail.current.length>0?backSection:undefined}/>}>{clearance=>
          <ScrollView testID="section-body" style={{flex:1}} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.messages,{paddingTop:16,paddingHorizontal:16,paddingBottom:clearance+24,gap:16}]}>

          {sectionLoading?<View testID="section-loading-overlay" style={{minHeight:160,alignItems:'center',justifyContent:'center',gap:12}}><ActivityIndicator color={colors.accent}/><Text typography="ui" style={styles.caption}>Loading {screen.toLowerCase()}…</Text></View>:<>
          {!!sectionError&&<View style={{gap:8}}><Text typography="ui" style={styles.caption}>{sectionError}</Text><Button menu label="Retry loading" onPress={()=>run(()=>openSection(screen))}/></View>}
          {screen === 'Todos' && <View>
            {(view?.docs['bob.todos']?.items ?? []).map((item: any, index: number) => <View key={index}>
              <Button menu label={`${item.done ? '✓' : '○'} ${item.text}`} onPress={() => run(async () => { const items = [...view!.docs['bob.todos'].items]; items[index] = { ...item, done: !item.done }; await request(`chats/${chat}/todos`, 'PUT', { items }); })} />
              <Button menu label={`Remove task ${index + 1}`} onPress={() => run(async () => { const items = view!.docs['bob.todos'].items.filter((_: unknown, i: number) => i !== index); await request(`chats/${chat}/todos`, 'PUT', { items }); })} />
            </View>)}
            <TextInput typography="ui" accessibilityLabel="New todo" style={styles.input} value={todoText} onChangeText={setTodoText} placeholder="Next task" placeholderTextColor={colors.muted} />
            <Button menu label="Add todo" disabled={!chat || !todoText.trim()} onPress={() => run(async () => { await request(`chats/${chat}/todos`, 'PUT', { items: [...(view?.docs['bob.todos']?.items ?? []), { text: todoText, done: false }] }); setTodoText(''); })} />
          </View>}
          {screen === 'Prompts' && (
            <>
              <Text typography="ui" style={styles.caption}>
                Backend default instructions (conversation overrides remain
                separate)
              </Text>
              <TextInput
                typography="ui"
                multiline
                style={styles.input}
                accessibilityLabel="Backend default instructions"
                value={instructions}
                onChangeText={setInstructions}
              />
              <Button menu
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
              <Text typography="ui" style={styles.title}>Message templates</Text>
              <TextInput typography="ui" accessibilityLabel="Template name" style={styles.input} value={templateName} onChangeText={setTemplateName} placeholder="Template name" placeholderTextColor={colors.muted} />
              <TextInput typography="ui" accessibilityLabel="Template message" style={styles.input} multiline value={templateText} onChangeText={setTemplateText} placeholder="Reusable message; separate from system instructions" placeholderTextColor={colors.muted} />
              <Button menu label="Save message template" onPress={() => run(async () => {
                if (!templateName.trim()) throw Error('Name the template');
                await request('library', 'PUT', { instructions: library.instructions, templates: { ...library.templates, [templateName]: templateText } });
                setLibrary(await request('library'));
              })} />
              {Object.entries(library?.templates ?? {}).map(([name, text]) => (
                <View key={name}>
                  <Button menu label={`Use template ${name}`} onPress={() => { setDraft(String(text)); showChat(); }} />
                  <Button menu label={`Edit template ${name}`} onPress={() => { setTemplateName(name); setTemplateText(String(text)); }} />
                  <Button menu label={`Delete template ${name}`} onPress={() => run(async () => { const templates = { ...library.templates }; delete templates[name]; await request('library', 'PUT', { instructions: library.instructions, templates }); setLibrary(await request('library')); })} />
                </View>
              ))}
            </>
          )}
          {screen === 'Modules' && <>
            <Text typography="ui" style={styles.caption}>Native Durable capability selection for this conversation only. These trusted backend packages execute with the backend account's permissions; selection is not a sandbox. Stop and settle work before changing selection. Installation/removal and host defaults use bob module on the backend.</Text>
            {moduleList.map(module=><SettingsRow key={module.id} icon={Blocks} title={module.id} checked={module.selected??false} value={`${module.packageName} ${module.version} · Durable ${module.durable} · ${module.installed?'Installed':'Not installed'} · ${module.registered?'Registered':'Not registered'} · default ${module.defaultSelected?'on':'off'}`} label={`${module.selected?'Disable':'Enable'} module ${module.id}`} disabled={!module.installed||!module.registered} onPress={()=>run(async()=>{
                const b=backend,id=chat,current=scope;if(!b||!id)return;
                const ids=moduleList.filter(m=>m.id===module.id?!m.selected:m.selected).map(m=>m.id);
                await request(`chats/${id}/modules`,'PUT',{ids},b);
                const observed=ModuleInfo.array().parse(await request(`chats/${id}/modules`,'GET',undefined,b));
                if(identity.current===current)setModuleList(observed);
              })} />)}
          </>}
          {screen === 'MCP Apps' && <>
            <Text typography="ui" style={styles.caption}>Explicit backend connections and tool grants. This is separate from phone pairing. MCP credentials are configured on the backend with bob mcp key; they never enter a surface.</Text>
            {mcpConnections.map(c=><View key={c.id}>
              <Button menu label={`${c.enabled?'Enabled':'Disabled'} MCP ${c.id}`} onPress={()=>{setMcpId(c.id);setMcpEndpoint(c.endpoint);setMcpTools(c.allowedTools.join(','));setMcpEnabled(c.enabled);}} />
              <Button menu label={`Remove MCP ${c.id}`} onPress={()=>Alert.alert('Remove connection?',`Remove ${c.id} and its stored backend credential? Existing app capabilities will no longer work.`,[{text:'Cancel',style:'cancel'},{text:'Remove',style:'destructive',onPress:()=>run(()=>changeMcp('DELETE',{id:c.id}))}])} />
            </View>)}
            <TextInput typography="ui" accessibilityLabel="MCP connection ID" style={styles.input} value={mcpId} onChangeText={setMcpId} placeholder="server-id" placeholderTextColor={colors.muted} />
            <TextInput typography="ui" accessibilityLabel="MCP endpoint" style={styles.input} value={mcpEndpoint} onChangeText={setMcpEndpoint} placeholder="https://server.example/mcp" placeholderTextColor={colors.muted} autoCapitalize="none" />
            <TextInput typography="ui" accessibilityLabel="Allowed MCP tools" style={styles.input} value={mcpTools} onChangeText={setMcpTools} placeholder="exact-tool-name,another-tool" placeholderTextColor={colors.muted} autoCapitalize="none" />
            <Button menu label={mcpEnabled?'Connection enabled — disable':'Connection disabled — enable'} onPress={()=>setMcpEnabled(!mcpEnabled)} />
            <Button menu label={mcpEnabled?'Grant listed MCP tools and save':'Save disabled MCP connection'} onPress={()=>run(()=>changeMcp('PUT',McpConnection.parse({id:mcpId,endpoint:mcpEndpoint,allowedTools:mcpTools.split(',').map(t=>t.trim()),enabled:mcpEnabled})))} />
            <Text typography="ui" style={styles.caption}>Visuals reopen with their saved HTML and latest saved data; MCP Apps show the original result snapshot. Reopening never reruns the original tool. Local inputs are transient; saved data and authorized tool results remain in conversation history.</Text>
          </>}
          {screen === 'Skills' && (
            <>
              <Text typography="ui" style={styles.caption}>
                Backend Markdown resources, not a regular-Pi loader.
              </Text>
              {Object.entries(library?.skills ?? {}).map(
                ([name, value]: [string, any]) => (
                  <Button menu
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
                typography="ui"
                style={styles.input}
                accessibilityLabel="Skill name"
                value={skillName}
                onChangeText={setSkillName}
                placeholder="skill-name"
                placeholderTextColor={colors.muted}
              />
              <TextInput
                typography="ui"
                style={styles.input}
                accessibilityLabel="Skill Markdown"
                value={skillText}
                onChangeText={setSkillText}
                multiline
                placeholder="Markdown"
                placeholderTextColor={colors.muted}
              />
              <TextInput typography="ui" accessibilityLabel="Skill description" style={styles.input} value={skillDescription} onChangeText={setSkillDescription} placeholder="Skill description" placeholderTextColor={colors.muted} />
              <Button menu label={skillEnabled ? 'Skill enabled ✓' : 'Skill disabled'} onPress={() => setSkillEnabled(!skillEnabled)} />
              <Button menu
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
              <Button menu label="Import Markdown skill (review before saving)" onPress={() => run(async () => setSkillText(await NativeModules.BobFiles.importMarkdown()))} />
              <Button menu label="Delete selected skill" disabled={!skillName} onPress={() => run(async () => { await request(`skills/${encodeURIComponent(skillName)}`, 'DELETE'); setLibrary(await request('library')); setSkillName(''); setSkillText(''); })} />
            </>
          )}
          {screen === 'Settings' && <>
            {networkErrors.map((error,index)=><Text typography="ui" key={index} accessibilityLiveRegion="polite" style={styles.caption}>{error}</Text>)}
            {readOnly&&<Text typography="ui" style={styles.caption}>{readOnlyMessage}</Text>}
            <SettingsHome readOnly={readOnly} onOpen={name=>run(()=>openSection(name))}/>
          </>}
          {screen === 'Appearance' && <>
<AppearanceSettings/>
          </>}
          {screen === 'Conversation settings' && <>
<SettingsGroup title="This conversation">
                <Text typography="ui" style={[styles.caption,{paddingVertical:8}]}>{chats.find(item=>item.id===chat)?.meta?.title??'No conversation selected'} · {backend?.name??'No workstation'}</Text>
                {readOnly&&<Text typography="ui" style={styles.caption}>{readOnlyMessage}</Text>}
                {!!chat&&!conversationProfile.known&&<Text typography="ui" style={styles.caption}>{conversationProfile.error??'Checking conversation capabilities…'}</Text>}
                {chat&&ordinaryChat&&<ConversationSettings standalone key={scope} instructions={chatInstructions} folder={workingDirectory} inherited={usesDefaultInstructions} onInstructionsChange={value=>{settingsDrafts.edit(scope,'instructions',value);setChatInstructions(value);}} onFolderChange={value=>{settingsDrafts.edit(scope,'cwd',value);setWorkingDirectory(value);}} onLoad={loadConversationSettings} onSave={saveConversationSettings}/>}
                {!chat&&<Text typography="ui" style={[styles.caption,{paddingVertical:14}]}>Select a session to edit its settings.</Text>}
              </SettingsGroup>
          </>}
          {screen === 'Notifications' && <>
<SettingsGroup title="Notifications">
                <SettingsRow title="Reply notifications" label={notifyEnabled?'Last reply notifications: on':'Last reply notifications: off'} checked={notifyEnabled} icon={Bell} onPress={()=>run(async()=>{
                  if(!notifyEnabled&&Number(Platform.Version)>=33){const permission=await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);if(permission!==PermissionsAndroid.RESULTS.GRANTED)throw Error('Notification permission was not granted');}
                  const enabled=!notifyEnabled;NativeModules.BobNotifications.setReplyNotifications?.(enabled);await AsyncStorage.setItem('notification-opt-in',String(enabled));setNotifyEnabled(enabled);
                })}/>
                <SettingsRow title="Notification settings" label="Android notification settings" icon={Bell} onPress={()=>run(()=>NativeModules.BobNotifications.openSettings())}/>
                <Disclosure menu label="About notifications"><Text typography="ui" style={styles.caption}>Replies, questions and schedule alerts, plus updates, share one generic attention alert without message previews or Reply actions. Tap it to open Bob. Existing reply input and delivery feedback stay separate until resolved. Android schedules background checks and may delay delivery; push delivery can also be delayed, and force-stop pauses both. Automatic location has its own visible service notification. Keep connected has a separate opt-in service notification.</Text></Disclosure>
              </SettingsGroup>
          </>}
          {screen === 'Voice' && <>
<SettingsGroup title="Voice">
                <SettingsRow title="Voice & speed" label="Android text-to-speech settings" icon={Volume2} onPress={()=>run(openSpeechSettings)}/>
                <Disclosure menu label="About read aloud"><Text typography="ui" style={styles.caption}>Use the speaker beside a reply. Selected text goes to your Android speech engine and an installed offline-capable voice. Reading stops when you leave Chat or background Bob. No automatic playback or audio export.</Text></Disclosure>
              </SettingsGroup>
          </>}
          {screen === 'Phone & location' && <>
{!readOnly&&<PhoneToolsSettings state={phoneTools}/>}
              {!readOnly&&<SettingsGroup title="Location">
                <SettingsRow title="Automatic location" label={phoneLocation.busy?'Updating location…':phoneLocation.enabled?'Disable automatic location':'Enable automatic location'} checked={phoneLocation.enabled} loading={phoneLocation.busy} icon={MapPin} disabled={!backend||!phoneLocation.supported||phoneLocation.busy} onPress={()=>run(phoneLocation.toggle)}/>
                {!!phoneLocation.error&&<Text typography="ui" accessibilityLiveRegion="polite" style={styles.caption}>{phoneLocation.error}</Text>}
                <Disclosure menu label="Location privacy & permissions">
                  <Text typography="ui" style={styles.caption}>Fresh fixes for location questions, not continuous tracking. Coordinates go to your backend and model and stay in chat history. Background or locked-phone fixes need the visible Android service. Precise location and unrestricted battery use improve availability; reopen Bob if Android stops the service.</Text>
                  <SettingsRow title="Location permissions" label="Android location settings" icon={MapPin} onPress={()=>run(async()=>{await NativeModules.BobLocation?.openSettings('location');})}/>
                  <SettingsRow title="App & battery" label="Android app and battery settings" icon={SlidersHorizontal} onPress={()=>run(async()=>{await NativeModules.BobLocation?.openSettings('app');})}/>
                </Disclosure>
              </SettingsGroup>}
          </>}
          {screen === 'Connection' && <>
<KeepConnectedSettings state={keepConnected}/>
          </>}
          {screen === 'App & updates' && <>
<SettingsGroup title="App">
                <SettingsRow title="Build & install" icon={Download} disabled={!backend} onPress={()=>{setUpdatesTarget(backend);navigate('Chat');}}/>
                <SettingsRow title="Copy app diagnostics" icon={Stethoscope} onPress={()=>run(async()=>{await copyAppDiagnostics();Alert.alert('Diagnostics copied','Paste the report into this chat. It contains sanitized lifecycle, exit and workload metadata, not chat text, credentials, URLs or location.');})}/>
                <Disclosure menu label="About diagnostics"><Text typography="ui" style={styles.caption}>If Bob closes unexpectedly, reopen it and copy this report. It includes bounded crash types and code positions, not exception messages or chat content. Workload samples are recorded about every 10 seconds while open. Reports stay on this phone until you share them.</Text></Disclosure>
              </SettingsGroup>
          </>}
          {screen === 'Advanced' && <>
{!readOnly&&<SettingsGroup title="Advanced">
              <Text typography="ui" style={[styles.caption,{paddingVertical:8}]}>Workstation: {backend?.name??'Not connected'}. Modules apply only to this conversation; provider connections apply to this workstation.</Text>
                <SettingsRow title="Advanced modules" icon={Blocks} disabled={!chat||!ordinaryChat} onPress={()=>run(()=>openSection('Modules'))}/>
              <Disclosure menu label="Provider connection">
              <Text typography="ui" style={styles.caption}>
                Credentials are sent only to the selected paired backend, never
                as chat messages.
              </Text>
              <View style={styles.row}>{['openai','anthropic'].map(p=><Button menu key={p} label={p===providerName?`${p} ✓`:p} onPress={()=>setProviderName(p)}/>)}</View>
              <Text typography="ui" style={styles.fieldLabel}>API key</Text>
              <TextInput
                typography="ui"
                secureTextEntry
                style={styles.input}
                accessibilityLabel="Provider API key"
                value={apiKey}
                onChangeText={setApiKey}
                placeholder={`${providerName} API key`}
                placeholderTextColor={colors.muted}
              />
              <Text typography="ui" style={styles.fieldLabel}>Model ID</Text>
              <TextInput
                typography="ui"
                style={styles.input}
                accessibilityLabel="Model ID"
                value={modelId}
                onChangeText={setModelId}
                placeholder="Model ID"
                placeholderTextColor={colors.muted}
              />
              <Button menu
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
              </Disclosure>
              </SettingsGroup>}
          </>}
          </>}
          </ScrollView>
          }</SectionBody>
        </View>
      )}
      {actions&&!actionsMore&&ordinaryChat&&screen==='Chat'&&<View testID="chat-actions-overlay" accessibilityViewIsModal style={[StyleSheet.absoluteFill,{zIndex:40}]}>
          <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Dismiss chat actions" onPress={()=>setActions(false)}/>
          <PlusMenu bottom={Math.max(0,keyboardInset-insets.bottom)+12+composerRowHeight+6} maxHeight={Math.max(48,windowSize.height-Math.max(0,keyboardInset-insets.bottom)-12-composerRowHeight-6-insets.top-insets.bottom-12)} disabled={!chat||!ordinaryChat||!!pending} onCamera={()=>run(()=>openAttachments('camera'))} onGallery={()=>run(()=>openAttachments('gallery'))} onFiles={()=>run(()=>openAttachments('files'))} onDrawing={()=>{setActions(false);Keyboard.dismiss();setDrawingEditor(true);}} onModel={()=>{setActions(false);Keyboard.dismiss();run(openModelPicker);}} onMore={()=>{Keyboard.dismiss();setActionsMore(true);}}/>
        </View>}
      <Modal visible={actions&&actionsMore&&ordinaryChat} transparent animationType="none" onRequestClose={()=>setActions(false)}>
        <View style={styles.actionOverlay}>
          <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Dismiss more chat actions" onPress={()=>setActions(false)}/>
          <SafeAreaView edges={['bottom']} style={styles.actionSheet}>
            <View style={{marginHorizontal:-20,marginTop:-20}}><SectionHeading title="More actions"/></View>
            <SectionBody style={{flex:undefined,flexShrink:1,marginHorizontal:-20,marginBottom:-20}} footer={<SectionActions overlay leading={<RoundAction icon={X} label="Close actions" onPress={()=>setActions(false)}/>}/>}>{clearance=>
            <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{paddingHorizontal:16,paddingTop:16,paddingBottom:clearance+24}}>
              <Text typography="ui" accessibilityLiveRegion="polite" style={[styles.caption,{marginBottom:12}]}>{backend?.name??'Workstation'} · {busy?'Working':status}</Text>
              <SettingsGroup title="Messages">
                {busy&&<Button label="Send now to steer Bob" disabled={!chat||!hasDraft||!!pending} onPress={()=>{setActions(false);run(()=>submit('steer'));}}/>}
                <Button label="Send after this reply" disabled={!chat||!hasDraft||!!pending} onPress={()=>{setActions(false);run(()=>submit('followUp'));}}/>
              </SettingsGroup>
              <SettingsGroup title="Conversation">
                <SettingsRow title="Conversation settings" icon={SettingsIcon} disabled={!chat} onPress={()=>{setActions(false);run(()=>openSection('Conversation settings'));}}/>
                <Disclosure label="Conversation history">
                  <Button label={parentHistory.page?.next?'Load earlier messages':'Load / refresh stored history'} disabled={!chat||!parentHistory.ready||parentHistory.loading} onPress={()=>{setActions(false);run(parentHistory.load);}}/>
                  <Button label="Jump to oldest loaded message" disabled={!chat} onPress={()=>{setActions(false);parentFollow.oldest();}}/>
                  {parentHistory.page&&<Text typography="ui" style={styles.caption}>{parentHistory.page.items.length} stored entries loaded · {parentHistory.page.next?'more available':'end of last scan'}. Stored history is not unlimited model context.</Text>}
                </Disclosure>
                {ordinaryChat&&agents.length>0&&<SettingsRow title="Agent history" icon={Users} onPress={()=>{setActions(false);setAgentHistory(true);navigate('Agents');}}/>}
                {unlinkedSurfaces.length>0&&<Disclosure label="Other interactive surfaces">
                  <Text typography="ui" style={styles.caption}>Older surfaces without a link in the loaded history.</Text>
                  {unlinkedSurfaces.map(item=><Button key={item.value.id} label={`Open ${item.value.title}`} onPress={()=>{setActions(false);run(()=>openSurface(item));}}/>)}
                </Disclosure>}
              </SettingsGroup>
              <SettingsGroup title="App maintenance">
                <SettingsRow title="Build & install" icon={Download} disabled={!backend} onPress={()=>{setActions(false);setUpdatesTarget(backend);}}/>
              </SettingsGroup>
              {(busy||activeAgents.length>0)&&<SettingsGroup title="Stop running work">
                <Text typography="ui" style={[styles.caption,{paddingVertical:8}]}>Stopping does not undo completed actions.</Text>
                {busy&&<Button label="Stop Bob" onPress={()=>{setActions(false);run(()=>stop(false));}}/>}
                <Button label="Stop Bob and subagents" onPress={()=>{setActions(false);run(()=>stop(true));}}/>
              </SettingsGroup>}
            </ScrollView>
            }</SectionBody>
          </SafeAreaView>
        </View>
      </Modal>
      {attachmentPicker&&attachmentPicker.scope===scope&&<AttachmentPicker key={attachmentPicker.scope} initialTab={attachmentPicker.tab} limit={attachmentPicker.limit} onClose={()=>setAttachmentPicker(undefined)} onAdd={files=>{
        const current=attachmentPicker.scope;
        setDraftAttachments(previous=>({...previous,[current]:[...(previous[current]??[]),...files]}));setAttachmentPicker(undefined);
      }}/>}
            <ModelPicker loading={modelLoading} visible={ordinaryChat&&!!modelPickerTarget} models={models} current={modelChoice} onClose={()=>setModelPickerTarget(undefined)} onApply={applyModelChoice}/>
      {screen==='Workstations'&&<SideDrawer menu={sectionMenu} key={screen+':'+(backend?.backendId??'')} embedded mode="workstations" workspaceLabel={backend?.name} visible onClose={()=>showChat()} disabled={!backend}
        onNew={()=>run(newChat)}
        onSettings={()=>run(()=>openSection('Settings'))}
        onSchedules={()=>{Keyboard.dismiss();run(()=>openSection('Schedules'));}}
        navigation={[]}
        workspaces={backends.map(b=>({id:b.backendId,label:backends.filter(item=>item.name===b.name).length>1?`${b.name} · ${b.backendId.slice(0,8)}`:b.name,selected:b.backendId===backend?.backendId,onPress:()=>{
          if(b.backendId!==backend?.backendId){setChats([]);setChatCursor(undefined);setBackend(b);setChat(undefined);}
          navigate('Agents');setDrawer(false);
        }}))}
        onSessionAction={sessionAction}
        conversations={[]}
        pairing={<>
          <Text typography="ui" style={styles.caption}>Run bob connect on your computer, then scan the QR code or paste its invitation.</Text>
          <Button menu label="Scan pairing QR" onPress={()=>run(async()=>{setPairing(await NativeModules.BobPlatform.scanPairing());})}/>
          <Text typography="ui" style={styles.fieldLabel}>Pairing invitation</Text>
          <TextInput typography="ui" style={styles.input} multiline value={pairing} onChangeText={setPairing} accessibilityLabel="Pairing invitation" placeholder="Paste invitation" placeholderTextColor={colors.muted}/>
          <Button menu label="Pair this backend" onPress={()=>run(pair)}/>
        </>}
      />}

      </View>
    </SafeAreaView>
  );
}
export default function App() {
  return (
    <DiagnosticBoundary><SafeAreaProvider><ThemeProvider>
      <Main />
    </ThemeProvider></SafeAreaProvider></DiagnosticBoundary>
  );
}
const stylesTheme = themed(({colors,menuChrome,shadows})=>StyleSheet.create({
  welcome: {flexGrow:1,padding:24,gap:32,justifyContent:'space-between'},
  welcomeArt:{minHeight:240,flex:1,alignItems:'center',justifyContent:'center'},
  welcomeLogo:{width:'100%',maxWidth:400,aspectRatio:1},
  welcomeCopy:{gap:12,paddingBottom:12},
  welcomeTitle:{color:colors.foreground,fontSize:37,lineHeight:44,fontWeight:'600',letterSpacing:-1},
  welcomeSubtitle:{color:colors.muted,fontSize:15,lineHeight:24},
  welcomePrimary:{...menuButtonChrome({colors,shadows}).pill,minHeight:58,borderRadius:999,alignItems:'center',justifyContent:'center',marginTop:16},
  welcomePrimaryText:{...menuButtonChrome({colors,shadows}).label,color:colors.foreground,fontSize:16,fontWeight:'600'},
  root:{flex:1,backgroundColor:colors.background},
  content:{flex:1,width:'100%',maxWidth:760,alignSelf:'center'},
  readingColumn:{width:'100%',maxWidth:760,alignSelf:'center',gap:10},
  title:{color:colors.foreground,fontSize:22,fontWeight:'600'},
  chatTitle:{color:colors.muted,fontSize:13,paddingHorizontal:24,paddingTop:18,paddingBottom:4},
  caption:{color:colors.muted,fontSize:12,lineHeight:20},
  fieldLabel:{color:colors.foreground,fontSize:14,lineHeight:22,fontWeight:'600',marginTop:10},
  memoryStatus:{color:colors.muted,fontSize:13,lineHeight:21,paddingVertical:2},
  status:{color:colors.muted,paddingHorizontal:24,paddingVertical:8,fontSize:13,lineHeight:21},
  button:{...menuChrome.control,minHeight:48,height:'auto',paddingHorizontal:16,paddingVertical:12,marginVertical:4},
  menuButtonText:{...menuButtonChrome({colors,shadows}).label},
  menuButton:{...menuButtonChrome({colors,shadows}).pill},
  buttonText:{color:colors.foreground,fontSize:14,textAlign:'center',flexShrink:1},
  messages:{paddingHorizontal:12,paddingTop:16,paddingBottom:80,gap:CHAT_CONTENT_GAP},
  kind:{color:colors.muted,fontSize:11,marginBottom:8},
  message:{color:colors.body,fontSize:15,lineHeight:25},
  empty:{padding:30,flex:1,justifyContent:'center',gap:20},
  hero:{fontSize:29,color:colors.foreground,fontWeight:'500'},
  composer:{paddingHorizontal:12,paddingTop:8,paddingBottom:12,backgroundColor:'transparent'},
  composerCompact:{paddingHorizontal:12,paddingBottom:12},
  composerHeading:{minHeight:48,flexDirection:'row',alignItems:'center',gap:8,paddingRight:4},
  composerRow:{flexDirection:'row',alignItems:'flex-end'},
  composerCapsule:{...shadows.floating,flex:1,minWidth:0,padding:8,borderRadius:26,borderWidth:1,borderColor:colors.border,backgroundColor:colors.composer,gap:4},
  composerCapsuleCompact:{padding:0,gap:0},
  input:{...menuChrome.input,color:colors.foreground,fontSize:15,padding:14,minHeight:50,maxHeight:180,borderRadius:14,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,marginVertical:6},
  row:{flexDirection:'row',gap:8,flexWrap:'wrap'},
  overlay:{flex:1,backgroundColor:'#00000088',padding:18,justifyContent:'center'},
  sheet:{height:'80%',width:'100%',maxWidth:760,alignSelf:'center',backgroundColor:colors.background,borderWidth:1,borderColor:colors.border,borderRadius:menuRadii.card,padding:20},
  actionOverlay:{flex:1,justifyContent:'flex-end',backgroundColor:'#00000088'},
  actionSheet:{...shadows.popup,maxHeight:'75%',backgroundColor:colors.background,borderTopLeftRadius:menuRadii.card,borderTopRightRadius:menuRadii.card,padding:20,gap:16},
}));
