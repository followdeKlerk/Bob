import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Text} from 'react-native';
import {PhoneToolsSettings} from '../components/phone-tools-settings';
import type {PhoneToolsState} from '../phone-tools';
jest.mock('lucide-react-native',()=>new Proxy({},{get:(_,name)=>name==='__esModule'?true:()=>null}));
jest.mock('react-native-reanimated',()=>({__esModule:true,default:{View:require('react-native').View},LinearTransition:{duration:()=>({reduceMotion:()=>({})})},ReduceMotion:{System:'system'}}));
let tree:Renderer.ReactTestRenderer;
const state=(changes:Partial<PhoneToolsState>={}):PhoneToolsState=>({enabled:false,busy:false,error:'',supported:true,permissions:'Not checked',toggle:jest.fn(async()=>{}),refresh:jest.fn(async()=>{}),requestPermissions:jest.fn(async()=>{}),...changes});
async function mount(value:PhoneToolsState){await act(async()=>{tree=Renderer.create(<PhoneToolsSettings state={value}/>);});}
const control=(label:string)=>tree.root.findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0];
afterEach(async()=>{if(tree)await act(async()=>tree.unmount());});
test('offers a once-enabled control, permission action and refresh without a separate route',async()=>{
 const value=state();await mount(value);
 expect(control('Enable phone tools').props.accessibilityRole).toBe('switch');expect(control('Enable phone tools').props.accessibilityState.checked).toBe(false);
 await act(async()=>{control('Enable phone tools').props.onPress();control('Request phone tools permissions').props.onPress();control('Refresh phone tools status').props.onPress();});
 expect(value.toggle).toHaveBeenCalledTimes(1);expect(value.requestPermissions).toHaveBeenCalledTimes(1);expect(value.refresh).toHaveBeenCalledTimes(1);
 const text=tree.root.findAllByType(Text).map(node=>node.props.children).filter(value=>typeof value==='string').join(' ');
 expect(text).toContain('without asking for each command');expect(text).toContain('foreground');expect(text).toContain('configured model');expect(text).toContain('chat history');expect(text).toContain('Denied permissions affect only related tools');
});
test('enabled status is accessible and pending work locks settings actions with a visible error',async()=>{
 await mount(state({enabled:true,busy:true,error:'Could not save preference.'}));
 expect(control('Disable phone tools').props.accessibilityState).toMatchObject({checked:true,disabled:true,busy:true});
 expect(control('Request phone tools permissions').props.disabled).toBe(true);expect(control('Refresh phone tools status').props.disabled).toBe(true);
 expect(tree.root.findAllByType(Text).some(node=>node.props.children==='Could not save preference.'&&node.props.accessibilityLiveRegion==='polite')).toBe(true);
});
test('unsupported platforms cannot enable and explain the Android requirement',async()=>{
 await mount(state({supported:false}));expect(control('Enable phone tools').props.disabled).toBe(true);
 expect(tree.root.findAllByType(Text).some(node=>node.props.children==='Phone tools require the updated Android app.')).toBe(true);
 expect(tree.root.findAll(node=>node.props.accessibilityLabel==='Request phone tools permissions')).toHaveLength(0);
});
