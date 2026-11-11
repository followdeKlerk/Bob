jest.mock('react-native-reanimated',()=>({__esModule:true,default:{View:require('react-native').View,createAnimatedComponent:(component:any)=>component},LinearTransition:{duration:(duration:number)=>({reduceMotion:(reduceMotion:string)=>({duration,reduceMotion})})},ReduceMotion:{System:'system'},cancelAnimation:jest.fn(),useSharedValue:(value:any)=>require('react').useRef({value}).current,useAnimatedProps:(fn:any)=>fn(),withSpring:(value:any)=>value,withTiming:(value:any)=>value,Easing:{out:(value:any)=>value,cubic:jest.fn()}}));
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Alert,NativeModules,Text} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import App from '../App';
import {ChatNavigation} from '../components/chat-navigation';
import {SideDrawer} from '../components/side-drawer';
import {AgentsScreen} from '../components/agents-screen';
import {DraftInput} from '../components/draft-input';
import {FileAttachment} from '../components/file-attachment';
import {ConversationSettings} from '../components/conversation-settings';
import {PlusMenu} from '../components/plus-menu';
import {SkillPicker} from '../components/skill-picker';
import {LOCAL_CHAT_REMOVED} from '../retired-chat-profile';
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
const a={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://a.test.ts.net',name:'Workstation A'};
const b={backendId:'22222222-2222-4222-8222-222222222222',endpoint:'https://b.test.ts.net',name:'Workstation B'};
const legacyProfile={id:'restricted-local',label:'Old local model',restricted:true,immutable:true,configured:true};
const profile={id:'restricted-local',retired:true,readOnly:true,configured:false,label:'Retired local chat',restricted:true,immutable:true};
const response=(data:unknown)=>({ok:true,status:200,json:async()=>data}) as Response;
const deferred=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};};
let fetchMock:jest.SpyInstance;
let rows:Record<string,any[]>;
function defaultApi(input:any,options?:any){
 const url=new URL(String(input)),backend=url.host===new URL(a.endpoint).host?a:b,path=url.pathname;
 if(path.endsWith('/chats')&&options?.method==='POST')return response({id:10});
 if(path.endsWith('/chats'))return response({items:rows[backend.backendId]??[]});
 if(path.endsWith('/updates'))return response({enabled:false});
 if(path.endsWith('/configure'))return response({cwd:'/tmp',instructions:null,model:{provider:'openai',modelId:'fixture'}});
 if(path.includes('/history'))return response({backendId:backend.backendId,conversationId:Number(path.split('/')[3]),coverage:'stored-entries',items:[]});
 if(path.includes('/operations/'))return response({admission:null});
 if(path.endsWith('/messages'))return response({status:'accepted',entry:12});
 if(path.endsWith('/transfer-limits'))return response({uploadLimit:10*1024*1024});
 if(path.endsWith('/status'))return response({backendId:backend.backendId,inspection:{tasks:[],submissions:[]}});
 if(path.endsWith('/peers'))return response({inbound:[],outbound:[]});
 return response([]);
}
function button(tree:Renderer.ReactTestRenderer,label:string){return tree.root.findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0];}
async function press(tree:Renderer.ReactTestRenderer,label:string){await act(async()=>button(tree,label).props.onPress());}
async function navigate(tree:Renderer.ReactTestRenderer,destination:string){
 if(destination==='Sessions')destination='Agents';
 const menu=tree.root.findAllByType(ChatNavigation).find(node=>node.props.showTrigger!==false)!;
 await act(async()=>menu.props.onSelect(destination));
}
async function mount(chat?:number){
 await AsyncStorage.setItem('backends',JSON.stringify([a,b]));
 await AsyncStorage.setItem('selection',JSON.stringify({backendId:a.backendId,chat}));
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<App/>);});return tree;
}
async function switchBackend(tree:Renderer.ReactTestRenderer){
 await navigate(tree,'Workstations');
 const drawer=tree.root.findByType(SideDrawer);
 await act(async()=>drawer.props.workspaces.find((row:any)=>row.id===b.backendId).onPress());
 await navigate(tree,'Sessions');
}
beforeEach(async()=>{
 await AsyncStorage.clear();
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({username:'fixture-device',password:'fixture'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};
 NativeModules.BobNotifications={};NativeModules.BobFiles={removeAttachment:jest.fn(async()=>{})};delete NativeModules.BobOutbox;
 rows={[a.backendId]:[{id:7,meta:{title:'Ordinary chat'}}],[b.backendId]:[{id:7,meta:{title:'Other workstation chat'}}]};
 fetchMock=jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any,options?:any)=>defaultApi(input,options));
 jest.spyOn(Alert,'alert').mockImplementation(()=>{});
});
afterEach(()=>jest.restoreAllMocks());

