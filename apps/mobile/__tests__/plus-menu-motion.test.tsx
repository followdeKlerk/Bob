import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Animated,Modal,StyleSheet,Text as NativeText} from 'react-native';
import {PlusMenu} from '../components/plus-menu';
import {MotionSurface} from '../components/motion-surface';
import {useAppMotion} from '../app-motion';
jest.mock('../app-motion',()=>({...jest.requireActual('../app-motion'),useAppMotion:jest.fn(()=>true)}));
import {APP_UI_FONT_FAMILY} from '../typography';
jest.mock('lucide-react-native',()=>new Proxy({},{get:(_,name)=>name==='__esModule'?true:()=>null}));
const props={bottom:68,maxHeight:400,disabled:false,onCamera:jest.fn(),onGallery:jest.fn(),onFiles:jest.fn(),onDrawing:jest.fn(),onModel:jest.fn(),onMore:jest.fn()};
beforeEach(()=>jest.mocked(useAppMotion).mockReturnValue(true));
afterEach(()=>jest.restoreAllMocks());
const popup=(tree:Renderer.ReactTestRenderer)=>tree.root.findAll(node=>node.type!==MotionSurface&&node.props.testID==='plus-menu-popup')[0];
test('popup uses shared non-blocking motion without a Modal or keyboard-offset animation',async()=>{
 const start=jest.fn(),stop=jest.fn();
 const timing=jest.spyOn(Animated,'timing').mockReturnValue({start,stop,reset:jest.fn()});
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<PlusMenu {...props}/>);});
 expect(timing).toHaveBeenCalledTimes(1);
 expect(timing.mock.calls[0][1]).toMatchObject({toValue:1,duration:180,useNativeDriver:true,isInteraction:false});
 expect(start).toHaveBeenCalledTimes(1);expect(tree.root.findAllByType(Modal)).toHaveLength(0);
 expect(StyleSheet.flatten(popup(tree).props.style)).toMatchObject({bottom:68,maxHeight:400});
 const row=tree.root.findAll(node=>node.props.accessibilityLabel==='Camera'&&typeof node.props.onPress==='function')[0];
 act(()=>row.props.onPress());expect(props.onCamera).toHaveBeenCalledTimes(1);
 await act(async()=>tree.update(<PlusMenu {...props} bottom={348}/>));
 expect(timing).toHaveBeenCalledTimes(1);
 expect(tree.root.findAll(node=>node.props.accessibilityLabel==='Camera'&&typeof node.props.onPress==='function')[0]).toBe(row);
 await act(async()=>tree.unmount());expect(stop).toHaveBeenCalled();
});
test('unresolved or disabled shared motion keeps the popup visible and never replays on preference resolution or resume',async()=>{
 jest.mocked(useAppMotion).mockReturnValue(false);
 const timing=jest.spyOn(Animated,'timing');let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<PlusMenu {...props}/>);});
 expect(timing).not.toHaveBeenCalled();
 expect(StyleSheet.flatten(popup(tree).props.style).opacity.__getValue()).toBe(1);
 jest.mocked(useAppMotion).mockReturnValue(true);await act(async()=>tree.update(<PlusMenu {...props}/>));
 expect(timing).not.toHaveBeenCalled();
 jest.mocked(useAppMotion).mockReturnValue(false);await act(async()=>tree.update(<PlusMenu {...props}/>));
 jest.mocked(useAppMotion).mockReturnValue(true);await act(async()=>tree.update(<PlusMenu {...props}/>));
 expect(timing).not.toHaveBeenCalled();await act(async()=>tree.unmount());
});
test('background or accessibility motion gate stops an in-flight entrance immediately',async()=>{
 const stop=jest.fn();jest.spyOn(Animated,'timing').mockReturnValue({start:jest.fn(),stop,reset:jest.fn()});
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<PlusMenu {...props}/>);});
 jest.mocked(useAppMotion).mockReturnValue(false);await act(async()=>tree.update(<PlusMenu {...props}/>));
 expect(stop).toHaveBeenCalled();expect(StyleSheet.flatten(popup(tree).props.style).opacity.__getValue()).toBe(1);
 await act(async()=>tree.unmount());
});

test('the plus submenu uses compact scalable UI labels and full-size plain icon rows',async()=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<PlusMenu {...props}/>);});
 try{
  const labels=tree.root.findAllByType(NativeText);expect(labels.map(node=>node.props.children)).toEqual(['Camera','Gallery','Files','Drawing','Model & thinking','More']);
  for(const label of labels){expect(StyleSheet.flatten(label.props.style).fontFamily).toBe(APP_UI_FONT_FAMILY);expect(label.props.numberOfLines).toBeUndefined();expect(label.props.allowFontScaling).not.toBe(false);}
  const rows=tree.root.findAll(node=>node.props.accessibilityRole==='button'&&typeof node.props.onPress==='function');
  for(const row of rows)expect(StyleSheet.flatten(row.props.style).minHeight).toBeGreaterThanOrEqual(48);
 }finally{await act(async()=>tree.unmount());}
});
