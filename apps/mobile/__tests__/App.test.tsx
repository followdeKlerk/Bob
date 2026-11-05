jest.mock('../components/bob-mascot',()=>({BobMascot:({state,animated}:any)=>require('react').createElement(require('react-native').View,{testID:'bob-mascot',state,animated})}));
jest.mock('react-native-reanimated',()=>({__esModule:true,default:{View:require('react-native').View,createAnimatedComponent:(component:any)=>component},LinearTransition:{duration:(duration:number)=>({reduceMotion:(reduceMotion:string)=>({duration,reduceMotion})})},ReduceMotion:{System:'system'},cancelAnimation:jest.fn(),useSharedValue:(value:any)=>require('react').useRef({value}).current,useAnimatedProps:(fn:any)=>fn(),withSpring:(value:any)=>value,withTiming:(value:any)=>value,Easing:{out:(value:any)=>value,cubic:jest.fn()}}));
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {AppState,DeviceEventEmitter,NativeModules,Platform,StyleSheet,TextInput,Image,Text,Keyboard,Modal,Dimensions} from 'react-native';
import {CompactActivityRow} from '../components/compact-activity-row';
import {ModelContent} from '../components/model-content';
import {ChatBubble} from '../components/chat-bubble';
import {CopyAction} from '../components/message-actions';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import {colors,lightColors} from '../theme';
import {readOutbox} from '../outbox-storage';
import {DraftInput} from '../components/draft-input';
import {EdgeFade} from '../components/edge-fade';
import {InlineSurface} from '../components/inline-surface';
import {BottomTabs,type BottomDestination} from '../components/bottom-tabs';
import {ChatNavigation} from '../components/chat-navigation';
import {SkillPicker} from '../components/skill-picker';
import {SettingsGroup,SectionHeading} from '../components/section-ui';
import {SideDrawer} from '../components/side-drawer';
import {DrawingEditor} from '../components/drawing-editor';
import App from '../App';
// Native platform boundaries only; exercise Main's real hooks and navigation tree.
jest.mock('react-native-get-random-values',()=>({}));
jest.mock('react-native/Libraries/AppState/AppState',()=>({__esModule:true,default:{currentState:'active',addEventListener:jest.fn(()=>({remove:jest.fn()}))}}));
jest.mock('../global.css',()=>({}));
jest.mock('lucide-react-native',()=>new Proxy({},{get:(_,name)=>name==='__esModule'?true:()=>null}));
jest.mock('react-native-svg',()=>new Proxy({},{get:(_,name)=>name==='__esModule'?true:()=>null}));
jest.mock('react-native-sse',()=>jest.fn(()=>({addEventListener:jest.fn(),close:jest.fn(),open:jest.fn()})));
jest.mock('uuid',()=>({v4:()=> '5aaee20e-e260-4403-80da-b97ce80664a1'}));
jest.mock('../components/ui/button',()=>({Button:require('react-native').Pressable}));
jest.mock('../components/ui/text',()=>({Text:require('react-native').Text,TextClassContext:require('react').createContext(undefined)}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaProvider:require('react-native').View,SafeAreaView:require('react-native').View,useSafeAreaInsets:()=>({top:0,bottom:0,left:0,right:0})}));
jest.mock('react-native-keychain',()=>({getGenericPassword:jest.fn(async()=>false)}));
jest.mock('@react-native-async-storage/async-storage',()=>{const values=new Map();return{getItem:jest.fn(async(key:string)=>values.get(key)??null),setItem:jest.fn(async(key:string,value:string)=>{values.set(key,value);}),removeItem:jest.fn(async(key:string)=>{values.delete(key);}),getMany:jest.fn(async(keys:string[])=>Object.fromEntries(keys.map(key=>[key,values.get(key)??null]))),setMany:jest.fn(async(items:Record<string,string>)=>{for(const [key,value] of Object.entries(items))values.set(key,value);}),removeMany:jest.fn(async(keys:string[])=>{for(const key of keys)values.delete(key);}),clear:jest.fn(async()=>values.clear())};});
beforeEach(async()=>{await AsyncStorage.clear();});
afterEach(()=>jest.restoreAllMocks());
// Exercise the actual menu trigger/rows on Chat, and real tabs elsewhere.
function visibleNavigation(tree:Renderer.ReactTestRenderer){return tree.root.findAllByType(ChatNavigation).find(node=>node.props.showTrigger!==false)!;}
async function navigateTo(tree:Renderer.ReactTestRenderer,destination:BottomDestination){
 if(!visibleNavigation(tree).props.open)await act(async()=>tree.root.findByProps({accessibilityLabel:'Menu'}).props.onPress());
 await act(async()=>tree.root.findByProps({testID:'chat-navigation-sheet'}).findAll(node=>node.props.accessibilityLabel===destination&&typeof node.props.onPress==='function')[0].props.onPress());
}
test('unpaired app mounts the real screen and history/navigation hooks without a blank screen',async()=>{
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<App/>);});
 const logo=tree.root.findByProps({accessibilityLabel:'Bob logo'});
 expect(logo.type).toBe(Image);expect(logo.props.source).toEqual(require('../assets/bob-wordmark.png'));
 expect(StyleSheet.flatten(logo.props.style)).toMatchObject({width:'100%',aspectRatio:1});
 act(()=>tree.root.findByProps({accessibilityLabel:'Paste pairing invitation'}).props.onPress());
 expect(tree.root.findAllByProps({accessibilityLabel:'Pairing invitation'}).length).toBeGreaterThan(0);
 await act(async()=>tree.unmount());
});

test('Bob menus navigate every root without a bottom bar and preserve draft, controls and list',async()=>{
 jest.replaceProperty(Platform,'OS','android');
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={};delete NativeModules.BobOutbox;
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{const url=String(input),data=url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[{id:1,kind:'bob.user',data:{text:'Keep this history'}}]}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Test'}}]}:url.endsWith('/updates')?{enabled:false}:[];return{ok:true,status:200,json:async()=>data} as Response;});
 const dismissKeyboard=jest.spyOn(Keyboard,'dismiss').mockImplementation(()=>{});
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<App/>);});
 try{
  const draft=tree.root.findByProps({accessibilityLabel:'Message draft'}),editor=tree.root.findByType(DraftInput);
  const plus=tree.root.findByProps({accessibilityLabel:'Chat actions'}),send=tree.root.findByProps({accessibilityLabel:'Send message'});
  const list=tree.root.findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0];
  const scroll=jest.spyOn(list.instance,'scrollToOffset').mockImplementation(()=>{});
  act(()=>{draft.props.onFocus();draft.props.onChangeText('Keep my unsent draft');DeviceEventEmitter.emit('BobKeyboardInset',{imeBottom:280});});
  expect(editor.props.compact).toBe(false);expect(tree.root.findAllByType(BottomTabs)).toHaveLength(0);
  const check=()=>{
   expect(tree.root.findByProps({accessibilityLabel:'Message draft'})).toBe(draft);expect(draft.props.value).toBe('Keep my unsent draft');
   expect(tree.root.findByType(DraftInput)).toBe(editor);expect(tree.root.findByProps({accessibilityLabel:'Chat actions'})).toBe(plus);expect(tree.root.findByProps({accessibilityLabel:'Send message'})).toBe(send);
   expect(tree.root.findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0]).toBe(list);
  };
  await act(async()=>tree.root.findByProps({accessibilityLabel:'Menu'}).props.onPress());
  expect(dismissKeyboard).toHaveBeenCalled();expect(tree.root.findByProps({testID:'chat-navigation-sheet'})).toBeDefined();check();
  // Model the native IME hide after opening the menu, then the Modal's Android Back callback.
  act(()=>DeviceEventEmitter.emit('BobKeyboardInset',{imeBottom:0}));
  await act(async()=>visibleNavigation(tree).findByType(Modal).props.onRequestClose());
  expect(visibleNavigation(tree).props.open).toBe(false);check();
  for(const label of ['Close navigation menu','Dismiss navigation menu']){
   await act(async()=>tree.root.findByProps({accessibilityLabel:'Menu'}).props.onPress());
   await act(async()=>tree.root.findByProps({accessibilityLabel:label}).props.onPress());
   expect(visibleNavigation(tree).props.open).toBe(false);check();
  }
  for(const destination of ['Sessions','Notes','Workstations','Agents','Settings'] as const){
   await navigateTo(tree,destination);expect(visibleNavigation(tree).props.open).toBe(false);
   expect(tree.root.findAllByType(BottomTabs)).toHaveLength(0);
   const header=tree.root.findAllByType(SectionHeading).find(node=>node.props.title===destination)!;
   expect(header.findAllByType(ChatNavigation)).toContain(visibleNavigation(tree));
   expect(tree.root.findAllByType(ChatNavigation).filter(node=>node.props.showTrigger!==false)).toHaveLength(1);check();
   await navigateTo(tree,'Chat');expect(tree.root.findAllByType(BottomTabs)).toHaveLength(0);check();
  }
  await navigateTo(tree,'Settings');
  expect(tree.root.findByProps({testID:'section-body'}).findAllByType(SectionHeading)).toHaveLength(0);
  expect(tree.root.findByProps({testID:'section-overlay'}).findAllByType(SectionHeading).map(node=>node.props.title)).toEqual(['Settings']);
  for(const mode of ['Dark','Light','System'] as const){
   await act(async()=>tree.root.findAll(node=>node.props.accessibilityLabel===`${mode} theme`&&typeof node.props.onPress==='function')[0].props.onPress());
   expect(await AsyncStorage.getItem('appearance')).toBe(mode.toLowerCase());check();
   expect(tree.root.findAll(node=>node.props.accessibilityLabel===`${mode} theme`&&node.props.accessibilityRole==='radio')[0].props.accessibilityState.checked).toBe(true);
  }
  await navigateTo(tree,'Chat');check();
  expect(scroll).not.toHaveBeenCalled();
  expect(StyleSheet.flatten(tree.root.findByProps({testID:'chat-composer'}).props.style)).toMatchObject({paddingHorizontal:12,paddingBottom:12});
  const row=tree.root.findByProps({testID:'composer-row'});expect(StyleSheet.flatten(row.props.style)).toMatchObject({flexDirection:'row'});
  expect(row.findByType(DraftInput)).toBe(editor);expect(tree.root.findByProps({testID:'composer-heading'}).findByType(ChatNavigation)).toBeDefined();
  // Loading covers the section body, not its replacement navigation control.
  await navigateTo(tree,'Settings');
  const fetchMock=globalThis.fetch as jest.Mock,normalFetch=fetchMock.getMockImplementation()!;
  let releaseModules!:(response:any)=>void;
  fetchMock.mockImplementation((url:any,...args:any[])=>String(url).endsWith('/modules')?new Promise(resolve=>{releaseModules=resolve;}):normalFetch(url,...args));
  await act(async()=>tree.root.findAll(node=>node.props.accessibilityLabel==='Advanced modules'&&typeof node.props.onPress==='function')[0].props.onPress());
  const loading=tree.root.findByProps({testID:'section-loading-overlay'});
  expect(StyleSheet.flatten(loading.props.style).position).not.toBe('absolute');
  expect(tree.root.findAllByType(SectionHeading).find(node=>node.props.title==='Modules')!.findAllByType(ChatNavigation)).toContain(visibleNavigation(tree));
  await navigateTo(tree,'Chat');check();
  await act(async()=>releaseModules({ok:true,json:async()=>[]}));
  // Chat no longer reserves a (hidden) tab bar in slash-picker geometry.
  const measuredHeight=Dimensions.get('window').height-116;
  await act(async()=>{tree.root.findByProps({testID:'chat-composer'}).props.onLayout({nativeEvent:{layout:{height:measuredHeight}}});draft.props.onFocus();draft.props.onChangeText('/mini');});
  expect(tree.root.findByType(SkillPicker).props.maxHeight).toBe(100);
  expect(tree.root.findByType(SkillPicker).props.bottom).toBe(measuredHeight+6);
  await act(async()=>tree.root.findByProps({accessibilityLabel:'Menu'}).props.onPress());
  expect(tree.root.findAllByType(SkillPicker)).toHaveLength(0);
 }finally{await act(async()=>tree.unmount());}
});

