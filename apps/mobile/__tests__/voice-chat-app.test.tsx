jest.mock('react-native-reanimated',()=>({__esModule:true,default:{View:require('react-native').View,createAnimatedComponent:(component:any)=>component},LinearTransition:{duration:(duration:number)=>({reduceMotion:(reduceMotion:string)=>({duration,reduceMotion})})},ReduceMotion:{System:'system'},cancelAnimation:jest.fn(),useSharedValue:(value:any)=>require('react').useRef({value}).current,useAnimatedProps:(fn:any)=>fn(),withSpring:(value:any)=>value,withTiming:(value:any)=>value,Easing:{out:(value:any)=>value,cubic:jest.fn()}}));
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {AppState,DeviceEventEmitter,NativeModules,PermissionsAndroid,Platform,StyleSheet,View} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import App from '../App';
import {DrawingEditor} from '../components/drawing-editor';
import {DraftInput} from '../components/draft-input';
import {VoiceChatPanel} from '../components/voice-chat-controls';
import {stopSpeech,speechSnapshot} from '../speech';
import {readOutbox} from '../outbox-storage';
import {tokens} from '../theme-context';
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
jest.mock('react-native-keychain',()=>({getGenericPassword:jest.fn(async()=>false)}));
jest.mock('@react-native-async-storage/async-storage',()=>{const values=new Map();return{getItem:jest.fn(async(key:string)=>values.get(key)??null),setItem:jest.fn(async(key:string,value:string)=>{values.set(key,value);}),removeItem:jest.fn(async(key:string)=>{values.delete(key);}),getMany:jest.fn(async(keys:string[])=>Object.fromEntries(keys.map(key=>[key,values.get(key)??null]))),setMany:jest.fn(async(items:Record<string,string>)=>{for(const [key,value] of Object.entries(items))values.set(key,value);}),removeMany:jest.fn(async(keys:string[])=>{for(const key of keys)values.delete(key);}),getAllKeys:jest.fn(async()=>Array.from(values.keys())),clear:jest.fn(async()=>values.clear())};});

// Only native/network/storage boundaries are mocked. Actual App callbacks, outbox,
// receipt recovery, scope ownership, native-event JS adapters, and text projection run.
const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://voice.example.invalid',name:'Synthetic workstation'};
const device='synthetic-device';
const root=(tree:Renderer.ReactTestRenderer)=>tree.root.findAll(node=>node.type===View&&typeof node.props.testID==='string'&&node.props.testID.startsWith('session-host:')&&node.props.pointerEvents==='auto')[0];
const button=(tree:Renderer.ReactTestRenderer,label:string)=>root(tree).findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0];
const draft=(tree:Renderer.ReactTestRenderer)=>root(tree).findByProps({accessibilityLabel:'Message draft'});
const list=(tree:Renderer.ReactTestRenderer)=>root(tree).findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToOffset==='function')[0];
const flush=async()=>{for(let i=0;i<50;i++)await Promise.resolve();};
let tree:Renderer.ReactTestRenderer|undefined;
let publish:(entries:any[],live?:any)=>void;
let posts:any[],operations:Map<string,any>,answers:Map<number,any>;
let lifecycle:Map<string,Set<Function>>;
const oldEntries=[{id:1,kind:'pi.assistant',model:[{role:'assistant',content:'OLD HISTORY — NEVER AUTO READ'}]}];
const finalEntry=(id:number,text:string)=>({id,conversationId:7,kind:'pi.assistant',model:[{role:'assistant',content:[{type:'thinking',thinking:'hidden reasoning'}, {type:'text',text}, {type:'toolCall',id:'tool',name:'write',arguments:{text:'secret tool args'}}],stopReason:'stop'}]});

