import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {readOnlyProfile,conversationProfileRecord,useConversationProfile,type ProfileRecord} from '../retired-chat-profile';
import {PlusMenu} from '../components/plus-menu';
import {ChatNavigation} from '../components/chat-navigation';
jest.mock('lucide-react-native',()=>new Proxy({},{get:(_,name)=>name==='__esModule'?true:()=>null}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View,useSafeAreaInsets:()=>({top:0,bottom:0,left:0,right:0})}));
jest.mock('../components/ui/button',()=>({Button:require('react-native').Pressable}));
jest.mock('../components/ui/text',()=>({Text:require('react-native').Text,TextClassContext:require('react').createContext(undefined)}));
const retired={profile:{id:'restricted-local'}};
const deferred=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};};
let current:ReturnType<typeof useConversationProfile>;
function Harness({scope,known,load}:{scope:string;known?:ProfileRecord;load:()=>Promise<ProfileRecord>}){current=useConversationProfile(scope,known,load);return null;}

test('only ordinary Bob metadata is writable; cached, retired, unknown and malformed profiles fail closed',()=>{
 expect(readOnlyProfile(undefined)).toBe(false);expect(readOnlyProfile({id:'normal'})).toBe(false);
 for(const value of [{id:'restricted-local',configured:true},{id:'future-profile'},{id:'normal',readOnly:true},{id:'normal',retired:true},{id:'normal',restricted:true},{},null,[],42,'normal'])expect(readOnlyProfile(value)).toBe(true);
 expect(conversationProfileRecord({},{profile:{id:'normal'}},retired)).toBe(retired);
 expect(conversationProfileRecord(retired,{})).toBe(retired);
});

test('late retirement read cannot cross a backend switch, including a switch back to the original ID',async()=>{
 const first=deferred<ProfileRecord>(),second=deferred<ProfileRecord>();let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<Harness scope="backend-a:7" load={()=>first.promise}/>);});
 expect(current.known).toBe(false);
 await act(async()=>tree.update(<Harness scope="backend-b:7" known={retired} load={async()=>({})}/>));
 expect(readOnlyProfile(current.profile)).toBe(true);
 await act(async()=>tree.update(<Harness scope="backend-a:7" load={()=>second.promise}/>));
 await act(async()=>first.resolve(retired));expect(current.known).toBe(false);
 await act(async()=>second.resolve({}));expect(current.known).toBe(true);expect(readOnlyProfile(current.profile)).toBe(false);
 await act(async()=>tree.unmount());
});

test('retirement evidence is sticky within its scope but does not label a new ordinary conversation',async()=>{
 let tree!:Renderer.ReactTestRenderer;const load=jest.fn(async()=>({}));
 await act(async()=>{tree=Renderer.create(<Harness scope="a:7" known={retired} load={load}/>);});
 await act(async()=>tree.update(<Harness scope="a:7" known={{}} load={load}/>));
 expect(readOnlyProfile(current.profile)).toBe(true);expect(load).not.toHaveBeenCalled();
 await act(async()=>tree.update(<Harness scope="a:8" known={{}} load={load}/>));
 expect(current.known).toBe(true);expect(readOnlyProfile(current.profile)).toBe(false);
 await act(async()=>tree.unmount());
});

test('malformed metadata restore never grants ordinary capabilities',async()=>{
 for(const value of [null,[],42]){
  let tree!:Renderer.ReactTestRenderer;
  await act(async()=>{tree=Renderer.create(<Harness scope="a:7" load={async()=>value as any}/>);});
  expect(current.known).toBe(false);expect(current.error).toContain('History is read-only');
  await act(async()=>tree.unmount());
 }
});

function button(tree:Renderer.ReactTestRenderer,label:string){return tree.root.findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0];}
test('ordinary plus menu retains its full actions without a special attachment policy',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 const props={bottom:0,maxHeight:500,disabled:false,onCamera:jest.fn(),onGallery:jest.fn(),onFiles:jest.fn(),onDrawing:jest.fn(),onModel:jest.fn(),onMore:jest.fn()};
 await act(async()=>{tree=Renderer.create(<PlusMenu {...props}/>);});
 for(const label of ['Files','More','Camera','Gallery','Drawing','Model & thinking'])expect(button(tree,label)).toBeDefined();
 act(()=>button(tree,'Files').props.onPress());expect(props.onFiles).toHaveBeenCalledTimes(1);
 await act(async()=>tree.unmount());
});
test('read-only navigation retains session access while suppressing its active-agent badge',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 const props={open:true,onOpen:jest.fn(),onClose:jest.fn(),onSelect:jest.fn(),activeAgentCount:4};
 await act(async()=>{tree=Renderer.create(<ChatNavigation {...props} readOnly/>);});
 expect(button(tree,'Agents and Sessions')).toBeDefined();expect(tree.root.findAllByProps({testID:'chat-menu-agent-badge'})).toHaveLength(0);
 expect(button(tree,'Sessions')).toBeUndefined();expect(button(tree,'Settings')).toBeDefined();
 await act(async()=>tree.update(<ChatNavigation {...props}/>));
 expect(button(tree,'Agents and Sessions')).toBeDefined();expect(tree.root.findAllByProps({testID:'chat-menu-agent-badge'}).length).toBeGreaterThan(0);
 await act(async()=>tree.unmount());
});
