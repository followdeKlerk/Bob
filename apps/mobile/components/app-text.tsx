import React,{forwardRef} from 'react';
import {Text as NativeText,TextInput as NativeTextInput,StyleSheet,type TextProps,type TextInputProps} from 'react-native';
import {useTheme} from '../theme';
import {APP_FONT_FAMILY,APP_UI_FONT_FAMILY,APP_MONO_FONT_FAMILY} from '../typography';

type TypographyProps={typography?:'default'|'ui'|'mono'};
const fonts=StyleSheet.create({default:{fontFamily:APP_FONT_FAMILY},ui:{fontFamily:APP_UI_FONT_FAMILY},mono:{fontFamily:APP_MONO_FONT_FAMILY}});
// Keep the native component/ref, scaling, selection and accessibility behaviour.
// Select code explicitly with typography="mono"; caller weights/styles still apply.
export const Text=forwardRef<React.ComponentRef<typeof NativeText>,TextProps&TypographyProps>(function AppText({style,typography='default',...props},ref){
 const {colors}=useTheme();
 return <NativeText {...props} ref={ref} style={[{color:colors.foreground},style,fonts[typography]]}/>;
});
export const TextInput=forwardRef<React.ComponentRef<typeof NativeTextInput>,TextInputProps&TypographyProps>(function AppTextInput({style,typography='default',...props},ref){
 const {colors,scheme}=useTheme();
 return <NativeTextInput keyboardAppearance={scheme} selectionColor={colors.accent} cursorColor={colors.accent} placeholderTextColor={colors.muted} {...props} ref={ref} style={[{color:colors.foreground},style,fonts[typography]]}/>;
});
