import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {AccessibilityInfo,Modal,ScrollView,StyleSheet,Text as NativeText,View} from 'react-native';
import {Text} from '../components/app-text';
import {UpdatePopover} from '../components/update-popover';
import {ThemeContext,tokens} from '../theme-context';
jest.mock('react-native-safe-area-context',()=>({useSafeAreaInsets:()=>({top:24,bottom:16,left:4,right:4})}));
afterEach(()=>jest.restoreAllMocks());
test.each([
 [337,731,0,1],[361,754,280,1],[337,400,180,2],[361,240,140,3],
])('bubble at %s×%s, IME %s and font scale %s is bounded, naturally tall and independently scrollable',async(width,height,keyboardInset,fontScale)=>{
 jest.spyOn(require('react-native'),'useWindowDimensions').mockReturnValue({width,height,fontScale,scale:1});
 const close=jest.fn();let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<UpdatePopover visible status="Downloading & verifying…" keyboardInset={keyboardInset} onClose={close}><Text>Keep your draft and conversation in place.</Text></UpdatePopover>);});
 try{
  const bubble=tree.root.findByProps({testID:'update-popover'}),style=StyleSheet.flatten(bubble.props.style);
  const modal=tree.root.findByType(Modal),overlay=modal.findAllByType(View)[0],frame=StyleSheet.flatten(overlay.props.style);
  expect(style.width).toBe(304);expect(style.maxWidth).toBeLessThanOrEqual(width-32);expect(style.height).toBeUndefined();
  expect(style.maxHeight+frame.paddingTop+frame.paddingBottom).toBeLessThanOrEqual(height);
  expect(frame.paddingBottom).toBe(Math.max(16,keyboardInset)+12);expect(frame.paddingTop).toBeGreaterThanOrEqual(24);
  expect(bubble.props.accessibilityViewIsModal).toBe(true);expect(typeof modal.props.onRequestClose).toBe('function');
  const scroll=bubble.findByType(ScrollView);
  expect(StyleSheet.flatten(scroll.props.style)).toMatchObject({flexGrow:0,flexShrink:1,minHeight:0});
  expect(scroll.props.keyboardShouldPersistTaps).toBe('always');
  for(const text of bubble.findAllByType(NativeText)){expect(text.props.allowFontScaling).not.toBe(false);expect(text.props.numberOfLines).toBeUndefined();expect(text.props.maxFontSizeMultiplier).toBeUndefined();}
  expect(bubble.findAllByType(NativeText).some(node=>node.props.accessibilityLiveRegion==='polite')).toBe(true);
  act(()=>modal.props.onRequestClose());act(()=>bubble.props.onAccessibilityEscape());expect(close).toHaveBeenCalledTimes(2);
 }finally{await act(async()=>tree.unmount());}
});
test.each(['light','dark'] as const)('popover retains %s chat palette and readable scalable text without gratuitous heading',async(scheme)=>{
 let tree!:Renderer.ReactTestRenderer;const focus=jest.spyOn(AccessibilityInfo,'setAccessibilityFocus').mockImplementation(()=>{});
 await act(async()=>{tree=Renderer.create(<ThemeContext.Provider value={tokens[scheme]}><UpdatePopover visible status="App 2.0 ready to install" onClose={()=>{}}><Text>Android asks for approval.</Text></UpdatePopover></ThemeContext.Provider>);});
 try{
  expect(StyleSheet.flatten(tree.root.findByProps({testID:'update-popover'}).props.style).backgroundColor).toBe(tokens[scheme].colors.surface);
  expect(tree.root.findAllByType(NativeText).filter(node=>node.props.children==='App 2.0 ready to install')).toHaveLength(1);
  expect(tree.root.findAllByType(NativeText).some(node=>node.props.children==='App update')).toBe(false);
  expect(tree.root.findAllByType(NativeText).some(node=>node.props.children==='Close')).toBe(true);
  expect(typeof tree.root.findByType(Modal).props.onShow).toBe('function');expect(focus).not.toHaveBeenCalled();
 }finally{await act(async()=>tree.unmount());}
});
