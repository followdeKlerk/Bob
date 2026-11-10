import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {StyleSheet,TextInput} from 'react-native';
import {PageSearch} from '../components/page-search';
import {ThemeContext,tokens} from '../theme-context';
import {APP_UI_FONT_FAMILY} from '../typography';
jest.mock('lucide-react-native',()=>({Search:()=>null}));
test.each(['light','dark'] as const)('%s page search stays a visible scalable native field and preserves identity across query/lock updates',async scheme=>{
 let tree!:Renderer.ReactTestRenderer;const change=jest.fn();
 const render=(value:string,editable=true)=><ThemeContext.Provider value={tokens[scheme]}><PageSearch label="Search loaded items" hint="Searches loaded items only" placeholder="Search items" value={value} onChangeText={change} editable={editable}/></ThemeContext.Provider>;
 await act(async()=>{tree=Renderer.create(render(''));});
 try{
  const field=tree.root.findByType(TextInput),frame=tree.root.findByProps({testID:'page-search'});
  expect(field.props).toMatchObject({accessibilityLabel:'Search loaded items',accessibilityHint:'Searches loaded items only',autoCapitalize:'none',autoCorrect:false,returnKeyType:'search',editable:true});
  expect(field.props.autoFocus).not.toBe(true);expect(field.props.allowFontScaling).not.toBe(false);expect(field.props.maxFontSizeMultiplier).toBeUndefined();
  expect(StyleSheet.flatten(frame.props.style)).toMatchObject({borderRadius:12,paddingHorizontal:12,backgroundColor:tokens[scheme].colors.surface});
  expect(StyleSheet.flatten(field.props.style)).toMatchObject({minHeight:48,fontSize:15,lineHeight:22,fontFamily:APP_UI_FONT_FAMILY,minWidth:0});
  act(()=>field.props.onChangeText('exact query'));expect(change).toHaveBeenCalledWith('exact query');
  await act(async()=>tree.update(render('exact query',false)));
  expect(tree.root.findByType(TextInput)===field).toBe(true);expect(field.props.value).toBe('exact query');expect(field.props.editable).toBe(false);
  expect(tree.root.findAll(node=>node.props?.accessibilityRole==='button')).toHaveLength(0);
 }finally{await act(async()=>tree.unmount());}
});