const text=(tree:Renderer.ReactTestRenderer)=>tree.root.findAllByType(Text).map(node=>node.props.children).join(' ');
function snapshots(){
 let publish:((event:any)=>void)|undefined;
 require('react-native-sse').mockImplementation(()=>({addEventListener:jest.fn((event,callback)=>{if(event==='snapshot')publish=callback;}),close:jest.fn(),open:jest.fn()}));
 return async(docs:Record<string,unknown>,entries:any[]=[])=>act(async()=>publish?.({data:JSON.stringify({backendId:a.backendId,conversationId:7,view:{entries,docs}})}));
}

test('no retired integration creation/setup controls in empty chat or Sessions; ordinary New remains unchanged',async()=>{
 const tree=await mount();
 try{
  expect(button(tree,'New restricted chat')).toBeUndefined();
  expect(button(tree,'New conversation')).toBeDefined();
  await navigate(tree,'Sessions');
  expect(tree.root.findByType(AgentsScreen).props.onNewRestricted).toBeUndefined();
  expect(button(tree,'New restricted chat')).toBeUndefined();
  await act(async()=>tree.root.findByType(AgentsScreen).props.onNew());
  const create=fetchMock.mock.calls.find(([url,options])=>String(url).endsWith('/chats')&&options?.method==='POST');
  expect(JSON.parse(create![1].body)).toEqual({title:'New conversation'});
  expect(tree.root.findByType(DraftInput).props.scope).toBe(`${a.backendId}:10`);
  expect(tree.root.findByType(DraftInput).props.editable).toBe(true);
  await press(tree,'Chat actions');
  for(const label of ['Files','Camera','Gallery','Drawing','Model & thinking','More'])expect(button(tree,label)).toBeDefined();
  expect(fetchMock.mock.calls.some(([url])=>String(url).includes('chat-profiles'))).toBe(false);
 }finally{await act(async()=>tree.unmount());}
});

test.each([profile,legacyProfile,{id:'restricted-local'}])('retired and old cached profile cannot send, upload, configure or expose active controls (%j)',async savedProfile=>{
 rows[a.backendId]=[{id:7,meta:{title:'Historical chat',profile:savedProfile}}];
 const tree=await mount(7);
 try{
  expect(tree.root.findByType(DraftInput).props.editable).toBe(false);
  expect(text(tree)).toContain(LOCAL_CHAT_REMOVED);
  expect(button(tree,'Chat actions').props.disabled).toBe(true);
  await act(async()=>tree.root.findByType(DraftInput).props.onChangeText('/never send this'));
  expect(button(tree,'Send message').props.disabled).toBe(true);
  // Invoke callbacks directly as well: UI disabling alone is not a safety gate.
  await press(tree,'Send message');await press(tree,'Chat actions');
  expect(tree.root.findAllByType(SkillPicker)).toHaveLength(0);
  await navigate(tree,'Settings');
  expect(tree.root.findAllByType(ConversationSettings)).toHaveLength(0);
  for(const label of ['Model & thinking','Advanced modules','Start restricted Qwen chat','Check restricted chat setup'])expect(button(tree,label)).toBeUndefined();
  expect(text(tree)).toContain(LOCAL_CHAT_REMOVED);
  expect(fetchMock.mock.calls.some(([url,options])=>String(url).includes('/chats/7/')&&(String(url).endsWith('/messages')||String(url).endsWith('/artifacts')||String(url).endsWith('/ui')||String(url).endsWith('/modules')||options?.method==='PUT'))).toBe(false);
 }finally{await act(async()=>tree.unmount());}
});

