import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Animated,StyleSheet} from 'react-native';
import {PebblePresence} from '../components/pebble-presence';
import {MotionSurface} from '../components/motion-surface';
import {useAppMotion} from '../app-motion';
import {ThemeContext,tokens} from '../theme-context';
import type {ComposerActivity} from '../composer-activity';
jest.mock('../app-motion',()=>({...jest.requireActual('../app-motion'),useAppMotion:jest.fn(()=>true)}));
const activity=(phase:ComposerActivity['phase']='thinking',text='Thinking…'):ComposerActivity=>({phase,text,animate:true});
const render=(phase:ComposerActivity['phase']='thinking',scope='one',active=true,text='Thinking…')=><PebblePresence active={active} scope={scope} activity={activity(phase,text)}/>;
beforeEach(()=>{
 jest.useFakeTimers({doNotFake:['setImmediate','nextTick','queueMicrotask']});
 jest.mocked(useAppMotion).mockReturnValue(true);
 jest.spyOn(Animated,'timing').mockReturnValue({start:jest.fn(),stop:jest.fn(),reset:jest.fn()});
 jest.spyOn(Animated,'loop').mockReturnValue({start:jest.fn(),stop:jest.fn(),reset:jest.fn()});
});
afterEach(()=>{jest.restoreAllMocks();jest.useRealTimers();});
const label=(tree:Renderer.ReactTestRenderer)=>tree.root.findAllByProps({testID:'pebble-status-text'})[0];
const flatten=(value:any):string=>typeof value==='string'?value:Array.isArray(value)?value.map(flatten).join(''):value?.children?flatten(value.children):'';
const factual=(tree:Renderer.ReactTestRenderer,text:string)=>{
 expect(label(tree).props.children).toBe(text);expect(flatten(tree.toJSON())).toBe(text);
 const status=tree.root.findAllByProps({accessibilityLabel:text})[0];
 expect(status.props).toMatchObject({accessible:true,accessibilityRole:'text',accessibilityLiveRegion:'polite'});
 expect(tree.root.findAllByProps({testID:'pebble-quip'})).toHaveLength(0);
 expect(jest.getTimerCount()).toBe(0);
};

test('only the factual label remains after prolonged work; no filler timers are ever scheduled',async()=>{
 const timeout=jest.spyOn(globalThis,'setTimeout'),interval=jest.spyOn(globalThis,'setInterval');
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(render());});
 factual(tree,'Thinking…');
 for(const elapsed of [6500,7200,32000,300000]){
  await act(async()=>jest.advanceTimersByTime(elapsed));factual(tree,'Thinking…');
 }
 expect(timeout).not.toHaveBeenCalled();expect(interval).not.toHaveBeenCalled();
 await act(async()=>tree.unmount());expect(jest.getTimerCount()).toBe(0);
});

test('phase and scope changes show the latest literal immediately without remounting the avatar',async()=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(render());});
 const avatar=tree.root.findByProps({testID:'pebble-bob'}),speech=tree.root.findByType(MotionSurface);
 for(const [phase,scope,text] of [
  ['preparing','one','Preparing tools…'],['working','one','Running tools…'],
  ['writing','two','Writing response…'],['question','two','Waiting for your answer'],
  ['stopping','one','Stopping…'],['connection','one','Connection needs attention • pair again'],
  ['compaction','one','Retrying summary…'],
 ] as const){
  await act(async()=>tree.update(render(phase,scope,true,text)));factual(tree,text);
  expect(tree.root.findByType(MotionSurface)===speech).toBe(true);
  expect(speech.props.transitionKey).toBe(`${scope}:${phase}`);
  expect(tree.root.findByProps({testID:'pebble-bob'})===avatar).toBe(true);
 }
 await act(async()=>tree.unmount());expect(jest.getTimerCount()).toBe(0);
});

test('a same-phase label correction does not restart the speech entrance',async()=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(render('compaction','one',true,'Condensing conversation…'));});
 const calls=jest.mocked(Animated.timing).mock.calls.length;
 await act(async()=>tree.update(render('compaction','one',true,'Retrying summary…')));
 factual(tree,'Retrying summary…');expect(jest.mocked(Animated.timing)).toHaveBeenCalledTimes(calls);
 expect(tree.root.findByType(MotionSurface).props.transitionKey).toBe('one:compaction');
 await act(async()=>tree.unmount());
});

test.each(['idle','connecting','sending'] as const)('%s remains silent with the same reserved avatar lane',async phase=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(render(phase));});
 expect(tree.root.findAllByProps({testID:'pebble-speech'})).toHaveLength(0);
 expect(StyleSheet.flatten(tree.root.findByProps({testID:'pebble-presence'}).props.style).height).toBe(76);
 expect(jest.getTimerCount()).toBe(0);await act(async()=>tree.unmount());
});

test('hidden/foreground and reduced-motion/screen-reader gates never replace or replay factual state',async()=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(render('working','one',true,'Running tools…'));});
 const avatar=tree.root.findByProps({testID:'pebble-bob'});
 await act(async()=>tree.update(render('writing','two',false,'Writing response…')));
 expect(tree.root.findAllByProps({testID:'pebble-speech'})).toHaveLength(0);expect(jest.getTimerCount()).toBe(0);
 jest.mocked(useAppMotion).mockReturnValue(false);
 await act(async()=>tree.update(render('writing','two',true,'Writing response…')));factual(tree,'Writing response…');
 expect(tree.root.findByProps({testID:'pebble-bob'})===avatar).toBe(true);
 const calls=jest.mocked(Animated.timing).mock.calls.length;
 await act(async()=>tree.update(render('question','two',true,'Waiting for your answer')));factual(tree,'Waiting for your answer');
 expect(jest.mocked(Animated.timing)).toHaveBeenCalledTimes(calls);
 jest.mocked(useAppMotion).mockReturnValue(true);
 await act(async()=>tree.update(render('question','two',true,'Waiting for your answer')));factual(tree,'Waiting for your answer');
 await act(async()=>jest.advanceTimersByTime(60000));factual(tree,'Waiting for your answer');
 await act(async()=>tree.unmount());expect(jest.getTimerCount()).toBe(0);
});

test('both themes retain foreground status ink and scalable overlay geometry without moving the avatar',async()=>{
 const text='A longer factual label that wraps over several lines at accessibility text sizes';
 const themed=(scheme:'light'|'dark')=><ThemeContext.Provider value={tokens[scheme]}>{render('question','one',true,text)}</ThemeContext.Provider>;
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(themed('light'));});
 const avatar=tree.root.findByProps({testID:'pebble-bob'});
 for(const scheme of ['light','dark'] as const){
  await act(async()=>tree.update(themed(scheme)));factual(tree,text);
  expect(tree.root.findByProps({testID:'pebble-bob'})===avatar).toBe(true);
  expect(StyleSheet.flatten(tree.root.findByProps({testID:'pebble-presence'}).props.style)).toMatchObject({height:76,overflow:'visible'});
  expect(StyleSheet.flatten(tree.root.findByType(MotionSurface).props.style)).toMatchObject({position:'absolute',left:78,right:3,bottom:18});
  expect(StyleSheet.flatten(tree.root.findByType(MotionSurface).props.style).height).toBeUndefined();
  expect(StyleSheet.flatten(label(tree).props.style)).toMatchObject({fontSize:13,lineHeight:19,color:tokens[scheme].colors.foreground});
  expect(label(tree).props.numberOfLines).toBeUndefined();expect(label(tree).props.allowFontScaling).not.toBe(false);
 }
 await act(async()=>tree.unmount());
});
