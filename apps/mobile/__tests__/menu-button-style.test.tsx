import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {StyleSheet,Text as NativeText} from 'react-native';
import {Plus} from 'lucide-react-native';
import {ThemeContext,tokens} from '../theme-context';
import {menuButtonChrome} from '../menu-button-style';
import {RoundAction,SectionAction} from '../components/section-ui';
import {SettingsHome} from '../components/settings-home';
import {SETTINGS_PAGES} from '../settings-routes';

jest.mock('lucide-react-native',()=>new Proxy({},{get:(_,name)=>name==='__esModule'?true:()=>null}));
const control=(tree:Renderer.ReactTestRenderer,label:string)=>tree.root.findAll(node=>node.props?.accessibilityLabel===label&&typeof node.props?.onPress==='function')[0];
test.each(['light','dark'] as const)('%s circles and pills share the reference surface, outline and optical shadow without changing legacy control tokens',async scheme=>{
 const theme=tokens[scheme],chrome=menuButtonChrome(theme),press=jest.fn();let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<ThemeContext.Provider value={theme}><RoundAction label="Return" icon={Plus} onPress={press}/><SectionAction label="Save long settings" text="A long label that must wrap at larger text sizes" primary onPress={press}/><SectionAction label="Unavailable" disabled onPress={press}/></ThemeContext.Provider>);});
 try{
  const round=StyleSheet.flatten(control(tree,'Return').props.style),pill=StyleSheet.flatten(control(tree,'Save long settings').props.style);
  expect(round).toMatchObject({...chrome.circle});expect(pill).toMatchObject({borderRadius:999,minHeight:48,backgroundColor:theme.colors.surface,borderWidth:1,borderColor:theme.colors.foreground,boxShadow:theme.shadows.floating.boxShadow,height:'auto'});
  expect(pill.maxHeight).toBeUndefined();expect(pill.maxWidth).toBe('100%');expect(theme.menuChrome.control.borderRadius).toBe(14);
  const label=tree.root.findAllByType(NativeText).find(node=>node.props.children==='A long label that must wrap at larger text sizes')!;
  expect(label.props.numberOfLines).toBeUndefined();expect(label.props.allowFontScaling).not.toBe(false);expect(StyleSheet.flatten(label.props.style)).toMatchObject({color:theme.colors.foreground,textAlign:'center',textAlignVertical:'center',includeFontPadding:false});
  expect(control(tree,'Unavailable').props.disabled).toBe(true);act(()=>control(tree,'Return').props.onPress());expect(press).toHaveBeenCalledTimes(1);
 }finally{await act(async()=>tree.unmount());}
});
test.each([false,true])('Settings index contains navigation only, with read-only boundaries retained (%s)',async readOnly=>{
 const open=jest.fn();let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<SettingsHome readOnly={readOnly} onOpen={open}/>);});
 try{
  const routes=[...SETTINGS_PAGES.filter(name=>!readOnly||!['Phone & location','Advanced'].includes(name)),'Schedules'];
  for(const route of routes){const label=route==='Schedules'?'Reminders & recurring checks':route;act(()=>control(tree,label).props.onPress());expect(open).toHaveBeenLastCalledWith(route);}
  expect(tree.root.findAll(node=>node.props?.accessibilityRole==='switch')).toHaveLength(0);
  expect(tree.root.findAll(node=>node.props?.accessibilityLabel==='Provider API key')).toHaveLength(0);
  expect(tree.root.findAll(node=>node.props?.accessibilityLabel==='Phone & location'&&typeof node.props?.onPress==='function').length>0).toBe(!readOnly);
 }finally{await act(async()=>tree.unmount());}
});