test.each([{id:'future-profile'},{} as any,'unknown' as any,null])('unknown/malformed restored profile is fail closed (%j)',async savedProfile=>{
 rows[a.backendId]=[{id:7,meta:{title:'Unknown profile chat',profile:savedProfile}}];
 const tree=await mount(7);
 try{
  expect(tree.root.findByType(DraftInput).props.editable).toBe(false);
  expect(text(tree)).toContain('profile is unavailable or unsupported');
  await act(async()=>tree.root.findByType(DraftInput).props.onChangeText('no normal fallback'));
  await press(tree,'Send message');
  expect(fetchMock.mock.calls.some(([url])=>String(url).endsWith('/messages'))).toBe(false);
 }finally{await act(async()=>tree.unmount());}
});

test('cached historical messages remain readable even when a fresh snapshot omits the old profile',async()=>{
 const publish=snapshots();
 await AsyncStorage.setItem(`history:${a.backendId}:7`,JSON.stringify({entries:[{id:1,kind:'bob.user',data:{text:'Archived owner message'}},{id:2,kind:'pi.message',model:[{role:'assistant',content:[{type:'text',text:'Archived model response'}]}]}],docs:{'bob.profile':legacyProfile}}));
 const tree=await mount(7);
 try{
  expect(text(tree)).toContain('Archived owner message');expect(text(tree)).toContain('Archived model response');
  expect(tree.root.findByType(DraftInput).props.editable).toBe(false);
  await publish({'bob.chat':{title:'Incomplete refresh'}});
  expect(tree.root.findByType(DraftInput).props.editable).toBe(false);
  expect(text(tree)).toContain(LOCAL_CHAT_REMOVED);
 }finally{await act(async()=>tree.unmount());}
});

test('cached profile survives list refresh/rename that omits metadata and is saved back to cache',async()=>{
 await AsyncStorage.setItem(`chats:${a.backendId}`,JSON.stringify([{id:7,meta:{title:'Historical local chat',profile:legacyProfile}}]));
 fetchMock.mockImplementation(async(input:any,options?:any)=>String(input).endsWith('/chats/7/metadata')?response({id:7,meta:{title:'Renamed chat',pinned:true}}):defaultApi(input,options));
 const tree=await mount(7);
 try{
  expect(tree.root.findByType(DraftInput).props.editable).toBe(false);
  await navigate(tree,'Sessions');
  await act(async()=>tree.root.findByType(AgentsScreen).props.onSessionAction('7','rename','Renamed chat'));
  const row=JSON.parse((await AsyncStorage.getItem(`chats:${a.backendId}`))!).find((row:any)=>row.id===7);expect(row.meta.title).toBe('Renamed chat');
  expect(JSON.parse((await AsyncStorage.getItem(`chats:${a.backendId}`))!)[0].meta.profile.id).toBe('restricted-local');
  await act(async()=>tree.root.findByType(AgentsScreen).props.onOpenSession(7));expect(tree.root.findByType(DraftInput).props.editable).toBe(false);
 }finally{await act(async()=>tree.unmount());}
});

test('late profile lookup retires a notification target and no normal agent request is made while unknown',async()=>{
 const pending=deferred<Response>();rows[a.backendId]=[];
 fetchMock.mockImplementation(async(input:any,options?:any)=>String(input)===`${a.endpoint}/v1/chats/7/configure`?pending.promise:defaultApi(input,options));
 const tree=await mount(7);
 try{
  expect(tree.root.findByType(DraftInput).props.editable).toBe(false);
  await act(async()=>tree.root.findByType(DraftInput).props.onChangeText('unknown must not send'));
  await press(tree,'Send message');
  await act(async()=>pending.resolve(response({profile})));
  expect(tree.root.findByType(DraftInput).props.editable).toBe(false);expect(text(tree)).toContain(LOCAL_CHAT_REMOVED);
  expect(fetchMock.mock.calls.some(([url])=>String(url).endsWith('/messages'))).toBe(false);
 }finally{await act(async()=>tree.unmount());}
});

