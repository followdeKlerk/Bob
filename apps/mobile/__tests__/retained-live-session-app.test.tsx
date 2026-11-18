jest.mock('react-native-reanimated',()=>({__esModule:true,default:{View:require('react-native').View,createAnimatedComponent:(component:any)=>component},LinearTransition:{duration:(duration:number)=>({reduceMotion:(reduceMotion:string)=>({duration,reduceMotion})})},ReduceMotion:{System:'system'},cancelAnimation:jest.fn(),useSharedValue:(value:any)=>require('react').useRef({value}).current,useAnimatedProps:(fn:any)=>fn(),withSpring:(value:any)=>value,withTiming:(value:any)=>value,Easing:{out:(value:any)=>value,cubic:jest.fn()}}));
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Alert,AppState,DeviceEventEmitter,NativeModules,PermissionsAndroid,Platform,StyleSheet,View,Modal} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import {VoiceInputButton} from '../components/voice-input-button';
import {ModelPicker} from '../components/model-picker';
import {SettingsHome} from '../components/settings-home';
import {DraftInput} from '../components/draft-input';
import {ChatNavigation} from '../components/chat-navigation';
import {NotesScreen} from '../components/notes-screen';
import {ToolsScreen} from '../components/tools-screen';
import App from '../App';
import {BuildCard} from '../components/build-card';
import {UpdatePopover} from '../components/update-popover';
import type {BuildState} from '../use-build-status';
import {DEFAULT_CACHE_PREFERENCES,getCacheUsage,updateCachePreferences} from '../download-cache';

// Mock platform boundaries only: App, shell, runtime, histories and delivery are real.
jest.mock('react-native-get-random-values',()=>({}));
jest.mock('react-native/Libraries/AppState/AppState',()=>({__esModule:true,default:{currentState:'active',addEventListener:jest.fn(()=>({remove:jest.fn()}))}}));
jest.mock('../global.css',()=>({}));
jest.mock('lucide-react-native',()=>new Proxy({},{get:(_,name)=>name==='__esModule'?true:()=>null}));
jest.mock('react-native-svg',()=>new Proxy({},{get:(_,name)=>name==='__esModule'?true:()=>null}));
jest.mock('react-native-sse',()=>jest.fn());
jest.mock('uuid',()=>({v4:jest.fn()}));
jest.mock('../components/ui/button',()=>({Button:require('react-native').Pressable}));
jest.mock('../components/ui/text',()=>({Text:require('react-native').Text,TextClassContext:require('react').createContext(undefined)}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaProvider:require('react-native').View,SafeAreaView:require('react-native').View,useSafeAreaInsets:()=>({top:0,bottom:0,left:0,right:0})}));
jest.mock('react-native-keychain',()=>({getGenericPassword:jest.fn(async()=>false),setGenericPassword:jest.fn(async()=>({service:'synthetic-service'})),ACCESSIBLE:{WHEN_UNLOCKED_THIS_DEVICE_ONLY:'synthetic-device-only'}}));
jest.mock('@react-native-async-storage/async-storage',()=>{const values=new Map();return{getItem:jest.fn(async(key:string)=>values.get(key)??null),setItem:jest.fn(async(key:string,value:string)=>{values.set(key,value);}),removeItem:jest.fn(async(key:string)=>{values.delete(key);}),getMany:jest.fn(async(keys:string[])=>Object.fromEntries(keys.map(key=>[key,values.get(key)??null]))),setMany:jest.fn(async(items:Record<string,string>)=>{for(const [key,value] of Object.entries(items))values.set(key,value);}),removeMany:jest.fn(async(keys:string[])=>{for(const key of keys)values.delete(key);}),getAllKeys:jest.fn(async()=>Array.from(values.keys())),clear:jest.fn(async()=>values.clear())};});

// All identities, endpoints, credentials and transcript content are synthetic.
const a={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://workstation-a.test.ts.net',name:'Example A',alias:'Example A'};
const b={backendId:'22222222-2222-4222-8222-222222222222',endpoint:'https://workstation-b.example.invalid',name:'Example B',alias:'Example B'};
type Backend=typeof a;
type Stream={url:string;headers:Record<string,string>;close:jest.Mock;publish?:(event:{data:string})=>void};
const chat=7;
function entries(backend:Backend){return [
 {id:1,kind:'pi.assistant',model:[{role:'assistant',content:[{type:'toolCall',id:'synthetic-read',name:'read',arguments:{path:'example.txt'}}]}]},
 {id:2,kind:'pi.tool-result',model:[{role:'toolResult',toolCallId:'synthetic-read',toolName:'read',content:`Synthetic result from ${backend.alias}`}]},
 {id:3,kind:'pi.assistant',model:[{role:'assistant',content:`Synthetic answer from ${backend.alias}`}]},
];}
function host(tree:Renderer.ReactTestRenderer,backend:Backend,id:number|'empty'=chat){return tree.root.findAll(node=>node.type===View&&node.props.testID===`session-host:${backend.backendId}:${id}`)[0];}
function notesHost(tree:Renderer.ReactTestRenderer,backend:Backend){return tree.root.findAll(node=>node.type===View&&node.props.testID===`workspace-notes:${backend.backendId}`)[0];}
function activeHost(tree:Renderer.ReactTestRenderer){
 const hosts=tree.root.findAll(node=>node.type===View&&typeof node.props.testID==='string'&&node.props.testID.startsWith('session-host:')&&node.props.pointerEvents==='auto');
 expect(hosts).toHaveLength(1);return hosts[0];
}
function button(root:Renderer.ReactTestInstance,label:string){
 const found=root.findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function');
 expect(found.length).toBeGreaterThan(0);return found[0];
}
function list(root:Renderer.ReactTestInstance){return root.findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToOffset==='function')[0];}
function draft(root:Renderer.ReactTestInstance){return root.findByProps({accessibilityLabel:'Message draft'});}
function toolHeader(root:Renderer.ReactTestInstance){return root.findAll(node=>node.props.accessibilityLabel==='Tool details: read'&&node.props.accessibilityRole==='button'&&!!node.props.style)[0];}
async function navigateTo(tree:Renderer.ReactTestRenderer,destination:'Chat'|'Notes'|'Workstations'|'Tools'|'Settings'|'Tasks'){
 const notes=tree.root.findAll(node=>node.type===View&&typeof node.props.testID==='string'&&node.props.testID.startsWith('workspace-notes:')&&node.props.pointerEvents==='auto')[0];
 const root=notes??activeHost(tree),navigation=root.findAllByType(ChatNavigation).find(node=>node.props.showTrigger!==false)!;
 if(destination==='Chat'&&(!navigation.props.selected||navigation.props.selected==='Chat'))return;
 if(!navigation.props.open)await act(async()=>button(root,'Menu').props.onPress());
 await act(async()=>button(tree.root.findByProps({testID:'overlay-active'}).findAllByProps({testID:'chat-navigation-sheet'}).at(-1)!,destination==='Chat'?'Back to chat':destination).props.onPress());
}
async function switchBackend(tree:Renderer.ReactTestRenderer,backend:Backend){
 await navigateTo(tree,'Workstations');
 await act(async()=>button(activeHost(tree),backend.alias).props.onPress());
 expect(activeHost(tree)).toBe(host(tree,backend));
}
async function openNotification(backend:Backend,id:number){
 (NativeModules.BobPlatform.takeNotificationTarget as jest.Mock).mockResolvedValueOnce({backendId:backend.backendId,conversationId:id});
 await act(async()=>DeviceEventEmitter.emit('BobNotificationOpen'));
}
function pauseEarlier(root:Renderer.ReactTestInstance){
 const history=list(root),event={nativeEvent:{contentOffset:{y:480},contentSize:{height:2000},layoutMeasurement:{height:600}}};
 act(()=>{
  history.props.onLayout({nativeEvent:{layout:{height:600}}});
  history.props.onContentSizeChange(300,2000);
  history.props.onScrollBeginDrag();history.props.onScroll(event);history.props.onMomentumScrollEnd(event);
 });
 expect(history.props.maintainVisibleContentPosition).toEqual({minIndexForVisible:0});
 expect(button(root,'Scroll to latest message')).toBeDefined();
}

const nativeNames=['BobPlatform','BobNotifications','BobFiles','BobOutbox','BobPhoneTools','BobConnection','BobPhoneLocation','BobVoiceInput','BobSpeech'];
let previousNative:Map<string,unknown>;
beforeEach(async()=>{
 await AsyncStorage.clear();jest.clearAllMocks();
 previousNative=new Map(nativeNames.map(name=>[name,NativeModules[name]]));
 jest.replaceProperty(Platform,'OS','android');
 let sequence=0;
 require('uuid').v4.mockImplementation(()=>`33333333-3333-4333-8333-${String(++sequence).padStart(12,'0')}`);
});
afterEach(()=>{
 jest.restoreAllMocks();
 for(const [name,value] of previousNative){if(value===undefined)delete NativeModules[name];else NativeModules[name]=value;}
});

async function mount({emptyA=false,continuous=false,updates={enabled:false}}:{emptyA?:boolean;continuous?:boolean;updates?:BuildState}={}){
 await AsyncStorage.setItem('backends',JSON.stringify([a,b]));
 await AsyncStorage.setItem('selection',JSON.stringify({backendId:a.backendId,chat:emptyA?undefined:chat}));
 await AsyncStorage.setItem('workstation-selections',JSON.stringify({[a.backendId]:emptyA?undefined:chat,[b.backendId]:chat}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'synthetic-device',password:'synthetic-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};
 const notifications={setAppContext:jest.fn(),setReplyNotifications:jest.fn()};NativeModules.BobNotifications=notifications;
 NativeModules.BobFiles={versionCode:1,versionName:'1.0',getUpdateStatus:jest.fn(async()=>({state:'downloading'})),installUpdate:jest.fn()};delete NativeModules.BobOutbox;delete NativeModules.BobPhoneLocation;
 const phone={enabled:jest.fn(async()=>true),setEnabled:jest.fn(async()=>true),execute:jest.fn(async(_backendId:string,_request:string)=>JSON.stringify({status:'ok',data:{sdkInt:35}})),getResult:jest.fn(async()=>null)};
 NativeModules.BobPhoneTools=phone;jest.spyOn(PermissionsAndroid,'check').mockResolvedValue(true);
 let connectionEnabled=continuous;
 let live={backendId:a.backendId,conversationId:chat,enabled:true,selected:true,status:'connected',revision:1,epoch:1,heartbeatAgeMs:0,snapshot:JSON.stringify({backendId:a.backendId,conversationId:chat,view:{entries:entries(a),docs:{},work:[]}})};
 const connection={select:jest.fn(async()=>{}),start:jest.fn(async()=>{}),stop:jest.fn(async()=>{connectionEnabled=false;}),state:jest.fn(async()=>JSON.stringify({enabled:connectionEnabled,running:connectionEnabled,status:connectionEnabled?'connected':'off',batteryRestricted:true})),
  ...(continuous?{readStream:jest.fn(async(_backend:string,_chat:number,_observer:string,after:number)=>JSON.stringify({...live,enabled:connectionEnabled,snapshot:after===live.revision?undefined:live.snapshot})),releaseStream:jest.fn(async()=>true)}:{})};
 const publishNativeRaw=async(snapshot:string)=>act(async()=>{
  live={...live,revision:live.revision+1,snapshot};DeviceEventEmitter.emit('BobConnectionStream',{backendId:a.backendId,conversationId:chat});
 });
 const publishNative=async(docs:Record<string,unknown>={},items:any[]=entries(a),epoch=live.epoch)=>act(async()=>{
  live={...live,revision:live.revision+1,epoch,snapshot:JSON.stringify({backendId:a.backendId,conversationId:chat,view:{entries:items,docs,work:[]}})};
  DeviceEventEmitter.emit('BobConnectionStream',{backendId:a.backendId,conversationId:chat});
 });
 NativeModules.BobConnection=connection;
 const lifecycle=new Set<(state:any)=>void>(),current=jest.replaceProperty(AppState,'currentState','active');
 jest.spyOn(AppState,'addEventListener').mockImplementation((event,callback)=>{if(event==='change')lifecycle.add(callback);return{remove:()=>{lifecycle.delete(callback);}};});
 const transition=async(state:'background'|'active')=>act(async()=>{current.replaceValue(state);for(const callback of lifecycle)callback(state);});
 const streams:Stream[]=[];
 require('react-native-sse').mockImplementation((url:string,options:{headers:Record<string,string>})=>{
  const stream:Stream={url,headers:options.headers,close:jest.fn()};streams.push(stream);
  return {close:stream.close,removeAllEventListeners:jest.fn(),addEventListener:(event:string,callback:any)=>{if(event==='snapshot')stream.publish=callback;}};
 });
 const fetchMock=jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any,init?:any)=>{
  const url=String(input),backend=url.startsWith(a.endpoint)?a:b;
  if(url.includes('/v1/notes'))throw Error('Synthetic notes server is offline');
  const id=Number(url.match(/\/chats\/(\d+)\//)?.[1]??chat);
  const data=url.includes('/history')?{backendId:backend.backendId,conversationId:id,coverage:'stored-entries',items:entries(backend)}
   :url.endsWith('/chats')?{items:[{id:chat,meta:{title:`Synthetic ${backend.alias}`}}]}
   :url.endsWith('/configure')?{instructions:null,cwd:'/example'}
   :url.endsWith('/updates')?updates
   :url.endsWith('/phone-tools/availability')?{enabled:JSON.parse(init.body).enabled}
   :url.endsWith('/phone-tools')?JSON.parse(init.body).action==='claim'?{execute:true,status:'executing'}:{accepted:true,status:'completed'}
   :url.includes('/operations/')?{}
   :url.endsWith('/messages')?{status:'accepted',entry:20}
   :url.endsWith('/stop')?{stopped:true}
   :url.endsWith('/peers')?{inbound:[],outbound:[]}:[];
  return {ok:true,status:200,json:async()=>data} as Response;
 });
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<App/>);});
 const latest=(backend:Backend)=>streams.filter(stream=>stream.url===`${backend.endpoint}/v1/chats/${chat}/events?heartbeats=1&patches=1`).slice(-1)[0];
 const publish=async(backend:Backend,docs:Record<string,unknown>={},items:any[]=entries(backend))=>act(async()=>{
  const stream=latest(backend);expect(stream?.publish).toBeDefined();
  stream.publish!({data:JSON.stringify({backendId:backend.backendId,conversationId:chat,view:{entries:items,docs,work:[]}})});
 });
 return {tree,streams,latest,publish,publishNative,publishNativeRaw,notifications,phone,connection,fetchMock,transition,close:async()=>act(async()=>tree.unmount())};
}

