// Observe real effect ordering without replacing the dispatcher or scheduler.
// Named React imports are captured at module load, so install this transparent
// phase wrapper before importing App rather than spying on the default export.
jest.mock('react',()=>{
 const actual=jest.requireActual('react');let phase='render';
 const track=(effect:()=>any,next:string)=>()=>{const previous=phase;phase=next;try{return effect();}finally{phase=previous;}};
 return {...actual,__effectPhase:()=>phase,useLayoutEffect:(effect:()=>any,deps:any)=>actual.useLayoutEffect(track(effect,'layout'),deps),useEffect:(effect:()=>any,deps:any)=>actual.useEffect(track(effect,'passive'),deps)};
});
import {menuThemes} from '../menu-theme';
jest.mock('react-native-reanimated',()=>({__esModule:true,default:{View:require('react-native').View,createAnimatedComponent:(component:any)=>component},LinearTransition:{duration:(duration:number)=>({reduceMotion:(reduceMotion:string)=>({duration,reduceMotion})})},ReduceMotion:{System:'system'},cancelAnimation:jest.fn(),useSharedValue:(value:any)=>require('react').useRef({value}).current,useAnimatedProps:(fn:any)=>fn(),withSpring:(value:any)=>value,withTiming:(value:any)=>value,Easing:{out:(value:any)=>value,cubic:jest.fn()}}));
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Alert,AppState,DeviceEventEmitter,NativeModules,Platform,StyleSheet,TextInput,Image,Text,Keyboard,Modal,Dimensions,ScrollView,View,BackHandler,Animated,AccessibilityInfo,PanResponder} from 'react-native';
import {TranscriptSeparator} from '../transcript-layout';
import {CompactActivityRow} from '../components/compact-activity-row';
import {ModelContent} from '../components/model-content';
import {ChatBubble} from '../components/chat-bubble';
import {CopyAction} from '../components/message-actions';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {readChatListCache,clearDownloadedCache,updateCachePreferences,DEFAULT_CACHE_PREFERENCES} from '../download-cache';
import * as Keychain from 'react-native-keychain';
import {colors,lightColors} from '../theme';
import {readOutbox} from '../outbox-storage';
import {MessageOutbox} from '../message-outbox';
import {DraftInput} from '../components/draft-input';
import {EdgeFade} from '../components/edge-fade';
import {InlineSurface} from '../components/inline-surface';
import {forgetInlineHeight} from '../inline-visual-policy';
import {BottomTabs,type BottomDestination} from '../components/bottom-tabs';
import {ChatNavigation} from '../components/chat-navigation';
import {SkillPicker} from '../components/skill-picker';
import {SettingsGroup,SectionHeading,SectionActions,SectionBody} from '../components/section-ui';
import {SideDrawer} from '../components/side-drawer';
import {AgentsScreen} from '../components/agents-screen';
import {ToolsScreen} from '../components/tools-screen';
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
jest.mock('@react-native-async-storage/async-storage',()=>{const values=new Map();return{getItem:jest.fn(async(key:string)=>values.get(key)??null),setItem:jest.fn(async(key:string,value:string)=>{values.set(key,value);}),removeItem:jest.fn(async(key:string)=>{values.delete(key);}),getMany:jest.fn(async(keys:string[])=>Object.fromEntries(keys.map(key=>[key,values.get(key)??null]))),setMany:jest.fn(async(items:Record<string,string>)=>{for(const [key,value] of Object.entries(items))values.set(key,value);}),removeMany:jest.fn(async(keys:string[])=>{for(const key of keys)values.delete(key);}),getAllKeys:jest.fn(async()=>Array.from(values.keys())),clear:jest.fn(async()=>values.clear())};});
beforeEach(async()=>{await AsyncStorage.clear();});
afterEach(()=>jest.restoreAllMocks());
// Exercise the actual menu trigger/rows on Chat, and real tabs elsewhere.
// Retained sessions intentionally contain duplicate controls. Existing single-view
// behavior assertions address the selected native host, not an invisible sibling.
function activeRoot(tree:Renderer.ReactTestRenderer){
 return tree.root.findAll(node=>node.type===View&&typeof node.props.testID==='string'&&node.props.testID.startsWith('session-host:')&&node.props.pointerEvents==='auto')[0]??tree.root;
}
function activeMenuRoot(tree:Renderer.ReactTestRenderer){return tree.root.findAll(node=>typeof node.props.testID==='string'&&node.props.testID.startsWith('workspace-notes:')&&node.props.pointerEvents==='auto')[0]??activeRoot(tree);}
function visibleNavigation(tree:Renderer.ReactTestRenderer){return activeMenuRoot(tree).findAllByType(ChatNavigation).find(node=>node.props.showTrigger!==false)!;}
async function navigateTo(tree:Renderer.ReactTestRenderer,destination:BottomDestination){
 if(destination==='Sessions')destination='Agents';
 if(destination==='Chat'&&(!visibleNavigation(tree).props.selected||visibleNavigation(tree).props.selected==='Chat'))return;
 if(!visibleNavigation(tree).props.open)await act(async()=>activeMenuRoot(tree).findByProps({accessibilityLabel:'Menu'}).props.onPress());
 await act(async()=>tree.root.findByProps({testID:'overlay-active'}).findAllByProps({testID:'chat-navigation-sheet'}).at(-1)!.findAll(node=>node.props.accessibilityLabel===(destination==='Agents'?'Agents and Sessions':destination==='Chat'?'Back to chat':destination)&&typeof node.props.onPress==='function')[0].props.onPress());
}
// Synthetic native measurements for all-row presentation fixtures. Keep the
// production virtualization enabled; an unmeasured renderer shows only four.
async function measureTranscriptFixture(list:Renderer.ReactTestInstance){
 await act(async()=>{const viewport=list.findByType(ScrollView);viewport.props.onContentSizeChange(400,2000);viewport.props.onLayout({nativeEvent:{layout:{x:0,y:0,width:400,height:4000}}});viewport.props.onScroll({timeStamp:1,nativeEvent:{contentOffset:{x:0,y:0},contentSize:{width:400,height:2000},layoutMeasurement:{width:400,height:4000}}});});
 for(let pass=0;pass<3;pass++){
  act(()=>{for(const cell of list.findAll(node=>typeof node.props.onCellLayout==='function'))cell.props.onCellLayout({nativeEvent:{layout:{x:0,y:cell.props.index*200,width:400,height:200}}},cell.props.cellKey,cell.props.index);});
  await act(async()=>{await new Promise<void>(resolve=>setTimeout(resolve,70));});
 }
}
test('unpaired app mounts the real screen and history/navigation hooks without a blank screen',async()=>{
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<App/>);});
 const logo=activeRoot(tree).findByProps({accessibilityLabel:'Bob logo'});
 expect(logo.type).toBe(Image);expect(logo.props.source).toEqual(require('../assets/bob-wordmark.png'));
 expect(StyleSheet.flatten(logo.props.style)).toMatchObject({width:'100%',aspectRatio:1});
 act(()=>activeRoot(tree).findByProps({accessibilityLabel:'Paste pairing invitation'}).props.onPress());
 expect(activeRoot(tree).findAllByProps({accessibilityLabel:'Pairing invitation'}).length).toBeGreaterThan(0);
 await act(async()=>tree.unmount());
});

test.each(['light','dark'] as const)('menus follow %s appearance across every root and preserve draft, controls and list',async(scheme)=>{
 const menuTheme=menuThemes[scheme];
 await AsyncStorage.setItem('appearance',scheme);
 jest.replaceProperty(Platform,'OS','android');
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={};delete NativeModules.BobOutbox;
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{const url=String(input),data=url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[{id:1,kind:'bob.user',data:{text:'Keep this history'}}]}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Test'}}]}:url.endsWith('/updates')?{enabled:false}:[];return{ok:true,status:200,json:async()=>data} as Response;});
 const dismissKeyboard=jest.spyOn(Keyboard,'dismiss').mockImplementation(()=>{});
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<App/>);});
 try{
  const draft=activeRoot(tree).findByProps({accessibilityLabel:'Message draft'}),editor=activeRoot(tree).findByType(DraftInput);
  const plus=activeRoot(tree).findByProps({accessibilityLabel:'Chat actions'}),send=activeRoot(tree).findByProps({accessibilityLabel:'Send message'});
  const list=activeRoot(tree).findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0];
  const scroll=jest.spyOn(list.instance,'scrollToOffset').mockImplementation(()=>{});
  act(()=>{draft.props.onFocus();draft.props.onChangeText('Keep my unsent draft');DeviceEventEmitter.emit('BobKeyboardInset',{imeBottom:280});});
  expect(editor.props.compact).toBe(false);expect(activeRoot(tree).findAllByType(BottomTabs)).toHaveLength(0);
  const check=()=>{
   expect(activeRoot(tree).findByProps({accessibilityLabel:'Message draft'})).toBe(draft);expect(draft.props.value).toBe('Keep my unsent draft');
   expect(StyleSheet.flatten(plus.props.style)).toMatchObject({width:48,height:48,borderRadius:24,backgroundColor:'transparent'});
   expect(StyleSheet.flatten(plus.props.style).borderWidth??0).toBe(0);
   expect(activeRoot(tree).findByType(DraftInput)).toBe(editor);expect(activeRoot(tree).findByProps({accessibilityLabel:'Chat actions'})).toBe(plus);expect(activeRoot(tree).findByProps({accessibilityLabel:'Send message'})).toBe(send);
   expect(activeRoot(tree).findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0]).toBe(list);
  };
  // The popup shares the composer's coordinate space, not a resized Modal window.
  act(()=>activeRoot(tree).findByProps({testID:'composer-row'}).props.onLayout({nativeEvent:{layout:{height:50}}}));
  await act(async()=>plus.props.onPress());
  const popup=()=>tree.root.findByProps({testID:'overlay-active'}).findByProps({testID:'plus-menu-popup'});
  expect(StyleSheet.flatten(popup().props.style)).toMatchObject({bottom:348,backgroundColor:menuTheme.colors.background});check();
  act(()=>DeviceEventEmitter.emit('BobKeyboardInset',{imeBottom:0}));
  expect(StyleSheet.flatten(popup().props.style).bottom).toBe(68);check();
  act(()=>activeRoot(tree).findByProps({testID:'composer-row'}).props.onLayout({nativeEvent:{layout:{height:100}}}));
  expect(StyleSheet.flatten(popup().props.style).bottom).toBe(118);check();
  await act(async()=>tree.root.findByProps({testID:'overlay-active'}).findByProps({accessibilityLabel:'Dismiss chat actions'}).props.onPress());
  expect(activeRoot(tree).findAllByProps({testID:'chat-actions-overlay'})).toHaveLength(0);check();
  await act(async()=>activeRoot(tree).findByProps({accessibilityLabel:'Menu'}).props.onPress());
  expect(dismissKeyboard).toHaveBeenCalled();expect(tree.root.findByProps({testID:'overlay-active'}).findAllByProps({testID:'chat-navigation-sheet'}).length).toBeGreaterThan(0);check();
  // Model the native IME hide after opening the menu, then close its visible control.
  act(()=>DeviceEventEmitter.emit('BobKeyboardInset',{imeBottom:0}));
  await act(async()=>tree.root.findByProps({testID:'overlay-active'}).findAll(node=>node.props.accessibilityLabel==='Close navigation menu'&&typeof node.props.onPress==='function')[0].props.onPress());
  expect(visibleNavigation(tree).props.open).toBe(false);check();
  for(const label of ['Close navigation menu','Dismiss navigation menu']){
   await act(async()=>activeRoot(tree).findByProps({accessibilityLabel:'Menu'}).props.onPress());
   await act(async()=>tree.root.findByProps({testID:'overlay-active'}).findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0].props.onPress());
   expect(visibleNavigation(tree).props.open).toBe(false);check();
  }
  for(const destination of ['Notes','Workstations','Agents','Terminal','Tools','Settings'] as const){
   await navigateTo(tree,destination);expect(visibleNavigation(tree).props.open).toBe(false);
   expect(activeRoot(tree).findAllByType(BottomTabs)).toHaveLength(0);
   const header=destination==='Agents'?activeRoot(tree).findByProps({testID:'sessions-heading'}):destination==='Terminal'?activeRoot(tree).findAllByProps({testID:'terminal-header'})[0]:activeMenuRoot(tree).findAllByType(SectionHeading).find(node=>node.props.title===destination)!;
   if(destination!=='Terminal'){
    const id=destination==='Notes'?'notes-screen':destination==='Workstations'?'navigation-panel':destination==='Agents'?'agents-screen':'section-overlay';
    expect(StyleSheet.flatten(activeMenuRoot(tree).findByProps({testID:id}).props.style).backgroundColor).toBe(menuTheme.colors.background);
   }
   expect(header.findAllByType(ChatNavigation)).toHaveLength(0);
   expect(activeMenuRoot(tree).findAllByType(SectionActions).some(footer=>footer.findAllByType(ChatNavigation).includes(visibleNavigation(tree)))).toBe(true);
   expect(activeMenuRoot(tree).findAllByType(ChatNavigation).filter(node=>node.props.showTrigger!==false)).toHaveLength(1);check();
   if(destination==='Notes'||destination==='Settings'){
    const root=activeMenuRoot(tree).findByProps({testID:destination==='Notes'?'notes-screen':'section-overlay'});
    const host=root.findByType(SectionBody),overlay=host.findByProps({testID:'section-footer-overlay'});
    act(()=>overlay.props.onLayout({nativeEvent:{layout:{height:184}}}));
    expect(host.findAllByType(EdgeFade).find(node=>node.props.edge==='bottom')!.props.height).toBe(196);
    expect(StyleSheet.flatten(host.findByProps({testID:'section-footer'}).props.style)).toMatchObject({backgroundColor:'transparent',borderTopWidth:0});
    if(destination==='Notes')expect(StyleSheet.flatten(root.findByType(require('react-native').FlatList).props.contentContainerStyle).paddingBottom).toBe(212);
    if(destination==='Settings')expect(StyleSheet.flatten(root.findByProps({testID:'section-body'}).props.contentContainerStyle).paddingBottom).toBe(220);
   }

   await navigateTo(tree,'Chat');expect(activeRoot(tree).findAllByType(BottomTabs)).toHaveLength(0);check();
  }
  await navigateTo(tree,'Settings');
  expect(activeRoot(tree).findByProps({testID:'section-body'}).findAllByType(SectionHeading)).toHaveLength(0);
  expect(activeRoot(tree).findByProps({testID:'section-overlay'}).findAllByType(SectionHeading).map(node=>node.props.title)).toEqual(['Settings']);
  const settingsFooter=activeRoot(tree).findByProps({testID:'section-overlay'}).findByType(SectionActions);
  act(()=>DeviceEventEmitter.emit('BobKeyboardInset',{imeBottom:280}));
  expect(StyleSheet.flatten(activeRoot(tree).findByProps({testID:'section-overlay'}).props.style).bottom).toBe(280);
  expect(activeRoot(tree).findByProps({testID:'section-overlay'}).findByType(SectionActions)).toBe(settingsFooter);
  act(()=>DeviceEventEmitter.emit('BobKeyboardInset',{imeBottom:0}));
  await act(async()=>activeRoot(tree).findAll(node=>node.props.accessibilityLabel==='Appearance'&&typeof node.props.onPress==='function')[0].props.onPress());
  for(const mode of ['Dark','Light','System'] as const){
   await act(async()=>activeRoot(tree).findAll(node=>node.props.accessibilityLabel===`${mode} theme`&&typeof node.props.onPress==='function')[0].props.onPress());
   expect(await AsyncStorage.getItem('appearance')).toBe(mode.toLowerCase());check();
   const rootBackground=StyleSheet.flatten(activeRoot(tree).findByProps({testID:'rounded-app-surface'}).props.style).backgroundColor;
   const modeColors=mode==='Dark'?colors:mode==='Light'?lightColors:rootBackground===colors.background?colors:lightColors;
   expect(StyleSheet.flatten(activeRoot(tree).findByProps({testID:'section-overlay'}).props.style).backgroundColor).toBe(modeColors.background);
   const selected=activeRoot(tree).findAll(node=>node.props.accessibilityLabel===`${mode} theme`&&typeof node.props.onPress==='function')[0];
   expect(StyleSheet.flatten(selected.props.style)).toMatchObject({borderWidth:1,borderColor:modeColors.selectedBorder});
   expect(activeRoot(tree).findAll(node=>node.props.accessibilityLabel===`${mode} theme`&&node.props.accessibilityRole==='radio')[0].props.accessibilityState.checked).toBe(true);
  }

  await act(async()=>activeRoot(tree).findAll(node=>node.props.accessibilityLabel===`${scheme==='dark'?'Dark':'Light'} theme`&&typeof node.props.onPress==='function')[0].props.onPress());
  expect(StyleSheet.flatten(activeRoot(tree).findByProps({testID:'rounded-app-surface'}).props.style).backgroundColor).toBe(scheme==='dark'?colors.background:lightColors.background);
  await act(async()=>activeRoot(tree).findAll(node=>node.props.accessibilityLabel==='Back to previous menu'&&typeof node.props.onPress==='function')[0].props.onPress());
  for(const page of ['Appearance','Conversation settings','Notifications','Voice','Phone & location','Connection','Storage & cache','App & updates','Advanced']){
   expect(activeRoot(tree).findAllByType(SectionHeading).some(node=>node.props.title==='Settings')).toBe(true);
   await act(async()=>activeRoot(tree).findAll(node=>node.props.accessibilityLabel===page&&typeof node.props.onPress==='function')[0].props.onPress());
   expect(activeRoot(tree).findByProps({testID:'section-overlay'}).findByType(SectionHeading).props.title).toBe(page==='Storage & cache'?'Caching':page);
   const section=activeRoot(tree).findByProps({testID:'section-overlay'});
   expect(StyleSheet.flatten(section.props.style).backgroundColor).toBe(menuTheme.colors.background);
   const title=section.findByType(SectionHeading).findAllByType(Text).find(node=>node.props.accessibilityRole==='header')!;
   expect(StyleSheet.flatten(title.props.style).color).toBe(menuTheme.colors.foreground);
   expect(visibleNavigation(tree).props.selected).toBe('Settings');check();
   await act(async()=>activeRoot(tree).findAll(node=>node.props.accessibilityLabel==='Back to previous menu'&&typeof node.props.onPress==='function')[0].props.onPress());
   expect(activeRoot(tree).findByProps({testID:'section-overlay'}).findByType(SectionHeading).props.title).toBe('Settings');check();
  }

  await navigateTo(tree,'Chat');check();
  await act(async()=>activeRoot(tree).findByProps({accessibilityLabel:'Chat actions'}).props.onPress());
  await act(async()=>tree.root.findByProps({testID:'overlay-active'}).findByProps({accessibilityLabel:'More'}).props.onPress());
  const moreHeading=tree.root.findByProps({testID:'overlay-active'}).findAllByType(SectionHeading).find(node=>node.props.title==='More actions')!;
  expect(moreHeading.props.title).toBe('More actions');
  const more=tree.root.findByProps({testID:'overlay-active'}).findAllByType(SectionBody).find(host=>host.findAllByProps({accessibilityLabel:'Close actions'}).length>0)!,moreScroll=more.findByType(ScrollView);
  act(()=>more.findByProps({testID:'section-footer-overlay'}).props.onLayout({nativeEvent:{layout:{height:168}}}));
  expect(StyleSheet.flatten(moreScroll.props.contentContainerStyle).paddingBottom).toBe(204);
  expect(more.findAllByType(EdgeFade).find(node=>node.props.edge==='bottom')!.props.color).toBeUndefined(); // action sheet uses the default background token
  expect(StyleSheet.flatten(more.findByProps({testID:'section-footer'}).props.style)).toMatchObject({backgroundColor:'transparent',borderTopWidth:0});
  check();
  await act(async()=>tree.root.findByProps({testID:'overlay-active'}).findAll(node=>node.props.accessibilityLabel==='Close actions'&&typeof node.props.onPress==='function')[0].props.onPress());check();
  expect(scroll).not.toHaveBeenCalled();
  expect(StyleSheet.flatten(activeRoot(tree).findByProps({testID:'chat-composer'}).props.style)).toMatchObject({paddingHorizontal:12,paddingBottom:12});
  const row=activeRoot(tree).findByProps({testID:'composer-row'});expect(StyleSheet.flatten(row.props.style)).toMatchObject({flexDirection:'row'});
  expect(row.findByType(DraftInput)).toBe(editor);expect(activeRoot(tree).findByProps({testID:'composer-heading'}).findByType(ChatNavigation)).toBeDefined();
  // Tools loads its groups independently without obscuring navigation.
  const fetchMock=globalThis.fetch as jest.Mock,normalFetch=fetchMock.getMockImplementation()!;
  let releaseModules!:(response:any)=>void;
  fetchMock.mockImplementation((url:any,...args:any[])=>String(url).endsWith('/modules')?new Promise(resolve=>{releaseModules=resolve;}):normalFetch(url,...args));
  await navigateTo(tree,'Tools');
  expect(activeRoot(tree).findByType(ToolsScreen).props.active).toBe(true);
  expect(activeRoot(tree).findAllByProps({testID:'section-loading-overlay'})).toHaveLength(0);
  const moduleHost=activeRoot(tree).findByProps({testID:'section-overlay'}).findByType(SectionBody),moduleScroll=moduleHost.findByProps({testID:'section-body'});
  act(()=>moduleHost.findByProps({testID:'section-footer-overlay'}).props.onLayout({nativeEvent:{layout:{height:176}}}));
  expect(StyleSheet.flatten(moduleScroll.props.contentContainerStyle).paddingBottom).toBe(212);
  expect(moduleHost.findByProps({testID:'section-body'})===moduleScroll).toBe(true);

  expect(activeRoot(tree).findAllByType(SectionHeading).find(node=>node.props.title==='Tools')!.findAllByType(ChatNavigation)).toHaveLength(0);
  expect(activeRoot(tree).findByProps({testID:'section-overlay'}).findByType(SectionActions).findAllByType(ChatNavigation)).toContain(visibleNavigation(tree));
  await navigateTo(tree,'Chat');check();
  await act(async()=>releaseModules({ok:true,json:async()=>[]}));
  // Chat no longer reserves a (hidden) tab bar in slash-picker geometry.
  const measuredHeight=Dimensions.get('window').height-116;
  await act(async()=>{activeRoot(tree).findByProps({testID:'chat-composer'}).props.onLayout({nativeEvent:{layout:{height:measuredHeight}}});draft.props.onFocus();draft.props.onChangeText('/mini');});
  expect(activeRoot(tree).findByType(SkillPicker).props.maxHeight).toBe(100);
  expect(activeRoot(tree).findByType(SkillPicker).props.bottom).toBe(measuredHeight+6);
  await act(async()=>activeRoot(tree).findByProps({accessibilityLabel:'Menu'}).props.onPress());
  expect(activeRoot(tree).findAllByType(SkillPicker)).toHaveLength(0);
 }finally{await act(async()=>tree.unmount());}
 // This is a full multi-route interaction sweep, not a frame-time benchmark.
 // Allow headroom while the Android VM/native build share the test machine.
},20000);

