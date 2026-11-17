jest.mock('react-native-reanimated',()=>({__esModule:true,default:{View:require('react-native').View,createAnimatedComponent:(component:any)=>component},LinearTransition:{duration:(duration:number)=>({reduceMotion:(reduceMotion:string)=>({duration,reduceMotion})})},ReduceMotion:{System:'system'},cancelAnimation:jest.fn(),useSharedValue:(value:any)=>require('react').useRef({value}).current,useAnimatedProps:(fn:any)=>fn(),withSpring:(value:any)=>value,withTiming:(value:any)=>value,Easing:{out:(value:any)=>value,cubic:jest.fn()}}));
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Alert,AppState,DeviceEventEmitter,NativeModules,PermissionsAndroid,Platform,StyleSheet,Text as NativeText,View} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import App from '../App';
import {DrawingEditor} from '../components/drawing-editor';
import {DraftInput} from '../components/draft-input';
import {VoiceChatPanel} from '../components/voice-chat-controls';
import {ComposerStatusRecovery} from '../components/composer-recovery';
import {ChatNavigation} from '../components/chat-navigation';
import {SettingsHome} from '../components/settings-home';
import {AgentsScreen} from '../components/agents-screen';
import {stopSpeech,speechSnapshot,markAudioCleanupUnconfirmed} from '../speech';
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
const storageDefaults={read:(AsyncStorage.getItem as jest.Mock).getMockImplementation()!,write:(AsyncStorage.setItem as jest.Mock).getMockImplementation()!};
const oldEntries=[{id:1,kind:'pi.assistant',model:[{role:'assistant',content:'OLD HISTORY — NEVER AUTO READ'}]}];
const finalEntry=(id:number,text:string)=>({id,conversationId:7,kind:'pi.assistant',model:[{role:'assistant',content:[{type:'thinking',thinking:'hidden reasoning'}, {type:'text',text}, {type:'toolCall',id:'tool',name:'write',arguments:{text:'secret tool args'}}],stopReason:'stop'}]});

beforeEach(async()=>{
 (AsyncStorage.getItem as jest.Mock).mockImplementation(storageDefaults.read);(AsyncStorage.setItem as jest.Mock).mockImplementation(storageDefaults.write);
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
 await event('listening');await event('partial','Partial spoken words');
 const panel=()=>root(mounted).findByProps({testID:'voice-chat-panel'});
 expect(panel().findAllByType(NativeText)).toHaveLength(0);expect(root(mounted).findAllByProps({testID:'voice-chat-partial'})).toHaveLength(0);
 expect(root(mounted).findByProps({testID:'voice-chat-phase'}).props.accessibilityLabel).toContain('Listening · auto-send\nPartial spoken words');expect(posts).toHaveLength(0);
 const firstId=NativeModules.BobVoiceInput.startConfigured.mock.calls[0][0];await event('final','FIRST SPOKEN TURN',firstId);await event('final','DUPLICATE FINAL',firstId);
 expect(panel().findAllByType(NativeText)).toHaveLength(0);
 expect(posts).toHaveLength(1);expect(posts[0]).toMatchObject({text:'FIRST SPOKEN TURN',mode:'followUp'});expect(posts[0].questionId).toBeUndefined();
 expect(draft(mounted)).toBe(input);expect(input.props.value).toBe('KEEP THIS UNSENT DRAFT');expect(root(mounted).findByType(DraftInput)).toBe(editor);expect(list(mounted)).toBe(history);expect(attachment()).toHaveLength(initialFiles);
 expect(((await readOutbox()) as any[])[0].files).toEqual([]);expect(NativeModules.BobFiles.removeAttachment).not.toHaveBeenCalled();
 await act(async()=>{publish([...oldEntries,{id:90,kind:'pi.assistant',model:[{role:'assistant',content:'UNRELATED STREAMING/HELPER TEXT'}]}],{generation:{message:{content:'streaming'}},run:{taskId:999,inputs:[44]}});});
 expect(NativeModules.BobSpeech.speak).not.toHaveBeenCalled();
 const full='Full reply, literal 2*3 equals 6. '.repeat(200);await complete(0,100,full);
 expect(NativeModules.BobSpeech.speak).toHaveBeenCalledTimes(1);expect(NativeModules.BobSpeech.speak.mock.calls[0][0]).toBe(full.trim());
 expect(panel().findAllByType(NativeText)).toHaveLength(0);expect(root(mounted).findByProps({testID:'voice-chat-phase'}).props.accessibilityLabel).toContain('Reading reply');
 const audio=NativeModules.BobSpeech.speak.mock.calls[0][1];await act(async()=>DeviceEventEmitter.emit('BobSpeechState',{id:audio,state:'done'}));
 expect(NativeModules.BobVoiceInput.startConfigured).toHaveBeenCalledTimes(1);await tap('Speak to Bob');await event('final','SECOND SPOKEN TURN');expect(posts).toHaveLength(2);
 await complete(1,101,'Second completed answer');expect(NativeModules.BobSpeech.speak).toHaveBeenCalledTimes(2);expect(NativeModules.BobSpeech.speak.mock.calls[1][0]).toBe('Second completed answer');
 await act(async()=>{publish([finalEntry(101,'Second completed answer')]);publish([finalEntry(101,'Second completed answer')]);await flush();});await tick();expect(NativeModules.BobSpeech.speak).toHaveBeenCalledTimes(2);
 expect(new Set(posts.map(post=>post.requestId)).size).toBe(2);expect(draft(mounted)).toBe(input);expect(input.props.value).toBe('KEEP THIS UNSENT DRAFT');expect(input.props.caretHidden).toBe(false);expect(list(mounted)).toBe(history);expect(attachment()).toHaveLength(initialFiles);
});

