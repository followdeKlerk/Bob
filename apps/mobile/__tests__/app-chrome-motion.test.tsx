import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Animated,Pressable,StyleSheet,Text,TextInput,View} from 'react-native';
import {MotionSurface,PersistentMotionSurface} from '../components/motion-surface';
import {TouchTarget} from '../components/touch-target';
import {APP_MOTION,useAppMotion} from '../app-motion';
jest.mock('../app-motion',()=>({...jest.requireActual('../app-motion'),useAppMotion:jest.fn(()=>true)}));
let animations:{start:jest.Mock;stop:jest.Mock;reset:jest.Mock}[];
beforeEach(()=>{
 jest.mocked(useAppMotion).mockReturnValue(true);animations=[];
 jest.spyOn(Animated,'timing').mockImplementation(()=>{const animation={start:jest.fn(),stop:jest.fn(),reset:jest.fn()};animations.push(animation);return animation;});
});
afterEach(()=>jest.restoreAllMocks());
const surface=(tree:Renderer.ReactTestRenderer)=>tree.root.findAll(node=>node.type!==MotionSurface&&node.props.testID==='surface')[0];
const target=(tree:Renderer.ReactTestRenderer)=>tree.root.findAll(node=>node.type!==TouchTarget&&typeof node.props.onPressIn==='function')[0];

test('entrance uses only a short, non-blocking native-driver transform and retains draft/list identity',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 const render=(key:string)=><MotionSurface testID="surface" transitionKey={key} style={{flex:1}}><TextInput testID="draft" defaultValue="Keep this"/></MotionSurface>;
 await act(async()=>{tree=Renderer.create(render('Settings'));});
 const draft=tree.root.findByProps({testID:'draft'});
 expect(Animated.timing).toHaveBeenCalledTimes(1);
 expect(jest.mocked(Animated.timing).mock.calls[0][1]).toMatchObject({toValue:1,duration:180,useNativeDriver:true,isInteraction:false});
 const style=StyleSheet.flatten(surface(tree).props.style);
 expect(style.height).toBeUndefined();expect(style.opacity.__getValue()).toBe(.96);expect(style.transform[0].translateY.__getValue()).toBe(8);
 await act(async()=>tree.update(render('Appearance')));
 expect(tree.root.findByProps({testID:'draft'})).toBe(draft);expect(Animated.timing).toHaveBeenCalledTimes(2);expect(animations[0].stop).toHaveBeenCalled();
 await act(async()=>tree.update(render('Appearance')));expect(Animated.timing).toHaveBeenCalledTimes(2);
 await act(async()=>tree.unmount());expect(animations[1].stop).toHaveBeenCalled();
});
test('motion preference resolution and foreground resume never replay an existing surface',async()=>{
 jest.mocked(useAppMotion).mockReturnValue(false);let tree!:Renderer.ReactTestRenderer;
 const render=(active=true)=><MotionSurface testID="surface" active={active}><Text>Readable immediately</Text></MotionSurface>;
 await act(async()=>{tree=Renderer.create(render());});expect(Animated.timing).not.toHaveBeenCalled();
 expect(StyleSheet.flatten(surface(tree).props.style).opacity.__getValue()).toBe(1);
 jest.mocked(useAppMotion).mockReturnValue(true);await act(async()=>tree.update(render()));expect(Animated.timing).not.toHaveBeenCalled();
 await act(async()=>tree.update(render(false)));await act(async()=>tree.update(render()));expect(Animated.timing).toHaveBeenCalledTimes(1);
 jest.mocked(useAppMotion).mockReturnValue(false);await act(async()=>tree.update(render()));expect(animations[0].stop).toHaveBeenCalled();
 expect(StyleSheet.flatten(surface(tree).props.style).opacity.__getValue()).toBe(1);
 jest.mocked(useAppMotion).mockReturnValue(true);await act(async()=>tree.update(render()));expect(Animated.timing).toHaveBeenCalledTimes(1);
 await act(async()=>tree.unmount());
});
test('inactive persistent screens retain their hidden opacity and accessibility props',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<MotionSurface active={false} testID="surface" pointerEvents="none" accessibilityElementsHidden style={{opacity:0}}/>);});
 expect(StyleSheet.flatten(surface(tree).props.style).opacity).toBe(0);expect(surface(tree).props.pointerEvents).toBe('none');expect(surface(tree).props.accessibilityElementsHidden).toBe(true);expect(Animated.timing).not.toHaveBeenCalled();
 await act(async()=>tree.unmount());
});
test('press feedback forwards events immediately without changing target geometry or delaying activation',async()=>{
 const onPress=jest.fn(),onPressIn=jest.fn(),onPressOut=jest.fn();let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<TouchTarget accessibilityLabel="Open settings" onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut} style={{minHeight:48,opacity:.8}}><Text>Settings</Text></TouchTarget>);});
 const button=target(tree),event={} as any;
 act(()=>button.props.onPressIn(event));expect(onPressIn).toHaveBeenCalledWith(event);expect(jest.mocked(Animated.timing).mock.calls.at(-1)![1]).toMatchObject({toValue:APP_MOTION.pressedOpacity,duration:70,useNativeDriver:true,isInteraction:false});
 act(()=>button.props.onPress(event));expect(onPress).toHaveBeenCalledTimes(1);
 act(()=>button.props.onPressOut(event));expect(onPressOut).toHaveBeenCalledWith(event);expect(jest.mocked(Animated.timing).mock.calls.at(-1)![1]).toMatchObject({toValue:1,duration:130});
 const style=StyleSheet.flatten(button.props.style);expect(style.minHeight).toBe(48);expect(style.transform).toBeUndefined();
 await act(async()=>tree.unmount());expect(animations.at(-1)!.stop).toHaveBeenCalled();
});
test('reduced motion keeps static touch feedback and disabling a held control resets it',async()=>{
 jest.mocked(useAppMotion).mockReturnValue(false);let tree!:Renderer.ReactTestRenderer;
 const render=(disabled=false)=><TouchTarget disabled={disabled} style={{minHeight:48,opacity:disabled?.4:.8}}/>;
 await act(async()=>{tree=Renderer.create(render());});
 act(()=>target(tree).props.onPressIn({}));expect(Animated.timing).not.toHaveBeenCalled();
 expect(StyleSheet.flatten(target(tree).props.style).opacity.__getValue()).toBeCloseTo(.8*APP_MOTION.pressedOpacity);
 await act(async()=>tree.update(render(true)));expect(StyleSheet.flatten(target(tree).props.style).opacity).toBe(.4);
 await act(async()=>tree.update(render()));expect(StyleSheet.flatten(target(tree).props.style).opacity.__getValue()).toBe(.8);
 await act(async()=>tree.unmount());
});


