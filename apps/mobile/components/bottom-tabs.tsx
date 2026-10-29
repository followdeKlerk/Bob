import React,{useEffect,useState} from 'react';
import {AccessibilityInfo,AppState,Pressable,StyleSheet,View} from 'react-native';
import Svg,{Path} from 'react-native-svg';
import Animated,{cancelAnimation,Easing,ReduceMotion,useAnimatedProps,useSharedValue,withSpring,withTiming} from 'react-native-reanimated';
import {TabGlyph,type TabGlyphName} from './tab-glyph';
import {colors} from '../theme';
import {FLUID_TAB_HEIGHT,fluidTabPath} from '../fluid-tabs';
export type BottomDestination=TabGlyphName;
const tabs=[{id:'Notes'},{id:'Workstations'},{id:'Chat'},{id:'Sessions'},{id:'Settings'}] as const;
const AnimatedPath=Animated.createAnimatedComponent(Path);
export function BottomTabs({selected,onSelect,onHeight}:{selected:string;onSelect:(tab:BottomDestination)=>void;onHeight?:(height:number)=>void}){
 const index=Math.max(0,tabs.findIndex(tab=>tab.id===selected));
 const [width,setWidth]=useState(0),[active,setActive]=useState(AppState.currentState==='active');
 // Stay static until the platform preference is known, including on remount
 // after the keyboard closes. Never replay an offscreen transition.
 const [reduceMotion,setReduceMotion]=useState(true);
 const position=useSharedValue(index),shoulder=useSharedValue(index);
 useEffect(()=>{
  let alive=true,changed=false;
  void AccessibilityInfo.isReduceMotionEnabled().then(value=>{if(alive&&!changed)setReduceMotion(value);}).catch(()=>{});
  const motion=AccessibilityInfo.addEventListener('reduceMotionChanged',value=>{changed=true;setReduceMotion(value);});
  const lifecycle=AppState.addEventListener('change',state=>setActive(state==='active'));
  return()=>{alive=false;motion.remove();lifecycle.remove();};
 },[]);
 useEffect(()=>{
  cancelAnimation(position);cancelAnimation(shoulder);
  if(reduceMotion||!active||width<=0){position.value=index;shoulder.value=index;}
  else{
   position.value=withSpring(index,{damping:20,stiffness:210,mass:.8,overshootClamping:true,reduceMotion:ReduceMotion.System});
   // A slower neck lets the leading lobe pull a liquid tail from the old tab.
   shoulder.value=withTiming(index,{duration:520,easing:Easing.inOut(Easing.cubic),reduceMotion:ReduceMotion.System});
  }
  return()=>{cancelAnimation(position);cancelAnimation(shoulder);};
 },[index,reduceMotion,active,width,position,shoulder]);
 const surfaceProps=useAnimatedProps(()=>({d:fluidTabPath(width,position.value,shoulder.value)}));
 return <View testID="bottom-tabs" accessibilityRole="tablist" onLayout={event=>{const {width:w,height}=event.nativeEvent.layout;if(Number.isFinite(w)&&w>0)setWidth(w);onHeight?.(height);}} style={s.bar}>
  {width>0&&<View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
   <Svg width={width} height={FLUID_TAB_HEIGHT}>
    <AnimatedPath testID="fluid-tab-surface" animatedProps={surfaceProps} fill={colors.background}/>
    {tabs.map(({id},i)=><TabGlyph key={id} name={id} x={width*(i+.5)/5-12} y={19} color={id===selected?'#ffffff':'#111111'}/>)}
   </Svg>
  </View>}
  {tabs.map(({id})=><Pressable key={id} accessibilityRole="tab" accessibilityLabel={id} accessibilityState={{selected:selected===id}} onPress={()=>onSelect(id)} style={s.tab}/>)}
 </View>;
}
const s=StyleSheet.create({bar:{width:'100%',maxWidth:760,alignSelf:'center',flexDirection:'row',backgroundColor:'#ffffff',height:FLUID_TAB_HEIGHT},tab:{flex:1,minHeight:48,height:FLUID_TAB_HEIGHT}});
