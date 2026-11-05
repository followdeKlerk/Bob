import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {AccessibilityInfo,Animated,AppState,StyleSheet} from 'react-native';
import {ComposerStatus} from '../components/composer-status';

jest.mock('react-native/Libraries/AppState/AppState',()=>({__esModule:true,default:{currentState:'active',addEventListener:jest.fn(()=>({remove:jest.fn()}))}}));
let lifecycle:(state:any)=>void;
const preferences=new Map<string,(value:boolean)=>void>();
type Motion={config:Animated.TimingAnimationConfig;start:jest.Mock;stop:jest.Mock;finish:()=>void;lateFinish:()=>void};
let motions:Motion[],loops:{start:jest.Mock;stop:jest.Mock}[],subscriptions:jest.Mock[];
beforeEach(()=>{
 jest.useFakeTimers();preferences.clear();motions=[];loops=[];subscriptions=[];
 jest.spyOn(AccessibilityInfo,'isReduceMotionEnabled').mockResolvedValue(false);
 jest.spyOn(AccessibilityInfo,'isScreenReaderEnabled').mockResolvedValue(false);
 jest.spyOn(AccessibilityInfo,'addEventListener').mockImplementation((event,callback)=>{preferences.set(event,callback as any);const remove=jest.fn();subscriptions.push(remove);return{remove};});
 jest.spyOn(AppState,'addEventListener').mockImplementation((_event,callback)=>{lifecycle=callback;const remove=jest.fn();subscriptions.push(remove);return{remove};});
 // Drive native completion callbacks explicitly: this tests sequencing and
 // cancellation without claiming that Jest renders Android animation frames.
 jest.spyOn(Animated,'timing').mockImplementation((value,config)=>{
  let done:((result:{finished:boolean})=>void)|undefined;
  const motion:Motion={config,start:jest.fn(callback=>{done=callback;}),stop:jest.fn(()=>done?.({finished:false})),finish:()=>{(value as Animated.Value).setValue(config.toValue as number);done?.({finished:true});},lateFinish:()=>done?.({finished:true})};
  motions.push(motion);return motion as unknown as Animated.CompositeAnimation;
 });
 jest.spyOn(Animated,'loop').mockImplementation(()=>{const loop={start:jest.fn(),stop:jest.fn(),reset:jest.fn()};loops.push(loop);return loop as unknown as Animated.CompositeAnimation;});
});
afterEach(()=>{jest.restoreAllMocks();jest.useRealTimers();});
const visible=(tree:Renderer.ReactTestRenderer)=>tree.root.findByProps({testID:'status-animated-text'}).props.children;
const phase=(duration:number)=>motions.filter(m=>m.config.duration===duration);
const finish=(motionsToFinish:Motion[])=>act(()=>motionsToFinish.forEach(m=>m.finish()));
const noTimers=()=>{jest.runAllTicks();expect(jest.getTimerCount()).toBe(0);};

test('signal glide keeps full literal text and scalable natural layout from the first frame',async()=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<ComposerStatus text="Connected"/>);});
 expect(visible(tree)).toBe('Connected');expect(loops).toHaveLength(1);expect(loops[0].start).toHaveBeenCalledTimes(1);
 const status=tree.root.findByProps({testID:'connection-status'});
 expect(status.props.accessibilityLabel).toBe('Connected');expect(status.props.accessibilityLiveRegion).toBe('polite');expect(status.props.pointerEvents).toBe('none');
 expect(StyleSheet.flatten(status.props.style)).toMatchObject({minHeight:34,paddingBottom:11});
 const text=tree.root.findByProps({testID:'status-animated-text'});
 expect(StyleSheet.flatten(text.props.style)).toMatchObject({fontSize:13,lineHeight:22,fontWeight:'600',letterSpacing:0.3});
 expect(text.props.numberOfLines).toBeUndefined();expect(text.props.allowFontScaling).not.toBe(false);
 expect(StyleSheet.flatten(text.props.style).position).toBeUndefined();expect(StyleSheet.flatten(text.props.style).height).toBeUndefined();
 const track=tree.root.findByProps({testID:'status-signal-track'});expect(track.props.accessible).toBe(false);expect(track.props.accessibilityRole).toBeUndefined();expect(track.props.importantForAccessibility).toBe('no-hide-descendants');
 expect(StyleSheet.flatten(track.props.style)).toMatchObject({width:70,height:2,marginTop:4});
 const glide=motions.find(m=>m.config.duration===3800)!;expect(glide.config).toMatchObject({toValue:1,useNativeDriver:true,isInteraction:false});
 const position=StyleSheet.flatten(tree.root.findByProps({testID:'status-signal-glide'}).props.style).transform[0].translateX;
 expect(position.__getValue()).toBe(0);
 const interpolation=position.__getNativeConfig();expect(interpolation.outputRange[0]).toBe(0);expect(interpolation.outputRange[16]).toBe(52);expect(interpolation.outputRange[32]).toBe(0);
 noTimers();await act(async()=>tree.unmount());expect(loops[0].stop).toHaveBeenCalledTimes(1);expect(subscriptions.every(remove=>remove.mock.calls.length===1)).toBe(true);noTimers();
});