test('failed metadata restore (410) stays read-only rather than falling back to ordinary Bob',async()=>{
 rows[a.backendId]=[];
 fetchMock.mockImplementation(async(input:any,options?:any)=>String(input)===`${a.endpoint}/v1/chats/7/configure`?({ok:false,status:410,json:async()=>({error:'Removed integration'})} as Response):defaultApi(input,options));
 const tree=await mount(7);
 try{
  expect(tree.root.findByType(DraftInput).props.editable).toBe(false);
  expect(text(tree)).toContain('History is read-only until metadata can be restored.');
  await press(tree,'Chat actions');
  expect(fetchMock.mock.calls.some(([url])=>String(url).endsWith('/messages')||String(url).endsWith('/modules')||String(url).endsWith('/artifacts'))).toBe(false);
 }finally{await act(async()=>tree.unmount());}
});

test('late lookup from previous backend cannot retire the new backend’s same-numbered ordinary chat',async()=>{
 const pending=deferred<Response>();rows[a.backendId]=[];
 fetchMock.mockImplementation(async(input:any,options?:any)=>String(input)===`${a.endpoint}/v1/chats/7/configure`?pending.promise:defaultApi(input,options));
 const tree=await mount(7);
 try{
  expect(button(tree,'Send message').props.disabled).toBe(true);
  await switchBackend(tree);await act(async()=>tree.root.findByType(AgentsScreen).props.onOpenSession(7));
  await act(async()=>pending.resolve(response({profile})));
  expect(tree.root.findByType(DraftInput).props.scope).toBe(`${b.backendId}:7`);expect(tree.root.findByType(DraftInput).props.editable).toBe(true);
  expect(text(tree)).not.toContain(LOCAL_CHAT_REMOVED);
  await press(tree,'Chat actions');expect(button(tree,'Model & thinking')).toBeDefined();expect(button(tree,'Camera')).toBeDefined();
 }finally{await act(async()=>tree.unmount());}
});

test('late normal lookup from previous backend cannot unlock a retired chat with the same ID',async()=>{
 const pending=deferred<Response>();rows[a.backendId]=[];rows[b.backendId]=[{id:7,meta:{title:'Retired',profile}}];
 fetchMock.mockImplementation(async(input:any,options?:any)=>String(input)===`${a.endpoint}/v1/chats/7/configure`?pending.promise:defaultApi(input,options));
 const tree=await mount(7);
 try{
  await switchBackend(tree);await act(async()=>tree.root.findByType(AgentsScreen).props.onOpenSession(7));
  await act(async()=>pending.resolve(response({})));
  expect(tree.root.findByType(DraftInput).props.scope).toBe(`${b.backendId}:7`);expect(tree.root.findByType(DraftInput).props.editable).toBe(false);
  expect(text(tree)).toContain(LOCAL_CHAT_REMOVED);
 }finally{await act(async()=>tree.unmount());}
});

test('late snapshot closes ordinary controls and stale callbacks cannot send or choose files',async()=>{
 const publish=snapshots(),tree=await mount(7);
 try{
  await act(async()=>tree.root.findByType(DraftInput).props.onChangeText('stale draft'));
  const send=button(tree,'Send message').props.onPress;
  await press(tree,'Chat actions');const chooseFiles=tree.root.findByType(PlusMenu).props.onFiles;
  await publish({'bob.profile':profile});
  expect(tree.root.findByType(DraftInput).props.editable).toBe(false);
  expect(button(tree,'Chat actions').props.disabled).toBe(true);
  await act(async()=>{send();chooseFiles();});
  expect(fetchMock.mock.calls.some(([url])=>String(url).endsWith('/messages')||String(url).endsWith('/transfer-limits'))).toBe(false);
 }finally{await act(async()=>tree.unmount());}
});