beforeEach(async()=>{
 await AsyncStorage.clear();jest.clearAllMocks();jest.useFakeTimers();jest.replaceProperty(Platform,'OS','android');(AppState as any).currentState='active';
 let seq=0;require('uuid').v4.mockImplementation(()=>`33333333-3333-4333-8333-${String(++seq).padStart(12,'0')}`);
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:device,password:'synthetic-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};NativeModules.BobNotifications={watch:jest.fn(async()=>{})};delete NativeModules.BobOutbox;
 NativeModules.BobFiles={stageDataUri:jest.fn(async()=>({id:'file-fixture',uri:'file:///synthetic-draft',name:'drawing.png',mime:'image/png'})),removeAttachment:jest.fn(async()=>{})};
 NativeModules.BobVoiceInput={windowFocused:jest.fn(async()=>true),options:jest.fn(async()=>[{mode:'onDevice',key:'local-v1|en-US',label:'On-device recognition',language:'en-US',networkCapable:false}]),startConfigured:jest.fn(async(_id:string,_key:string,_consent:boolean)=>{}),cancel:jest.fn(async()=>{}),finish:jest.fn(async()=>{}),addListener:jest.fn(),removeListeners:jest.fn()};
 NativeModules.BobSpeech={speak:jest.fn(async(_text:string,_id:string)=>{}),stop:jest.fn(async()=>{}),addListener:jest.fn(),removeListeners:jest.fn()};await stopSpeech();
 jest.spyOn(PermissionsAndroid,'request').mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
 lifecycle=new Map();jest.spyOn(AppState,'addEventListener').mockImplementation((event,callback)=>{if(!lifecycle.has(event))lifecycle.set(event,new Set());lifecycle.get(event)!.add(callback);return{remove:()=>{lifecycle.get(event)?.delete(callback);}};});
 posts=[];operations=new Map();answers=new Map();
 require('react-native-sse').mockImplementation(()=>({addEventListener:(name:string,callback:any)=>{if(name==='snapshot')publish=(entries,live)=>callback({data:JSON.stringify({backendId:backend.backendId,conversationId:7,view:{entries,docs:{'pi.live':live??{}},work:[]}})});},close:jest.fn(),open:jest.fn()}));
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any,options:any)=>{
  const url=String(input);let data:any={};
  if(url.endsWith('/messages')){const message=JSON.parse(options.body);posts.push(message);const admission={type:'input',status:'placed',entry:40+posts.length,conversationId:7,requestId:`device:${device}:${message.requestId}`};operations.set(message.requestId,admission);data=admission;}
  else if(url.includes('/operations/'))data={admission:operations.get(url.split('/').at(-1)!)??null,reply:'A TRUNCATED NOTIFICATION PREVIEW'};
  else if(url.includes('/history?entryId=')){const id=Number(url.split('entryId=')[1]);data={backendId:backend.backendId,conversationId:7,coverage:'stored-entry',entry:answers.get(id)};}
  else if(url.includes('/history'))data={backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:oldEntries};
  else if(url.endsWith('/chats'))data={items:[{id:7,meta:{title:'Voice fixture'}}]};
  else if(url.endsWith('/updates'))data={enabled:false};
  else if(url.endsWith('/transfer-limits'))data={uploadLimit:1024};
  else if(url.endsWith('/ui')||url.endsWith('/models'))data=[];
  return{ok:true,status:200,json:async()=>data} as Response;
 });
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
});
afterEach(async()=>{if(tree)await act(async()=>tree!.unmount());tree=undefined;NativeModules.BobSpeech.stop.mockResolvedValue(undefined);await stopSpeech();jest.useRealTimers();jest.restoreAllMocks();});
async function mount(){await act(async()=>{tree=Renderer.create(<App/>);await flush();});return tree!;}
async function tap(label:string){await act(async()=>{button(tree!,label).props.onPress();await flush();});}
async function event(state:string,text?:string,id?:string){await act(async()=>{DeviceEventEmitter.emit('BobVoiceInputState',{id:id??NativeModules.BobVoiceInput.startConfigured.mock.calls.at(-1)[0],state,text});await flush();});}
async function tick(ms=2000){await act(async()=>{jest.advanceTimersByTime(ms);await flush();});}
async function complete(index:number,answerId:number,text:string){
 const request=posts[index].requestId;operations.set(request,{...operations.get(request),status:'done',answer:answerId});answers.set(answerId,finalEntry(answerId,text));
 await act(async()=>{publish([{id:40+index+1,kind:'bob.user',data:{requestId:request,text:posts[index].text}},...oldEntries],{run:{taskId:999,inputs:[44]}});await flush();});await tick();
}