test('actual App Tools reopen keeps catalog visible while revalidation is held and preserves draft',async()=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={};delete NativeModules.BobOutbox;
 const module={id:'coding',name:'Coding',packageName:'@bob-local/coding',version:'0.1.0',durable:'1.0.0',dependencies:{},requires:[],available:true,installed:true,registered:true,defaultSelected:true,selected:true};
 let hold=false,release:((value:any)=>void)|undefined;
 const fetcher=jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{const url=String(input);if(url.endsWith('/modules')&&hold)return new Promise(resolve=>{release=resolve;});const data=url.endsWith('/modules')?[module]:url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[]}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Test'}}]}:url.endsWith('/updates')?{enabled:false}:[];return {ok:true,status:200,json:async()=>data} as Response;});
 let tree!:Renderer.ReactTestRenderer;
 try{
  await act(async()=>{tree=Renderer.create(<App/>);});
  const draft=activeRoot(tree).findByProps({accessibilityLabel:'Message draft'});act(()=>draft.props.onChangeText('Keep Tools draft'));
  await navigateTo(tree,'Tools');expect(activeRoot(tree).findAllByProps({accessibilityLabel:'Details for Coding'}).length).toBeGreaterThan(0);
  await navigateTo(tree,'Chat');hold=true;await navigateTo(tree,'Tools');
  const tools=activeRoot(tree).findByType(ToolsScreen);expect(tools.findAllByProps({accessibilityLabel:'Details for Coding'}).length).toBeGreaterThan(0);
  expect(tools.findAllByType(Text).some(node=>React.Children.toArray(node.props.children).includes('Last loaded modules · '))).toBe(true);
  await navigateTo(tree,'Chat');expect(activeRoot(tree).findByProps({accessibilityLabel:'Message draft'})).toBe(draft);expect(draft.props.value).toBe('Keep Tools draft');
  expect(fetcher.mock.calls.filter(([,init])=>init?.method==='PUT')).toHaveLength(0);
 }finally{if(release)await act(async()=>release!({ok:true,status:200,json:async()=>[module]}));if(tree)await act(async()=>tree.unmount());}
});

test.each(['no conversation','opening','offline'])('Chat menu stays available with %s and closes for notification targets',async(mode)=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:mode==='no conversation'?undefined:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={};delete NativeModules.BobOutbox;
 const get=(AsyncStorage.getItem as jest.Mock).getMockImplementation()!;let release:((value:string)=>void)|undefined;
 if(mode==='opening')(AsyncStorage.getItem as jest.Mock).mockImplementation((key:string)=>key===`draft:${backend.backendId}:7`?new Promise(resolve=>{release=resolve;}):get(key));
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{if(mode==='offline')throw Error('offline');const url=String(input),data=url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[]}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Test'}}]}:url.endsWith('/updates')?{enabled:false}:[];return{ok:true,status:200,json:async()=>data} as Response;});
 let tree!:Renderer.ReactTestRenderer;
 try{
  await act(async()=>{tree=Renderer.create(<App/>);});
  if(mode!=='offline')expect(activeRoot(tree).findByProps({accessibilityLabel:'Message draft'}).props.editable).toBe(false);
  await act(async()=>activeRoot(tree).findByProps({accessibilityLabel:'Menu'}).props.onPress());expect(visibleNavigation(tree).props.open).toBe(true);
  await navigateTo(tree,'Agents');expect(activeRoot(tree).findByType(AgentsScreen).props.visible).toBe(true);
  await navigateTo(tree,'Chat');await act(async()=>activeRoot(tree).findByProps({accessibilityLabel:'Menu'}).props.onPress());
  (NativeModules.BobPlatform.takeNotificationTarget as jest.Mock).mockResolvedValue({backendId:backend.backendId,conversationId:8});
  await act(async()=>DeviceEventEmitter.emit('BobNotificationOpen'));
  expect(visibleNavigation(tree).props.open).toBe(false);
  await act(async()=>activeRoot(tree).findByProps({accessibilityLabel:'Menu'}).props.onPress());
  (NativeModules.BobPlatform.takeNotificationTarget as jest.Mock).mockResolvedValue({backendId:backend.backendId,screen:'updates'});
  await act(async()=>DeviceEventEmitter.emit('BobNotificationOpen'));
  expect(visibleNavigation(tree).props.open).toBe(false);
 }finally{(AsyncStorage.getItem as jest.Mock).mockImplementation(get);if(release)await act(async()=>release!(''));if(tree)await act(async()=>tree.unmount());}
});

test.each([true,false])('menus and background/foreground preserve the native list and viewport (reading earlier: %s)',async(readingEarlier)=>{
 // This original 48dp compact fixture is 1×; large-font layout has separate coverage.
 const dimensions=require('react-native').useWindowDimensions;
 jest.spyOn(require('react-native'),'useWindowDimensions').mockImplementation(()=>({...dimensions(),fontScale:1}));
 const ime=new Set<(event:any)=>void>();jest.replaceProperty(Platform,'OS','android');
 const add=DeviceEventEmitter.addListener.bind(DeviceEventEmitter);jest.spyOn(DeviceEventEmitter,'addListener').mockImplementation((event,callback)=>{if(event!=='BobKeyboardInset')return add(event,callback);ime.add(callback);return{remove:()=>{ime.delete(callback);}};});
 const lifecycle=new Set<(state:any)=>void>(),current=jest.replaceProperty(AppState,'currentState','active');
 jest.spyOn(AppState,'addEventListener').mockImplementation((event,callback)=>{if(event==='change')lifecycle.add(callback as any);return{remove:()=>{lifecycle.delete(callback as any);}};});
 const transition=(state:'active'|'background')=>{current.replaceValue(state);for(const callback of lifecycle)callback(state);};
 const surface={id:'a841d08a-8b83-42cd-b8a7-2d61f2db7ae9',conversationId:7,title:'Solar system',kind:'visual',presentation:'inline',allowedTools:[]};
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={versionCode:35,versionName:'test'};NativeModules.BobInteractive={prepare:jest.fn(async()=> 'prepared-visual'),releasePrepared:jest.fn()};
 let conversationConfiguration:{instructions:string|null;cwd:string}={instructions:null,cwd:'/workspace'};
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any,options?:any)=>{
  const url=String(input);if(url.endsWith('/configure')&&options?.method==='PUT')conversationConfiguration={...conversationConfiguration,...JSON.parse(options.body)};const data=url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[{id:1,kind:'pi.assistant',model:[{role:'assistant',content:[{type:'toolCall',id:'visual-call',name:'render_visual',arguments:{title:'Solar system',html:'<p>Solar system</p>'}}]}]},{id:2,kind:'pi.tool-result',model:[{role:'toolResult',toolCallId:'visual-call',toolName:'render_visual',content:[{type:'text',text:`Isolated visual ${surface.id}: Solar system. Open from the conversation’s interactive surfaces.`}]}]},{id:3,kind:'pi.assistant',model:[{role:'assistant',content:[{type:'text',text:'This is a newer reply, after the illustration.'}]}]}]}:url.endsWith('/ui')?[surface]:url.endsWith('/updates')?{enabled:false}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Test chat'}}]}:url.endsWith('/peers')?{inbound:[],outbound:[]}:url.endsWith('/library')?{instructions:'',templates:{},skills:{'minimal-skill-authoring':{description:'Author minimal skills',enabled:true},bro:{description:'Simplify the last answer',enabled:true}},commands:[{name:'delegation',description:'Choose models or profiles for subagents.'}]}:url.endsWith('/models')?[]:url.endsWith('/configure')?conversationConfiguration:[];
  return {ok:true,status:200,json:async()=>data} as Response;
 });
 const heightScope={backendId:backend.backendId,conversationId:7,id:surface.id};
 forgetInlineHeight(heightScope);
 let tree!:Renderer.ReactTestRenderer;
 try{
 await act(async()=>{tree=Renderer.create(<App/>);});
 const draft=activeRoot(tree).findByProps({accessibilityLabel:'Message draft'});expect(activeRoot(tree).findByType(DraftInput).props.compact).toBe(true);expect(StyleSheet.flatten(draft.props.style).height).toBe(48);
 act(()=>{draft.props.onChangeText('A retained draft while toggling the keyboard.');for(const callback of ime)callback({imeBottom:280});});expect(activeRoot(tree).findByType(DraftInput).props.compact).toBe(false);expect(activeRoot(tree).findAllByType(BottomTabs)).toHaveLength(0);expect(activeRoot(tree).findByProps({accessibilityLabel:'Message draft'})).toBe(draft);
 act(()=>draft.props.onContentSizeChange({nativeEvent:{contentSize:{height:126}}}));expect(StyleSheet.flatten(draft.props.style).height).toBe(126);
 act(()=>{for(const callback of ime)callback({imeBottom:0});});expect(activeRoot(tree).findByType(DraftInput).props.compact).toBe(true);expect(StyleSheet.flatten(draft.props.style).height).toBe(48);expect(draft.props.value).toContain('retained draft');expect(activeRoot(tree).findAllByType(BottomTabs)).toHaveLength(0);expect(activeRoot(tree).findByProps({accessibilityLabel:'Menu'})).toBeDefined();
 // Slash suggestions are fetched through the active backend; selection only edits the draft.
 await act(async()=>{draft.props.onFocus();draft.props.onChangeText('/mini');});
 expect(activeRoot(tree).findByProps({testID:'skill-picker'})).toBeDefined();
 act(()=>activeRoot(tree).findByProps({accessibilityLabel:'Use skill minimal-skill-authoring'}).props.onPress());
 expect(draft.props.value).toBe('Use the skill "minimal-skill-authoring". ');
 expect(activeRoot(tree).findAllByProps({testID:'skill-picker'})).toHaveLength(0);
 await act(async()=>draft.props.onChangeText('/bro'));
 act(()=>activeRoot(tree).findByProps({accessibilityLabel:'Use skill bro'}).props.onPress());
 expect(draft.props.value).toBe('Use the skill "bro". ');
 await act(async()=>draft.props.onChangeText('/dele'));
 act(()=>activeRoot(tree).findByProps({accessibilityLabel:'Insert command delegation'}).props.onPress());
 expect(draft.props.value).toBe('/delegation ');
 expect(activeRoot(tree).findAllByProps({testID:'skill-picker'})).toHaveLength(0);
 expect(activeRoot(tree).findByProps({accessibilityLabel:'Message draft'})).toBe(draft);
 expect((globalThis.fetch as jest.Mock).mock.calls.some(([url])=>String(url).endsWith('/messages'))).toBe(false);
 const composer=activeRoot(tree).findByProps({testID:'chat-composer'});expect(StyleSheet.flatten(composer.props.style).backgroundColor).toBe('transparent');expect(composer.findAllByType(EdgeFade)).toHaveLength(0);
 const controls=composer.findByProps({testID:'composer-controls'});expect(controls.findAllByType(TextInput)).toHaveLength(0);expect(controls.findByProps({accessibilityLabel:'Chat actions'})).toBeDefined();expect(controls.findByProps({accessibilityLabel:'Send message'})).toBeDefined();
 expect(StyleSheet.flatten(controls.findByProps({accessibilityLabel:'Send message'}).props.style).backgroundColor).toBe('transparent');
 expect(controls.findByProps({accessibilityLabel:'Send message'}).props.variant).toBe('ghost');
 expect(activeRoot(tree).findAllByProps({testID:'chat-header'})).toHaveLength(0);
 expect(activeRoot(tree).findAllByProps({accessibilityLabel:'Select workstation'})).toHaveLength(0);
 expect(activeRoot(tree).findAllByType(BottomTabs)).toHaveLength(0);expect(activeRoot(tree).findByProps({accessibilityLabel:'Menu'})).toBeDefined();
 const list=activeRoot(tree).findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0];expect(list).toBeDefined();
 expect(list.props.inverted).toBe(true);expect(list.props.initialScrollIndex).toBe(0);expect(list.props.data.filter((entry:any)=>!entry.inlineSurfaceId).map((entry:any)=>entry.id)).toEqual([3,1]);expect(list.props.data[1].inlineSurfaceSource).toBe(1);
 const latest=jest.spyOn(list.instance,'scrollToOffset').mockImplementation(()=>{});
 const scroll=jest.spyOn(list.instance,'scrollToEnd').mockImplementation(()=>{}),nativeEnd=jest.fn();jest.spyOn(list.instance,'getScrollResponder').mockReturnValue({scrollToEnd:nativeEnd});
 act(()=>{list.props.onLayout({nativeEvent:{layout:{height:600}}});list.props.onContentSizeChange(300,2000);});
 const inlineSurface=activeRoot(tree).findByType(InlineSurface);
 expect(activeRoot(tree).findByProps({testID:'history-entry-3'}).findAllByType(InlineSurface)).toHaveLength(0);
 expect(activeRoot(tree).findAllByType(InlineSurface)).toHaveLength(1);
 expect(NativeModules.BobInteractive.prepare).toHaveBeenCalledTimes(1);
 expect(activeRoot(tree).findByProps({testID:'inline-surface-container'})).toBeDefined();
 expect(activeRoot(tree).findByProps({testID:'bob-inline-native-surface'}).props.style).toEqual({height:420,width:'100%'});
 // A different surface's fallback must not collapse this row. Keep this native
 // child mounted throughout the menu/background lifecycle below.
 const nativeSurface=activeRoot(tree).findByProps({testID:'bob-inline-native-surface'});
 act(()=>DeviceEventEmitter.emit('BobSurfaceOverflow',{backendId:backend.backendId,conversationId:7,id:'another-surface'}));
 expect(activeRoot(tree).findByProps({testID:'bob-inline-native-surface'})).toBe(nativeSurface);
 const size=(height:number,session='prepared-visual')=>DeviceEventEmitter.emit('BobSurfaceLayout',{backendId:backend.backendId,conversationId:7,id:surface.id,session,height});
 act(()=>size(220));expect(nativeSurface.props.style.height).toBe(220);
 act(()=>{size(320);size(8193);size(0);size(160,'expired-mount');});expect(nativeSurface.props.style.height).toBe(320);
 act(()=>size(180));expect(nativeSurface.props.style.height).toBe(180);
 expect(NativeModules.BobInteractive.prepare).toHaveBeenCalledTimes(1);
 expect(inlineSurface.props.surface.presentation).toBe('inline');
 const event={nativeEvent:{contentOffset:{y:500},contentSize:{height:2000},layoutMeasurement:{height:600}}};
 await act(async()=>{await new Promise<void>(resolve=>setTimeout(resolve,35));});scroll.mockClear();nativeEnd.mockClear();latest.mockClear();
 if(!readingEarlier)act(()=>list.props.onScroll({nativeEvent:{contentOffset:{y:0},contentSize:{height:2000},layoutMeasurement:{height:600}}}));
 if(readingEarlier){act(()=>{list.props.onScrollBeginDrag();list.props.onScroll(event);list.props.onMomentumScrollEnd(event);});expect(activeRoot(tree).findByProps({accessibilityLabel:'Scroll to latest message'})).toBeDefined();}
 for(const section of ['Notes','Settings'] as const){
  await navigateTo(tree,'Sessions');
  const configurationReadsBefore=(globalThis.fetch as jest.Mock).mock.calls.filter(([url,options])=>String(url).endsWith('/configure')&&options?.method==='GET').length;
  await navigateTo(tree,section);
  expect(activeMenuRoot(tree).findByProps({testID:section==='Notes'?'notes-screen':'section-overlay'})).toBeDefined();expect(activeRoot(tree).findByProps({testID:'chat-viewport'}).props.pointerEvents).toBe('none');
  expect(activeRoot(tree).findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0]).toBe(list);
  expect(activeRoot(tree).findAllByProps({accessibilityLabel:'Back to chat'})).toHaveLength(0);
  if(section==='Settings'){
   expect((globalThis.fetch as jest.Mock).mock.calls.filter(([url,options])=>String(url).endsWith('/configure')&&options?.method==='GET')).toHaveLength(configurationReadsBefore);
   expect(activeRoot(tree).findAllByProps({testID:'section-loading-overlay'})).toHaveLength(0);
   expect(activeRoot(tree).findAllByProps({testID:'conversation-settings-loading'})).toHaveLength(0);
   expect(activeRoot(tree).findAllByType(SettingsGroup).map(group=>group.props.title)).toEqual(['Preferences','Conversation & tools','Knowledge','App & workstation']);
   expect(activeRoot(tree).findAllByProps({accessibilityLabel:'Conversation instructions'})).toHaveLength(0);
   expect(activeRoot(tree).findByProps({testID:'section-overlay'}).findAllByProps({accessibilityLabel:'Model & thinking'})).toHaveLength(0);
   const press=(label:string)=>activeRoot(tree).findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0].props.onPress();
   const fetchMock=globalThis.fetch as jest.Mock,normalFetch=fetchMock.getMockImplementation()!;
   let releaseConfiguration!:()=>void;
   const delayedConfiguration=new Promise<void>(resolve=>{releaseConfiguration=resolve;});
   fetchMock.mockImplementation(async(url:any,options:any)=>{if(String(url).endsWith('/configure')&&options?.method==='GET')await delayedConfiguration;return normalFetch(url,options);});
   await act(async()=>press('Conversation settings'));
   expect(activeRoot(tree).findAllByProps({testID:'conversation-settings-loading'}).length).toBeGreaterThan(0);
   expect(activeRoot(tree).findAllByProps({testID:'section-loading-overlay'})).toHaveLength(0);
   expect(activeRoot(tree).findAllByProps({accessibilityLabel:'Conversation instructions'})).toHaveLength(0);
   await act(async()=>press('Back to previous menu'));
   await act(async()=>press('Notifications'));
   const notifications=activeRoot(tree).findAll(node=>String(node.props.accessibilityLabel).startsWith('Last reply notifications:')&&typeof node.props.onPress==='function')[0];
   expect(notifications.props.disabled).toBe(false);
   act(()=>press('About notifications'));
   expect(activeRoot(tree).findAll(node=>typeof node.props.children==='string'&&node.props.children.includes('Replies, questions and schedule alerts')).length).toBeGreaterThan(0);
   const pendingCalls=fetchMock.mock.calls.filter(([url])=>String(url).endsWith('/configure')).length;
   await navigateTo(tree,'Settings');
   expect(fetchMock.mock.calls.filter(([url])=>String(url).endsWith('/configure'))).toHaveLength(pendingCalls);
   await act(async()=>releaseConfiguration());fetchMock.mockImplementation(normalFetch);
   expect(activeRoot(tree).findAllByProps({testID:'conversation-settings-loading'})).toHaveLength(0);
   await act(async()=>press('Conversation settings'));
   act(()=>activeRoot(tree).findByProps({accessibilityLabel:'Conversation instructions'}).props.onChangeText('Concise replies'));
   await act(async()=>press('Save conversation override'));
   expect((globalThis.fetch as jest.Mock).mock.calls.some(([url,options])=>String(url).includes('/chats/7/configure')&&options?.method==='PUT'&&JSON.parse(options.body).instructions==='Concise replies')).toBe(true);
   expect(conversationConfiguration.instructions).toBe('Concise replies');
   expect(activeRoot(tree).findAll(node=>node.props.children==='Instructions saved.').length).toBeGreaterThan(0);
   // Leaving the settings subtree must not overwrite unsaved fields on reload.
   act(()=>activeRoot(tree).findByProps({accessibilityLabel:'Conversation instructions'}).props.onChangeText('Retain unsaved instructions'));
   act(()=>activeRoot(tree).findByProps({accessibilityLabel:'Backend working directory'}).props.onChangeText('/retained-draft'));
   await navigateTo(tree,'Chat');
   await navigateTo(tree,'Settings');
   await act(async()=>press('Conversation settings'));
   expect(activeRoot(tree).findByProps({accessibilityLabel:'Conversation instructions'}).props.value).toBe('Retain unsaved instructions');
   expect(activeRoot(tree).findByProps({accessibilityLabel:'Backend working directory'}).props.value).toBe('/retained-draft');
   await act(async()=>press('Save conversation override'));
   expect(conversationConfiguration.instructions).toBe('Retain unsaved instructions');
   expect(activeRoot(tree).findByProps({accessibilityLabel:'Backend working directory'}).props.value).toBe('/retained-draft');
   await act(async()=>press('Back to previous menu'));
   expect(activeRoot(tree).findAllByProps({accessibilityLabel:'Conversation instructions'})).toHaveLength(0);
  }
  await navigateTo(tree,'Chat');
  expect(activeRoot(tree).findByProps({testID:'chat-viewport'}).props.pointerEvents).toBe('auto');expect(activeRoot(tree).findAllByProps({testID:'section-overlay'})).toHaveLength(0);
  expect(activeRoot(tree).findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0]).toBe(list);
 }
 // The schedules overlay must also retain the same native chat list and scroll state.
 await navigateTo(tree,'Sessions');
 await act(async()=>activeRoot(tree).findByType(AgentsScreen).props.onSchedules());
 expect(activeRoot(tree).findByProps({testID:'schedules-screen'})).toBeDefined();
 await act(async()=>activeRoot(tree).findAll(node=>node.props.accessibilityLabel==='Back to previous menu'&&typeof node.props.onPress==='function')[0].props.onPress());
 expect(activeRoot(tree).findByType(AgentsScreen).props.visible).toBe(true);
 await act(async()=>activeRoot(tree).findByType(AgentsScreen).props.onSchedules());
 expect(activeRoot(tree).findByProps({testID:'schedules-screen'})).toBeDefined();
 expect(activeRoot(tree).findByProps({testID:'chat-viewport'}).props.pointerEvents).toBe('none');
 expect(activeRoot(tree).findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0]).toBe(list);
 await navigateTo(tree,'Chat');
 // Machine browsing is a distinct destination and selecting the current machine opens its sessions.
 await navigateTo(tree,'Workstations');
 expect(activeRoot(tree).findByType(SideDrawer).props.mode).toBe('workstations');
 await act(async()=>activeRoot(tree).findByType(SideDrawer).props.workspaces[0].onPress());
 expect(activeRoot(tree).findByProps({testID:'agents-screen'})).toBeDefined();
 await navigateTo(tree,'Chat');
 expect(activeRoot(tree).findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0]).toBe(list);
 expect(draft.props.value).toBe('/delegation ');
 expect(StyleSheet.flatten(activeRoot(tree).findByProps({testID:'rounded-app-surface'}).props.style)).toMatchObject({overflow:'hidden'});
 const historyCalls=()=> (globalThis.fetch as jest.Mock).mock.calls.filter(([url])=>String(url).includes('/history')).length;
 const before=historyCalls();
 for(let cycle=0;cycle<2;cycle++){
  act(()=>{transition('background');list.props.onLayout({nativeEvent:{layout:{height:0}}});list.props.onContentSizeChange(300,0);list.props.onScroll({...event,nativeEvent:{...event.nativeEvent,contentOffset:{y:0}}});});
  await act(async()=>{transition('active');list.props.onLayout({nativeEvent:{layout:{height:600}}});list.props.onContentSizeChange(300,2000);await new Promise<void>(resolve=>setTimeout(resolve,35));});
  expect(activeRoot(tree).findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0]).toBe(list);
 }
 expect(historyCalls()).toBeGreaterThan(before);expect(latest).not.toHaveBeenCalled();expect(nativeEnd).not.toHaveBeenCalled();expect(scroll).not.toHaveBeenCalled();expect(NativeModules.BobInteractive.prepare).toHaveBeenCalledTimes(1);
 expect(activeRoot(tree).findByProps({testID:'bob-inline-native-surface'})).toBe(nativeSurface);
 expect(activeRoot(tree).findByType(InlineSurface)).toBe(inlineSurface);
 // A genuine native promotion removes the inline child, retaining exactly one
 // title/expand action on its original producing history entry.
 act(()=>DeviceEventEmitter.emit('BobSurfaceOverflow',{backendId:backend.backendId,conversationId:7,id:surface.id,session:'prepared-visual'}));
 expect(activeRoot(tree).findAllByProps({testID:'bob-inline-native-surface'})).toHaveLength(0);
 expect(activeRoot(tree).findByType(InlineSurface).findByProps({accessibilityLabel:'Expand visual: Solar system'})).toBeDefined();
 expect(NativeModules.BobInteractive.releasePrepared).toHaveBeenCalledWith('prepared-visual');
 if(readingEarlier)expect(activeRoot(tree).findByProps({accessibilityLabel:'Scroll to latest message'})).toBeDefined();
 }finally{if(tree)await act(async()=>tree.unmount());forgetInlineHeight(heightScope);}
});

