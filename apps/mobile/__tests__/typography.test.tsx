import React,{createRef} from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Text as NativeText,TextInput as NativeTextInput,StyleSheet} from 'react-native';
import {Text,TextInput} from '../components/app-text';
import {APP_FONT_FAMILY} from '../typography';

test('all app text uses Nordwand Mono without losing size, weight, italics, scaling or accessibility',async()=>{
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
