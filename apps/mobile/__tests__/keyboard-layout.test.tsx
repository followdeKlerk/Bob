import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Platform,UIManager,StyleSheet,TextInput} from 'react-native';
jest.mock('react-native-reanimated',()=>({
 __esModule:true,default:{View:require('react-native').View,createAnimatedComponent:(component:any)=>component},
 useSharedValue:(value:number)=>require('react').useRef({value}).current,
 useEvent:(handler:any)=>handler,
 useAnimatedStyle:(read:any)=>new Proxy({},{get:(_target,key)=>read()[key],ownKeys:()=>Reflect.ownKeys(read()),getOwnPropertyDescriptor:()=>({enumerable:true,configurable:true})}),
}));
let KeyboardLayout:typeof import('../components/keyboard-layout').KeyboardLayout,KeyboardComposer:typeof import('../components/keyboard-layout').KeyboardComposer;
const version=Object.getOwnPropertyDescriptor(Platform,'Version')!;
beforeAll(()=>{
 jest.replaceProperty(Platform,'OS','android');Object.defineProperty(Platform,'Version',{configurable:true,value:34});
 jest.spyOn(UIManager,'getViewManagerConfig').mockReturnValue({} as any);
 ({KeyboardLayout,KeyboardComposer}=require('../components/keyboard-layout'));
});
afterAll(()=>{jest.restoreAllMocks();Object.defineProperty(Platform,'Version',version);});
test('UI event uses one overlap for viewport and composer, reverses immediately, and never rerenders or remounts the editor',async()=>{
 let renders=0,tree!:Renderer.ReactTestRenderer;
 function Content(){renders++;return <KeyboardComposer testID="composer" style={{bottom:300}}><TextInput testID="draft" defaultValue="Exact draft 👩🏽‍💻"/></KeyboardComposer>;}
 await act(async()=>{tree=Renderer.create(<KeyboardLayout active><Content/></KeyboardLayout>);});
 try{
  const host=tree.root.findByProps({testID:'native-keyboard-layout'}),editor=tree.root.findByProps({testID:'draft'});
  const composer=()=>tree.root.findAll(node=>node.props.testID==='composer'&&node.type!==KeyboardComposer)[0];
  const count=renders;
  for(const overlap of [0,20,140,280,120,40,0,90,260]){
   act(()=>host.props.onImeProgress({overlap}));
   expect(StyleSheet.flatten(host.props.style).paddingBottom).toBe(overlap);
   expect(StyleSheet.flatten(composer().props.style).bottom).toBe(overlap);
   expect(tree.root.findByProps({testID:'draft'})).toBe(editor);expect(renders).toBe(count);
  }
  for(const overlap of [-1,NaN,Infinity]){act(()=>host.props.onImeProgress({overlap}));expect(StyleSheet.flatten(host.props.style).paddingBottom).toBe(260);}
 }finally{await act(async()=>tree.unmount());}
});
test('opaque form clearance covers the reserved IME band during native close and reversal without hiding or moving its input',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<KeyboardLayout active clearanceColor="#e6dfcc"><TextInput testID="form-input" defaultValue="terra"/></KeyboardLayout>);});
 try{
  const host=tree.root.findByProps({testID:'native-keyboard-layout'}),editor=tree.root.findByProps({testID:'form-input'});
  const band=tree.root.findByProps({testID:'keyboard-clearance-surface'});
  expect(band.props.pointerEvents).toBe('none');expect(band.props.accessibilityElementsHidden).toBe(true);
  for(const overlap of [280,150,40,0,25,170,280]){
   act(()=>host.props.onImeProgress({overlap}));
   expect(StyleSheet.flatten(band.props.style)).toMatchObject({position:'absolute',bottom:0,left:0,right:0,height:overlap,backgroundColor:'#e6dfcc'});
   expect(StyleSheet.flatten(host.props.style).paddingBottom).toBe(overlap);
   expect(tree.root.findByProps({testID:'form-input'})).toBe(editor);
  }
 }finally{await act(async()=>tree.unmount());}
});
test('inactive retained host freezes geometry, ignores late events and resamples on reactivation without losing focus identity',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 const render=(active:boolean)=><KeyboardLayout active={active}><KeyboardComposer testID="composer"><TextInput testID="draft"/></KeyboardComposer></KeyboardLayout>;
 await act(async()=>{tree=Renderer.create(render(true));});
 try{
  const host=()=>tree.root.findByProps({testID:'native-keyboard-layout'}),editor=tree.root.findByProps({testID:'draft'});
  act(()=>host().props.onImeProgress({overlap:200}));
  await act(async()=>tree.update(render(false)));expect(host().props.imeActive).toBe(false);
  act(()=>host().props.onImeProgress({overlap:0}));expect(StyleSheet.flatten(host().props.style).paddingBottom).toBe(200);
  await act(async()=>tree.update(render(true)));act(()=>host().props.onImeProgress({overlap:100}));
  expect(StyleSheet.flatten(host().props.style).paddingBottom).toBe(100);expect(tree.root.findByProps({testID:'draft'})).toBe(editor);
 }finally{await act(async()=>tree.unmount());}
});