test('saved-session hydration starts while appearance is still reading, without exposing unthemed chat',async()=>{
 const get=(AsyncStorage.getItem as jest.Mock).getMockImplementation()!;let finish!:(value:string|null)=>void;
 const held=new Promise<string|null>(resolve=>{finish=resolve;});
 const spy=jest.spyOn(AsyncStorage,'getItem').mockImplementation(key=>key==='appearance'?held:get(key));
 const app=await mount();
 try{
  expect(spy).toHaveBeenCalledWith('appearance');
  expect(spy).toHaveBeenCalledWith('backends');
  expect(spy).toHaveBeenCalledWith('selection');
  expect(app.tree.root.findAllByType(DraftInput)).toHaveLength(0);
  await act(async()=>finish('system'));
  expect(host(app.tree,a)).toBeDefined();expect(draft(host(app.tree,a)).props.value).toBe('');
  expect(app.streams).toHaveLength(1);
 }finally{finish('system');await app.close();spy.mockImplementation(get);}
});

test('unopened Sessions does not mount its native list during startup or typing; first visit is retained',async()=>{
 const app=await mount();
 try{
  const first=host(app.tree,a),editor=draft(first);
  expect(first.findAllByProps({testID:'agent-session-tree'})).toHaveLength(0);
  await act(async()=>editor.props.onChangeText('Preserved performance draft'));
  expect(first.findAllByProps({testID:'agent-session-tree'})).toHaveLength(0);
  await act(async()=>button(first,'Menu').props.onPress());
  await act(async()=>button(app.tree.root.findByProps({testID:'overlay-active'}),'Agents and Sessions').props.onPress());
  const agents=first.findAllByProps({testID:'agent-session-tree'})[0];expect(agents).toBeDefined();
  const search=first.findByProps({accessibilityLabel:'Search agents and sessions'});
  await act(async()=>search.props.onChangeText('synthetic'));
  await navigateTo(app.tree,'Chat');
  expect(first.findAllByProps({testID:'agent-session-tree'})[0]).toBe(agents);
  expect(draft(first)).toBe(editor);expect(editor.props.value).toBe('Preserved performance draft');
  await act(async()=>button(first,'Menu').props.onPress());
  await act(async()=>button(app.tree.root.findByProps({testID:'overlay-active'}),'Agents and Sessions').props.onPress());
  expect(first.findAllByProps({testID:'agent-session-tree'})[0]).toBe(agents);
  expect(first.findByProps({accessibilityLabel:'Search agents and sessions'}).props.value).toBe('synthetic');
 }finally{await app.close();}
});

test('optional history IO cannot hold the recovered draft or authenticated stream hostage',async()=>{
 const get=(AsyncStorage.getItem as jest.Mock).getMockImplementation()!;let finish!:(value:string|null)=>void;
 const held=new Promise<string|null>(resolve=>{finish=resolve;});
 const spy=jest.spyOn(AsyncStorage,'getItem').mockImplementation(key=>key===`chunked:history:${a.backendId}:${chat}`?held:get(key));
 await AsyncStorage.setItem(`history:${a.backendId}:${chat}`,JSON.stringify({entries:[{id:89,kind:'bob.user',data:{text:'Stale cached text'}}],docs:{}}));
 const app=await mount();
 try{
  expect(spy).toHaveBeenCalledWith(`pending:${a.backendId}:${chat}`);
  expect(draft(host(app.tree,a)).props.editable).toBe(true);
  expect(app.latest(a)?.publish).toBeDefined();
  await app.publish(a,{},[{id:90,kind:'pi.assistant',model:[{role:'assistant',content:'Fresh authoritative answer'}]}]);
  await act(async()=>finish(null));
  expect(list(host(app.tree,a)).props.data.some((item:any)=>item.id===90)).toBe(true);
 }finally{finish(null);await app.close();spy.mockImplementation(get);}
});

test('operation recovery still fences stream reconciliation and sends when optional history is independent',async()=>{
 const get=(AsyncStorage.getItem as jest.Mock).getMockImplementation()!;let finish!:(value:string|null)=>void;
 const held=new Promise<string|null>(resolve=>{finish=resolve;});
 const spy=jest.spyOn(AsyncStorage,'getItem').mockImplementation(key=>key===`pending:${a.backendId}:${chat}`?held:get(key));
 const app=await mount();
 try{
  expect(draft(host(app.tree,a)).props.editable).toBe(false);
  expect(app.streams).toHaveLength(0);
  expect(Keychain.getGenericPassword).toHaveBeenCalledWith({service:`bob.${a.backendId}`});
  await act(async()=>finish('synthetic-existing-operation'));
  expect(app.streams).toHaveLength(1);
  await act(async()=>draft(host(app.tree,a)).props.onChangeText('Must not resend'));
  expect(button(host(app.tree,a),'Send message').props.disabled).toBe(true);
  expect(app.fetchMock.mock.calls.some(([url])=>String(url).endsWith('/messages'))).toBe(false);
 }finally{finish(null);await app.close();spy.mockImplementation(get);}
});

test('transcript bounds its initial native mount without trimming stored entries or reader retention',async()=>{
 const app=await mount();
 try{
  const items=Array.from({length:40},(_,index)=>({id:index+1,kind:'pi.assistant',model:[{role:'assistant',content:`Synthetic preserved answer ${index}`}]}));
  await app.publish(a,{},items);
  const history=list(host(app.tree,a));
  expect(history.props.initialNumToRender).toBe(4);
  expect(history.props.maxToRenderPerBatch).toBe(4);
  expect(history.props.windowSize).toBe(7);
  expect(history.props.data).toHaveLength(40);
  expect(history.props.data[0].id).toBe(40);
  pauseEarlier(host(app.tree,a));
  expect(history.props.maintainVisibleContentPosition).toEqual({minIndexForVisible:0});
 }finally{await app.close();}
});

test('real workstation A → B → A retains both scope-keyed hosts, FlatLists, editors and open SSE instances',async()=>{
 const app=await mount();
 try{
  const first=host(app.tree,a),firstList=list(first),firstEditor=first.findByType(DraftInput),firstDraft=draft(first),firstStream=app.latest(a);
  await switchBackend(app.tree,b);
  const second=host(app.tree,b),secondList=list(second),secondEditor=second.findByType(DraftInput),secondDraft=draft(second),secondStream=app.latest(b);
  expect(first).not.toBe(second);expect(firstList).not.toBe(secondList);expect(firstEditor).not.toBe(secondEditor);
  expect(host(app.tree,a)).toBe(first);expect(list(first)).toBe(firstList);expect(first.findByType(DraftInput)).toBe(firstEditor);
  await switchBackend(app.tree,a);
  expect(host(app.tree,a)).toBe(first);expect(host(app.tree,b)).toBe(second);
  expect(list(first)).toBe(firstList);expect(list(second)).toBe(secondList);
  expect(first.findByType(DraftInput)).toBe(firstEditor);expect(second.findByType(DraftInput)).toBe(secondEditor);
  expect(draft(first)).toBe(firstDraft);expect(draft(second)).toBe(secondDraft);
  expect(app.streams).toHaveLength(2);expect(app.latest(a)).toBe(firstStream);expect(app.latest(b)).toBe(secondStream);
  expect(firstStream.headers['x-bob-backend']).toBe(a.backendId);expect(secondStream.headers['x-bob-backend']).toBe(b.backendId);
  expect(firstStream.close).not.toHaveBeenCalled();expect(secondStream.close).not.toHaveBeenCalled();
 }finally{await app.close();}
});

test('hidden A receives live transcript updates while drafts, expanded tools and older-scroll pause survive the return',async()=>{
 const app=await mount();
 try{
  const first=host(app.tree,a),history=list(first),editor=draft(first);
  await act(async()=>editor.props.onChangeText('Unsent synthetic A draft'));
  act(()=>toolHeader(first).props.onPress());
  const expanded=toolHeader(first);expect(expanded.props.accessibilityState.expanded).toBe(true);
  pauseEarlier(first);
  const scroll=jest.spyOn(history.instance,'scrollToOffset').mockImplementation(()=>{});
  await switchBackend(app.tree,b);
  const second=host(app.tree,b);await act(async()=>draft(second).props.onChangeText('Unsent synthetic B draft'));
  const newer={id:4,kind:'pi.assistant',model:[{role:'assistant',content:'Synthetic update received while A is hidden'}]};
  await app.publish(a,{},[...entries(a),newer]);
  expect(first.props.pointerEvents).toBe('none');expect(list(first)).toBe(history);
  expect(history.props.data.some((item:any)=>item.id===4)).toBe(true);
  expect(list(second).props.data.some((item:any)=>item.id===4)).toBe(false);
  act(()=>history.props.onContentSizeChange(300,2400));
  await switchBackend(app.tree,a);
  expect(draft(first)).toBe(editor);expect(editor.props.value).toBe('Unsent synthetic A draft');
  expect(draft(second).props.value).toBe('Unsent synthetic B draft');
  expect(toolHeader(first)).toBe(expanded);expect(expanded.props.accessibilityState.expanded).toBe(true);
  expect(history.props.maintainVisibleContentPosition).toEqual({minIndexForVisible:0});
  expect(button(first,'Scroll to latest message')).toBeDefined();expect(scroll).not.toHaveBeenCalled();
  expect(app.latest(a).close).not.toHaveBeenCalled();expect(app.latest(b).close).not.toHaveBeenCalled();
 }finally{await app.close();}
});

