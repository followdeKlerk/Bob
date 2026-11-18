import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Text,Animated} from 'react-native';
import {MessageEntrance,MessageEntrances} from '../components/message-entrance';
import {MotionSurface} from '../components/motion-surface';
import {useAppMotion} from '../app-motion';
jest.mock('../app-motion',()=>({...jest.requireActual('../app-motion'),useAppMotion:jest.fn(()=>true)}));
beforeEach(()=>{jest.mocked(useAppMotion).mockReturnValue(true);jest.spyOn(Animated,'timing').mockReturnValue({start:jest.fn(),stop:jest.fn(),reset:jest.fn()});});
afterEach(()=>jest.restoreAllMocks());
test('only a new outbox identity enters once, never history, reconciliation, retry or virtualized remount',async()=>{
 const registry=new MessageEntrances();registry.arm('outbox-one');let tree!:Renderer.ReactTestRenderer;
 const render=(text:string)=><MessageEntrance registry={registry} id="outbox-one"><Text>{text}</Text></MessageEntrance>;
 await act(async()=>{tree=Renderer.create(render('Local text'));});
 expect(tree.root.findByType(MotionSurface).props.active).toBe(true);expect(Animated.timing).toHaveBeenCalledTimes(1);
 const node=tree.root.findByType(Text);
 await act(async()=>tree.update(render('Stored text')));expect(tree.root.findByType(Text)).toBe(node);expect(Animated.timing).toHaveBeenCalledTimes(1);
 await act(async()=>tree.unmount());await act(async()=>{tree=Renderer.create(render('Retry/recycled cell'));});
 expect(tree.root.findByType(MotionSurface).props.active).toBe(false);expect(Animated.timing).toHaveBeenCalledTimes(1);
 await act(async()=>tree.unmount());await act(async()=>{tree=Renderer.create(<MessageEntrance registry={registry} id="history"><Text>History</Text></MessageEntrance>);});
 expect(tree.root.findByType(MotionSurface).props.active).toBe(false);await act(async()=>tree.unmount());
});
test('motion disabled on admission consumes decoration rather than replaying on resume',async()=>{
 const registry=new MessageEntrances();registry.arm('one');jest.mocked(useAppMotion).mockReturnValue(false);let tree!:Renderer.ReactTestRenderer;
 const render=()=> <MessageEntrance registry={registry} id="one"><Text>Immediate exact 👩🏽‍💻 text</Text></MessageEntrance>;
 await act(async()=>{tree=Renderer.create(render());});expect(tree.root.findByType(Text).props.children).toBe('Immediate exact 👩🏽‍💻 text');expect(Animated.timing).not.toHaveBeenCalled();
 jest.mocked(useAppMotion).mockReturnValue(true);await act(async()=>tree.update(render()));expect(Animated.timing).not.toHaveBeenCalled();
 await act(async()=>tree.unmount());await act(async()=>{tree=Renderer.create(render());});expect(Animated.timing).not.toHaveBeenCalled();await act(async()=>tree.unmount());
});
test('unseen decoration is bounded and scoped to its retained pane',()=>{
 const registry=new MessageEntrances();for(let i=0;i<200;i++)registry.arm(String(i));
 expect(registry.claim('0')).toBe(false);expect(registry.claim('199')).toBe(true);expect(registry.claim('199')).toBe(false);
 expect(new MessageEntrances().claim('198')).toBe(false);
});
