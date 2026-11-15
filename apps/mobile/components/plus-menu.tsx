import {withMenuTheme} from '../menu-theme';
import {TouchTarget} from './touch-target';
import {Text} from './app-text';
import React from 'react';
import {MotionSurface} from './motion-surface';
import {ScrollView,StyleSheet,View} from 'react-native';
import {Camera,Image,Paperclip,PenTool,SlidersHorizontal,Ellipsis,type LucideIcon} from 'lucide-react-native';
import {themed,useTheme,useThemedValue} from '../theme';
function PlusMenuContent({bottom,maxHeight,disabled,onCamera,onGallery,onFiles,onDrawing,onModel,onMore}:{bottom:number;maxHeight:number;disabled:boolean;onCamera:()=>void;onGallery:()=>void;onFiles:()=>void;onDrawing:()=>void;onModel:()=>void;onMore:()=>void}){
 const {colors}=useTheme();
 const s=useThemedValue(sTheme);
 const rows:{label:string;icon:LucideIcon;action:()=>void;disabled?:boolean}[]=[{label:'Camera',icon:Camera,action:onCamera,disabled},{label:'Gallery',icon:Image,action:onGallery,disabled},{label:'Files',icon:Paperclip,action:onFiles,disabled},{label:'Drawing',icon:PenTool,action:onDrawing,disabled},{label:'Model & thinking',icon:SlidersHorizontal,action:onModel,disabled},{label:'More',icon:Ellipsis,action:onMore}];
 return <MotionSurface testID="plus-menu-popup" style={[s.menu,{bottom,maxHeight}]}><ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{padding:8}}>{rows.map(({label,icon:Icon,action,disabled:off},index)=><TouchTarget key={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled:off}} disabled={off} onPress={action} style={[s.row,index===4&&s.groupStart,off&&{opacity:0.4}]}><View style={s.icon}><Icon size={20} color={colors.foreground}/></View><Text typography="ui" style={s.label}>{label}</Text></TouchTarget>)}</ScrollView></MotionSurface>;
}
const sTheme=themed(({colors,menuChrome,shadows})=>StyleSheet.create({menu:{...menuChrome.card,...shadows.popup,backgroundColor:colors.background,position:'absolute',left:16,width:280,maxWidth:'90%',zIndex:12,overflow:'hidden'},row:{minHeight:56,flexDirection:'row',alignItems:'center',gap:16,paddingHorizontal:12,paddingVertical:12},groupStart:{borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:colors.border,marginTop:4,paddingTop:16},icon:{width:28,height:28,alignItems:'center',justifyContent:'center'},label:{fontSize:16,lineHeight:24,color:colors.foreground,flexShrink:1}}));

export const PlusMenu=withMenuTheme(PlusMenuContent);
