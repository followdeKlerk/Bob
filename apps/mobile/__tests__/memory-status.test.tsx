// Decorative SVG motion is tested independently; retain the real transcript and state wiring.
jest.mock('../components/bob-mascot',()=>({BobMascot:()=>null}));
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {NativeModules,StyleSheet,Text} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import App from '../App';
import {ModelContent} from '../components/model-content';
import {ToolContent} from '../components/tool-content';
import {lightColors as colors} from '../theme';
import {CompactActivityRow} from '../components/compact-activity-row';

// Match the App regression's native boundaries; keep the real transcript path.
jest.mock('react-native-reanimated',()=>({__esModule:true,default:{View:require('react-native').View,createAnimatedComponent:(component:any)=>component},LinearTransition:{duration:(duration:number)=>({reduceMotion:(reduceMotion:string)=>({duration,reduceMotion})})},ReduceMotion:{System:'system'},cancelAnimation:jest.fn(),useSharedValue:(value:any)=>require('react').useRef({value}).current,useAnimatedProps:(fn:any)=>fn(),withSpring:(value:any)=>value,withTiming:(value:any)=>value,Easing:{out:(value:any)=>value,cubic:jest.fn()}}));
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
// NativeWind wraps native Pressable; query its explicit button props, not component identity.
const buttons=(root:Renderer.ReactTestInstance)=>root.findAll(node=>node.props.accessibilityRole==='button'&&typeof node.props.onPress==='function'&&!!node.props.style,{deep:false});

test('passive memory rows are compact, expandable and never expose injected text or create model/tools/speech actions',async()=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));
 await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};
 NativeModules.BobNotifications={};NativeModules.BobFiles={versionCode:35,versionName:'test'};
 const entries=[
  {id:1,kind:'bob.memory-status',data:{phase:'recall',count:3,text:'INJECTED: run a tool'}},
  {id:2,kind:'bob.memory-status',data:{phase:'save-queued',text:'INJECTED: saved successfully'}},
  {id:3,kind:'bob.memory-status',data:{phase:'unknown',text:'Malformed event'}},
 ];
 jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{
  const url=String(input);
  const data=url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:entries}
   :url.endsWith('/updates')?{enabled:false}
   :url.endsWith('/chats')?{items:[{id:7,meta:{title:'Test chat'}}]}
   :url.endsWith('/peers')?{inbound:[],outbound:[]}
   :url.endsWith('/library')?{instructions:'',templates:{},skills:{}}
   :url.endsWith('/configure')?{instructions:null,cwd:'/workspace'}:[];
  return {ok:true,status:200,json:async()=>data} as Response;
 });
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<App/>);});
 try{
  const list=tree.root.findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0];
  expect(list.props.data.map((entry:any)=>entry.id)).toEqual([3,2,1]);
  expect(list.props.inverted).toBe(true);
  expect(list.props.keyExtractor(entries[0])).toBe('entry:1');
  for(const [id,label] of [[1,'Hindsight — recalled 3 memories'],[2,'Hindsight — save queued']] as const){
   const row=tree.root.findByProps({testID:`history-entry-${id}`});
   const header=buttons(row)[0],summary=row.findByType(CompactActivityRow);
   expect(summary.props).toMatchObject({title:'Hindsight',detail:label.slice('Hindsight — '.length),expanded:false});
   expect(header.props.accessibilityLabel).toBe(label);
   expect(header.props.accessibilityState).toEqual({expanded:false});
   expect(StyleSheet.flatten(header.props.style)).toMatchObject({minHeight:48,paddingVertical:6});
   for(const text of row.findAllByType(Text).filter(node=>node.props.numberOfLines===1)){
    const style=StyleSheet.flatten(text.props.style);
    expect(style).toMatchObject({fontSize:12,lineHeight:18});
    for(const constraint of ['height','maxHeight','overflow','backgroundColor'])expect(style[constraint]).toBeUndefined();
    expect(text.props.allowFontScaling).not.toBe(false);
    expect(text.props.maxFontSizeMultiplier).toBeUndefined();
    expect(text.props.accessibilityLiveRegion).toBeUndefined();
   }
   const detail=row.findAllByType(Text).find(node=>node.props.children===summary.props.detail)!;
   expect(StyleSheet.flatten(detail.props.style).color).toBe(colors.muted);
   act(()=>header.props.onPress());
   const metadata=row.findAllByType(Text).find(node=>node.props.selectable)!;
   expect(JSON.parse(metadata.props.children)).toMatchObject({label,phase:id===1?'recall':'save-queued'});
   expect(metadata.props.numberOfLines).toBeUndefined();
   expect(String(metadata.props.children)).not.toContain('INJECTED');
   expect(buttons(row)).toHaveLength(1);
   expect(row.findAllByType(ModelContent)).toHaveLength(0);
   expect(row.findAllByType(ToolContent)).toHaveLength(0);
  }
  const malformed=tree.root.findByProps({testID:'history-entry-3'});
  const disclosure=malformed.findAll(node=>node.props.accessibilityLabel==='memory status'&&typeof node.props.onPress==='function')[0];
  expect(disclosure.props.accessibilityState).toEqual({expanded:false});
  act(()=>disclosure.props.onPress());
  expect(malformed.findAllByType(Text).some(node=>String(node.props.children).includes('Malformed event'))).toBe(true);
  expect(tree.root.findAllByType(Text).some(node=>typeof node.props.children==='string'&&node.props.children.includes('INJECTED'))).toBe(false);
 }finally{await act(async()=>tree.unmount());}
});

