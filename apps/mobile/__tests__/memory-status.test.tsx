import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {NativeModules,StyleSheet,Text,Pressable} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import App from '../App';
import {ModelContent} from '../components/model-content';
import {ToolContent} from '../components/tool-content';
import {colors} from '../theme';

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
jest.mock('../components/ui/text',()=>({Text:require('react-native').Text}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaProvider:require('react-native').View,SafeAreaView:require('react-native').View,useSafeAreaInsets:()=>({top:0,bottom:0,left:0,right:0})}));
jest.mock('react-native-keychain',()=>({getGenericPassword:jest.fn(async()=>false)}));
jest.mock('@react-native-async-storage/async-storage',()=>{const values=new Map();return{getItem:jest.fn(async(key:string)=>values.get(key)??null),setItem:jest.fn(async(key:string,value:string)=>{values.set(key,value);}),removeItem:jest.fn(async(key:string)=>{values.delete(key);}),getMany:jest.fn(async(keys:string[])=>Object.fromEntries(keys.map(key=>[key,values.get(key)??null]))),setMany:jest.fn(async(items:Record<string,string>)=>{for(const [key,value] of Object.entries(items))values.set(key,value);}),removeMany:jest.fn(async(keys:string[])=>{for(const key of keys)values.delete(key);}),clear:jest.fn(async()=>values.clear())};});

beforeEach(async()=>{await AsyncStorage.clear();});
afterEach(()=>jest.restoreAllMocks());
test('passive memory rows stay visible as scalable muted text without disclosure, tools or speech actions',async()=>{
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
   const texts=row.findAllByType(Text);
   expect(texts).toHaveLength(1);
   const text=texts[0],style=StyleSheet.flatten(text.props.style);
   expect(text.props.children).toBe(label);
   expect(style).toMatchObject({color:colors.muted,fontSize:13});
   for(const constraint of ['height','maxHeight','overflow','backgroundColor'])expect(style[constraint]).toBeUndefined();
   expect(text.props.allowFontScaling).not.toBe(false);
   expect(text.props.maxFontSizeMultiplier).toBeUndefined();
   expect(text.props.numberOfLines).toBeUndefined();
   // Stored history must not re-announce each recycled row as a live update.
   expect(text.props.accessibilityLiveRegion).toBeUndefined();
   expect(row.findAllByType(Pressable)).toHaveLength(0);
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
