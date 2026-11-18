import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {DeviceEventEmitter,NativeModules,Platform,Text} from 'react-native';
import {useKeyboardInset} from '../keyboard-inset';
const deferred=()=>{let resolve!:(value:number)=>void,reject!:(error:Error)=>void;const promise=new Promise<number>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function Probe(){return <Text testID="inset">{useKeyboardInset()}</Text>;}
beforeEach(()=>jest.replaceProperty(Platform,'OS','android'));
afterEach(()=>jest.restoreAllMocks());
test('new subscribers receive the settled native inset, but a newer event wins over late initialization',async()=>{
 const pending=deferred();NativeModules.BobKeyboard={enable:jest.fn(()=>pending.promise)};let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<Probe/>);});
 act(()=>DeviceEventEmitter.emit('BobKeyboardInset',{imeBottom:240}));await act(async()=>pending.resolve(0));
 expect(tree.root.findByProps({testID:'inset'}).props.children).toBe(240);
 for(const value of [NaN,Infinity,'123',undefined])act(()=>DeviceEventEmitter.emit('BobKeyboardInset',{imeBottom:value}));
 expect(tree.root.findByProps({testID:'inset'}).props.children).toBe(240);
 await act(async()=>tree.unmount());
 NativeModules.BobKeyboard.enable.mockResolvedValue(180);
 await act(async()=>{tree=Renderer.create(<Probe/>);});expect(tree.root.findByProps({testID:'inset'}).props.children).toBe(180);await act(async()=>tree.unmount());
});
test('native initialization failure does not invent a keyboard hide or update an unmounted hook',async()=>{
 const pending=deferred();NativeModules.BobKeyboard={enable:jest.fn(()=>pending.promise)};let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<Probe/>);});act(()=>DeviceEventEmitter.emit('BobKeyboardInset',{imeBottom:220}));
 await act(async()=>pending.reject(Error('unavailable')));expect(tree.root.findByProps({testID:'inset'}).props.children).toBe(220);await act(async()=>tree.unmount());
});
