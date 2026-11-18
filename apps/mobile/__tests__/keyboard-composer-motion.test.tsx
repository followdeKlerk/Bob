import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Platform,UIManager,StyleSheet,View} from 'react-native';
jest.mock('react-native-reanimated',()=>({
 __esModule:true,default:{View:require('react-native').View,createAnimatedComponent:(component:any)=>component},
 LinearTransition:{duration:(duration:number)=>({reduceMotion:()=>({duration})})},ReduceMotion:{System:'system'},
 useSharedValue:(value:number)=>require('react').useRef({value}).current,useEvent:(handler:any)=>handler,
 useAnimatedStyle:(read:any)=>new Proxy({},{get:(_target,key)=>read()[key],ownKeys:()=>Reflect.ownKeys(read()),getOwnPropertyDescriptor:()=>({enumerable:true,configurable:true})}),
}));
jest.mock('../keyboard-inset',()=>({useKeyboardInset:()=>0}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View,useSafeAreaInsets:()=>({bottom:0})}));
jest.mock('lucide-react-native',()=>({Maximize2:require('react-native').View,Minimize2:require('react-native').View}));
const version=Object.getOwnPropertyDescriptor(Platform,'Version')!;
let KeyboardLayout:typeof import('../components/keyboard-layout').KeyboardLayout,KeyboardCapsule:typeof import('../components/keyboard-layout').KeyboardCapsule,DraftInput:typeof import('../components/draft-input').DraftInput;
beforeAll(()=>{
 jest.replaceProperty(Platform,'OS','android');Object.defineProperty(Platform,'Version',{configurable:true,value:34});
 jest.spyOn(UIManager,'getViewManagerConfig').mockReturnValue({} as any);
 ({KeyboardLayout,KeyboardCapsule}=require('../components/keyboard-layout'));({DraftInput}=require('../components/draft-input'));
 jest.spyOn(require('react-native'),'useWindowDimensions').mockReturnValue({width:361,height:754,scale:1,fontScale:1});
});
afterAll(()=>{jest.restoreAllMocks();Object.defineProperty(Platform,'Version',version);});
test('production DraftInput follows native progress before settled JS inset, reverses without remount or draft writes',async()=>{
 let tree!:Renderer.ReactTestRenderer;const change=jest.fn();
 const render=(compact:boolean)=><KeyboardLayout active><KeyboardCapsule testID="capsule"><DraftInput scope="same" compact={compact} animateLayout={false} value="Retained draft" onChangeText={change} trailingWidth={160} leading={<View/>} trailing={<View/>}/></KeyboardCapsule></KeyboardLayout>;
 await act(async()=>{tree=Renderer.create(render(true));});
 try{
  const input=tree.root.findByProps({accessibilityLabel:'Message draft'}),frame=()=>tree.root.findAllByProps({testID:'draft-input-frame'})[0]??input,host=tree.root.findByProps({testID:'native-keyboard-layout'});
  for(const fraction of [.25,.75,1,.6,.2,0]){
   act(()=>host.props.onImeProgress({overlap:280*fraction,fraction}));
   expect(StyleSheet.flatten(frame().props.style).marginLeft).toBeCloseTo(56*(1-fraction));
   expect(StyleSheet.flatten(frame().props.style).marginRight).toBeCloseTo(168*(1-fraction));
   expect(StyleSheet.flatten(tree.root.findByProps({testID:'draft-editor'}).props.style).paddingBottom).toBeCloseTo(52*fraction);
   const capsule=tree.root.findAll(node=>node.type===View&&node.props.testID==='capsule')[0];
   expect(StyleSheet.flatten(capsule.props.style).padding).toBeCloseTo(8*fraction);
   expect(tree.root.findByProps({accessibilityLabel:'Message draft'})).toBe(input);
  }
  act(()=>host.props.onImeProgress({overlap:280,fraction:1}));
  await act(async()=>tree.update(render(false)));
  expect(StyleSheet.flatten(frame().props.style).marginLeft).toBe(0);
  expect(tree.root.findByProps({accessibilityLabel:'Message draft'})).toBe(input);expect(input.props.value).toBe('Retained draft');expect(change).not.toHaveBeenCalled();
 }finally{await act(async()=>tree.unmount());}
});
