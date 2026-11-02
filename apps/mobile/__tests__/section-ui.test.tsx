import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {ActivityIndicator,Pressable,StyleSheet,Text,View} from 'react-native';
import {Bell,Plus} from 'lucide-react-native';
import {RoundAction,SectionHeading,SettingsGroup,SettingsRow} from '../components/section-ui';
jest.mock('lucide-react-native',()=>new Proxy({},{get:(_,name)=>name==='__esModule'?true:()=>null}));
test('settings toggles expose state with a full-size row and concise visible label',async()=>{
 const toggle=jest.fn();let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<SettingsGroup title="Notifications"><SettingsRow title="Reply notifications" label="Last reply notifications: off" icon={Bell} checked={false} onPress={toggle}/></SettingsGroup>);});
 const row=tree.root.findAll(node=>node.props.accessibilityRole==='switch'&&typeof node.props.onPress==='function')[0];
 expect(row.props.accessibilityRole).toBe('switch');expect(row.props.accessibilityState).toMatchObject({checked:false,disabled:false});
 expect(StyleSheet.flatten(row.props.style).minHeight).toBeGreaterThanOrEqual(48);
 act(()=>row.props.onPress());expect(toggle).toHaveBeenCalledTimes(1);
 await act(async()=>tree.update(<SettingsRow title="Reply notifications" label="Last reply notifications: on" icon={Bell} checked disabled onPress={toggle}/>));
 expect(tree.root.findAll(node=>node.props.accessibilityRole==='switch'&&typeof node.props.onPress==='function')[0].props).toMatchObject({disabled:true,accessibilityState:{checked:true,disabled:true}});
 await act(async()=>tree.unmount());
});
test('shared headings wrap text and icon actions keep accessible labels and 48-point targets',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<SectionHeading title="Notes"><RoundAction label="Create note" icon={Plus} primary onPress={()=>{}}/></SectionHeading>);});
 const heading=tree.root.findAllByType(Text).find(node=>node.props.accessibilityRole==='header')!;
 expect(heading.props.numberOfLines).toBeUndefined();
 const button=tree.root.findAll(node=>node.props.accessibilityLabel==='Create note'&&typeof node.props.onPress==='function')[0];expect(button.props.accessibilityLabel).toBe('Create note');
 expect(StyleSheet.flatten(button.props.style)).toMatchObject({width:48,height:48});
 await act(async()=>tree.unmount());
});
test('only an active settings operation gets a miniature spinner and busy state',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<View><SettingsRow title="Fetching" icon={Bell} loading onPress={()=>{}}/><SettingsRow title="Static" icon={Bell} onPress={()=>{}}/></View>);});
 const rows=tree.root.findAll(node=>typeof node.props.onPress==='function'&&node.props.accessibilityRole==='button');
 expect(rows[0].props).toMatchObject({disabled:true,accessibilityState:{busy:true}});
 expect(rows[0].findAllByType(ActivityIndicator)).toHaveLength(1);
 expect(rows[0].findByType(ActivityIndicator).props.size).toBe('small');
 expect(rows[1].props).toMatchObject({disabled:false,accessibilityState:{busy:false}});
 expect(rows[1].findAllByType(ActivityIndicator)).toHaveLength(0);
 await act(async()=>tree.unmount());
});

test('legacy compact flag cannot introduce inconsistent header control geometry',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<RoundAction label="Create note" icon={Plus} primary compact onPress={()=>{}}/>);});
 const button=tree.root.findAll(node=>node.props.accessibilityRole==='button'&&typeof node.props.onPress==='function')[0];
 expect(StyleSheet.flatten(button.props.style)).toMatchObject({width:48,height:48});
 expect(button.findAllByType(View).some(node=>{const style=StyleSheet.flatten(node.props.style);return style?.width===48&&style?.height===48&&style?.borderRadius===14&&style?.borderWidth===1;})).toBe(true);
 await act(async()=>tree.unmount());
});

test('menu cards and controls use the shared outline/shape and headers keep return separate from right actions',async()=>{
 const {menuChrome}=require('../theme');let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<View><SectionHeading title="Schedules" subtitle="This workstation" onBack={()=>{}}><RoundAction label="Refresh" icon={Plus} onPress={()=>{}}/><RoundAction label="Create" icon={Plus} primary onPress={()=>{}}/></SectionHeading><SettingsGroup title="Group"><Text>Information</Text></SettingsGroup></View>);});
 const actions=tree.root.findByProps({testID:'section-heading-actions'});
 expect(StyleSheet.flatten(actions.props.style)).toMatchObject({justifyContent:'flex-end',gap:8,marginLeft:'auto'});
 expect(actions.findAll(node=>node.props.accessibilityRole==='button'&&typeof node.props.onPress==='function').map(node=>node.props.accessibilityLabel)).toEqual(['Refresh','Create']);
 expect(actions.findAllByProps({accessibilityLabel:'Back to previous menu'})).toHaveLength(0);
 const group=tree.root.findByType(SettingsGroup);
 expect(group.findAllByType(View).some(node=>{const style=StyleSheet.flatten(node.props.style);return style?.borderRadius===menuChrome.card.borderRadius&&style?.borderColor===menuChrome.card.borderColor&&style?.borderWidth===1;})).toBe(true);
 const refresh=actions.findAll(node=>node.props.accessibilityRole==='button'&&typeof node.props.onPress==='function')[0];
 expect(refresh.findAllByType(View).some(node=>{const style=StyleSheet.flatten(node.props.style);return style?.borderRadius===menuChrome.control.borderRadius&&style?.borderColor===menuChrome.control.borderColor&&style?.borderWidth===1;})).toBe(true);
 await act(async()=>tree.unmount());
});
