import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Alert,Image,Modal,Pressable,StyleSheet,Text,TextInput} from 'react-native';
import {colors} from '../theme';
import {EdgeFade} from '../components/edge-fade';
import {SideDrawer} from '../components/side-drawer';
jest.mock('../keyboard-inset',()=>({useKeyboardInset:()=>0}));
jest.mock('../components/message-actions',()=>({ActionIcon:({label,onPress}:any)=>require('react').createElement(require('react-native').Pressable,{accessibilityLabel:label,onPress})}));
jest.mock('react-native-safe-area-context',()=>({useSafeAreaInsets:jest.fn(()=>({top:24,bottom:20,left:0,right:0}))}));
jest.mock('lucide-react-native',()=>{const {View}=require('react-native');return new Proxy({},{get:(_,name)=>name==='__esModule'?true:View});});
const action=jest.fn(async()=>{}),open=jest.fn(),close=jest.fn(),newChat=jest.fn();
const rows=[{id:'1',label:'First',onPress:open},{id:'2',label:'Archived session',archived:true,onPress:open},{id:'3',label:'Deleted session',trashed:true,onPress:open}];
let tree!:Renderer.ReactTestRenderer;
const button=(label:string)=>tree.root.findAll(node=>typeof node.props.onPress==='function'&&node.props.accessibilityLabel===label)[0];
beforeEach(async()=>{action.mockClear();newChat.mockClear();await act(async()=>{tree=Renderer.create(<SideDrawer visible onClose={close} navigation={[]} workspaces={[]} conversations={rows} onNew={newChat} onSettings={()=>{}} disabled={false} pairing={null} onSessionAction={action}/>);});});
afterEach(async()=>{await act(async()=>tree.unmount());jest.restoreAllMocks();});
test('long press opens compact controls and rename saves without starting another chat',async()=>{
 act(()=>button('First').props.onLongPress({nativeEvent:{pageY:350}}));expect(button('Pin to top')).toBeDefined();act(()=>button('Rename').props.onPress());act(()=>tree.root.findByProps({accessibilityLabel:'Conversation name'}).props.onChangeText('Renamed'));
 await act(async()=>button('Save conversation name').props.onPress());expect(action).toHaveBeenCalledWith('1','rename','Renamed');expect(open).not.toHaveBeenCalled();
});
test('delete is never performed before explicit confirmation',async()=>{
 const alert=jest.spyOn(Alert,'alert').mockImplementation(()=>{});act(()=>button('First').props.onLongPress({nativeEvent:{pageY:350}}));act(()=>button('Delete').props.onPress());expect(action).not.toHaveBeenCalled();expect(alert).toHaveBeenCalled();
 const choices=alert.mock.calls[0][2]!;expect(choices[0].style).toBe('cancel');await act(async()=>choices[1].onPress!());expect(action).toHaveBeenCalledWith('1','delete',undefined);
});
test('archived/trash tabs hide those sessions from the regular list and offer restore',async()=>{
 expect(button('Archived session')).toBeUndefined();expect(button('Deleted session')).toBeUndefined();act(()=>button('Archived').props.onPress());expect(button('Archived session')).toBeDefined();expect(button('First')).toBeUndefined();act(()=>button('Trash').props.onPress());act(()=>button('Deleted session').props.onLongPress({nativeEvent:{pageY:350}}));await act(async()=>button('Restore conversation').props.onPress());expect(action).toHaveBeenCalledWith('3','restore',undefined);
});