test.each(['light','dark'] as const)('actual App: two %s Voice Chat turns auto-send/autoplay once; draft, attachment, caret/list identity survive',async scheme=>{
 await AsyncStorage.setItem('appearance',scheme);const mounted=await mount();
 const input=draft(mounted),editor=root(mounted).findByType(DraftInput),history=list(mounted);
 await act(async()=>{input.props.onFocus();input.props.onChangeText('KEEP THIS UNSENT DRAFT');await root(mounted).findByType(DrawingEditor).props.onAdd('data:image/png;base64,fixture');});
 const attachment=()=>root(mounted).findAllByProps({accessibilityLabel:'Remove drawing.png'});
 const initialFiles=attachment().length;expect(initialFiles).toBeGreaterThan(0);
 expect(NativeModules.BobSpeech.speak).not.toHaveBeenCalled();await tap('Start Voice Chat');
 await event('listening');await event('partial','Partial visible words');expect(root(mounted).findByProps({testID:'voice-chat-partial'}).props.children).toBe('Partial visible words');expect(posts).toHaveLength(0);
 const firstId=NativeModules.BobVoiceInput.startConfigured.mock.calls[0][0];await event('final','FIRST SPOKEN TURN',firstId);await event('final','DUPLICATE FINAL',firstId);
 expect(posts).toHaveLength(1);expect(posts[0]).toMatchObject({text:'FIRST SPOKEN TURN',mode:'followUp'});expect(posts[0].questionId).toBeUndefined();
 expect(draft(mounted)).toBe(input);expect(input.props.value).toBe('KEEP THIS UNSENT DRAFT');expect(root(mounted).findByType(DraftInput)).toBe(editor);expect(list(mounted)).toBe(history);expect(attachment()).toHaveLength(initialFiles);
 expect(((await readOutbox()) as any[])[0].files).toEqual([]);expect(NativeModules.BobFiles.removeAttachment).not.toHaveBeenCalled();
 await act(async()=>{publish([...oldEntries,{id:90,kind:'pi.assistant',model:[{role:'assistant',content:'UNRELATED STREAMING/HELPER TEXT'}]}],{generation:{message:{content:'streaming'}},run:{taskId:999,inputs:[44]}});});
 expect(NativeModules.BobSpeech.speak).not.toHaveBeenCalled();
 const full='Full reply, literal 2*3 equals 6. '.repeat(200);await complete(0,100,full);
 expect(NativeModules.BobSpeech.speak).toHaveBeenCalledTimes(1);expect(NativeModules.BobSpeech.speak.mock.calls[0][0]).toBe(full.trim());
 const audio=NativeModules.BobSpeech.speak.mock.calls[0][1];await act(async()=>DeviceEventEmitter.emit('BobSpeechState',{id:audio,state:'done'}));
 expect(NativeModules.BobVoiceInput.startConfigured).toHaveBeenCalledTimes(1);await tap('Speak to Bob');await event('final','SECOND SPOKEN TURN');expect(posts).toHaveLength(2);
 await complete(1,101,'Second completed answer');expect(NativeModules.BobSpeech.speak).toHaveBeenCalledTimes(2);expect(NativeModules.BobSpeech.speak.mock.calls[1][0]).toBe('Second completed answer');
 await act(async()=>{publish([finalEntry(101,'Second completed answer')]);publish([finalEntry(101,'Second completed answer')]);await flush();});await tick();expect(NativeModules.BobSpeech.speak).toHaveBeenCalledTimes(2);
 expect(new Set(posts.map(post=>post.requestId)).size).toBe(2);expect(draft(mounted)).toBe(input);expect(input.props.value).toBe('KEEP THIS UNSENT DRAFT');expect(input.props.caretHidden).toBe(false);expect(list(mounted)).toBe(history);expect(attachment()).toHaveLength(initialFiles);
});

