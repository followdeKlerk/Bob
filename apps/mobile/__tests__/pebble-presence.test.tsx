import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Animated,StyleSheet} from 'react-native';
import {PebblePresence} from '../components/pebble-presence';
import {useAppMotion} from '../app-motion';
import type {ComposerActivity} from '../composer-activity';
import {PEBBLE_QUIPS,pickPebbleQuip} from '../pebble-quips';
jest.mock('../app-motion',()=>({...jest.requireActual('../app-motion'),useAppMotion:jest.fn(()=>true)}));
const activity=(phase:ComposerActivity['phase']='thinking',text='Thinking…'):ComposerActivity=>({phase,text,animate:true});
const render=(phase:ComposerActivity['phase']='thinking',scope='one',active=true)=><PebblePresence active={active} scope={scope} activity={activity(phase)}/>;
beforeEach(()=>{
 jest.useFakeTimers({doNotFake:['setImmediate','nextTick','queueMicrotask']});jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
 jest.mocked(useAppMotion).mockReturnValue(true);
 jest.spyOn(Animated,'timing').mockReturnValue({start:jest.fn(),stop:jest.fn(),reset:jest.fn()});
 jest.spyOn(Animated,'loop').mockReturnValue({start:jest.fn(),stop:jest.fn(),reset:jest.fn()});
});
afterEach(()=>{jest.restoreAllMocks();jest.useRealTimers();});
const quips=(tree:Renderer.ReactTestRenderer)=>tree.root.findAll(node=>typeof node.type==='string'&&node.props.testID==='pebble-quip');
test('truth first, delayed bounded quip, then silence; no repeat while phase remains unchanged',async()=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(render());});
 expect(quips(tree)).toHaveLength(0);
 await act(async()=>jest.advanceTimersByTime(6500));expect(quips(tree)).toHaveLength(1);
 const first=quips(tree)[0].props.children;
 expect(tree.root.findAllByProps({testID:'pebble-status-text'})[0].props.children).toBe('Thinking…');
 await act(async()=>jest.advanceTimersByTime(7200));expect(quips(tree)).toHaveLength(0);
 await act(async()=>jest.advanceTimersByTime(24800));expect(quips(tree)).toHaveLength(1);expect(quips(tree)[0].props.children).not.toBe(first);
 await act(async()=>tree.unmount());expect(jest.getTimerCount()).toBe(0);
});
test('new phases, scope switches and hidden Chat cannot retain old jokes or timers',async()=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(render());});
 await act(async()=>jest.advanceTimersByTime(6500));expect(quips(tree)).toHaveLength(1);
 await act(async()=>tree.update(render('question')));expect(quips(tree)).toHaveLength(0);expect(jest.getTimerCount()).toBe(0);
 await act(async()=>tree.update(render('working','two')));expect(quips(tree)).toHaveLength(0);
 await act(async()=>jest.advanceTimersByTime(6500));expect(quips(tree)).toHaveLength(1);
 await act(async()=>tree.update(render('working','two',false)));expect(quips(tree)).toHaveLength(0);expect(jest.getTimerCount()).toBe(0);
 await act(async()=>tree.unmount());
});
test.each(['idle','connecting','sending'] as const)('%s has no bubble or joke loop',async phase=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(render(phase));});
 expect(tree.root.findAllByProps({testID:'pebble-speech'})).toHaveLength(0);expect(jest.getTimerCount()).toBe(0);
 await act(async()=>tree.unmount());
});
test('reduced motion or screen-reader gate keeps literal status and disables random chatter',async()=>{
 jest.mocked(useAppMotion).mockReturnValue(false);let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(render());});
 expect(tree.root.findAllByProps({testID:'pebble-status-text'}).length).toBeGreaterThan(0);
 expect(jest.getTimerCount()).toBe(0);expect(quips(tree)).toHaveLength(0);
 await act(async()=>tree.unmount());
});
test('catalogue is short, unique and excludes safety/interaction phases; picker excludes recent history',()=>{
 const lines=Object.values(PEBBLE_QUIPS).flat();expect(new Set(lines).size).toBe(lines.length);
 expect(lines.every(line=>line.length<=64)).toBe(true);
 for(const phase of ['retry','question','stopping','connection','idle'] as const)expect(pickPebbleQuip(phase,[])).toBeUndefined();
 const pool=PEBBLE_QUIPS.thinking!;
 expect(pickPebbleQuip('thinking',[pool[0]],()=>0)).toBe(pool[1]);
 expect(pickPebbleQuip('thinking',pool,()=>0)).toBeUndefined();
});

test('connection recovery and summary retries stay visible and joke-free',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<PebblePresence active scope="one" activity={activity('connection','Connection needs attention • pair again')}/>);});
 expect(tree.root.findAllByProps({testID:'pebble-status-text'})[0].props.children).toBe('Connection needs attention • pair again');
 expect(jest.getTimerCount()).toBe(0);
 await act(async()=>tree.update(<PebblePresence active scope="one" activity={activity('compaction','Retrying summary…')}/>));
 expect(jest.getTimerCount()).toBe(0);expect(quips(tree)).toHaveLength(0);
 await act(async()=>tree.unmount());
});

test('speech overlays the chat without reflowing the avatar lane as labels and quips grow',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(render());});
 const avatar=tree.root.findByProps({testID:'pebble-bob'});
 const lane=()=>StyleSheet.flatten(tree.root.findByProps({testID:'pebble-presence'}).props.style);
 const bubble=()=>StyleSheet.flatten(tree.root.findAllByProps({testID:'pebble-speech'})[0].props.style);
 expect(lane()).toMatchObject({height:76,overflow:'visible'});
 expect(bubble()).toMatchObject({position:'absolute',left:78,right:3,bottom:18});
 await act(async()=>jest.advanceTimersByTime(6500));expect(quips(tree)).toHaveLength(1);
 expect(lane().height).toBe(76);expect(bubble().bottom).toBe(18);
 await act(async()=>tree.update(<PebblePresence active scope="one" activity={activity('question','A longer label that wraps over several lines at accessibility text sizes')}/>));
 expect(tree.root.findByProps({testID:'pebble-bob'})).toBe(avatar);expect(lane().height).toBe(76);
 expect(bubble().position).toBe('absolute');expect(bubble().height).toBeUndefined();
 await act(async()=>tree.unmount());
});