test.each(['no conversation','opening','offline'])('Chat menu stays available with %s and closes for notification targets',async(mode)=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:mode==='no conversation'?undefined:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={};delete NativeModules.BobOutbox;
 const get=(AsyncStorage.getItem as jest.Mock).getMockImplementation()!;let release:((value:string)=>void)|undefined;
 if(mode==='opening')(AsyncStorage.getItem as jest.Mock).mockImplementation((key:string)=>key===`draft:${backend.backendId}:7`?new Promise(resolve=>{release=resolve;}):get(key));
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{if(mode==='offline')throw Error('offline');const url=String(input),data=url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[]}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Test'}}]}:url.endsWith('/updates')?{enabled:false}:[];return{ok:true,status:200,json:async()=>data} as Response;});
 let tree!:Renderer.ReactTestRenderer;
 try{
  await act(async()=>{tree=Renderer.create(<App/>);});
  if(mode!=='offline')expect(tree.root.findByProps({accessibilityLabel:'Message draft'}).props.editable).toBe(false);
  await act(async()=>tree.root.findByProps({accessibilityLabel:'Menu'}).props.onPress());expect(visibleNavigation(tree).props.open).toBe(true);
  await navigateTo(tree,'Sessions');expect(tree.root.findByType(SideDrawer)).toBeDefined();
  await navigateTo(tree,'Chat');await act(async()=>tree.root.findByProps({accessibilityLabel:'Menu'}).props.onPress());
  (NativeModules.BobPlatform.takeNotificationTarget as jest.Mock).mockResolvedValue({backendId:backend.backendId,conversationId:8});
  await act(async()=>DeviceEventEmitter.emit('BobNotificationOpen'));
  expect(visibleNavigation(tree).props.open).toBe(false);
  await act(async()=>tree.root.findByProps({accessibilityLabel:'Menu'}).props.onPress());
  (NativeModules.BobPlatform.takeNotificationTarget as jest.Mock).mockResolvedValue({backendId:backend.backendId,screen:'updates'});
  await act(async()=>DeviceEventEmitter.emit('BobNotificationOpen'));
  expect(visibleNavigation(tree).props.open).toBe(false);
 }finally{(AsyncStorage.getItem as jest.Mock).mockImplementation(get);if(release)await act(async()=>release!(''));if(tree)await act(async()=>tree.unmount());}
});

