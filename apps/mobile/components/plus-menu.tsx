import {Text} from './app-text';
import React,{useEffect,useRef} from 'react';
import {AccessibilityInfo,Animated,Easing,Pressable,ScrollView,StyleSheet,View} from 'react-native';
import {Camera,Image,Paperclip,PenTool,SlidersHorizontal,Ellipsis,type LucideIcon} from 'lucide-react-native';
import {themed,useTheme,useThemedValue} from '../theme';
export function PlusMenu({bottom,maxHeight,disabled,onCamera,onGallery,onFiles,onDrawing,onModel,onMore}:{bottom:number;maxHeight:number;disabled:boolean;onCamera:()=>void;onGallery:()=>void;onFiles:()=>void;onDrawing:()=>void;onModel:()=>void;onMore:()=>void}){
 const {colors}=useTheme();
 const s=useThemedValue(sTheme);
 const progress=useRef(new Animated.Value(0)).current;
 useEffect(()=>{
  let alive=true,preferenceChanged=false;
  const showImmediately=()=>{preferenceChanged=true;progress.stopAnimation();progress.setValue(1);};
  const reduce=AccessibilityInfo.addEventListener('reduceMotionChanged',showImmediately);
  const reader=AccessibilityInfo.addEventListener('screenReaderChanged',showImmediately);
  // Do not create a native Modal window or animate layout/keyboard offsets.
  // Only this small popup's opacity and translation run on the native driver.
  void Promise.all([AccessibilityInfo.isReduceMotionEnabled(),AccessibilityInfo.isScreenReaderEnabled()]).then(([reduced,screenReader])=>{
   if(!alive||preferenceChanged)return;
   if(reduced||screenReader){progress.setValue(1);return;}
   Animated.timing(progress,{toValue:1,duration:160,easing:Easing.out(Easing.cubic),useNativeDriver:true,isInteraction:false}).start();
  }).catch(()=>{if(alive)progress.setValue(1);});
  return ()=>{alive=false;reduce.remove();reader.remove();progress.stopAnimation();};
 },[progress]);

 const rows:{label:string;icon:LucideIcon;action:()=>void;disabled?:boolean}[]=[{label:'Camera',icon:Camera,action:onCamera,disabled},{label:'Gallery',icon:Image,action:onGallery,disabled},{label:'Files',icon:Paperclip,action:onFiles,disabled},{label:'Drawing',icon:PenTool,action:onDrawing,disabled},{label:'Model & thinking',icon:SlidersHorizontal,action:onModel,disabled},{label:'More',icon:Ellipsis,action:onMore}];
 return <Animated.View testID="plus-menu-popup" style={[s.menu,{bottom,maxHeight,opacity:progress,transform:[{translateY:progress.interpolate({inputRange:[0,1],outputRange:[10,0]})}]}]}><ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{padding:8}}>{rows.map(({label,icon:Icon,action,disabled:off})=><Pressable key={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled:off}} disabled={off} onPress={action} style={[s.row,off&&{opacity:0.4}]}><View style={s.icon}><Icon size={20} color={colors.foreground}/></View><Text typography="ui" style={s.label}>{label}</Text></Pressable>)}</ScrollView></Animated.View>;
}
const sTheme=themed(({colors,menuChrome,shadows})=>StyleSheet.create({menu:{...menuChrome.card,...shadows.popup,position:'absolute',left:16,width:264,maxWidth:'90%',zIndex:12,overflow:'hidden'},row:{minHeight:52,flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:10,paddingVertical:10},icon:{width:28,height:28,alignItems:'center',justifyContent:'center'},label:{fontSize:15,lineHeight:23,color:colors.foreground,flexShrink:1}}));
