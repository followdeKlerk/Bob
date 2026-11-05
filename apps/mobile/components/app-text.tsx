import React,{forwardRef} from 'react';
import {Text as NativeText,TextInput as NativeTextInput,StyleSheet,type TextProps,type TextInputProps} from 'react-native';
import {useTheme} from '../theme';
import {APP_FONT_FAMILY} from '../typography';

const font=StyleSheet.create({default:{fontFamily:APP_FONT_FAMILY}}).default;
// Keep the native component/ref, scaling, selection and accessibility behaviour.
// A final family rule also covers old monospace styles; weights/styles still apply.
export const Text=forwardRef<React.ComponentRef<typeof NativeText>,TextProps>(function AppText({style,...props},ref){
 const {colors}=useTheme();
 return <NativeText {...props} ref={ref} style={[{color:colors.foreground},style,font]}/>;
});
export const TextInput=forwardRef<React.ComponentRef<typeof NativeTextInput>,TextInputProps>(function AppTextInput({style,...props},ref){
 const {colors,scheme}=useTheme();
 return <NativeTextInput keyboardAppearance={scheme} selectionColor={colors.accent} cursorColor={colors.accent} placeholderTextColor={colors.muted} {...props} ref={ref} style={[{color:colors.foreground},style,font]}/>;
});
