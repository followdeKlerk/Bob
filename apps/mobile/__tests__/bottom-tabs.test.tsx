jest.mock('react-native-reanimated',()=>({__esModule:true,default:{createAnimatedComponent:(component:any)=>component},ReduceMotion:{System:'system'},cancelAnimation:jest.fn(),useSharedValue:(value:any)=>require('react').useRef({value}).current,useAnimatedProps:(fn:any)=>fn(),withSpring:jest.fn((value:any)=>value),withTiming:jest.fn((value:any)=>value),Easing:{out:(value:any)=>value,inOut:(value:any)=>value,cubic:jest.fn()}}));
jest.mock('react-native-svg',()=>{const create=require('react').createElement;const component=(name:string)=>(props:any)=>create(name,props,props.children);return{__esModule:true,default:component('Svg'),Path:component('Path'),Rect:component('Rect'),Circle:component('Circle'),Defs:component('Defs'),ClipPath:component('ClipPath'),G:component('G')};});
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {AccessibilityInfo,AppState,StyleSheet,Text} from 'react-native';
import {cancelAnimation,withSpring,withTiming} from 'react-native-reanimated';
import {BottomTabs} from '../components/bottom-tabs';
test('white navigation has five accessible icon-only destinations and central Chat',async()=>{
 const select=jest.fn();let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<BottomTabs selected="Chat" onSelect={select}/>);});
 const root=tree.root.findByProps({testID:'bottom-tabs'});
 expect(StyleSheet.flatten(root.props.style).backgroundColor).toBe('#ffffff');
 const tabs=tree.root.findAll(node=>node.props.accessibilityRole==='tab'&&typeof node.props.onPress==='function');
 expect(tabs.map(tab=>tab.props.accessibilityLabel)).toEqual(['Notes','Workstations','Chat','Sessions','Settings']);
 expect(tabs[2].props.accessibilityState.selected).toBe(true);
 expect(tree.root.findAllByType(Text)).toHaveLength(0);
 act(()=>root.props.onLayout({nativeEvent:{layout:{width:313,height:60}}}));
 const shapes=tree.root.findAll(node=>node.props.animatedProps?.d).map(node=>node.props.animatedProps.d);
 expect(shapes.length).toBeGreaterThanOrEqual(1);expect(new Set(shapes).size).toBe(1);
 expect(shapes[0]).toContain('M0 0 H313');
 expect(StyleSheet.flatten(root.props.style).height).toBe(60);
 for(const tab of tabs){expect(StyleSheet.flatten(tab.props.style).minHeight).toBeGreaterThanOrEqual(48);act(()=>tab.props.onPress());}
 expect(select.mock.calls.map(call=>call[0])).toEqual(['Notes','Workstations','Chat','Sessions','Settings']);
 await act(async()=>tree.unmount());
});

test('transitions retarget immediately; reduced motion and backgrounding cancel movement',async()=>{
 const motionListeners:Record<string,(value:any)=>void>={};let lifecycle!:(state:any)=>void;
 jest.spyOn(AccessibilityInfo,'isReduceMotionEnabled').mockResolvedValue(false);
 jest.spyOn(AccessibilityInfo,'addEventListener').mockImplementation((event,listener)=>{motionListeners[event]=listener;return{remove:jest.fn()};});
 jest.spyOn(AppState,'addEventListener').mockImplementation((_event,listener)=>{lifecycle=listener;return{remove:jest.fn()};});
 let tree!:Renderer.ReactTestRenderer;const select=jest.fn();
 await act(async()=>{tree=Renderer.create(<BottomTabs selected="Chat" onSelect={select}/>);});
 act(()=>lifecycle('active'));
 act(()=>tree.root.findByProps({testID:'bottom-tabs'}).props.onLayout({nativeEvent:{layout:{width:313,height:60}}}));
 (withSpring as jest.Mock).mockClear();(withTiming as jest.Mock).mockClear();
 await act(async()=>tree.update(<BottomTabs selected="Notes" onSelect={select}/>));
 await act(async()=>tree.update(<BottomTabs selected="Settings" onSelect={select}/>));
 expect(withSpring).toHaveBeenLastCalledWith(4,expect.objectContaining({overshootClamping:true}));
 expect(withTiming).toHaveBeenLastCalledWith(4,expect.objectContaining({duration:520}));
 (withSpring as jest.Mock).mockClear();(withTiming as jest.Mock).mockClear();
 act(()=>motionListeners.reduceMotionChanged(true));
 await act(async()=>tree.update(<BottomTabs selected="Sessions" onSelect={select}/>));
 expect(withSpring).not.toHaveBeenCalled();expect(withTiming).not.toHaveBeenCalled();
 act(()=>motionListeners.reduceMotionChanged(false));
 (withSpring as jest.Mock).mockClear();
 act(()=>lifecycle('background'));
 await act(async()=>tree.update(<BottomTabs selected="Chat" onSelect={select}/>));
 expect(withSpring).not.toHaveBeenCalled();expect(cancelAnimation).toHaveBeenCalled();
 await act(async()=>tree.unmount());jest.restoreAllMocks();
});

test.each([240,313,361,760])('one native SVG root positions all five real glyphs at width %i',async width=>{
 const {TabGlyph}=require('../components/tab-glyph');
 const {fluidTabPath}=require('../fluid-tabs');
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<BottomTabs selected="Chat" onSelect={()=>{}}/>);});
 act(()=>tree.root.findByProps({testID:'bottom-tabs'}).props.onLayout({nativeEvent:{layout:{width,height:60}}}));
 const ids=['Notes','Workstations','Chat','Sessions','Settings'];
 // Do not mock icon components. Native SVG roots cannot be positioned using
 // SVG x/y like browser SVGs; nesting them caused the on-phone left-edge pileup.
 expect(tree.root.findAll(node=>node.type==='Svg' as any)).toHaveLength(1);
 const glyphs=tree.root.findAllByType(TabGlyph);expect(glyphs).toHaveLength(5);
 expect(tree.root.findAll(node=>node.type==='ClipPath' as any)).toHaveLength(0);
 for(let i=0;i<5;i++){
   const glyph=glyphs[i];
   expect(glyph.props).toMatchObject({name:ids[i],x:width*(i+.5)/5-12,y:19,color:i===2?'#ffffff':'#111111'});
   const group=glyph.findAll(node=>node.type==='G' as any)[0];
   expect(group.props.transform).toBe(`translate(${glyph.props.x} 19)`);
   expect(group.props.stroke).toBe(i===2?'#ffffff':'#111111');
   const primitives=glyph.findAll(node=>['Path','Rect','Circle'].includes(node.type as string));
   expect(primitives.length).toBeGreaterThan(0);
   expect(glyph.findAll(node=>node.type==='Svg' as any)).toHaveLength(0);
 }
 for(let selected=0;selected<5;selected++){
  await act(async()=>tree.update(<BottomTabs selected={ids[selected]} onSelect={()=>{}}/>));
  // A second render reads the mock's synchronously updated shared value.
  await act(async()=>tree.update(<BottomTabs selected={ids[selected]} onSelect={()=>{}}/>));
  tree.root.findAllByType(TabGlyph).forEach((glyph,i)=>expect(glyph.props.color).toBe(i===selected?'#ffffff':'#111111'));
  const paths=tree.root.findAll(node=>node.props.animatedProps?.d).map(node=>node.props.animatedProps.d);
  expect(new Set(paths)).toEqual(new Set([fluidTabPath(width,selected)]));
 }
 await act(async()=>tree.unmount());
});