test('cold launch, session switches, and reopening from cache start with the newest row already at index zero',async()=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 const sessions=[{id:7,meta:{title:'First session'}},{id:8,meta:{title:'Second session'}}];
 const pages=new Map([7,8].map(id=>[id,{backendId:backend.backendId,conversationId:id,coverage:'stored-entries',items:Array.from({length:150},(_,i)=>({id:id*1000+i+1,kind:'bob.user',data:{text:`Session ${id}, message ${i+1}. `+'Variable-height text. '.repeat(i%11===0?120:1)}}))}]));
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'test-token'});jest.replaceProperty(AppState,'currentState','active');
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={versionCode:38,versionName:'test'};
 let finishSecond:((response:Response)=>void)|undefined,finishCached:((response:Response)=>void)|undefined,holdCached=false;
 const response=(data:unknown)=>({ok:true,status:200,json:async()=>data}) as Response;
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{
  const url=String(input),match=/\/chats\/(7|8)\/history/.exec(url);
  if(match){const id=Number(match[1]);if(id===8&&!finishSecond)return new Promise<Response>(resolve=>{finishSecond=resolve;});if(id===7&&holdCached)return new Promise<Response>(resolve=>{finishCached=resolve;});return response(pages.get(id));}
  return response(url.endsWith('/chats')?{items:sessions}:url.endsWith('/updates')?{enabled:false}:url.endsWith('/peers')?{inbound:[],outbound:[]}:[]);
 });
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<App/>);});
 const findList=()=>activeRoot(tree).findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0];
 const check=(id:number)=>{const list=findList();expect(list.props.inverted).toBe(true);expect(list.props.initialScrollIndex).toBe(0);expect(list.props.data[0].id).toBe(id*1000+150);expect(list.props.data.at(-1).id).toBe(id*1000+1);return list;};
 const first=check(7);expect(activeRoot(tree).findAllByProps({testID:'history-entry-7150'}).length).toBeGreaterThan(0);
 const userBubble=activeRoot(tree).findByProps({testID:'history-entry-7150'}).findAll(node=>{const style=StyleSheet.flatten(node.props.style);return [colors.ownerBubble,lightColors.ownerBubble].includes(style?.backgroundColor)&&style?.borderRadius===20;})[0];const padding=StyleSheet.flatten(userBubble.props.style);expect(padding.paddingVertical).toBe(12);expect(padding.paddingHorizontal).toBe(16);
 const sent=activeRoot(tree).findByProps({testID:'history-entry-7150'}).find(node=>node.props.selectable===true&&typeof node.props.children==='string');expect(StyleSheet.flatten(sent.props.style)).toMatchObject({fontSize:15,lineHeight:25});
expect(activeRoot(tree).findAllByProps({testID:'history-entry-7001'})).toHaveLength(0);
 await navigateTo(tree,'Sessions');await act(async()=>activeRoot(tree).findByType(AgentsScreen).props.onOpenSession(8));
 const waiting=findList();expect(waiting).not.toBe(first);expect(waiting.props.inverted).toBe(true);expect(waiting.props.data).toHaveLength(0);expect(finishSecond).toBeDefined();
 await act(async()=>finishSecond!(response(pages.get(8))));check(8);
 await navigateTo(tree,'Sessions');await act(async()=>activeRoot(tree).findByType(AgentsScreen).props.onOpenSession(7));check(7);
 await act(async()=>tree.unmount());holdCached=true;await act(async()=>{tree=Renderer.create(<App/>);});
 check(7);expect(finishCached).toBeDefined();expect(findList().props.data).toHaveLength(150);
 await act(async()=>finishCached!(response(pages.get(7))));check(7);await act(async()=>tree.unmount());
});

test.each([[true,false,false],[false,false,false],[true,true,false],[false,false,true]])('send renders immediately, queues offline and reconciles without duplicate rows (receipt exists: %s, question answer: %s, Bob working: %s)',async(receiptExists,choiceAnswer,bobWorking)=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'test-token'});
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
 if(bobWorking){await act(async()=>snapshot?.({data:JSON.stringify({backendId:backend.backendId,conversationId:7,view:{entries:[],docs:{'pi.live':{run:{taskId:99,inputs:[]}}}}})}));expect(activeRoot(tree).findByProps({accessibilityLabel:'Stop Bob'})).toBeDefined();}
 if(choiceAnswer)await act(async()=>snapshot?.({data:JSON.stringify({backendId:backend.backendId,conversationId:7,view:{entries:[],docs:{'bob.questions':{pending:{id:'question-fixture',text:'Pick your reply',options:['Instant message','Something else']}}}}})}));
 act(()=>activeRoot(tree).findByProps({accessibilityLabel:'Message draft'}).props.onChangeText(choiceAnswer?'Keep this draft':'Instant message'));
 let release!:()=>void;
 const setItem=(AsyncStorage.setItem as jest.Mock).getMockImplementation()!;
 jest.spyOn(AsyncStorage,'setItem').mockImplementation((key,value)=>key==='message-outbox:v2'?new Promise<void>(resolve=>{release=()=>{void setItem(key,value).then(resolve);};}):setItem(key,value));
 if(choiceAnswer){
  act(()=>activeRoot(tree).findByProps({accessibilityLabel:'Instant message'}).props.onPress());
  act(()=>activeRoot(tree).findByProps({accessibilityLabel:'Send selected answer'}).props.onPress());
 }else act(()=>activeRoot(tree).findByProps({accessibilityLabel:'Send message'}).props.onPress());
 const list=()=>activeRoot(tree).findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0];
 expect(list().props.data).toHaveLength(1);
 expect(list().props.data[0].data.text).toBe('Instant message');
 const localKey=list().props.keyExtractor(list().props.data[0]);
 expect(activeRoot(tree).findByProps({accessibilityLabel:'Message draft'}).props.value).toBe(choiceAnswer?'Keep this draft':'');
 if(choiceAnswer)expect(activeRoot(tree).findAllByProps({testID:'question-card'})).toHaveLength(0);
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
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'test-token'});
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
  act(()=>activeRoot(tree).findByProps({accessibilityLabel:'Message draft'}).props.onChangeText('This cannot be sent'));
  await act(async()=>activeRoot(tree).findByProps({accessibilityLabel:'Send message'}).props.onPress());
  const list=()=>activeRoot(tree).findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0];
  const local=list().props.data[0].id;
  expect(list().props.data.map((value:any)=>value.id)).toEqual([local,10]);
  const labels=activeRoot(tree).findAll(node=>node.type===require('react-native').Text&&node.props.children==='Not sent');
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
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={};
 const report='[subagent Audit helper answered, no reply needed] Fixture report.';
 const entries=[{id:1,kind:'bob.user',data:{text:report}},{id:2,kind:'pi.user',model:[{role:'user',content:report}]},{id:3,kind:'bob.subagent-report',data:{name:'Audit helper',conversationId:8},model:[{role:'user',content:report}]}];
 const EventSource=require('react-native-sse');const snapshots=new Map<string,(value:any)=>void>();const closes=new Map<string,jest.Mock>();
 EventSource.mockImplementation((url:string)=>{const close=jest.fn();closes.set(url,close);return{addEventListener:jest.fn((event,callback)=>{if(event==='snapshot')snapshots.set(url,callback);}),close};});
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{
  const url=String(input);return {ok:true,status:200,json:async()=>url.includes('/agent-overview')?{backendId:backend.backendId,sessions:[{conversationId:7,title:'Test chat',status:'working',agents:[{name:'Audit helper',conversationId:8,status:'working'},{name:'Second helper',conversationId:9,status:'idle'}]}]}:url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:entries}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Test chat'}}]}:url.endsWith('/updates')?{enabled:false}:url.endsWith('/peers')?{inbound:[],outbound:[]}:[]} as Response;
 });
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<App/>);});
 try{
 const publish=async(status:string)=>act(async()=>{snapshots.get(`${backend.endpoint}/v1/chats/7/events?heartbeats=1&patches=1`)!({data:JSON.stringify({backendId:backend.backendId,conversationId:7,view:{entries,docs:{'app.subagents':{agents:{'Audit helper':{conversationId:8,status},'Second helper':{conversationId:9,status:'idle'}}}},work:[]}})});});
 await publish('working');expect(activeRoot(tree).findAllByProps({accessibilityLabel:'Toggle subagents, 1 active agents'})).toHaveLength(0);
 expect(activeRoot(tree).findByProps({testID:'chat-menu-agent-badge'})).toBeDefined();
 expect(activeRoot(tree).findByProps({accessibilityLabel:'Menu'}).props.accessibilityValue.text).toBe('1 active agent');
 await publish('stopping');expect(activeRoot(tree).findByProps({testID:'chat-menu-agent-badge'})).toBeDefined();
 await publish('working');
 const unknown=activeRoot(tree).findByProps({testID:'history-entry-2'}),projected=activeRoot(tree).findByProps({testID:'history-entry-3'});
 expect(unknown.findByProps({accessibilityLabel:'Input · source not identified'}).props.accessibilityState.expanded).toBe(false);
 const reportHeader=projected.findAll(node=>node.props.accessibilityLabel==='Agent report · Audit helper'&&node.props.accessibilityRole==='button'&&!!node.props.style)[0];
 expect(reportHeader.props.accessibilityState.expanded).toBe(false);
 expect(projected.findByType(CompactActivityRow).props).toMatchObject({title:'Agent report',detail:'Audit helper',status:'received'});
 expect(StyleSheet.flatten(reportHeader.props.style)).toMatchObject({minHeight:48,paddingVertical:6});
 expect(StyleSheet.flatten(reportHeader.props.style).backgroundColor).toBeUndefined();
 expect(projected.findAllByType(ModelContent)).toHaveLength(0);
 expect(projected.findAllByType(CopyAction)).toHaveLength(0);
 const reportDraft=activeRoot(tree).findByProps({accessibilityLabel:'Message draft'}),reportList=activeRoot(tree).findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0];
 act(()=>reportDraft.props.onChangeText('Draft survives report expansion'));
 act(()=>reportHeader.props.onPress());
 expect(reportHeader.props.accessibilityState.expanded).toBe(true);
 expect(reportHeader.props.accessibilityHint).toContain('Collapse');
 expect(projected.findByType(ModelContent).props).toMatchObject({value:report,speakable:false});
 expect(projected.findByType(CopyAction).props.text).toBe(report);
 const copyText=jest.fn(async()=>{});NativeModules.BobPlatform.copyText=copyText;
 await act(async()=>projected.findAll(node=>node.props.accessibilityLabel==='Copy reply'&&typeof node.props.onPress==='function')[0].props.onPress());
 expect(copyText).toHaveBeenCalledWith(report);
 expect(activeRoot(tree).findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0]).toBe(reportList);
 expect(activeRoot(tree).findByProps({accessibilityLabel:'Message draft'})).toBe(reportDraft);
 expect(reportDraft.props.value).toBe('Draft survives report expansion');
 act(()=>reportHeader.props.onPress());
 expect(projected.findAllByType(ModelContent)).toHaveLength(0);
 for(const row of [unknown,projected])expect(row.findAll(node=>StyleSheet.flatten(node.props.style)?.alignSelf==='flex-end')).toHaveLength(0);
 expect(activeRoot(tree).findByProps({testID:'history-entry-1'}).findAll(node=>StyleSheet.flatten(node.props.style)?.alignSelf==='flex-end').length).toBeGreaterThan(0);
 const list=activeRoot(tree).findByProps({testID:'chat-history-list'});
 const draft=activeRoot(tree).findByProps({accessibilityLabel:'Message draft'});
 act(()=>draft.props.onChangeText('Draft stays here'));
 await navigateTo(tree,'Agents');
 expect(activeRoot(tree).findByProps({testID:'agents-screen'})).toBeDefined();
 expect(activeRoot(tree).findAllByProps({testID:'child-history-list'})).toHaveLength(0);

 await act(async()=>activeRoot(tree).findByProps({accessibilityLabel:'View agent Audit helper'}).props.onPress());
 expect(activeRoot(tree).findByProps({testID:'child-history-list'})).toBeDefined();
 const childList=activeRoot(tree).findByProps({testID:'child-history-list'});
 expect(childList.props.inverted).toBe(true);
 expect(StyleSheet.flatten(childList.props.contentContainerStyle).paddingTop).toBe(16);
 expect(childList.props.scrollIndicatorInsets.bottom).toBe(0);
 expect(activeRoot(tree).findByProps({testID:'sessions-bottom-bar'})).toBeDefined();

 expect(activeRoot(tree).findByProps({testID:'chat-history-list'})).toBe(list);
 expect(StyleSheet.flatten(activeRoot(tree).findByProps({testID:'chat-composer'}).props.style).opacity).toBe(0);
 expect(activeRoot(tree).findByProps({accessibilityLabel:'View agent Audit helper'}).props.accessibilityState.selected).toBe(true);
 await act(async()=>snapshots.get(`${backend.endpoint}/v1/chats/8/events?heartbeats=1&patches=1`)!({data:JSON.stringify({backendId:backend.backendId,conversationId:8,view:{entries:[{id:10,kind:'pi.assistant',model:[{role:'assistant',content:'Agent is working here.'}]}],docs:{},work:[]}})}));
 expect(activeRoot(tree).findByProps({testID:'child-history-list'}).props.data.some((e:any)=>e.id===10)).toBe(true);
 const firstStreamClose=closes.get(`${backend.endpoint}/v1/chats/8/events?heartbeats=1&patches=1`);
 await publish('idle');
 expect(activeRoot(tree).findAllByProps({testID:'active-agent-badge'})).toHaveLength(0);
 // Completion must not close a transcript that the owner deliberately opened.
 expect(firstStreamClose).not.toHaveBeenCalled();
 expect(activeRoot(tree).findByProps({testID:'child-history-list'})).toBe(childList);
 await act(async()=>activeRoot(tree).findByProps({accessibilityLabel:'Back to agent list'}).props.onPress());
 expect(firstStreamClose).toHaveBeenCalled();
 expect(activeRoot(tree).findAllByProps({testID:'child-history-list'})).toHaveLength(0);
 expect(activeRoot(tree).findByProps({accessibilityLabel:'View agent Audit helper'})).toBeDefined();
 await publish('stopping');
 expect(activeRoot(tree).findByProps({accessibilityLabel:'View agent Audit helper'})).toBeDefined();
 expect(activeRoot(tree).findByProps({accessibilityLabel:'View agent Second helper'})).toBeDefined();
 await act(async()=>activeRoot(tree).findByProps({accessibilityLabel:'View agent Second helper'}).props.onPress());
 expect(closes.get(`${backend.endpoint}/v1/chats/8/events?heartbeats=1&patches=1`)).toHaveBeenCalled();
 expect(activeRoot(tree).findByProps({accessibilityLabel:'View agent Second helper'}).props.accessibilityState.selected).toBe(true);
 expect(activeRoot(tree).findByProps({testID:'child-history-list'}).props.data.some((e:any)=>e.id===10)).toBe(false);
 await act(async()=>snapshots.get(`${backend.endpoint}/v1/chats/8/events?heartbeats=1&patches=1`)!({data:JSON.stringify({backendId:backend.backendId,conversationId:8,view:{entries:[{id:11,kind:'pi.assistant',model:[{role:'assistant',content:'Late wrong agent'}]}],docs:{},work:[]}})}));
 expect(activeRoot(tree).findByProps({testID:'child-history-list'}).props.data.some((e:any)=>e.id===11)).toBe(false);
 await publish('idle');
 expect(activeRoot(tree).findByProps({accessibilityLabel:'View agent Audit helper'})).toBeDefined();
 await navigateTo(tree,'Chat');
 expect(closes.get(`${backend.endpoint}/v1/chats/9/events?heartbeats=1&patches=1`)).toHaveBeenCalled();
 expect(activeRoot(tree).findByProps({testID:'agents-screen'}).props.pointerEvents).toBe('none');
 expect(activeRoot(tree).findByProps({testID:'chat-history-list'})).toBe(list);
 expect(draft.props.value).toBe('Draft stays here');
 await navigateTo(tree,'Agents');
 expect(activeRoot(tree).findAllByProps({accessibilityLabel:'Agent history'})).toHaveLength(0);
 expect(activeRoot(tree).findByProps({accessibilityLabel:'View agent Audit helper'})).toBeDefined();
 expect(activeRoot(tree).findAllByProps({testID:'child-history-list'})).toHaveLength(0);
 await navigateTo(tree,'Chat');
 expect(fetch).not.toHaveBeenCalledWith(expect.anything(),expect.objectContaining({method:'POST'}));
 }finally{await act(async()=>tree.unmount());}
});

test('agent tree opens the correct parent-scoped helper with duplicate names without changing the main draft or admitting work',async()=>{
 jest.replaceProperty(Platform,'OS','android');
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={};
 const snapshots=new Map<string,(event:any)=>void>(),closes=new Map<string,jest.Mock>();
 require('react-native-sse').mockImplementation((url:string)=>{const close=jest.fn();closes.set(url,close);return {addEventListener:jest.fn((event,callback)=>{if(event==='snapshot')snapshots.set(url,callback);}),close};});
 const fetch=jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{
  const url=String(input),data=url.includes('/agent-overview')?{backendId:backend.backendId,sessions:[{conversationId:7,title:'Main session',status:'working',agents:[{name:'Other helper',conversationId:8,status:'idle'}]},{conversationId:20,title:'Other session',status:'working',agents:[{name:'Other helper',conversationId:21,status:'working'}]}]}:url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[]}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Main session'}},{id:20,meta:{title:'Other session'}}]}:url.endsWith('/updates')?{enabled:false}:[];
  return {ok:true,status:200,json:async()=>data} as Response;
 });
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<App/>);});
 try{
  const draft=activeRoot(tree).findByProps({accessibilityLabel:'Message draft'}),list=activeRoot(tree).findByProps({testID:'chat-history-list'});
  act(()=>draft.props.onChangeText('Unsent message in main session'));
  await act(async()=>snapshots.get(`${backend.endpoint}/v1/chats/7/events?heartbeats=1&patches=1`)!({data:JSON.stringify({backendId:backend.backendId,conversationId:7,view:{entries:[],docs:{'app.subagents':{agents:{'Unverified helper':{conversationId:99,status:'working'}}}},work:[]}})}));
  await navigateTo(tree,'Agents');expect(activeRoot(tree).findByProps({accessibilityLabel:'Open Bob session Other session'})).toBeDefined();
  expect(activeRoot(tree).findAllByProps({accessibilityLabel:'View agent Unverified helper'})).toHaveLength(0);
  act(()=>DeviceEventEmitter.emit('BobKeyboardInset',{imeBottom:280}));
  expect(StyleSheet.flatten(activeRoot(tree).findByProps({testID:'agents-screen'}).props.style).bottom).toBe(280);
  act(()=>DeviceEventEmitter.emit('BobKeyboardInset',{imeBottom:0}));

  expect(activeRoot(tree).findAll(node=>node.props.accessibilityLabel==='View agent Other helper'&&typeof node.props.onPress==='function')).toHaveLength(2);
  await act(async()=>activeRoot(tree).findByProps({testID:'agent-row-20-21'}).findByProps({accessibilityLabel:'View agent Other helper'}).props.onPress());
  expect(activeRoot(tree).findByType(AgentsScreen).props.selected).toMatchObject({parentId:20,agent:{conversationId:21}});
  expect(activeRoot(tree).findByProps({testID:'agent-row-7-8'}).findByProps({accessibilityLabel:'View agent Other helper'}).props.accessibilityState.selected).toBe(false);
  expect(snapshots.has(`${backend.endpoint}/v1/chats/8/events?heartbeats=1&patches=1`)).toBe(false);
  const callback=snapshots.get(`${backend.endpoint}/v1/chats/21/events?heartbeats=1&patches=1`)!;expect(callback).toBeDefined();
  await act(async()=>callback({data:JSON.stringify({backendId:backend.backendId,conversationId:21,view:{entries:[{id:1,kind:'pi.assistant',model:[{role:'assistant',content:'Other session helper work'}]}],docs:{},work:[]}})}));
  expect(activeRoot(tree).findByProps({testID:'child-history-list'}).props.data.some((entry:any)=>entry.id===1)).toBe(true);
  expect(activeRoot(tree).findByProps({accessibilityLabel:'Message draft'})).toBe(draft);expect(draft.props.value).toBe('Unsent message in main session');expect(activeRoot(tree).findByProps({testID:'chat-history-list'})).toBe(list);
  await act(async()=>activeRoot(tree).findByProps({accessibilityLabel:'Back to agent list'}).props.onPress());expect(closes.get(`${backend.endpoint}/v1/chats/21/events?heartbeats=1&patches=1`)).toHaveBeenCalled();
  await act(async()=>callback({data:JSON.stringify({backendId:backend.backendId,conversationId:21,view:{entries:[],docs:{},work:[]}})}));expect(activeRoot(tree).findAllByProps({testID:'child-history-list'})).toHaveLength(0);
  await act(async()=>activeRoot(tree).findByProps({accessibilityLabel:'Open Bob session Other session'}).props.onPress());
  expect(activeRoot(tree).findByType(AgentsScreen).props.visible).toBe(false);
  expect(activeRoot(tree).findAllByProps({testID:'agents-screen'})).toHaveLength(0); // unopened list in the new retained session
  expect(snapshots.has(`${backend.endpoint}/v1/chats/20/events?heartbeats=1&patches=1`)).toBe(true);
  expect(fetch.mock.calls.some(([,options])=>options&&['POST','PUT','DELETE'].includes(options.method??''))).toBe(false);
 }finally{await act(async()=>tree.unmount());}
});

test('navigation menu starts the bounded Sessions read before selecting the destination',async()=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={};delete NativeModules.BobOutbox;
 let finish!:(value:Response)=>void;
 const held=new Promise<Response>(resolve=>{finish=resolve;});
 const fetcher=jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{
  const url=String(input);if(url.includes('/agent-overview'))return held;
  const data=url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[]}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Current'}}]}:url.endsWith('/updates')?{enabled:false}:[];
  return {ok:true,status:200,json:async()=>data} as Response;
 });
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<App/>);});
 const reads=()=>fetcher.mock.calls.filter(([url])=>String(url).includes('/agent-overview'));
 try{
  expect(reads()).toHaveLength(0); // No startup/background speculative catalogue.
  await act(async()=>activeRoot(tree).findByProps({accessibilityLabel:'Menu'}).props.onPress());
  expect(reads()).toHaveLength(1);
  const signal=(reads()[0][1] as RequestInit).signal!;
  await act(async()=>navigateTo(tree,'Agents'));
  expect(reads()).toHaveLength(1);expect(signal.aborted).toBe(false); // Same request survives menu → Sessions.
  await act(async()=>finish({ok:true,status:200,json:async()=>({backendId:backend.backendId,sessions:[{conversationId:7,title:'Prefetched session',status:'idle',agents:[]}]})} as Response));
  expect(activeRoot(tree).findByType(AgentsScreen).props.sessions[0].title).toBe('Prefetched session');
  await navigateTo(tree,'Chat');
  // Completed requests need no abort. A new menu visit starts a fresh read;
  // cancelling that visit must abort its still-pending request.
  fetcher.mockImplementation(async(_input,init)=>new Promise<Response>((_resolve,reject)=>{
   init?.signal?.addEventListener('abort',()=>reject(Error('Read cancelled')),{once:true});
  }));
  await act(async()=>activeRoot(tree).findByProps({accessibilityLabel:'Menu'}).props.onPress());
  const cancelled=(reads().at(-1)![1] as RequestInit).signal!;
  await act(async()=>tree.root.findByProps({testID:'overlay-active'}).findAllByProps({testID:'chat-navigation-sheet'}).at(-1)!.findAll(node=>node.props.accessibilityLabel==='Close navigation menu'&&typeof node.props.onPress==='function')[0].props.onPress());
  expect(cancelled.aborted).toBe(true);
 }finally{await act(async()=>tree.unmount());}
});

