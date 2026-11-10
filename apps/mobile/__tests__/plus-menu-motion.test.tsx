import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {AccessibilityInfo,Animated,Modal,StyleSheet,Text as NativeText} from 'react-native';
import {PlusMenu} from '../components/plus-menu';
import {APP_UI_FONT_FAMILY} from '../typography';
jest.mock('lucide-react-native',()=>new Proxy({},{get:(_,name)=>name==='__esModule'?true:()=>null}));
const props={bottom:68,maxHeight:400,disabled:false,onCamera:jest.fn(),onGallery:jest.fn(),onFiles:jest.fn(),onDrawing:jest.fn(),onModel:jest.fn(),onMore:jest.fn()};
afterEach(()=>jest.restoreAllMocks());
test('popup opens with one short native-driver animation, without a Modal or layout animation',async()=>{
 jest.spyOn(AccessibilityInfo,'isReduceMotionEnabled').mockResolvedValue(false);
 jest.spyOn(AccessibilityInfo,'isScreenReaderEnabled').mockResolvedValue(false);
 const start=jest.fn(),stop=jest.fn();
 const timing=jest.spyOn(Animated,'timing').mockReturnValue({start,stop,reset:jest.fn()});
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<PlusMenu {...props}/>);});
 expect(timing).toHaveBeenCalledTimes(1);
 expect(timing.mock.calls[0][1]).toMatchObject({toValue:1,duration:160,useNativeDriver:true,isInteraction:false});
 expect(start).toHaveBeenCalledTimes(1);expect(tree.root.findAllByType(Modal)).toHaveLength(0);
 expect(StyleSheet.flatten(tree.root.findByProps({testID:'plus-menu-popup'}).props.style)).toMatchObject({bottom:68,maxHeight:400});
 await act(async()=>tree.update(<PlusMenu {...props} bottom={348}/>));
 expect(timing).toHaveBeenCalledTimes(1);
 await act(async()=>tree.unmount());
});
for(const mode of ['reduced motion','screen reader','query failure'])test(mode+' shows popup without motion',async()=>{
 jest.spyOn(AccessibilityInfo,'isReduceMotionEnabled').mockImplementation(()=>mode==='query failure'?Promise.reject(Error('Unavailable')):Promise.resolve(mode==='reduced motion'));
 jest.spyOn(AccessibilityInfo,'isScreenReaderEnabled').mockResolvedValue(mode==='screen reader');
 const timing=jest.spyOn(Animated,'timing');let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<PlusMenu {...props}/>);});
 expect(timing).not.toHaveBeenCalled();
 expect(StyleSheet.flatten(tree.root.findByProps({testID:'plus-menu-popup'}).props.style).opacity.__getValue()).toBe(1);
 await act(async()=>tree.unmount());
});
test('closing before preference resolution cannot start a late animation',async()=>{
 let resolve!:(value:boolean)=>void;
 jest.spyOn(AccessibilityInfo,'isReduceMotionEnabled').mockReturnValue(new Promise(done=>{resolve=done;}));
 jest.spyOn(AccessibilityInfo,'isScreenReaderEnabled').mockResolvedValue(false);
 const timing=jest.spyOn(Animated,'timing');let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<PlusMenu {...props}/>);});
 await act(async()=>tree.unmount());await act(async()=>resolve(false));
 expect(timing).not.toHaveBeenCalled();
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
