import React,{useEffect,useId,useRef} from 'react';
import {Animated,Easing,View} from 'react-native';
import Svg,{Defs,Ellipse,G,LinearGradient,Path,Stop} from 'react-native-svg';
import {useAppMotion} from '../app-motion';

/** Local decorative presence, not a progress indicator or an announcement.
 * One native clock drives breathing and a blink; no network or JS frame loop. */
export function PebbleBob({active,working}:{active:boolean;working:boolean}) {
 const motion=useAppMotion();
 const phase=useRef(new Animated.Value(0)).current;
 const id='pebble'+useId().replace(/[^a-zA-Z0-9]/g,'');
 useEffect(()=>{
  phase.stopAnimation();phase.setValue(0);
  if(!active||!motion)return;
  const loop=Animated.loop(Animated.timing(phase,{toValue:1,duration:6400,easing:Easing.linear,useNativeDriver:true,isInteraction:false}));
  loop.start();
  return()=>{loop.stop();phase.stopAnimation();phase.setValue(0);};
 },[active,motion,phase]);
 const transform=[
  {translateY:phase.interpolate({inputRange:[0,.5,1],outputRange:[0,working?-1.5:-.5,0]})},
  {scaleY:phase.interpolate({inputRange:[0,.5,1],outputRange:[1,1.025,1]})},
  {rotate:phase.interpolate({inputRange:[0,.5,1],outputRange:working?['-2deg','2deg','-2deg']:['0deg','0deg','0deg']})},
 ];
 return <View testID="pebble-bob" pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{width:78,height:64,justifyContent:'center'}}>
  <Animated.View style={{width:78,height:64,transform}}>
   <Svg width={78} height={64} viewBox="0 0 108 100">
    <Defs><LinearGradient id={id} x1="15%" y1="0%" x2="80%" y2="100%"><Stop offset="0" stopColor="#D5BEF4"/><Stop offset="0.6" stopColor="#A885CF"/><Stop offset="1" stopColor="#7C58A4"/></LinearGradient></Defs>
    <Ellipse cx="54" cy="86" rx="26" ry="3" fill="#56416E" opacity={.12}/>
    <Path d="M25 65C15 53 20 30 35 22C49 12 71 17 81 30C91 43 94 66 79 75C65 85 37 82 25 65Z" fill={`url(#${id})`}/>
    <Path d="M31 34Q42 22 57 25" fill="none" stroke="#F5ECFF" strokeOpacity={.45} strokeWidth={3} strokeLinecap="round"/>
    <Path d="M50 62Q54 65 58 62" fill="none" stroke="#49315E" strokeWidth={2} strokeLinecap="round"/>
   </Svg>
   <Animated.View style={{position:'absolute',left:0,top:0,width:78,height:64,opacity:phase.interpolate({inputRange:[0,.62,.635,.65,.665,1],outputRange:[1,1,0,0,1,1]})}} pointerEvents="none">
    <Svg width={78} height={64} viewBox="0 0 108 100"><G fill="#352344"><Ellipse cx="44" cy="51" rx="3.2" ry="4"/><Ellipse cx="63" cy="51" rx="3.2" ry="4"/></G></Svg>
   </Animated.View>
   <Animated.View testID="pebble-blink" style={{position:'absolute',left:0,top:0,width:78,height:64,opacity:phase.interpolate({inputRange:[0,.62,.635,.65,.665,1],outputRange:[0,0,1,1,0,0]})}} pointerEvents="none">
    <Svg width={78} height={64} viewBox="0 0 108 100"><Path d="M42 51h4M61 51h4" fill="none" stroke="#352344" strokeWidth={1.7} strokeLinecap="round"/></Svg>
   </Animated.View>
  </Animated.View>
 </View>;
}