test('draft dictation still inserts only text and needs the separate Send action',async()=>{
 const mounted=await mount();const input=draft(mounted);await act(async()=>input.props.onChangeText('Typed'));
 await tap('Dictate message');await event('final','dictated draft');expect(input.props.value).toBe('Typed dictated draft');expect(posts).toHaveLength(0);expect(NativeModules.BobSpeech.speak).not.toHaveBeenCalled();
 await tap('Send message');expect(posts).toHaveLength(1);expect(posts[0].text).toBe('Typed dictated draft');expect(NativeModules.BobSpeech.speak).not.toHaveBeenCalled();
});

test.each(['cancel','manual-send','navigation','background','scope'])('actual App %s revokes late results or reply interests without a duplicate send',async cause=>{
 const mounted=await mount();await tap('Start Voice Chat');const id=NativeModules.BobVoiceInput.startConfigured.mock.calls[0][0];
 if(cause==='cancel')await tap('Stop voice');
 else if(cause==='manual-send'){await act(async()=>draft(mounted).props.onChangeText('Manual message'));await tap('Send message');}
 else if(cause==='navigation')await tap('Menu');
 else if(cause==='scope'){await act(async()=>{NativeModules.BobPlatform.takeNotificationTarget.mockResolvedValueOnce({backendId:backend.backendId,conversationId:8});DeviceEventEmitter.emit('BobNotificationOpen');await flush();});}
 else await act(async()=>{(AppState as any).currentState='background';for(const callback of lifecycle.get('change')??[])callback('background');});
 await event('final','LATE WORDS',id);expect(posts).toHaveLength(cause==='manual-send'?1:0);expect(NativeModules.BobSpeech.speak).not.toHaveBeenCalled();
});

test('uncertain outbox delivery is recovered by the canonical same request; Voice never submits a second request',async()=>{
 await mount();const normal=(globalThis.fetch as jest.Mock).getMockImplementation()!;let lost=true;
 (globalThis.fetch as jest.Mock).mockImplementation(async(url:any,options:any)=>{if(String(url).endsWith('/messages')&&lost){const result=await normal(url,options);lost=false;throw Error('response lost');}return normal(url,options);});
 await tap('Start Voice Chat');await event('final','Only this request');expect(posts).toHaveLength(1);const request=posts[0].requestId;
 await tick(5000);expect(posts).toHaveLength(1);expect(((await readOutbox()) as any[])[0].id).toBe(request);
 await complete(0,105,'Recovered completed reply');expect(posts).toHaveLength(1);expect(NativeModules.BobSpeech.speak).toHaveBeenCalledTimes(1);
});

test('remount does not reconstruct autoplay from history or a reflected/recovered outbox item',async()=>{
 await mount();await tap('Start Voice Chat');await event('final','An enqueued turn');const request=posts[0].requestId;
 await act(async()=>tree!.unmount());tree=undefined;operations.set(request,{...operations.get(request),status:'done',answer:106});answers.set(106,finalEntry(106,'Do not speak after remount'));
 await mount();await tick(5000);expect(NativeModules.BobSpeech.speak).not.toHaveBeenCalled();expect(posts).toHaveLength(1);
});

