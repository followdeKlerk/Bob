import {Text} from './app-text';
import React from 'react';
import {Pressable,ScrollView,StyleSheet,View} from 'react-native';
import {Camera,Image,Paperclip,PenTool,SlidersHorizontal,Ellipsis,type LucideIcon} from 'lucide-react-native';
import {themed,useTheme,useThemedValue} from '../theme';
export function PlusMenu({bottom,maxHeight,disabled,onCamera,onGallery,onFiles,onDrawing,onModel,onMore}:{bottom:number;maxHeight:number;disabled:boolean;onCamera:()=>void;onGallery:()=>void;onFiles:()=>void;onDrawing:()=>void;onModel:()=>void;onMore:()=>void}){
 const {colors}=useTheme();
 const s=useThemedValue(sTheme);

 const rows:{label:string;icon:LucideIcon;action:()=>void;disabled?:boolean}[]=[{label:'Camera',icon:Camera,action:onCamera,disabled},{label:'Gallery',icon:Image,action:onGallery,disabled},{label:'Files',icon:Paperclip,action:onFiles,disabled},{label:'Drawing',icon:PenTool,action:onDrawing,disabled},{label:'Model & thinking',icon:SlidersHorizontal,action:onModel,disabled},{label:'More',icon:Ellipsis,action:onMore}];
 return <View style={[s.menu,{bottom,maxHeight}]}><ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{padding:8}}>{rows.map(({label,icon:Icon,action,disabled:off})=><Pressable key={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled:off}} disabled={off} onPress={action} style={[s.row,off&&{opacity:0.4}]}><View style={s.icon}><Icon size={20} color={colors.foreground}/></View><Text style={s.label}>{label}</Text></Pressable>)}</ScrollView></View>;
}
const sTheme=themed(({colors,menuChrome})=>StyleSheet.create({menu:{...menuChrome.card,position:'absolute',left:16,width:264,maxWidth:'90%',elevation:12,overflow:'hidden'},row:{minHeight:62,flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:10,paddingVertical:10},icon:{...menuChrome.icon,width:34,height:34,alignItems:'center',justifyContent:'center'},label:{fontSize:15,lineHeight:23,color:colors.foreground,flexShrink:1}}));