test.each([true,false])('menus and background/foreground preserve the native list and viewport (reading earlier: %s)',async(readingEarlier)=>{
 const ime=new Set<(event:any)=>void>();jest.replaceProperty(Platform,'OS','android');
 const add=DeviceEventEmitter.addListener.bind(DeviceEventEmitter);jest.spyOn(DeviceEventEmitter,'addListener').mockImplementation((event,callback)=>{if(event!=='BobKeyboardInset')return add(event,callback);ime.add(callback);return{remove:()=>{ime.delete(callback);}};});
 const lifecycle=new Set<(state:any)=>void>(),current=jest.replaceProperty(AppState,'currentState','active');
 jest.spyOn(AppState,'addEventListener').mockImplementation((event,callback)=>{if(event==='change')lifecycle.add(callback as any);return{remove:()=>{lifecycle.delete(callback as any);}};});
 const transition=(state:'active'|'background')=>{current.replaceValue(state);for(const callback of lifecycle)callback(state);};
 const surface={id:'a841d08a-8b83-42cd-b8a7-2d61f2db7ae9',conversationId:7,title:'Solar system',kind:'visual',presentation:'inline',allowedTools:[]};
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={versionCode:35,versionName:'test'};NativeModules.BobInteractive={prepare:jest.fn(async()=> 'prepared-visual'),releasePrepared:jest.fn()};
 let conversationConfiguration:{instructions:string|null;cwd:string}={instructions:null,cwd:'/workspace'};
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any,options?:any)=>{
  const url=String(input);if(url.endsWith('/configure')&&options?.method==='PUT')conversationConfiguration={...conversationConfiguration,...JSON.parse(options.body)};const data=url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[{id:1,kind:'pi.assistant',model:[{role:'assistant',content:[{type:'toolCall',id:'visual-call',name:'render_visual',arguments:{title:'Solar system',html:'<p>Solar system</p>'}}]}]},{id:2,kind:'pi.tool-result',model:[{role:'toolResult',toolCallId:'visual-call',toolName:'render_visual',content:[{type:'text',text:`Isolated visual ${surface.id}: Solar system. Open from the conversation’s interactive surfaces.`}]}]},{id:3,kind:'pi.assistant',model:[{role:'assistant',content:[{type:'text',text:'This is a newer reply, after the illustration.'}]}]}]}:url.endsWith('/ui')?[surface]:url.endsWith('/updates')?{enabled:false}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Test chat'}}]}:url.endsWith('/peers')?{inbound:[],outbound:[]}:url.endsWith('/library')?{instructions:'',templates:{},skills:{'minimal-skill-authoring':{description:'Author minimal skills',enabled:true},bro:{description:'Simplify the last answer',enabled:true}},commands:[{name:'delegation',description:'Choose models or profiles for subagents.'}]}:url.endsWith('/models')?[]:url.endsWith('/configure')?conversationConfiguration:[];
  return {ok:true,status:200,json:async()=>data} as Response;
 });
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<App/>);});
 const draft=tree.root.findByProps({accessibilityLabel:'Message draft'});expect(tree.root.findByType(DraftInput).props.compact).toBe(true);expect(StyleSheet.flatten(draft.props.style).height).toBe(48);
 act(()=>{draft.props.onChangeText('A retained draft while toggling the keyboard.');for(const callback of ime)callback({imeBottom:280});});expect(tree.root.findByType(DraftInput).props.compact).toBe(false);expect(tree.root.findAllByType(BottomTabs)).toHaveLength(0);expect(tree.root.findByProps({accessibilityLabel:'Message draft'})).toBe(draft);
 act(()=>draft.props.onContentSizeChange({nativeEvent:{contentSize:{height:126}}}));expect(StyleSheet.flatten(draft.props.style).height).toBe(126);
 act(()=>{for(const callback of ime)callback({imeBottom:0});});expect(tree.root.findByType(DraftInput).props.compact).toBe(true);expect(StyleSheet.flatten(draft.props.style).height).toBe(48);expect(draft.props.value).toContain('retained draft');expect(tree.root.findAllByType(BottomTabs)).toHaveLength(0);expect(tree.root.findByProps({accessibilityLabel:'Menu'})).toBeDefined();
 // Slash suggestions are fetched through the active backend; selection only edits the draft.
 await act(async()=>{draft.props.onFocus();draft.props.onChangeText('/mini');});
 expect(tree.root.findByProps({testID:'skill-picker'})).toBeDefined();
 act(()=>tree.root.findByProps({accessibilityLabel:'Use skill minimal-skill-authoring'}).props.onPress());
 expect(draft.props.value).toBe('Use the skill "minimal-skill-authoring". ');
 expect(tree.root.findAllByProps({testID:'skill-picker'})).toHaveLength(0);
 await act(async()=>draft.props.onChangeText('/bro'));
 act(()=>tree.root.findByProps({accessibilityLabel:'Use skill bro'}).props.onPress());
 expect(draft.props.value).toBe('Use the skill "bro". ');
 await act(async()=>draft.props.onChangeText('/dele'));
 act(()=>tree.root.findByProps({accessibilityLabel:'Insert command delegation'}).props.onPress());
 expect(draft.props.value).toBe('/delegation ');
 expect(tree.root.findAllByProps({testID:'skill-picker'})).toHaveLength(0);
 expect(tree.root.findByProps({accessibilityLabel:'Message draft'})).toBe(draft);
 expect((globalThis.fetch as jest.Mock).mock.calls.some(([url])=>String(url).endsWith('/messages'))).toBe(false);
 const composer=tree.root.findByProps({testID:'chat-composer'});expect(StyleSheet.flatten(composer.props.style).backgroundColor).toBe('transparent');expect(composer.findAllByType(EdgeFade)).toHaveLength(0);
 const controls=composer.findByProps({testID:'composer-controls'});expect(controls.findAllByType(TextInput)).toHaveLength(0);expect(controls.findByProps({accessibilityLabel:'Chat actions'})).toBeDefined();expect(controls.findByProps({accessibilityLabel:'Send message'})).toBeDefined();
 expect(StyleSheet.flatten(controls.findByProps({accessibilityLabel:'Send message'}).props.style).backgroundColor).toBe('transparent');
 expect(controls.findByProps({accessibilityLabel:'Send message'}).props.variant).toBe('ghost');
 expect(tree.root.findAllByProps({testID:'chat-header'})).toHaveLength(0);
 expect(tree.root.findAllByProps({accessibilityLabel:'Select workstation'})).toHaveLength(0);
 expect(tree.root.findAllByType(BottomTabs)).toHaveLength(0);expect(tree.root.findByProps({accessibilityLabel:'Menu'})).toBeDefined();
 const list=tree.root.findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0];expect(list).toBeDefined();
 expect(list.props.inverted).toBe(true);expect(list.props.initialScrollIndex).toBe(0);expect(list.props.data.map((entry:any)=>entry.id)).toEqual([3,1]);
 const latest=jest.spyOn(list.instance,'scrollToOffset').mockImplementation(()=>{});
 const scroll=jest.spyOn(list.instance,'scrollToEnd').mockImplementation(()=>{}),nativeEnd=jest.fn();jest.spyOn(list.instance,'getScrollResponder').mockReturnValue({scrollToEnd:nativeEnd});
 act(()=>{list.props.onLayout({nativeEvent:{layout:{height:600}}});list.props.onContentSizeChange(300,2000);});
 const inlineSurface=tree.root.findByProps({testID:'history-entry-1'}).findByType(InlineSurface);
 expect(tree.root.findByProps({testID:'history-entry-3'}).findAllByType(InlineSurface)).toHaveLength(0);
 expect(tree.root.findAllByType(InlineSurface)).toHaveLength(1);
 expect(NativeModules.BobInteractive.prepare).toHaveBeenCalledTimes(1);
 expect(tree.root.findByProps({testID:'inline-surface-container'})).toBeDefined();
 expect(tree.root.findByProps({testID:'bob-inline-native-surface'}).props.style).toEqual({height:420,width:'100%'});
 // A different surface's fallback must not collapse this row. Keep this native
 // child mounted throughout the menu/background lifecycle below.
 const nativeSurface=tree.root.findByProps({testID:'bob-inline-native-surface'});
 act(()=>DeviceEventEmitter.emit('BobSurfaceOverflow',{backendId:backend.backendId,conversationId:7,id:'another-surface'}));
 expect(tree.root.findByProps({testID:'bob-inline-native-surface'})).toBe(nativeSurface);
 const size=(height:number,session='prepared-visual')=>DeviceEventEmitter.emit('BobSurfaceLayout',{backendId:backend.backendId,conversationId:7,id:surface.id,session,height});
 act(()=>size(220));expect(nativeSurface.props.style.height).toBe(220);
 act(()=>{size(320);size(8193);size(0);size(160,'expired-mount');});expect(nativeSurface.props.style.height).toBe(320);
 act(()=>size(180));expect(nativeSurface.props.style.height).toBe(180);
 expect(NativeModules.BobInteractive.prepare).toHaveBeenCalledTimes(1);
 expect(inlineSurface.props.surface.presentation).toBe('inline');
 const event={nativeEvent:{contentOffset:{y:500},contentSize:{height:2000},layoutMeasurement:{height:600}}};
 await act(async()=>{await new Promise<void>(resolve=>setTimeout(resolve,35));});scroll.mockClear();nativeEnd.mockClear();latest.mockClear();
 if(!readingEarlier)act(()=>list.props.onScroll({nativeEvent:{contentOffset:{y:0},contentSize:{height:2000},layoutMeasurement:{height:600}}}));
 if(readingEarlier){act(()=>{list.props.onScrollBeginDrag();list.props.onScroll(event);list.props.onMomentumScrollEnd(event);});expect(tree.root.findByProps({accessibilityLabel:'Scroll to latest message'})).toBeDefined();}
 for(const section of ['Notes','Settings'] as const){
  await navigateTo(tree,'Sessions');
  const configurationReadsBefore=(globalThis.fetch as jest.Mock).mock.calls.filter(([url,options])=>String(url).endsWith('/configure')&&options?.method==='GET').length;
  await navigateTo(tree,section);
  expect(tree.root.findByProps({testID:section==='Notes'?'notes-screen':'section-overlay'})).toBeDefined();expect(tree.root.findByProps({testID:'chat-viewport'}).props.pointerEvents).toBe('none');
  expect(tree.root.findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0]).toBe(list);
  expect(tree.root.findAllByProps({accessibilityLabel:'Back to chat'})).toHaveLength(0);
  if(section==='Settings'){
   expect((globalThis.fetch as jest.Mock).mock.calls.filter(([url,options])=>String(url).endsWith('/configure')&&options?.method==='GET')).toHaveLength(configurationReadsBefore);
   expect(tree.root.findAllByProps({testID:'section-loading-overlay'})).toHaveLength(0);
   expect(tree.root.findAllByProps({testID:'conversation-settings-loading'})).toHaveLength(0);
   expect(tree.root.findAllByType(SettingsGroup).map(group=>group.props.title)).toEqual(['Appearance','This conversation','Notifications','Voice','Location','Schedules','App','Advanced']);
   expect(tree.root.findAllByProps({accessibilityLabel:'Conversation instructions'})).toHaveLength(0);
   expect(tree.root.findAllByProps({accessibilityLabel:'Model & thinking'}).length).toBeGreaterThan(0);
   const press=(label:string)=>tree.root.findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0].props.onPress();
   const fetchMock=globalThis.fetch as jest.Mock,normalFetch=fetchMock.getMockImplementation()!;
   let releaseConfiguration!:()=>void;
   const delayedConfiguration=new Promise<void>(resolve=>{releaseConfiguration=resolve;});
   fetchMock.mockImplementation(async(url:any,options:any)=>{if(String(url).endsWith('/configure')&&options?.method==='GET')await delayedConfiguration;return normalFetch(url,options);});
   await act(async()=>press('Instructions & folder'));
   expect(tree.root.findAllByProps({testID:'conversation-settings-loading'}).length).toBeGreaterThan(0);
   expect(tree.root.findAllByProps({testID:'section-loading-overlay'})).toHaveLength(0);
   expect(tree.root.findAllByProps({accessibilityLabel:'Conversation instructions'})).toHaveLength(0);
   const notifications=tree.root.findAll(node=>String(node.props.accessibilityLabel).startsWith('Last reply notifications:')&&typeof node.props.onPress==='function')[0];
   expect(notifications.props.disabled).toBe(false);
   act(()=>press('About notifications'));
   expect(tree.root.findAll(node=>typeof node.props.children==='string'&&node.props.children.includes('Replies, questions and schedule alerts')).length).toBeGreaterThan(0);
   const pendingCalls=fetchMock.mock.calls.filter(([url])=>String(url).endsWith('/configure')).length;
   await navigateTo(tree,'Settings');
   expect(fetchMock.mock.calls.filter(([url])=>String(url).endsWith('/configure'))).toHaveLength(pendingCalls);
   await act(async()=>releaseConfiguration());fetchMock.mockImplementation(normalFetch);
   expect(tree.root.findAllByProps({testID:'conversation-settings-loading'})).toHaveLength(0);
   act(()=>tree.root.findByProps({accessibilityLabel:'Conversation instructions'}).props.onChangeText('Concise replies'));
   await act(async()=>press('Save conversation override'));
   expect((globalThis.fetch as jest.Mock).mock.calls.some(([url,options])=>String(url).includes('/chats/7/configure')&&options?.method==='PUT'&&JSON.parse(options.body).instructions==='Concise replies')).toBe(true);
   expect(conversationConfiguration.instructions).toBe('Concise replies');
   expect(tree.root.findAll(node=>node.props.children==='Instructions saved.').length).toBeGreaterThan(0);
   // Leaving the settings subtree must not overwrite unsaved fields on reload.
   act(()=>tree.root.findByProps({accessibilityLabel:'Conversation instructions'}).props.onChangeText('Retain unsaved instructions'));
   act(()=>tree.root.findByProps({accessibilityLabel:'Backend working directory'}).props.onChangeText('/retained-draft'));
   await navigateTo(tree,'Chat');
   await navigateTo(tree,'Settings');
   await act(async()=>press('Instructions & folder'));
   expect(tree.root.findByProps({accessibilityLabel:'Conversation instructions'}).props.value).toBe('Retain unsaved instructions');
   expect(tree.root.findByProps({accessibilityLabel:'Backend working directory'}).props.value).toBe('/retained-draft');
   await act(async()=>press('Save conversation override'));
   expect(conversationConfiguration.instructions).toBe('Retain unsaved instructions');
   expect(tree.root.findByProps({accessibilityLabel:'Backend working directory'}).props.value).toBe('/retained-draft');
   await act(async()=>press('Instructions & folder'));
   expect(tree.root.findAllByProps({accessibilityLabel:'Conversation instructions'})).toHaveLength(0);
  }
  await navigateTo(tree,'Chat');
  expect(tree.root.findByProps({testID:'chat-viewport'}).props.pointerEvents).toBe('auto');expect(tree.root.findAllByProps({testID:'section-overlay'})).toHaveLength(0);
  expect(tree.root.findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0]).toBe(list);
 }
 // The schedules overlay must also retain the same native chat list and scroll state.
 await navigateTo(tree,'Sessions');
 await act(async()=>tree.root.findByType(SideDrawer).props.onSchedules());
 expect(tree.root.findByProps({testID:'schedules-screen'})).toBeDefined();
 await act(async()=>tree.root.findAll(node=>node.props.accessibilityLabel==='Back to previous menu'&&typeof node.props.onPress==='function')[0].props.onPress());
 expect(tree.root.findByType(SideDrawer).props.mode).toBe('sessions');
 await act(async()=>tree.root.findByType(SideDrawer).props.onSchedules());
 expect(tree.root.findByProps({testID:'schedules-screen'})).toBeDefined();
 expect(tree.root.findByProps({testID:'chat-viewport'}).props.pointerEvents).toBe('none');
 expect(tree.root.findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0]).toBe(list);
 await navigateTo(tree,'Chat');
 // Machine browsing is a distinct destination and selecting the current machine opens its sessions.
 await navigateTo(tree,'Workstations');
 expect(tree.root.findByType(SideDrawer).props.mode).toBe('workstations');
 act(()=>tree.root.findByType(SideDrawer).props.workspaces[0].onPress());
 expect(tree.root.findByType(SideDrawer).props.mode).toBe('sessions');
 await navigateTo(tree,'Chat');
 expect(tree.root.findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0]).toBe(list);
 expect(draft.props.value).toBe('/delegation ');
 expect(StyleSheet.flatten(tree.root.findByProps({testID:'rounded-app-surface'}).props.style)).toMatchObject({overflow:'hidden'});
 const historyCalls=()=> (globalThis.fetch as jest.Mock).mock.calls.filter(([url])=>String(url).includes('/history')).length;
 const before=historyCalls();
 for(let cycle=0;cycle<2;cycle++){
  act(()=>{transition('background');list.props.onLayout({nativeEvent:{layout:{height:0}}});list.props.onContentSizeChange(300,0);list.props.onScroll({...event,nativeEvent:{...event.nativeEvent,contentOffset:{y:0}}});});
  await act(async()=>{transition('active');list.props.onLayout({nativeEvent:{layout:{height:600}}});list.props.onContentSizeChange(300,2000);await new Promise<void>(resolve=>setTimeout(resolve,35));});
  expect(tree.root.findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0]).toBe(list);
 }
 expect(historyCalls()).toBeGreaterThan(before);expect(latest).not.toHaveBeenCalled();expect(nativeEnd).not.toHaveBeenCalled();expect(scroll).not.toHaveBeenCalled();expect(NativeModules.BobInteractive.prepare).toHaveBeenCalledTimes(1);
 expect(tree.root.findByProps({testID:'bob-inline-native-surface'})).toBe(nativeSurface);
 expect(tree.root.findByProps({testID:'history-entry-1'}).findByType(InlineSurface)).toBe(inlineSurface);
 // A genuine native promotion removes the inline child, retaining exactly one
 // title/expand action on its original producing history entry.
 act(()=>DeviceEventEmitter.emit('BobSurfaceOverflow',{backendId:backend.backendId,conversationId:7,id:surface.id,session:'prepared-visual'}));
 expect(tree.root.findAllByProps({testID:'bob-inline-native-surface'})).toHaveLength(0);
 expect(tree.root.findByProps({testID:'history-entry-1'}).findByType(InlineSurface).findByProps({accessibilityLabel:'Expand visual: Solar system'})).toBeDefined();
 expect(NativeModules.BobInteractive.releasePrepared).toHaveBeenCalledWith('prepared-visual');
 if(readingEarlier)expect(tree.root.findByProps({accessibilityLabel:'Scroll to latest message'})).toBeDefined();await act(async()=>tree.unmount());
});