const optionsMatrix=([337,361] as const).flatMap(width=>['light','dark'].flatMap(scheme=>[1,2].map(fontScale=>({width,scheme,fontScale}))));
test.each(optionsMatrix)('actual App Speech options $width $scheme $fontScale: readable bounded choices without changing draft',async({width,scheme,fontScale})=>{
 await AsyncStorage.setItem('appearance',scheme);
 jest.spyOn(require('react-native'),'useWindowDimensions').mockReturnValue({width,height:754,scale:1,fontScale});
 const mounted=await mount();const input=draft(mounted),history=list(mounted);
 await act(async()=>{input.props.onChangeText('Unsent draft');});
 const native=NativeModules.BobVoiceInput as any;
 native.options.mockImplementation(async(language:string|null)=>[{mode:'onDevice',key:`local|${language??'en-PL'}`,label:'Google speech engine on-device',language:language??'en-PL',networkCapable:false}]);
 await tap('Start Voice Chat');await event('error','No installed model. Use Speech options.');
 await tap('Speech options');
 const option=(label:string)=>mounted.root.findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0];
 const card=mounted.root.findByProps({testID:'speech-options'});
 expect(StyleSheet.flatten(card.props.style).maxHeight).toBeLessThanOrEqual(754);
 expect(StyleSheet.flatten(card.props.style).backgroundColor).toBe(tokens[scheme as 'light'|'dark'].colors.background);
 expect(option('English (US) · en-US')).toBeTruthy();expect(option('English (UK) · en-GB')).toBeTruthy();
 expect(StyleSheet.flatten(option('English (US) · en-US').props.style).minHeight).toBeGreaterThanOrEqual(48);
 await act(async()=>{option('English (UK) · en-GB').props.onPress();await flush();});
 expect(native.options).toHaveBeenCalledWith('en-GB');expect(native.startConfigured).toHaveBeenCalledTimes(1);
 await act(async()=>{option('Google speech engine on-device · en-GB').props.onPress();await flush();});
 expect(native.startConfigured).toHaveBeenCalledWith(expect.any(String),'local|en-GB','en-GB',false);
 expect(draft(mounted)).toBe(input);expect(input.props.value).toBe('Unsent draft');expect(list(mounted)).toBe(history);
 expect(posts).toHaveLength(0);
});

test('closing speech options and late provider lookup cannot admit capture',async()=>{
 const mounted=await mount();await tap('Start Voice Chat');await event('error','Missing model');
 let resolve!:(plans:any[])=>void;const waiting=new Promise<any[]>(r=>{resolve=r;});
 const native=NativeModules.BobVoiceInput as any;
 native.options.mockImplementation((language:string|null)=>language==='en-US'?waiting:Promise.resolve([{mode:'onDevice',key:'local|en-PL',label:'Local',language:'en-PL',networkCapable:false}]));
 await tap('Speech options');
 const option=(label:string)=>mounted.root.findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0];
 await act(async()=>{option('English (US) · en-US').props.onPress();await flush();});
 await act(async()=>{option('Close speech options').props.onPress();await flush();});
 resolve([{mode:'onDevice',key:'local|en-US',label:'Local',language:'en-US',networkCapable:false}]);
 await act(async()=>flush());expect(native.startConfigured).toHaveBeenCalledTimes(1);expect(posts).toHaveLength(0);
});

test('speech options accept a manually requested regional tag without treating it as installed',async()=>{
 const mounted=await mount(),input=draft(mounted);await tap('Start Voice Chat');await event('error','Missing language model');
 const native=NativeModules.BobVoiceInput as any;
 native.options.mockImplementation(async(language:string|null)=>[{mode:'onDevice',key:`local|${language??'en-PL'}`,label:'Local',language:language??'en-PL',networkCapable:false}]);
 await tap('Speech options');
 const option=(label:string)=>mounted.root.findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0];
 const tag=mounted.root.findByProps({accessibilityLabel:'Other speech language tag'});
 await act(async()=>{tag.props.onChangeText('zh-Hant-TW-u-nu-latn');await flush();});
 await act(async()=>{option('Request entered language').props.onPress();await flush();});
 expect(native.options).toHaveBeenCalledWith('zh-Hant-TW-u-nu-latn');expect(native.startConfigured).toHaveBeenCalledTimes(1);
 await act(async()=>{option('Local · zh-Hant-TW-u-nu-latn').props.onPress();await flush();});
 expect(native.startConfigured).toHaveBeenCalledWith(expect.any(String),'local|zh-Hant-TW-u-nu-latn','zh-Hant-TW-u-nu-latn',false);
 expect(draft(mounted)).toBe(input);expect(posts).toHaveLength(0);
});

