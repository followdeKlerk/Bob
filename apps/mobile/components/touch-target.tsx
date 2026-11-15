import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Animated,Easing,Pressable,StyleSheet,type PressableProps} from 'react-native';
import {APP_MOTION,useAppMotion} from '../app-motion';
import {cssInterop} from 'nativewind';
import {selectionHaptic} from '../haptics';

const AnimatedPressable=Animated.createAnimatedComponent(Pressable);
// A custom animated component is not in NativeWind’s built-in Pressable map.
// Preserve Reusables className styling and active/disabled variants explicitly.
cssInterop(AnimatedPressable,{className:'style'});
export type TouchTargetProps=PressableProps&React.RefAttributes<React.ComponentRef<typeof Pressable>>&{haptic?:boolean};
/** Feedback follows actual activation, never touch-down/scroll cancellation.
 * No geometry change or animation completion sits in the action path. */
export function TouchTarget({style,disabled,haptic=true,onPress,onPressIn,onPressOut,onBlur,ref,...props}:TouchTargetProps){
 const motion=useAppMotion(),opacity=useRef(new Animated.Value(1)).current;
 const [pressed,setPressed]=useState(false);
 const resolved=typeof style==='function'?style({pressed:pressed&&!disabled}):style;
 const base=StyleSheet.flatten(resolved)?.opacity;
 const feedbackOpacity=useMemo(()=>typeof base==='number'?Animated.multiply(opacity,base):opacity,[base,opacity]);
 const held=useRef(false),animation=useRef<Animated.CompositeAnimation|undefined>(undefined);
 const settle=(pressed:boolean)=>{
  held.current=pressed;setPressed(pressed);
  animation.current?.stop();
  const toValue=pressed?APP_MOTION.pressedOpacity:1;
  if(!motion){opacity.setValue(toValue);return;}
  animation.current=Animated.timing(opacity,{toValue,duration:pressed?APP_MOTION.press:APP_MOTION.release,easing:Easing.out(Easing.quad),useNativeDriver:true,isInteraction:false});
  animation.current.start();
 };
 useEffect(()=>{
  animation.current?.stop();
  held.current=false;setPressed(false);opacity.setValue(1);
  return()=>animation.current?.stop();
 },[disabled,motion,opacity]);
 return <AnimatedPressable {...props} ref={ref} disabled={disabled}
  style={[resolved,!disabled&&{opacity:feedbackOpacity}]}
  onPress={onPress?event=>{if(disabled)return;if(haptic)selectionHaptic();onPress(event);}:undefined}
  onPressIn={event=>{if(!disabled)settle(true);onPressIn?.(event);}}
  onPressOut={event=>{settle(false);onPressOut?.(event);}}
  onBlur={event=>{settle(false);onBlur?.(event);}}/>;
}
