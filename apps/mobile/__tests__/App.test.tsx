jest.mock('react-native-reanimated',()=>({__esModule:true,default:{View:require('react-native').View},LinearTransition:{duration:(duration:number)=>({reduceMotion:(reduceMotion:string)=>({duration,reduceMotion})})},ReduceMotion:{System:'system'}}));
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {AppState,DeviceEventEmitter,NativeModules,Platform,StyleSheet,TextInput} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import {colors} from '../theme';
import {readOutbox} from '../outbox-storage';
import {DraftInput} from '../components/draft-input';
import {EdgeFade} from '../components/edge-fade';
import {InlineSurface} from '../components/inline-surface';
import {SideDrawer} from '../components/side-drawer';
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
jest.mock('../components/ui/text',()=>({Text:require('react-native').Text}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaProvider:require('react-native').View,SafeAreaView:require('react-native').View,useSafeAreaInsets:()=>({top:0,bottom:0,left:0,right:0})}));
jest.mock('react-native-keychain',()=>({getGenericPassword:jest.fn(async()=>false)}));
jest.mock('@react-native-async-storage/async-storage',()=>{const values=new Map();return{getItem:jest.fn(async(key:string)=>values.get(key)??null),setItem:jest.fn(async(key:string,value:string)=>{values.set(key,value);}),removeItem:jest.fn(async(key:string)=>{values.delete(key);}),getMany:jest.fn(async(keys:string[])=>Object.fromEntries(keys.map(key=>[key,values.get(key)??null]))),setMany:jest.fn(async(items:Record<string,string>)=>{for(const [key,value] of Object.entries(items))values.set(key,value);}),removeMany:jest.fn(async(keys:string[])=>{for(const key of keys)values.delete(key);}),clear:jest.fn(async()=>values.clear())};});
beforeEach(async()=>{await AsyncStorage.clear();});
afterEach(()=>jest.restoreAllMocks());
test('unpaired app mounts the real screen and history/navigation hooks without a blank screen',async()=>{
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={};
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<App/>);});
 act(()=>tree.root.findByProps({accessibilityLabel:'Paste pairing invitation'}).props.onPress());
 expect(tree.root.findAllByProps({accessibilityLabel:'Pairing invitation'}).length).toBeGreaterThan(0);
 await act(async()=>tree.unmount());
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
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{
  const url=String(input);const data=url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:[{id:1,kind:'pi.assistant',model:[{role:'assistant',content:[{type:'toolCall',id:'visual-call',name:'render_visual',arguments:{title:'Solar system',html:'<p>Solar system</p>'}}]}]},{id:2,kind:'pi.tool-result',model:[{role:'toolResult',toolCallId:'visual-call',toolName:'render_visual',content:[{type:'text',text:`Isolated visual ${surface.id}: Solar system. Open from the conversation’s interactive surfaces.`}]}]},{id:3,kind:'pi.assistant',model:[{role:'assistant',content:[{type:'text',text:'This is a newer reply, after the illustration.'}]}]}]}:url.endsWith('/ui')?[surface]:url.endsWith('/updates')?{enabled:false}:url.endsWith('/chats')?{items:[{id:7,meta:{title:'Test chat'}}]}:url.endsWith('/peers')?{inbound:[],outbound:[]}:url.endsWith('/models')?[]:url.endsWith('/configure')?{}:[];
  return {ok:true,status:200,json:async()=>data} as Response;
 });
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<App/>);});
 const draft=tree.root.findByProps({accessibilityLabel:'Message draft'});expect(tree.root.findByType(DraftInput).props.compact).toBe(true);expect(StyleSheet.flatten(draft.props.style).height).toBe(48);
 act(()=>{draft.props.onChangeText('A retained draft while toggling the keyboard.');for(const callback of ime)callback({imeBottom:280});});expect(tree.root.findByType(DraftInput).props.compact).toBe(false);expect(tree.root.findByProps({accessibilityLabel:'Message draft'})).toBe(draft);
 act(()=>draft.props.onContentSizeChange({nativeEvent:{contentSize:{height:126}}}));expect(StyleSheet.flatten(draft.props.style).height).toBe(126);
 act(()=>{for(const callback of ime)callback({imeBottom:0});});expect(tree.root.findByType(DraftInput).props.compact).toBe(true);expect(StyleSheet.flatten(draft.props.style).height).toBe(48);expect(draft.props.value).toContain('retained draft');
 const composer=tree.root.findByProps({testID:'chat-composer'});expect(StyleSheet.flatten(composer.props.style).backgroundColor).toBe('transparent');expect(composer.findAllByType(EdgeFade)).toHaveLength(0);
 const controls=composer.findByProps({testID:'composer-controls'});expect(controls.findAllByType(TextInput)).toHaveLength(0);expect(controls.findByProps({accessibilityLabel:'Chat actions'})).toBeDefined();expect(controls.findByProps({accessibilityLabel:'Send message'})).toBeDefined();
 expect(StyleSheet.flatten(controls.findByProps({accessibilityLabel:'Send message'}).props.style).backgroundColor).toBe('transparent');
 expect(controls.findByProps({accessibilityLabel:'Send message'}).props.variant).toBe('ghost');
 const header=tree.root.findByProps({testID:'chat-header'});
 expect(header.findAllByProps({accessibilityLabel:'New conversation'})).toHaveLength(0);
 expect(header.findByProps({accessibilityLabel:'Open workspaces'})).toBeDefined();
 const list=tree.root.findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0];expect(list).toBeDefined();
 expect(list.props.inverted).toBe(true);expect(list.props.initialScrollIndex).toBe(0);expect(list.props.data.map((entry:any)=>entry.id)).toEqual([3,1]);
 const latest=jest.spyOn(list.instance,'scrollToOffset').mockImplementation(()=>{});
 const scroll=jest.spyOn(list.instance,'scrollToEnd').mockImplementation(()=>{}),nativeEnd=jest.fn();jest.spyOn(list.instance,'getScrollResponder').mockReturnValue({scrollToEnd:nativeEnd});
 act(()=>{list.props.onLayout({nativeEvent:{layout:{height:600}}});list.props.onContentSizeChange(300,2000);});
 expect(tree.root.findByProps({testID:'history-entry-1'}).findAllByType(InlineSurface)).toHaveLength(1);
 expect(tree.root.findByProps({testID:'history-entry-3'}).findAllByType(InlineSurface)).toHaveLength(0);
 expect(tree.root.findAllByType(InlineSurface)).toHaveLength(1);
 expect(NativeModules.BobInteractive.prepare).toHaveBeenCalledTimes(1);
 const event={nativeEvent:{contentOffset:{y:500},contentSize:{height:2000},layoutMeasurement:{height:600}}};
 await act(async()=>{await new Promise<void>(resolve=>setTimeout(resolve,35));});scroll.mockClear();nativeEnd.mockClear();latest.mockClear();
 if(!readingEarlier)act(()=>list.props.onScroll({nativeEvent:{contentOffset:{y:0},contentSize:{height:2000},layoutMeasurement:{height:600}}}));
 if(readingEarlier){act(()=>{list.props.onScrollBeginDrag();list.props.onScroll(event);list.props.onMomentumScrollEnd(event);});expect(tree.root.findByProps({accessibilityLabel:'Scroll to latest message'})).toBeDefined();}
 for(const section of ['Todos','Notes','Settings']){
  act(()=>tree.root.findByProps({accessibilityLabel:'Open workspaces'}).props.onPress());
  await act(async()=>{const drawer=tree.root.findByType(SideDrawer);if(section==='Settings')drawer.props.onSettings();else drawer.props.navigation.find((row:any)=>row.id===section).onPress();});
  expect(tree.root.findByProps({testID:section==='Notes'?'notes-screen':'section-overlay'})).toBeDefined();expect(tree.root.findByProps({testID:'chat-viewport'}).props.pointerEvents).toBe('none');
  expect(tree.root.findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0]).toBe(list);
  act(()=>tree.root.findByProps({accessibilityLabel:'Back to chat'}).props.onPress());
  expect(tree.root.findByProps({testID:'chat-viewport'}).props.pointerEvents).toBe('auto');expect(tree.root.findAllByProps({testID:'section-overlay'})).toHaveLength(0);
  expect(tree.root.findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0]).toBe(list);
 }
 const historyCalls=()=> (globalThis.fetch as jest.Mock).mock.calls.filter(([url])=>String(url).includes('/history')).length;
 const before=historyCalls();
 for(let cycle=0;cycle<2;cycle++){
  act(()=>{transition('background');list.props.onLayout({nativeEvent:{layout:{height:0}}});list.props.onContentSizeChange(300,0);list.props.onScroll({...event,nativeEvent:{...event.nativeEvent,contentOffset:{y:0}}});});
  await act(async()=>{transition('active');list.props.onLayout({nativeEvent:{layout:{height:600}}});list.props.onContentSizeChange(300,2000);await new Promise<void>(resolve=>setTimeout(resolve,35));});
  expect(tree.root.findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0]).toBe(list);
 }
 expect(historyCalls()).toBeGreaterThan(before);expect(latest).not.toHaveBeenCalled();expect(nativeEnd).not.toHaveBeenCalled();expect(scroll).not.toHaveBeenCalled();expect(NativeModules.BobInteractive.prepare).toHaveBeenCalledTimes(1);
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
 const userBubble=tree.root.findByProps({testID:'history-entry-7150'}).findAll(node=>{const style=StyleSheet.flatten(node.props.style);return style?.backgroundColor===colors.surface&&style?.borderRadius===20;})[0];const padding=StyleSheet.flatten(userBubble.props.style);expect(padding.paddingVertical).toBe(12);expect(padding.paddingHorizontal).toBe(16);
expect(tree.root.findAllByProps({testID:'history-entry-7001'})).toHaveLength(0);
 act(()=>tree.root.findByProps({accessibilityLabel:'Open workspaces'}).props.onPress());await act(async()=>tree.root.findByType(SideDrawer).props.conversations.find((row:any)=>row.id==='8').onPress());
 const waiting=findList();expect(waiting).not.toBe(first);expect(waiting.props.inverted).toBe(true);expect(waiting.props.data).toHaveLength(0);expect(finishSecond).toBeDefined();
 await act(async()=>finishSecond!(response(pages.get(8))));check(8);
 act(()=>tree.root.findByProps({accessibilityLabel:'Open workspaces'}).props.onPress());await act(async()=>tree.root.findByType(SideDrawer).props.conversations.find((row:any)=>row.id==='7').onPress());check(7);
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