test.each(['light','dark'] as const)('actual App %s draft failure recovery opens themed speech options, preserving native draft and list',async scheme=>{
 await AsyncStorage.setItem('appearance',scheme);const mounted=await mount(),input=draft(mounted),history=list(mounted),editor=root(mounted).findByType(DraftInput);
 await act(async()=>input.props.onChangeText('Retain this draft'));
 await tap('Dictate message');await event('error','No model for en-PL. Use Speech options.');
 const buttonInModal=(label:string)=>mounted.root.findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0];
 const recovery=mounted.root.findByProps({testID:'dictation-recovery'});
 expect(StyleSheet.flatten(recovery.props.style).backgroundColor).toBe(tokens[scheme].colors.background);
 expect(buttonInModal('Open speech options from dictation recovery')).toBeTruthy();
 await act(async()=>{buttonInModal('Open speech options from dictation recovery').props.onPress();await flush();});
 expect(mounted.root.findByProps({testID:'speech-options'})).toBeTruthy();
 await act(async()=>{buttonInModal('Close speech options').props.onPress();await flush();});
 expect(NativeModules.BobVoiceInput.startConfigured).toHaveBeenCalledTimes(1);
 expect(draft(mounted)).toBe(input);expect(input.props.value).toBe('Retain this draft');expect(root(mounted).findByType(DraftInput)).toBe(editor);expect(list(mounted)).toBe(history);expect(posts).toHaveLength(0);
});

test.each(['light','dark'] as const)('actual App %s named network approval is informed, remembered, dismissable and keeps draft/list untouched',async scheme=>{
 await AsyncStorage.setItem('appearance',scheme);const mounted=await mount(),input=draft(mounted),history=list(mounted);
 await act(async()=>input.props.onChangeText('Unsent draft'));
 const bridge=NativeModules.BobVoiceInput as any;
 bridge.options.mockResolvedValue([{mode:'platform',key:'service|en-GB',label:'Named Google speech service',language:'en-GB',networkCapable:true}]);
 await tap('Start Voice Chat');
 const card=mounted.root.findByProps({testID:'speech-network-consent'});
 expect(StyleSheet.flatten(card.props.style).backgroundColor).toBe(tokens[scheme].colors.background);
 const text=(node:any):string=>node.children.map((child:any)=>typeof child==='string'?child:text(child)).join(' ');
 const disclosure=text(card);
 expect(disclosure).toContain('Named Google speech service');
 expect(disclosure).toContain('en-GB');
 expect(disclosure).toContain('May send microphone audio to this provider over the network');
 expect(disclosure).toContain('Remember approval on this phone');
 expect(bridge.startConfigured).not.toHaveBeenCalled();
 const inModal=(label:string)=>mounted.root.findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0];
 await act(async()=>{inModal('Cancel network speech').props.onPress();await flush();});
 expect(bridge.startConfigured).not.toHaveBeenCalled();await tap('Speak to Bob');
 await act(async()=>{inModal('Allow and remember network speech').props.onPress();await flush();});
 expect(bridge.startConfigured).toHaveBeenCalledWith(expect.any(String),'service|en-GB','en-GB',true);
 // Native options attest the saved approval; JS never invents a remembered grant.
 bridge.options.mockResolvedValue([{mode:'platform',key:'service|en-GB',label:'Named Google speech service',language:'en-GB',networkCapable:true,approved:true}]);
 await tap('Stop voice');await tap('Speak to Bob');
 expect(bridge.startConfigured).toHaveBeenLastCalledWith(expect.any(String),'service|en-GB','en-GB',false);
 expect(mounted.root.findAllByProps({testID:'speech-network-consent'})).toHaveLength(0);
 expect(draft(mounted)).toBe(input);expect(input.props.value).toBe('Unsent draft');expect(list(mounted)).toBe(history);expect(posts).toHaveLength(0);
});

test('background or Stop while network consent is open revokes it; late Allow cannot capture',async()=>{
 const mounted=await mount(),bridge=NativeModules.BobVoiceInput as any;
 bridge.options.mockResolvedValue([{mode:'activity',key:'screen|en-GB',label:'Named screen',language:'en-GB',networkCapable:true}]);
 await tap('Start Voice Chat');
 const option=(label:string)=>mounted.root.findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0];
 const staleAllow=option('Allow and remember network speech').props.onPress;
 await tap('Stop voice');await act(async()=>{staleAllow();await flush();});expect(bridge.startConfigured).not.toHaveBeenCalled();
 await tap('Speak to Bob');const secondAllow=option('Allow and remember network speech').props.onPress;
 await act(async()=>{(AppState as any).currentState='background';for(const callback of lifecycle.get('change')??[])callback('background');await flush();secondAllow();await flush();});
 expect(bridge.startConfigured).not.toHaveBeenCalled();expect(posts).toHaveLength(0);
});