test('ordinary chat still sends with subagents and exposes model, settings and agent navigation',async()=>{
 const tree=await mount(7);
 try{
  expect(tree.root.findByType(DraftInput).props.editable).toBe(true);
  await act(async()=>tree.root.findByType(DraftInput).props.onChangeText('Normal Bob message'));
  await press(tree,'Send message');
  const send=fetchMock.mock.calls.find(([url,options])=>String(url).endsWith('/chats/7/messages')&&options?.method==='POST');
  expect(JSON.parse(send![1].body)).toMatchObject({allowSubagents:true,text:'Normal Bob message'});
  await navigate(tree,'Settings');await press(tree,'Conversation settings');expect(tree.root.findAllByType(ConversationSettings)).toHaveLength(1);
  expect(button(tree,'Model & thinking')).toBeUndefined();await press(tree,'Back to previous menu');await press(tree,'Advanced');expect(button(tree,'Advanced modules')).toBeDefined();
  await navigate(tree,'Chat');
  const draft=tree.root.findByProps({accessibilityLabel:'Message draft'});
  await act(async()=>draft.props.onChangeText('Keep this draft while choosing a model'));
  await press(tree,'Chat actions');expect(button(tree,'Model & thinking')).toBeDefined();
  await press(tree,'Model & thinking');
  expect(tree.root.findAllByType(PlusMenu)).toHaveLength(0);
  const picker=tree.root.findByType(require('../components/model-picker').ModelPicker);
  expect(picker.props.visible).toBe(true);
  expect(fetchMock.mock.calls.some(([url])=>String(url).endsWith('/models'))).toBe(true);
  await act(async()=>picker.props.onClose());expect(picker.props.visible).toBe(false);
  expect(tree.root.findByProps({accessibilityLabel:'Message draft'})).toBe(draft);
  expect(draft.props.value).toBe('Keep this draft while choosing a model');
  expect(tree.root.findAllByType(ChatNavigation).find(node=>node.props.showTrigger!==false)!.props.readOnly).toBe(false);
 }finally{await act(async()=>tree.unmount());}
});

test('read-only history still paginates and its existing attachments can be previewed and saved',async()=>{
 rows[a.backendId]=[{id:7,meta:{title:'Retired history',profile}}];
 const file={id:'a841d08a-8b83-42cd-b8a7-2d61f2db7ae9',conversationId:7,name:'report.txt',mime:'text/plain',size:12,sha256:'a'.repeat(64)};
 NativeModules.BobFiles.preview=jest.fn(async()=>{});NativeModules.BobFiles.save=jest.fn(async()=>{});
 fetchMock.mockImplementation(async(input:any,options?:any)=>{
  const url=new URL(String(input));
  if(url.pathname.endsWith('/chats/7/history'))return response({backendId:a.backendId,conversationId:7,coverage:'stored-entries',items:url.searchParams.has('cursor')?[{id:1,kind:'bob.user',data:{text:'Oldest historical message'}}]:[{id:3,kind:'bob.file',data:file}],...(url.searchParams.has('cursor')?{}:{next:'older'})});
  return defaultApi(input,options);
 });
 const tree=await mount(7);
 try{
  const saved=tree.root.findByType(FileAttachment);
  await act(async()=>{saved.props.onOpen();saved.props.onSave();});
  expect(NativeModules.BobFiles.preview).toHaveBeenCalledWith(`${a.endpoint}/v1/chats/7/artifacts/${file.id}`,'fixture',a.backendId,'text/plain',10*1024*1024);
  expect(NativeModules.BobFiles.save).toHaveBeenCalled();
  await press(tree,'Load earlier messages');
  expect(text(tree)).toContain('Oldest historical message');
  expect(tree.root.findByType(DraftInput).props.editable).toBe(false);
  expect(fetchMock.mock.calls.some(([url,options])=>String(url).endsWith('/messages')||options?.method==='PUT')).toBe(false);
 }finally{await act(async()=>tree.unmount());}
});