test('hidden hosts are masked and cannot claim phone requests or overwrite the sole selected native context',async()=>{
 const app=await mount();
 try{
  await switchBackend(app.tree,b);
  const hidden=host(app.tree,a),visible=host(app.tree,b);
  expect(hidden.props).toMatchObject({pointerEvents:'none',accessibilityElementsHidden:true,importantForAccessibility:'no-hide-descendants',collapsable:false});
  expect(StyleSheet.flatten(hidden.props.style)).toMatchObject({opacity:0,zIndex:0,position:'absolute'});
  expect(visible.props).toMatchObject({pointerEvents:'auto',accessibilityElementsHidden:false,importantForAccessibility:'auto'});
  expect(StyleSheet.flatten(visible.props.style)).toMatchObject({opacity:1,zIndex:1});
  expect(StyleSheet.flatten(hidden.props.style).display).not.toBe('none');
  expect(app.notifications.setAppContext).toHaveBeenLastCalledWith(b.backendId,chat);
  expect(app.connection.select).toHaveBeenLastCalledWith(b.backendId,chat);
  app.notifications.setAppContext.mockClear();app.connection.select.mockClear();app.fetchMock.mockClear();
  const request={id:'ab'.repeat(32),action:'device_info',parameters:{},expiresAt:Date.now()+80000,status:'pending'};
  await app.publish(a,{'bob.phone-tools':{requests:[request]}});
  expect(app.phone.execute).not.toHaveBeenCalled();expect(app.notifications.setAppContext).not.toHaveBeenCalled();expect(app.connection.select).not.toHaveBeenCalled();
  expect(app.fetchMock.mock.calls.some(([url,init])=>String(url).endsWith('/phone-tools')&&JSON.parse(init!.body as string).action==='claim')).toBe(false);
  expect(app.fetchMock.mock.calls.some(([url,init])=>String(url)===`${a.endpoint}/v1/phone-tools/availability`&&JSON.parse(init!.body as string).enabled)).toBe(false);
  await app.publish(b,{'bob.phone-tools':{requests:[{...request,id:'cd'.repeat(32)}]}});
  expect(app.phone.execute).toHaveBeenCalledTimes(1);expect(app.phone.execute.mock.calls[0][0]).toBe(b.backendId);
  await switchBackend(app.tree,a);
  expect(app.phone.execute).toHaveBeenCalledTimes(2);expect(app.phone.execute.mock.calls[1][0]).toBe(a.backendId);
  expect(app.notifications.setAppContext).toHaveBeenLastCalledWith(a.backendId,chat);
  expect(app.connection.select.mock.calls).toEqual([[a.backendId,chat]]);
 }finally{await app.close();}
});

test('background closes and foreground reconnects both streams without remounting either retained viewport',async()=>{
 const app=await mount();
 try{
  const first=host(app.tree,a);pauseEarlier(first);await act(async()=>draft(first).props.onChangeText('Background retained draft'));
  await switchBackend(app.tree,b);
  const second=host(app.tree,b),firstList=list(first),secondList=list(second),firstEditor=first.findByType(DraftInput),secondEditor=second.findByType(DraftInput);
  const oldA=app.latest(a),oldB=app.latest(b);
  await app.transition('background');
  expect(oldA.close).toHaveBeenCalledTimes(1);expect(oldB.close).toHaveBeenCalledTimes(1);
  expect(host(app.tree,a)).toBe(first);expect(host(app.tree,b)).toBe(second);expect(list(first)).toBe(firstList);expect(list(second)).toBe(secondList);
  await app.transition('active');
  expect(app.streams).toHaveLength(4);expect(app.latest(a)).not.toBe(oldA);expect(app.latest(b)).not.toBe(oldB);
  expect(app.latest(a).close).not.toHaveBeenCalled();expect(app.latest(b).close).not.toHaveBeenCalled();
  expect(host(app.tree,a)).toBe(first);expect(host(app.tree,b)).toBe(second);expect(list(first)).toBe(firstList);expect(list(second)).toBe(secondList);
  expect(first.findByType(DraftInput)).toBe(firstEditor);expect(second.findByType(DraftInput)).toBe(secondEditor);
  expect(draft(first).props.value).toBe('Background retained draft');expect(firstList.props.maintainVisibleContentPosition).toEqual({minIndexForVisible:0});
  expect(activeHost(app.tree)).toBe(second);expect(app.notifications.setAppContext).toHaveBeenLastCalledWith(b.backendId,chat);
  // A late event from the closed native stream cannot replace the retained state.
  await act(async()=>oldA.publish!({data:JSON.stringify({backendId:a.backendId,conversationId:chat,view:{entries:[{id:99,kind:'bob.user',data:{text:'Stale closed stream'}}],docs:{}}})}));
  expect(firstList.props.data.some((item:any)=>item.id===99)).toBe(false);
 }finally{await app.close();}
});

test('send and stop mutations use the selected backend even with the same chat number mounted twice',async()=>{
 const app=await mount();
 try{
  const first=host(app.tree,a);await act(async()=>draft(first).props.onChangeText('Send only to synthetic A'));
  expect(button(first,'Send message').props.disabled).toBe(false);
  const staleSend=button(first,'Send message').props.onPress;
  await switchBackend(app.tree,b);
  const second=host(app.tree,b);await act(async()=>draft(second).props.onChangeText('Send only to synthetic B'));
  app.fetchMock.mockClear();
  await act(async()=>staleSend());
  expect(app.fetchMock.mock.calls.filter(([url])=>String(url).endsWith('/messages'))).toHaveLength(0);
  await act(async()=>button(second,'Send message').props.onPress());
  const messages=()=>app.fetchMock.mock.calls.filter(([url,init])=>String(url).endsWith('/messages')&&init?.method==='POST');
  expect(messages()).toHaveLength(1);
  expect(messages()[0][0]).toBe(`${b.endpoint}/v1/chats/${chat}/messages`);
  expect(messages()[0][1]!.headers).toMatchObject({'x-bob-backend':b.backendId});
  expect(JSON.parse(messages()[0][1]!.body as string).text).toBe('Send only to synthetic B');
  expect(draft(first).props.value).toBe('Send only to synthetic A');
  await app.publish(b,{'pi.live':{run:{taskId:100,inputs:[]}}});
  const staleStop=button(second,'Stop Bob').props.onPress;
  await act(async()=>staleStop());
  const stops=()=>app.fetchMock.mock.calls.filter(([url,init])=>String(url).endsWith('/stop')&&init?.method==='POST');
  expect(stops()).toHaveLength(1);expect(stops()[0][0]).toBe(`${b.endpoint}/v1/chats/${chat}/stop`);
  expect(stops()[0][1]!.headers).toMatchObject({'x-bob-backend':b.backendId});expect(JSON.parse(stops()[0][1]!.body as string)).toEqual({scope:'root'});
  await switchBackend(app.tree,a);
  await act(async()=>staleStop());expect(stops()).toHaveLength(1);
  await act(async()=>button(first,'Send message').props.onPress());
  expect(messages()).toHaveLength(2);expect(messages()[1][0]).toBe(`${a.endpoint}/v1/chats/${chat}/messages`);
  expect(messages()[1][1]!.headers).toMatchObject({'x-bob-backend':a.backendId});
  expect(JSON.parse(messages()[1][1]!.body as string).text).toBe('Send only to synthetic A');
  await app.publish(a,{'pi.live':{run:{taskId:101,inputs:[]}}});
  await act(async()=>button(first,'Stop Bob').props.onPress());
  expect(stops()).toHaveLength(2);expect(stops()[1][0]).toBe(`${a.endpoint}/v1/chats/${chat}/stop`);
  expect(stops()[1][1]!.headers).toMatchObject({'x-bob-backend':a.backendId});
 }finally{await app.close();}
});

test('two chats on one backend share one NotesScreen owner and preserve offline pending notes and an unsaved editor draft',async()=>{
 const app=await mount();
 try{
  const owners=()=>app.tree.root.findAllByType(NotesScreen).filter(node=>node.props.backendId===a.backendId);
  expect(owners()).toHaveLength(1);
  const owner=owners()[0],workspace=notesHost(app.tree,a),first=host(app.tree,a);
  expect(first.findAllByType(NotesScreen)).toHaveLength(0);
  await navigateTo(app.tree,'Notes');
  expect(workspace.props.pointerEvents).toBe('auto');expect(owner.props.visible).toBe(true);
  await act(async()=>button(workspace,'Create note').props.onPress());
  act(()=>app.tree.root.findByProps({testID:'overlay-active'}).findByProps({accessibilityLabel:'Note title'}).props.onChangeText('Synthetic pending note'));
  act(()=>app.tree.root.findByProps({testID:'overlay-active'}).findByProps({accessibilityLabel:'Note body'}).props.onChangeText('Saved locally without a notes server'));
  await act(async()=>button(app.tree.root.findByProps({testID:'overlay-active'}),'Save note').props.onPress());
  expect(button(workspace,'Open note Synthetic pending note')).toBeDefined();
  const cacheKey=`notes:v1:${a.backendId}`,editorKey=`note-editor:v1:${a.backendId}`;
  const pending=JSON.parse((await AsyncStorage.getItem(cacheKey))!).pending;
  expect(pending).toHaveLength(1);expect(pending[0].value.body).toBe('Saved locally without a notes server');
  await act(async()=>button(workspace,'Create note').props.onPress());
  act(()=>app.tree.root.findByProps({testID:'overlay-active'}).findByProps({accessibilityLabel:'Note title'}).props.onChangeText('Synthetic unsaved draft'));
  await act(async()=>app.tree.root.findByProps({testID:'overlay-active'}).findByProps({accessibilityLabel:'Note body'}).props.onChangeText('Editor text must outlive a chat switch'));
  const editor=JSON.parse((await AsyncStorage.getItem(editorKey))!);
  expect(editor.body).toBe('Editor text must outlive a chat switch');
  // A notification can legitimately change sessions while the editor Modal is open.
  await openNotification(a,8);
  const second=host(app.tree,a,8);
  expect(activeHost(app.tree)).toBe(second);expect(host(app.tree,a)).toBe(first);
  expect(owners()).toEqual([owner]);expect(notesHost(app.tree,a)).toBe(workspace);
  expect(second.findAllByType(NotesScreen)).toHaveLength(0);expect(owner.props.visible).toBe(false);
  expect(JSON.parse((await AsyncStorage.getItem(cacheKey))!).pending).toEqual(pending);
  expect(JSON.parse((await AsyncStorage.getItem(editorKey))!)).toEqual(editor);
  await navigateTo(app.tree,'Notes');
  expect(owners()).toEqual([owner]);expect(owner.props.visible).toBe(true);
  expect(app.tree.root.findByProps({testID:'overlay-active'}).findByProps({accessibilityLabel:'Note title'}).props.value).toBe('Synthetic unsaved draft');
  expect(app.tree.root.findByProps({testID:'overlay-active'}).findByProps({accessibilityLabel:'Note body'}).props.value).toBe(editor.body);
  expect(button(workspace,'Open note Synthetic pending note')).toBeDefined();
  // Exercise the Notes-owned root menu, outside either conversation host.
  await navigateTo(app.tree,'Chat');
  expect(activeHost(app.tree)).toBe(second);
  await openNotification(a,chat);await navigateTo(app.tree,'Notes');
  expect(host(app.tree,a)).toBe(first);expect(host(app.tree,a,8)).toBe(second);
  expect(owners()).toEqual([owner]);expect(notesHost(app.tree,a)).toBe(workspace);
  expect(app.tree.root.findByProps({testID:'overlay-active'}).findByProps({accessibilityLabel:'Note body'}).props.value).toBe(editor.body);
  expect(JSON.parse((await AsyncStorage.getItem(cacheKey))!).pending).toEqual(pending);
  expect(JSON.parse((await AsyncStorage.getItem(editorKey))!)).toEqual(editor);
  expect(app.fetchMock.mock.calls.some(([url])=>String(url).startsWith(`${a.endpoint}/v1/notes?`))).toBe(true);
 }finally{await app.close();}
});

