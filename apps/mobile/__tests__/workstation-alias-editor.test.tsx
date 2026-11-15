import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {TextInput} from 'react-native';
import {WorkstationAliasEditor} from '../components/workstation-alias-editor';
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View}));
const workstation={backendId:'aaaa',name:'desktop.tail123.ts.net',alias:'Desktop'};
const button=(tree:Renderer.ReactTestRenderer,label:string)=>tree.root.findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0];
test('cancel does not save; successful save normalizes the local alias and blank restores the fallback',async()=>{
 const save=jest.fn(async()=>{}),close=jest.fn();let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<WorkstationAliasEditor workstation={workstation} onSave={save} onClose={close}/>);});
 act(()=>button(tree,'Cancel workstation alias').props.onPress());expect(save).not.toHaveBeenCalled();close.mockClear();
 act(()=>tree.root.findByType(TextInput).props.onChangeText('  Home   PC '));
 await act(async()=>button(tree,'Save workstation alias').props.onPress());expect(save).toHaveBeenCalledWith('Home PC');expect(close).toHaveBeenCalledTimes(1);
 act(()=>tree.root.findByType(TextInput).props.onChangeText('   '));await act(async()=>button(tree,'Save workstation alias').props.onPress());expect(save).toHaveBeenLastCalledWith('');
 await act(async()=>tree.unmount());
});
test('invalid or failed saves keep the editor open and preserve the entered alias',async()=>{
 const save=jest.fn(async()=>{throw Error('Storage unavailable');}),close=jest.fn();let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<WorkstationAliasEditor workstation={workstation} onSave={save} onClose={close}/>);});
 act(()=>tree.root.findByType(TextInput).props.onChangeText('x'.repeat(25)));await act(async()=>button(tree,'Save workstation alias').props.onPress());
 expect(save).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();
 act(()=>tree.root.findByType(TextInput).props.onChangeText('Studio'));await act(async()=>button(tree,'Save workstation alias').props.onPress());
 expect(close).not.toHaveBeenCalled();expect(tree.root.findByType(TextInput).props.value).toBe('Studio');
 expect(tree.root.findAll(node=>node.props.children==='Storage unavailable').length).toBeGreaterThan(0);
 await act(async()=>tree.unmount());
});