test('the list fills the viewport behind transparent header/footer overlays and decorative fades',()=>{
 const region=tree.root.findByProps({testID:'drawer-scroll-region'});
 expect(StyleSheet.flatten(region.props.style)).toMatchObject({position:'absolute',top:0,bottom:0,left:0,right:0});
 const header=tree.root.findByProps({testID:'drawer-header'}),footer=tree.root.findByProps({testID:'drawer-footer'});
 for(const overlay of [header,footer]){
  expect(StyleSheet.flatten(overlay.props.style)).toMatchObject({position:'absolute',backgroundColor:'transparent',left:0,right:0});
  expect(overlay.props.pointerEvents).toBe('box-none');
 }
 expect(StyleSheet.flatten(header.props.style).top).toBe(24);
 expect(StyleSheet.flatten(footer.props.style).bottom).toBe(20);
 const fades=tree.root.findByProps({testID:'drawer-fades'}).findAllByType(EdgeFade);expect(fades.map(fade=>fade.props.edge)).toEqual(['top','bottom']);
 const list=region.findByProps({testID:'drawer-scroll-list'});
 expect(list.props.contentContainerStyle.paddingTop).toBeGreaterThanOrEqual(fades[0].props.height);
 expect(list.props.contentContainerStyle.paddingBottom).toBeGreaterThanOrEqual(fades[1].props.height);
 for(const fade of fades){const overlay=fade.findAll(node=>node.props.pointerEvents==='none')[0];expect(overlay.props.accessible).toBe(false);expect(overlay.props.importantForAccessibility).toBe('no-hide-descendants');}
 expect(region.findAll(node=>node.props.accessibilityLabel==='New conversation')).toHaveLength(0);
 expect(button('New conversation')).toBeDefined();
 expect(tree.root.findByType(Modal).props.statusBarTranslucent).toBe(true);
 expect(tree.root.findByType(Modal).props.navigationBarTranslucent).toBe(true);
});
test('clearance follows measured overlays, including the expanded search header, without shortening the list viewport',()=>{
 const list=tree.root.findByProps({testID:'drawer-scroll-list'});
 act(()=>tree.root.findByProps({testID:'drawer-header'}).props.onLayout({nativeEvent:{layout:{height:140}}}));
 act(()=>tree.root.findByProps({testID:'drawer-footer'}).props.onLayout({nativeEvent:{layout:{height:96}}}));
 expect(list.props.contentContainerStyle.paddingTop).toBe(24+140+36);
 expect(list.props.contentContainerStyle.paddingBottom).toBe(20+96+44);
 expect(StyleSheet.flatten(tree.root.findByProps({testID:'drawer-scroll-region'}).props.style).bottom).toBe(0);
 for(const height of [0,-1,NaN,Infinity])act(()=>tree.root.findByProps({testID:'drawer-header'}).props.onLayout({nativeEvent:{layout:{height}}}));
 expect(list.props.contentContainerStyle.paddingTop).toBe(24+140+36);
});
test('the header uses the actual bundled Bob wordmark image, not a replacement text label',()=>{
 const logo=tree.root.findByProps({accessibilityLabel:'Bob logo'});
 expect(logo.type).toBe(Image);
 expect(logo.props.source).toBe(require('../assets/bob-wordmark.png'));
 expect(logo.props.resizeMode).toBe('contain');
 expect(tree.root.findAll(node=>node.type===Text&&node.props.children==='Bob')).toHaveLength(0);
});
test('searching and switching tabs keep the same native scroll list and fade overlays',()=>{
 const list=tree.root.findByProps({testID:'drawer-scroll-list'});
 act(()=>button('Search conversations').props.onPress());
 act(()=>tree.root.findByProps({accessibilityLabel:'Search loaded conversations'}).props.onChangeText('First'));
 expect(button('First')).toBeDefined();expect(tree.root.findByProps({testID:'drawer-scroll-list'})).toBe(list);
 act(()=>button('Trash').props.onPress());expect(tree.root.findAllByType(EdgeFade)).toHaveLength(2);
 expect(tree.root.findByProps({testID:'drawer-scroll-list'})).toBe(list);
});

test('New chat uses the charcoal theme with light text and remains available in the menu',()=>{
 const create=button('New conversation');expect(StyleSheet.flatten(create.props.style).backgroundColor).toBe(colors.surface);
 const text=create.findAll(node=>node.type===Text&&node.props.children==='New chat')[0];
 expect(StyleSheet.flatten(text.props.style).color).toBe(colors.foreground);
 expect(create.findAll(node=>node.props.color===colors.foreground).length).toBeGreaterThan(0);
 act(()=>create.props.onPress());expect(newChat).toHaveBeenCalledTimes(1);
});

test('drawer has a thin white right edge without changing its full-height scroll layout',()=>{
 expect(StyleSheet.flatten(tree.root.findByProps({testID:'drawer-panel'}).props.style)).toMatchObject({borderRightWidth:1,borderRightColor:'#ffffff',height:'100%',overflow:'hidden'});
});