test('draft read failure keeps the composer closed, retries without blocking history, and restores the original',async()=>{
 const key=`draft:${a.backendId}:7`,read=(AsyncStorage.getItem as jest.Mock).getMockImplementation()!;
 await AsyncStorage.setItem(key,'IRREPLACEABLE UNSENT DRAFT');
 let fail=true;
 (AsyncStorage.getItem as jest.Mock).mockImplementation((k:string)=>k===key&&fail?Promise.reject(Error('Temporary read failure')):read(k));
 const tree=await mount(7);
 try{
  expect(tree.root.findByType(DraftInput).props.editable).toBe(false);
  expect(await read(key)).toBe('IRREPLACEABLE UNSENT DRAFT');
  expect(fetchMock.mock.calls.some(([url])=>String(url).includes('/chats/7/history'))).toBe(true);
  await press(tree,'Retry loading draft');expect(tree.root.findByType(DraftInput).props.editable).toBe(false);
  expect(await read(key)).toBe('IRREPLACEABLE UNSENT DRAFT');
  fail=false;await press(tree,'Retry loading draft');
  expect(tree.root.findByType(DraftInput).props.editable).toBe(true);
  expect(tree.root.findByType(DraftInput).props.value).toBe('IRREPLACEABLE UNSENT DRAFT');
 }finally{await act(async()=>tree.unmount());(AsyncStorage.getItem as jest.Mock).mockImplementation(read);}
});
test('an obsolete draft retry cannot replace another workstation draft',async()=>{
 const key=`draft:${a.backendId}:7`,read=(AsyncStorage.getItem as jest.Mock).getMockImplementation()!,held=deferred<string>();let fail=true;
 await AsyncStorage.setItem(`draft:${b.backendId}:7`,'Other workstation draft');
 (AsyncStorage.getItem as jest.Mock).mockImplementation((k:string)=>k===key?(fail?Promise.reject(Error('Read failed')):held.promise):read(k));
 const tree=await mount(7);
 try{
  fail=false;await press(tree,'Retry loading draft');
  await switchBackend(tree);await act(async()=>tree.root.findByType(AgentsScreen).props.onOpenSession(7));
  expect(tree.root.findByType(DraftInput).props.value).toBe('Other workstation draft');
  await act(async()=>held.resolve('Old workstation draft'));
  expect(tree.root.findByType(DraftInput).props.value).toBe('Other workstation draft');
  expect(tree.root.findByType(DraftInput).props.editable).toBe(true);
 }finally{held.resolve('Old workstation draft');await act(async()=>tree.unmount());(AsyncStorage.getItem as jest.Mock).mockImplementation(read);}
});
test('failed draft save keeps in-memory text and explicit retry saves without rehydrating',async()=>{
 const key=`draft:${a.backendId}:7`,write=(AsyncStorage.setItem as jest.Mock).getMockImplementation()!;
 const tree=await mount(7);let fail=true;
 (AsyncStorage.setItem as jest.Mock).mockImplementation((k:string,value:string)=>k===key&&fail?Promise.reject(Error('Disk unavailable')):write(k,value));
 try{
  expect(tree.root.findByType(DraftInput).props.editable).toBe(true); // An absent key is not a load failure.
  await act(async()=>tree.root.findByType(DraftInput).props.onChangeText('Keep this unsaved text'));
  expect(tree.root.findByType(DraftInput).props.value).toBe('Keep this unsaved text');
  expect(button(tree,'Retry saving draft')).toBeDefined();
  fail=false;await press(tree,'Retry saving draft');
  expect(await AsyncStorage.getItem(key)).toBe('Keep this unsaved text');
  expect(tree.root.findByType(DraftInput).props.value).toBe('Keep this unsaved text');
  expect(button(tree,'Retry saving draft')).toBeUndefined();
 }finally{await act(async()=>tree.unmount());(AsyncStorage.setItem as jest.Mock).mockImplementation(write);}
});

test('unresolved saved pending-operation identity must keep Send closed',async()=>{
 const key=`pending:${a.backendId}:7`,read=(AsyncStorage.getItem as jest.Mock).getMockImplementation()!,held=deferred<string>();
 await AsyncStorage.setItem(`draft:${a.backendId}:7`,'Previously submitted text with unknown admission');
 await AsyncStorage.setItem(key,'original-uncertain-request');
 (AsyncStorage.getItem as jest.Mock).mockImplementation((k:string)=>k===key?held.promise:read(k));
 const tree=await mount(7);
 try{
  await press(tree,'Send message');
  const sends=fetchMock.mock.calls.filter(([url])=>String(url).endsWith('/messages'));
  expect(sends).toHaveLength(0);
 }finally{await act(async()=>held.resolve('original-uncertain-request'));await act(async()=>tree.unmount());(AsyncStorage.getItem as jest.Mock).mockImplementation(read);}
});

