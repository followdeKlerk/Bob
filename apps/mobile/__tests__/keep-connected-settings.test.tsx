import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Text} from 'react-native';
import {KeepConnectedSettings} from '../components/keep-connected-settings';
import type {KeepConnectedState} from '../keep-connected';
jest.mock('lucide-react-native',()=>new Proxy({},{get:(_,name)=>name==='__esModule'?true:()=>null}));
jest.mock('react-native-reanimated',()=>({__esModule:true,default:{View:require('react-native').View},LinearTransition:{duration:()=>({reduceMotion:()=>({})})},ReduceMotion:{System:'system'}}));
let tree:Renderer.ReactTestRenderer|undefined;
const state=(patch:Partial<KeepConnectedState>={}):KeepConnectedState=>({enabled:false,running:false,status:'off',batteryRestricted:true,busy:false,error:'',supported:true,canEnable:true,toggle:jest.fn(async()=>{}),refresh:jest.fn(async()=>{}),openBatterySettings:jest.fn(async()=>{}),...patch});
const control=(label:string)=>tree!.root.findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0];
const text=()=>tree!.root.findAllByType(Text).map(node=>node.props.children).filter(value=>typeof value==='string').join(' ');
async function mount(value:KeepConnectedState){await act(async()=>{tree=Renderer.create(<KeepConnectedSettings state={value}/>);});}
afterEach(async()=>{if(tree)await act(async()=>tree!.unmount());tree=undefined;});
test('accessible opt-in has normal-flow battery and refresh controls and honest locked-phone boundaries',async()=>{
 const value=state();await mount(value);expect(control('Enable keep connected').props.accessibilityRole).toBe('switch');expect(control('Enable keep connected').props.accessibilityState.checked).toBe(false);
 await act(async()=>{control('Enable keep connected').props.onPress();control('Keep connected battery settings').props.onPress();control('Refresh connection status').props.onPress();});expect(value.toggle).toHaveBeenCalledTimes(1);expect(value.openBatterySettings).toHaveBeenCalledTimes(1);expect(value.refresh).toHaveBeenCalledTimes(1);
 expect(text()).toContain('persistent Android notification');expect(text()).toContain('full transcript catches up');expect(text()).toContain('does not allow phone tools while locked');expect(text()).toContain('force-stop');expect(text()).toContain('Tailscale');
});
test('enabled connection and errors are announced, with busy controls disabled',async()=>{
 await mount(state({enabled:true,running:true,status:'reconnecting',busy:true,error:'Pair this phone again.'}));expect(control('Disable keep connected').props.accessibilityState).toMatchObject({checked:true,disabled:true,busy:true});expect(text()).toContain('Offline · reconnecting');expect(control('Refresh connection status').props.disabled).toBe(true);
 expect(tree!.root.findAllByType(Text).some(node=>node.props.children==='Pair this phone again.'&&node.props.accessibilityLiveRegion==='polite')).toBe(true);
});
test('no conversation cannot enable but existing opt-in remains possible to turn off',async()=>{
 await mount(state({canEnable:false}));expect(control('Enable keep connected').props.disabled).toBe(true);expect(text()).toContain('open a conversation before enabling');await act(async()=>tree!.update(<KeepConnectedSettings state={state({canEnable:false,enabled:true})}/>));expect(control('Disable keep connected').props.disabled).toBe(false);expect(text()).toContain('Paused · open a conversation');
});
test('unsupported app explains the Android requirement and has no battery/refresh actions',async()=>{
 await mount(state({supported:false}));expect(control('Enable keep connected').props.disabled).toBe(true);expect(text()).toContain('updated Android app');expect(control('Keep connected battery settings')).toBeUndefined();expect(control('Refresh connection status')).toBeUndefined();
});

test('accepted launch shows Connecting before Android publishes the foreground service',async()=>{
 await mount(state({enabled:true,running:false,status:'connecting'}));expect(text()).toContain('Connecting');expect(text()).not.toContain('Paused ·');
});