test('a delayed New response from an unmounted empty workstation cannot steal the selected B session',async()=>{
 const app=await mount({emptyA:true});
 let release:((response:Response)=>void)|undefined;
 try{
  const empty=host(app.tree,a,'empty');expect(activeHost(app.tree)).toBe(empty);
  const normal=app.fetchMock.getMockImplementation()!;
  app.fetchMock.mockImplementation((input,init)=>String(input)===`${a.endpoint}/v1/chats`&&init?.method==='POST'
   ?new Promise<Response>(resolve=>{release=resolve;}):normal(input,init));
  await act(async()=>button(empty,'New conversation').props.onPress());
  expect(release).toBeDefined();
  expect(app.fetchMock.mock.calls.filter(([url,init])=>String(url)===`${a.endpoint}/v1/chats`&&init?.method==='POST')).toHaveLength(1);
  await switchBackend(app.tree,b);
  const selected=host(app.tree,b),history=list(selected),editor=selected.findByType(DraftInput);
  expect(host(app.tree,a,'empty')).toBeUndefined();
  expect(app.notifications.setAppContext).toHaveBeenLastCalledWith(b.backendId,chat);
  app.notifications.setAppContext.mockClear();app.connection.select.mockClear();
  await act(async()=>release!({ok:true,status:200,json:async()=>({id:77})} as Response));release=undefined;
  expect(activeHost(app.tree)).toBe(selected);expect(list(selected)).toBe(history);expect(selected.findByType(DraftInput)).toBe(editor);
  expect(host(app.tree,a,77)).toBeUndefined();expect(host(app.tree,a,'empty')).toBeUndefined();
  expect(JSON.parse((await AsyncStorage.getItem('selection'))!)).toEqual({backendId:b.backendId,chat});
  expect(app.notifications.setAppContext).not.toHaveBeenCalled();expect(app.connection.select).not.toHaveBeenCalled();
  expect(app.streams.every(stream=>stream.headers['x-bob-backend']===b.backendId)).toBe(true);
 }finally{
  if(release)await act(async()=>release!({ok:true,status:200,json:async()=>({id:77})} as Response));
  await app.close();
 }
});

test('editing a workstation alias does not restart either retained SSE or replace its host and draft',async()=>{
 const app=await mount();
 try{
  const first=host(app.tree,a),firstList=list(first),firstEditor=first.findByType(DraftInput),oldA=app.latest(a);
  await act(async()=>draft(first).props.onChangeText('Retained across local alias changes'));
  await switchBackend(app.tree,b);const second=host(app.tree,b),oldB=app.latest(b);
  await switchBackend(app.tree,a);await navigateTo(app.tree,'Workstations');
  await act(async()=>button(first,'Edit alias for Example A').props.onPress());
  act(()=>app.tree.root.findByProps({testID:'overlay-active'}).findByProps({accessibilityLabel:'Workstation alias'}).props.onChangeText('Synthetic alias'));
  await act(async()=>button(app.tree.root.findByProps({testID:'overlay-active'}),'Save workstation alias').props.onPress());
  expect(button(first,'Synthetic alias')).toBeDefined();
  expect(JSON.parse((await AsyncStorage.getItem('backends'))!).find((backend:Backend)=>backend.backendId===a.backendId).alias).toBe('Synthetic alias');
  await navigateTo(app.tree,'Chat');
  expect(host(app.tree,a)).toBe(first);expect(host(app.tree,b)).toBe(second);
  expect(list(first)).toBe(firstList);expect(first.findByType(DraftInput)).toBe(firstEditor);
  expect(draft(first).props.value).toBe('Retained across local alias changes');
  expect(app.streams).toHaveLength(2);expect(app.latest(a)).toBe(oldA);expect(app.latest(b)).toBe(oldB);
  expect(oldA.close).not.toHaveBeenCalled();expect(oldB.close).not.toHaveBeenCalled();
 }finally{await app.close();}
});

test('re-pairing the same backend and endpoint invalidates its old stream epoch without restarting the other backend',async()=>{
 const app=await mount();
 const setCredential=Keychain.setGenericPassword as jest.Mock;
 const originalSet=setCredential.getMockImplementation()!;
 try{
  const first=host(app.tree,a),history=list(first),oldA=app.latest(a);
  await switchBackend(app.tree,b);const second=host(app.tree,b),oldB=app.latest(b);
  await switchBackend(app.tree,a);await navigateTo(app.tree,'Workstations');
  const normal=app.fetchMock.getMockImplementation()!;
  app.fetchMock.mockImplementation(async(input,init)=>String(input)===`${a.endpoint}/v1/pair`
   ?{ok:true,status:200,json:async()=>({backendId:a.backendId,deviceId:'synthetic-new-device',credential:'synthetic-new-token'})} as Response:normal(input,init));
  setCredential.mockImplementation(async(username:string,password:string)=>{
   (Keychain.getGenericPassword as jest.Mock).mockImplementation(async(options:{service:string})=>options.service===`bob.${a.backendId}`?{username,password}:{username:'synthetic-device',password:'synthetic-token'});
   return {service:`bob.${a.backendId}`};
  });
  await act(async()=>button(first,'Add workstation').props.onPress());
  act(()=>first.findByProps({accessibilityLabel:'Pairing invitation'}).props.onChangeText(JSON.stringify({protocol:1,backendId:a.backendId,endpoint:a.endpoint,invitation:'synthetic-invitation-token-'.repeat(2),expiresAt:Date.now()+60000})));
  await act(async()=>button(first,'Pair this backend').props.onPress());
  expect(setCredential).toHaveBeenCalledWith('synthetic-new-device','synthetic-new-token',{service:`bob.${a.backendId}`,accessible:Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY});
  expect(host(app.tree,a)).toBe(first);expect(list(first)).toBe(history);expect(host(app.tree,b)).toBe(second);
  expect(activeHost(app.tree)).toBe(host(app.tree,a,'empty'));
  expect(oldA.close).toHaveBeenCalledTimes(1);expect(app.latest(a)).not.toBe(oldA);
  expect(app.latest(a).url).toBe(oldA.url);expect(app.latest(a).headers.Authorization).toBe('Bearer synthetic-new-token');
  expect(app.streams).toHaveLength(3);expect(app.latest(b)).toBe(oldB);expect(oldB.close).not.toHaveBeenCalled();
  const stale={id:99,kind:'bob.user',data:{text:'Synthetic stale pre-pair event'}};
  await act(async()=>oldA.publish!({data:JSON.stringify({backendId:a.backendId,conversationId:chat,view:{entries:[stale],docs:{}}})}));
  expect(history.props.data.some((entry:any)=>entry.id===99)).toBe(false);
  const fresh={id:4,kind:'bob.user',data:{text:'Synthetic post-pair event'}};
  await app.publish(a,{},[...entries(a),fresh]);
  expect(history.props.data.some((entry:any)=>entry.id===4)).toBe(true);
  await openNotification(a,chat);
  expect(activeHost(app.tree)).toBe(first);expect(list(first)).toBe(history);expect(app.streams).toHaveLength(3);
 }finally{setCredential.mockImplementation(originalSet);await app.close();}
});

test('real cache settings stay usable during measurement, then clear safely without losing either live session or unsent work',async()=>{
 const app=await mount();
 try{
  const first=host(app.tree,a),firstList=list(first),firstDraft=draft(first),firstStream=app.latest(a);
  await act(async()=>firstDraft.props.onChangeText('Synthetic draft survives cache cleanup'));
  act(()=>toolHeader(first).props.onPress());const expanded=toolHeader(first);pauseEarlier(first);
  await switchBackend(app.tree,b);
  const second=host(app.tree,b),secondList=list(second),secondDraft=draft(second),secondStream=app.latest(b);
  await act(async()=>secondDraft.props.onChangeText('Synthetic second draft survives'));
  await switchBackend(app.tree,a);
  const protectedCopies=new Map([
   ['notes:synthetic-recovery','{"pending":["synthetic edit"]}'],
   ['outbox:synthetic-recovery','{"message":"synthetic unsent message"}'],
   ['pending:synthetic-recovery','synthetic-request'],
  ]);
  for(const [key,value] of protectedCopies)await AsyncStorage.setItem(key,value);
  const paired=await AsyncStorage.getItem('backends');
  expect((await getCacheUsage()).history.conversations).toBeGreaterThanOrEqual(2);
  const alert=jest.spyOn(Alert,'alert').mockImplementation(()=>{});
  await navigateTo(app.tree,'Settings');
  const getKeys=AsyncStorage.getAllKeys as jest.Mock,originalGetKeys=getKeys.getMockImplementation()!;
  let releaseScan!:()=>void;const scanBlocked=new Promise<void>(resolve=>{releaseScan=resolve;});
  getKeys.mockImplementationOnce(async()=>{await scanBlocked;return originalGetKeys();});
  try{
   await act(async()=>button(activeHost(app.tree),'Storage & cache').props.onPress());
   expect(button(activeHost(app.tree),'Cache conversation history').props.disabled).toBe(false);
   expect(button(activeHost(app.tree),'Cached conversation limit').props.accessibilityValue.text).toBe('50 chats');
   expect(button(activeHost(app.tree),'Refresh usage').props.disabled).toBe(true);
   expect(button(activeHost(app.tree),'Clear downloaded chat cache').props.disabled).toBe(false);
   expect(firstStream.close).not.toHaveBeenCalled();expect(secondStream.close).not.toHaveBeenCalled();
  }finally{await act(async()=>releaseScan());}
  await act(async()=>button(activeHost(app.tree),'Clear downloaded chat cache').props.onPress());
  const confirmation=alert.mock.calls.at(-1)![2]!.find(item=>item.style==='destructive')!;
  await act(async()=>{confirmation.onPress!();await getCacheUsage();});
  expect((await getCacheUsage()).totalBytes).toBe(0);
  await act(async()=>{await updateCachePreferences({history:false,chatLists:false,maxConversations:1});});
  await app.publish(b,{},[...entries(b),{id:4,kind:'pi.assistant',model:[{role:'assistant',content:'Synthetic live update with disk cache disabled'}]}]);
  expect((await getCacheUsage()).totalBytes).toBe(0);
  await navigateTo(app.tree,'Chat');
  expect(host(app.tree,a)).toBe(first);expect(host(app.tree,b)).toBe(second);
  expect(list(first)).toBe(firstList);expect(list(second)).toBe(secondList);
  expect(draft(first)).toBe(firstDraft);expect(draft(second)).toBe(secondDraft);
  expect(firstDraft.props.value).toBe('Synthetic draft survives cache cleanup');
  expect(secondDraft.props.value).toBe('Synthetic second draft survives');
  expect(toolHeader(first)).toBe(expanded);expect(expanded.props.accessibilityState.expanded).toBe(true);
  expect(firstList.props.maintainVisibleContentPosition).toEqual({minIndexForVisible:0});
  expect(secondList.props.data.some((item:any)=>item.id===4)).toBe(true);
  expect(firstStream.close).not.toHaveBeenCalled();expect(secondStream.close).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem('backends')).toBe(paired);
  for(const [key,value] of protectedCopies)expect(await AsyncStorage.getItem(key)).toBe(value);
 }finally{await app.close();await updateCachePreferences({...DEFAULT_CACHE_PREFERENCES});}
});