test('stale save-retry callback after A-B-A cannot overwrite the newer A draft',async()=>{
 const key=`draft:${a.backendId}:7`,write=(AsyncStorage.setItem as jest.Mock).getMockImplementation()!;
 const tree=await mount(7);let fail=true;
 (AsyncStorage.setItem as jest.Mock).mockImplementation((k:string,value:string)=>k===key&&fail?Promise.reject(Error('Disk unavailable')):write(k,value));
 try{
  await act(async()=>tree.root.findByType(DraftInput).props.onChangeText('old failed text'));
  const stale=button(tree,'Retry saving draft').props.onPress;
  fail=false;await press(tree,'Retry saving draft');
  await switchBackend(tree);await act(async()=>tree.root.findByType(AgentsScreen).props.onOpenSession(7));
  await navigate(tree,'Workstations');
  await act(async()=>tree.root.findByType(SideDrawer).props.workspaces.find((row:any)=>row.id===a.backendId).onPress());
  await navigate(tree,'Sessions');await act(async()=>tree.root.findByType(AgentsScreen).props.onOpenSession(7));
  await act(async()=>tree.root.findByType(DraftInput).props.onChangeText('newest A text'));
  expect(await AsyncStorage.getItem(key)).toBe('newest A text');
  await act(async()=>stale());
  expect(tree.root.findByType(DraftInput).props.value).toBe('newest A text');
  expect(await AsyncStorage.getItem(key)).toBe('newest A text');
 }finally{await act(async()=>tree.unmount());(AsyncStorage.setItem as jest.Mock).mockImplementation(write);}
});

test('consecutive draft writes are serialized and an older failure cannot hide the newest save',async()=>{
 const key=`draft:${a.backendId}:7`,write=(AsyncStorage.setItem as jest.Mock).getMockImplementation()!;
 const tree=await mount(7);let release!:()=>void;const held=new Promise<void>(r=>{release=r;});const entered:string[]=[];
 (AsyncStorage.setItem as jest.Mock).mockImplementation(async(k:string,value:string)=>{if(k===key){entered.push(value);if(value==='first'){await held;throw Error('First write failed');}}return write(k,value);});
 try{
  await act(async()=>tree.root.findByType(DraftInput).props.onChangeText('first'));
  await act(async()=>tree.root.findByType(DraftInput).props.onChangeText('second'));
  expect(entered).toEqual(['first']);
  await act(async()=>release());
  expect(entered).toEqual(['first','second']);expect(await AsyncStorage.getItem(key)).toBe('second');
  expect(button(tree,'Retry saving draft')).toBeUndefined();
 }finally{release();await act(async()=>tree.unmount());(AsyncStorage.setItem as jest.Mock).mockImplementation(write);}
});

