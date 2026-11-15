import React,{useLayoutEffect,useRef} from 'react';
import {Animated,Easing,View,type ViewProps} from 'react-native';
import {APP_MOTION,useAppMotion} from '../app-motion';

type Props=ViewProps&{active?:boolean;transitionKey?:string;distance?:number};
/** A short entrance, never a navigation gate. Children keep their identity and
 * remain readable/touchable; only opacity/translation use the native driver.
 * Preference resolution/resume must not replay an already displayed entrance. */
export function MotionSurface({active=true,transitionKey='',distance=APP_MOTION.distance,style,children,...props}:Props){
 const motion=useAppMotion();
 const progress=useRef(new Animated.Value(1)).current;
 const previous=useRef<{active:boolean;key:string}|null>(null);
 useLayoutEffect(()=>{
  const prior=previous.current;
  const entering=active&&(!prior||!prior.active||prior.key!==transitionKey);
  previous.current={active,key:transitionKey};
  progress.stopAnimation();
  if(!motion||!entering){progress.setValue(1);return;}
  progress.setValue(0);
  const animation=Animated.timing(progress,{toValue:1,duration:APP_MOTION.enter,easing:Easing.out(Easing.cubic),useNativeDriver:true,isInteraction:false});
  animation.start();
  return()=>animation.stop();
 },[active,transitionKey,motion,progress]);
 return <Animated.View {...props} style={[style,active&&{opacity:progress.interpolate({inputRange:[0,1],outputRange:[.96,1]}),transform:[{translateY:progress.interpolate({inputRange:[0,1],outputRange:[distance,0]})}]}]}>{children}</Animated.View>;
}

/** Persistent route visibility must never belong to a native animated host.
 * Detaching a native opacity graph can restore that host's default opacity;
 * keep the authoritative hidden opacity/touch/accessibility mask on a plain
 * parent while a separate child owns the decorative entrance. */
export function PersistentMotionSurface({active=true,transitionKey,distance,style,children,...props}:Props){
 return <View {...props} collapsable={false} style={style}><MotionSurface active={active} transitionKey={transitionKey} distance={distance} style={{flex:1}}>{children}</MotionSurface></View>;
}