test('cold launch, session switches, and reopening from cache start with the newest row already at index zero',async()=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 const sessions=[{id:7,meta:{title:'First session'}},{id:8,meta:{title:'Second session'}}];
 const pages=new Map([7,8].map(id=>[id,{backendId:backend.backendId,conversationId:id,coverage:'stored-entries',items:Array.from({length:150},(_,i)=>({id:id*1000+i+1,kind:'bob.user',data:{text:`Session ${id}, message ${i+1}. `+'Variable-height text. '.repeat(i%11===0?120:1)}}))}]));
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({password:'test-token'});jest.replaceProperty(AppState,'currentState','active');
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={versionCode:38,versionName:'test'};
 let finishSecond:((response:Response)=>void)|undefined,finishCached:((response:Response)=>void)|undefined,holdCached=false;
 const response=(data:unknown)=>({ok:true,status:200,json:async()=>data}) as Response;
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{
  const url=String(input),match=/\/chats\/(7|8)\/history/.exec(url);
  if(match){const id=Number(match[1]);if(id===8&&!finishSecond)return new Promise<Response>(resolve=>{finishSecond=resolve;});if(id===7&&holdCached)return new Promise<Response>(resolve=>{finishCached=resolve;});return response(pages.get(id));}
  return response(url.endsWith('/chats')?{items:sessions}:url.endsWith('/updates')?{enabled:false}:url.endsWith('/peers')?{inbound:[],outbound:[]}:[]);
 });
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<App/>);});
 const findList=()=>tree.root.findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0];
 const check=(id:number)=>{const list=findList();expect(list.props.inverted).toBe(true);expect(list.props.initialScrollIndex).toBe(0);expect(list.props.data[0].id).toBe(id*1000+150);expect(list.props.data.at(-1).id).toBe(id*1000+1);return list;};
 const first=check(7);expect(tree.root.findAllByProps({testID:'history-entry-7150'}).length).toBeGreaterThan(0);
 const userBubble=tree.root.findByProps({testID:'history-entry-7150'}).findAll(node=>{const style=StyleSheet.flatten(node.props.style);return [colors.selectedSurface,lightColors.selectedSurface].includes(style?.backgroundColor)&&style?.borderRadius===20;})[0];const padding=StyleSheet.flatten(userBubble.props.style);expect(padding.paddingVertical).toBe(12);expect(padding.paddingHorizontal).toBe(16);
 const sent=tree.root.findByProps({testID:'history-entry-7150'}).find(node=>node.props.selectable===true&&typeof node.props.children==='string');expect(StyleSheet.flatten(sent.props.style)).toMatchObject({fontSize:15,lineHeight:25});
expect(tree.root.findAllByProps({testID:'history-entry-7001'})).toHaveLength(0);
 await navigateTo(tree,'Sessions');await act(async()=>tree.root.findByType(SideDrawer).props.conversations.find((row:any)=>row.id==='8').onPress());
 const waiting=findList();expect(waiting).not.toBe(first);expect(waiting.props.inverted).toBe(true);expect(waiting.props.data).toHaveLength(0);expect(finishSecond).toBeDefined();
 await act(async()=>finishSecond!(response(pages.get(8))));check(8);
 await navigateTo(tree,'Sessions');await act(async()=>tree.root.findByType(SideDrawer).props.conversations.find((row:any)=>row.id==='7').onPress());check(7);
 await act(async()=>tree.unmount());holdCached=true;await act(async()=>{tree=Renderer.create(<App/>);});
 check(7);expect(finishCached).toBeDefined();expect(findList().props.data).toHaveLength(150);
 await act(async()=>finishCached!(response(pages.get(7))));check(7);await act(async()=>tree.unmount());
});

test.each([[true,false,false],[false,false,false],[true,true,false],[false,false,true]])('send renders immediately, queues offline and reconciles without duplicate rows (receipt exists: %s, question answer: %s, Bob working: %s)',async(receiptExists,choiceAnswer,bobWorking)=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={};
 const lifecycle=new Set<(state:any)=>void>();
 jest.spyOn(AppState,'addEventListener').mockImplementation((event,callback)=>{if(event==='change')lifecycle.add(callback as any);return{remove:()=>{lifecycle.delete(callback as any);}};});
 let snapshot:((event:any)=>void)|undefined;
 const EventSource=require('react-native-sse');
 EventSource.mockImplementation(()=>({addEventListener:jest.fn((event,callback)=>{if(event==='snapshot')snapshot=callback;}),close:jest.fn(),open:jest.fn()}));
 let online=false,posted=false;
 const posts:any[]=[];
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any,options:any)=>{
  const url=String(input);let data:any={};
  if(url.endsWith('/messages')){
   posts.push(JSON.parse(options.body));posted=true;
   if(!online)throw Error('Network response lost');
   data={status:'placed',entry:42};
  }else if(url.includes('/operations/')){
   if(posted&&!online)throw Error('Offline');
   data={admission:online&&receiptExists?{status:'placed',entry:42}:null};
  }else if(url.includes('/history'))data={backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[]};
  else if(url.endsWith('/chats'))data={items:[{id:7,meta:{title:'Test'}}]};
  else if(url.endsWith('/updates'))data={enabled:false};
  else if(url.endsWith('/ui')||url.endsWith('/models'))data=[];
  return {ok:true,status:200,json:async()=>data} as Response;
 });
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<App/>);});
 try {
 if(bobWorking){await act(async()=>snapshot?.({data:JSON.stringify({backendId:backend.backendId,conversationId:7,view:{entries:[],docs:{'pi.live':{run:{taskId:99,inputs:[]}}}}})}));expect(tree.root.findByProps({accessibilityLabel:'Stop Bob'})).toBeDefined();}
 if(choiceAnswer)await act(async()=>snapshot?.({data:JSON.stringify({backendId:backend.backendId,conversationId:7,view:{entries:[],docs:{'bob.questions':{pending:{id:'question-fixture',text:'Pick your reply',options:['Instant message','Something else']}}}}})}));
 act(()=>tree.root.findByProps({accessibilityLabel:'Message draft'}).props.onChangeText(choiceAnswer?'Keep this draft':'Instant message'));
 let release!:()=>void;
 const setItem=(AsyncStorage.setItem as jest.Mock).getMockImplementation()!;
 jest.spyOn(AsyncStorage,'setItem').mockImplementation((key,value)=>key==='message-outbox:v2'?new Promise<void>(resolve=>{release=()=>{void setItem(key,value).then(resolve);};}):setItem(key,value));
 if(choiceAnswer){
  act(()=>tree.root.findByProps({accessibilityLabel:'Instant message'}).props.onPress());
  act(()=>tree.root.findByProps({accessibilityLabel:'Send selected answer'}).props.onPress());
 }else act(()=>tree.root.findByProps({accessibilityLabel:'Send message'}).props.onPress());
 const list=()=>tree.root.findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0];
 expect(list().props.data).toHaveLength(1);
 expect(list().props.data[0].data.text).toBe('Instant message');
 const localKey=list().props.keyExtractor(list().props.data[0]);
 expect(tree.root.findByProps({accessibilityLabel:'Message draft'}).props.value).toBe(choiceAnswer?'Keep this draft':'');
 if(choiceAnswer)expect(tree.root.findAllByProps({testID:'question-card'})).toHaveLength(0);
 expect(posts).toHaveLength(0);
 await act(async()=>{await Promise.resolve();});
 // Release the disk write; the first send loses its response. No error UI or
 // composer rollback is needed for a transient connection failure.
 jest.spyOn(AsyncStorage,'setItem').mockImplementation(setItem);
 await act(async()=>release());
 expect(posts).toHaveLength(1);expect(list().props.data).toHaveLength(1);
 if(choiceAnswer)expect(posts[0].questionId).toBe('question-fixture');
 expect(await readOutbox()).toHaveLength(1);
 online=true;
 await act(async()=>{for(const callback of lifecycle)callback('active');});
 expect(posts).toHaveLength(receiptExists?1:2);
 expect(new Set(posts.map(post=>post.requestId)).size).toBe(1);
 expect(list().props.data).toHaveLength(1);
 await act(async()=>snapshot?.({data:JSON.stringify({backendId:backend.backendId,conversationId:7,view:{entries:[{id:42,kind:'bob.user',data:{text:'Instant message',requestId:'5aaee20e-e260-4403-80da-b97ce80664a1'}}],docs:{}}})}));
 expect(list().props.data).toHaveLength(1);expect(list().props.data[0].id).toBe(42);
 expect(list().props.keyExtractor(list().props.data[0])).toBe(localKey);
 const writes=()=> (AsyncStorage.setItem as jest.Mock).mock.calls.filter(([key])=>key.startsWith(`chunked:history:${backend.backendId}:7`)).length;
 const written=writes();
 await act(async()=>snapshot?.({data:JSON.stringify({backendId:backend.backendId,conversationId:7,view:{entries:[{id:42,kind:'bob.user',data:{text:'Instant message',requestId:'5aaee20e-e260-4403-80da-b97ce80664a1'}}],docs:{}}})}));
 expect(writes()).toBe(written);
 expect(await readOutbox()).toEqual([]);
 }finally{await act(async()=>tree.unmount());}
});