test.each([337,361].flatMap(width=>['light','dark'].map(scheme=>({width,scheme}))))('voice controls fit structural $width×754 geometry in $scheme at both scales and keyboard states without input/list replacement',async({width,scheme})=>{
 await AsyncStorage.setItem('appearance',scheme);const dimensions=jest.spyOn(require('react-native'),'useWindowDimensions').mockReturnValue({width,height:754,scale:1,fontScale:1});await mount();const input=draft(tree!),history=list(tree!);
 await act(async()=>root(tree!).findByType(DrawingEditor).props.onAdd('data:image/png;base64,fixture'));
 await tap('Start Voice Chat');
 for(const fontScale of [1,2])for(const keyboard of [0,280]){
  dimensions.mockReturnValue({width,height:754,scale:1,fontScale});
  await act(async()=>{DeviceEventEmitter.emit('BobKeyboardInset',{imeBottom:keyboard});await flush();});
  const voiceButton=button(tree!,'Cancel voice capture');expect(StyleSheet.flatten(voiceButton.props.style)).toMatchObject({width:48,height:48,flexShrink:0,borderColor:tokens[scheme as 'light'|'dark'].colors.accent});
  const fixed=root(tree!).findByProps({testID:'voice-chat-fixed-controls'});
  const stop=fixed.findAll(node=>node.props.accessibilityLabel==='Stop voice'&&typeof node.props.onPress==='function')[0];expect(StyleSheet.flatten(stop.props.style).minHeight).toBe(48);
  expect(root(tree!).findByType(DraftInput).props.maxHeight).toBeGreaterThanOrEqual(Math.max(48,Math.ceil(26*fontScale+20)));
  if(keyboard&&fontScale===2){expect(StyleSheet.flatten(root(tree!).findByProps({testID:'draft-attachment-previews'}).props.style).maxHeight).toBe(0);expect(StyleSheet.flatten(root(tree!).findByProps({testID:'composer-heading'}).props.style).height).toBe(48);}
  const panel=root(tree!).findByType(VoiceChatPanel);expect(panel.props.maxHeight).toBeLessThanOrEqual(280);
  const phase=root(tree!).findByProps({testID:'voice-chat-phase'});expect(phase.parent?.props.testID).not.toBe('voice-chat-details');
  expect(root(tree!).findAllByProps({accessibilityLabel:'Allow provider voice once'})).toHaveLength(0);
  expect(draft(tree!)).toBe(input);expect(list(tree!)).toBe(history);expect(root(tree!).findByType(DraftInput).props.trailingWidth).toBe(160);
 }
});

test('failed Stop keeps an app-owned recovery control reachable even after a reply row unmounts',async()=>{
 await mount();await tap('Start Voice Chat');await event('final','Read me');await complete(0,110,'A completed answer');const audio=NativeModules.BobSpeech.speak.mock.calls[0][1];
 NativeModules.BobSpeech.stop.mockRejectedValueOnce(Error('native stop unresolved'));await tap('Stop voice');
 expect(speechSnapshot()).not.toBeNull();expect(root(tree!).findByProps({testID:'speech-stop-recovery'})).toBeDefined();
 await act(async()=>{publish([]);DeviceEventEmitter.emit('BobSpeechState',{id:audio,state:'done'});await flush();});expect(speechSnapshot()).not.toBeNull();
 await tap('Retry stopping playback');expect(speechSnapshot()).toBeNull();expect(NativeModules.BobSpeech.stop).toHaveBeenLastCalledWith('');
});

test('actual App rejects a replaced pairing during reply recovery, without resubmitting or reading',async()=>{
 await mount();await tap('Start Voice Chat');await event('final','Sent with the original device');
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'replacement-device',password:'different-synthetic-token'});
 await complete(0,120,'Must not read under another pairing');expect(posts).toHaveLength(1);expect(NativeModules.BobSpeech.speak).not.toHaveBeenCalled();
});
test('session-owned long-answer audio survives normal reply-cell mounting and unmounting',async()=>{
 await mount();await tap('Start Voice Chat');await event('final','Give a full answer');const full='A long untruncated public paragraph. '.repeat(250);await complete(0,121,full);
 const audio=speechSnapshot(),stops=NativeModules.BobSpeech.stop.mock.calls.length;
 await act(async()=>{publish([finalEntry(121,full)]);await flush();});
 await act(async()=>{publish([]);await flush();});
 expect(speechSnapshot()).toBe(audio);expect(NativeModules.BobSpeech.stop).toHaveBeenCalledTimes(stops);expect(NativeModules.BobSpeech.speak).toHaveBeenCalledTimes(1);
});

test('native capture cleanup uncertainty never sends the final words and exposes global Retry Stop',async()=>{
 await mount();await tap('Start Voice Chat');const id=NativeModules.BobVoiceInput.startConfigured.mock.calls[0][0];
 await act(async()=>{DeviceEventEmitter.emit('BobVoiceInputState',{id,state:'error',stopUnconfirmed:true,message:'Microphone cleanup is unconfirmed.'});await flush();});
 expect(posts).toHaveLength(0);expect(root(tree!).findByProps({testID:'speech-stop-recovery'})).toBeDefined();
 expect(speechSnapshot()).not.toBeNull();await event('final','Late unsafe words',id);expect(posts).toHaveLength(0);
 await tap('Retry stopping playback');expect(speechSnapshot()).toBeNull();expect(NativeModules.BobSpeech.stop).toHaveBeenLastCalledWith('');
});