test('Tools uses the selected workstation without replacing retained sessions, and guided setup appends only to the current draft',async()=>{
 const app=await mount();
 try{
  const first=host(app.tree,a),firstList=list(first),firstEditor=first.findByType(DraftInput),firstStream=app.latest(a);
  await act(async()=>draft(first).props.onChangeText('Existing draft A'));
  await navigateTo(app.tree,'Tools');
  const toolsA=first.findByType(ToolsScreen);
  expect(toolsA.props).toMatchObject({backendId:a.backendId,workstationName:a.alias,conversationId:chat,active:true,readOnly:false});
  const staleGuide=toolsA.props.onAskBob;
  expect(app.fetchMock.mock.calls.some(([url])=>String(url)===`${a.endpoint}/v1/chats/${chat}/modules`)).toBe(true);
  await switchBackend(app.tree,b);
  const second=host(app.tree,b),secondList=list(second),secondEditor=second.findByType(DraftInput),secondStream=app.latest(b);
  await act(async()=>draft(second).props.onChangeText('Existing draft B'));
  await navigateTo(app.tree,'Tools');
  const toolsB=second.findByType(ToolsScreen);
  expect(toolsB.props).toMatchObject({backendId:b.backendId,workstationName:b.alias,conversationId:chat,active:true,readOnly:false});
  expect(app.fetchMock.mock.calls.some(([url])=>String(url)===`${b.endpoint}/v1/mcp-connections`)).toBe(true);
  await act(async()=>staleGuide());
  expect(draft(first).props.value).toBe('Existing draft A');expect(draft(second).props.value).toBe('Existing draft B');
  await act(async()=>toolsB.props.onAskBob());
  expect(draft(second).props.value).toMatch(/^Existing draft B\n\nHelp me add a Bob tool or integration\./);
  expect(draft(second).props.value).toContain('bob-tool-extension-development');
  expect(second.findAllByType(ToolsScreen)).toHaveLength(0);
  expect(app.fetchMock.mock.calls.filter(([url,options])=>String(url).endsWith('/messages')&&options?.method==='POST')).toHaveLength(0);
  expect(app.fetchMock.mock.calls.filter(([url,options])=>/\/(modules|mcp-connections)$/.test(String(url))&&['PUT','DELETE'].includes(options?.method??''))).toHaveLength(0);
  expect(list(first)).toBe(firstList);expect(first.findByType(DraftInput)).toBe(firstEditor);
  expect(list(second)).toBe(secondList);expect(second.findByType(DraftInput)).toBe(secondEditor);
  expect(firstStream.close).not.toHaveBeenCalled();expect(secondStream.close).not.toHaveBeenCalled();
  await switchBackend(app.tree,a);await act(async()=>staleGuide());
  expect(draft(first).props.value).toBe('Existing draft A');
  expect(host(app.tree,a)).toBe(first);expect(host(app.tree,b)).toBe(second);
 }finally{await app.close();}
});


test('pending connection saves remain owned across two retained chats on the same workstation',async()=>{
 const app=await mount();
 let releaseWrite:(()=>void)|undefined;
 try{
  let saved={id:'example-service',endpoint:'https://service.example/mcp',allowedTools:['lookup'],enabled:false};
  let writes=0;
  const original=app.fetchMock.getMockImplementation()!;
  app.fetchMock.mockImplementation(async(input:any,options?:any)=>{
   const url=String(input);
   if(url===`${a.endpoint}/v1/chats`)return {ok:true,status:200,json:async()=>({items:[{id:7,meta:{title:'First synthetic chat'}},{id:8,meta:{title:'Second synthetic chat'}}]})} as Response;
   if(url===`${a.endpoint}/v1/mcp-connections`){
    if(options?.method==='PUT'){
     ++writes;const submitted=JSON.parse(options.body);
     if(writes===1)await new Promise<void>(resolve=>{releaseWrite=()=>{saved=submitted;resolve();};});
     else saved=submitted;
     return {ok:true,status:200,json:async()=>saved} as Response;
    }
    return {ok:true,status:200,json:async()=>[saved]} as Response;
   }
   return original(input,options);
  });
  const first=host(app.tree,a),firstList=list(first),firstEditor=first.findByType(DraftInput),firstStream=app.latest(a);
  await act(async()=>draft(first).props.onChangeText('Keep first draft'));
  await navigateTo(app.tree,'Tools');
  await act(async()=>button(first,'Connections').props.onPress());
  await act(async()=>button(first,'Details for connection example-service').props.onPress());
  await act(async()=>button(first,'Enable example-service').props.onPress());
  await act(async()=>button(first,'Confirm tool change').props.onPress());
  expect(writes).toBe(1);expect(releaseWrite).toBeDefined();
  await openNotification(a,8);
  const second=host(app.tree,a,8);
  await act(async()=>draft(second).props.onChangeText('Keep second draft'));
  await navigateTo(app.tree,'Tools');
  await act(async()=>button(second,'Connections').props.onPress());
  await act(async()=>button(second,'Details for connection example-service').props.onPress());
  const heldEnable=button(second,'Enable example-service');
  expect(heldEnable.props.disabled??heldEnable.props.accessibilityState?.disabled).toBe(true);
  await act(async()=>heldEnable.props.onPress());expect(writes).toBe(1);
  await act(async()=>releaseWrite!());releaseWrite=undefined;
  // An earlier GET cannot reconcile a later-completing write. Only a fresh
  // post-settlement read may enable another explicitly confirmed change.
  expect(button(second,'Enable example-service').props.disabled??button(second,'Enable example-service').props.accessibilityState?.disabled).toBe(true);
  await act(async()=>button(second,'Refresh connections').props.onPress());
  const disable=button(second,'Disable example-service');
  expect(disable.props.disabled??disable.props.accessibilityState?.disabled).toBe(false);
  await act(async()=>disable.props.onPress());await act(async()=>button(second,'Confirm tool change').props.onPress());
  expect(writes).toBe(2);expect(saved.enabled).toBe(false);
  expect(draft(first).props.value).toBe('Keep first draft');expect(draft(second).props.value).toBe('Keep second draft');
  expect(list(first)).toBe(firstList);expect(first.findByType(DraftInput)).toBe(firstEditor);expect(firstStream.close).not.toHaveBeenCalled();
 }finally{if(releaseWrite)await act(async()=>releaseWrite!());await app.close();}
});

test('continuous native stream survives lock/return without a new GET or history reload and preserves the actual viewport and draft',async()=>{
 const app=await mount({continuous:true});
 try{
  const first=host(app.tree,a),history=list(first),editor=draft(first);
  await act(async()=>{editor.props.onChangeText('Keep my draft during lock');editor.props.onSelectionChange?.({nativeEvent:{selection:{start:4,end:4}}});});
  pauseEarlier(first);
  const streams=app.streams.length,historyReads=()=>app.fetchMock.mock.calls.filter(([url])=>String(url).includes('/history')).length,reads=historyReads();
  const nativeReads=app.connection.readStream!.mock.calls.length;
  await app.transition('background');
  const items=[...entries(a),{id:4,kind:'pi.assistant',model:[{role:'assistant',content:'Received continuously while the phone is locked'}]}];
  await app.publishNative({},items);
  expect(app.connection.readStream).toHaveBeenCalledTimes(nativeReads);expect(app.connection.releaseStream).not.toHaveBeenCalled();expect(app.connection.stop).not.toHaveBeenCalled();
  await app.transition('active');
  expect(app.streams).toHaveLength(streams);expect(historyReads()).toBe(reads);
  expect(list(first)).toBe(history);expect(draft(first)).toBe(editor);expect(editor.props.value).toBe('Keep my draft during lock');
  expect(history.props.data.some((entry:any)=>entry.id===4)).toBe(true);expect(button(first,'Scroll to latest message')).toBeDefined();
  expect(app.phone.execute).not.toHaveBeenCalled();expect(app.fetchMock.mock.calls.filter(([url])=>String(url).endsWith('/messages'))).toHaveLength(0);
 }finally{await app.close();}
});
test('continuous mode recovers history after a genuine native reconnect, not for a mere foreground transition',async()=>{
 const app=await mount({continuous:true});
 try{
  const reads=()=>app.fetchMock.mock.calls.filter(([url])=>String(url).includes('/history')).length,before=reads();
  await app.transition('background');await app.publishNative({},entries(a),2);await app.transition('active');
  expect(reads()).toBe(before+1);
  await app.transition('background');await app.transition('active');expect(reads()).toBe(before+1);
 }finally{await app.close();}
});
test('notification Turn off restores foreground streaming without replacing the chat or draft',async()=>{
 const app=await mount({continuous:true});
 try{
  const first=host(app.tree,a),history=list(first),editor=draft(first);await act(async()=>editor.props.onChangeText('Still here'));
  const streams=app.streams.length;
  await act(async()=>{await app.connection.stop();DeviceEventEmitter.emit('BobConnectionState',{backendId:a.backendId,conversationId:chat});});
  expect(app.streams).toHaveLength(streams+1);expect(app.connection.releaseStream).toHaveBeenCalled();expect(list(first)).toBe(history);expect(draft(first)).toBe(editor);expect(editor.props.value).toBe('Still here');
 }finally{await app.close();}
});

test.each(['identity','entries','docs','json'])('App rejects invalid continuous %s before rendering or accepting its native revision',async(kind)=>{
 const app=await mount({continuous:true});
 try{
  const first=host(app.tree,a),history=list(first),editor=draft(first);
  const payload={backendId:kind==='identity'?b.backendId:a.backendId,conversationId:chat,view:{entries:kind==='entries'?{}:[{id:999,kind:'bob.user',data:{text:'Must not appear'}}],docs:kind==='docs'?[]:{}}};
  await app.publishNativeRaw(kind==='json'?'{broken':JSON.stringify(payload));
  expect(list(first)).toBe(history);expect(draft(first)).toBe(editor);expect(history.props.data.some((entry:any)=>entry.id===999)).toBe(false);
  if(kind==='identity')expect(app.connection.releaseStream).toHaveBeenCalled();
  else{
   expect(first.findAll(node=>node.props.children==='Connection needs attention').length).toBeGreaterThan(0);
   await app.publishNative();expect(app.connection.readStream!.mock.calls.at(-1)![3]).toBe(1);
  }
 }finally{await app.close();}
});

test('one update owner survives empty/live and retained-chat switches without reopening reads or duplicating download',async()=>{
 const updates:BuildState={enabled:true,jobs:[],apk:{releaseId:'example-release',sha256:'a'.repeat(64),size:1000,versionCode:2,versionName:'2.0'}};
 const app=await mount({emptyA:true,updates});
 try{
  await navigateTo(app.tree,'Chat');
  const owner=app.tree.root.findByType(BuildCard),reads=app.fetchMock.mock.calls.filter(([url])=>String(url).endsWith('/updates')).length;
  const popup=()=>app.tree.root.findByType(UpdatePopover);
  expect(popup().props.visible).toBe(false);
  await act(async()=>button(app.tree.root,'App update status').props.onPress());
  expect(popup().props.visible).toBe(true);
  act(()=>button(app.tree.root.findByProps({testID:'overlay-active'}),'Close update bubble').props.onPress());
  await openNotification(a,chat);
  const first=host(app.tree,a),history=list(first),editor=draft(first),stream=app.latest(a);
  pauseEarlier(first);const scroll=jest.spyOn(history.instance,'scrollToOffset').mockImplementation(()=>{});
  await act(async()=>editor.props.onChangeText('Keep this update-time draft'));
  act(()=>DeviceEventEmitter.emit('BobKeyboardInset',{imeBottom:280}));
  for(let i=0;i<3;i++){
   await act(async()=>button(app.tree.root,'App update status').props.onPress());
   await act(async()=>button(app.tree.root,'Close updates').props.onPress());
  }
  await navigateTo(app.tree,'Settings');
  await act(async()=>button(first,'App & updates').props.onPress());
  await act(async()=>button(first,'Build & install').props.onPress());
  expect(popup().props.visible).toBe(true);expect(button(app.tree.root,'Build app')).toBeDefined();
  await act(async()=>button(app.tree.root,'Close updates').props.onPress());
  await navigateTo(app.tree,'Chat');
  await openNotification(a,8);await openNotification(a,chat);
  expect(app.tree.root.findAllByType(BuildCard)).toHaveLength(1);expect(app.tree.root.findByType(BuildCard)).toBe(owner);
  expect(app.fetchMock.mock.calls.filter(([url])=>String(url).endsWith('/updates'))).toHaveLength(reads);
  expect(draft(first)).toBe(editor);expect(editor.props.value).toBe('Keep this update-time draft');expect(list(first)).toBe(history);
  expect(history.props.maintainVisibleContentPosition).toEqual({minIndexForVisible:0});expect(scroll).not.toHaveBeenCalled();
  expect(app.latest(a)).toBe(stream);expect(stream.close).not.toHaveBeenCalled();
  expect(NativeModules.BobFiles.installUpdate).not.toHaveBeenCalled();expect(popup().props.visible).toBe(false);
  expect(app.fetchMock.mock.calls.filter(([,init])=>init?.method==='POST'&&String(init?.body).includes('app-'))).toHaveLength(0);
 }finally{await app.close();}
});