test('old consent Allow and old picker provider callbacks cannot authorize a newer dialog',async()=>{
 const mounted=await mount(),bridge=NativeModules.BobVoiceInput as any;
 bridge.options.mockResolvedValue([{mode:'platform',key:'service|en-GB',label:'Named provider',language:'en-GB',networkCapable:true}]);
 await tap('Start Voice Chat');
 const option=(label:string)=>mounted.root.findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0];
 const staleAllow=option('Allow and remember network speech').props.onPress;
 await act(async()=>{option('Cancel network speech').props.onPress();await flush();});
 await tap('Speak to Bob');
 await act(async()=>{staleAllow();await flush();});expect(bridge.startConfigured).not.toHaveBeenCalled();
 await act(async()=>{option('Cancel network speech').props.onPress();await flush();});
 await tap('Speech options');
 await act(async()=>{option('English (UK) · en-GB').props.onPress();await flush();});
 const staleProvider=option('Named provider · en-GB').props.onPress;
 await act(async()=>{option('Back to languages').props.onPress();await flush();staleProvider();await flush();});
 expect(bridge.startConfigured).not.toHaveBeenCalled();expect(mounted.root.findByProps({testID:'speech-options'})).toBeTruthy();
 await act(async()=>{option('Close speech options').props.onPress();await flush();});expect(posts).toHaveLength(0);
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

test.each(['light','dark'] as const)('actual App constrained 640px %s composer heading stays text-free through normal voice states but retains errors and recovery',async scheme=>{
 await AsyncStorage.setItem('appearance',scheme);
 jest.spyOn(require('react-native'),'useWindowDimensions').mockReturnValue({width:337,height:640,scale:1,fontScale:2});
 const alert=jest.spyOn(Alert,'alert').mockImplementation(()=>{});
 const mounted=await mount(),input=draft(mounted),history=list(mounted);
 await act(async()=>{input.props.onChangeText('Keep constrained draft');DeviceEventEmitter.emit('BobKeyboardInset',{imeBottom:280});await flush();});
 await tap('Start Voice Chat');
 const heading=()=>root(mounted).findByProps({testID:'composer-heading'});
 const normal=(phase:string)=>{
  expect(root(mounted).findByType(VoiceChatPanel).props.state.phase).toBe(phase);
  expect(StyleSheet.flatten(heading().props.style).height).toBe(48);
  expect(heading().findAllByType(NativeText)).toHaveLength(0);
  expect(heading().findByType(ChatNavigation).props.showTrigger).toBe(true);
  expect(root(mounted).findByProps({testID:'voice-chat-panel'}).findAllByType(NativeText)).toHaveLength(0);
 };
 normal('preparing');await event('listening');normal('listening');await event('finishing');normal('finishing');
 await event('final','One constrained voice turn');normal('waiting');await complete(0,125,'Constrained reply');normal('speaking');
 const audio=NativeModules.BobSpeech.speak.mock.calls.at(-1)[1];
 await act(async()=>{DeviceEventEmitter.emit('BobSpeechState',{id:audio,state:'done'});await flush();});normal('idle');
 await tap('Speak to Bob');const id=NativeModules.BobVoiceInput.startConfigured.mock.calls.at(-1)[0],message='Requested speech model is missing. Open Speech options to choose another provider.';
 await act(async()=>{DeviceEventEmitter.emit('BobVoiceInputState',{id,state:'error',message});await flush();});
 expect(root(mounted).findByProps({testID:'voice-chat-phase'}).props.children).toContain(message);
 await tap('Read full voice error');expect(alert).toHaveBeenCalledWith('Voice error',message,[{text:'Close'}]);
 await act(async()=>{markAudioCleanupUnconfirmed('Potential audio remains; retry Stop.');await flush();});
 expect(heading().findAllByType(NativeText).map(node=>node.props.children)).toContain('Audio recovery');
 expect(button(mounted,'Retry stopping playback')).toBeDefined();
 expect(draft(mounted)).toBe(input);expect(input.props.value).toBe('Keep constrained draft');expect(list(mounted)).toBe(history);expect(posts).toHaveLength(1);
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
  if(keyboard&&fontScale===2){expect(StyleSheet.flatten(root(tree!).findByProps({testID:'draft-attachment-previews'}).props.style).maxHeight).toBe(0);const heading=root(tree!).findByProps({testID:'composer-heading'});expect(StyleSheet.flatten(heading.props.style).height).toBe(48);expect(heading.findByProps({accessibilityLabel:'1 draft attachments retained; previews collapsed during voice'}).props.children).toBe('1 attached');}
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

test.each([337,361].flatMap(width=>[1,2].map(fontScale=>({width,fontScale}))))('constrained $width / scale $fontScale error opens complete visible recovery text without expanding normal chrome',async({width,fontScale})=>{
 const alert=jest.spyOn(Alert,'alert').mockImplementation(()=>{});
 jest.spyOn(require('react-native'),'useWindowDimensions').mockReturnValue({width,height:754,scale:1,fontScale});await mount();
 const input=draft(tree!),history=list(tree!);
 await act(async()=>{input.props.onChangeText('Keep this draft');await root(tree!).findByType(DrawingEditor).props.onAdd('data:image/png;base64,fixture');DeviceEventEmitter.emit('BobKeyboardInset',{imeBottom:280});await flush();});
 await tap('Start Voice Chat');const id=NativeModules.BobVoiceInput.startConfigured.mock.calls.at(-1)[0];
 const panelMax=root(tree!).findByType(VoiceChatPanel).props.maxHeight;
 expect(root(tree!).findByProps({testID:'voice-chat-panel'}).findAllByType(NativeText)).toHaveLength(0);
 expect(button(tree!,'Read full voice error')).toBeUndefined();
 const message='Requested language model is not installed. The selected provider could not complete recognition. Download the requested model in Android settings, or use Speech options to choose another language and provider. Tap the headphones to try again. Typing still works.';
 await act(async()=>{DeviceEventEmitter.emit('BobVoiceInputState',{id,state:'error',message});await flush();});
 const phase=root(tree!).findByProps({testID:'voice-chat-phase'});
 expect(phase.props.numberOfLines).toBe(2);expect(phase.props.children).toContain('tap for details');expect(phase.props.children).toContain('model is not installed');
 const disclosure=button(tree!,'Read full voice error');expect(disclosure.props.accessibilityRole).toBe('button');expect(disclosure.props.disabled).toBe(false);
 expect(disclosure.props.hitSlop).toBe(8);
 expect(root(tree!).findByType(VoiceChatPanel).props.maxHeight).toBe(panelMax);
 await tap('Read full voice error');
 // The entire message, including trailing recovery instructions, is native dialog BODY text,
 // not just a truncated label or screen-reader-only accessibility description.
 expect(alert).toHaveBeenCalledWith('Voice error',message,[{text:'Close'}]);
 expect(alert.mock.calls[0][1]).toContain('Tap the headphones to try again. Typing still works.');
 expect(StyleSheet.flatten(button(tree!,'Speech options').props.style)).toMatchObject({width:48,height:48});
 expect(button(tree!,'Stop voice')).toBeDefined();expect(button(tree!,'Exit Voice Chat')).toBeDefined();expect(posts).toHaveLength(0);
 expect(draft(tree!)).toBe(input);expect(input.props.value).toBe('Keep this draft');expect(list(tree!)).toBe(history);
});

const recoveryMatrix=[337,361].flatMap(width=>['light','dark'].flatMap(scheme=>[1,2].flatMap(fontScale=>[false,true].map(recovery=>({width,scheme,fontScale,recovery})))));
test.each(recoveryMatrix)('actual failed draft save stays visible/retryable: $width $scheme $fontScale x recovery=$recovery',async({width,scheme,fontScale,recovery})=>{
 await AsyncStorage.setItem('appearance',scheme);jest.spyOn(require('react-native'),'useWindowDimensions').mockReturnValue({width,height:754,scale:1,fontScale});
 await mount();const input=draft(tree!),history=list(tree!),editor=root(tree!).findByType(DraftInput),dismiss=jest.spyOn(require('react-native').Keyboard,'dismiss');
 await act(async()=>{input.props.onFocus();await root(tree!).findByType(DrawingEditor).props.onAdd('data:image/png;base64,fixture');DeviceEventEmitter.emit('BobKeyboardInset',{imeBottom:280});await flush();});
 await tap('Start Voice Chat');const capture=NativeModules.BobVoiceInput.startConfigured.mock.calls.at(-1)[0];
 if(recovery)await act(async()=>{DeviceEventEmitter.emit('BobVoiceInputState',{id:capture,state:'error',stopUnconfirmed:true,message:'Synthetic potential audio cleanup'});await flush();});
 const write=(AsyncStorage.setItem as jest.Mock).getMockImplementation()!;let fail=true;
 (AsyncStorage.setItem as jest.Mock).mockImplementation((key:string,value:string)=>key.startsWith('draft:')&&fail?Promise.reject(Error('Synthetic storage full')):write(key,value));
 await act(async()=>{input.props.onChangeText('KEEP THIS FAILED DRAFT');await flush();input.props.onChangeText('KEEP THIS FAILED DRAFT — EDITED');await flush();});
 const heading=root(tree!).findByProps({testID:'composer-heading'});
 expect(StyleSheet.flatten(heading.props.style).height).toBe(48);
 expect(heading.findAll(node=>node.props.accessibilityLabel==='Retry saving draft')).toHaveLength(0);
 expect(root(tree!).findByType(VoiceChatPanel).props.state.open).toBe(!recovery);
 expect(button(tree!,'Not saved. Open composer recovery')).toBeDefined();
 if(recovery)expect(button(tree!,'Retry stopping playback')).toBeDefined();else{expect(button(tree!,'Stop voice')).toBeDefined();expect(button(tree!,'Exit Voice Chat')).toBeDefined();}
 const files=root(tree!).findAllByProps({accessibilityLabel:'Remove drawing.png'}).length,dismissals=dismiss.mock.calls.length;
 await act(async()=>{button(tree!,'Not saved. Open composer recovery').props.onPress();DeviceEventEmitter.emit('BobVoiceInputState',{id:capture,state:'final',text:'LATE — MUST NOT SEND'});await flush();});
 expect(root(tree!).findByProps({testID:'composer-status-recovery'}).props.accessibilityViewIsModal).toBe(true);
 expect(root(tree!).findByProps({testID:'chat-composer'}).props.importantForAccessibility).toBe('no-hide-descendants');
 expect(root(tree!).findByProps({testID:'chat-viewport'}).props.pointerEvents).toBe('none');
 expect(button(tree!,'Retry saving draft')).toBeDefined();expect(button(tree!,'Close composer recovery')).toBeDefined();
 await tap('Retry saving draft'); // Still failing: surface and warning remain available.
 expect(button(tree!,'Close composer recovery')).toBeDefined();await tap('Close composer recovery');
 expect(button(tree!,'Not saved. Open composer recovery')).toBeDefined();
 expect(NativeModules.BobVoiceInput.startConfigured).toHaveBeenCalledTimes(1);
 await tap('Not saved. Open composer recovery');fail=false;await tap('Retry saving draft');
 expect(await AsyncStorage.getItem(`draft:${backend.backendId}:7`)).toBe('KEEP THIS FAILED DRAFT — EDITED');
 expect(root(tree!).findAllByProps({testID:'composer-status-recovery'})).toHaveLength(0);
 expect(draft(tree!)).toBe(input);expect(root(tree!).findByType(DraftInput)).toBe(editor);expect(list(tree!)).toBe(history);expect(input.props.caretHidden).toBe(false);
 expect(input.props.value).toBe('KEEP THIS FAILED DRAFT — EDITED');expect(root(tree!).findAllByProps({accessibilityLabel:'Remove drawing.png'})).toHaveLength(files);
 expect(NativeModules.BobFiles.removeAttachment).not.toHaveBeenCalled();expect(dismiss).toHaveBeenCalledTimes(dismissals);
 expect(posts).toHaveLength(0);expect(NativeModules.BobSpeech.speak).not.toHaveBeenCalled();expect(NativeModules.BobVoiceInput.startConfigured).toHaveBeenCalledTimes(1);
 if(recovery){expect(button(tree!,'Retry stopping playback')).toBeDefined();await tap('Retry stopping playback');}
 console.log('DRAFT_RECOVERY_APP',JSON.stringify({width,scheme,fontScale,recovery,warningOutsideHeading:true,retrySaved:true,editorListCaretFilesRetained:true,posts:posts.length}));
});

test('old recovery retry and close cannot act after closing/reopening or newer edits',async()=>{
 jest.spyOn(require('react-native'),'useWindowDimensions').mockReturnValue({width:337,height:754,scale:1,fontScale:2});await mount();
 const input=draft(tree!),write=(AsyncStorage.setItem as jest.Mock).getMockImplementation()!;let fail=true;
 (AsyncStorage.setItem as jest.Mock).mockImplementation((key:string,value:string)=>key.startsWith('draft:')&&fail?Promise.reject(Error('Full')):write(key,value));
 await act(async()=>{DeviceEventEmitter.emit('BobKeyboardInset',{imeBottom:280});input.props.onChangeText('old');await flush();});await tap('Not saved. Open composer recovery');
 const retry=button(tree!,'Retry saving draft').props.onPress,close=button(tree!,'Close composer recovery').props.onPress;
 await tap('Close composer recovery');await tap('Not saved. Open composer recovery');
 const writes=()=>(AsyncStorage.setItem as jest.Mock).mock.calls.filter(([key])=>key.startsWith('draft:')).length,count=writes();
 fail=false;await act(async()=>{retry();close();await flush();});expect(writes()).toBe(count);expect(button(tree!,'Close composer recovery')).toBeDefined();
 const retryBeforeEdit=button(tree!,'Retry saving draft').props.onPress;
 await act(async()=>{input.props.onChangeText('newest');await flush();retryBeforeEdit();await flush();});expect(await AsyncStorage.getItem(`draft:${backend.backendId}:7`)).toBe('newest');
 expect(posts).toHaveLength(0);
});


test.each(['load','read-only','unknown','load-read-only'] as const)('global potential-audio recovery coexists safely with a %s notice',async kind=>{
 jest.spyOn(require('react-native'),'useWindowDimensions').mockReturnValue({width:337,height:754,scale:1,fontScale:2});
 const read=(AsyncStorage.getItem as jest.Mock).getMockImplementation()!,key=`draft:${backend.backendId}:7`;let fail=kind.startsWith('load');
 await AsyncStorage.setItem(key,'ORIGINAL SAVED DRAFT');
 (AsyncStorage.getItem as jest.Mock).mockImplementation((k:string)=>k===key&&fail?Promise.reject(Error('Synthetic load failure')):read(k));
 if(kind!=='load'){
  const fetch=(globalThis.fetch as jest.Mock).getMockImplementation()!;
  (globalThis.fetch as jest.Mock).mockImplementation(async(input:any,options:any)=>{
   if(String(input).endsWith('/chats'))return{ok:true,status:200,json:async()=>({items:kind.includes('read-only')?[{id:7,meta:{profile:{id:'restricted-local',readOnly:true}}}]:[]})};
   if(String(input).endsWith('/configure')&&kind==='unknown')throw Error('Unavailable metadata');
   return fetch(input,options);
  });
 }
 await mount();const input=draft(tree!),history=list(tree!);
 await act(async()=>{DeviceEventEmitter.emit('BobKeyboardInset',{imeBottom:280});markAudioCleanupUnconfirmed('Synthetic unresolved audio; no provider activation');await flush();});
 const label=kind.startsWith('load')?'Not loaded':kind==='read-only'?'Read only':'Chat unavailable',accessibleLabel=kind==='load-read-only'?'Not loaded. Read only':label;
 const heading=root(tree!).findByProps({testID:'composer-heading'});
 expect(StyleSheet.flatten(heading.props.style).height).toBe(48);expect(heading.findAllByType(ComposerStatusRecovery)).toHaveLength(0);
 expect(button(tree!,`${accessibleLabel}. Open composer recovery`)).toBeDefined();expect(button(tree!,'Retry stopping playback')).toBeDefined();
 await tap(`${accessibleLabel}. Open composer recovery`);
 const surface=root(tree!).findByType(ComposerStatusRecovery);expect(surface.props.notices[0].message).toContain(kind.startsWith('load')?'not been overwritten':kind==='read-only'?'read-only':'capabilities unavailable');
 expect(StyleSheet.flatten(root(tree!).findByProps({testID:'composer-status-card'}).props.style).maxHeight).toBe('100%');
 expect(StyleSheet.flatten(button(tree!,'Close composer recovery').props.style)).toMatchObject({minWidth:48,minHeight:48});
 if(kind.startsWith('load')){
  expect(input.props.editable).toBe(false);await tap('Retry loading draft');expect(input.props.editable).toBe(false);
  fail=false;await tap('Retry loading draft');expect(input.props.value).toBe('ORIGINAL SAVED DRAFT');expect(input.props.editable).toBe(kind==='load');if(kind==='load-read-only'){expect(root(tree!).findByType(ComposerStatusRecovery).props.notices).toHaveLength(1);await tap('Close composer recovery');}
 }else{expect(input.props.editable).toBe(false);expect(surface.props.retry).toBeUndefined();await tap('Close composer recovery');}
 expect(draft(tree!)).toBe(input);expect(list(tree!)).toBe(history);expect(button(tree!,'Retry stopping playback')).toBeDefined();
 expect(NativeModules.BobVoiceInput.startConfigured).not.toHaveBeenCalled();expect(posts).toHaveLength(0);await tap('Retry stopping playback');
});

test('opening recovery retires pending completed-answer autoplay and never resumes on close',async()=>{
 jest.spyOn(require('react-native'),'useWindowDimensions').mockReturnValue({width:337,height:754,scale:1,fontScale:2});await mount();
 await act(async()=>{DeviceEventEmitter.emit('BobKeyboardInset',{imeBottom:280});await flush();});
 await tap('Start Voice Chat');await event('final','ONE DELIBERATE TURN');expect(posts).toHaveLength(1);
 const write=(AsyncStorage.setItem as jest.Mock).getMockImplementation()!;
 (AsyncStorage.setItem as jest.Mock).mockImplementation((key:string,value:string)=>key.startsWith('draft:')?Promise.reject(Error('Full')):write(key,value));
 await act(async()=>{draft(tree!).props.onChangeText('Separate unsaved draft');await flush();});await tap('Not saved. Open composer recovery');
 await complete(0,100,'THIS MUST NOT PLAY AFTER OVERLAY ADMISSION');await tap('Close composer recovery');
 expect(NativeModules.BobSpeech.speak).not.toHaveBeenCalled();expect(NativeModules.BobVoiceInput.startConfigured).toHaveBeenCalledTimes(1);expect(posts).toHaveLength(1);
});

test('overlay retry/open callbacks are scoped to the draft visit, including A-B-A return',async()=>{
 jest.spyOn(require('react-native'),'useWindowDimensions').mockReturnValue({width:337,height:754,scale:1,fontScale:2});await mount();
 const input=draft(tree!),write=(AsyncStorage.setItem as jest.Mock).getMockImplementation()!;let fail=true;
 (AsyncStorage.setItem as jest.Mock).mockImplementation((key:string,value:string)=>key.startsWith('draft:')&&fail?Promise.reject(Error('Full')):write(key,value));
 await act(async()=>{DeviceEventEmitter.emit('BobKeyboardInset',{imeBottom:280});input.props.onChangeText('old failed draft');await flush();});
 const open=button(tree!,'Not saved. Open composer recovery').props.onPress;await tap('Not saved. Open composer recovery');const retry=button(tree!,'Retry saving draft').props.onPress;
 await act(async()=>{root(tree!).findByType(ChatNavigation).props.onSelect('Sessions');await flush();open();await flush();});
 expect(root(tree!).findAllByType(ComposerStatusRecovery)).toHaveLength(0);
 await act(async()=>{root(tree!).findByType(AgentsScreen).props.onOpenSession(8);await flush();});
 await act(async()=>{root(tree!).findByType(ChatNavigation).props.onSelect('Sessions');await flush();root(tree!).findByType(AgentsScreen).props.onOpenSession(7);await flush();});
 fail=false;await act(async()=>{draft(tree!).props.onChangeText('newest returned draft');await flush();});await act(flush);
 const key=`draft:${backend.backendId}:7`,writes=()=>(AsyncStorage.setItem as jest.Mock).mock.calls.filter(([k])=>k===key).length,count=writes();
 await act(async()=>{retry();open();await flush();});expect(writes()).toBe(count);expect(await AsyncStorage.getItem(key)).toBe('newest returned draft');expect(posts).toHaveLength(0);
});


test('forget approval is reachable, keeps draft/list, and stale options management cannot revoke a newer capture',async()=>{
 const mounted=await mount(),input=draft(mounted),history=list(mounted),bridge=NativeModules.BobVoiceInput as any;
 await act(async()=>input.props.onChangeText('Saved draft'));
 const provider={mode:'platform',key:'google|en-GB',label:'Google speech',language:'en-GB',networkCapable:true};
 let approved=true;
 bridge.options.mockImplementation(async()=>[{...provider,approved}]);
 bridge.revokeApprovals=jest.fn(async()=>{approved=false;});
 await tap('Start Voice Chat');expect(bridge.startConfigured).toHaveBeenCalledTimes(1);
 await tap('Speech options');
 const option=(label:string)=>mounted.root.findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0];
 const staleForget=option('Forget network speech approval').props.onPress;
 await act(async()=>{staleForget();await flush();});expect(bridge.revokeApprovals).toHaveBeenCalledTimes(1);
 await tap('Speak to Bob');expect(option('Allow and remember network speech')).toBeTruthy();
 await act(async()=>{staleForget();await flush();});expect(bridge.revokeApprovals).toHaveBeenCalledTimes(1);
 expect(bridge.startConfigured).toHaveBeenCalledTimes(1);
 expect(draft(mounted)).toBe(input);expect(input.props.value).toBe('Saved draft');expect(list(mounted)).toBe(history);expect(posts).toHaveLength(0);
});


test.each(['light','dark'] as const)('Settings → Voice in %s explains recognition and icon controls without starting audio',async scheme=>{
 await AsyncStorage.setItem('appearance',scheme);const mounted=await mount(),input=draft(mounted),history=list(mounted);
 await act(async()=>input.props.onChangeText('Keep settings draft'));
 await act(async()=>{root(mounted).findByType(ChatNavigation).props.onSelect('Settings');await flush();});
 await act(async()=>{root(mounted).findByType(SettingsHome).props.onOpen('Voice');await flush();});
 expect(button(mounted,'Android text-to-speech settings')).toBeDefined();
 const help=button(mounted,'Recognition & Voice Chat');expect(StyleSheet.flatten(help.props.style).minHeight).toBeGreaterThanOrEqual(48);
 await tap('Recognition & Voice Chat');
 const text=root(mounted).findAllByType(NativeText).map(node=>node.props.children).flat().filter(value=>typeof value==='string').join(' ');
 expect(text).toContain('Bob requests a 3-second pause');expect(text).toContain('installed provider names and network approval');expect(text).toContain('Stop (square)');
 expect(NativeModules.BobVoiceInput.startConfigured).not.toHaveBeenCalled();expect(PermissionsAndroid.request).not.toHaveBeenCalled();expect(NativeModules.BobSpeech.speak).not.toHaveBeenCalled();expect(posts).toHaveLength(0);
 await act(async()=>{root(mounted).findAllByType(ChatNavigation)[0].props.onSelect('Chat');await flush();});
 expect(draft(mounted)).toBe(input);expect(input.props.value).toBe('Keep settings draft');expect(list(mounted)).toBe(history);
});

test.each([false,true])('capability checking is silent while admission stays disabled; constrained=%s',async constrained=>{
 jest.spyOn(require('react-native'),'useWindowDimensions').mockReturnValue({width:337,height:constrained?640:754,scale:1,fontScale:constrained?2:1});
 const fetch=(globalThis.fetch as jest.Mock).getMockImplementation()!;let resolve!:(value:any)=>void;
 const metadata=new Promise(done=>{resolve=done;});
 (globalThis.fetch as jest.Mock).mockImplementation(async(input:any,options:any)=>{
  if(String(input).endsWith('/chats'))return{ok:true,status:200,json:async()=>({items:[]})};
  if(String(input).endsWith('/configure'))return{ok:true,status:200,json:async()=>metadata};
  return fetch(input,options);
 });
 await mount();if(constrained)await act(async()=>{DeviceEventEmitter.emit('BobKeyboardInset',{imeBottom:280});await flush();});
 const input=draft(tree!),history=list(tree!);
 const silent=()=>{
  expect(root(tree!).findAllByType(NativeText).some(node=>React.Children.toArray(node.props.children).some(child=>typeof child==='string'&&child.includes('Checking conversation capabilities')))).toBe(false);
  expect(root(tree!).findAllByProps({accessibilityLabel:'Checking chat. Open composer recovery'})).toHaveLength(0);
 };
 silent();expect(button(tree!,'Send message').props.disabled).toBe(true);expect(input.props.editable).toBe(false);
 await act(async()=>{root(tree!).findByType(ChatNavigation).props.onSelect('Settings');await flush();});await act(async()=>{root(tree!).findByType(SettingsHome).props.onOpen('Conversation settings');await flush();});silent();
 await act(async()=>{root(tree!).findAllByType(ChatNavigation)[0].props.onSelect('Chat');await flush();resolve({});await flush();});
 expect(draft(tree!)).toBe(input);expect(list(tree!)).toBe(history);expect(input.props.editable).toBe(true);
 await act(async()=>{input.props.onChangeText('Retained draft');await flush();});
 expect(input.props.value).toBe('Retained draft');expect(button(tree!,'Send message').props.disabled).toBe(false);expect(posts).toHaveLength(0);
});
