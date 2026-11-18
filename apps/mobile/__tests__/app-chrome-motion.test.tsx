import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {AccessibilityInfo,AppState,Animated,Pressable,StyleSheet,Text,TextInput,View} from 'react-native';
import {MotionSurface,PersistentMotionSurface} from '../components/motion-surface';
import {TouchTarget} from '../components/touch-target';
import {APP_MOTION,AppMotionProvider,useAppMotion} from '../app-motion';
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
 await act(async()=>tree.update(render(true)));expect(StyleSheet.flatten(target(tree).props.style).opacity.__getValue()).toBe(.4);
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

test('shared entrance composes with caller opacity and transforms without changing geometry',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<MotionSurface testID="surface" style={{opacity:.5,transform:[{scale:.9}],height:200}}/>);});
 const style=StyleSheet.flatten(surface(tree).props.style);
 expect(style.height).toBe(200);expect(style.opacity.__getValue()).toBeCloseTo(.48);
 expect(style.transform[0]).toEqual({scale:.9});expect(style.transform[1].translateY.__getValue()).toBe(8);
 await act(async()=>tree.unmount());
});

test('rapid surface changes continue in flight; stale completion cannot restart a newer entrance',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 const render=(key:string)=><MotionSurface testID="surface" transitionKey={key}><TextInput testID="retained-editor"/></MotionSurface>;
 await act(async()=>{tree=Renderer.create(render('one'));});
 const editor=tree.root.findByProps({testID:'retained-editor'}),progress=jest.mocked(Animated.timing).mock.calls[0][0] as Animated.Value&{__getValue:()=>number};
 act(()=>progress.setValue(.45));
 await act(async()=>tree.update(render('two')));
 expect(progress.__getValue()).toBe(.45);
 act(()=>animations[0].start.mock.calls[0][0]({finished:true}));
 act(()=>progress.setValue(.7));
 await act(async()=>tree.update(render('three')));
 expect(progress.__getValue()).toBe(.7);expect(tree.root.findByProps({testID:'retained-editor'})).toBe(editor);
 act(()=>animations[2].start.mock.calls[0][0]({finished:true}));
 await act(async()=>tree.update(render('four')));
 expect(progress.__getValue()).toBe(0); // A genuinely new, settled route still gets its entrance.
 await act(async()=>tree.unmount());
});

test('disabled paint remains owned by the native opacity graph after enabled press feedback',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 const onPress=jest.fn();
 const render=(disabled:boolean)=><TouchTarget disabled={disabled} onPress={onPress} style={{opacity:disabled?.4:1}}><Text>Send</Text></TouchTarget>;
 await act(async()=>{tree=Renderer.create(render(false));});
 act(()=>target(tree).props.onPressIn({}));act(()=>target(tree).props.onPressOut({}));
 await act(async()=>tree.update(render(true)));
 const paint=StyleSheet.flatten(target(tree).props.style).opacity;
 // Dropping the animated binding races native updates with static .4.
 // Keep one owner even when disabled, not a JS-only static style assertion.
 expect(typeof paint.__getValue).toBe('function');expect(paint.__getValue()).toBe(.4);
 act(()=>target(tree).props.onPress({}));expect(onPress).not.toHaveBeenCalled();
 await act(async()=>tree.update(render(false)));
 expect(StyleSheet.flatten(target(tree).props.style).opacity.__getValue()).toBe(1);
 await act(async()=>tree.unmount());
});

test('cancelled press releases promptly and late release on a disabled target cannot animate it',async()=>{
 let tree!:Renderer.ReactTestRenderer;const onPress=jest.fn(),onPressOut=jest.fn(),onBlur=jest.fn();
 const render=(disabled=false)=><TouchTarget disabled={disabled} onPress={onPress} onPressOut={onPressOut} onBlur={onBlur} style={{opacity:disabled?.4:1}}/>;
 await act(async()=>{tree=Renderer.create(render());});
 act(()=>target(tree).props.onPressIn({}));act(()=>target(tree).props.onBlur({}));
 expect(onPress).not.toHaveBeenCalled();expect(onBlur).toHaveBeenCalledTimes(1);
 expect(jest.mocked(Animated.timing).mock.calls.at(-1)![1].toValue).toBe(1);
 await act(async()=>tree.update(render(true)));
 const count=animations.length;
 act(()=>target(tree).props.onPressOut({}));
 expect(onPressOut).toHaveBeenCalledTimes(1);expect(animations).toHaveLength(count);
 expect(StyleSheet.flatten(target(tree).props.style).opacity.__getValue()).toBe(.4);
 await act(async()=>tree.unmount());
});

test('real shared policy stops native surface motion for accessibility, background and retained-inactive gates without replay',async()=>{
 jest.mocked(useAppMotion).mockImplementation(jest.requireActual('../app-motion').useAppMotion);
 const descriptor=Object.getOwnPropertyDescriptor(AppState,'currentState');
 Object.defineProperty(AppState,'currentState',{configurable:true,value:'active'});
 let appChange!:(value:any)=>void;const preferences:Record<string,(value:boolean)=>void>={};
 jest.spyOn(AppState,'addEventListener').mockImplementation((_event,listener)=>{appChange=listener;return{remove:jest.fn()};});
 jest.spyOn(AccessibilityInfo,'addEventListener').mockImplementation((event,listener)=>{preferences[event]=listener;return{remove:jest.fn()};});
 jest.spyOn(AccessibilityInfo,'isReduceMotionEnabled').mockResolvedValue(false);
 jest.spyOn(AccessibilityInfo,'isScreenReaderEnabled').mockResolvedValue(false);
 let tree!:Renderer.ReactTestRenderer;
 const render=(key:string,active=true)=><AppMotionProvider active={active}><MotionSurface active={active} testID="surface" transitionKey={key}><TextInput testID="preserved-input"/></MotionSurface></AppMotionProvider>;
 try{
  await act(async()=>{tree=Renderer.create(render('initial'));});
  expect(animations).toHaveLength(0); // Preference resolution is not an entrance.
  const input=tree.root.findByProps({testID:'preserved-input'});
  await act(async()=>tree.update(render('next')));expect(animations).toHaveLength(1);
  await act(async()=>preferences.reduceMotionChanged(true));
  expect(animations[0].stop).toHaveBeenCalled();expect(StyleSheet.flatten(surface(tree).props.style).opacity.__getValue()).toBe(1);
  await act(async()=>preferences.reduceMotionChanged(false));expect(animations).toHaveLength(1);
  await act(async()=>tree.update(render('reader')));expect(animations).toHaveLength(2);
  await act(async()=>preferences.screenReaderChanged(true));expect(animations[1].stop).toHaveBeenCalled();
  await act(async()=>preferences.screenReaderChanged(false));expect(animations).toHaveLength(2);
  await act(async()=>tree.update(render('background')));expect(animations).toHaveLength(3);
  await act(async()=>appChange('background'));expect(animations[2].stop).toHaveBeenCalled();
  await act(async()=>appChange('active'));expect(animations).toHaveLength(3);
  await act(async()=>tree.update(render('retained')));expect(animations).toHaveLength(4);
  await act(async()=>tree.update(render('retained',false)));expect(animations[3].stop).toHaveBeenCalled();
  await act(async()=>tree.update(render('retained')));expect(animations).toHaveLength(4);
  expect(tree.root.findByProps({testID:'preserved-input'})).toBe(input);
 }finally{if(tree)await act(async()=>tree.unmount());if(descriptor)Object.defineProperty(AppState,'currentState',descriptor);}
});