test('a real label change fades/slides out then in, without restarting the rail',async()=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<ComposerStatus text="Connected"/>);});
 const status=tree.root.findByProps({testID:'connection-status'});
 await act(async()=>tree.update(<ComposerStatus text="Reconnecting…"/>));
 expect(visible(tree)).toBe('Connected');expect(status.props.accessibilityLabel).toBe('Reconnecting…');
 expect(phase(90).map(m=>m.config.toValue)).toEqual([0,-3]);expect(phase(170)).toHaveLength(0);
 finish(phase(90));expect(visible(tree)).toBe('Reconnecting…');expect(phase(170).map(m=>m.config.toValue)).toEqual([1,0]);finish(phase(170));
 expect(tree.root.findByProps({testID:'connection-status'})).toBe(status);expect(loops).toHaveLength(1);
 for(const motion of motions)expect(motion.config).toMatchObject({useNativeDriver:true,isInteraction:false});
 await act(async()=>tree.update(<ComposerStatus text="Reconnecting…"/>));expect(phase(90)).toHaveLength(2);expect(visible(tree)).toBe('Reconnecting…');
 await act(async()=>tree.unmount());noTimers();
});

test('rapid changes discard cancelled completions and transition only to the latest phase',async()=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<ComposerStatus text="Waiting for model…"/>);});
 await act(async()=>tree.update(<ComposerStatus text="Thinking…"/>));const stale=phase(90).slice();
 await act(async()=>tree.update(<ComposerStatus text="Writing response…"/>));
 act(()=>stale.forEach(m=>m.lateFinish()));expect(visible(tree)).toBe('Waiting for model…');expect(phase(170)).toHaveLength(0);
 finish(phase(90).slice(2));expect(visible(tree)).toBe('Writing response…');const oldIncoming=phase(170).slice();
 await act(async()=>tree.update(<ComposerStatus text="Working…"/>));expect(oldIncoming.every(m=>m.stop.mock.calls.length>0)).toBe(true);
 finish(phase(90).slice(4));finish(phase(170).slice(2));expect(visible(tree)).toBe('Working…');expect(loops).toHaveLength(1);
 await act(async()=>tree.unmount());act(()=>motions.forEach(m=>m.lateFinish()));noTimers();
});

test.each(['reduceMotionChanged','screenReaderChanged'])('%s cancels both animations and renders the latest complete literal status',async(event)=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<ComposerStatus text="Connected"/>);});
 await act(async()=>tree.update(<ComposerStatus text="Reconnecting…"/>));const stale=phase(90).slice();
 act(()=>preferences.get(event)!(true));expect(tree.root.findByProps({testID:'status-static-text'}).props.children).toBe('Reconnecting…');expect(loops[0].stop).toHaveBeenCalledTimes(1);expect(tree.root.findAllByProps({testID:'status-animated-text'})).toHaveLength(0);
 act(()=>stale.forEach(m=>m.lateFinish()));expect(phase(170)).toHaveLength(0);noTimers();
 act(()=>preferences.get(event)!(false));expect(visible(tree)).toBe('Reconnecting…');expect(loops).toHaveLength(2);expect(phase(90)).toHaveLength(2);
 await act(async()=>tree.unmount());noTimers();
});

test('background and off-chat animate=false stop motion immediately; return does not replay old phases',async()=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<ComposerStatus text="Connected"/>);});
 act(()=>lifecycle('background'));expect(loops[0].stop).toHaveBeenCalledTimes(1);
 await act(async()=>tree.update(<ComposerStatus text="Reconnecting…"/>));expect(tree.root.findByProps({testID:'status-static-text'}).props.children).toBe('Reconnecting…');
 act(()=>lifecycle('active'));expect(visible(tree)).toBe('Reconnecting…');expect(phase(90)).toHaveLength(0);
 await act(async()=>tree.update(<ComposerStatus text="Thinking…"/>));
 await act(async()=>tree.update(<ComposerStatus text="Writing response…" animate={false}/>));expect(loops[1].stop).toHaveBeenCalledTimes(1);expect(tree.root.findByProps({testID:'status-static-text'}).props.children).toBe('Writing response…');
 await act(async()=>tree.update(<ComposerStatus text="Writing response…"/>));expect(visible(tree)).toBe('Writing response…');expect(phase(90)).toHaveLength(2);
 await act(async()=>tree.unmount());noTimers();
});

test('actionable static labels bypass any pending transition and never acquire decorative punctuation',async()=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<ComposerStatus text="Connected"/>);});
 await act(async()=>tree.update(<ComposerStatus text="Reconnecting…"/>));const stale=phase(90).slice();
 const error='Device storage issue • keep Bob open';await act(async()=>tree.update(<ComposerStatus text={error} animate={false}/>));
 expect(tree.root.findByProps({testID:'status-static-text'}).props.children).toBe(error);expect(tree.root.findByProps({testID:'connection-status'}).props.accessibilityLabel).toBe(error);
 act(()=>stale.forEach(m=>m.lateFinish()));expect(phase(170)).toHaveLength(0);expect(tree.root.findByProps({testID:'status-static-text'}).props.children).toBe(error);
 await act(async()=>tree.unmount());noTimers();
});

test('unknown preferences stay static; newer accessibility events beat delayed initial queries',async()=>{
 let resolveMotion!:(value:boolean)=>void,resolveReader!:(value:boolean)=>void;
 jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockReturnValue(new Promise(resolve=>{resolveMotion=resolve;}));
 jest.mocked(AccessibilityInfo.isScreenReaderEnabled).mockReturnValue(new Promise(resolve=>{resolveReader=resolve;}));
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<ComposerStatus text="Connected"/>);});
 expect(tree.root.findByProps({testID:'status-static-text'}).props.children).toBe('Connected');expect(loops).toHaveLength(0);
 act(()=>{preferences.get('reduceMotionChanged')!(true);preferences.get('screenReaderChanged')!(true);});
 await act(async()=>{resolveMotion(false);resolveReader(false);});expect(loops).toHaveLength(0);
 act(()=>{preferences.get('reduceMotionChanged')!(false);preferences.get('screenReaderChanged')!(false);});expect(loops).toHaveLength(1);
 await act(async()=>tree.unmount());noTimers();
});
