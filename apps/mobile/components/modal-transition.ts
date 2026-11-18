import {useLayoutEffect,useRef,useState} from 'react';
import {Animated,Easing} from 'react-native';
import {useAppMotion,APP_MOTION} from '../app-motion';

/** Keep Android's native dialog animationType constant. Only presentation is
 * retained after close: callers still execute dismissal/business callbacks at
 * once. A reopened surface reverses from its current presentation value. */
export function useModalTransition(open:boolean,enabled=true){
 const policy=useAppMotion(),motion=policy&&enabled,[mounted,setMounted]=useState(open);
 const progress=useRef(new Animated.Value(open&&motion?0:1)).current;
 const prior=useRef<boolean|undefined>(undefined),generation=useRef(0);
 useLayoutEffect(()=>{
  const was=prior.current;prior.current=open;
  const id=++generation.current;
  progress.stopAnimation();
  if(open)setMounted(true);
  if(!motion){progress.setValue(open?1:0);if(!open)setMounted(false);return;}
  // A late accessibility preference resolution must not replay an open dialog.
  if(open&&was===true){progress.setValue(1);return;}
  if(!open&&was===undefined){progress.setValue(0);setMounted(false);return;}
  const animation=Animated.timing(progress,{toValue:open?1:0,duration:APP_MOTION.enter,easing:Easing.out(Easing.cubic),useNativeDriver:true,isInteraction:false});
  animation.start(({finished})=>{if(finished&&generation.current===id&&!open)setMounted(false);});
  return()=>{generation.current++;animation.stop();};
 },[open,motion,progress]);
 return {mounted,backdrop:{opacity:progress},panel:{opacity:progress,transform:[{translateY:progress.interpolate({inputRange:[0,1],outputRange:[APP_MOTION.distance,0]})}]} };
}
