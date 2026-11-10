import React,{createRef} from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Text as NativeText,TextInput as NativeTextInput,StyleSheet} from 'react-native';
import {Text,TextInput} from '../components/app-text';
import {APP_FONT_FAMILY,APP_UI_FONT_FAMILY,APP_MONO_FONT_FAMILY} from '../typography';

test('all app prose uses Nunito without losing size, weight, italics, scaling or accessibility',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<Text accessibilityLabel="Font specimen" selectable allowFontScaling maxFontSizeMultiplier={2} style={[{fontSize:18,fontWeight:'600'},{fontFamily:'monospace',fontStyle:'italic'}]}>Zażółć gęślą · Привет · 123</Text>);});
 const native=tree.root.findByType(NativeText);
 expect(StyleSheet.flatten(native.props.style)).toMatchObject({fontFamily:APP_FONT_FAMILY,fontSize:18,fontWeight:'600',fontStyle:'italic'});
 expect(native.props).toMatchObject({accessibilityLabel:'Font specimen',selectable:true,allowFontScaling:true,maxFontSizeMultiplier:2});
 await act(async()=>tree.unmount());
});

test('text input retains native ref and controlled draft through style and font-size changes',async()=>{
 const ref=createRef<React.ComponentRef<typeof NativeTextInput>>(),change=jest.fn();let tree!:Renderer.ReactTestRenderer;
 const input=(size:number)=><TextInput ref={ref} value="Retain this draft" selection={{start:3,end:7}} multiline allowFontScaling onChangeText={change} style={{fontSize:size,fontWeight:'500'}}/>;
 await act(async()=>{tree=Renderer.create(input(16));});
 const native=tree.root.findByType(NativeTextInput),instance=ref.current;
 expect(instance).not.toBeNull();expect(typeof instance?.focus).toBe('function');expect(typeof instance?.setNativeProps).toBe('function');
 expect(StyleSheet.flatten(native.props.style)).toMatchObject({fontFamily:APP_FONT_FAMILY,fontSize:16,fontWeight:'500'});
 act(()=>native.props.onChangeText('Typed text'));expect(change).toHaveBeenCalledWith('Typed text');
 await act(async()=>tree.update(input(24)));
 expect(tree.root.findByType(NativeTextInput)).toBe(native);expect(ref.current).toBe(instance);
 expect(native.props).toMatchObject({value:'Retain this draft',selection:{start:3,end:7},allowFontScaling:true,multiline:true});
 expect(StyleSheet.flatten(native.props.style).fontSize).toBe(24);
 await act(async()=>tree.unmount());
});

test('UI and default typography share Nunito and preserve native input identity',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 const ref=createRef<React.ComponentRef<typeof NativeTextInput>>();
 const render=(ui:boolean)=><><Text accessibilityLabel="Unchanged default">Default</Text><Text typography="ui" accessibilityLabel="Sessions UI" style={{fontSize:16,fontWeight:'600'}}>Sessions</Text><TextInput ref={ref} typography={ui?'ui':'default'} accessibilityLabel="Scoped input" value="Keep this value" selection={{start:2,end:5}} allowFontScaling style={{fontSize:16}}/></>;
 await act(async()=>{tree=Renderer.create(render(false));});
 const before=tree.root.findByType(NativeTextInput),instance=ref.current;
 await act(async()=>tree.update(render(true)));
 const labels=tree.root.findAllByType(NativeText);
 expect(StyleSheet.flatten(labels.find(node=>node.props.accessibilityLabel==='Unchanged default')!.props.style).fontFamily).toBe(APP_FONT_FAMILY);
 expect(StyleSheet.flatten(labels.find(node=>node.props.accessibilityLabel==='Sessions UI')!.props.style)).toMatchObject({fontFamily:APP_UI_FONT_FAMILY,fontSize:16,fontWeight:'600'});
 expect(tree.root.findByType(NativeTextInput)).toBe(before);expect(ref.current).toBe(instance);
 expect(StyleSheet.flatten(before.props.style).fontFamily).toBe(APP_UI_FONT_FAMILY);
 expect(before.props).toMatchObject({value:'Keep this value',selection:{start:2,end:5},allowFontScaling:true});
 expect(before.props.typography).toBeUndefined();
 await act(async()=>tree.unmount());
});


test('explicit mono text and inputs survive the final family rule without changing weights or italics',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<><Text typography="mono" selectable allowFontScaling style={{fontFamily:APP_FONT_FAMILY,fontWeight:'600',fontStyle:'italic'}}>{'  a\tb'}</Text><TextInput typography="mono" value="  code" style={{fontFamily:APP_UI_FONT_FAMILY,fontWeight:'500'}}/></>);});
 expect(APP_FONT_FAMILY).toBe('Nunito');expect(APP_UI_FONT_FAMILY).toBe(APP_FONT_FAMILY);expect(APP_MONO_FONT_FAMILY).toBe('Nordwand Mono');
 const text=tree.root.findByType(NativeText),input=tree.root.findByType(NativeTextInput);
 expect(StyleSheet.flatten(text.props.style)).toMatchObject({fontFamily:APP_MONO_FONT_FAMILY,fontWeight:'600',fontStyle:'italic'});
 expect(text.props).toMatchObject({selectable:true,allowFontScaling:true,children:'  a\tb'});
 expect(StyleSheet.flatten(input.props.style)).toMatchObject({fontFamily:APP_MONO_FONT_FAMILY,fontWeight:'500'});
 expect(input.props.value).toBe('  code');expect(input.props.typography).toBeUndefined();
 await act(async()=>tree.unmount());
});

test('shared UI text code variant explicitly selects mono while normal labels select Nunito',async()=>{
 const {Text:UiText}=require('../components/ui/text');let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<><UiText variant="code">const value = 1;</UiText><UiText>Label</UiText></>);});
 const labels=tree.root.findAllByType(NativeText);
 expect(StyleSheet.flatten(labels.find(node=>node.props.children==='const value = 1;')!.props.style).fontFamily).toBe(APP_MONO_FONT_FAMILY);
 expect(StyleSheet.flatten(labels.find(node=>node.props.children==='Label')!.props.style).fontFamily).toBe(APP_FONT_FAMILY);
 await act(async()=>tree.unmount());
});