test('Notes navigation publishes the root plane in the tap transaction, with layout reconciliation retained',async()=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={};delete NativeModules.BobOutbox;
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{
  const url=String(input),data=url.includes('/agent-overview')?{backendId:backend.backendId,sessions:[]}:url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[]}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Current'}}]}:url.endsWith('/updates')?{enabled:false}:[];
  return {ok:true,status:200,json:async()=>data} as Response;
 });
 const publications:string[]=[];
 const module=require('../use-session-shell'),useShell=module.useSessionShell;
 jest.spyOn(module,'useSessionShell').mockImplementation(()=>{const shell=useShell();return {...shell,reportVisible:(context:any)=>{if(context.screen==='Notes')publications.push(require('react').__effectPhase());shell.reportVisible(context);}};});
 let tree!:Renderer.ReactTestRenderer;
 try{
  await act(async()=>{tree=Renderer.create(<App/>);});
  await act(async()=>activeRoot(tree).findByProps({accessibilityLabel:'Menu'}).props.onPress());
  act(()=>{
   visibleNavigation(tree).props.onSelect('Notes');
   // Assert before React can run the next render/layout pass. The independently
   // mounted root plane must be selected in the same event that hides the menu.
   expect(publications).toEqual(['render']);
  });
  expect(new Set(publications)).toEqual(new Set(['render','layout']));
  const notes=tree.root.findAll(node=>node.type===View&&node.props.testID===`workspace-notes:${backend.backendId}`)[0];
  expect(notes.props.pointerEvents).toBe('auto');expect(notes.props.accessibilityElementsHidden).toBe(false);
 }finally{if(tree)await act(async()=>tree.unmount());}
});

test('workstation agent overview remains reachable before a conversation is selected',async()=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={};
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{
  const url=String(input),data=url.includes('/agent-overview')?{backendId:backend.backendId,sessions:[{conversationId:20,title:'Another session',status:'idle',agents:[]}]}:url.endsWith('/chats')?{items:[{id:20,meta:{title:'Another session'}}]}:url.endsWith('/updates')?{enabled:false}:[];
  return {ok:true,status:200,json:async()=>data} as Response;
 });
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<App/>);});
 try{
  await navigateTo(tree,'Agents');
  expect(activeRoot(tree).findByProps({testID:'agents-screen'}).props.pointerEvents).toBe('auto');
  expect(activeRoot(tree).findByProps({accessibilityLabel:'Open Bob session Another session'})).toBeDefined();
  expect(activeRoot(tree).findAllByType(ChatNavigation).filter(node=>node.props.showTrigger!==false)).toHaveLength(1);
  await navigateTo(tree,'Chat');expect(activeRoot(tree).findByProps({testID:'agents-screen'}).props.pointerEvents).toBe('none');
 }finally{await act(async()=>tree.unmount());}
});

// MCP Apps must retain a tappable entry even though they never mount inline.
test('MCP app rows retain an accessible open control',async()=>{
 const open=jest.fn();let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<InlineSurface backend={{backendId:'fixture',endpoint:'https://test.ts.net'}} surface={{id:'fixture',conversationId:7,title:'Connected app',kind:'mcp'}} onExpand={open}/>);});
 act(()=>activeRoot(tree).findByProps({accessibilityLabel:'Open app: Connected app'}).props.onPress());
 expect(open).toHaveBeenCalledTimes(1);expect(activeRoot(tree).findAllByProps({testID:'bob-inline-native-surface'})).toHaveLength(0);
 await act(async()=>tree.unmount());
});

test('chat opening stays quiet while restoring the draft keeps typing safe',async()=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'test-token'});
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
  expect(activeRoot(tree).findAllByProps({testID:'chat-opening'})).toHaveLength(0);
  expect(activeRoot(tree).findByProps({accessibilityLabel:'Message draft'}).props.editable).toBe(false);
  expect(activeRoot(tree).findAllByProps({testID:'connection-status'})).toHaveLength(0);
  await act(async()=>restore('Retained draft'));
  expect(activeRoot(tree).findAllByProps({testID:'chat-opening'})).toHaveLength(0);
  expect(activeRoot(tree).findByProps({accessibilityLabel:'Message draft'}).props).toMatchObject({editable:true,value:'Retained draft'});
  expect(activeRoot(tree).findAllByProps({testID:'connection-status'})).toHaveLength(0);
 }finally{(AsyncStorage.getItem as jest.Mock).mockImplementation(get);if(tree)await act(async()=>tree.unmount());}
});


test('rapid A-to-B-to-A switching retains A while B safely completes its first draft read',async()=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'test-token'});
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
  const first=activeRoot(tree).findByProps({accessibilityLabel:'Message draft'});
  expect(first.props.editable).toBe(true);
  await act(async()=>first.props.onChangeText('Live A draft'));hold=true;
  const choose=async(id:string)=>{
   await navigateTo(tree,'Sessions');
   await act(async()=>activeRoot(tree).findByType(AgentsScreen).props.onOpenSession(Number(id)));
  };
  await choose('8');
  const second=activeRoot(tree).findByProps({accessibilityLabel:'Message draft'});
  expect(second.props.editable).toBe(false);
  await choose('7');
  expect(activeRoot(tree).findByProps({accessibilityLabel:'Message draft'})).toBe(first);
  expect(first.props).toMatchObject({editable:true,value:'Live A draft'});
  expect(reads.has(`draft:${backend.backendId}:7`)).toBe(false);
  await act(async()=>reads.get(`draft:${backend.backendId}:8`)![0]('Restored B draft'));
  expect(first.props).toMatchObject({editable:true,value:'Live A draft'});
  await choose('8');
  expect(activeRoot(tree).findByProps({accessibilityLabel:'Message draft'})).toBe(second);
  expect(second.props).toMatchObject({editable:true,value:'Restored B draft'});
 }finally{(AsyncStorage.getItem as jest.Mock).mockImplementation(get);if(tree)await act(async()=>tree.unmount());}
});

test('Send hands off to Android before JS persistence completes and immediate backgrounding',async()=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={};
 const enqueue=jest.fn(async()=>true);NativeModules.BobOutbox={enqueue,status:jest.fn(async()=>JSON.stringify({state:'pending'})),list:jest.fn(async()=>[]),remove:jest.fn(async()=>true)};
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{const url=String(input);return {ok:true,status:200,json:async()=>url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[]}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Test'}}]}:url.endsWith('/updates')?{enabled:false}:[]} as Response;});
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<App/>);});
 const write=(AsyncStorage.setItem as jest.Mock).getMockImplementation()!;let release!:(value?:unknown)=>void;
 jest.spyOn(AsyncStorage,'setItem').mockImplementation(async(key,value)=>{if(key==='message-outbox:v2')await new Promise(resolve=>{release=resolve;});await write(key,value);});
 try{
  act(()=>activeRoot(tree).findByProps({accessibilityLabel:'Message draft'}).props.onChangeText('Lock immediately'));
  act(()=>activeRoot(tree).findByProps({accessibilityLabel:'Send message'}).props.onPress());
  expect(enqueue).toHaveBeenCalledTimes(1);expect(JSON.parse((enqueue.mock.calls[0] as unknown as any[])[5]).text).toBe('Lock immediately');
  jest.replaceProperty(AppState,'currentState','background');
  await act(async()=>{for(let i=0;i<20;i++)await Promise.resolve();});expect(release).toBeDefined();expect(enqueue).toHaveBeenCalledTimes(1);
  await act(async()=>release());
 }finally{(AsyncStorage.setItem as jest.Mock).mockImplementation(write);await act(async()=>tree.unmount());delete NativeModules.BobOutbox;}
});

test('Sessions assigns working state by Durable conversation ID, not by the selected chat',async()=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={};
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{
  const url=String(input),data=url.includes('/agent-overview')?{backendId:backend.backendId,sessions:[7,8,9].map(id=>({conversationId:id,title:`Chat ${id}`,status:id===7?'idle':'working',agents:[]}))}:url.endsWith('/status')?{backendId:backend.backendId,inspection:{tasks:[{record:{conversationId:8,background:false}},{record:{conversationId:7,background:true}}],submissions:[{conversationId:9}]}}:url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[]}:url.endsWith('/chats')?{items:[7,8,9].map(id=>({id,meta:{title:`Chat ${id}`}}))}:url.endsWith('/updates')?{enabled:false}:[];
  return {ok:true,status:200,json:async()=>data} as Response;
 });
 let tree!:Renderer.ReactTestRenderer;
 try{
  await act(async()=>{tree=Renderer.create(<App/>);});
  expect((globalThis.fetch as jest.Mock).mock.calls.some(([url])=>String(url).endsWith('/status'))).toBe(false);
  await navigateTo(tree,'Sessions');
  expect(activeRoot(tree).findByType(AgentsScreen).props.sessions.map(({conversationId,status}:any)=>({conversationId,status}))).toEqual([
   {conversationId:7,status:'idle'},{conversationId:8,status:'working'},{conversationId:9,status:'working'},
  ]);
 }finally{if(tree)await act(async()=>tree.unmount());}
});

test.each(['parent','receipt-only','unlinked'])('nested surfaces retain a safe reachable location (%s)',async(placement)=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 const surface={id:'a841d08a-8b83-42cd-b8a7-2d61f2db7ae9',conversationId:7,title:'Nested visual',kind:'visual',presentation:'fullscreen',allowedTools:[]};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'test-token'});
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
  expect(activeRoot(tree).findByProps({testID:'history-entry-3'}).findAllByType(InlineSurface)).toHaveLength(0);
  expect(NativeModules.BobInteractive.open).not.toHaveBeenCalled();expect(NativeModules.BobInteractive.prepare).not.toHaveBeenCalled();
  const press=(label:string)=>{const owner=tree.root.findAllByProps({testID:'overlay-active'})[0]??activeRoot(tree);return owner.findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0].props.onPress();};
  if(placement==='unlinked'){
   expect(activeRoot(tree).findAllByType(InlineSurface)).toHaveLength(0);
   expect(activeRoot(tree).findAllByProps({accessibilityLabel:'Other interactive surfaces'})).toHaveLength(0);
   const list=activeRoot(tree).findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0];
   act(()=>activeRoot(tree).findByProps({accessibilityLabel:'Message draft'}).props.onChangeText('Keep my draft'));
   await act(async()=>press('Chat actions'));
   await act(async()=>press('More'));
   expect(list.findAllByProps({accessibilityLabel:'Other interactive surfaces'})).toHaveLength(0);
   expect(activeRoot(tree).findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0]).toBe(list);
   await act(async()=>press('Other interactive surfaces'));
   expect(NativeModules.BobInteractive.open).not.toHaveBeenCalled();
   await act(async()=>press('Open Nested visual'));
   expect(activeRoot(tree).findAllByProps({accessibilityLabel:'Other interactive surfaces'})).toHaveLength(0);
   expect(activeRoot(tree).findByProps({accessibilityLabel:'Message draft'}).props.value).toBe('Keep my draft');
  }else{
   expect(activeRoot(tree).findAllByType(InlineSurface)).toHaveLength(1);
   const data=activeRoot(tree).findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0].props.data;
   const index=data.findIndex((entry:any)=>entry.inlineSurfaceId);expect(data[index].inlineSurfaceSource).toBe(placement==='parent'?1:2);if(placement==='parent')expect(data[index+1].id).toBe(1);
   expect(activeRoot(tree).findAllByProps({accessibilityLabel:'Other interactive surfaces'})).toHaveLength(0);
   await act(async()=>press('Expand visual: Nested visual'));
  }
  expect(NativeModules.BobInteractive.open).toHaveBeenCalledWith(backend.endpoint,backend.backendId,'test-token',7,surface.id);
 }finally{if(tree)await act(async()=>tree.unmount());}
});

test.each([{capability:{inlineHeight:8192},height:8192},{capability:undefined,height:420}])('outbound visual bounds follow the selected backend snapshot ($height)',async({capability,height})=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'test-token'});
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
  const list=activeRoot(tree).findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0];
  act(()=>{list.props.ListHeaderComponent.props.onLayout({nativeEvent:{layout:{width:313}}});activeRoot(tree).findByProps({accessibilityLabel:'Message draft'}).props.onChangeText('Show a naturally sized card');});
  await act(async()=>activeRoot(tree).findByProps({accessibilityLabel:'Send message'}).props.onPress());
  expect(require('react-native').Alert.alert).not.toHaveBeenCalled();
  const outgoing=await readOutbox() as Array<{message:{display?:{inline:unknown}}}>;expect(outgoing).toHaveLength(1);
  expect(outgoing[0].message.display?.inline).toEqual({width:313,height});
 }finally{await act(async()=>tree.unmount());}
});

test('delayed Use default verification never discards a newer reopened instructions edit with identical text',async()=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'test-token'});
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
  const press=(label:string)=>activeRoot(tree).findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0].props.onPress();
  const reopen=async()=>{await navigateTo(tree,'Chat');await navigateTo(tree,'Settings');await act(async()=>press('Conversation settings'));};
  await reopen();act(()=>activeRoot(tree).findByProps({accessibilityLabel:'Conversation instructions'}).props.onChangeText('A'));
  await act(async()=>press('Use backend default instructions'));expect(release).toBeDefined();expect(configured.instructions).toBeNull();
  await reopen();
  act(()=>activeRoot(tree).findByProps({accessibilityLabel:'Conversation instructions'}).props.onChangeText('B'));
  act(()=>activeRoot(tree).findByProps({accessibilityLabel:'Conversation instructions'}).props.onChangeText('A'));
  await act(async()=>release!(response({...configured})));
  await reopen();expect(activeRoot(tree).findByProps({accessibilityLabel:'Conversation instructions'}).props.value).toBe('A');
 }finally{if(tree)await act(async()=>tree.unmount());}
});

test('drawing attachment propagates transfer/staging failures and cleans up a file staged after a conversation switch',async()=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'test-token'});
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
  const add=activeRoot(tree).findByType(DrawingEditor).props.onAdd;
  await expect(add('data:image/png;base64,png')).rejects.toThrow('Transfer unavailable');expect(stage).not.toHaveBeenCalled();
  transferFailure=false;stage.mockRejectedValueOnce(Error('Storage full'));
  await expect(add('data:image/png;base64,png')).rejects.toThrow('Storage full');
  let finish!:(value:any)=>void;stage.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  let result!:Promise<unknown>;
  await act(async()=>{result=add('data:image/png;base64,png').catch((error:Error)=>error);});expect(finish).toBeDefined();
  await navigateTo(tree,'Sessions');
  await act(async()=>activeRoot(tree).findByType(AgentsScreen).props.onOpenSession(8));
  await act(async()=>finish({id:'5aaee20e-e260-4403-80da-b97ce80664a1',name:'drawing.png',mime:'image/png',uri:'file:///draft'}));
  expect(await result).toEqual(Error('Conversation changed. Drawing was not attached.'));
  expect(remove).toHaveBeenCalledWith('5aaee20e-e260-4403-80da-b97ce80664a1');
 }finally{if(tree)await act(async()=>tree.unmount());}
});

test('native run failures remain passive status, preserve drafts, and do not make an idle run busy',async()=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'test-token'});
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
  await publish({run:{taskId:99,inputs:[]}});expect(activeRoot(tree).findByProps({accessibilityLabel:'Stop Bob'})).toBeDefined();
  const draft=activeRoot(tree).findByProps({accessibilityLabel:'Message draft'});act(()=>draft.props.onChangeText('Keep this draft'));
  await publish({runFailure:{taskId:99,reason:'restart_limit',detail:'private provider detail'}});
  const displayed=activeRoot(tree).findAll(node=>typeof node.props.children==='string').map(node=>node.props.children).join('\n');
  expect(displayed).toContain('Response stopped after repeated runtime interruptions.');
  expect(displayed).not.toContain('private provider detail');expect(draft.props.value).toBe('Keep this draft');
  act(()=>draft.props.onChangeText('')); // Draft presence must not mask a stale busy state.
  expect(activeRoot(tree).findAllByProps({accessibilityLabel:'Stop Bob'})).toHaveLength(0);
  const list=activeRoot(tree).findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0];expect(list.props.data).toEqual([]);
  await publish({run:{taskId:100,inputs:[]},runFailure:{taskId:99,reason:'restart_limit'}});
  expect(activeRoot(tree).findByProps({accessibilityLabel:'Stop Bob'})).toBeDefined();
  expect(activeRoot(tree).findAllByProps({testID:'native-run-status'})).toHaveLength(0);
  expect(fetch.mock.calls.every(([,options])=>!options?.method||options.method==='GET')).toBe(true);
 }finally{await act(async()=>tree.unmount());}
});

test('original per-entry tool layout stays separate and preserves the chat list and draft',async()=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={versionCode:35,versionName:'test'};
 const file={id:'a841d08a-8b83-42cd-b8a7-2d61f2db7ae9',conversationId:7,name:'fixture.txt',mime:'text/plain',size:12,sha256:'a'.repeat(64)};
 const items=[{id:7,kind:'bob.artifact',data:file},{id:8,kind:'bob.file',data:{...file,id:'b841d08a-8b83-42cd-b8a7-2d61f2db7ae9'}},{id:1,kind:'bob.user',data:{text:'Check these files'}},{id:2,kind:'pi.assistant',model:[{role:'assistant',content:[{type:'text',text:'Checking the files.'},{type:'toolCall',id:'a',name:'read',arguments:{path:'a.txt'}}]}]},{id:3,kind:'pi.tool-result',model:[{role:'toolResult',toolCallId:'a',toolName:'read',content:'FIRST'}]},{id:4,kind:'pi.assistant',model:[{role:'assistant',content:[{type:'toolCall',id:'b',name:'read',arguments:{path:'b.txt'}}]}]},{id:5,kind:'pi.tool-result',model:[{role:'toolResult',toolCallId:'b',toolName:'read',content:'SECOND'}]},{id:6,kind:'pi.assistant',model:[{role:'assistant',content:[{type:'text',text:'Here is the answer.'}]}]}];
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{const url=String(input);const data=url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Test chat'}}]}:url.endsWith('/updates')?{enabled:false}:url.endsWith('/peers')?{inbound:[],outbound:[]}:url.endsWith('/library')?{instructions:'',templates:{},skills:{},commands:[]}:url.endsWith('/configure')?{instructions:null,cwd:'/workspace'}:[];return{ok:true,status:200,json:async()=>data} as Response;});
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<App/>);});
 const list=activeRoot(tree).findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0];
 await measureTranscriptFixture(list);
 expect(list.props.data.map((entry:any)=>entry.id)).toEqual([8,7,6,4,2,1]);
 expect(activeRoot(tree).findAllByProps({accessibilityLabel:'Work summary'})).toHaveLength(0);
 const tools=activeRoot(tree).findAllByType(require('../components/tool-content').ToolContent);
 expect(tools).toHaveLength(2);expect(tools.every(tool=>tool.props.quiet)).toBe(true);
 const owner=activeRoot(tree).findByProps({testID:'history-entry-1'}).findByType(ChatBubble);
 expect(owner.props.variant).toBe('owner');
 expect(activeRoot(tree).findByProps({testID:'history-entry-7'}).findByType(ChatBubble).props.variant).toBe('upload');
 expect(activeRoot(tree).findByProps({testID:'history-entry-8'}).findByType(ChatBubble).props.variant).toBe('activity');
 expect(activeRoot(tree).findByProps({testID:'history-entry-7'}).findByType(require('../components/file-attachment').FileAttachment).props.fromBob).toBe(false);
 expect(activeRoot(tree).findByProps({testID:'history-entry-8'}).findByType(require('../components/file-attachment').FileAttachment).props.fromBob).toBe(true);
 const mixed=activeRoot(tree).findByProps({testID:'history-entry-2'});
 expect(mixed.findAllByType(ChatBubble).map(b=>b.props.variant??'assistant')).toEqual(['activity','assistant']);
 const answer=activeRoot(tree).findByProps({testID:'history-entry-6'});
 expect(answer.findAllByType(ChatBubble).map(b=>b.props.variant??'assistant')).toEqual(['activity','assistant']);
 const toolOnly=activeRoot(tree).findByProps({testID:'history-entry-4'});
 expect(toolOnly.findAllByType(ChatBubble).map(b=>b.props.variant??'assistant')).toEqual(['activity']);
 for(const bubble of mixed.findAllByType(ChatBubble).filter(b=>b.props.variant!=='activity'))expect(bubble.findAllByType(require('../components/tool-content').ToolContent)).toHaveLength(0);
 expect(StyleSheet.flatten(list.props.contentContainerStyle).paddingHorizontal).toBe(12);
 expect(activeRoot(tree).findByType(DraftInput).props.maxHeight).toBeLessThanOrEqual(156);

 await act(async()=>activeRoot(tree).findAllByProps({accessibilityLabel:'Tool details: read'})[0].props.onPress());
 expect(activeRoot(tree).findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0]).toBe(list);
 expect(activeRoot(tree).findByProps({testID:'history-entry-6'})).toBeDefined();
 expect(activeRoot(tree).findByProps({accessibilityLabel:'Message draft'}).props.value).toBe('');
 await act(async()=>tree.unmount());
});

test('recorded codemode audit branches expand independently while the script stays closed and the list/draft stay mounted',async()=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'test-token'});
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
  const list=activeRoot(tree).findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0];
  const draft=activeRoot(tree).findByProps({accessibilityLabel:'Message draft'});
  const initialData=list.props.data,separatorType=list.props.ItemSeparatorComponent;
  act(()=>draft.props.onChangeText('Retain this draft'));
  expect(list.props.data).toBe(initialData);expect(list.props.ItemSeparatorComponent).toBe(separatorType);
  expect(list.props.data.map((entry:any)=>entry.id)).toEqual([5,3,1]);
  expect(StyleSheet.flatten(list.props.contentContainerStyle).gap).toBe(0);
  const separatorHeight=(id:number)=>StyleSheet.flatten(activeRoot(tree).findAllByType(TranscriptSeparator).find(node=>node.props.leadingItem.id===id)!.findByType(View).props.style).height;
  expect(separatorHeight(3)).toBe(0);expect(separatorHeight(5)).toBe(16);
  const row=activeRoot(tree).findByProps({testID:'history-entry-1'});
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
  expect(activeRoot(tree).findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0]).toBe(list);
  expect(activeRoot(tree).findByProps({accessibilityLabel:'Message draft'})).toBe(draft);
  expect(draft.props.value).toBe('Retain this draft');
 }finally{await act(async()=>tree.unmount());}
});

