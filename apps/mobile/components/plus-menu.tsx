import {Text} from './app-text';
import React from 'react';
import {Pressable,ScrollView,StyleSheet,View} from 'react-native';
import {Camera,Image,Paperclip,SlidersHorizontal,Ellipsis,type LucideIcon} from 'lucide-react-native';
import {colors} from '../theme';
export function PlusMenu({bottom,maxHeight,disabled,onCamera,onGallery,onFiles,onModel,onMore}:{bottom:number;maxHeight:number;disabled:boolean;onCamera:()=>void;onGallery:()=>void;onFiles:()=>void;onModel:()=>void;onMore:()=>void}){
 const rows:{label:string;icon:LucideIcon;action:()=>void;disabled?:boolean}[]=[{label:'Camera',icon:Camera,action:onCamera,disabled},{label:'Gallery',icon:Image,action:onGallery,disabled},{label:'Files',icon:Paperclip,action:onFiles,disabled},{label:'Model & thinking',icon:SlidersHorizontal,action:onModel,disabled},{label:'More',icon:Ellipsis,action:onMore}];
 return <View style={[s.menu,{bottom,maxHeight}]}><ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{padding:8}}>{rows.map(({label,icon:Icon,action,disabled:off})=><Pressable key={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled:off}} disabled={off} onPress={action} style={[s.row,off&&{opacity:0.4}]}><View style={s.icon}><Icon size={22} color={colors.foreground}/></View><Text style={s.label}>{label}</Text></Pressable>)}</ScrollView></View>;
}
const s=StyleSheet.create({menu:{position:'absolute',left:16,width:264,maxWidth:'90%',borderRadius:26,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,elevation:12,overflow:'hidden'},row:{minHeight:58,flexDirection:'row',alignItems:'center',gap:14,paddingHorizontal:10,paddingVertical:6},icon:{width:42,height:42,borderRadius:21,backgroundColor:colors.border,alignItems:'center',justifyContent:'center'},label:{fontSize:17,color:colors.foreground,flexShrink:1}});