test('persistent screen visibility belongs to a plain host, never to its native animation graph',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 const render=(active:boolean)=><PersistentMotionSurface active={active} testID="route-mask" pointerEvents={active?'auto':'none'} accessibilityElementsHidden={!active} importantForAccessibility={active?'auto':'no-hide-descendants'} style={{flex:1,opacity:active?1:0}}><TextInput testID="retained-draft" defaultValue="Keep me"/></PersistentMotionSurface>;
 await act(async()=>{tree=Renderer.create(render(true));});
 const mask=()=>tree.root.findAllByType(View).find(node=>node.props.testID==='route-mask')!;
 const host=mask(),draft=tree.root.findByProps({testID:'retained-draft'});
 for(let i=0;i<5;i++){
  await act(async()=>tree.update(render(false)));
  expect(mask()).toBe(host);expect(mask().props.collapsable).toBe(false);expect(StyleSheet.flatten(mask().props.style).opacity).toBe(0);
  expect(mask().props.pointerEvents).toBe('none');expect(mask().props.importantForAccessibility).toBe('no-hide-descendants');
  // Even a native graph restoring the child's opacity cannot reveal this route.
  expect(mask().findByType(MotionSurface).props.style.opacity).toBeUndefined();
  await act(async()=>tree.update(render(true)));
  expect(mask()).toBe(host);expect(StyleSheet.flatten(mask().props.style).opacity).toBe(1);
  expect(mask().props.pointerEvents).toBe('auto');expect(tree.root.findByProps({testID:'retained-draft'})).toBe(draft);
 }
 await act(async()=>tree.unmount());
});
