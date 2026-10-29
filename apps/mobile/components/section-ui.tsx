import {Text} from './app-text';
import React from 'react';
import {ActivityIndicator,Pressable,StyleSheet,View} from 'react-native';
import {ChevronRight,type LucideIcon} from 'lucide-react-native';
import {colors} from '../theme';

/** Shared chrome for non-chat destinations. Keep content readable as text grows. */
export const sectionStyles=StyleSheet.create({
 heading:{flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:20,paddingTop:20,paddingBottom:16},
 title:{color:colors.foreground,fontSize:27,lineHeight:35,fontWeight:'600',letterSpacing:-.5,flexShrink:1},
 subtitle:{color:colors.muted,fontSize:12,lineHeight:20,marginTop:3},
});
export function SectionHeading({title,children}:{title:string;children?:React.ReactNode}){
 return <View style={sectionStyles.heading}><Text accessibilityRole="header" style={[sectionStyles.title,{flex:1}]}>{title}</Text>{children}</View>;
}
export function RoundAction({label,icon:Icon,onPress,disabled=false,primary=false,compact=false}:{label:string;icon:LucideIcon;onPress:()=>void;disabled?:boolean;primary?:boolean;compact?:boolean}){
 return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={[s.roundTarget,disabled&&{opacity:.4}]}><View pointerEvents="none" style={[s.round,compact&&s.compactRound,primary&&{backgroundColor:colors.accent}]}><Icon size={compact?18:21} color={primary?colors.onAccent:colors.foreground}/></View></Pressable>;
}
export function SettingsGroup({title,children}:{title:string;children:React.ReactNode}){
 return <View style={s.group}><Text accessibilityRole="header" style={s.groupTitle}>{title}</Text><View style={s.groupBody}>{children}</View></View>;
}
export function SettingsRow({title,label=title,icon:Icon,onPress,disabled=false,value,checked,loading=false}:{title:string;label?:string;icon:LucideIcon;onPress:()=>void;disabled?:boolean;value?:string;checked?:boolean;loading?:boolean}){
 const off=disabled||loading;
 return <Pressable accessibilityRole={checked===undefined?"button":"switch"} accessibilityLabel={label} accessibilityState={{disabled:off,busy:loading,...(checked===undefined?{}:{checked})}} disabled={off} onPress={onPress} style={[s.row,off&&{opacity:.4}]}><View style={s.rowIcon}><Icon size={20} color={colors.accent}/></View><Text style={s.rowTitle}>{title}</Text>{!!value&&<Text style={s.value}>{value}</Text>}<>{loading?<ActivityIndicator size="small" color={colors.accent}/>:checked===undefined?<ChevronRight size={17} color={colors.muted}/>:<View pointerEvents="none" style={[s.switch,{backgroundColor:checked?colors.accent:colors.border,alignItems:checked?'flex-end':'flex-start'}]}><View style={[s.thumb,{backgroundColor:checked?colors.onAccent:colors.foreground}]}/></View>}</></Pressable>;
}
const s=StyleSheet.create({
 switch:{width:36,height:22,borderRadius:11,padding:3,justifyContent:'center'},thumb:{width:16,height:16,borderRadius:8},
 roundTarget:{width:48,height:48,alignItems:'center',justifyContent:'center'},
 compactRound:{width:34,height:34,borderRadius:12},
 round:{width:48,height:48,borderRadius:16,backgroundColor:colors.surface,alignItems:'center',justifyContent:'center'},
 group:{gap:9,marginBottom:10},groupTitle:{color:colors.muted,fontSize:12,fontWeight:'600',paddingHorizontal:4,letterSpacing:.3},
 groupBody:{backgroundColor:colors.panel,borderRadius:20,borderWidth:1,borderColor:colors.subtle,paddingHorizontal:12,paddingVertical:4,gap:2},
 row:{flexDirection:'row',alignItems:'center',gap:12,minHeight:62,paddingVertical:10,paddingHorizontal:2},
 rowIcon:{width:34,height:34,borderRadius:11,alignItems:'center',justifyContent:'center',backgroundColor:colors.iconSurface},
 rowTitle:{flex:1,flexShrink:1,color:colors.foreground,fontSize:15,lineHeight:23},value:{color:colors.muted,fontSize:12,flexShrink:1,maxWidth:'28%'},
});