test('plain menu stays stable across native work, answers and failures without changing send/stop',async()=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={};delete NativeModules.BobOutbox;
 let snapshot:((event:any)=>void)|undefined;
 require('react-native-sse').mockImplementation(()=>({addEventListener:jest.fn((event,callback)=>{if(event==='snapshot')snapshot=callback;}),close:jest.fn(),open:jest.fn()}));
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{const url=String(input),data=url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[]}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Test'}}]}:url.endsWith('/updates')?{enabled:false}:[];return{ok:true,status:200,json:async()=>data} as Response;});
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<App/>);});
 const entry=(id:number)=>({id,kind:'pi.assistant',model:[{role:'assistant',stopReason:'stop',content:[{type:'text',text:'Finished answer'}]}]});
 const publish=async(live:any,entries:any[])=>act(async()=>snapshot!({data:JSON.stringify({backendId:backend.backendId,conversationId:7,view:{entries,docs:{'pi.live':live}}})}));
 try{
  const menu=activeRoot(tree).findByProps({accessibilityLabel:'Menu'});
  const stableMenu=()=>{expect(activeRoot(tree).findByProps({accessibilityLabel:'Menu'})).toBe(menu);expect(activeRoot(tree).findAllByProps({testID:'bob-mascot'})).toHaveLength(0);};
  await publish({},[entry(2)]);stableMenu();
  const draft=activeRoot(tree).findByProps({accessibilityLabel:'Message draft'});
  await publish({run:{taskId:10,first:3}},[entry(2)]);stableMenu();expect(activeRoot(tree).findByProps({accessibilityLabel:'Stop Bob'})).toBeDefined();
  await publish({},[entry(2),entry(4)]);stableMenu();
  act(()=>draft.props.onChangeText('Retain my draft'));
  await publish({run:{taskId:11,first:5},runFailure:{reason:'old error'}},[entry(4)]);stableMenu();
  await publish({runFailure:{taskId:11,reason:'model_error'}},[entry(4)]);stableMenu();expect(activeRoot(tree).findAllByProps({accessibilityLabel:'Stop Bob'})).toHaveLength(0);
  expect(activeRoot(tree).findByProps({accessibilityLabel:'Message draft'})).toBe(draft);expect(draft.props.value).toBe('Retain my draft');
  await publish({run:{taskId:12,first:6}},[entry(4)]);
  await act(async()=>activeRoot(tree).findByProps({accessibilityLabel:'Chat actions'}).props.onPress());
  stableMenu();
  await publish({},[entry(4),entry(8)]);
  stableMenu();
  await act(async()=>tree.root.findByProps({testID:'overlay-active'}).findByProps({accessibilityLabel:'Dismiss chat actions'}).props.onPress());
  stableMenu();
 }finally{await act(async()=>tree.unmount());}
});


test('chat omits composer status and opening spinner across response phases while preserving tools, errors, draft/list/stop identity',async()=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={};delete NativeModules.BobOutbox;
 let snapshot:((event:any)=>void)|undefined;
 require('react-native-sse').mockImplementation(()=>({addEventListener:jest.fn((event,callback)=>{if(event==='snapshot')snapshot=callback;}),close:jest.fn(),open:jest.fn()}));
 const fetch=jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{const url=String(input),data=url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[]}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Test'}}]}:url.endsWith('/updates')?{enabled:false}:[];return{ok:true,status:200,json:async()=>data} as Response;});
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<App/>);});
 const entries=[{id:1,kind:'bob.user',data:{text:'Keep actual tool activity in chat'}},{id:2,kind:'pi.assistant',model:[{role:'assistant',content:[{type:'toolCall',id:'read-1',name:'read',arguments:{path:'example.txt'}}]}]}];
 const publish=async(live:any,docs:any={},work:any[]=[])=>act(async()=>snapshot!({data:JSON.stringify({backendId:backend.backendId,conversationId:7,view:{entries,docs:{'pi.live':live,...docs},work}})}));
 const native={taskId:99,first:1};
 const quiet=()=>{expect(activeRoot(tree).findAll(node=>typeof node.type==='string'&&node.props.testID==='pebble-bob')).toHaveLength(1);expect(activeRoot(tree).findAllByProps({testID:'connection-status'})).toHaveLength(0);expect(activeRoot(tree).findAllByProps({testID:'chat-opening'})).toHaveLength(0);};
 const displayed=()=>activeRoot(tree).findAll(node=>typeof node.props.children==='string').map(node=>node.props.children).join('\n');
 try{
  await publish({run:native,generation:{}});quiet();
  const draft=activeRoot(tree).findByProps({accessibilityLabel:'Message draft'}),list=activeRoot(tree).findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0];
  expect(activeRoot(tree).findByProps({accessibilityLabel:'Stop Bob'})).toBeDefined();act(()=>draft.props.onChangeText('Keep this draft'));
  const stable=()=>{expect(activeRoot(tree).findByProps({accessibilityLabel:'Message draft'})).toBe(draft);expect(draft.props.value).toBe('Keep this draft');expect(activeRoot(tree).findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0]).toBe(list);};
  for(const generation of [
   {message:{content:[{type:'thinking',thinking:'private reasoning'}]}},
   {message:{content:[{type:'text',text:'A public response'}]}},
   {retry:{at:7,error:'private provider failure'}},
   {deferred:{pollAt:7}},
  ] as const){await publish({run:native,generation});quiet();expect(activeRoot(tree).findAllByProps({testID:'native-run-status'})).toHaveLength(0);stable();}
  expect(displayed()).not.toMatch(/private provider failure|Retrying the response|Waiting for the model provider/);
  await publish({run:native,generation:{message:{content:[{type:'text',text:'Older commentary'}]}},tools:[{callId:'read-1',taskId:100,name:'read',status:'running',output:'Readable progress'}]});
  quiet();expect(activeRoot(tree).findAllByType(CompactActivityRow).some(row=>row.props.accessibilityLabel==='Tool details: read'&&row.props.title==='Read example.txt')).toBe(true);stable();
  await publish({run:native,compactions:[{taskId:101}]});quiet();expect(activeRoot(tree).findAllByProps({testID:'native-run-status'})).toHaveLength(0);stable();
  await publish({}, {'bob.questions':{pending:{id:'question-1',text:'Which option?',options:['One','Two']}}});quiet();quiet();expect(activeRoot(tree).findAllByProps({testID:'question-card'}).length).toBeGreaterThan(0);stable();
  await publish({run:native}, {}, [{id:99,kind:'pi.run',background:false,abortRequested:true,state:'running'}]);quiet();stable();
  await publish({run:{...native,afterRun:{tasks:[100]}}});quiet();stable();
  await publish({runFailure:{reason:'model_error',detail:'private provider failure'},compactionFailure:{error:'private compaction error'}});quiet();expect(displayed()).toContain('Response failed. The model could not complete an answer.');expect(displayed()).toContain('Context compaction failed.');expect(displayed()).not.toContain('private provider failure');stable();
  act(()=>draft.props.onChangeText(''));expect(activeRoot(tree).findAllByProps({accessibilityLabel:'Stop Bob'})).toHaveLength(0);
  await navigateTo(tree,'Sessions');quiet();await navigateTo(tree,'Chat');
  expect(fetch.mock.calls.every(([,options])=>!options?.method||options.method==='GET')).toBe(true);
 }finally{await act(async()=>tree.unmount());}
});

test('real App wires source snapshot phone requests once and keeps controls in Settings without disturbing the draft',async()=>{
 jest.replaceProperty(Platform,'OS','android');
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://phone-tools.test.ts.net',name:'Phone tools fixture'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'paired-device-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={};
 const previous=NativeModules.BobPhoneTools;
 const phoneNative={enabled:jest.fn(async()=>true),setEnabled:jest.fn(async()=>true),execute:jest.fn(async(_backendId:string,_json:string)=>JSON.stringify({status:'ok',data:{sdkInt:35}})),getResult:jest.fn(async()=>null)};NativeModules.BobPhoneTools=phoneNative;
 jest.spyOn(require('react-native').PermissionsAndroid,'check').mockResolvedValue(true);
 const snapshots=new Map<string,(event:any)=>void>();
 require('react-native-sse').mockImplementation((url:string)=>({addEventListener:jest.fn((event,callback)=>{if(event==='snapshot')snapshots.set(url,callback);}),close:jest.fn(),open:jest.fn()}));
 const posts:any[]=[];
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any,init:any)=>{
  const url=String(input);if(init?.method==='POST'&&url.includes('/phone-tools'))posts.push({url,body:JSON.parse(init.body),headers:init.headers});
  const data=url.endsWith('/phone-tools/availability')?{enabled:true}:url.endsWith('/phone-tools')?JSON.parse(init.body).action==='claim'?{execute:true,status:'executing'}:{accepted:true,status:'completed'}:url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[]}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Phone tools'}}]}:url.endsWith('/updates')?{enabled:false}:[];
  return {ok:true,status:200,json:async()=>data} as Response;
 });
 let tree!:Renderer.ReactTestRenderer;
 try{
  await act(async()=>{tree=Renderer.create(<App/>);});
  const draft=activeRoot(tree).findByProps({accessibilityLabel:'Message draft'});await act(async()=>draft.props.onChangeText('Keep my draft intact'));
  const publish=snapshots.get(`${backend.endpoint}/v1/chats/7/events?heartbeats=1&patches=1`)!;expect(publish).toBeDefined();
  const request={id:'ab'.repeat(32),action:'device_info',parameters:{},expiresAt:Date.now()+90000,status:'pending'};
  const snapshot={backendId:backend.backendId,conversationId:7,view:{entries:[],docs:{'bob.phone-tools':{requests:[request]}}}};
  await act(async()=>publish({data:JSON.stringify(snapshot)}));await act(async()=>publish({data:JSON.stringify(snapshot)}));
  expect(phoneNative.execute).toHaveBeenCalledTimes(1);expect(phoneNative.execute.mock.calls[0][0]).toBe(backend.backendId);
  expect(posts.filter(post=>post.body.action==='claim')).toHaveLength(1);expect(posts.filter(post=>post.body.action==='result')).toHaveLength(1);
  expect(posts.find(post=>post.body.action==='claim').headers.Authorization).toBe('Bearer paired-device-token');
  await act(async()=>publish({data:JSON.stringify({...snapshot,conversationId:8,view:{entries:[],docs:{'bob.phone-tools':{requests:[{...request,id:'cd'.repeat(32)}]}}}})}));expect(phoneNative.execute).toHaveBeenCalledTimes(1);
  expect(activeRoot(tree).findByProps({accessibilityLabel:'Message draft'})).toBe(draft);expect(draft.props.value).toBe('Keep my draft intact');
  await navigateTo(tree,'Settings');await act(async()=>activeRoot(tree).findAll(node=>node.props.accessibilityLabel==='Phone & location'&&typeof node.props.onPress==='function')[0].props.onPress());expect(activeRoot(tree).findAllByType(require('../components/touch-target').TouchTarget).filter(node=>node.props.accessibilityLabel==='Disable phone tools'&&typeof node.props.onPress==='function')).toHaveLength(1);
  await navigateTo(tree,'Chat');expect(activeRoot(tree).findByProps({accessibilityLabel:'Message draft'})).toBe(draft);expect(draft.props.value).toBe('Keep my draft intact');
 }finally{if(tree)await act(async()=>tree.unmount());if(previous===undefined)delete NativeModules.BobPhoneTools;else NativeModules.BobPhoneTools=previous;}
});

test('real App keeps the native connection separate from foreground-only phone tools and retains its draft/list',async()=>{
 jest.replaceProperty(Platform,'OS','android');
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://keep-connected.test.ts.net',name:'Connection fixture'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'paired-token'});
 const listeners=new Set<(state:string)=>void>();(AppState as any).currentState='active';
 jest.spyOn(AppState,'addEventListener').mockImplementation((event,listener)=>{if(event==='change')listeners.add(listener as (state:string)=>void);return{remove:()=>listeners.delete(listener as (state:string)=>void)};});
 let connection={enabled:false,running:false,status:'off',batteryRestricted:true};
 const native={select:jest.fn(async()=>{}),state:jest.fn(async()=>JSON.stringify(connection)),start:jest.fn(async(_endpoint:string,_backend:string,_token:string,_chat:number,_enable:boolean)=>{connection={...connection,enabled:true,running:true,status:'connected'};}),stop:jest.fn(async()=>{connection={...connection,enabled:false,running:false,status:'off'};}),openBatterySettings:jest.fn(async()=>{})};
 const previous=NativeModules.BobConnection,previousPhone=NativeModules.BobPhoneTools;
 NativeModules.BobConnection=native;NativeModules.BobPhoneTools={enabled:jest.fn(async()=>true),setEnabled:jest.fn(async()=>{}),execute:jest.fn(async()=>JSON.stringify({status:'ok'})),getResult:jest.fn(async()=>null)};
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={};
 jest.spyOn(require('react-native').PermissionsAndroid,'check').mockResolvedValue(true);
 const streams:{publish?:(event:any)=>void;close:jest.Mock}[]=[];
 require('react-native-sse').mockImplementation(()=>{const stream={close:jest.fn(),publish:undefined as undefined|((event:any)=>void)};streams.push(stream);return{close:stream.close,addEventListener:(event:string,listener:any)=>{if(event==='snapshot')stream.publish=listener;}};});
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any,init:any)=>{const url=String(input),data=url.endsWith('/phone-tools/availability')?{enabled:JSON.parse(init.body).enabled}:url.endsWith('/phone-tools')?{execute:true,accepted:true}:url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[]}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Connection'}}]}:url.endsWith('/updates')?{enabled:false}:[];return{ok:true,status:200,json:async()=>data} as Response;});
 let tree!:Renderer.ReactTestRenderer;
 try{
  await act(async()=>{tree=Renderer.create(<App/>);});
  const draft=activeRoot(tree).findByProps({accessibilityLabel:'Message draft'}),list=activeRoot(tree).findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0];
  await act(async()=>draft.props.onChangeText('Keep this unsent draft'));
  await navigateTo(tree,'Settings');await act(async()=>activeRoot(tree).findAll(node=>node.props.accessibilityLabel==='Connection'&&typeof node.props.onPress==='function')[0].props.onPress());await act(async()=>activeRoot(tree).findAll(node=>node.props.accessibilityLabel==='Enable keep connected'&&typeof node.props.onPress==='function')[0].props.onPress());
  expect(native.start).toHaveBeenCalledWith(backend.endpoint,backend.backendId,'paired-token',7,true);await navigateTo(tree,'Chat');
  const old=streams[streams.length-1];
  await act(async()=>{(AppState as any).currentState='background';for(const listener of listeners)listener('background');});
  expect(old.close).toHaveBeenCalled();expect(native.stop).not.toHaveBeenCalled();expect(connection.running).toBe(true);
  const snapshot={backendId:backend.backendId,conversationId:7,view:{entries:[],docs:{'bob.phone-tools':{requests:[{id:'ef'.repeat(32),action:'device_info',parameters:{},expiresAt:Date.now()+80000,status:'pending'}]}}}};
  await act(async()=>old.publish!({data:JSON.stringify(snapshot)}));expect(NativeModules.BobPhoneTools.execute).not.toHaveBeenCalled();
  expect((fetch as jest.Mock).mock.calls.some(([url,options])=>String(url).endsWith('/phone-tools/availability')&&JSON.parse(options.body).enabled===false)).toBe(true);
  await act(async()=>{(AppState as any).currentState='active';for(const listener of listeners)listener('active');});
  expect(streams.length).toBeGreaterThan(1);expect(native.stop).not.toHaveBeenCalled();expect(native.start.mock.calls.every(call=>call[1]===backend.backendId&&call[3]===7)).toBe(true);
  expect(activeRoot(tree).findByProps({accessibilityLabel:'Message draft'})).toBe(draft);expect(draft.props.value).toBe('Keep this unsent draft');expect(activeRoot(tree).findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0]).toBe(list);
 }finally{if(tree)await act(async()=>tree.unmount());(AppState as any).currentState='active';if(previous===undefined)delete NativeModules.BobConnection;else NativeModules.BobConnection=previous;if(previousPhone===undefined)delete NativeModules.BobPhoneTools;else NativeModules.BobPhoneTools=previousPhone;}
});

test.each([false,true])('update notification respects workstation-scoped conversation selection (same workstation: %s)',async(same)=>{
 jest.replaceProperty(Platform,'OS','android');(AppState as any).currentState='active';
 const one={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://one.ts.net',name:'One'},two={backendId:'22222222-2222-4222-8222-222222222222',endpoint:'https://two.ts.net',name:'Two'};
 await AsyncStorage.setItem('backends',JSON.stringify([one,two]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:one.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'paired-token'});
 let notice:any=null;
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>notice),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={};
 const native={select:jest.fn(async()=>{}),state:jest.fn(async()=>JSON.stringify({enabled:true,running:false,status:'off',batteryRestricted:true})),start:jest.fn(async()=>{}),stop:jest.fn(async()=>{})};NativeModules.BobConnection=native;
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{const url=String(input),data=url.includes('/history')?{backendId:one.backendId,conversationId:7,coverage:'stored-entries',items:[]}:url.endsWith('/chats')?{items:[]}:url.endsWith('/updates')?{enabled:false}:[];return{ok:true,status:200,json:async()=>data} as Response;});
 let tree!:Renderer.ReactTestRenderer;
 try{
  await act(async()=>{tree=Renderer.create(<App/>);});
  expect(native.start).toHaveBeenCalledWith(one.endpoint,one.backendId,'paired-token',7,false);
  notice={screen:'updates',backendId:same?one.backendId:two.backendId};
  await act(async()=>DeviceEventEmitter.emit('BobNotificationOpen'));
  expect(native.select).toHaveBeenLastCalledWith(same?one.backendId:'',same?7:0);
  expect(native.start).toHaveBeenCalledTimes(1);
  expect(native.start).toHaveBeenLastCalledWith(one.endpoint,one.backendId,'paired-token',7,false);
 }finally{if(tree)await act(async()=>tree.unmount());delete NativeModules.BobConnection;}
});

test('live reply keeps its native row through completion; generated files move beneath only that proven answer',async()=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={};delete NativeModules.BobOutbox;
 NativeModules.BobInteractive={prepare:jest.fn(async()=> 'retained-surface'),releasePrepared:jest.fn()};
 const surface={id:'a941d08a-8b83-42cd-b8a7-2d61f2db7ae9',conversationId:7,title:'Report chart',kind:'visual',presentation:'inline',allowedTools:[]};
 let snapshot:((event:any)=>void)|undefined;
 require('react-native-sse').mockImplementation(()=>({addEventListener:jest.fn((event,callback)=>{if(event==='snapshot')snapshot=callback;}),close:jest.fn(),open:jest.fn()}));
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{const url=String(input),data=url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[]}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Test'}}]}:url.endsWith('/updates')?{enabled:false}:url.endsWith('/ui')?[surface]:[];return{ok:true,status:200,json:async()=>data} as Response;});
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<App/>);});
 const file={id:3,kind:'bob.file',data:{id:'a841d08a-8b83-42cd-b8a7-2d61f2db7ae9',conversationId:7,name:'report.txt',mime:'text/plain',size:12,sha256:'a'.repeat(64)}};
 const owner={id:1,kind:'bob.user',data:{text:'Make a report'}},upload={...file,id:2,kind:'bob.artifact'};
 const source={id:4,byTaskId:77,kind:'pi.assistant',model:[{role:'assistant',content:[{type:'toolCall',id:'visual',name:'render_visual',arguments:{title:surface.title,html:'<p>Chart</p>'}}]}]},result={id:5,kind:'pi.tool-result',model:[{role:'toolResult',toolCallId:'visual',toolName:'render_visual',content:[{type:'text',text:`Isolated visual ${surface.id}: Report chart. Open from the conversation’s interactive surfaces.`}]}]};
 const publish=async(entries:any[],live:any)=>act(async()=>snapshot!({data:JSON.stringify({backendId:backend.backendId,conversationId:7,view:{entries,docs:{'pi.live':live}}})}));
 try{
  await publish([owner,upload,file,source,result],{run:{taskId:99,first:1},generation:{message:{role:'assistant',content:[{type:'text',text:'Here is'}]}}});
  const list=activeRoot(tree).findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0];
  await measureTranscriptFixture(list);
  expect(list.props.data[0].liveResponse).toBe(true);
  const liveRow=activeRoot(tree).findByProps({testID:'history-entry--99'}),fileRow=activeRoot(tree).findByProps({testID:'history-entry-3'}),visual=activeRoot(tree).findByType(InlineSurface),draft=activeRoot(tree).findByProps({accessibilityLabel:'Message draft'});
  act(()=>draft.props.onChangeText('Keep my draft'));
  const scroll=jest.spyOn(list.instance,'scrollToOffset').mockImplementation(()=>{});act(()=>list.props.onScrollBeginDrag());
  const mobileReply={version:1,first:1,answer:8},answer={id:8,kind:'pi.assistant',byTaskId:99,mobileReply,model:[{role:'assistant',content:[{type:'text',text:'Here is the report.'}]}]};
  await publish([owner,upload,{...file,mobileReply},source,result,answer],{});
  const finalRow=activeRoot(tree).findByProps({testID:'history-entry-8'});expect(finalRow).toBe(liveRow);
  expect(activeRoot(tree).findByProps({testID:'history-entry-3'})).toBe(fileRow);expect(fileRow.findByType(require('../components/file-attachment').FileAttachment).props.artifact.name).toBe('report.txt');
  expect(list.props.data.filter((entry:any)=>!entry.inlineSurfaceId).map((entry:any)=>entry.id)).toEqual([3,8,4,2,1]);expect(activeRoot(tree).findByType(InlineSurface)).toBe(visual);expect(list.props.data[0].inlineSurfaceId).toBe(surface.id);expect(activeRoot(tree).findByProps({testID:'history-entry-2'})).toBeDefined();
  act(()=>list.props.onContentSizeChange(337,1800));expect(scroll).not.toHaveBeenCalled();
  expect(activeRoot(tree).findByProps({accessibilityLabel:'Message draft'})).toBe(draft);expect(draft.props.value).toBe('Keep my draft');
  const later={id:10,kind:'pi.assistant',byTaskId:101,mobileReply:{version:1,first:9,answer:10},model:[{role:'assistant',content:'Different reply'}]};
  await publish([owner,upload,{...file,mobileReply},source,result,answer,{id:9,kind:'bob.user',data:{text:'Next question'}},later],{});
  expect(list.props.data.filter((entry:any)=>!entry.inlineSurfaceId).map((entry:any)=>entry.id)).toEqual([10,9,3,8,4,2,1]);expect(activeRoot(tree).findByType(InlineSurface)).toBe(visual);expect(list.props.data[2].inlineSurfaceId).toBe(surface.id);expect(activeRoot(tree).findByProps({testID:'history-entry-3'})).toBe(fileRow);
 }finally{await act(async()=>tree.unmount());}
});

