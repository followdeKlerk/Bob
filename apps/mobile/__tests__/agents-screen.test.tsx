import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {View,StyleSheet} from 'react-native';
import {AgentsScreen} from '../components/agents-screen';
const text=(tree:Renderer.ReactTestRenderer)=>tree.root.findAll(n=>typeof n.props.children==='string').map(n=>n.props.children).join(' ');
test.each([true,false])('empty agent viewer explains conversation availability: %s',async hasConversation=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<AgentsScreen agents={[]} onSelect={()=>{}} status="" hasConversation={hasConversation}>{null}</AgentsScreen>);});
 expect(text(tree)).toContain(hasConversation?'No active agents.':'Open a conversation to view its agents.');
 expect(tree.root.findAll(n=>typeof n.props.onPress==='function')).toHaveLength(0);await act(async()=>tree.unmount());
});
test('selector is view-only, keeps completed agents, and hidden viewer retains its transcript but not accessibility/touches',async()=>{
 const select=jest.fn();let tree!:Renderer.ReactTestRenderer;
 const props={agents:[['Worker',{conversationId:8,status:'working'}],['Reviewer',{conversationId:9,status:'idle'}]] as [string,{conversationId:number;status:string}][],selected:8,onSelect:select,status:'Connected',hasConversation:true};
 await act(async()=>{tree=Renderer.create(<AgentsScreen {...props}><View testID="retained-agent-transcript"/></AgentsScreen>);});
 const transcript=tree.root.findByProps({testID:'retained-agent-transcript'});
 const choices=tree.root.findAll(n=>n.props.accessibilityRole==='tab'&&typeof n.props.onPress==='function');expect(choices).toHaveLength(2);expect(choices[0].props.accessibilityState.selected).toBe(true);
 expect(StyleSheet.flatten(choices[1].props.style).minHeight).toBeGreaterThanOrEqual(48);
 act(()=>choices[1].props.onPress());expect(select).toHaveBeenCalledWith(9);
 await act(async()=>tree.update(<AgentsScreen {...props} visible={false}><View testID="retained-agent-transcript"/></AgentsScreen>));
 const screen=tree.root.findByProps({testID:'agents-screen'});expect(screen.props.pointerEvents).toBe('none');expect(screen.props.importantForAccessibility).toBe('no-hide-descendants');expect(tree.root.findByProps({testID:'retained-agent-transcript'})).toBe(transcript);
 await act(async()=>tree.unmount());
});

test('minimal history switch and empty states distinguish active and inactive views',async()=>{
 const toggle=jest.fn();let tree!:Renderer.ReactTestRenderer;
 const props={agents:[],onSelect:jest.fn(),status:'',hasConversation:true,historyCount:3,onHistoryChange:toggle};
 await act(async()=>{tree=Renderer.create(<AgentsScreen {...props}>{null}</AgentsScreen>);});
 expect(text(tree)).toContain('No active agents.');expect(text(tree)).toContain('View inactive agents in History.');
 const control=tree.root.findByProps({accessibilityLabel:'Agent history'});expect(control.props.accessibilityRole).toBe('switch');expect(control.props.accessibilityState.checked).toBe(false);expect(StyleSheet.flatten(control.props.style).minHeight).toBeGreaterThanOrEqual(48);
 act(()=>control.props.onPress());expect(toggle).toHaveBeenCalledWith(true);
 await act(async()=>tree.update(<AgentsScreen {...props} history>{null}</AgentsScreen>));
 expect(text(tree)).toContain('No inactive agents.');expect(control.props.accessibilityState.checked).toBe(true);
 act(()=>control.props.onPress());expect(toggle).toHaveBeenLastCalledWith(false);await act(async()=>tree.unmount());
});