test('a rejected message is marked Not sent and remains between the same chat entries as replies arrive',async()=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={};
 jest.spyOn(require('react-native').Alert,'alert').mockImplementation(()=>{});
 let snapshot:((event:any)=>void)|undefined;
 require('react-native-sse').mockImplementation(()=>({addEventListener:jest.fn((event,callback)=>{if(event==='snapshot')snapshot=callback;}),close:jest.fn(),open:jest.fn()}));
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{
  const url=String(input);
  const data=url.endsWith('/messages')?{error:'Message rejected'}:url.includes('/operations/')?{admission:null}:url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[]}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Test'}}]}:url.endsWith('/updates')?{enabled:false}:[];
  return {ok:!url.endsWith('/messages'),status:url.endsWith('/messages')?412:200,json:async()=>data} as Response;
 });
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<App/>);});
 try{
  const entry=(id:number)=>({id,kind:'pi.assistant',model:[{role:'assistant',content:[{type:'text',text:`Reply ${id}`}]}]});
  const publish=(entries:any[])=>snapshot?.({data:JSON.stringify({backendId:backend.backendId,conversationId:7,view:{entries,docs:{}}})});
  await act(async()=>publish([entry(10)]));
  act(()=>tree.root.findByProps({accessibilityLabel:'Message draft'}).props.onChangeText('This cannot be sent'));
  await act(async()=>tree.root.findByProps({accessibilityLabel:'Send message'}).props.onPress());
  const list=()=>tree.root.findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0];
  const local=list().props.data[0].id;
  expect(list().props.data.map((value:any)=>value.id)).toEqual([local,10]);
  const labels=tree.root.findAll(node=>node.type===require('react-native').Text&&node.props.children==='Not sent');
  expect(labels.length).toBeGreaterThan(0);
  await act(async()=>publish([entry(10),entry(20),entry(30)]));
  expect(list().props.data.map((value:any)=>value.id)).toEqual([30,20,local,10]);
  const stored=(await readOutbox())[0] as {afterEntryId:number;rejected:boolean};
  expect(stored.afterEntryId).toBe(10);expect(stored.rejected).toBe(true);
 }finally{await act(async()=>tree.unmount());}
});

test('agent reports are collapsible non-owner rows; active indicator clears on idle while agent history remains',async()=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={};
 const report='[subagent Audit helper answered, no reply needed] Fixture report.';
 const entries=[{id:1,kind:'bob.user',data:{text:report}},{id:2,kind:'pi.user',model:[{role:'user',content:report}]},{id:3,kind:'bob.subagent-report',data:{name:'Audit helper',conversationId:8},model:[{role:'user',content:report}]}];
 const EventSource=require('react-native-sse');const snapshots=new Map<string,(value:any)=>void>();const closes=new Map<string,jest.Mock>();
 EventSource.mockImplementation((url:string)=>{const close=jest.fn();closes.set(url,close);return{addEventListener:jest.fn((event,callback)=>{if(event==='snapshot')snapshots.set(url,callback);}),close};});
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{
  const url=String(input);return {ok:true,status:200,json:async()=>url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:entries}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Test chat'}}]}:url.endsWith('/updates')?{enabled:false}:url.endsWith('/peers')?{inbound:[],outbound:[]}:[]} as Response;
 });
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<App/>);});
 try{
 const publish=async(status:string)=>act(async()=>{snapshots.get(`${backend.endpoint}/v1/chats/7/events`)!({data:JSON.stringify({backendId:backend.backendId,conversationId:7,view:{entries,docs:{'app.subagents':{agents:{'Audit helper':{conversationId:8,status},'Second helper':{conversationId:9,status:'idle'}}}},work:[]}})});});
 await publish('working');expect(tree.root.findAllByProps({accessibilityLabel:'Toggle subagents, 1 active agents'})).toHaveLength(0);
 expect(tree.root.findByProps({testID:'chat-menu-agent-badge'})).toBeDefined();
 expect(tree.root.findByProps({accessibilityLabel:'Menu'}).props.accessibilityValue.text).toBe('1 active agent');
 await publish('stopping');expect(tree.root.findByProps({testID:'chat-menu-agent-badge'})).toBeDefined();
 await publish('working');
 const unknown=tree.root.findByProps({testID:'history-entry-2'}),projected=tree.root.findByProps({testID:'history-entry-3'});
 expect(unknown.findByProps({accessibilityLabel:'Input · source not identified'}).props.accessibilityState.expanded).toBe(false);
 const reportHeader=projected.findAll(node=>node.props.accessibilityLabel==='Agent report · Audit helper'&&node.props.accessibilityRole==='button'&&!!node.props.style)[0];
 expect(reportHeader.props.accessibilityState.expanded).toBe(false);
 expect(projected.findByType(CompactActivityRow).props).toMatchObject({title:'Agent report',detail:'Audit helper',status:'received'});
 expect(StyleSheet.flatten(reportHeader.props.style)).toMatchObject({minHeight:48,paddingVertical:6});
 expect(StyleSheet.flatten(reportHeader.props.style).backgroundColor).toBeUndefined();
 expect(projected.findAllByType(ModelContent)).toHaveLength(0);
 expect(projected.findAllByType(CopyAction)).toHaveLength(0);
 const reportDraft=tree.root.findByProps({accessibilityLabel:'Message draft'}),reportList=tree.root.findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0];
 act(()=>reportDraft.props.onChangeText('Draft survives report expansion'));
 act(()=>reportHeader.props.onPress());
 expect(reportHeader.props.accessibilityState.expanded).toBe(true);
 expect(reportHeader.props.accessibilityHint).toContain('Collapse');
 expect(projected.findByType(ModelContent).props).toMatchObject({value:report,speakable:false});
 expect(projected.findByType(CopyAction).props.text).toBe(report);
 const copyText=jest.fn(async()=>{});NativeModules.BobPlatform.copyText=copyText;
 await act(async()=>projected.findAll(node=>node.props.accessibilityLabel==='Copy reply'&&typeof node.props.onPress==='function')[0].props.onPress());
 expect(copyText).toHaveBeenCalledWith(report);
 expect(tree.root.findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0]).toBe(reportList);
 expect(tree.root.findByProps({accessibilityLabel:'Message draft'})).toBe(reportDraft);
 expect(reportDraft.props.value).toBe('Draft survives report expansion');
 act(()=>reportHeader.props.onPress());
 expect(projected.findAllByType(ModelContent)).toHaveLength(0);
 for(const row of [unknown,projected])expect(row.findAll(node=>StyleSheet.flatten(node.props.style)?.alignSelf==='flex-end')).toHaveLength(0);
 expect(tree.root.findByProps({testID:'history-entry-1'}).findAll(node=>StyleSheet.flatten(node.props.style)?.alignSelf==='flex-end').length).toBeGreaterThan(0);
 const list=tree.root.findByProps({testID:'chat-history-list'});
 const draft=tree.root.findByProps({accessibilityLabel:'Message draft'});
 act(()=>draft.props.onChangeText('Draft stays here'));
 await navigateTo(tree,'Agents');
 expect(tree.root.findByProps({testID:'agents-screen'})).toBeDefined();
 expect(tree.root.findByProps({testID:'child-history-list'})).toBeDefined();
 expect(tree.root.findByProps({testID:'chat-history-list'})).toBe(list);
 expect(StyleSheet.flatten(tree.root.findByProps({testID:'chat-composer'}).props.style).opacity).toBe(0);
 expect(tree.root.findByProps({accessibilityLabel:'View agent Audit helper'}).props.accessibilityState.selected).toBe(true);
 await act(async()=>snapshots.get(`${backend.endpoint}/v1/chats/8/events`)!({data:JSON.stringify({backendId:backend.backendId,conversationId:8,view:{entries:[{id:10,kind:'pi.assistant',model:[{role:'assistant',content:'Agent is working here.'}]}],docs:{},work:[]}})}));
 expect(tree.root.findByProps({testID:'child-history-list'}).props.data.some((e:any)=>e.id===10)).toBe(true);
 const firstStreamClose=closes.get(`${backend.endpoint}/v1/chats/8/events`);
 await publish('idle');
 expect(tree.root.findAllByProps({testID:'active-agent-badge'})).toHaveLength(0);
 expect(firstStreamClose).toHaveBeenCalled();
 expect(tree.root.findAllByProps({testID:'child-history-list'})).toHaveLength(0);
 expect(tree.root.findAllByProps({accessibilityLabel:'View agent Audit helper'})).toHaveLength(0);
 await publish('stopping');
 expect(tree.root.findByProps({accessibilityLabel:'View agent Audit helper'})).toBeDefined();
 expect(tree.root.findAllByProps({accessibilityLabel:'View agent Second helper'})).toHaveLength(0);
 await act(async()=>tree.root.findByProps({accessibilityLabel:'Agent history'}).props.onPress());
 await act(async()=>tree.root.findByProps({accessibilityLabel:'View agent Second helper'}).props.onPress());
 expect(closes.get(`${backend.endpoint}/v1/chats/8/events`)).toHaveBeenCalled();
 expect(tree.root.findByProps({accessibilityLabel:'View agent Second helper'}).props.accessibilityState.selected).toBe(true);
 expect(tree.root.findByProps({testID:'child-history-list'}).props.data.some((e:any)=>e.id===10)).toBe(false);
 await act(async()=>snapshots.get(`${backend.endpoint}/v1/chats/8/events`)!({data:JSON.stringify({backendId:backend.backendId,conversationId:8,view:{entries:[{id:11,kind:'pi.assistant',model:[{role:'assistant',content:'Late wrong agent'}]}],docs:{},work:[]}})}));
 expect(tree.root.findByProps({testID:'child-history-list'}).props.data.some((e:any)=>e.id===11)).toBe(false);
 await publish('idle');
 expect(tree.root.findByProps({accessibilityLabel:'View agent Audit helper'})).toBeDefined();
 await navigateTo(tree,'Chat');
 expect(closes.get(`${backend.endpoint}/v1/chats/9/events`)).toHaveBeenCalled();
 expect(tree.root.findByProps({testID:'agents-screen'}).props.pointerEvents).toBe('none');
 expect(tree.root.findByProps({testID:'chat-history-list'})).toBe(list);
 expect(draft.props.value).toBe('Draft stays here');
 await navigateTo(tree,'Agents');
 expect(tree.root.findByProps({accessibilityLabel:'Agent history'}).props.accessibilityState.checked).toBe(false);
 expect(tree.root.findAllByProps({accessibilityLabel:'View agent Audit helper'})).toHaveLength(0);
 expect(tree.root.findAllByProps({testID:'child-history-list'})).toHaveLength(0);
 await navigateTo(tree,'Chat');
 expect(fetch).not.toHaveBeenCalledWith(expect.anything(),expect.objectContaining({method:'POST'}));
 }finally{await act(async()=>tree.unmount());}
});

