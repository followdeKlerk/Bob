import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {KeyboardAvoidingView,Platform,StyleSheet} from 'react-native';
import {OverlayHost} from '../components/overlay-host';
import {ModelPicker} from '../components/model-picker';
import {SectionHeading} from '../components/section-ui';
jest.mock('../components/keyboard-layout',()=>({nativeKeyboardLayout:true,KeyboardLayout:({active,children,clearanceColor}:any)=>require('react')['createElement'](require('react-native').View,{testID:'model-native-ime-owner',active,clearanceColor},children)}));
jest.mock('../keyboard-inset',()=>({useKeyboardInset:()=>0}));
jest.mock('../components/ui/button',()=>({Button:require('react-native').Pressable}));
jest.mock('@react-native-async-storage/async-storage',()=>({getItem:jest.fn(async()=>null)}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View}));
jest.mock('lucide-react-native',()=>({Check:()=>null,Search:()=>null,Star:()=>null,X:()=>null}));
const models=[{provider:'openai',modelId:'alpha',name:'Alpha',thinkingLevels:['medium']}];
const current={model:{provider:'openai',modelId:'alpha'},thinkingLevel:'medium'};
beforeAll(()=>jest.replaceProperty(Platform,'OS','android'));
afterAll(()=>jest.restoreAllMocks());
test('hosted model uses native progress as sole overlap owner and compacts before settled IME notification without remounting search',async()=>{
 let tree!:Renderer.ReactTestRenderer;const apply=jest.fn(async()=>{}),close=jest.fn();
 await act(async()=>{tree=Renderer.create(<OverlayHost><ModelPicker visible models={models} current={current} onClose={close} onApply={apply}/></OverlayHost>);});
 try{
  const owner=tree.root.findByProps({testID:'model-native-ime-owner'});expect(owner.props.active).toBe(true);
  const panel=tree.root.findAll(n=>n.props.style&&StyleSheet.flatten(n.props.style)?.height==='94%').at(-1)!;
  expect(owner.props.clearanceColor).toBe(StyleSheet.flatten(panel.props.style).backgroundColor);
  expect(typeof owner.props.clearanceColor).toBe('string');
  const avoidance=tree.root.findByType(KeyboardAvoidingView);expect(avoidance.props.enabled).toBe(false);
  expect(StyleSheet.flatten(avoidance.props.style).paddingBottom??0).toBe(0);
  const input=tree.root.findAll(n=>n.props.accessibilityLabel==='Search models'&&typeof n.props.onChangeText==='function').at(-1)!;
  expect(tree.root.findAllByType(SectionHeading)).toHaveLength(1);
  await act(async()=>input.props.onFocus({nativeEvent:{}}));
  expect(tree.root.findAllByType(SectionHeading)).toHaveLength(0);
  expect(tree.root.findAll(n=>n.props.accessibilityLabel==='Search models'&&typeof n.props.onChangeText==='function').at(-1)).toBe(input);
  await act(async()=>input.props.onChangeText('alp'));
  expect(input.props.value).toBe('alp');expect(apply).not.toHaveBeenCalled();
  await act(async()=>input.props.onBlur({nativeEvent:{}}));
  expect(tree.root.findAllByType(SectionHeading)).toHaveLength(1);
 }finally{await act(async()=>tree.unmount());}
});