test('focus loss during asynchronous device admission fences auto-send before enqueue',async()=>{
 await mount();await tap('Start Voice Chat');let release!:(value:any)=>void;
 (Keychain.getGenericPassword as jest.Mock).mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
 await event('final','Do not send after focus loss');expect(posts).toHaveLength(0);
 await act(async()=>{for(const callback of lifecycle.get('blur')??[])callback();release({username:device,password:'synthetic-token'});await flush();});
 expect(posts).toHaveLength(0);expect(NativeModules.BobSpeech.speak).not.toHaveBeenCalled();
});

test.each([337,361].flatMap(width=>['light','dark'].map(scheme=>({width,scheme}))))('scaled keyboard/files recovery keeps $width $scheme editor, caret and list alive',async({width,scheme})=>{
 await AsyncStorage.setItem('appearance',scheme);jest.spyOn(require('react-native'),'useWindowDimensions').mockReturnValue({width,height:754,scale:1,fontScale:2});
 await mount();const input=draft(tree!),history=list(tree!);
 await act(async()=>{input.props.onFocus();input.props.onChangeText('Unrelated draft remains');await root(tree!).findByType(DrawingEditor).props.onAdd('data:image/png;base64,fixture');DeviceEventEmitter.emit('BobKeyboardInset',{imeBottom:280});await flush();});
 await tap('Start Voice Chat');const capture=NativeModules.BobVoiceInput.startConfigured.mock.calls.at(-1)[0];
 await act(async()=>{DeviceEventEmitter.emit('BobVoiceInputState',{id:capture,state:'error',stopUnconfirmed:true,message:'Unconfirmed microphone cleanup'});await flush();});
 expect(StyleSheet.flatten(root(tree!).findByProps({testID:'composer-heading'}).props.style).height).toBe(48);
 expect(StyleSheet.flatten(root(tree!).findByProps({testID:'draft-attachment-previews'}).props.style).maxHeight).toBe(0);
 expect(root(tree!).findByType(DraftInput).props.maxHeight).toBeGreaterThanOrEqual(72);
 expect(StyleSheet.flatten(button(tree!,'Retry stopping playback').props.style).minHeight).toBe(48);
 expect(draft(tree!)).toBe(input);expect(input.props.value).toBe('Unrelated draft remains');expect(input.props.caretHidden).toBe(false);expect(list(tree!)).toBe(history);
 await tap('Retry stopping playback');
 expect(StyleSheet.flatten(root(tree!).findByProps({testID:'draft-attachment-previews'}).props.style).maxHeight).toBe(136);
 expect(draft(tree!)).toBe(input);expect(list(tree!)).toBe(history);expect(NativeModules.BobVoiceInput.startConfigured).toHaveBeenCalledTimes(1);expect(posts).toHaveLength(0);
});

test('a constrained error keeps its cause in the live header, not hidden below explanatory copy',async()=>{
 jest.spyOn(require('react-native'),'useWindowDimensions').mockReturnValue({width:337,height:754,scale:1,fontScale:2});await mount();
 await act(async()=>{await root(tree!).findByType(DrawingEditor).props.onAdd('data:image/png;base64,fixture');DeviceEventEmitter.emit('BobKeyboardInset',{imeBottom:280});await flush();});
 await tap('Start Voice Chat');const id=NativeModules.BobVoiceInput.startConfigured.mock.calls.at(-1)[0];
 await act(async()=>{DeviceEventEmitter.emit('BobVoiceInputState',{id,state:'error',message:'Requested language model is not installed. Use Speech options.'});await flush();});
 expect(root(tree!).findByProps({testID:'voice-chat-phase'}).props.children).toContain('model is not installed');
 expect(StyleSheet.flatten(button(tree!,'Speech options').props.style)).toMatchObject({width:48,height:48});
 expect(button(tree!,'Stop voice')).toBeDefined();expect(button(tree!,'Exit Voice Chat')).toBeDefined();expect(posts).toHaveLength(0);
});
