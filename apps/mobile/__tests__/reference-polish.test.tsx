import {menuThemes} from '../menu-theme';
jest.mock('lucide-react-native',()=>new Proxy({},{get:(_,name)=>name==='__esModule'?true:()=>null}));
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {StyleSheet,Text as NativeText,View} from 'react-native';
import {BookOpen} from 'lucide-react-native';
import {AppearanceSettings} from '../components/appearance-settings';
import {EmptyState} from '../components/empty-state';
import {SkillLibraryList,LibraryCard} from '../components/library-sections';
import {PageSearch} from '../components/page-search';
import {SessionActions} from '../components/session-actions';
import {ThemeContext,tokens} from '../theme-context';
import {Text} from '../components/app-text';

const skills={
 'writing-guide':{enabled:true,description:'Write clearly and check the final result.',markdown:'# Writing guide'},
 'a-very-long-name-that-must-wrap-on-a-small-phone-without-clipping':{enabled:false,description:'A deliberate wrapping fixture with a long description. '.repeat(3),markdown:'# Long name'},
};
const button=(tree:Renderer.ReactTestRenderer,label:string)=>tree.root.findAll(n=>n.props.accessibilityLabel===label&&typeof n.props.onPress==='function')[0];
let tree:Renderer.ReactTestRenderer|undefined;
afterEach(async()=>{if(tree)await act(async()=>tree!.unmount());tree=undefined;jest.restoreAllMocks();});

test.each(['dark','light'] as const)('skill catalog has a readable grouped hierarchy and stable filtered controls in %s',async scheme=>{
 const theme=tokens[scheme],onSelect=jest.fn(),onNew=jest.fn();
 const render=(selected='')=><ThemeContext.Provider value={theme}><SkillLibraryList skills={skills} selected={selected} onSelect={onSelect} onNew={onNew}/></ThemeContext.Provider>;
 await act(async()=>{tree=Renderer.create(render());});
 const search=tree!.root.findByType(PageSearch),row=button(tree!,'Edit skill writing-guide');
 expect(StyleSheet.flatten(row.props.style)).toMatchObject({minHeight:72});
 expect(row.props.accessibilityHint).toContain('Enabled');
 expect(tree!.root.findAllByType(NativeText).every(n=>n.props.allowFontScaling!==false)).toBe(true);
 const longName=button(tree!,'Edit skill a-very-long-name-that-must-wrap-on-a-small-phone-without-clipping').findAllByType(Text)[0];
 expect(longName.props.numberOfLines).toBeUndefined();
 act(()=>row.props.onPress());expect(onSelect).toHaveBeenCalledWith('writing-guide',skills['writing-guide']);
 await act(async()=>tree!.update(render('writing-guide')));
 expect(button(tree!,'Edit skill writing-guide')).toBe(row);
 expect(row.props.accessibilityState.selected).toBe(true);
 expect(StyleSheet.flatten(row.props.style).backgroundColor).toBe(theme.colors.selectedSurface);
 act(()=>search.props.onChangeText('clearly'));
 expect(button(tree!,'Edit skill writing-guide')).toBe(row);
 expect(button(tree!,'Edit skill a-very-long-name-that-must-wrap-on-a-small-phone-without-clipping')).toBeUndefined();
 expect(tree!.root.findByType(PageSearch)).toBe(search);
 act(()=>search.props.onChangeText('no matching resource'));
 expect(tree!.root.findByType(EmptyState).props.title).toBe('No matching skills');
 act(()=>button(tree!,'New skill').props.onPress());expect(onNew).toHaveBeenCalledTimes(1);
 expect(onSelect).toHaveBeenCalledTimes(1); // Filtering and creating do not select a saved resource.
});

test('library containers and empty states keep natural height and do not invent actions',async()=>{
 await act(async()=>{tree=Renderer.create(<LibraryCard icon={BookOpen} title="Instructions" description="Defaults for this workstation"><EmptyState icon={BookOpen} title="Nothing here yet" description="Add a resource when you need it."/></LibraryCard>);});
 const empty=tree!.root.findByProps({testID:'empty-state'});
 const shape=StyleSheet.flatten(empty.props.style);
 expect(shape.height).toBeUndefined();expect(shape.maxHeight).toBeUndefined();
 expect(tree!.root.findAllByType(NativeText).every(n=>n.props.allowFontScaling!==false&&n.props.numberOfLines===undefined)).toBe(true);
 expect(tree!.root.findAll(n=>typeof n.props.onPress==='function')).toHaveLength(0);
 for(const view of tree!.root.findAllByType(View))expect(view.children.filter(child=>typeof child==='string')).toEqual([]);
});

test.each(['dark','light'] as const)('destructive session action has explicit color and confirmation semantics in %s',async scheme=>{
 const onAction=jest.fn(async()=>{}),menuTheme=menuThemes[scheme];
 await act(async()=>{tree=Renderer.create(<ThemeContext.Provider value={tokens[scheme]}><SessionActions session={{conversationId:7,title:'Synthetic session',status:'idle',agents:[]}} onClose={()=>{}} onAction={onAction}/></ThemeContext.Provider>);});
 const danger=button(tree!,'Delete'),normal=button(tree!,'Archive');
 expect(StyleSheet.flatten(danger.findByType(Text).props.style).color).toBe(menuTheme.colors.danger);
 expect(StyleSheet.flatten(normal.findByType(Text).props.style).color).toBe(menuTheme.colors.foreground);
 expect(StyleSheet.flatten(danger.props.style)).toMatchObject({minHeight:56,minWidth:48});
 expect(onAction).not.toHaveBeenCalled();
});


test('large-font theme choices reflow before short labels fragment, without shrinking text',async()=>{
 jest.spyOn(require('react-native'),'useWindowDimensions').mockReturnValue({width:337,height:731,scale:3.2,fontScale:1.5});
 await act(async()=>{tree=Renderer.create(<AppearanceSettings/>);});
 for(const label of ['System','Light','Dark']){
  const choice=button(tree!,`${label} theme`);
  expect(StyleSheet.flatten(choice.props.style)).toMatchObject({flexBasis:120,minWidth:120,minHeight:56});
  const text=choice.findByType(Text);
  expect(text.props.allowFontScaling).not.toBe(false);expect(text.props.numberOfLines).toBeUndefined();
 }
 expect(StyleSheet.flatten(tree!.root.findByProps({accessibilityLabel:'Theme'}).props.style).flexWrap).toBe('wrap');
});
