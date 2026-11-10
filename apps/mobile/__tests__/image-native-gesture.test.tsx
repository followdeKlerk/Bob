import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import * as RN from 'react-native';
import {Animated,AppState,PanResponder,Platform,UIManager} from 'react-native';
jest.mock('lucide-react-native',()=>new Proxy({},{get:(_,name)=>name==='__esModule'?true:()=>null}));
jest.mock('../chat-motion',()=>({useChatMotion:()=>true}));
Platform.OS='android';
jest.spyOn(UIManager,'getViewManagerConfig').mockImplementation(()=>({}) as any);
jest.spyOn(RN,'requireNativeComponent').mockImplementation(name=>name as any);
jest.spyOn(Animated,'createAnimatedComponent').mockImplementation(component=>component as any);
const {ImageAttachmentStack}=require('../components/image-attachment-stack');
const images=[{id:'a',name:'A.png',source:{uri:'https://test.invalid/a',headers:{Authorization:'Bearer TEST'}}},{id:'b',name:'B.png',source:{uri:'https://test.invalid/b'}}];
let tree:Renderer.ReactTestRenderer|undefined;
const originalState=Object.getOwnPropertyDescriptor(AppState,'currentState');
beforeEach(()=>{jest.clearAllMocks();jest.spyOn(Animated,'event').mockImplementation(()=>jest.fn());Object.defineProperty(AppState,'currentState',{configurable:true,writable:true,value:'active'});});
afterEach(async()=>{if(tree)await act(async()=>tree!.unmount());tree=undefined;jest.restoreAllMocks();if(originalState)Object.defineProperty(AppState,'currentState',originalState);});
const guard=()=>tree!.root.findByType('BobImageGesture' as any);
// Native props/driver contract only. The parent verifies actual interception and
// UI-thread drag against Android's real inverted ScrollView with diagonal input.
test('native guard drives translation directly, without per-move JS setValue',async()=>{
 const pan=jest.spyOn(PanResponder,'create');
 await act(async()=>{tree=Renderer.create(<ImageAttachmentStack images={images} onOpen={jest.fn()}/>);});
 expect(guard().props).toMatchObject({gestureEnabled:true,trackDrag:true,gestureKey:0});
 expect(typeof guard().props.onMoveShouldSetResponderCapture).toBe('function');
 expect(Animated.event).toHaveBeenCalledWith([{nativeEvent:{translationX:expect.anything()}}],{useNativeDriver:true});
 const value=(jest.mocked(Animated.event).mock.calls[0][0][0] as any).nativeEvent.translationX as Animated.Value;
 const set=jest.spyOn(value,'setValue');set.mockClear();const callbacks=pan.mock.calls[0][0];
 await act(async()=>{callbacks.onPanResponderGrant?.({} as any,{} as any);callbacks.onPanResponderMove?.({} as any,{dx:-80,dy:15,numberActiveTouches:1} as any);});
 expect(set).not.toHaveBeenCalled();expect(callbacks.onShouldBlockNativeResponder?.({} as any,{} as any)).toBe(true);
});
test('native epoch revokes changed sources without remounting, and does not receive auth metadata',async()=>{
 const render=(items=images,active=true)=><ImageAttachmentStack images={items} active={active} onOpen={jest.fn()}/>;
 await act(async()=>{tree=Renderer.create(render());});const initial=guard(),epoch=initial.props.gestureKey;
 await act(async()=>tree!.update(render([{...images[0],source:{uri:'https://other.invalid/a'}},images[1]])));
 expect(guard()===initial).toBe(true);expect(guard().props.gestureKey).toBeGreaterThan(epoch);expect(typeof guard().props.gestureKey).toBe('number');
 expect(guard().props).not.toHaveProperty('source');expect(guard().props).not.toHaveProperty('backend');
 await act(async()=>tree!.update(render(images,false)));expect(guard().props.gestureEnabled).toBe(false);
 await act(async()=>tree!.update(render(images.slice(0,1))));expect(guard().props.gestureEnabled).toBe(false);
});
test('settling disables the native gesture boundary until the new image commits',async()=>{
 let finish!:({finished}:{finished:boolean})=>void;
 jest.spyOn(Animated,'timing').mockReturnValue({start:callback=>{finish=callback!;},stop:jest.fn(),reset:jest.fn()});
 await act(async()=>{tree=Renderer.create(<ImageAttachmentStack images={images} onOpen={jest.fn()}/>);});
 await act(async()=>tree!.root.findByProps({accessibilityLabel:'Next image'}).props.onPress());expect(guard().props.gestureEnabled).toBe(false);
 await act(async()=>finish({finished:true}));expect(guard().props.gestureEnabled).toBe(true);expect(tree!.root.findByProps({testID:'image-stack-front'}).props.accessibilityLabel).toBe('Open B.png');
});

test('a real width change cancels the native gesture epoch without replacing its view',async()=>{
 await act(async()=>{tree=Renderer.create(<ImageAttachmentStack images={images} onOpen={jest.fn()}/>);});
 const initial=guard(),epoch=initial.props.gestureKey;
 await act(async()=>tree!.root.findByProps({testID:'image-attachment-stack'}).props.onLayout({nativeEvent:{layout:{width:220}}}));
 expect(guard()===initial).toBe(true);expect(guard().props.gestureKey).toBeGreaterThan(epoch);
});