// Real section navigation, transport and cache: request totals, not a timing proxy.
test('library reopen/sibling routes reuse one read; mutation and explicit refresh each force authoritative readback',async()=>{
 const app=await mount();
 try{
  const fetch=app.fetchMock.getMockImplementation()!,requests:string[]=[];let saved={instructions:'Synthetic defaults',templates:{},skills:{}};
  app.fetchMock.mockImplementation(async(input:any,init:any)=>{if(String(input).endsWith('/library')){requests.push(init.method);if(init.method==='PATCH'){const change=JSON.parse(init.body);if(change.field==='instructions')saved={...saved,instructions:change.value};}return{ok:true,status:200,json:async()=>saved} as Response;}return fetch(input,init);});
  const root=activeHost(app.tree),editor=draft(root),history=list(root),stream=app.latest(a);
  await act(async()=>editor.props.onChangeText('Keep my composer'));
  await navigateTo(app.tree,'Settings');
  expect(root.findAllByType(SettingsHome)).toHaveLength(1);expect(root.findAllByProps({testID:'update-indicator-anchor'})).toHaveLength(0);
  expect(root.findAllByProps({accessibilityLabel:'App update status'})).toHaveLength(0);
  await act(async()=>button(root,'Instructions & templates').props.onPress());
  expect(root.findByProps({accessibilityLabel:'Backend default instructions'}).props.value).toBe('Synthetic defaults');
  await act(async()=>button(root,'Back to previous menu').props.onPress());
  await act(async()=>button(root,'Skills').props.onPress());expect(requests).toEqual(['GET']);
  await act(async()=>button(root,'Back to previous menu').props.onPress());
  await act(async()=>button(root,'Instructions & templates').props.onPress());expect(requests).toEqual(['GET']);
  expect(root.findAllByProps({testID:'section-loading-overlay'})).toHaveLength(0);
  await act(async()=>root.findByProps({accessibilityLabel:'Backend default instructions'}).props.onChangeText('Updated defaults'));
  await act(async()=>button(root,'Save instructions').props.onPress());expect(requests).toEqual(['GET','PATCH','GET']);
  await act(async()=>button(root,'Back to previous menu').props.onPress());await act(async()=>button(root,'Instructions & templates').props.onPress());
  expect(root.findByProps({accessibilityLabel:'Backend default instructions'}).props.value).toBe('Updated defaults');expect(requests).toEqual(['GET','PATCH','GET']);
  await act(async()=>button(root,'Refresh library').props.onPress());expect(requests).toEqual(['GET','PATCH','GET','GET']);
  await navigateTo(app.tree,'Chat');expect(draft(root)).toBe(editor);expect(editor.props.value).toBe('Keep my composer');expect(list(root)).toBe(history);expect(app.latest(a)).toBe(stream);expect(stream.close).not.toHaveBeenCalled();
 }finally{await app.close();}
});

test('Tasks navigation shows the active conversation list and writes synthetic edits',async()=>{
 const app=await mount();
 try{
  const root=activeHost(app.tree);
  await app.publish(a,{'bob.todos':{items:[{text:'Synthetic task',done:false}]}});
  await navigateTo(app.tree,'Tasks');
  expect(button(root,'○ Synthetic task')).toBeDefined();
  await act(async()=>button(root,'○ Synthetic task').props.onPress());
  const writes=app.fetchMock.mock.calls.filter(([url,init])=>String(url).endsWith(`/chats/${chat}/todos`)&&init?.method==='PUT');
  expect(writes).toHaveLength(1);
  expect(JSON.parse(writes[0][1]!.body as string).items).toEqual([{text:'Synthetic task',done:true}]);
  await app.publish(a,{'bob.todos':{items:[]}});
  expect(root.findAllByProps({accessibilityLabel:'○ Synthetic task'})).toHaveLength(0);
  await act(async()=>root.findByProps({accessibilityLabel:'New todo'}).props.onChangeText('Another synthetic task'));
  await act(async()=>button(root,'Add todo').props.onPress());
  const added=app.fetchMock.mock.calls.filter(([url,init])=>String(url).endsWith(`/chats/${chat}/todos`)&&init?.method==='PUT');
  expect(JSON.parse(added[1][1]!.body as string).items).toEqual([{text:'Another synthetic task',done:false}]);
  await app.publish(a,{'bob.todos':{items:[{text:'Another synthetic task',done:false}]}});
  await act(async()=>button(root,'Remove task 1').props.onPress());
  const removed=app.fetchMock.mock.calls.filter(([url,init])=>String(url).endsWith(`/chats/${chat}/todos`)&&init?.method==='PUT');
  expect(JSON.parse(removed[2][1]!.body as string).items).toEqual([]);
  await navigateTo(app.tree,'Chat');
  expect(activeHost(app.tree)).toBe(root);
 }finally{await app.close();}
});

test('using a template retains the existing composer draft',async()=>{
 const app=await mount();
 try{
  const fetch=app.fetchMock.getMockImplementation()!;
  app.fetchMock.mockImplementation(async(input:any,init:any)=>String(input).endsWith('/library')?{ok:true,status:200,json:async()=>({instructions:'',templates:{Example:'Template body'},skills:{}})} as Response:fetch(input,init));
  const root=activeHost(app.tree),editor=draft(root);
  await act(async()=>editor.props.onChangeText('Unsent original'));
  await navigateTo(app.tree,'Settings');
  await act(async()=>button(root,'Instructions & templates').props.onPress());
  await act(async()=>button(root,'Use template Example').props.onPress());
  expect(draft(root)).toBe(editor);
  expect(editor.props.value).toBe('Unsent original\n\nTemplate body');
 }finally{await app.close();}
});

test('library in-flight dedup survives route races, offline retry and backend switches without cross-backend content',async()=>{
 const app=await mount();let release:((value:Response)=>void)|undefined;
 try{
  const fetch=app.fetchMock.getMockImplementation()!,reads={a:0,b:0};let offline=true;
  app.fetchMock.mockImplementation(async(input:any,init:any)=>{
   if(String(input).endsWith('/library')){const current=String(input).startsWith(a.endpoint)?'a':'b';reads[current]++;
    if(current==='b')return{ok:true,status:200,json:async()=>({instructions:'B only',templates:{},skills:{}})} as Response;
    if(offline)throw Error('Synthetic library offline');
    return new Promise<Response>(resolve=>{release=resolve;});
   }return fetch(input,init);
  });
  const first=activeHost(app.tree);await navigateTo(app.tree,'Settings');await act(async()=>button(first,'Instructions & templates').props.onPress());
  expect(reads.a).toBe(1);expect(button(first,'Retry loading')).toBeDefined();offline=false;
  await act(async()=>button(first,'Retry loading').props.onPress());expect(reads.a).toBe(2);
  expect(first.findAllByProps({testID:'section-loading-overlay'}).length).toBeGreaterThan(0);
  await act(async()=>button(first,'Back to previous menu').props.onPress());await act(async()=>button(first,'Skills').props.onPress());expect(reads.a).toBe(2);
  await switchBackend(app.tree,b);const second=activeHost(app.tree);await navigateTo(app.tree,'Settings');await act(async()=>button(second,'Instructions & templates').props.onPress());
  expect(reads.b).toBe(1);expect(second.findByProps({accessibilityLabel:'Backend default instructions'}).props.value).toBe('B only');
  await act(async()=>release!({ok:true,status:200,json:async()=>({instructions:'A only',templates:{},skills:{}})} as Response));release=undefined;
  expect(activeHost(app.tree)).toBe(second);expect(second.findByProps({accessibilityLabel:'Backend default instructions'}).props.value).toBe('B only');
  await switchBackend(app.tree,a);await navigateTo(app.tree,'Settings');await act(async()=>button(first,'Instructions & templates').props.onPress());
  expect(reads.a).toBe(2);expect(first.findByProps({accessibilityLabel:'Backend default instructions'}).props.value).toBe('A only');
 }finally{if(release)await act(async()=>release!({ok:true,status:200,json:async()=>({instructions:'cleanup',templates:{},skills:{}})} as Response));await app.close();}
});

test('model catalog reopens without another read while conversation config is always fresh, including after Apply',async()=>{
 const app=await mount();
 try{
  const fetch=app.fetchMock.getMockImplementation()!;let catalogs=0,configReads=0;let configured={instructions:null,cwd:'/example',model:{provider:'example',modelId:'fast'},thinkingLevel:'medium'};
  app.fetchMock.mockImplementation(async(input:any,init:any)=>{const url=String(input);
   if(url.endsWith('/models')){catalogs++;return{ok:true,status:200,json:async()=>[{provider:'example',modelId:'fast',name:'Synthetic fast',thinkingLevels:['medium','high']}]} as Response;}
   if(url.endsWith('/configure')){if(init.method==='GET')configReads++;else configured={...configured,...JSON.parse(init.body)};return{ok:true,status:200,json:async()=>configured} as Response;}
   return fetch(input,init);
  });
  const root=activeHost(app.tree);const open=async()=>{await act(async()=>button(root,'Chat actions').props.onPress());await act(async()=>button(app.tree.root.findByProps({testID:'overlay-active'}),'Model & thinking').props.onPress());};
  await open();expect(catalogs).toBe(1);expect(configReads).toBe(1);expect(root.findByType(VoiceInputButton).props.active).toBe(false);
  await act(async()=>root.findByType(ModelPicker).props.onClose());await open();expect(catalogs).toBe(1);expect(configReads).toBe(2);
  await act(async()=>button(app.tree.root.findByProps({testID:'overlay-active'}),'Select Synthetic fast (example)').props.onPress());await act(async()=>button(app.tree.root.findByProps({testID:'overlay-active'}),'High thinking').props.onPress());await act(async()=>button(app.tree.root.findByProps({testID:'overlay-active'}),'Apply model selection').props.onPress());
  expect(configured.thinkingLevel).toBe('high');expect(configReads).toBe(3);await open();expect(configReads).toBe(4);expect(catalogs).toBe(1);
  await act(async()=>root.findByType(ModelPicker).props.onClose());
  await navigateTo(app.tree,'Settings');await act(async()=>button(root,'Advanced').props.onPress());await act(async()=>button(root,'Provider connection').props.onPress());await act(async()=>button(root,'Configure backend provider').props.onPress());
  await navigateTo(app.tree,'Chat');await open();expect(catalogs).toBe(2);expect(configReads).toBe(5);
 }finally{await app.close();}
});

test('dictation appends to the latest functional draft without sending, rejects old visible visits and hides outside foreground ordinary Chat',async()=>{
 const app=await mount();
 try{
  const root=activeHost(app.tree),editor=draft(root),voice=root.findByType(VoiceInputButton);
  expect(voice.props.active).toBe(true);expect(voice.props.scope).toContain(a.backendId);expect(voice.props.scope).toContain(a.endpoint);
  const old=voice.props.onTranscript;await act(async()=>editor.props.onChangeText('Typed while listening'));
  await act(async()=>old('one final utterance'));expect(editor.props.value).toBe('Typed while listening one final utterance');
  expect(app.fetchMock.mock.calls.some(([url])=>String(url).endsWith('/messages'))).toBe(false);
  await navigateTo(app.tree,'Settings');expect(voice.props.active).toBe(false);await act(async()=>old('stale result'));expect(editor.props.value).not.toContain('stale');
  await navigateTo(app.tree,'Chat');expect(voice.props.active).toBe(true);await act(async()=>old('stale after return'));expect(editor.props.value).not.toContain('stale');
  const beforeBackground=voice.props.onTranscript;await app.transition('background');expect(voice.props.active).toBe(false);await app.transition('active');expect(voice.props.active).toBe(true);
  await act(async()=>beforeBackground('late background result'));expect(editor.props.value).not.toContain('late');
  const beforeSwitch=voice.props.onTranscript;await switchBackend(app.tree,b);const next=activeHost(app.tree);expect(root.findByType(VoiceInputButton).props.active).toBe(false);expect(next.findByType(VoiceInputButton).props.scope).not.toBe(voice.props.scope);
  await act(async()=>beforeSwitch('wrong chat'));expect(draft(next).props.value).toBe('');expect(editor.props.value).not.toContain('wrong');
 }finally{await app.close();}
});