test('inline tree controls complete the session lifecycle without a management screen or draft switch',async()=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'fixture'});NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={};
 let meta={title:'Manage me',pinned:false,archived:false,trashed:false};const mutations:string[]=[];
 const response=(data:unknown)=>({ok:true,status:200,json:async()=>data}) as Response;
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any,options?:any)=>{
  const url=String(input),method=options?.method??'GET';
  if(url.includes('/chats/8')&&method!=='GET'){mutations.push(method);meta=method==='DELETE'?{...meta,trashed:true}:{...meta,...JSON.parse(options.body)};return response({id:8,meta});}
  if(url.includes('/agent-overview')){const filter=new URL(url).searchParams.get('filter');const include=filter==='trash'?meta.trashed:filter==='archived'?meta.archived&&!meta.trashed:!meta.archived&&!meta.trashed;return response({backendId:backend.backendId,sessions:include?[{conversationId:8,status:'idle',agents:[],...meta}]:[]});}
  return response(url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[]}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Current'}},{id:8,meta}]}:url.endsWith('/updates')?{enabled:false}:url.endsWith('/peers')?{inbound:[],outbound:[]}:{});
 });
 const alert=jest.spyOn(Alert,'alert').mockImplementation(()=>{});let tree!:Renderer.ReactTestRenderer;
 const press=async(label:string)=>act(async()=>{const owner=tree.root.findAllByProps({testID:'overlay-active'})[0]??activeRoot(tree);owner.findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0].props.onPress();});
 const filter=async(value:string)=>{const trigger=activeRoot(tree).findAll(node=>String(node.props.accessibilityLabel??'').startsWith('Session filter:')&&typeof node.props.onPress==='function')[0];await act(async()=>trigger.props.onPress());const label=value==='all'?'Active':value==='trash'?'Trash':'Archived';await act(async()=>tree.root.findByProps({testID:'overlay-active'}).findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0].props.onPress());};
 try{
  await act(async()=>{tree=Renderer.create(<App/>);});const draft=activeRoot(tree).findByProps({accessibilityLabel:'Message draft'});act(()=>draft.props.onChangeText('Keep this draft'));const list=activeRoot(tree).findByProps({testID:'chat-history-list'});
  await navigateTo(tree,'Agents');expect(activeRoot(tree).findAllByType(SideDrawer)).toHaveLength(0);expect(activeRoot(tree).findAllByProps({accessibilityLabel:'Manage sessions'})).toHaveLength(0);
  await press('Session controls for Manage me');expect(activeRoot(tree).findByProps({testID:'agent-screen-content'}).props.importantForAccessibility).toBe('no-hide-descendants');await press('Rename');act(()=>tree.root.findByProps({testID:'overlay-active'}).findByProps({accessibilityLabel:'Conversation name'}).props.onChangeText('Renamed'));
  await press('Save conversation name');expect(activeRoot(tree).findByProps({accessibilityLabel:'Open Bob session Renamed'})).toBeDefined();
  await press('Session controls for Renamed');await press('Pin to top');expect(meta.pinned).toBe(true);
  await press('Session controls for Renamed');await press('Archive');expect(activeRoot(tree).findAllByProps({accessibilityLabel:'Open Bob session Renamed'})).toHaveLength(0);
  await filter('archived');await press('Session controls for Renamed');await press('Unarchive');expect(meta.archived).toBe(false);
  await filter('all');await press('Session controls for Renamed');await press('Delete');expect(alert).toHaveBeenCalled();await act(async()=>alert.mock.calls.at(-1)![2]!.find(item=>item.text==='Move to Trash')!.onPress?.());
  expect(meta.trashed).toBe(true);await filter('trash');await press('Session controls for Renamed');await press('Restore conversation');expect(meta.trashed).toBe(false);
  await filter('all');expect(activeRoot(tree).findByProps({accessibilityLabel:'Open Bob session Renamed'})).toBeDefined();expect(mutations).toEqual(['PUT','PUT','PUT','PUT','DELETE','PUT']);
  expect(activeRoot(tree).findByProps({accessibilityLabel:'Message draft'})).toBe(draft);expect(draft.props.value).toBe('Keep this draft');expect(activeRoot(tree).findByProps({testID:'chat-history-list'})).toBe(list);
 }finally{if(tree)await act(async()=>tree.unmount());}
});

test.each(['create','refresh'])('New prevents duplicate creation and stale navigation after workstation switch (%s)',async(stage)=>{
 const a={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://a.test',name:'A'},b={backendId:'22222222-2222-4222-8222-222222222222',endpoint:'https://b.test',name:'B'};
 await AsyncStorage.setItem('backends',JSON.stringify([a,b]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:a.backendId,chat:7}));(Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'fixture'});NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={};
 let finish!:(result:Response)=>void,posted=false,posts=0;const response=(data:unknown)=>({ok:true,status:200,json:async()=>data}) as Response;
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any,options?:any)=>{
  const url=String(input),backend=url.startsWith(a.endpoint)?a:b;
  if(url===a.endpoint+'/v1/chats'&&options?.method==='POST'){posts++;posted=true;if(stage==='create')return new Promise(resolve=>{finish=resolve;});return response({id:10});}
  if(stage==='refresh'&&posted&&url===a.endpoint+'/v1/chats'&&options?.method==='GET')return new Promise(resolve=>{finish=resolve;});
  return response(url.includes('/agent-overview')?{backendId:backend.backendId,sessions:[]}:url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[]}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Current'}}]}:url.endsWith('/updates')?{enabled:false}:url.endsWith('/peers')?{inbound:[],outbound:[]}:{});
 });
 let tree!:Renderer.ReactTestRenderer;
 try{
  await act(async()=>{tree=Renderer.create(<App/>);});await navigateTo(tree,'Agents');const onPress=activeRoot(tree).findAll(node=>node.props.accessibilityLabel==='New session'&&typeof node.props.onPress==='function')[0].props.onPress;
  await act(async()=>{onPress();onPress();});expect(posts).toBe(1);expect(finish).toBeDefined();
  await navigateTo(tree,'Workstations');await act(async()=>activeRoot(tree).findByType(SideDrawer).props.workspaces.find((row:any)=>row.id===b.backendId).onPress());expect(activeRoot(tree).findByType(AgentsScreen).props.visible).toBe(true);
  await act(async()=>finish(response(stage==='create'?{id:10}:{items:[]})));expect(activeRoot(tree).findByType(AgentsScreen).props.visible).toBe(true);expect(activeRoot(tree).findByType(AgentsScreen).props.workstation).toBe('B');expect(posts).toBe(1);
 }finally{if(tree)await act(async()=>tree.unmount());}
});

test('real Menu → Terminal embeds directly, reserves IME once and returns to the same draft/list',async()=>{
 jest.replaceProperty(Platform,'OS','android');(AppState as any).currentState='active';
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={};
 const native={capabilities:jest.fn(async()=>({available:true})),prepare:jest.fn(async()=> 'terminal-handle'),releasePrepared:jest.fn(async()=>{})};NativeModules.BobTerminal=native;
 const connection={sessionId:'session-1',host:'100.64.0.1',port:60020,key:'abcdefghijklmnopqrstuv',cwd:'/tmp/project'};
 const calls:{url:string;method:string}[]=[];
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any,options:any)=>{
  const url=String(input),method=options?.method??'GET';calls.push({url,method});
  const data=url.endsWith('/terminal')?(method==='POST'?connection:{available:true,cwd:'/tmp/project'}):url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[{id:1,kind:'bob.user',data:{text:'Preserved history'}}]}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Long unrelated conversation title'}}]}:url.endsWith('/updates')?{enabled:false}:[];
  return {ok:true,status:200,json:async()=>data} as Response;
 });
 let tree!:Renderer.ReactTestRenderer;
 try{
  await act(async()=>{tree=Renderer.create(<App/>);});
  const draft=activeRoot(tree).findByProps({accessibilityLabel:'Message draft'}),list=activeRoot(tree).findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0];
  await act(async()=>draft.props.onChangeText('Unsent draft stays here'));
  expect(native.prepare).not.toHaveBeenCalled();
  await navigateTo(tree,'Terminal');
  const screen=activeRoot(tree).findAllByProps({testID:'terminal-screen'})[0],view=activeRoot(tree).findAllByProps({testID:'embedded-terminal'})[0];
  expect(view.props.session).toBe('terminal-handle');expect(native.prepare).toHaveBeenCalledTimes(1);
  expect(calls.filter(call=>call.url.endsWith('/terminal')&&call.method==='POST')).toHaveLength(1);
  await act(async()=>{view.props.onState({nativeEvent:{session:'terminal-handle',phase:'running'}});DeviceEventEmitter.emit('BobKeyboardInset',{imeBottom:280});});
  expect(StyleSheet.flatten(screen.props.style).bottom).toBe(280);
  expect(activeRoot(tree).findAllByProps({testID:'embedded-terminal'})[0]).toBe(view);
  await navigateTo(tree,'Chat');
  expect(activeRoot(tree).findAllByProps({testID:'embedded-terminal'})).toHaveLength(0);expect(native.releasePrepared).toHaveBeenCalledWith('terminal-handle');
  expect(calls.filter(call=>call.url.endsWith('/terminal')&&call.method==='DELETE')).toHaveLength(0);
  expect(activeRoot(tree).findByProps({accessibilityLabel:'Message draft'})).toBe(draft);expect(draft.props.value).toBe('Unsent draft stays here');
  expect(activeRoot(tree).findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0]).toBe(list);
 }finally{if(tree)await act(async()=>tree.unmount());delete NativeModules.BobTerminal;}
});

test('sent image decks preserve their row, draft and selected image; original preview/save actions remain correctly scoped',async()=>{
 const {AccessibilityInfo}=require('react-native');jest.spyOn(AccessibilityInfo,'isReduceMotionEnabled').mockResolvedValue(true);
 const {ImageAttachments}=require('../components/image-attachments'),{ImageAttachmentStack}=require('../components/image-attachment-stack'),{AttachmentDetails}=require('../components/attachment-details');
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={preview:jest.fn(async()=>{}),save:jest.fn(async()=>{})};delete NativeModules.BobOutbox;
 const photo=(id:number,kind='bob.artifact')=>({id,kind,data:{id:`a841d08a-8b83-42cd-b8a7-${String(id).padStart(12,'0')}`,conversationId:7,name:`photo-${id}.png`,mime:'image/png',size:12,sha256:'a'.repeat(64)}});
 const one=photo(11),two=photo(12),three=photo(13),owner={id:14,kind:'bob.user',data:{text:'Look at my photos'}};
 let snapshot:((event:any)=>void)|undefined;
 require('react-native-sse').mockImplementation(()=>({addEventListener:jest.fn((event,callback)=>{if(event==='snapshot')snapshot=callback;}),close:jest.fn(),open:jest.fn()}));
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{const url=String(input),data=url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[one,two,owner]}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Photos'}}]}:url.endsWith('/updates')?{enabled:false}:url.endsWith('/transfer-limits')?{uploadLimit:1048576}:[];return{ok:true,status:200,json:async()=>data} as Response;});
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<App/>);});
 const publish=async(entries:any[])=>act(async()=>snapshot!({data:JSON.stringify({backendId:backend.backendId,conversationId:7,view:{entries,docs:{'pi.live':{}}}})}));
 try{
  const list=activeRoot(tree).findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0],draft=activeRoot(tree).findByProps({accessibilityLabel:'Message draft'});
  const row=activeRoot(tree).findByProps({testID:'history-entry-11'}),group=row.findByType(ImageAttachments),deck=row.findByType(ImageAttachmentStack);
  expect(group.props.fromBob).toBe(false);expect(deck.props.images).toHaveLength(2);expect(deck.props.onSave).toBeUndefined();expect(activeRoot(tree).findAllByProps({testID:'history-entry-12'})).toHaveLength(0);
  expect(StyleSheet.flatten(row.findByType(ChatBubble).props.style).width).toBe('100%');
  act(()=>{draft.props.onChangeText('Keep my draft');list.props.onScrollBeginDrag();});
  await act(async()=>deck.findByProps({accessibilityLabel:'Next image'}).props.onPress());
  expect(deck.findByProps({testID:'image-stack-front'}).props.accessibilityValue.text).toBe('Image 2 of 2');
  await publish([one,two,three,owner]);
  expect(activeRoot(tree).findByProps({testID:'history-entry-11'})).toBe(row);expect(row.findByType(ImageAttachmentStack)).toBe(deck);expect(deck.findByProps({testID:'image-stack-front'}).props.accessibilityValue.text).toBe('Image 2 of 3');
  await act(async()=>deck.findByProps({accessibilityLabel:'Attachment details: photo-12.png'}).props.onPress());
  expect(activeRoot(tree).findByType(AttachmentDetails).props.artifact.id).toBe(two.data.id);expect(NativeModules.BobFiles.preview).not.toHaveBeenCalled();
  await act(async()=>activeRoot(tree).findByType(AttachmentDetails).props.onClose());
  await act(async()=>deck.findByProps({accessibilityLabel:'Open photo-12.png'}).props.onPress());
  expect(NativeModules.BobFiles.preview).toHaveBeenCalledWith(`${backend.endpoint}/v1/chats/7/artifacts/${two.data.id}`,'test-token',backend.backendId,'image/png',1048576);
  const earlier=photo(10);await publish([earlier,one,two,three,owner]);
  expect(activeRoot(tree).findByProps({testID:'history-entry-11'})).toBe(row);expect(row.findByType(ImageAttachmentStack)).toBe(deck);expect(deck.findByProps({testID:'image-stack-front'}).props.accessibilityValue.text).toBe('Image 3 of 4');
  const a=photo(15,'bob.file'),b=photo(16,'bob.file'),answer={id:17,kind:'pi.assistant',byTaskId:99,mobileReply:{version:1,first:14,answer:17},model:[{role:'assistant',content:'Here are your edited pictures.'}]};
  await publish([earlier,one,two,three,owner,a,b,answer]);
  expect(list.props.data.map((entry:any)=>entry.id)).toEqual([15,17,14,11]);
  const output=activeRoot(tree).findByProps({testID:'history-entry-15'}).findByType(ImageAttachmentStack);
  expect(output.props.images).toHaveLength(2);expect(typeof output.props.onSave).toBe('function');
  await act(async()=>output.findByProps({accessibilityLabel:'Next image'}).props.onPress());
  await act(async()=>output.findByProps({accessibilityLabel:'Save photo-16.png'}).props.onPress());
  expect(NativeModules.BobFiles.save).toHaveBeenCalledWith(`${backend.endpoint}/v1/chats/7/artifacts/${b.data.id}`,'test-token',backend.backendId,'photo-16.png','image/png',1048576);
  expect(row.findByType(ImageAttachmentStack)).toBe(deck);expect(activeRoot(tree).findByProps({accessibilityLabel:'Message draft'})).toBe(draft);expect(draft.props.value).toBe('Keep my draft');
 }finally{await act(async()=>tree.unmount());}
});

describe('optional chat-list cache and child stream regressions',()=>{
 beforeEach(()=>{(AsyncStorage.setItem as jest.Mock).mockClear();});
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 const rows=[{id:7,meta:{title:'Authoritative chat'}}];
 const response=(data:any)=>({ok:true,status:200,json:async()=>data} as Response);
 async function paired(backends=[backend]){
  await AsyncStorage.setItem('backends',JSON.stringify(backends));
  await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
  (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'test-token'});
  NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};
  NativeModules.BobNotifications={};NativeModules.BobFiles={};delete NativeModules.BobOutbox;
 }
 function fallback(url:string){
  return response(url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[{id:1,kind:'bob.user',data:{text:'Parent history'}}]}:url.endsWith('/updates')?{enabled:false}:url.endsWith('/configure')?{}:[]);
 }
 function streams(){
  const sources:{url:string;listeners:Map<string,(event:any)=>void>;close:jest.Mock}[]=[];
  require('react-native-sse').mockImplementation((url:string)=>{
   const source={url,listeners:new Map<string,(event:any)=>void>(),close:jest.fn()};sources.push(source);
   return{close:source.close,addEventListener:(event:string,callback:(event:any)=>void)=>source.listeners.set(event,callback)};
  });
  return{sources,latest:(id:number)=>sources.filter(source=>source.url===`${backend.endpoint}/v1/chats/${id}/events?heartbeats=1&patches=1`).slice(-1)[0]};
 }
 test.each([
  ['rejected read',undefined],['malformed JSON','{'],['object','{}'],['null','null'],['string','"cache"'],
  ['null row','[null]'],['invalid id','[{"id":"7"}]'],['nonpositive id','[{"id":0}]'],
  ['invalid metadata','[{"id":7,"meta":{"title":42}}]'],['invalid flag','[{"id":7,"meta":{"title":"Bad","pinned":"yes"}}]'],
  ['invalid owner','[{"id":7,"owner":{"conversationId":0}}]'],
 ])('chat-list cache %s cannot prevent the authoritative fetch',async(_label,cached)=>{
  await paired();
  const key=`chats:${backend.backendId}`,get=(AsyncStorage.getItem as jest.Mock).getMockImplementation()!;
  if(cached!==undefined)await AsyncStorage.setItem(key,cached);
  (AsyncStorage.getItem as jest.Mock).mockImplementation((name:string)=>name===key&&cached===undefined?Promise.reject(Error('cache unavailable')):get(name));
  const network=jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>String(input).endsWith('/chats')?response({items:rows}):fallback(String(input)));
  streams();let tree!:Renderer.ReactTestRenderer;
  try{
   await act(async()=>{tree=Renderer.create(<App/>);});
   expect(network.mock.calls.some(([url])=>String(url)===`${backend.endpoint}/v1/chats`)).toBe(true);
   expect(JSON.parse((await readChatListCache(key))!)).toEqual(rows);
   expect(activeRoot(tree).findByProps({accessibilityLabel:'Message draft'}).props.editable).toBe(true);
  }finally{if(tree)await act(async()=>tree.unmount());(AsyncStorage.getItem as jest.Mock).mockImplementation(get);}
 });
 test('valid chat-list cache is parsed once and retains restrictive profile evidence on refresh',async()=>{
  await paired();const key=`chats:${backend.backendId}`;
  const cached=JSON.stringify([{id:7,meta:{title:'Old title',profile:{id:'restricted-local',immutable:true}},owner:{conversationId:3,taskId:4}}]);
  await AsyncStorage.setItem(key,cached);
  const parse=jest.spyOn(JSON,'parse');
  jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>String(input).endsWith('/chats')?response({items:rows}):fallback(String(input)));
  streams();let tree!:Renderer.ReactTestRenderer;
  try{
   await act(async()=>{tree=Renderer.create(<App/>);});
   expect(parse.mock.calls.filter(([value])=>value===cached)).toHaveLength(1);
   expect(JSON.parse((await readChatListCache(key))!)[0].meta).toMatchObject({title:'Authoritative chat',profile:{id:'restricted-local'}});
   expect(activeRoot(tree).findByProps({testID:'read-only-conversation'})).toBeDefined();
  }finally{if(tree)await act(async()=>tree.unmount());}
 });
 test('chat-list cache write failure does not turn a connected successful fetch offline',async()=>{
  await paired();const key=`chats:${backend.backendId}`,set=(AsyncStorage.setItem as jest.Mock).getMockImplementation()!;
  (AsyncStorage.setItem as jest.Mock).mockImplementation((name:string,value:string)=>name===`chunked:${key}`?Promise.reject(Error('cache full')):set(name,value));
  let release!:(value:Response)=>void;
  jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>String(input).endsWith('/chats')?new Promise(resolve=>{release=resolve;}):fallback(String(input)));
  const source=streams();let tree!:Renderer.ReactTestRenderer;
  try{
   await act(async()=>{tree=Renderer.create(<App/>);});
   await act(async()=>source.latest(7).listeners.get('snapshot')!({data:JSON.stringify({backendId:backend.backendId,conversationId:7,view:{entries:[{id:1,kind:'bob.user',data:{text:'Parent history'}}],docs:{}}})}));
   const quiet=()=>expect(activeRoot(tree).findAllByProps({testID:'connection-status'})).toHaveLength(0);
   quiet();
   await act(async()=>release(response({items:rows})));
   quiet();
   expect(AsyncStorage.setItem).toHaveBeenCalledWith(`chunked:${key}`,expect.any(String));
   expect(await readChatListCache(key)).toBeUndefined();
   expect(activeRoot(tree).findByProps({accessibilityLabel:'Message draft'}).props.editable).toBe(true);
  }finally{if(tree)await act(async()=>tree.unmount());(AsyncStorage.setItem as jest.Mock).mockImplementation(set);}
 });
 test.each(['clear','disable'] as const)('a chat-list response admitted before %s updates the view without restoring cleared disk data',async(action)=>{
  await paired();let release!:(value:Response)=>void;
  jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>String(input).endsWith('/chats')?new Promise(resolve=>{release=resolve;}):fallback(String(input)));
  streams();let tree!:Renderer.ReactTestRenderer;
  try{
   await act(async()=>{tree=Renderer.create(<App/>);});
   await act(async()=>{if(action==='clear')await clearDownloadedCache('chatLists');else await updateCachePreferences({chatLists:false});});
   await act(async()=>release(response({items:rows})));
   expect(await readChatListCache(`chats:${backend.backendId}`)).toBeUndefined();
   expect((await AsyncStorage.getAllKeys()).filter(key=>key===`chats:${backend.backendId}`||key.startsWith(`chunked:chats:${backend.backendId}`))).toEqual([]);
   expect(activeRoot(tree).findByProps({accessibilityLabel:'Message draft'}).props.editable).toBe(true);
  }finally{if(tree)await act(async()=>tree.unmount());await updateCachePreferences({...DEFAULT_CACHE_PREFERENCES});}
 });
 test.each(['read','network'])('late chat-list cache %s cannot cross workstation scope',async(stage)=>{
  const other={backendId:'22222222-2222-4222-8222-222222222222',endpoint:'https://other.ts.net',name:'Other'};
  await paired([backend,other]);const oldKey=`chats:${backend.backendId}`,get=(AsyncStorage.getItem as jest.Mock).getMockImplementation()!;
  let releaseRead!:(value:string)=>void,releaseNetwork!:(value:Response)=>void;
  if(stage==='read')(AsyncStorage.getItem as jest.Mock).mockImplementation((key:string)=>key===oldKey?new Promise(resolve=>{releaseRead=resolve;}):get(key));
  const network=jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{
   const url=String(input);
   if(url===`${backend.endpoint}/v1/chats`)return new Promise(resolve=>{releaseNetwork=resolve;});
   if(url===`${other.endpoint}/v1/chats`)return response({items:[{id:27,meta:{title:'Other chat'}}]});
   return fallback(url);
  });
  streams();let tree!:Renderer.ReactTestRenderer;
  try{
   await act(async()=>{tree=Renderer.create(<App/>);});
   (NativeModules.BobPlatform.takeNotificationTarget as jest.Mock).mockResolvedValue({backendId:other.backendId,screen:'updates'});
   await act(async()=>DeviceEventEmitter.emit('BobNotificationOpen'));
   await act(async()=>stage==='read'?releaseRead(JSON.stringify([{id:7,meta:{title:'Late cached chat'}}])):releaseNetwork(response({items:rows})));
   if(stage==='read')await act(async()=>releaseNetwork(response({items:rows})));
   expect(JSON.parse((await readChatListCache(`chats:${other.backendId}`))!)).toEqual([{id:27,meta:{title:'Other chat'}}]);
   // A hidden retained owner may finish its own read/cache, never the selected workstation's.
   expect(JSON.parse((await readChatListCache(oldKey))!)).toEqual(rows);
   expect((AsyncStorage.setItem as jest.Mock).mock.calls.filter(([key])=>key===`chunked:${oldKey}`)).toHaveLength(1);
   expect(network.mock.calls.filter(([url])=>String(url)===`${backend.endpoint}/v1/chats`)).toHaveLength(1);
   expect(activeRoot(tree).findAllByProps({testID:'history-entry-1'})).toHaveLength(0);
  }finally{if(tree)await act(async()=>tree.unmount());(AsyncStorage.getItem as jest.Mock).mockImplementation(get);}
 });
 test('child duplicates avoid parsing and persistence, recover reconnect status, and reset when switching children',async()=>{
  jest.useFakeTimers();jest.replaceProperty(AppState,'currentState','active');
  const lifecycle=new Set<(state:any)=>void>();
  jest.spyOn(AppState,'addEventListener').mockImplementation((event,callback)=>{if(event==='change')lifecycle.add(callback as any);return{remove:()=>{lifecycle.delete(callback as any);}};});
  const transition=async(state:'background'|'active')=>act(async()=>{(AppState as any).currentState=state;for(const callback of lifecycle)callback(state);});
  const advance=async(ms:number)=>act(async()=>{await jest.advanceTimersByTimeAsync(ms);});
  await paired();const source=streams();
  jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{
   const url=String(input);
   return url.includes('/agent-overview')?response({backendId:backend.backendId,sessions:[{conversationId:7,title:'Test chat',status:'working',agents:[{name:'First helper',conversationId:8,status:'working'},{name:'Second helper',conversationId:9,status:'idle'}]}]}):url.endsWith('/chats')?response({items:rows}):fallback(url);
  });
  const parse=jest.spyOn(JSON,'parse'),key=`history:${backend.backendId}:8`;
  const writes=()=> (AsyncStorage.setItem as jest.Mock).mock.calls.filter(([name])=>name===`chunked:${key}`);
  const publish=async(id:number,raw:string)=>act(async()=>source.latest(id).listeners.get('snapshot')!({data:raw}));
  const frame=(id:number,view:any)=>JSON.stringify({backendId:backend.backendId,conversationId:id,view});
  let tree!:Renderer.ReactTestRenderer;
  try{
   await act(async()=>{tree=Renderer.create(<App/>);});
   await navigateTo(tree,'Agents');

   await act(async()=>activeRoot(tree).findByProps({accessibilityLabel:'View agent First helper'}).props.onPress());
   let expectedWrites=0;
   for(const [status,docs,work] of [
    ['Child working',{'pi.live':{run:{taskId:10}}},[]],
    ['Child blocked',{},[{state:'blocked',background:false}]],
    ['Child idle',{},[]],
   ] as const){
    const raw=frame(8,{entries:[{id:10,kind:'bob.user',data:{text:status}}],docs,work});
    await publish(8,raw);await advance(1100);
    expect(writes()).toHaveLength(++expectedWrites);
    expect(activeRoot(tree).findByType(AgentsScreen).props.status).toBe(status);
    await publish(8,raw);await advance(1100);await publish(8,raw);
    expect(writes()).toHaveLength(expectedWrites);
    expect(parse.mock.calls.filter(([value])=>value===raw)).toHaveLength(1);
    const previous=source.latest(8);
    await transition('background');await transition('active');
    expect(previous.close).toHaveBeenCalled();expect(source.latest(8)).not.toBe(previous);
    expect(activeRoot(tree).findByType(AgentsScreen).props.status).toBe('Reconnecting');
    await publish(8,raw);
    expect(activeRoot(tree).findByType(AgentsScreen).props.status).toBe(status);
    expect(writes()).toHaveLength(expectedWrites);
    expect(parse.mock.calls.filter(([value])=>value===raw)).toHaveLength(1);
   }
   const final={entries:[{id:11,kind:'bob.user',data:{text:'Final child answer'}}],docs:{},work:[]},raw=frame(8,final);
   await publish(8,raw);
   // Settled snapshots flush immediately, without waiting for the live cadence.
   expect(writes()).toHaveLength(++expectedWrites);
   const {readHistoryCache}=require('../history-cache');
   expect(JSON.parse(await readHistoryCache(key))).toEqual(final);
   const old=source.latest(8);
   // Duplicate frames still reach snapshotStream's diagnostics and liveness accounting.
   const diagnostic=jest.spyOn(require('../stream-diagnostics'),'noteSnapshot');
   for(let i=0;i<2;i++){await advance(9000);await publish(8,raw);}
   expect(source.latest(8)).toBe(old);expect(old.close).not.toHaveBeenCalled();
   expect(diagnostic).toHaveBeenCalledTimes(2);expect(writes()).toHaveLength(expectedWrites);
   await act(async()=>activeRoot(tree).findByProps({accessibilityLabel:'Back to agent list'}).props.onPress());
   await act(async()=>activeRoot(tree).findByProps({accessibilityLabel:'View agent Second helper'}).props.onPress());
   await publish(9,frame(9,{entries:[],docs:{},work:[]}));
   expect(activeRoot(tree).findByType(AgentsScreen).props.status).toBe('Child idle');
   await act(async()=>old.listeners.get('snapshot')!({data:frame(8,{entries:[],docs:{},work:[]})}));
   expect(writes()).toHaveLength(expectedWrites);
   await act(async()=>activeRoot(tree).findByProps({accessibilityLabel:'Back to agent list'}).props.onPress());
   await act(async()=>activeRoot(tree).findByProps({accessibilityLabel:'View agent First helper'}).props.onPress());
   await publish(8,raw);
   expect(writes()).toHaveLength(++expectedWrites);
   // This exact payload was accepted by the previous child subscription as well.
   expect(parse.mock.calls.filter(([value])=>value===raw)).toHaveLength(2);
   expect(activeRoot(tree).findByType(AgentsScreen).props.status).toBe('Child idle');
  }finally{if(tree)await act(async()=>tree.unmount());jest.useRealTimers();}
 });
});

