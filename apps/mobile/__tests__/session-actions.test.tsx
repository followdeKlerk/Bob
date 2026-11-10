jest.mock('lucide-react-native',()=>new Proxy({},{get:(_,name)=>name==='__esModule'?true:()=>null}));
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Alert,BackHandler,ScrollView,StyleSheet} from 'react-native';
import {SessionActions} from '../components/session-actions';
import {SectionActions} from '../components/section-ui';
import {Text,TextInput} from '../components/app-text';
import type {AgentSession} from '../use-agent-overview';
const session:AgentSession={conversationId:7,title:'A long conversation title that can wrap without becoming a huge heading',status:'working',agents:[]};
const button=(tree:Renderer.ReactTestRenderer,label:string)=>tree.root.findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0];
let tree:Renderer.ReactTestRenderer;
afterEach(async()=>{if(tree)await act(async()=>tree.unmount());jest.restoreAllMocks();});
async function mount(onAction=jest.fn(async()=>{}),value=session){
 const onClose=jest.fn();await act(async()=>{tree=Renderer.create(<SessionActions session={value} onClose={onClose} onAction={onAction}/>);});return {onAction,onClose};
}
test('session controls are plain 48dp rows above a measured, soft-boundary Cancel footer',async()=>{
 await mount();
 const scroll=tree.root.findByType(ScrollView),footer=tree.root.findByType(SectionActions);
 expect(StyleSheet.flatten(tree.root.findByProps({testID:'session-action-sheet'}).props.style)).toMatchObject({maxHeight:'100%',flexShrink:1});
 expect(StyleSheet.flatten(scroll.props.style)).toMatchObject({flexShrink:1,minHeight:0});
 expect(scroll.findAllByProps({accessibilityLabel:'Close session controls'})).toHaveLength(0);
 expect(footer.findAllByProps({accessibilityLabel:'Close session controls'}).length).toBeGreaterThan(0);
 for(const label of ['Rename','Pin to top','Archive','Delete']){
  expect(StyleSheet.flatten(button(tree,label).props.style)).toMatchObject({minHeight:48,minWidth:48});
  expect(StyleSheet.flatten(button(tree,label).props.style).borderWidth).toBe(1);
 }
 expect(tree.root.findAllByType(Text).every(node=>node.props.typography==='ui')).toBe(true);
 const title=tree.root.findByType(ScrollView).findAllByType(Text)[0];
 expect(StyleSheet.flatten(title.props.style)).toMatchObject({fontSize:16,lineHeight:24});
 expect(title.props.numberOfLines).toBeUndefined();
 const overlay=tree.root.findByProps({testID:'section-footer-overlay'});
 act(()=>overlay.props.onLayout({nativeEvent:{layout:{height:208}}}));
 expect(tree.root.findByType(ScrollView)).toBe(scroll);
 expect(StyleSheet.flatten(scroll.props.contentContainerStyle).paddingBottom).toBe(236);
});
test('rename input survives footer wrapping and failed duplicate submissions with the complete draft intact',async()=>{
 let reject!:(error:Error)=>void;
 const onAction=jest.fn().mockImplementationOnce(()=>new Promise<void>((_resolve,fail)=>{reject=fail;})).mockResolvedValue(undefined);
 const {onClose}=await mount(onAction);
 act(()=>button(tree,'Rename').props.onPress());
 const input=tree.root.findByType(TextInput),scroll=tree.root.findByType(ScrollView);
 act(()=>input.props.onChangeText('  The complete renamed conversation  '));
 expect(input.props.typography).toBe('ui');
 const footer=tree.root.findByType(SectionActions);
 expect(footer.findByProps({testID:'section-footer-leading'}).findAllByProps({accessibilityLabel:'Cancel rename'}).length).toBeGreaterThan(0);
 expect(footer.findByProps({testID:'section-footer-actions'}).findAllByProps({accessibilityLabel:'Save conversation name'}).length).toBeGreaterThan(0);
 act(()=>tree.root.findByProps({testID:'section-footer-overlay'}).props.onLayout({nativeEvent:{layout:{height:240}}}));
 expect(tree.root.findByType(TextInput)).toBe(input);expect(tree.root.findByType(ScrollView)).toBe(scroll);
 expect(input.props.value).toBe('  The complete renamed conversation  ');
 const save=button(tree,'Save conversation name').props.onPress;
 act(()=>{save();save();});expect(onAction).toHaveBeenCalledTimes(1);
 expect(button(tree,'Cancel rename').props.disabled).toBe(true);
 expect(button(tree,'Dismiss session controls').props.disabled).toBe(true);expect(onClose).not.toHaveBeenCalled();
 await act(async()=>reject(Error('Offline: name was not saved')));
 expect(tree.root.findByType(TextInput)).toBe(input);expect(input.props.value).toBe('  The complete renamed conversation  ');
 expect(tree.root.findAllByProps({accessibilityRole:'alert'}).length).toBeGreaterThan(0);
 await act(async()=>button(tree,'Save conversation name').props.onPress());
 expect(onAction).toHaveBeenLastCalledWith('7','rename','The complete renamed conversation');
 expect(onClose).toHaveBeenCalled();
});
test('delete still confirms, and Trash offers only Restore without starting or selecting a conversation',async()=>{
 const alert=jest.spyOn(Alert,'alert').mockImplementation(()=>{}),onAction=jest.fn(async()=>{});
 await mount(onAction);act(()=>button(tree,'Delete').props.onPress());
 expect(onAction).not.toHaveBeenCalled();expect(alert).toHaveBeenCalledWith('Move conversation to Trash?',expect.any(String),expect.any(Array));
 await act(async()=>alert.mock.calls[0][2]![1].onPress?.());expect(onAction).toHaveBeenCalledWith('7','delete',undefined);
 await act(async()=>tree.update(<SessionActions session={{...session,trashed:true}} onClose={jest.fn()} onAction={onAction}/>));
 expect(button(tree,'Delete')).toBeUndefined();expect(button(tree,'Rename')).toBeUndefined();
 await act(async()=>button(tree,'Restore conversation').props.onPress());expect(onAction).toHaveBeenLastCalledWith('7','restore',undefined);
});
test('Android Back consumes the sheet and refuses to close during an in-flight mutation',async()=>{
 let back!:()=>boolean,resolve!:()=>void;
 jest.spyOn(BackHandler,'addEventListener').mockImplementation((_event,callback)=>{back=callback as ()=>boolean;return {remove:jest.fn()};});
 const {onClose}=await mount(jest.fn(()=>new Promise<void>(done=>{resolve=done;})));
 act(()=>button(tree,'Pin to top').props.onPress());expect(back()).toBe(true);expect(onClose).not.toHaveBeenCalled();
 await act(async()=>resolve());expect(onClose).toHaveBeenCalledTimes(1);
});