test('expanded editor and library/Settings Back preserve draft and deactivate dictation until the source composer is visible again',async()=>{
 const app=await mount();
 try{
  const root=activeHost(app.tree),editor=draft(root),voice=root.findByType(VoiceInputButton),history=list(root);
  await act(async()=>editor.props.onChangeText('Editable long draft\nwith selection left to native input'));
  act(()=>DeviceEventEmitter.emit('BobKeyboardInset',{imeBottom:300}));
  act(()=>editor.props.onContentSizeChange({nativeEvent:{contentSize:{height:100}}}));
  await act(async()=>button(root,'Expand message editor').props.onPress());expect(voice.props.active).toBe(false);
  await act(async()=>button(app.tree.root.findByProps({testID:'overlay-active'}),'Collapse message editor').props.onPress());expect(voice.props.active).toBe(true);
  await navigateTo(app.tree,'Settings');expect(voice.props.active).toBe(false);
  await act(async()=>button(root,'Appearance').props.onPress());await act(async()=>button(root,'Back to previous menu').props.onPress());expect(root.findAllByType(SettingsHome)).toHaveLength(1);
  await act(async()=>button(root,'Back to previous menu').props.onPress());expect(voice.props.active).toBe(true);
  expect(draft(root)).toBe(editor);expect(list(root)).toBe(history);expect(editor.props.value).toContain('Editable long draft');
 }finally{await app.close();}
});


test('update indicator and management revoke native capture; late finals cannot enter this or a retained replacement chat',async()=>{
 const native={windowFocused:jest.fn(async()=>true),availability:jest.fn(async()=>'onDevice'),start:jest.fn(async(_id:string,_mode:string,_consent:boolean)=>{}),finish:jest.fn(async(_id:string)=>{}),cancel:jest.fn(async(id:string)=>{
  // Native may synchronously flush a final while cancellation is being delivered.
  DeviceEventEmitter.emit('BobVoiceInputState',{id,state:'final',text:'Final during cancel must be ignored'});
 }),addListener:jest.fn(),removeListeners:jest.fn()};
 NativeModules.BobVoiceInput=native;delete NativeModules.BobSpeech;
 jest.spyOn(PermissionsAndroid,'request').mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
 const app=await mount({updates:{enabled:false}});
 const popup=()=>app.tree.root.findByType(UpdatePopover);
 const listen=async()=>{await act(async()=>button(activeHost(app.tree),'Dictate message').props.onPress());const id=native.start.mock.calls.at(-1)![0];act(()=>DeviceEventEmitter.emit('BobVoiceInputState',{id,state:'listening'}));return id;};
 const final=async(id:string,text='Old final must be ignored')=>act(async()=>DeviceEventEmitter.emit('BobVoiceInputState',{id,state:'final',text}));
 try{
  const first=activeHost(app.tree),editor=draft(first),history=list(first),voice=first.findByType(VoiceInputButton),owner=app.tree.root.findByType(BuildCard),stream=app.latest(a);
  await act(async()=>editor.props.onChangeText('Keep typed edits'));const stale=voice.props.onTranscript,retiredVisibility=owner.props.onVisibilityChange;
  const id=await listen();expect(button(first,'Finish dictation')).toBeDefined();
  await act(async()=>button(app.tree.root,'App update status').props.onPress());expect(popup().props.visible).toBe(true);expect(voice.props.active).toBe(false);expect(native.cancel).toHaveBeenCalledWith(id);
  await final(id);await act(async()=>stale('Stale parent result'));expect(editor.props.value).toBe('Keep typed edits');
  await act(async()=>button(app.tree.root,'Close update bubble').props.onPress());expect(popup().props.visible).toBe(false);expect(voice.props.active).toBe(true);
  await final(id);await act(async()=>stale('Stale result after close'));expect(editor.props.value).toBe('Keep typed edits');expect(native.start).toHaveBeenCalledTimes(1);
  const fresh=await listen();await final(fresh,'fresh final');await final(fresh,'duplicate final');expect(editor.props.value).toBe('Keep typed edits fresh final');
  // The existing Chat actions management route must also cancel a live microphone.
  const managementId=await listen();await act(async()=>button(first,'Chat actions').props.onPress());expect(native.cancel).toHaveBeenCalledWith(managementId);
  await act(async()=>button(app.tree.root.findByProps({testID:'overlay-active'}),'More').props.onPress());await act(async()=>button(app.tree.root.findByProps({testID:'overlay-active'}),'Build & install').props.onPress());
  expect(popup().props.visible).toBe(true);expect(button(app.tree.root,'Build app')).toBeDefined();expect(voice.props.active).toBe(false);
  await final(managementId);await act(async()=>button(app.tree.root,'Close update bubble').props.onPress());expect(voice.props.active).toBe(true);
  // Explicit Settings management stays open across a same-chat notification.
  await navigateTo(app.tree,'Settings');await act(async()=>button(first,'App & updates').props.onPress());await act(async()=>button(first,'Build & install').props.onPress());
  await openNotification(a,chat);expect(activeHost(app.tree)).toBe(first);expect(popup().props.visible).toBe(true);expect(voice.props.active).toBe(false);
  await final(managementId);await act(async()=>button(app.tree.root,'Close update bubble').props.onPress());expect(voice.props.active).toBe(true);
  // A notification can select a retained chat while presentation owns the overlay.
  await act(async()=>button(app.tree.root,'App update status').props.onPress());
  await openNotification(a,8);const second=activeHost(app.tree);expect(second).not.toBe(first);
  expect(first.findByType(VoiceInputButton).props.active).toBe(false);
  if(popup().props.visible){expect(second.findByType(VoiceInputButton).props.active).toBe(false);await act(async()=>button(app.tree.root,'Close update bubble').props.onPress());}
  expect(second.findByType(VoiceInputButton).props.active).toBe(true);expect(app.tree.root.findByType(BuildCard)).toBe(owner);
  await final(id);expect(draft(second).props.value).toBe('');
  const secondId=await listen();await act(async()=>button(app.tree.root,'App update status').props.onPress());expect(native.cancel).toHaveBeenCalledWith(secondId);
  // Make the original one of the two retained slots before selecting a third chat.
  await openNotification(a,chat);expect(activeHost(app.tree)).toBe(first);
  await openNotification(b,chat);const other=activeHost(app.tree);expect(popup().props.visible).toBe(false);expect(other.findByType(VoiceInputButton).props.active).toBe(true);
  await final(secondId);expect(draft(other).props.value).toBe('');
  const otherId=await listen();await act(async()=>button(app.tree.root,'App update status').props.onPress());expect(native.cancel).toHaveBeenCalledWith(otherId);
  await act(async()=>retiredVisibility(false));expect(popup().props.visible).toBe(true);expect(other.findByType(VoiceInputButton).props.active).toBe(false);
  await final(otherId);await act(async()=>button(app.tree.root,'Close update bubble').props.onPress());
  await act(async()=>retiredVisibility(true));expect(popup().props.visible).toBe(false);expect(other.findByType(VoiceInputButton).props.active).toBe(true);expect(draft(other).props.value).toBe('');
  await openNotification(a,chat);expect(activeHost(app.tree)).toBe(first);expect(draft(first)).toBe(editor);expect(list(first)).toBe(history);expect(editor.props.value).toBe('Keep typed edits fresh final');
  const resumedId=await listen();await act(async()=>button(app.tree.root,'App update status').props.onPress());expect(native.cancel).toHaveBeenCalledWith(resumedId);
  await act(async()=>retiredVisibility(false));expect(popup().props.visible).toBe(true);expect(voice.props.active).toBe(false); // A→B→A retires the old callback too.
  await final(resumedId);await act(async()=>button(app.tree.root,'Close update bubble').props.onPress());expect(voice.props.active).toBe(true);expect(editor.props.value).toBe('Keep typed edits fresh final');
  expect(app.latest(a)).toBe(stream);expect(stream.close).not.toHaveBeenCalled();
  expect(NativeModules.BobFiles.installUpdate).not.toHaveBeenCalled();expect(app.fetchMock.mock.calls.some(([,init])=>init?.method==='POST'&&String(init?.body).includes('app-'))).toBe(false);
 }finally{await app.close();}
});


test.each(['listening','availability','permission','focus','speech'] as const)('Send retires %s dictation before any await and across fast settlement',async phase=>{
 let release!:()=>void;
 const blocked=new Promise<void>(resolve=>{release=resolve;});
 const native={windowFocused:jest.fn(async()=>{if(phase==='focus')await blocked;return true;}),availability:jest.fn(async()=>{if(phase==='availability')await blocked;return 'onDevice';}),start:jest.fn(async(_id:string,_mode:string,_consent:boolean)=>{}),finish:jest.fn(async()=>{}),cancel:jest.fn(async(id:string)=>{
  DeviceEventEmitter.emit('BobVoiceInputState',{id,state:'final',text:'Final flushed by cancel'});
 }),addListener:jest.fn(),removeListeners:jest.fn()};
 NativeModules.BobVoiceInput=native;
 NativeModules.BobSpeech={stop:jest.fn(async()=>{if(phase==='speech')await blocked;}),addListener:jest.fn(),removeListeners:jest.fn()};
 jest.spyOn(PermissionsAndroid,'request').mockImplementation(async()=>{if(phase==='permission')await blocked;return PermissionsAndroid.RESULTS.GRANTED;});
 const app=await mount();
 try{
  const root=activeHost(app.tree),editor=draft(root),history=list(root),stream=app.latest(a),voice=root.findByType(VoiceInputButton);
  await act(async()=>editor.props.onChangeText('Typed to send'));
  const oldScope=voice.props.scope,oldTranscript=voice.props.onTranscript;
  await act(async()=>button(root,'Dictate message').props.onPress());
  if(phase==='listening')act(()=>DeviceEventEmitter.emit('BobVoiceInputState',{id:native.start.mock.calls[0][0],state:'listening'}));
  else{expect(native.start).not.toHaveBeenCalled();expect(button(root,'Cancel dictation setup')).toBeDefined();}
  await act(async()=>{
   button(root,'Send message').props.onPress();
   // Same JS turn, before React can propagate a new scope to the voice child.
   oldTranscript('Synchronous final after Send admission');
  });
  expect(editor.props.value).toBe('');expect(native.cancel).toHaveBeenCalledTimes(1);
  const id=native.cancel.mock.calls[0][0];
  expect(voice.props.scope).not.toBe(oldScope);expect(voice.props.active).toBe(true);
  await act(async()=>{release();});
  await act(async()=>{DeviceEventEmitter.emit('BobVoiceInputState',{id,state:'final',text:'Words after Send'});oldTranscript('Late parent final after settlement');});
  expect(editor.props.value).toBe('');expect(native.start).toHaveBeenCalledTimes(phase==='listening'?1:0);
  expect(button(root,'Dictate message')).toBeDefined();
  const messages=app.fetchMock.mock.calls.filter(([url,init])=>String(url).endsWith('/messages')&&init?.method==='POST');
  expect(messages).toHaveLength(1);expect(JSON.parse(messages[0][1]!.body as string)).toMatchObject({text:'Typed to send',requestId:expect.any(String)});
  const sentScope=voice.props.scope;
  // Returning to this retained chat must not resurrect pre-send parent ownership.
  await openNotification(a,8);await openNotification(a,chat);
  await act(async()=>oldTranscript('Stale final after retained return'));
  expect(draft(root)).toBe(editor);expect(editor.props.value).toBe('');expect(list(root)).toBe(history);expect(app.latest(a)).toBe(stream);expect(stream.close).not.toHaveBeenCalled();
  expect(voice.props.scope).not.toBe(sentScope);expect(native.start).toHaveBeenCalledTimes(phase==='listening'?1:0);
 }finally{release();await app.close();}
});