test.each(['receipt','receipt-with-file','restore','upload'])('foreground delivery checks the actual credential after pairing changes during %s',async(changeAt)=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://identity.test.ts.net',name:'Identity'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 let device='old';(Keychain.getGenericPassword as jest.Mock).mockImplementation(async()=>({username:device,password:`token-${device}`}));
 delete NativeModules.BobOutbox;NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};
 NativeModules.BobFiles={restoreAttachment:jest.fn(async()=>{if(changeAt==='restore')device='new';}),uploadAttachment:jest.fn(async()=>{if(changeAt==='upload')device='new';})};
 const files=changeAt==='receipt'?[]:[{id:'file',uri:'file:///draft',name:'file.txt',mime:'text/plain'}];
 await AsyncStorage.setItem('message-outbox:v1',JSON.stringify([{id:'identity-race',scope:`${backend.backendId}:7`,backend,chat:7,localId:-1,foregroundOnly:true,foregroundUnsent:true,files,message:{requestId:'identity-race',text:'Only once',mode:'steer',allowSubagents:true}}]));
 const requests:{url:string;authorization:string}[]=[];
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any,options:any)=>{
  const url=String(input);requests.push({url,authorization:options?.headers?.Authorization});
  let data:any=[];
  if(url.includes('/operations/')){const persisted=(await readOutbox())[0] as any;expect(persisted.foregroundDeviceId).toBe('old');expect(JSON.stringify(persisted)).not.toContain('token-');if(changeAt.startsWith('receipt'))device='new';data={admission:null};}
  else if(url.endsWith('/transfer-limits'))data={uploadLimit:1024};
  else if(url.includes('/history'))data={backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[]};
  else if(url.endsWith('/chats'))data={items:[{id:7,meta:{title:'Identity'}}]};
  else if(url.endsWith('/updates'))data={enabled:false};
  return {ok:true,status:200,json:async()=>data} as Response;
 });
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<App/>);});
 try{
  expect(requests.filter(request=>request.url.endsWith('/messages'))).toEqual([]);
  expect((await readOutbox())[0]).toMatchObject({foregroundDeviceId:'old',rejected:true,uncertain:true});
  if(changeAt==='restore')expect(NativeModules.BobFiles.uploadAttachment).not.toHaveBeenCalled();
  if(changeAt==='upload')expect(NativeModules.BobFiles.uploadAttachment.mock.calls[0][2]).toBe('token-old');
  await act(async()=>activeRoot(tree).findAll(node=>node.props.accessibilityLabel==='Check delivery'&&typeof node.props.onPress==='function')[0].props.onPress());
  expect(requests.filter(request=>request.url.endsWith('/messages'))).toEqual([]);
  expect((await readOutbox())[0]).toMatchObject({foregroundDeviceId:'old',uncertain:true});
 }finally{await act(async()=>tree.unmount());}
});

test('mounted native recovery and barrier subscription resume after a transient first outbox read failure',async()=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://readiness.test.ts.net',name:'Readiness'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 const saved={id:'blocked-file',scope:`${backend.backendId}:7`,backend,chat:7,localId:-1,foregroundOnly:true,rejected:true,files:[],message:{requestId:'blocked-file',text:'Preserve barrier',mode:'steer',allowSubagents:true}};
 await AsyncStorage.setItem('message-outbox:v1',JSON.stringify([saved]));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'device',password:'token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={};
 const recovered={...saved,id:'native-reply',foregroundOnly:false,notificationReply:true,rejected:false,message:{...saved.message,requestId:'native-reply'}};
 const native={list:jest.fn(async()=>[JSON.stringify(recovered)]),enqueue:jest.fn(async()=>{}),status:jest.fn(async()=>JSON.stringify({state:'pending'})),setNotificationReplyBarriers:jest.fn(async()=>{})};NativeModules.BobOutbox=native;
 const read=(AsyncStorage.getItem as jest.Mock).getMockImplementation()!;let blocked=true;
 jest.spyOn(AsyncStorage,'getItem').mockImplementation(async key=>{if(blocked&&key==='message-outbox:v2')throw Error('Storage temporarily busy');return read(key);});
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{const url=String(input),data=url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[]}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Readiness'}}]}:url.endsWith('/updates')?{enabled:false}:[];return{ok:true,status:200,json:async()=>data} as Response;});
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<App/>);});
 try{
  expect(native.list).not.toHaveBeenCalled();expect(native.setNotificationReplyBarriers).not.toHaveBeenCalled();
  blocked=false;await act(async()=>DeviceEventEmitter.emit('BobOutboxChanged'));
  expect((await readOutbox()).filter((value:any)=>value.id==='native-reply')).toHaveLength(1);
  expect(native.setNotificationReplyBarriers).toHaveBeenCalledWith(backend.backendId,[7]);
  await act(async()=>DeviceEventEmitter.emit('BobOutboxChanged'));
  expect((await readOutbox()).filter((value:any)=>value.id==='native-reply')).toHaveLength(1);
 }finally{await act(async()=>tree.unmount());delete NativeModules.BobOutbox;}
});

test('retrying an earlier attachment during a drain never transfers already-admitted native text to foreground after re-pair',async()=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://ownership.test.ts.net',name:'Ownership'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 const earlier={id:'earlier-file',scope:`${backend.backendId}:7`,backend,chat:7,localId:-1,foregroundOnly:true,foregroundUnsent:true,rejected:true,files:[{id:'file',uri:'file:///draft',name:'file.txt',mime:'text/plain'}],message:{requestId:'earlier-file',text:'Earlier file',mode:'steer',allowSubagents:true}};
 await AsyncStorage.setItem('message-outbox:v1',JSON.stringify([earlier]));
 let device='old',nativeSettled=false;
 (Keychain.getGenericPassword as jest.Mock).mockImplementation(async()=>({username:device,password:`token-${device}`}));
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};
 NativeModules.BobFiles={restoreAttachment:jest.fn(async()=>{}),uploadAttachment:jest.fn(async()=>{}),removeAttachment:jest.fn(async()=>{})};
 const admissions=new Set<string>(),nativeItems:any[]=[];
 const native={enqueue:jest.fn(async(_endpoint,_backend,token,_chat,id,_message,_files,envelope)=>{admissions.add(`${token}:${id}`);nativeItems.push(JSON.parse(envelope));}),status:jest.fn(async()=>JSON.stringify(nativeSettled?{state:'admitted',admission:{status:'placed',entry:43}}:{state:'pending'})),list:jest.fn(async()=>[])};NativeModules.BobOutbox=native;
 const lifecycle=new Set<(state:any)=>void>();
 jest.spyOn(AppState,'addEventListener').mockImplementation((event,callback)=>{if(event==='change')lifecycle.add(callback as any);return{remove:()=>{lifecycle.delete(callback as any);}};});
 const foregroundPosts:string[]=[];
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any,options:any)=>{
  const url=String(input);let data:any=[];
  if(url.endsWith('/messages')){const id=JSON.parse(options.body).requestId;foregroundPosts.push(id);admissions.add(`${options.headers.Authorization.replace('Bearer ','')}:${id}`);data={status:'placed',entry:42};}
  else if(url.includes('/operations/'))data={admission:null};
  else if(url.endsWith('/transfer-limits'))data={uploadLimit:1024};
  else if(url.includes('/history'))data={backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[]};
  else if(url.endsWith('/chats'))data={items:[{id:7,meta:{title:'Ownership'}}]};
  else if(url.endsWith('/updates'))data={enabled:false};
  return{ok:true,status:200,json:async()=>data} as Response;
 });
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<App/>);});
 const saved=MessageOutbox.prototype.saved;let saves=0,release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 jest.spyOn(MessageOutbox.prototype,'saved').mockImplementation(async function(this:MessageOutbox){await saved.call(this);if(++saves===2)await gate;});
 try{
  act(()=>activeRoot(tree).findByProps({accessibilityLabel:'Message draft'}).props.onChangeText('Native text'));
  await act(async()=>activeRoot(tree).findByProps({accessibilityLabel:'Send message'}).props.onPress());
  expect(saves).toBe(2);expect(native.enqueue).toHaveBeenCalledTimes(1);
  const id=nativeItems[0].id;device='new';
  await act(async()=>activeRoot(tree).findAll(node=>node.props.accessibilityLabel==='Retry sending'&&typeof node.props.onPress==='function')[0].props.onPress());
  await act(async()=>release());
  expect(foregroundPosts).toEqual([]);expect([...admissions]).toEqual([`token-old:${id}`]);
  expect(nativeItems[0].foregroundUnsent).not.toBe(true);
  expect((await readOutbox()).find((value:any)=>value.id===id)).not.toHaveProperty('foregroundDeviceId');
  nativeSettled=true;await act(async()=>{for(const callback of lifecycle)callback('active');});
  expect(foregroundPosts).toEqual(['earlier-file']);
  expect((await readOutbox()).find((value:any)=>value.id===id)).toMatchObject({admitted:true,entry:43});
  expect([...admissions].filter(value=>value.endsWith(`:${id}`))).toEqual([`token-old:${id}`]);
 }finally{release();await act(async()=>tree.unmount());delete NativeModules.BobOutbox;}
});

test.each(['unsent','bound'])('restored %s foreground text stays foreground behind an attachment barrier, even with native available and explicit retry',async(state)=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://foreground.test.ts.net',name:'Foreground'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 const base={scope:`${backend.backendId}:7`,backend,chat:7,localId:-1,files:[],message:{requestId:'foreground-text',text:'Foreground text',mode:'steer',allowSubagents:true}};
 const first={...base,id:'attachment',foregroundOnly:true,foregroundUnsent:true,rejected:true,message:{...base.message,requestId:'attachment'},files:[{id:'file',uri:'file:///draft',name:'file.txt',mime:'text/plain'}]};
 const text={...base,id:'foreground-text',localId:-2,rejected:true,...(state==='unsent'?{foregroundUnsent:true}:{foregroundDeviceId:'device'})};
 await AsyncStorage.setItem('message-outbox:v1',JSON.stringify([first,text]));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'device',password:'token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};
 NativeModules.BobFiles={restoreAttachment:jest.fn(async()=>{}),uploadAttachment:jest.fn(async()=>{}),removeAttachment:jest.fn(async()=>{})};
 const native={enqueue:jest.fn(async()=>{}),status:jest.fn(async()=>JSON.stringify({state:'pending'})),list:jest.fn(async()=>[])};NativeModules.BobOutbox=native;
 const lifecycle=new Set<(state:any)=>void>();
 jest.spyOn(AppState,'addEventListener').mockImplementation((event,callback)=>{if(event==='change')lifecycle.add(callback as any);return{remove:()=>{lifecycle.delete(callback as any);}};});
 const posts:string[]=[];let release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any,options:any)=>{
  const url=String(input);let data:any=[];
  if(url.endsWith('/messages')){posts.push(JSON.parse(options.body).requestId);data={status:'placed',entry:posts.length+40};}
  else if(url.includes('/operations/')){if(url.endsWith('/attachment'))await gate;data={admission:null};}
  else if(url.endsWith('/transfer-limits'))data={uploadLimit:1024};
  else if(url.includes('/history'))data={backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[]};
  else if(url.endsWith('/chats'))data={items:[{id:7,meta:{title:'Foreground'}}]};
  else if(url.endsWith('/updates'))data={enabled:false};
  return{ok:true,status:200,json:async()=>data} as Response;
 });
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<App/>);});
 try{
  const retry=(id:string)=>activeRoot(tree).findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0].props.data.find((entry:any)=>entry.data.requestId===id);
  const firstLocalId=retry('attachment').id,textLocalId=retry('foreground-text').id;
  const pressRetry=async(id:number)=>act(async()=>activeRoot(tree).findByProps({testID:`history-entry-${id}`}).findAll(node=>node.props.accessibilityLabel==='Retry sending'&&typeof node.props.onPress==='function')[0].props.onPress());
  await pressRetry(firstLocalId);await pressRetry(textLocalId);
  expect(posts).toEqual([]);expect(native.enqueue).not.toHaveBeenCalled();
  await act(async()=>release());
  expect(posts).toEqual(['attachment']);
  // The text was rejected when the running drain took its snapshot; a later
  // resume/poll must deliver it after the attachment, without native handoff.
  await act(async()=>{for(const callback of lifecycle)callback('active');});
  expect(posts).toEqual(['attachment','foreground-text']);expect(native.enqueue).not.toHaveBeenCalled();
 }finally{release();await act(async()=>tree.unmount());delete NativeModules.BobOutbox;}
});

test('workstation aliases persist locally without changing pairing or the selected session and reach native notification labels',async()=>{
 jest.replaceProperty(Platform,'OS','android');(AppState as any).currentState='active';
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://desktop.ts.net',name:'desktop.long-tailnet.ts.net'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobFiles={};
 const labels=jest.fn(async()=>true),sessions=jest.fn(async()=>true);
 NativeModules.BobNotifications={setWorkstationLabels:labels,setSessionLabels:sessions};
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{const url=String(input),data=url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[]}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Selected session'}}]}:url.endsWith('/updates')?{enabled:false}:[];return{ok:true,status:200,json:async()=>data} as Response;});
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<App/>);});
 try{
  expect(sessions).toHaveBeenCalledWith(backend.backendId,[{id:7,title:'Selected session'}]);
  const draft=activeRoot(tree).findByProps({accessibilityLabel:'Message draft'});act(()=>draft.props.onChangeText('Keep this draft'));
  await navigateTo(tree,'Workstations');
  const edit=activeRoot(tree).findAll(node=>node.props.accessibilityLabel==='Edit alias for desktop'&&typeof node.props.onPress==='function')[0];
  act(()=>edit.props.onPress());act(()=>tree.root.findByProps({testID:'overlay-active'}).findByProps({accessibilityLabel:'Workstation alias'}).props.onChangeText('Desk'));
  await act(async()=>tree.root.findByProps({testID:'overlay-active'}).findAll(node=>node.props.accessibilityLabel==='Save workstation alias'&&typeof node.props.onPress==='function')[0].props.onPress());
  expect(JSON.parse((await AsyncStorage.getItem('backends'))!)).toEqual([{...backend,alias:'Desk'}]);
  expect(labels).toHaveBeenLastCalledWith([{id:backend.backendId,label:'Desk'}]);
  await navigateTo(tree,'Chat');expect(activeRoot(tree).findByProps({accessibilityLabel:'Message draft'})).toBe(draft);expect(draft.props.value).toBe('Keep this draft');
  expect(JSON.parse((await AsyncStorage.getItem('selection'))!)).toMatchObject({backendId:backend.backendId,chat:7});
  expect((fetch as jest.Mock).mock.calls.some(([url])=>String(url).includes('/pair'))).toBe(false);
 }finally{await act(async()=>tree.unmount());}
});

test.each([false,true])('notification routing uses backend UUID, not matching aliases or session numbers (cold: %s)',async(cold)=>{
 const one={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://one.ts.net',name:'one.ts.net',alias:'PC'},two={backendId:'22222222-2222-4222-8222-222222222222',endpoint:'https://two.ts.net',name:'two.ts.net',alias:'PC'};
 await AsyncStorage.setItem('backends',JSON.stringify([one,two]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:one.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'test-token'});
 let notice:any=cold?{backendId:two.backendId,conversationId:7}:null;
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>notice),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={};
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{const url=String(input),data=url.includes('/history')?{backendId:url.startsWith(two.endpoint)?two.backendId:one.backendId,conversationId:7,coverage:'stored-entries',items:[]}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Same session number'}}]}:url.endsWith('/updates')?{enabled:false}:[];return{ok:true,status:200,json:async()=>data} as Response;});
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<App/>);});
 try{
  if(!cold){notice={backendId:two.backendId,conversationId:7};await act(async()=>DeviceEventEmitter.emit('BobNotificationOpen'));}
  expect(JSON.parse((await AsyncStorage.getItem('selection'))!)).toMatchObject({backendId:two.backendId,chat:7});
  notice={backendId:one.backendId,screen:'sessions'};await act(async()=>DeviceEventEmitter.emit('BobNotificationOpen'));
  expect(activeRoot(tree).findByType(AgentsScreen).props.visible).toBe(true);
  expect(activeRoot(tree).findByType(AgentsScreen).props.currentSessionId).toBeUndefined();
  expect(JSON.parse((await AsyncStorage.getItem('selection'))!)).toEqual({backendId:one.backendId});
 }finally{await act(async()=>tree.unmount());}
});


test('Android Back from Sessions restores usable Chat during unfinished native entrances and retains its draft/list',async()=>{
 jest.replaceProperty(Platform,'OS','android');(AppState as any).currentState='active';
 jest.spyOn(AccessibilityInfo,'isReduceMotionEnabled').mockResolvedValue(false);jest.spyOn(AccessibilityInfo,'isScreenReaderEnabled').mockResolvedValue(false);
 jest.spyOn(Animated,'timing').mockImplementation(()=>({start:jest.fn(),stop:jest.fn(),reset:jest.fn()}));
 jest.spyOn(Animated,'loop').mockImplementation(()=>({start:jest.fn(),stop:jest.fn(),reset:jest.fn()}));
 const backs:(()=>boolean)[]=[];
 jest.spyOn(BackHandler,'addEventListener').mockImplementation((_event,callback)=>{const back=callback as ()=>boolean;backs.push(back);return{remove:()=>{const i=backs.indexOf(back);if(i>=0)backs.splice(i,1);}};});
 const dispatchBack=()=>[...backs].reverse().some(back=>back()); // RN continues after a listener returns false.
 jest.spyOn(Keyboard,'isVisible').mockReturnValue(false);
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Desktop'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={};
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{const url=String(input),data=url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[{id:1,kind:'bob.user',data:{text:'Current chat'}}]}:url.includes('agent-overview')?{backendId:backend.backendId,sessions:[{conversationId:7,title:'Current chat',status:'idle',agents:[]}]}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Current chat'}}]}:url.endsWith('/updates')?{enabled:false}:[];return{ok:true,status:200,json:async()=>data} as Response;});
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<App/>);});
 try{
  const draft=activeRoot(tree).findByProps({accessibilityLabel:'Message draft'}),list=activeRoot(tree).findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0];
  act(()=>draft.props.onChangeText('Do not lose this draft'));
  const plainHost=(id:string)=>activeRoot(tree).findAllByType(View).find(node=>node.props.testID===id)!;
  const check=()=>{
   expect(activeRoot(tree).findByType(AgentsScreen).props.visible).toBe(false);
   expect(StyleSheet.flatten(plainHost('agents-screen').props.style).opacity).toBe(0);expect(plainHost('agents-screen').props.pointerEvents).toBe('none');
   expect(StyleSheet.flatten(plainHost('chat-viewport').props.style).opacity).toBe(1);expect(plainHost('chat-viewport').props.pointerEvents).toBe('auto');
   expect(StyleSheet.flatten(activeRoot(tree).findByProps({testID:'chat-composer'}).props.style).opacity).toBe(1);
   expect(activeRoot(tree).findByProps({accessibilityLabel:'Message draft'})).toBe(draft);expect(draft.props.value).toBe('Do not lose this draft');
   expect(activeRoot(tree).findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0]).toBe(list);
   expect(visibleNavigation(tree).props.selected??'Chat').toBe('Chat');
  };
  for(let i=0;i<4;i++){
   await navigateTo(tree,'Agents');expect(activeRoot(tree).findByType(AgentsScreen).props.visible).toBe(true);
   act(()=>{expect(dispatchBack()).toBe(true);});check();
  }
  await navigateTo(tree,'Agents');await navigateTo(tree,'Chat');check();
  act(()=>{expect(dispatchBack()).toBe(true);});check();
 }finally{await act(async()=>tree.unmount());}
 expect(backs).toHaveLength(0);
});

