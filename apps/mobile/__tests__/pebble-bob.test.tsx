import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Animated,StyleSheet} from 'react-native';
import {PebbleBob} from '../components/pebble-bob';
import {useAppMotion} from '../app-motion';
jest.mock('../app-motion',()=>({useAppMotion:jest.fn(()=>true)}));
let loop:{start:jest.Mock;stop:jest.Mock;reset:jest.Mock};
beforeEach(()=>{
 jest.mocked(useAppMotion).mockReturnValue(true);
 loop={start:jest.fn(),stop:jest.fn(),reset:jest.fn()};
 jest.spyOn(Animated,'loop').mockReturnValue(loop);
});
afterEach(()=>jest.restoreAllMocks());
test('purple Pebble stays small, decorative and uses a non-blocking native animation',async()=>{
 const timing=jest.spyOn(Animated,'timing');let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<PebbleBob active working={false}/>);});
 const root=tree.root.findByProps({testID:'pebble-bob'});
 expect(root.props.pointerEvents).toBe('none');expect(root.props.importantForAccessibility).toBe('no-hide-descendants');
 expect(StyleSheet.flatten(root.props.style)).toMatchObject({width:78,height:64});
 expect(timing.mock.calls[0][1]).toMatchObject({duration:6400,useNativeDriver:true,isInteraction:false});
 expect(loop.start).toHaveBeenCalledTimes(1);
 expect(tree.root.findAll(node=>node.props.stopColor==='#D5BEF4').length).toBeGreaterThan(0);
 await act(async()=>tree.update(<PebbleBob active working/>));
 expect(tree.root.findByProps({testID:'pebble-bob'})).toBe(root);expect(loop.start).toHaveBeenCalledTimes(1);
 await act(async()=>tree.unmount());expect(loop.stop).toHaveBeenCalled();
});
test('hidden sessions and disabled motion stop the clock while leaving a static Pebble',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<PebbleBob active working/>);});
 await act(async()=>tree.update(<PebbleBob active={false} working/>));expect(loop.stop).toHaveBeenCalledTimes(1);
 expect(tree.root.findByProps({testID:'pebble-bob'})).toBeDefined();
 jest.mocked(useAppMotion).mockReturnValue(false);
 await act(async()=>tree.update(<PebbleBob active working/>));expect(loop.start).toHaveBeenCalledTimes(1);
 await act(async()=>tree.unmount());
});
