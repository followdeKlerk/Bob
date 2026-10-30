import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {ModelPicker,type ModelOption} from '../components/model-picker';
jest.mock('../components/ui/button',()=>({Button:require('react-native').Pressable}));
jest.mock('@react-native-async-storage/async-storage',()=>{const values=new Map();return{getItem:jest.fn(async(key:string)=>values.get(key)??null),setItem:jest.fn(async(key:string,value:string)=>{values.set(key,value);}),clear:jest.fn(async()=>values.clear())};});
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View}));
jest.mock('lucide-react-native',()=>({Check:()=>null,Search:()=>null,Star:()=>null,X:()=>null}));
const models:ModelOption[]=[{provider:'openai',modelId:'alpha',name:'Alpha',thinkingLevels:['off','medium']},{provider:'other',modelId:'soul',name:'Soul',thinkingLevels:['medium','high']}];
const current={model:{provider:'openai',modelId:'alpha'},thinkingLevel:'medium'};
const find=(tree:Renderer.ReactTestRenderer,label:string)=>tree.root.findAll(n=>n.props.accessibilityLabel===label&&typeof n.props.onPress==='function')[0];
const radios=(tree:Renderer.ReactTestRenderer)=>tree.root.findAll(n=>n.props.accessibilityRole==='radio'&&n.props.accessibilityLabel?.startsWith('Select ')&&typeof n.props.onPress==='function');
beforeEach(async()=>{await AsyncStorage.clear();});
test('current model is shown above compact rows and all providers are visible initially',async()=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<ModelPicker visible models={models} current={current} onClose={()=>{}} onApply={jest.fn()}/>);});
 expect(tree.root.findAll(n=>typeof n.props.children==='string').map(n=>n.props.children).join(' ')).toContain('Current model');expect(radios(tree).map(n=>n.props.accessibilityLabel)).toEqual(['Select Alpha (openai)','Select Soul (other)']);
 await act(async()=>tree.unmount());
});
test('favourite is saved, pinned before alphabetical models, and restored after remount',async()=>{
 let tree!:Renderer.ReactTestRenderer;const props={visible:true,models,current,onClose:()=>{},onApply:jest.fn()};
 await act(async()=>{tree=Renderer.create(<ModelPicker {...props}/>);});
 await act(async()=>find(tree,'Favourite Soul (other)').props.onPress());
 expect(radios(tree)[0].props.accessibilityLabel).toBe('Select Soul (other)');
 expect(await AsyncStorage.getItem('model-favorites:v1')).toContain('soul');
 await act(async()=>tree.unmount());await act(async()=>{tree=Renderer.create(<ModelPicker {...props}/>);});
 expect(radios(tree)[0].props.accessibilityLabel).toBe('Select Soul (other)');
 await act(async()=>find(tree,'Unfavourite Soul (other)').props.onPress());
 expect(radios(tree)[0].props.accessibilityLabel).toBe('Select Alpha (openai)');
 await act(async()=>tree.unmount());
});
test('selection preserves supported thinking and applies exact model identity',async()=>{
 const apply=jest.fn(async()=>{});let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<ModelPicker visible models={models} current={current} onClose={()=>{}} onApply={apply}/>);});
 await act(async()=>find(tree,'Select Soul (other)').props.onPress());await act(async()=>find(tree,'High thinking').props.onPress());await act(async()=>find(tree,'Apply model selection').props.onPress());
 expect(apply).toHaveBeenCalledWith({model:{provider:'other',modelId:'soul'},thinkingLevel:'high'});await act(async()=>tree.unmount());
});
test('failed favourite save is reported without pinning an unsaved choice',async()=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<ModelPicker visible models={models} current={current} onClose={()=>{}} onApply={jest.fn()}/>);});
 const original=(AsyncStorage.setItem as jest.Mock).getMockImplementation()!;
 const fail=(AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(Error('Disk full'));
 await act(async()=>find(tree,'Favourite Soul (other)').props.onPress());expect(radios(tree)[0].props.accessibilityLabel).toBe('Select Alpha (openai)');expect(tree.root.findAll(n=>typeof n.props.children==='string').map(n=>n.props.children).join(' ')).toContain('Could not save favourites');fail.mockImplementation(original);await act(async()=>tree.unmount());
});
test('favourites obey search and provider filters without losing their saved identity',async()=>{
 await AsyncStorage.setItem('model-favorites:v1',JSON.stringify([JSON.stringify(['other','soul'])]));
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<ModelPicker visible models={models} current={current} onClose={()=>{}} onApply={jest.fn()}/>);});
 await act(async()=>find(tree,'openai').props.onPress());expect(radios(tree).map(n=>n.props.accessibilityLabel)).toEqual(['Select Alpha (openai)']);
 await act(async()=>find(tree,'All providers').props.onPress());
 await act(async()=>tree.root.findAll(n=>n.props.accessibilityLabel==='Search models'&&typeof n.props.onChangeText==='function')[0].props.onChangeText('soul'));
 expect(radios(tree).map(n=>n.props.accessibilityLabel)).toEqual(['Select Soul (other)']);expect(await AsyncStorage.getItem('model-favorites:v1')).toContain('soul');await act(async()=>tree.unmount());
});