test('real App intercepts /btw before the main outbox while keeping a busy chat and its draft/list hosts intact',async()=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://btw.test.ts.net',name:'BTW fixture'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={};delete NativeModules.BobOutbox;
 let snapshot:((event:any)=>void)|undefined;
 require('react-native-sse').mockImplementation(()=>({addEventListener:jest.fn((event,callback)=>{if(event==='snapshot')snapshot=callback;}),close:jest.fn(),open:jest.fn()}));
 const side={id:'33333333-3333-4333-8333-333333333333',revision:0,model:{provider:'fixture',modelId:'same-model'},createdAt:1,expiresAt:2,snapshot:{characters:200,truncated:false,omitsLive:true},messages:[] as any[]};
 const fetch=jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any,options:any)=>{
  const url=String(input);let data:any;
  if(url.endsWith('/btw'))data=side;
  else if(url.endsWith('/btw/'+side.id+'/messages')){const p=JSON.parse(options.body);side.revision++;side.messages=[{requestId:p.requestId,question:p.text,status:'done',answer:'A separate side answer'}];data=side;}
  else if(url.includes('/btw/'+side.id))data={unchanged:true};
  else data=url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[]}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Test'}}]}:url.endsWith('/updates')?{enabled:false}:[];
  return{ok:true,status:200,json:async()=>data} as Response;
 });
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<App/>);});
 try{
  await act(async()=>snapshot!({data:JSON.stringify({backendId:backend.backendId,conversationId:7,view:{entries:[{id:1,kind:'bob.user',data:{text:'Main work'}}],docs:{'pi.live':{run:{taskId:99,first:1},generation:{}}},work:[]}})}));
  const draft=activeRoot(tree).findByProps({accessibilityLabel:'Message draft'}),list=activeRoot(tree).findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0];
  act(()=>draft.props.onChangeText('/btw Why this approach?'));
  await act(async()=>activeRoot(tree).findAll(node=>node.props.accessibilityLabel==='Send message'&&typeof node.props.onPress==='function')[0].props.onPress());
  expect(fetch.mock.calls.filter(([url,options])=>String(url).endsWith('/chats/7/messages')&&options?.method==='POST')).toHaveLength(0);
  expect(fetch.mock.calls.filter(([url,options])=>String(url).includes('/btw/')&&String(url).endsWith('/messages')&&options?.method==='POST')).toHaveLength(1);
  expect(activeRoot(tree).findByProps({accessibilityLabel:'Message draft'})).toBe(draft);
  expect(activeRoot(tree).findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0]).toBe(list);
  expect(draft.props.value).toBe('');
  await act(async()=>tree.root.findAll(node=>node.props.accessibilityLabel==='Close side chat'&&typeof node.props.onPress==='function')[0].props.onPress());
  expect(activeRoot(tree).findByProps({accessibilityLabel:'Stop Bob'})).toBeDefined();
 }finally{await act(async()=>tree.unmount());}
});

test('a delayed skill archive cannot clear a newer editor draft, and returning keeps the catalog search',async()=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={};delete NativeModules.BobOutbox;
 const skillA={enabled:true,description:'First synthetic skill',markdown:'# A'},skillB={enabled:true,description:'Second synthetic skill',markdown:'# B'};
 let finishDelete!:(value:Response)=>void,archived=false;
 const response=(data:unknown)=>({ok:true,status:200,json:async()=>data} as Response);
 const fetch=jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any,options?:any)=>{
  const url=String(input);
  if(url.endsWith('/library')&&options?.method==='PATCH')return new Promise<Response>(resolve=>{finishDelete=resolve;});
  return response(url.endsWith('/library')?{instructions:'Synthetic defaults',templates:{},skills:archived?{'skill-b':skillB}:{'skill-a':skillA,'skill-b':skillB}}:url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[]}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Test'}}]}:url.endsWith('/updates')?{enabled:false}:[]);
 });
 const alert=jest.spyOn(Alert,'alert').mockImplementation(()=>{});
 let tree!:Renderer.ReactTestRenderer;
 const press=(label:string)=>activeRoot(tree).findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0].props.onPress();
 await act(async()=>{tree=Renderer.create(<App/>);});
 try{
  await navigateTo(tree,'Settings');await act(async()=>press('Skills'));
  const search=activeRoot(tree).findByProps({accessibilityLabel:'Search installed skills'});
  act(()=>search.props.onChangeText('skill'));
  await act(async()=>press('Edit skill skill-a'));
  expect(activeRoot(tree).findByProps({accessibilityLabel:'Skill Markdown'}).props.value).toBe('# A');
  act(()=>press('Archive selected skill'));
  expect(fetch.mock.calls.some(([,options])=>options?.method==='PATCH')).toBe(false);
  const confirm=alert.mock.calls.find(([title])=>title==='Archive this skill?')![2]![1];
  act(()=>confirm.onPress?.());
  await act(async()=>press('Back to previous menu'));
  expect(activeRoot(tree).findByProps({accessibilityLabel:'Search installed skills'})).toBe(search);expect(search.props.value).toBe('skill');
  await act(async()=>press('Edit skill skill-b'));
  const editor=activeRoot(tree).findByProps({accessibilityLabel:'Skill Markdown'});
  act(()=>editor.props.onChangeText('# B\nUnsaved newer draft'));
  archived=true;await act(async()=>finishDelete(response({persisted:true})));
  expect(activeRoot(tree).findByProps({accessibilityLabel:'Skill Markdown'})).toBe(editor);
  expect(editor.props.value).toBe('# B\nUnsaved newer draft');
  expect(activeRoot(tree).findByProps({accessibilityLabel:'Skill name'}).props.value).toBe('skill-b');
  const patches=fetch.mock.calls.filter(([url,options])=>String(url).endsWith('/library')&&options?.method==='PATCH');
  expect(patches).toHaveLength(1);
  expect(JSON.parse(patches[0][1]!.body as string)).toEqual({field:'skill',name:'skill-a',expected:skillA,value:null});
  await act(async()=>press('Back to previous menu'));
  expect(activeRoot(tree).findAllByProps({accessibilityLabel:'Edit skill skill-a'})).toHaveLength(0);
  expect(activeRoot(tree).findByProps({accessibilityLabel:'Search installed skills'})).toBe(search);
 }finally{await act(async()=>tree.unmount());}
},15000);

test('library load failure leaves Skills and instruction editors unavailable until an explicit retry',async()=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};delete NativeModules.BobOutbox;
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{const url=String(input);if(url.endsWith('/library'))throw Error('Synthetic offline library');return {ok:true,status:200,json:async()=>url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[]}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Test'}}]}:url.endsWith('/updates')?{enabled:false}:[]} as Response;});
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<App/>);});
 const press=(label:string)=>activeRoot(tree).findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0].props.onPress();
 try{
  await navigateTo(tree,'Settings');await act(async()=>press('Skills'));
  expect(activeRoot(tree).findAllByProps({accessibilityLabel:'Retry loading'}).length).toBeGreaterThan(0);
  expect(activeRoot(tree).findAllByProps({accessibilityLabel:'Save skill'})).toHaveLength(0);
  await act(async()=>press('Back to previous menu'));await act(async()=>press('Instructions & templates'));
  expect(activeRoot(tree).findAllByProps({accessibilityLabel:'Retry loading'}).length).toBeGreaterThan(0);
  expect(activeRoot(tree).findAllByProps({accessibilityLabel:'Save instructions'})).toHaveLength(0);
 }finally{await act(async()=>tree.unmount());}
},15000);

test('real App shows startup recovery rather than welcome on saved-pairing failure and retries without overwriting profiles',async()=>{
 const read=(AsyncStorage.getItem as jest.Mock).getMockImplementation()!;
 const saved={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Saved workstation'};
 await AsyncStorage.setItem('backends',JSON.stringify([saved]));
 let fail=true;
 (AsyncStorage.getItem as jest.Mock).mockImplementation((key:string)=>key==='backends'&&fail?Promise.reject(Error('Storage unavailable')):read(key));
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null)};NativeModules.BobNotifications={};
 let tree!:Renderer.ReactTestRenderer;
 try{
  await act(async()=>{tree=Renderer.create(<App/>);});
  expect(tree.root.findByProps({testID:'startup-recovery'})).toBeDefined();
  expect(tree.root.findAllByProps({accessibilityLabel:'Bob logo'})).toHaveLength(0);
  expect(await read('backends')).toBe(JSON.stringify([saved]));
  fail=false;await act(async()=>tree.root.findByProps({accessibilityLabel:'Retry startup'}).props.onPress());
  expect(tree.root.findAllByProps({testID:'startup-recovery'})).toHaveLength(0);
  expect(await read('backends')).toBe(JSON.stringify([saved]));
 }finally{if(tree)await act(async()=>tree.unmount());(AsyncStorage.getItem as jest.Mock).mockImplementation(read);}
});

test('send preserves a paused reader and startup editor milestone is recorded once after the active draft becomes usable',async()=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'test-token'});
 const record=jest.fn(async()=>{});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),recordDiagnosticEvent:record};NativeModules.BobNotifications={};NativeModules.BobFiles={};
 NativeModules.BobOutbox={enqueue:jest.fn(async()=>true),status:jest.fn(async()=>JSON.stringify({state:'pending'})),list:jest.fn(async()=>[]),remove:jest.fn(async()=>true)};
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{const url=String(input);return {ok:true,status:200,json:async()=>url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[{id:1,kind:'bob.user',data:{text:'Existing history'}}]}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Test'}}]}:url.endsWith('/updates')?{enabled:false}:[]} as Response;});
 let tree!:Renderer.ReactTestRenderer;
 try{
  await act(async()=>{tree=Renderer.create(<App/>);});
  await act(async()=>{await new Promise<void>(resolve=>setTimeout(()=>resolve(),30));});
  expect(record.mock.calls.filter(call=>(call as unknown[])[0]==='startup.editor-ready')).toHaveLength(1);
  const list=activeRoot(tree).findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToOffset==='function')[0];
  const scroll=jest.spyOn(list.instance,'scrollToOffset').mockImplementation(()=>{});
  const editor=activeRoot(tree).findByProps({accessibilityLabel:'Message draft'});
  act(()=>{list.props.onScrollBeginDrag();list.props.onScroll({nativeEvent:{contentOffset:{y:500},contentSize:{height:2000},layoutMeasurement:{height:600}}});});
  expect(activeRoot(tree).findAllByProps({accessibilityLabel:'Scroll to latest message'}).length).toBeGreaterThan(0);
  act(()=>editor.props.onChangeText('Send without stealing my anchor'));
  await act(async()=>activeRoot(tree).findByProps({accessibilityLabel:'Send message'}).props.onPress());
  await act(async()=>{await new Promise<void>(resolve=>setTimeout(()=>resolve(),30));});
  expect(scroll).not.toHaveBeenCalled();
  expect(activeRoot(tree).findAllByProps({accessibilityLabel:'Scroll to latest message'}).length).toBeGreaterThan(0);
  expect(activeRoot(tree).findByProps({accessibilityLabel:'Message draft'})).toBe(editor);
  expect(record.mock.calls.filter(call=>(call as unknown[])[0]==='startup.editor-ready')).toHaveLength(1);
 }finally{if(tree)await act(async()=>tree.unmount());delete NativeModules.BobOutbox;}
});


test('Android Back dispatch gives the actual active overlay priority over retained App listeners',async()=>{
 jest.replaceProperty(Platform,'OS','android');(AppState as any).currentState='active';
 jest.spyOn(Keyboard,'isVisible').mockReturnValue(false);
 jest.spyOn(PanResponder,'create').mockImplementation((config:any)=>({panHandlers:{onTouchStart:config.onPanResponderGrant}} as any));
 const alert=jest.spyOn(Alert,'alert').mockImplementation(()=>{}),backs:(()=>boolean)[]=[];
 jest.spyOn(BackHandler,'addEventListener').mockImplementation((_event,callback)=>{const back=callback as ()=>boolean;backs.push(back);return{remove:()=>{const i=backs.indexOf(back);if(i>=0)backs.splice(i,1);}};});
 const dispatch=()=>{for(let i=backs.length-1;i>=0;i--)if(backs[i]())return true;return false;};
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Desktop'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={};delete NativeModules.BobOutbox;
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{const url=String(input),data=url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[]}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Current chat'}}]}:url.endsWith('/updates')?{enabled:false}:[];return{ok:true,status:200,json:async()=>data} as Response;});
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<App/>);});
 const press=(label:string)=>tree.root.findByProps({testID:'overlay-active'}).findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0].props.onPress();
 try{
  const draft=activeRoot(tree).findByProps({accessibilityLabel:'Message draft'});act(()=>draft.props.onChangeText('Retain me'));
  await act(async()=>activeRoot(tree).findByProps({accessibilityLabel:'Chat actions'}).props.onPress());
  await act(async()=>press('Drawing'));
  const canvas=tree.root.findByProps({testID:'overlay-active'}).findAll(node=>node.props.accessibilityLabel==='Drawing canvas'&&typeof node.props.onLayout==='function')[0];
  act(()=>canvas.props.onLayout({nativeEvent:{layout:{width:320,height:180}}}));
  act(()=>canvas.props.onTouchStart({nativeEvent:{locationX:10,locationY:20}}));
  act(()=>expect(dispatch()).toBe(true));
  expect(alert).toHaveBeenCalledWith('Discard drawing?',expect.any(String),expect.any(Array),expect.any(Object));
  act(()=>alert.mock.calls.at(-1)![2]![0].onPress?.());
  act(()=>expect(dispatch()).toBe(true));expect(alert).toHaveBeenCalledTimes(2);
  act(()=>alert.mock.calls.at(-1)![2]![1].onPress?.());
  expect(activeRoot(tree).findByType(DrawingEditor).props.visible).toBe(false);
  expect(activeRoot(tree).findByProps({accessibilityLabel:'Message draft'})).toBe(draft);expect(draft.props.value).toBe('Retain me');
  await act(async()=>activeRoot(tree).findByProps({accessibilityLabel:'Menu'}).props.onPress());
  expect(tree.root.findByProps({testID:'overlay-active'}).findAllByProps({testID:'chat-navigation-sheet'}).length).toBeGreaterThan(0);
  act(()=>expect(dispatch()).toBe(true));expect(tree.root.findAllByProps({testID:'overlay-active'})).toHaveLength(0);
  await act(async()=>activeRoot(tree).findByProps({accessibilityLabel:'Chat actions'}).props.onPress());
  await act(async()=>press('Model & thinking'));
  expect(tree.root.findByProps({testID:'overlay-active'}).findAllByProps({accessibilityLabel:'Search models'}).length).toBeGreaterThan(0);
  act(()=>expect(dispatch()).toBe(true));expect(tree.root.findAllByProps({testID:'overlay-active'})).toHaveLength(0);
  expect(draft.props.value).toBe('Retain me');
 }finally{await act(async()=>tree.unmount());}
 expect(backs).toHaveLength(0);
});

test.each(['normal','restricted','unknown','child'] as const)('restoring a trashed retained %s session preserves Terminal admission rules without restarting',async(kind)=>{
 jest.replaceProperty(Platform,'OS','android');(AppState as any).currentState='active';
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:8}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'fixture'});NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={};
 NativeModules.BobTerminal={capabilities:jest.fn(async()=>({available:true})),prepare:jest.fn(async()=> 'terminal-handle'),releasePrepared:jest.fn(async()=>{})};
 const profile=kind==='restricted'?{id:'restricted-local',immutable:true}:kind==='unknown'?{id:'unsupported'}:undefined;
 let meta:{title:string;pinned:boolean;archived:boolean;trashed:boolean;profile?:any}={title:'Disposable',pinned:false,archived:false,trashed:false,...(profile?{profile}:{})};const owner=kind==='child'?{conversationId:7,taskId:1}:undefined;const response=(data:unknown)=>({ok:true,status:200,json:async()=>data}) as Response;
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any,options?:any)=>{
  const url=String(input),method=options?.method??'GET';
  if(url.includes('/chats/8')&&method!=='GET'&&!url.endsWith('/terminal')){meta=method==='DELETE'?{...meta,trashed:true}:{...meta,...JSON.parse(options.body)};return response({id:8,meta});}
  if(url.includes('/agent-overview')){const filter=new URL(url).searchParams.get('filter');return response({backendId:backend.backendId,sessions:[{conversationId:7,title:'Other',status:'idle',agents:[]},...(filter==='trash'?(meta.trashed?[{conversationId:8,status:'idle',agents:[],...meta}]:[]):(!meta.trashed?[{conversationId:8,status:'idle',agents:[],...meta}]:[]))]});}
  if(url.endsWith('/terminal'))return response(method==='POST'?{sessionId:'session-1',host:'100.64.0.1',port:60020,key:'abcdefghijklmnopqrstuv',cwd:'/tmp'}:{available:true,cwd:'/tmp'});
  return response(url.includes('/history')?{backendId:backend.backendId,conversationId:Number(url.match(/chats\/(\d+)/)?.[1]??8),coverage:'stored-entries',items:[]}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Other'}},{id:8,meta:{...meta},...(owner?{owner}:{})}]}:url.endsWith('/updates')?{enabled:false}:url.endsWith('/peers')?{inbound:[],outbound:[]}:{ });
 });
 const alert=jest.spyOn(Alert,'alert').mockImplementation(()=>{});let tree!:Renderer.ReactTestRenderer;
 const press=async(label:string)=>act(async()=>{const owner=tree.root.findAllByProps({testID:'overlay-active'})[0]??activeRoot(tree);owner.findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0].props.onPress();});
 const filter=async(label:string)=>{await act(async()=>activeRoot(tree).findAll(node=>String(node.props.accessibilityLabel??'').startsWith('Session filter:')&&typeof node.props.onPress==='function')[0].props.onPress());await press(label);};
 try{
  await act(async()=>{tree=Renderer.create(<App/>);});const draft=activeRoot(tree).findByProps({accessibilityLabel:'Message draft'});act(()=>draft.props.onChangeText('Retained disposable draft'));
  await navigateTo(tree,'Agents');await press('Session controls for Disposable');await press('Delete');
  await act(async()=>alert.mock.calls.at(-1)![2]!.find(item=>item.text==='Move to Trash')!.onPress?.());expect(meta.trashed).toBe(true);
  const retained=tree.root.findByProps({testID:`session-host:${backend.backendId}:8`});expect(retained.findByType(require('../components/terminal-screen').TerminalScreen).props.allowed).toBe(false);
  await navigateTo(tree,'Agents');await filter('Trash');await press('Session controls for Disposable');await press('Restore conversation');expect(meta.trashed).toBe(false);
  await filter('Active');await press('Open Bob session Disposable');
  expect(activeRoot(tree).findByProps({accessibilityLabel:'Message draft'})).toBe(draft);expect(draft.props.value).toBe('Retained disposable draft');
  await navigateTo(tree,'Terminal');
  expect(activeRoot(tree).findByType(require('../components/terminal-screen').TerminalScreen).props.allowed).toBe(kind==='normal');
  if(kind==='normal')expect(activeRoot(tree).findAllByProps({testID:'embedded-terminal'}).length).toBeGreaterThan(0);
  else expect(activeRoot(tree).findAllByProps({testID:'embedded-terminal'})).toHaveLength(0);
 }finally{if(tree)await act(async()=>tree.unmount());delete NativeModules.BobTerminal;}
},15000);

test('restoring a same-numbered session cannot clear another workstation trash restriction',async()=>{
 const a={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://a.test',name:'A'},b={backendId:'22222222-2222-4222-8222-222222222222',endpoint:'https://b.test',name:'B'};
 await AsyncStorage.setItem('backends',JSON.stringify([a,b]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:b.backendId,chat:8}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'test-device',password:'fixture'});NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};NativeModules.BobFiles={};
 let metaA={title:'A eight',trashed:true},metaB={title:'B eight',trashed:true};const response=(data:unknown)=>({ok:true,status:200,json:async()=>data}) as Response;
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any,options?:any)=>{
  const url=String(input),which=url.startsWith(a.endpoint)?a:b,method=options?.method??'GET';
  if(which===a&&url.includes('/chats/8')&&method==='PUT'){metaA={...metaA,...JSON.parse(options.body)};return response({id:8,meta:metaA});}
  const meta=which===a?metaA:metaB;
  if(url.includes('/agent-overview')){const filter=new URL(url).searchParams.get('filter');return response({backendId:which.backendId,sessions:(filter==='trash'?meta.trashed:!meta.trashed)?[{conversationId:8,status:'idle',agents:[],...meta}]:[]});}
  return response(url.includes('/history')?{backendId:which.backendId,conversationId:8,coverage:'stored-entries',items:[]}:url.endsWith('/chats')?{items:[{id:8,meta:{...meta}}]}:url.endsWith('/updates')?{enabled:false}:url.endsWith('/peers')?{inbound:[],outbound:[]}:{ });
 });
 let tree!:Renderer.ReactTestRenderer;
 const press=async(label:string)=>act(async()=>{const owner=tree.root.findAllByProps({testID:'overlay-active'})[0]??activeRoot(tree);owner.findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0].props.onPress();});
 try{
  await act(async()=>{tree=Renderer.create(<App/>);});await navigateTo(tree,'Terminal');
  expect(activeRoot(tree).findByType(require('../components/terminal-screen').TerminalScreen).props.allowed).toBe(false);
  await navigateTo(tree,'Workstations');await act(async()=>activeRoot(tree).findByType(SideDrawer).props.workspaces.find((row:any)=>row.id===a.backendId).onPress());
  await act(async()=>activeRoot(tree).findAll(node=>String(node.props.accessibilityLabel??'').startsWith('Session filter:')&&typeof node.props.onPress==='function')[0].props.onPress());await press('Trash');
  await press('Session controls for A eight');await press('Restore conversation');expect(metaA.trashed).toBe(false);expect(metaB.trashed).toBe(true);
  await navigateTo(tree,'Workstations');await act(async()=>activeRoot(tree).findByType(SideDrawer).props.workspaces.find((row:any)=>row.id===b.backendId).onPress());
  await navigateTo(tree,'Terminal');expect(activeRoot(tree).findByType(require('../components/terminal-screen').TerminalScreen).props.allowed).toBe(false);
 }finally{if(tree)await act(async()=>tree.unmount());}
},15000);
