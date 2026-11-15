import React from 'react';
import {StyleSheet,View} from 'react-native';
import {Search} from 'lucide-react-native';
import {TextInput} from './app-text';
import {themed,useTheme,useThemedValue} from '../theme';

/** Non-chat page search: always visible immediately below the page heading.
 * The caller owns query/scope and gutters; keep this native input mounted. */
export function PageSearch({label,hint,placeholder,value,onChangeText,editable=true}:{label:string;hint?:string;placeholder:string;value:string;onChangeText:(value:string)=>void;editable?:boolean}){
 const {colors}=useTheme(),s=useThemedValue(sTheme);
 return <View testID="page-search" style={s.frame}><Search size={20} color={colors.muted}/><TextInput typography="ui" accessibilityLabel={label} accessibilityHint={hint} placeholder={placeholder} placeholderTextColor={colors.muted} value={value} onChangeText={onChangeText} editable={editable} autoCapitalize="none" autoCorrect={false} returnKeyType="search" style={s.input}/></View>;
}
const sTheme=themed(({colors})=>StyleSheet.create({
 frame:{flexDirection:'row',alignItems:'center',gap:10,paddingHorizontal:16,borderRadius:999,backgroundColor:colors.surface},
 input:{flex:1,minWidth:0,minHeight:52,paddingVertical:14,color:colors.foreground,fontSize:16,lineHeight:24,textAlignVertical:'center',includeFontPadding:false},
}));
