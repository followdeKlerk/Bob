import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {AppState,NativeModules,Platform,Text} from 'react-native';
import {selectionHaptic} from '../haptics';
import {TouchTarget} from '../components/touch-target';
const originalPlatform=Platform.OS,originalState=Object.getOwnPropertyDescriptor(AppState,'currentState'),originalNative=NativeModules.BobPlatform;
beforeEach(()=>{
 Platform.OS='android';Object.defineProperty(AppState,'currentState',{configurable:true,writable:true,value:'active'});
 NativeModules.BobPlatform={selectionHaptic:jest.fn()};
});
afterEach(()=>{
 Platform.OS=originalPlatform;if(originalState)Object.defineProperty(AppState,'currentState',originalState);
 NativeModules.BobPlatform=originalNative;jest.restoreAllMocks();
});
const target=(tree:Renderer.ReactTestRenderer)=>tree.root.findAll(node=>node.type!==TouchTarget&&typeof node.props.onPressIn==='function')[0];
test('Android foreground tick is optional and never throws when unavailable',()=>{
 selectionHaptic();expect(NativeModules.BobPlatform.selectionHaptic).toHaveBeenCalledTimes(1);
 NativeModules.BobPlatform={};expect(selectionHaptic).not.toThrow();
 NativeModules.BobPlatform={selectionHaptic:()=>{throw Error('unsupported');}};expect(selectionHaptic).not.toThrow();
 NativeModules.BobPlatform=undefined;expect(selectionHaptic).not.toThrow();
});
test.each(['background','inactive','unknown'])('%s does not request tactile feedback',state=>{
 Object.defineProperty(AppState,'currentState',{configurable:true,writable:true,value:state});
 selectionHaptic();expect(NativeModules.BobPlatform.selectionHaptic).not.toHaveBeenCalled();
});
test('unsupported platforms do not fall back to a vibration',()=>{
 Platform.OS='ios';selectionHaptic();expect(NativeModules.BobPlatform.selectionHaptic).not.toHaveBeenCalled();
});
test('actual activation ticks once and invokes the action immediately; touch down and cancelled scrolling do not tick',async()=>{
 const action=jest.fn(),event={} as any;let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<TouchTarget onPress={action}><Text>Settings</Text></TouchTarget>);});
 act(()=>target(tree).props.onPressIn(event));act(()=>target(tree).props.onPressOut(event));
 expect(NativeModules.BobPlatform.selectionHaptic).not.toHaveBeenCalled();expect(action).not.toHaveBeenCalled();
 act(()=>target(tree).props.onPress(event));expect(NativeModules.BobPlatform.selectionHaptic).toHaveBeenCalledTimes(1);expect(action).toHaveBeenCalledWith(event);
 expect(NativeModules.BobPlatform.selectionHaptic.mock.invocationCallOrder[0]).toBeLessThan(action.mock.invocationCallOrder[0]);
 await act(async()=>tree.unmount());
});
test('disabled and opt-out controls do not tick; missing native support never blocks activation',async()=>{
 const action=jest.fn();let tree!:Renderer.ReactTestRenderer;
 const render=(disabled=false,haptic=true)=><TouchTarget disabled={disabled} haptic={haptic} onPress={action}/>;
 await act(async()=>{tree=Renderer.create(render(true));});act(()=>target(tree).props.onPress({}));
 expect(action).not.toHaveBeenCalled();expect(NativeModules.BobPlatform.selectionHaptic).not.toHaveBeenCalled();
 await act(async()=>tree.update(render(false,false)));act(()=>target(tree).props.onPress({}));expect(action).toHaveBeenCalledTimes(1);expect(NativeModules.BobPlatform.selectionHaptic).not.toHaveBeenCalled();
 NativeModules.BobPlatform={};await act(async()=>tree.update(render()));act(()=>target(tree).props.onPress({}));expect(action).toHaveBeenCalledTimes(2);
 await act(async()=>tree.unmount());
});