test.each([false,true])('a stale save retry cannot admit captured text in the same or another scope (switch=%s)',async(changeScope)=>{
 const key=`draft:${a.backendId}:7`,write=(AsyncStorage.setItem as jest.Mock).getMockImplementation()!;
 const tree=await mount(7);let fail=true;
 (AsyncStorage.setItem as jest.Mock).mockImplementation((k:string,value:string)=>k===key&&fail?Promise.reject(Error('Disk unavailable')):write(k,value));
 try{
  await act(async()=>tree.root.findByType(DraftInput).props.onChangeText('old failed text'));
  const stale=button(tree,'Retry saving draft').props.onPress;fail=false;
  await act(async()=>tree.root.findByType(DraftInput).props.onChangeText('newest A text'));
  if(changeScope){await switchBackend(tree);await act(async()=>tree.root.findByType(AgentsScreen).props.onOpenSession(7));}
  const count=(AsyncStorage.setItem as jest.Mock).mock.calls.filter(([k])=>k===key).length;
  await act(async()=>stale());expect(await AsyncStorage.getItem(key)).toBe('newest A text');
  expect((AsyncStorage.setItem as jest.Mock).mock.calls.filter(([k])=>k===key)).toHaveLength(count);
 }finally{await act(async()=>tree.unmount());(AsyncStorage.setItem as jest.Mock).mockImplementation(write);}
});
test('pending recovery from an old scope cannot unlock or block the newly selected chat',async()=>{
 const key=`pending:${a.backendId}:7`,read=(AsyncStorage.getItem as jest.Mock).getMockImplementation()!,held=deferred<string>();
 (AsyncStorage.getItem as jest.Mock).mockImplementation((k:string)=>k===key?held.promise:read(k));
 const tree=await mount(7);
 try{
  expect(tree.root.findByType(DraftInput).props.editable).toBe(false);
  await switchBackend(tree);await act(async()=>tree.root.findByType(AgentsScreen).props.onOpenSession(7));
  expect(tree.root.findByType(DraftInput).props.editable).toBe(true);
  await act(async()=>held.resolve('original-uncertain-request'));
  expect(tree.root.findByType(DraftInput).props.editable).toBe(true);
  await act(async()=>tree.root.findByType(DraftInput).props.onChangeText('new scope message'));
  expect(button(tree,'Send message').props.disabled).toBe(false);
 }finally{held.resolve('original-uncertain-request');await act(async()=>tree.unmount());(AsyncStorage.getItem as jest.Mock).mockImplementation(read);}
});

test('streamed prose does not rebuild unchanged history linking, output placement or image decks',async()=>{
 const publish=snapshots(),tree=await mount(7);
 const functions=[jest.spyOn(require('../tool-results'),'linkToolResults'),jest.spyOn(require('../surface-placement'),'surfaceAnchors'),jest.spyOn(require('../chat-replies'),'replyOutputPlacement'),jest.spyOn(require('../image-attachment-rows'),'imageAttachmentRows')];
 const entries=Array.from({length:120},(_,i)=>({id:i+1,kind:'bob.user',data:{text:`Stored ${i}`}}));
 const live=(text:string)=>({run:{taskId:900,first:121},generation:{message:{role:'assistant',content:[{type:'text',text}]}},tools:[],nestedTools:[]});
 try{
  await publish({'pi.live':live('Start')},entries);
  const lists=()=>tree.root.findAllByType(require('react-native').FlatList).find(n=>n.props.testID==='chat-history-list')!;
  const before=lists(),old=before.props.data.find((e:any)=>e.id===100);
  for(const fn of functions)fn.mockClear();
  for(let i=1;i<=20;i++)await publish({'pi.live':live(`Reply ${i}`)},entries);
  expect(lists()).toBe(before);expect(lists().props.data.find((e:any)=>e.id===100)).toBe(old);
  expect(lists().props.data[0].displayKey).toBe('generation:900');
  expect(lists().props.data[0].model[0].content[0].text).toBe('Reply 20');
  expect(functions.map(fn=>fn.mock.calls.length)).toEqual([0,0,0,0]);
  await publish({'pi.live':{tools:[],nestedTools:[]}},[...entries,{id:121,kind:'pi.assistant',byTaskId:900,model:[{role:'assistant',content:[{type:'text',text:'Final answer'}]}]}]);
  expect(lists()).toBe(before);expect(lists().props.data[0].displayKey).toBe('generation:900');
  expect(lists().props.data.filter((e:any)=>e.displayKey==='generation:900')).toHaveLength(1);
  expect(lists().props.data[0].liveResponse).toBeUndefined();expect(lists().props.data.find((e:any)=>e.id===100)).toBe(old);
  expect(functions.slice(0,3).map(fn=>fn.mock.calls.length)).toEqual([1,1,1]);
  // Ending a run also refreshes surface membership; image placement may update
  // again for that independent response, unlike the prose-only token path.
  expect(functions[3]).toHaveBeenCalled();
 }finally{await act(async()=>tree.unmount());}
});