// MCP Apps must retain a tappable entry even though they never mount inline.
test('MCP app rows retain an accessible open control',async()=>{
 const open=jest.fn();let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<InlineSurface backend={{backendId:'fixture',endpoint:'https://test.ts.net'}} surface={{id:'fixture',conversationId:7,title:'Connected app',kind:'mcp'}} onExpand={open}/>);});
 act(()=>tree.root.findByProps({accessibilityLabel:'Open app: Connected app'}).props.onPress());
 expect(open).toHaveBeenCalledTimes(1);expect(tree.root.findAllByProps({testID:'bob-inline-native-surface'})).toHaveLength(0);
 await act(async()=>tree.unmount());
});

test('chat opening shows only a small spinner until restoring the draft makes typing safe',async()=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};
 let restore!:(value:string)=>void;
 const get=(AsyncStorage.getItem as jest.Mock).getMockImplementation()!;
 (AsyncStorage.getItem as jest.Mock).mockImplementation((key:string)=>key===`draft:${backend.backendId}:7`?new Promise(resolve=>{restore=resolve;}):get(key));
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{
  const url=String(input),data=url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[]}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'New conversation'}}]}:url.endsWith('/updates')?{enabled:false}:url.endsWith('/peers')?{inbound:[],outbound:[]}:[];
  return {ok:true,status:200,json:async()=>data} as Response;
 });
 let tree!:Renderer.ReactTestRenderer;
 try{
  await act(async()=>{tree=Renderer.create(<App/>);});
  expect(tree.root.findByProps({testID:'chat-opening'}).props.accessibilityState.busy).toBe(true);
  expect(tree.root.findByProps({accessibilityLabel:'Message draft'}).props.editable).toBe(false);
  expect(tree.root.findAllByProps({testID:'connection-status'})).toHaveLength(0);
  await act(async()=>restore('Retained draft'));
  expect(tree.root.findAllByProps({testID:'chat-opening'})).toHaveLength(0);
  expect(tree.root.findByProps({accessibilityLabel:'Message draft'}).props).toMatchObject({editable:true,value:'Retained draft'});
  expect(tree.root.findAllByProps({testID:'connection-status'})).toHaveLength(0);
 }finally{(AsyncStorage.getItem as jest.Mock).mockImplementation(get);if(tree)await act(async()=>tree.unmount());}
});


test('rapid A-to-B-to-A switching keeps the composer locked until the new draft read completes',async()=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={versionCode:38,versionName:'test'};
 const get=(AsyncStorage.getItem as jest.Mock).getMockImplementation()!;
 const reads=new Map<string,((value:string)=>void)[]>();let hold=false;
 (AsyncStorage.getItem as jest.Mock).mockImplementation((key:string)=>{
  if(hold&&key.startsWith(`draft:${backend.backendId}:`))return new Promise(resolve=>{reads.set(key,[...(reads.get(key)??[]),resolve]);});
  return get(key);
 });
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{
  const url=String(input),id=Number(/\/chats\/(\d+)/.exec(url)?.[1]??7);
  const data=url.includes('/history')?{backendId:backend.backendId,conversationId:id,coverage:'stored-entries',items:[]}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'A'}},{id:8,meta:{title:'B'}}]}:url.endsWith('/updates')?{enabled:false}:url.endsWith('/peers')?{inbound:[],outbound:[]}:[];
  return {ok:true,status:200,json:async()=>data} as Response;
 });
 let tree!:Renderer.ReactTestRenderer;
 try{
  await act(async()=>{tree=Renderer.create(<App/>);});
  expect(tree.root.findByProps({accessibilityLabel:'Message draft'}).props.editable).toBe(true);hold=true;
  const choose=async(id:string)=>{
   await navigateTo(tree,'Sessions');
   await act(async()=>tree.root.findByType(SideDrawer).props.conversations.find((row:any)=>row.id===id).onPress());
  };
  await choose('8');await choose('7');
  expect(tree.root.findByProps({accessibilityLabel:'Message draft'}).props.editable).toBe(false);
  await act(async()=>reads.get(`draft:${backend.backendId}:8`)![0]('Stale B draft'));
  expect(tree.root.findByProps({accessibilityLabel:'Message draft'}).props.editable).toBe(false);
  await act(async()=>reads.get(`draft:${backend.backendId}:7`)![0]('Restored A draft'));
  expect(tree.root.findByProps({accessibilityLabel:'Message draft'}).props).toMatchObject({editable:true,value:'Restored A draft'});
 }finally{(AsyncStorage.getItem as jest.Mock).mockImplementation(get);if(tree)await act(async()=>tree.unmount());}
});

test('Send hands off to Android before JS persistence completes and immediate backgrounding',async()=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={};
 const enqueue=jest.fn(async()=>true);NativeModules.BobOutbox={enqueue,status:jest.fn(async()=>JSON.stringify({state:'pending'})),list:jest.fn(async()=>[]),remove:jest.fn(async()=>true)};
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{const url=String(input);return {ok:true,status:200,json:async()=>url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[]}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Test'}}]}:url.endsWith('/updates')?{enabled:false}:[]} as Response;});
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<App/>);});
 const write=(AsyncStorage.setItem as jest.Mock).getMockImplementation()!;let release!:(value?:unknown)=>void;
 jest.spyOn(AsyncStorage,'setItem').mockImplementation(async(key,value)=>{if(key==='message-outbox:v2')await new Promise(resolve=>{release=resolve;});await write(key,value);});
 try{
  act(()=>tree.root.findByProps({accessibilityLabel:'Message draft'}).props.onChangeText('Lock immediately'));
  act(()=>tree.root.findByProps({accessibilityLabel:'Send message'}).props.onPress());
  expect(enqueue).toHaveBeenCalledTimes(1);expect(JSON.parse((enqueue.mock.calls[0] as unknown as any[])[5]).text).toBe('Lock immediately');
  jest.replaceProperty(AppState,'currentState','background');
  await act(async()=>{for(let i=0;i<20;i++)await Promise.resolve();});expect(release).toBeDefined();expect(enqueue).toHaveBeenCalledTimes(1);
  await act(async()=>release());
 }finally{(AsyncStorage.setItem as jest.Mock).mockImplementation(write);await act(async()=>tree.unmount());delete NativeModules.BobOutbox;}
});

test('Sessions assigns working state by Durable conversation ID, not by the selected chat',async()=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={};
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{
  const url=String(input),data=url.endsWith('/status')?{backendId:backend.backendId,inspection:{tasks:[{record:{conversationId:8,background:false}},{record:{conversationId:7,background:true}}],submissions:[{conversationId:9}]}}:url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[]}:url.endsWith('/chats')?{items:[7,8,9].map(id=>({id,meta:{title:`Chat ${id}`}}))}:url.endsWith('/updates')?{enabled:false}:[];
  return {ok:true,status:200,json:async()=>data} as Response;
 });
 let tree!:Renderer.ReactTestRenderer;
 try{
  await act(async()=>{tree=Renderer.create(<App/>);});
  expect((globalThis.fetch as jest.Mock).mock.calls.some(([url])=>String(url).endsWith('/status'))).toBe(false);
  await navigateTo(tree,'Sessions');
  expect(tree.root.findByType(SideDrawer).props.conversations.map(({id,selected,working}:any)=>({id,selected,working}))).toEqual([
   {id:'7',selected:true,working:false},{id:'8',selected:false,working:true},{id:'9',selected:false,working:true},
  ]);
 }finally{if(tree)await act(async()=>tree.unmount());}
});