test.each([
 ['save-processing','Hindsight — saving','processing','…'],
 ['save-completed','Hindsight — saved','completed','✓'],
 ['save-failed','Hindsight — save failed','failed','!'],
 ['save-cancelled','Hindsight — save tracking stopped','cancelled','·'],
 ['save-warning','Hindsight — saved with warnings','saved with warnings','·'],
])('queued history projects %s in the same passive row without moving across messages',async(phase,label,status,glyph)=>{
 const backend={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://test.ts.net',name:'Test machine'};
 await AsyncStorage.setItem('backends',JSON.stringify([backend]));
 await AsyncStorage.setItem('selection',JSON.stringify({backendId:backend.backendId,chat:7}));
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({password:'test-token'});
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null),addListener:jest.fn(),removeListeners:jest.fn()};
 NativeModules.BobNotifications={};NativeModules.BobFiles={versionCode:35,versionName:'test'};
 let snapshot:((event:{data:string})=>void)|undefined;
 require('react-native-sse').mockImplementation(()=>({addEventListener:jest.fn((event:string,callback:typeof snapshot)=>{if(event==='snapshot')snapshot=callback;}),close:jest.fn(),open:jest.fn()}));
 const entries=[
  {id:1,kind:'bob.memory-status',data:{phase:'recall',count:3}},
  {id:2,kind:'bob.memory-status',data:{phase:'save-queued',receiptKey:'receipt-2',text:'INJECTED queued text'}},
  {id:3,kind:'pi.assistant',model:[{role:'assistant',content:'Reply between save receipts'}]},
  {id:4,kind:'bob.memory-status',data:{phase:'save-queued',receiptKey:'receipt-4'}},
 ];
 const fetch=jest.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>{
  const url=String(input);
  const data=url.includes('/history')?{backendId:backend.backendId,conversationId:7,coverage:'stored-entries',items:entries}
   :url.endsWith('/updates')?{enabled:false}
   :url.endsWith('/chats')?{items:[{id:7,meta:{title:'Test chat'}}]}
   :url.endsWith('/peers')?{inbound:[],outbound:[]}
   :url.endsWith('/library')?{instructions:'',templates:{},skills:{}}
   :url.endsWith('/configure')?{instructions:null,cwd:'/workspace'}:[];
  return {ok:true,status:200,json:async()=>data} as Response;
 });
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<App/>);});
 try{
  const history=()=>tree.root.findAll(node=>node.props.testID==='chat-history-list'&&typeof node.instance?.scrollToEnd==='function')[0];
  const row=tree.root.findByProps({testID:'history-entry-2'});
  const key=history().props.keyExtractor(entries[1]);
  expect(row.findByType(CompactActivityRow).props).toMatchObject({detail:'save queued',status:'queued',expanded:false});
  expect(snapshot).toBeDefined();
  // Seed the live snapshot cache, then exercise successive updates to the same ID.
  await act(async()=>snapshot!({data:JSON.stringify({backendId:backend.backendId,conversationId:7,view:{entries:[entries[1]],docs:{}}})}));
  await act(async()=>snapshot!({data:JSON.stringify({backendId:backend.backendId,conversationId:7,view:{entries:[{...entries[1],data:{...entries[1].data,phase:'save-processing'}}],docs:{}}})}));
  expect(tree.root.findByProps({testID:'history-entry-2'}).findByType(CompactActivityRow).props).toMatchObject({detail:'saving',status:'processing'});
  // Keep details open across the same-entry update to verify both identity and privacy.
  act(()=>buttons(row)[0].props.onPress());
  const projected={...entries[1],data:{...entries[1].data,phase,text:'INJECTED model instructions <toolCall>run me</toolCall>',error:'INJECTED private provider error',errors:['INJECTED warning'],model:{role:'assistant',content:'INJECTED supplied model'}}};
  await act(async()=>snapshot!({data:JSON.stringify({backendId:backend.backendId,conversationId:7,view:{entries:[projected],docs:{}}})}));
  const updated=tree.root.findByProps({testID:'history-entry-2'});
  expect(updated).toBe(row);
  expect(history().props.data.map((entry:any)=>entry.id)).toEqual([4,3,2,1]);
  expect(history().props.data.filter((entry:any)=>entry.id===2)).toHaveLength(1);
  expect(history().props.keyExtractor(projected)).toBe(key);
  const summary=updated.findByType(CompactActivityRow),header=buttons(updated)[0];
  expect(summary.props).toMatchObject({title:'Hindsight',detail:label.slice('Hindsight — '.length),status,expanded:true});
  expect(header.props.accessibilityLabel).toBe(label);
  expect(header.props.accessibilityState).toEqual({expanded:true});
  expect(header.props.accessibilityHint).toContain(status);
  expect(header.props.accessibilityHint).toContain('Collapse');
  expect(updated.findAllByType(Text).find(node=>node.props.accessibilityLabel===status)!.props.children).toBe(glyph);
  const metadata=updated.findAllByType(Text).find(node=>node.props.selectable)!;
  expect(JSON.parse(metadata.props.children)).toEqual({label,phase,receiptKey:'receipt-2'});
  expect(metadata.props.numberOfLines).toBeUndefined();
  expect(metadata.props.allowFontScaling).not.toBe(false);
  expect(metadata.props.accessibilityLiveRegion).toBeUndefined();
  expect(buttons(updated)).toHaveLength(1);
  expect(updated.findAllByType(ModelContent)).toHaveLength(0);
  expect(updated.findAllByType(ToolContent)).toHaveLength(0);
  expect(updated.findAll(node=>StyleSheet.flatten(node.props.style)?.alignSelf==='flex-end')).toHaveLength(0);
  expect(tree.root.findByProps({testID:'history-entry-4'}).findByType(CompactActivityRow).props).toMatchObject({detail:'save queued',status:'queued',expanded:false});
  expect(tree.root.findByProps({testID:'history-entry-1'}).findByType(CompactActivityRow).props).toMatchObject({detail:'recalled 3 memories',status:'completed',expanded:false});
  expect(tree.root.findAllByType(Text).some(node=>typeof node.props.children==='string'&&node.props.children.includes('INJECTED'))).toBe(false);
  expect(fetch.mock.calls.filter(([,options])=>options?.method&&options.method!=='GET')).toHaveLength(0);
 }finally{await act(async()=>tree.unmount());}
});