test('actual command suggestions cancel capture, fence old generations and never restart on dismissal or retained return',async()=>{
 const native={windowFocused:jest.fn(async()=>true),availability:jest.fn(async()=>'onDevice'),start:jest.fn(async(_id:string,_mode:string,_consent:boolean)=>{}),finish:jest.fn(async()=>{}),cancel:jest.fn(async(id:string)=>{
  DeviceEventEmitter.emit('BobVoiceInputState',{id,state:'final',text:'Final flushed by suggestions cancel'});
 }),addListener:jest.fn(),removeListeners:jest.fn()};
 NativeModules.BobVoiceInput=native;delete NativeModules.BobSpeech;
 jest.spyOn(PermissionsAndroid,'request').mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
 const app=await mount();
 try{
  const root=activeHost(app.tree),editor=draft(root),history=list(root),stream=app.latest(a),voice=root.findByType(VoiceInputButton);
  const listen=async()=>{await act(async()=>button(root,'Dictate message').props.onPress());const id=native.start.mock.calls.at(-1)![0];act(()=>DeviceEventEmitter.emit('BobVoiceInputState',{id,state:'listening'}));return id;};
  await act(async()=>editor.props.onFocus());const old=voice.props.onTranscript,oldScope=voice.props.scope,id=await listen();
  await act(async()=>editor.props.onChangeText('/'));
  expect(root.findAllByProps({testID:'skill-picker'}).length).toBeGreaterThan(0);expect(voice.props.active).toBe(false);expect(native.cancel).toHaveBeenCalledWith(id);expect(voice.props.scope).not.toBe(oldScope);
  await act(async()=>{DeviceEventEmitter.emit('BobVoiceInputState',{id,state:'final',text:'Late slash final'});old('Old parent final');});expect(editor.props.value).toBe('/');
  await act(async()=>button(root,'Dismiss command suggestions').props.onPress());expect(root.findAllByProps({testID:'skill-picker'})).toHaveLength(0);expect(voice.props.active).toBe(true);expect(native.start).toHaveBeenCalledTimes(1);
  await act(async()=>old('Late after dismiss'));expect(editor.props.value).toBe('/');
  const fresh=await listen();await act(async()=>DeviceEventEmitter.emit('BobVoiceInputState',{id:fresh,state:'final',text:'fresh utterance'}));expect(editor.props.value).toBe('/ fresh utterance');
  await act(async()=>editor.props.onChangeText('ordinary draft'));const beforeReturn=voice.props.onTranscript,returnId=await listen();
  await act(async()=>editor.props.onChangeText('/next'));expect(voice.props.active).toBe(false);expect(native.cancel).toHaveBeenCalledWith(returnId);
  await openNotification(a,8);const other=activeHost(app.tree);expect(other.findByType(VoiceInputButton).props.active).toBe(true);
  await act(async()=>{beforeReturn('Wrong retained chat');DeviceEventEmitter.emit('BobVoiceInputState',{id:returnId,state:'final',text:'Wrong retained native final'});});expect(draft(other).props.value).toBe('');
  await openNotification(a,chat);expect(activeHost(app.tree)).toBe(root);expect(voice.props.active).toBe(false);
  await act(async()=>button(root,'Dismiss command suggestions').props.onPress());expect(voice.props.active).toBe(true);
  await act(async()=>{old('Retired original visit');beforeReturn('Retired return visit');});expect(editor.props.value).toBe('/next');expect(native.start).toHaveBeenCalledTimes(3);
  expect(draft(root)).toBe(editor);expect(list(root)).toBe(history);expect(app.latest(a)).toBe(stream);expect(stream.close).not.toHaveBeenCalled();expect(app.fetchMock.mock.calls.some(([url])=>String(url).endsWith('/messages'))).toBe(false);
 }finally{await app.close();}
});

test('library saves are pending and single-admission; lost responses reconcile without clearing newer text or crossing workstation scope',async()=>{
 const app=await mount();let release:(()=>void)|undefined;
 try{
  const original=app.fetchMock.getMockImplementation()!,writes:any[]=[];
  const libraries={[a.backendId]:{instructions:'Defaults A',templates:{keep:'Keep A'},skills:{}},[b.backendId]:{instructions:'Defaults B',templates:{keep:'Keep B'},skills:{}}};
  app.fetchMock.mockImplementation(async(input:any,init:any)=>{
   if(String(input).endsWith('/library')){
    const id=String(input).startsWith(a.endpoint)?a.backendId:b.backendId;
    if(init.method==='PATCH'){
     const change=JSON.parse(init.body);writes.push(change);
     await new Promise<void>(done=>{release=()=>{libraries[id].instructions=change.value;done();};});
     throw Error('Synthetic response lost after save');
    }
    return {ok:true,status:200,json:async()=>JSON.parse(JSON.stringify(libraries[id]))} as Response;
   }
   return original(input,init);
  });
  const root=activeHost(app.tree);await navigateTo(app.tree,'Settings');await act(async()=>button(root,'Instructions & templates').props.onPress());
  await act(async()=>root.findByProps({accessibilityLabel:'Backend default instructions'}).props.onChangeText('Submitted A'));
  const save=button(root,'Save instructions').props.onPress;
  await act(async()=>{save();save();});expect(writes).toEqual([{field:'instructions',expected:'Defaults A',value:'Submitted A'}]);
  expect(button(root,'Save instructions').props.disabled).toBe(true);expect(button(root,'Save message template').props.disabled).toBe(true);
  await act(async()=>root.findByProps({accessibilityLabel:'Backend default instructions'}).props.onChangeText('Newer unsaved A'));
  await act(async()=>release!());release=undefined;
  expect(root.findByProps({accessibilityLabel:'Backend default instructions'}).props.value).toBe('Newer unsaved A');
  expect(root.findAll(node=>node.props.children==='Saved and checked.').length).toBeGreaterThan(0);
  await act(async()=>button(root,'Refresh library').props.onPress());expect(root.findByProps({accessibilityLabel:'Backend default instructions'}).props.value).toBe('Newer unsaved A');
  await switchBackend(app.tree,b);const second=activeHost(app.tree);await navigateTo(app.tree,'Settings');await act(async()=>button(second,'Instructions & templates').props.onPress());
  expect(second.findByProps({accessibilityLabel:'Backend default instructions'}).props.value).toBe('Defaults B');
  await switchBackend(app.tree,a);await navigateTo(app.tree,'Settings');await act(async()=>button(root,'Instructions & templates').props.onPress());
  expect(root.findByProps({accessibilityLabel:'Backend default instructions'}).props.value).toBe('Newer unsaved A');expect(writes).toHaveLength(1);
 }finally{if(release)await act(async()=>release!());await app.close();}
});

test('template deletion requires destructive confirmation, rejects a stale dialog and sends only the named value',async()=>{
 const app=await mount(),alerts=jest.spyOn(Alert,'alert').mockImplementation(()=>{});
 try{
  const original=app.fetchMock.getMockImplementation()!,writes:any[]=[];
  const library={instructions:'Keep instructions',templates:{remove:'Remove this',keep:'Keep this'},skills:{}};
  app.fetchMock.mockImplementation(async(input:any,init:any)=>{
   if(String(input).endsWith('/library')){
    if(init.method==='PATCH'){const change=JSON.parse(init.body);writes.push(change);if(change.value===null)delete (library.templates as any)[change.name];}
    return {ok:true,status:200,json:async()=>JSON.parse(JSON.stringify(library))} as Response;
   }
   return original(input,init);
  });
  const root=activeHost(app.tree);await act(async()=>draft(root).props.onChangeText('Keep composer'));
  await navigateTo(app.tree,'Settings');await act(async()=>button(root,'Instructions & templates').props.onPress());
  await act(async()=>root.findByProps({accessibilityLabel:'Template message'}).props.onChangeText('Keep unsaved template'));
  act(()=>button(root,'Delete template remove').props.onPress());expect(writes).toHaveLength(0);
  const stale=alerts.mock.calls.at(-1)![2]!.find(item=>item.style==='destructive')!;expect(stale.text).toBe('Delete template');
  await navigateTo(app.tree,'Chat');await act(async()=>stale.onPress!());expect(writes).toHaveLength(0);
  await navigateTo(app.tree,'Settings');await act(async()=>button(root,'Instructions & templates').props.onPress());
  act(()=>button(root,'Delete template remove').props.onPress());const confirm=alerts.mock.calls.at(-1)![2]!.find(item=>item.style==='destructive')!;
  await act(async()=>{confirm.onPress!();confirm.onPress!();});
  expect(writes).toEqual([{field:'template',name:'remove',expected:'Remove this',value:null}]);
  expect(library.instructions).toBe('Keep instructions');expect(library.templates).toEqual({keep:'Keep this'});
  expect(root.findByProps({accessibilityLabel:'Template message'}).props.value).toBe('Keep unsaved template');expect(draft(root).props.value).toBe('Keep composer');
 }finally{await app.close();}
});

test('skill save and archive use exact reviewed values; failed readback preserves editor and requires refresh',async()=>{
 const app=await mount(),alerts=jest.spyOn(Alert,'alert').mockImplementation(()=>{});
 try{
  const original=app.fetchMock.getMockImplementation()!,writes:any[]=[];
  const before={description:'Example skill',markdown:'Original skill',enabled:true};
  const library={instructions:'Keep instructions',templates:{keep:'Keep template'},skills:{example:before} as Record<string,typeof before>};
  let failRead=false;
  app.fetchMock.mockImplementation(async(input:any,init:any)=>{
   if(String(input).endsWith('/library')){
    if(init.method==='PATCH'){
     const change=JSON.parse(init.body);writes.push(change);if(change.value===null)delete library.skills[change.name];else library.skills[change.name]=change.value;
    }else if(failRead){failRead=false;throw Error('Synthetic readback unavailable');}
    return {ok:true,status:200,json:async()=>JSON.parse(JSON.stringify(library))} as Response;
   }
   return original(input,init);
  });
  const root=activeHost(app.tree);await navigateTo(app.tree,'Settings');await act(async()=>button(root,'Skills').props.onPress());
  await act(async()=>button(root,'Edit skill example').props.onPress());await act(async()=>root.findByProps({accessibilityLabel:'Skill Markdown'}).props.onChangeText('Edited skill'));
  failRead=true;await act(async()=>button(root,'Save skill').props.onPress());
  expect(writes).toEqual([{field:'skill',name:'example',expected:before,value:{...before,markdown:'Edited skill'}}]);
  expect(root.findByProps({accessibilityLabel:'Skill Markdown'}).props.value).toBe('Edited skill');expect(button(root,'Save skill').props.disabled).toBe(true);
  await act(async()=>button(root,'Refresh library').props.onPress());await act(async()=>button(root,'Continue editing skill').props.onPress());
  expect(root.findByProps({accessibilityLabel:'Skill Markdown'}).props.value).toBe('Edited skill');expect(button(root,'Save skill').props.disabled).toBe(false);
  // Re-open authoritative saved skill before destructive archive: the old base
  // remains stale after uncertainty, rather than silently authorizing overwrite.
  await act(async()=>button(root,'Edit skill example').props.onPress());
  act(()=>button(root,'Archive selected skill').props.onPress());expect(writes).toHaveLength(1);
  const confirm=alerts.mock.calls.at(-1)![2]!.find(item=>item.style==='destructive')!;await act(async()=>confirm.onPress!());
  expect(writes[1]).toEqual({field:'skill',name:'example',expected:{...before,markdown:'Edited skill'},value:null});
  expect(root.findByProps({accessibilityLabel:'Skill Markdown'}).props.value).toBe('Edited skill');expect(library.templates).toEqual({keep:'Keep template'});expect(library.instructions).toBe('Keep instructions');
 }finally{await app.close();}
});