test.each(['parent','receipt-only','unlinked'])('nested surfaces retain a safe reachable location (%s)',async(placement)=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 const surface={id:'a841d08a-8b83-42cd-b8a7-2d61f2db7ae9',conversationId:7,title:'Nested visual',kind:'visual',presentation:'fullscreen',allowedTools:[]};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={versionCode:35,versionName:'test'};NativeModules.BobInteractive={open:jest.fn(async()=>{}),prepare:jest.fn()};
 const entries=[
  ...(placement==='parent'?[{id:1,kind:'pi.assistant',model:[{role:'assistant',content:[{type:'toolCall',id:'code',name:'codemode',arguments:{code:'tools.render_visual(...)'}}]}]}]:[]),
  ...(placement!=='unlinked'?[{id:2,kind:'bob.nested-surface',data:{appId:surface.id,parentToolCallId:'code',toolName:'render_visual'}}]:[]),
  {id:3,kind:'pi.assistant',model:[{role:'assistant',content:[{type:'text',text:'A later reply, not the producing call.'}]}]},
 ];
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{
  const url=String(input),data=url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:entries}:url.endsWith('/ui')?[surface]:url.endsWith('/updates')?{enabled:false}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Test chat'}}]}:url.endsWith('/peers')?{inbound:[],outbound:[]}:url.endsWith('/library')?{instructions:'',templates:{},skills:{}}:[];
  return {ok:true,status:200,json:async()=>data} as Response;
 });
 let tree!:Renderer.ReactTestRenderer;
 try{
  await act(async()=>{tree=Renderer.create(<App/>);});
  expect(tree.root.findByProps({testID:'history-entry-3'}).findAllByType(InlineSurface)).toHaveLength(0);
  expect(NativeModules.BobInteractive.open).not.toHaveBeenCalled();expect(NativeModules.BobInteractive.prepare).not.toHaveBeenCalled();
  const press=(label:string)=>tree.root.findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0].props.onPress();
  if(placement==='unlinked'){
   expect(tree.root.findAllByType(InlineSurface)).toHaveLength(0);
   expect(tree.root.findAllByProps({accessibilityLabel:'Other interactive surfaces'})).toHaveLength(0);
   const list=tree.root.findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0];
   act(()=>tree.root.findByProps({accessibilityLabel:'Message draft'}).props.onChangeText('Keep my draft'));
   await act(async()=>press('Chat actions'));
   await act(async()=>press('More'));
   expect(list.findAllByProps({accessibilityLabel:'Other interactive surfaces'})).toHaveLength(0);
   expect(tree.root.findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0]).toBe(list);
   await act(async()=>press('Other interactive surfaces'));
   expect(NativeModules.BobInteractive.open).not.toHaveBeenCalled();
   await act(async()=>press('Open Nested visual'));
   expect(tree.root.findAllByProps({accessibilityLabel:'Other interactive surfaces'})).toHaveLength(0);
   expect(tree.root.findByProps({accessibilityLabel:'Message draft'}).props.value).toBe('Keep my draft');
  }else{
   expect(tree.root.findByProps({testID:`history-entry-${placement==='parent'?1:2}`}).findAllByType(InlineSurface)).toHaveLength(1);
   expect(tree.root.findAllByProps({accessibilityLabel:'Other interactive surfaces'})).toHaveLength(0);
   await act(async()=>press('Expand visual: Nested visual'));
  }
  expect(NativeModules.BobInteractive.open).toHaveBeenCalledWith(backend.endpoint,backend.backendId,'test-token',7,surface.id);
 }finally{if(tree)await act(async()=>tree.unmount());}
});

test.each([{capability:{inlineHeight:8192},height:8192},{capability:undefined,height:420}])('outbound visual bounds follow the selected backend snapshot ($height)',async({capability,height})=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={};delete NativeModules.BobOutbox;
 jest.spyOn(require('react-native').Alert,'alert').mockImplementation(()=>{});
 let snapshot:((event:any)=>void)|undefined;
 require('react-native-sse').mockImplementation(()=>({addEventListener:jest.fn((event,callback)=>{if(event==='snapshot')snapshot=callback;}),close:jest.fn(),open:jest.fn()}));
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{
  const url=String(input),message=url.endsWith('/messages');
  const data=message?{error:'Keep the outgoing fixture for inspection'}:url.includes('/operations/')?{admission:null}:url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[]}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Test'}}]}:url.endsWith('/updates')?{enabled:false}:[];
  return {ok:!message,status:message?412:200,json:async()=>data} as Response;
 });
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<App/>);});
 try{
  expect(snapshot).toBeDefined();
  await act(async()=>snapshot!({data:JSON.stringify({backendId:backend.backendId,conversationId:7,view:{entries:[],docs:capability?{'bob.display':capability}:{}}})}));
  const list=tree.root.findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0];
  act(()=>{list.props.ListHeaderComponent.props.onLayout({nativeEvent:{layout:{width:313}}});tree.root.findByProps({accessibilityLabel:'Message draft'}).props.onChangeText('Show a naturally sized card');});
  await act(async()=>tree.root.findByProps({accessibilityLabel:'Send message'}).props.onPress());
  expect(require('react-native').Alert.alert).not.toHaveBeenCalled();
  const outgoing=await readOutbox() as Array<{message:{display?:{inline:unknown}}}>;expect(outgoing).toHaveLength(1);
  expect(outgoing[0].message.display?.inline).toEqual({width:313,height});
 }finally{await act(async()=>tree.unmount());}
});

test('delayed Use default verification never discards a newer reopened instructions edit with identical text',async()=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={};
 let configured:{instructions:string|null;cwd:string}={instructions:'Saved',cwd:'/backend'},hold=false,release:((response:Response)=>void)|undefined;
 const response=(data:unknown)=>({ok:true,status:200,json:async()=>data}) as Response;
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any,init:any)=>{
  const url=String(input);
  if(url.endsWith('/configure')){
   if(init?.method==='PUT'){configured={...configured,...JSON.parse(init.body)};hold=true;return response(configured);}
   if(hold){hold=false;return new Promise<Response>(resolve=>{release=resolve;});}
   return response({...configured});
  }
  return response(url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[]}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Test'}}]}:url.endsWith('/updates')?{enabled:false}:[]);
 });
 let tree!:Renderer.ReactTestRenderer;
 try{
  await act(async()=>{tree=Renderer.create(<App/>);});
  const press=(label:string)=>tree.root.findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0].props.onPress();
  const reopen=async()=>{await navigateTo(tree,'Chat');await navigateTo(tree,'Settings');await act(async()=>press('Instructions & folder'));};
  await reopen();act(()=>tree.root.findByProps({accessibilityLabel:'Conversation instructions'}).props.onChangeText('A'));
  await act(async()=>press('Use backend default instructions'));expect(release).toBeDefined();expect(configured.instructions).toBeNull();
  await reopen();
  act(()=>tree.root.findByProps({accessibilityLabel:'Conversation instructions'}).props.onChangeText('B'));
  act(()=>tree.root.findByProps({accessibilityLabel:'Conversation instructions'}).props.onChangeText('A'));
  await act(async()=>release!(response({...configured})));
  await reopen();expect(tree.root.findByProps({accessibilityLabel:'Conversation instructions'}).props.value).toBe('A');
 }finally{if(tree)await act(async()=>tree.unmount());}
});

test('drawing attachment propagates transfer/staging failures and cleans up a file staged after a conversation switch',async()=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};
 const stage=jest.fn(),remove=jest.fn(async()=>{});NativeModules.BobFiles={stageDataUri:stage,removeAttachment:remove};
 let transferFailure=true;
 const response=(data:unknown)=>({ok:true,status:200,json:async()=>data}) as Response;
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{
  const url=String(input);
  if(url.endsWith('/transfer-limits')){if(transferFailure)throw Error('Transfer unavailable');return response({uploadLimit:1024});}
  return response(url.includes('/history')?{backendId:backend.backendId,conversationId:url.includes('/8/')?8:7,coverage:'stored-entries',items:[]}:url.endsWith('/chats')?{items:[7,8].map(id=>({id,meta:{title:`Chat ${id}`}}))}:url.endsWith('/updates')?{enabled:false}:[]);
 });
 let tree!:Renderer.ReactTestRenderer;
 try{
  await act(async()=>{tree=Renderer.create(<App/>);});
  const add=tree.root.findByType(DrawingEditor).props.onAdd;
  await expect(add('data:image/png;base64,png')).rejects.toThrow('Transfer unavailable');expect(stage).not.toHaveBeenCalled();
  transferFailure=false;stage.mockRejectedValueOnce(Error('Storage full'));
  await expect(add('data:image/png;base64,png')).rejects.toThrow('Storage full');
  let finish!:(value:any)=>void;stage.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  let result!:Promise<unknown>;
  await act(async()=>{result=add('data:image/png;base64,png').catch((error:Error)=>error);});expect(finish).toBeDefined();
  await navigateTo(tree,'Sessions');
  await act(async()=>tree.root.findByType(SideDrawer).props.conversations.find((row:any)=>row.id==='8').onPress());
  await act(async()=>finish({id:'5aaee20e-e260-4403-80da-b97ce80664a1',name:'drawing.png',mime:'image/png',uri:'file:///draft'}));
  expect(await result).toEqual(Error('Conversation changed. Drawing was not attached.'));
  expect(remove).toHaveBeenCalledWith('5aaee20e-e260-4403-80da-b97ce80664a1');
 }finally{if(tree)await act(async()=>tree.unmount());}
});

test('native run failures remain passive status, preserve drafts, and do not make an idle run busy',async()=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={};delete NativeModules.BobOutbox;
 let snapshot:((event:any)=>void)|undefined;
 require('react-native-sse').mockImplementation(()=>({addEventListener:jest.fn((event,callback)=>{if(event==='snapshot')snapshot=callback;}),close:jest.fn(),open:jest.fn()}));
 const fetch=jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{
  const url=String(input),data=url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[]}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Test'}}]}:url.endsWith('/updates')?{enabled:false}:[];
  return {ok:true,status:200,json:async()=>data} as Response;
 });
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<App/>);});
 const publish=async(live:any)=>act(async()=>snapshot!({data:JSON.stringify({backendId:backend.backendId,conversationId:7,view:{entries:[],docs:{'pi.live':live}}})}));
 try{
  await publish({run:{taskId:99,inputs:[]}});expect(tree.root.findByProps({accessibilityLabel:'Stop Bob'})).toBeDefined();
  const draft=tree.root.findByProps({accessibilityLabel:'Message draft'});act(()=>draft.props.onChangeText('Keep this draft'));
  await publish({runFailure:{taskId:99,reason:'restart_limit',detail:'private provider detail'}});
  const displayed=tree.root.findAll(node=>typeof node.props.children==='string').map(node=>node.props.children).join('\n');
  expect(displayed).toContain('Response stopped after repeated runtime interruptions.');
  expect(displayed).not.toContain('private provider detail');expect(draft.props.value).toBe('Keep this draft');
  act(()=>draft.props.onChangeText('')); // Draft presence must not mask a stale busy state.
  expect(tree.root.findAllByProps({accessibilityLabel:'Stop Bob'})).toHaveLength(0);
  const list=tree.root.findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0];expect(list.props.data).toEqual([]);
  await publish({run:{taskId:100,inputs:[]},runFailure:{taskId:99,reason:'restart_limit'}});
  expect(tree.root.findByProps({accessibilityLabel:'Stop Bob'})).toBeDefined();
  expect(tree.root.findAllByProps({testID:'native-run-status'})).toHaveLength(0);
  expect(fetch.mock.calls.every(([,options])=>!options?.method||options.method==='GET')).toBe(true);
 }finally{await act(async()=>tree.unmount());}
});

