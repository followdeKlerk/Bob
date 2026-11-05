import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {AccessibilityInfo,AppState,StyleSheet} from 'react-native';
import {ComposerStatus} from '../components/composer-status';
import {typewriterFrame,statusDisplayLabel} from '../typewriter-status';
jest.mock('react-native/Libraries/AppState/AppState',()=>({__esModule:true,default:{currentState:'active',addEventListener:jest.fn(()=>({remove:jest.fn()}))}}));
let lifecycle:(state:any)=>void;const preferences=new Map<string,(value:boolean)=>void>();
beforeEach(()=>{
 jest.useFakeTimers();preferences.clear();
 jest.spyOn(AccessibilityInfo,'isReduceMotionEnabled').mockResolvedValue(false);
 jest.spyOn(AccessibilityInfo,'isScreenReaderEnabled').mockResolvedValue(false);
 jest.spyOn(AccessibilityInfo,'addEventListener').mockImplementation((event,callback)=>{preferences.set(event,callback as any);return{remove:jest.fn()};});
 jest.spyOn(AppState,'addEventListener').mockImplementation((_event,callback)=>{lifecycle=callback;return{remove:jest.fn()};});
});
afterEach(()=>{jest.restoreAllMocks();jest.useRealTimers();});
// React 19 act can leave a queued microtask; only animation timeouts must be absent.
const expectNoAnimationTimers=()=>{jest.runAllTicks();expect(jest.getTimerCount()).toBe(0);};
const visible=(tree:Renderer.ReactTestRenderer)=>tree.root.findByProps({testID:'status-animated-text'}).props.children[0];
test('reference cycle types, holds, deletes, resets, and independently blinks the cursor',()=>{
 expect(typewriterFrame(0,10).count).toBe(0);expect(typewriterFrame(1000,10).count).toBeGreaterThan(0);
 expect(typewriterFrame(1540,10).count).toBe(10);expect(typewriterFrame(2400,10).count).toBe(10);
 expect(typewriterFrame(2600,10).count).toBeLessThan(10);expect(typewriterFrame(2860,10).count).toBe(0);expect(typewriterFrame(3000,10).count).toBe(0);
 expect(typewriterFrame(0,10).cursor).toBe(true);expect(typewriterFrame(325,10).cursor).toBe(false);expect(typewriterFrame(650,10).cursor).toBe(true);
 for(let time=0;time<8000;time+=13){const frame=typewriterFrame(time,100);expect(frame.count).toBeGreaterThanOrEqual(0);expect(frame.count).toBeLessThanOrEqual(100);expect(frame.delay).toBeGreaterThanOrEqual(16);}
});
test('larger native status types without changing the full-label layout or accessibility announcement',async()=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<ComposerStatus text="Connected"/>);});
 expect(StyleSheet.flatten(tree.root.findByProps({testID:'connection-status'}).props.style)).toMatchObject({minHeight:34,paddingBottom:11});
 expect(visible(tree)).toBe('');const reserve=tree.root.findByProps({testID:'status-layout-reservation'}).props;
 expect(StyleSheet.flatten(reserve.style)).toMatchObject({fontSize:13,lineHeight:22,fontWeight:'600',letterSpacing:0.3,opacity:0});
 act(()=>jest.advanceTimersByTime(1000));expect(visible(tree).length).toBeGreaterThan(0);expect(visible(tree)).not.toBe('Connected . . .');
 act(()=>jest.advanceTimersByTime(700));expect(visible(tree)).toBe('Connected . . .');
 expect(tree.root.findByProps({testID:'connection-status'}).props.accessibilityLabel).toBe('Connected');expect(tree.root.findByProps({testID:'status-layout-reservation'}).props.children).toEqual(reserve.children);
 act(()=>jest.advanceTimersByTime(1200));expect(visible(tree)).toBe('Connected');
 act(()=>jest.advanceTimersByTime(200));expect(visible(tree)).toBe('Connected');
 act(()=>jest.advanceTimersByTime(1600));expect(visible(tree)).toBe('Connected . . .');await act(async()=>tree.unmount());expectNoAnimationTimers();
});
test('a real phase change shows its full words immediately and restarts only the dot cycle',async()=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<ComposerStatus text="Connected"/>);});act(()=>jest.advanceTimersByTime(2300));expect(visible(tree)).toBe('Connected . . .');
 await act(async()=>tree.update(<ComposerStatus text="Bob is working"/>));expect(visible(tree)).toBe('Bob is working');expect(tree.root.findByProps({testID:'connection-status'}).props.accessibilityLabel).toBe('Bob is working');
 act(()=>jest.advanceTimersByTime(2300));expect(visible(tree)).toBe('Bob is working . . .');await act(async()=>tree.unmount());
});
test('actionable error labels are immediately complete and never animate',async()=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<ComposerStatus text="Device storage issue • keep Bob open" animate={false}/>);});
 expect(tree.root.findByProps({testID:'status-static-text'}).props.children).toBe('Device storage issue • keep Bob open . . .');expect(tree.root.findAllByProps({testID:'status-animated-text'})).toHaveLength(0);expectNoAnimationTimers();await act(async()=>tree.unmount());
});
test.each(['reduceMotionChanged','screenReaderChanged'])('%s switches to static full text and cancels the animation',async(event)=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<ComposerStatus text="Sending • automatic retry"/>);});
 act(()=>{jest.advanceTimersByTime(1000);preferences.get(event)!(true);});expect(tree.root.findByProps({testID:'status-static-text'}).props.children).toBe('Sending • automatic retry . . .');expectNoAnimationTimers();
 act(()=>preferences.get(event)!(false));expect(visible(tree)).toBe('Sending • automatic retry');await act(async()=>tree.unmount());expectNoAnimationTimers();
});
test('background pauses timers; foreground resumes dots without erasing the full words',async()=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<ComposerStatus text="Connecting…"/>);});
 act(()=>{jest.advanceTimersByTime(1500);lifecycle('background');});expect(tree.root.findByProps({testID:'status-static-text'}).props.children).toBe('Connecting . . .');expectNoAnimationTimers();
 act(()=>lifecycle('active'));expect(visible(tree)).toBe('Connecting');act(()=>jest.advanceTimersByTime(2300));expect(visible(tree)).toBe('Connecting . . .');await act(async()=>tree.unmount());expectNoAnimationTimers();
});

