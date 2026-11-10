import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Animated,StyleSheet,Text} from 'react-native';
import {CompactActivityRow} from '../components/compact-activity-row';
import {ActivityDisclosure} from '../components/activity-disclosure';
import {useChatMotion} from '../chat-motion';
import {activityTones} from '../theme';
jest.mock('../chat-motion',()=>({useChatMotion:jest.fn(()=>false)}));
jest.mock('lucide-react-native',()=>({ChevronDown:()=>null,ChevronRight:()=>null,SquareTerminal:()=>null}));
const props={title:'Read file',accessibilityLabel:'Tool details: read',expanded:false,onPress:()=>{}};
afterEach(()=>jest.restoreAllMocks());
test('running and completed status use plain symbols without spinner rings or transition motion',async()=>{
 (useChatMotion as jest.Mock).mockReturnValue(true);
 const loop=jest.spyOn(Animated,'loop'),timing=jest.spyOn(Animated,'timing');let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<CompactActivityRow {...props} status="running"/>);});
 expect(tree.root.findAllByType(Text).find(node=>node.props.accessibilityLabel==='running')!.props.children).toBe('…');
 expect(tree.root.findAllByProps({testID:'activity-running-ring'})).toHaveLength(0);
 await act(async()=>tree.update(<CompactActivityRow {...props} status="done"/>));
 expect(tree.root.findAllByType(Text).find(node=>node.props.accessibilityLabel==='done')!.props.children).toBe('✓');
 expect(loop).not.toHaveBeenCalled();expect(timing).not.toHaveBeenCalled();await act(async()=>tree.unmount());
});
test('completed historical rows never replay motion when preferences resolve or the view resumes',async()=>{
 (useChatMotion as jest.Mock).mockReturnValue(false);const timing=jest.spyOn(Animated,'timing');let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<CompactActivityRow {...props} status="done"/>);});
 (useChatMotion as jest.Mock).mockReturnValue(true);await act(async()=>tree.update(<CompactActivityRow {...props} status="done"/>));
 expect(timing).not.toHaveBeenCalled();await act(async()=>tree.unmount());
});
test('disclosure retains natural height and does not replay old detail on resume',async()=>{
 (useChatMotion as jest.Mock).mockReturnValue(true);const timing=jest.spyOn(Animated,'timing');let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<ActivityDisclosure><Text>Full details</Text></ActivityDisclosure>);});
 expect(timing).toHaveBeenCalledTimes(2);
 const container=tree.root.findByType(ActivityDisclosure).findAll(node=>node.props.style&&StyleSheet.flatten(node.props.style)?.opacity)[0];
 expect(StyleSheet.flatten(container.props.style)).not.toHaveProperty('height');expect(StyleSheet.flatten(container.props.style)).not.toHaveProperty('overflow');
 (useChatMotion as jest.Mock).mockReturnValue(false);await act(async()=>tree.update(<ActivityDisclosure><Text>Full details</Text></ActivityDisclosure>));
 (useChatMotion as jest.Mock).mockReturnValue(true);await act(async()=>tree.update(<ActivityDisclosure><Text>Full details</Text></ActivityDisclosure>));
 expect(timing).toHaveBeenCalledTimes(2);await act(async()=>tree.unmount());
});
test('task status accents retain text contrast in both approved app palettes',()=>{
 const luminance=(hex:string)=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
 for(const tones of Object.values(activityTones))for(const {ink,fill} of Object.values(tones)){const a=luminance(ink),b=luminance(fill);expect((Math.max(a,b)+.05)/(Math.min(a,b)+.05)).toBeGreaterThanOrEqual(4.5);}
});