test('original per-entry tool layout stays separate and preserves the chat list and draft',async()=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={versionCode:35,versionName:'test'};
 const file={id:'a841d08a-8b83-42cd-b8a7-2d61f2db7ae9',conversationId:7,name:'fixture.txt',mime:'text/plain',size:12,sha256:'a'.repeat(64)};
 const items=[{id:7,kind:'bob.artifact',data:file},{id:8,kind:'bob.file',data:{...file,id:'b841d08a-8b83-42cd-b8a7-2d61f2db7ae9'}},{id:1,kind:'bob.user',data:{text:'Check these files'}},{id:2,kind:'pi.assistant',model:[{role:'assistant',content:[{type:'text',text:'Checking the files.'},{type:'toolCall',id:'a',name:'read',arguments:{path:'a.txt'}}]}]},{id:3,kind:'pi.tool-result',model:[{role:'toolResult',toolCallId:'a',toolName:'read',content:'FIRST'}]},{id:4,kind:'pi.assistant',model:[{role:'assistant',content:[{type:'toolCall',id:'b',name:'read',arguments:{path:'b.txt'}}]}]},{id:5,kind:'pi.tool-result',model:[{role:'toolResult',toolCallId:'b',toolName:'read',content:'SECOND'}]},{id:6,kind:'pi.assistant',model:[{role:'assistant',content:[{type:'text',text:'Here is the answer.'}]}]}];
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{const url=String(input);const data=url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Test chat'}}]}:url.endsWith('/updates')?{enabled:false}:url.endsWith('/peers')?{inbound:[],outbound:[]}:url.endsWith('/library')?{instructions:'',templates:{},skills:{},commands:[]}:url.endsWith('/configure')?{instructions:null,cwd:'/workspace'}:[];return{ok:true,status:200,json:async()=>data} as Response;});
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<App/>);});
 const list=tree.root.findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0];
 expect(list.props.data.map((entry:any)=>entry.id)).toEqual([8,7,6,4,2,1]);
 expect(tree.root.findAllByProps({accessibilityLabel:'Work summary'})).toHaveLength(0);
 const tools=tree.root.findAllByType(require('../components/tool-content').ToolContent);
 expect(tools).toHaveLength(2);expect(tools.every(tool=>tool.props.quiet)).toBe(true);
 const owner=tree.root.findByProps({testID:'history-entry-1'}).findByType(ChatBubble);
 expect(owner.props.variant).toBe('owner');
 expect(tree.root.findByProps({testID:'history-entry-7'}).findByType(ChatBubble).props.variant).toBe('upload');
 expect(tree.root.findByProps({testID:'history-entry-8'}).findByType(ChatBubble).props.variant).toBe('activity');
 expect(tree.root.findByProps({testID:'history-entry-7'}).findByType(require('../components/file-attachment').FileAttachment).props.fromBob).toBe(false);
 expect(tree.root.findByProps({testID:'history-entry-8'}).findByType(require('../components/file-attachment').FileAttachment).props.fromBob).toBe(true);
 const mixed=tree.root.findByProps({testID:'history-entry-2'});
 expect(mixed.findAllByType(ChatBubble).map(b=>b.props.variant??'assistant')).toEqual(['activity','assistant']);
 const answer=tree.root.findByProps({testID:'history-entry-6'});
 expect(answer.findAllByType(ChatBubble).map(b=>b.props.variant??'assistant')).toEqual(['activity','assistant']);
 const toolOnly=tree.root.findByProps({testID:'history-entry-4'});
 expect(toolOnly.findAllByType(ChatBubble).map(b=>b.props.variant??'assistant')).toEqual(['activity']);
 for(const bubble of mixed.findAllByType(ChatBubble).filter(b=>b.props.variant!=='activity'))expect(bubble.findAllByType(require('../components/tool-content').ToolContent)).toHaveLength(0);
 expect(StyleSheet.flatten(list.props.contentContainerStyle).paddingHorizontal).toBe(12);
 expect(tree.root.findByType(DraftInput).props.maxHeight).toBeLessThanOrEqual(156);

 await act(async()=>tree.root.findAllByProps({accessibilityLabel:'Tool details: read'})[0].props.onPress());
 expect(tree.root.findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0]).toBe(list);
 expect(tree.root.findByProps({testID:'history-entry-6'})).toBeDefined();
 expect(tree.root.findByProps({accessibilityLabel:'Message draft'}).props.value).toBe('');
 await act(async()=>tree.unmount());
});

test('recorded codemode audit branches expand independently while the script stays closed and the list/draft stay mounted',async()=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={versionCode:35,versionName:'test'};
 const items=[
  {id:1,kind:'pi.assistant',model:[{role:'assistant',content:[{type:'toolCall',id:'codemode-audit',name:'codemode',arguments:{code:'SCRIPT_BODY'}}]}]},
  {id:2,kind:'pi.tool-result',model:[{role:'toolResult',toolCallId:'codemode-audit',toolName:'codemode',content:'PARENT_RESULT',details:{calls:[{id:1,name:'bash',args:'{"command":"printf CHILD_ARGUMENT"}',status:'error',error:'CHILD_ERROR: command failed',durationMs:7}]}}]},
  {id:3,kind:'pi.assistant',model:[{role:'assistant',content:[{type:'toolCall',id:'another-tool',name:'read',arguments:{path:'another.txt'}}]}]},
  {id:4,kind:'pi.tool-result',model:[{role:'toolResult',toolCallId:'another-tool',toolName:'read',content:'ANOTHER_RESULT'}]},
  {id:5,kind:'pi.assistant',model:[{role:'assistant',content:'Normal answer spacing'}]},
 ];
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{
  const url=String(input),data=url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Audit chat'}}]}:url.endsWith('/updates')?{enabled:false}:[];
  return {ok:true,status:200,json:async()=>data} as Response;
 });
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<App/>);});
 try{
  const list=tree.root.findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0];
  const draft=tree.root.findByProps({accessibilityLabel:'Message draft'});
  act(()=>draft.props.onChangeText('Retain this draft'));
  expect(list.props.data.map((entry:any)=>entry.id)).toEqual([5,3,1]);
  expect(StyleSheet.flatten(list.props.contentContainerStyle).gap).toBe(0);
  expect(list.props.ItemSeparatorComponent({leadingItem:items[2]}).props.style.height).toBe(0);
  expect(list.props.ItemSeparatorComponent({leadingItem:items[4]}).props.style.height).toBe(16);
  const row=tree.root.findByProps({testID:'history-entry-1'});
  const header=(label:string)=>row.findAll(node=>node.props.accessibilityLabel===label&&node.props.accessibilityRole==='button'&&!!node.props.style)[0];
  expect(header('Tool details: codemode').props.accessibilityState.expanded).toBe(false);
  const branch=header('Nested tool details: bash · 1');
  expect(branch.props.accessibilityState.expanded).toBe(false);
  const displayed=()=>row.findAllByType(Text).map(node=>typeof node.props.children==='string'?node.props.children:'').join('\n');
  expect(displayed()).not.toContain('SCRIPT_BODY');
  expect(displayed()).not.toContain('CHILD_ERROR');
  act(()=>branch.props.onPress());
  expect(branch.props.accessibilityState.expanded).toBe(true);
  expect(displayed()).toContain('CHILD_ARGUMENT');
  expect(displayed()).toContain('CHILD_ERROR: command failed');
  expect(displayed()).not.toContain('SCRIPT_BODY');
  expect(displayed()).not.toContain('PARENT_RESULT');
  expect(header('Tool details: codemode').props.accessibilityState.expanded).toBe(false);
  expect(tree.root.findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0]).toBe(list);
  expect(tree.root.findByProps({accessibilityLabel:'Message draft'})).toBe(draft);
  expect(draft.props.value).toBe('Retain this draft');
 }finally{await act(async()=>tree.unmount());}
});

test('Bob mascot follows native work, scoped new answers and failures without changing send/stop',async()=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={};delete NativeModules.BobOutbox;
 let snapshot:((event:any)=>void)|undefined;
 require('react-native-sse').mockImplementation(()=>({addEventListener:jest.fn((event,callback)=>{if(event==='snapshot')snapshot=callback;}),close:jest.fn(),open:jest.fn()}));
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{const url=String(input),data=url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[]}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Test'}}]}:url.endsWith('/updates')?{enabled:false}:[];return{ok:true,status:200,json:async()=>data} as Response;});
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<App/>);});
 const entry=(id:number)=>({id,kind:'pi.assistant',model:[{role:'assistant',stopReason:'stop',content:[{type:'text',text:'Finished answer'}]}]});
 const publish=async(live:any,entries:any[])=>act(async()=>snapshot!({data:JSON.stringify({backendId:backend.backendId,conversationId:7,view:{entries,docs:{'pi.live':live}}})}));
 try{
  const nav=()=>visibleNavigation(tree),pose=()=>tree.root.findByProps({accessibilityLabel:'Menu'}).findByProps({testID:'bob-mascot'}).props.state;
  await publish({},[entry(2)]);expect(pose()).toBe('idle');expect(nav().props.completionKey).toBeUndefined();
  const draft=tree.root.findByProps({accessibilityLabel:'Message draft'});
  await publish({run:{taskId:10,first:3}},[entry(2)]);expect(pose()).toBe('working');expect(tree.root.findByProps({accessibilityLabel:'Stop Bob'})).toBeDefined();
  await publish({},[entry(2),entry(4)]);expect(pose()).toBe('done');expect(nav().props.completionKey).toBe(`${backend.backendId}:7:4`);
  act(()=>draft.props.onChangeText('Retain my draft'));
  await publish({run:{taskId:11,first:5},runFailure:{reason:'old error'}},[entry(4)]);expect(pose()).toBe('working');
  await publish({runFailure:{taskId:11,reason:'model_error'}},[entry(4)]);expect(pose()).toBe('attention');expect(tree.root.findAllByProps({accessibilityLabel:'Stop Bob'})).toHaveLength(0);
  expect(tree.root.findByProps({accessibilityLabel:'Message draft'})).toBe(draft);expect(draft.props.value).toBe('Retain my draft');
  await publish({run:{taskId:12,first:6}},[entry(4)]);
  await act(async()=>tree.root.findByProps({accessibilityLabel:'Chat actions'}).props.onPress());
  expect(nav().props.animated).toBe(false);
  await publish({},[entry(4),entry(8)]);
  expect(pose()).not.toBe('done');
  await act(async()=>tree.root.findByProps({accessibilityLabel:'Dismiss chat actions'}).props.onPress());
  expect(nav().props.animated).toBe(true);expect(pose()).toBe('idle');
 }finally{await act(async()=>tree.unmount());}
});
