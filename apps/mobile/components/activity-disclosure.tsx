import React,{useEffect,useRef,useState} from 'react';
import {Animated,type StyleProp,type ViewStyle} from 'react-native';
import {useChatMotion} from '../chat-motion';

/** Natural-height details: soften reveal without clipping content, changing list
 * ownership or running a global layout animation over the reader's scroll anchor. */
export function ActivityDisclosure({children,style}:{children:React.ReactNode;style?:StyleProp<ViewStyle>}){
 const motion=useChatMotion(),[opacity]=useState(()=>new Animated.Value(1)),[offset]=useState(()=>new Animated.Value(0));
 const appeared=useRef(false);
 useEffect(()=>{
  const fresh=!appeared.current;appeared.current=true;
  if(!motion||!fresh){opacity.setValue(1);offset.setValue(0);return;}
  opacity.setValue(.75);offset.setValue(2);
  const animation=Animated.parallel([
   Animated.timing(opacity,{toValue:1,duration:140,useNativeDriver:true,isInteraction:false}),
   Animated.timing(offset,{toValue:0,duration:140,useNativeDriver:true,isInteraction:false}),
  ]);animation.start();
  return()=>{animation.stop();opacity.setValue(1);offset.setValue(0);};
 },[motion,opacity,offset]);
 return <Animated.View style={[style,{opacity,transform:[{translateY:offset}]}]}>{children}</Animated.View>;
}