test.each([
 ['Connected','Connected . . .'],
 ['Connecting…','Connecting . . .'],
 ['Sending...','Sending . . .'],
 ['Bob is working . . .','Bob is working . . .'],
 ['',''],
])('status punctuation is spaced and never duplicated: %s',(input,expected)=>{
 expect(statusDisplayLabel(input)).toBe(expected);
});

test('return animation deletes only the three dots and preserves the complete status across every loop boundary',()=>{
 const label=statusDisplayLabel('Bob is working'),length=Array.from(label).length,base=Array.from('Bob is working').length;
 expect(label.slice(0,typewriterFrame(2440,length,base).count)).toBe('Bob is working . . .');
 expect(label.slice(0,typewriterFrame(2580,length,base).count)).toBe('Bob is working . .');
 expect(label.slice(0,typewriterFrame(2720,length,base).count)).toBe('Bob is working .');
 expect(label.slice(0,typewriterFrame(2860,length,base).count)).toBe('Bob is working');
 for(let time=2440;time<18000;time+=7)expect(typewriterFrame(time,length,base).count).toBeGreaterThanOrEqual(base);
 expect(typewriterFrame(3000,length,base).count).toBe(base);
 expect(typewriterFrame(4540,length,base).count).toBe(length);
});

test('rendered words never disappear during repeated dot-only cycles',async()=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<ComposerStatus text="Connected"/>);});
 act(()=>jest.advanceTimersByTime(1700));expect(visible(tree)).toBe('Connected . . .');
 for(let step=0;step<140;step++){act(()=>jest.advanceTimersByTime(100));expect(visible(tree).startsWith('Connected')).toBe(true);}
 await act(async()=>tree.unmount());expectNoAnimationTimers();
});


test('rapid phase changes never retype or blank the words, keep scalable geometry and announce only the literal phase',async()=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<ComposerStatus text="Waiting for model…"/>);});
 const instance=tree.root.findByProps({testID:'connection-status'});
 act(()=>jest.advanceTimersByTime(1700));
 for(const text of ['Thinking…','Writing response…','Working…','Retrying response…','Waiting for model…']){
  await act(async()=>tree.update(<ComposerStatus text={text}/>));
  const base=text.replace(/…$/,'');expect(visible(tree)).toBe(base);
  expect(tree.root.findByProps({testID:'connection-status'})).toBe(instance);
  expect(instance.props.accessibilityLabel).toBe(text);
  const reserve=tree.root.findByProps({testID:'status-layout-reservation'});
  expect(reserve.props.numberOfLines).toBeUndefined();expect(reserve.props.allowFontScaling).not.toBe(false);
  expect(StyleSheet.flatten(reserve.props.style).fontSize).toBe(13);
  act(()=>jest.advanceTimersByTime(250));expect(visible(tree).startsWith(base)).toBe(true);
 }
 await act(async()=>tree.unmount());expectNoAnimationTimers();
});


test.each(['Waiting for your answer','Connection needs attention • pair again','Device storage issue • keep Bob open'])('static first phase (%s) never makes the next phase retype',async(text)=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<ComposerStatus text={text} animate={false}/>);});
 expect(tree.root.findByProps({testID:'status-static-text'}).props.children).toBe(statusDisplayLabel(text));
 await act(async()=>tree.update(<ComposerStatus text="Thinking…" animate/>));expect(visible(tree)).toBe('Thinking');
 act(()=>jest.advanceTimersByTime(1600));expect(visible(tree)).toBe('Thinking . . .');
 await act(async()=>tree.unmount());expectNoAnimationTimers();
});

test('phase changes while static remain remembered even after returning to the initial label',async()=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<ComposerStatus text="Waiting for model…" animate={false}/>);});
 await act(async()=>tree.update(<ComposerStatus text="Thinking…" animate={false}/>));
 await act(async()=>tree.update(<ComposerStatus text="Waiting for model…" animate/>));expect(visible(tree)).toBe('Waiting for model');
 await act(async()=>tree.unmount());expectNoAnimationTimers();
});
