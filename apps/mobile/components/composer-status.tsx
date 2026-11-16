import {APP_FONT_FAMILY} from '../typography';
import {Text} from './app-text';
import React,{memo,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {AccessibilityInfo,Animated,AppState,Easing,StyleSheet,View} from 'react-native';
import {themed,useThemedValue} from '../theme';

/** Native, indeterminate signal glide. The current literal status is immediate;
 * only an actual label change gets a short, readable native entrance. */
export const ComposerStatus=memo(function ComposerStatus({text,animate=true}:{text:string;animate?:boolean}){
 const s=useThemedValue(sTheme);
 const [active,setActive]=useState(AppState.currentState==='active');
 // Wait for platform preferences before starting any motion.
 const [reduceMotion,setReduceMotion]=useState(true),[screenReader,setScreenReader]=useState(true);
 const previous=useRef(text);
 const [glide]=useState(()=>new Animated.Value(0));
 // A closed cosine path lets one native timing animation loop without a JS
 // sequence callback or a jump when its input resets from 1 to 0.
 const position=useMemo(()=>glide.interpolate({inputRange:Array.from({length:33},(_,i)=>i/32),outputRange:Array.from({length:33},(_,i)=>26*(1-Math.cos(2*Math.PI*i/32)))}),[glide]);
 const [opacity]=useState(()=>new Animated.Value(1));
 const [offset]=useState(()=>new Animated.Value(0));
 const running=animate&&active&&!reduceMotion&&!screenReader;
 useEffect(()=>{
  let alive=true,motionChanged=false,readerChanged=false;
  void AccessibilityInfo.isReduceMotionEnabled().then(value=>{if(alive&&!motionChanged)setReduceMotion(value);}).catch(()=>{});
  void AccessibilityInfo.isScreenReaderEnabled().then(value=>{if(alive&&!readerChanged)setScreenReader(value);}).catch(()=>{});
  const motion=AccessibilityInfo.addEventListener('reduceMotionChanged',value=>{motionChanged=true;setReduceMotion(value);});
  const reader=AccessibilityInfo.addEventListener('screenReaderChanged',value=>{readerChanged=true;setScreenReader(value);});
  const lifecycle=AppState.addEventListener('change',state=>setActive(state==='active'));
  return()=>{alive=false;motion.remove();reader.remove();lifecycle.remove();};
 },[]);
 useEffect(()=>{
  glide.setValue(0);
  if(!running)return;
  const loop=Animated.loop(Animated.timing(glide,{toValue:1,duration:3800,easing:Easing.linear,useNativeDriver:true,isInteraction:false}));
  loop.start();
  return()=>{loop.stop();glide.stopAnimation();};
 },[running,glide]);
 useLayoutEffect(()=>{
  const changed=previous.current!==text;previous.current=text;
  opacity.setValue(1);offset.setValue(0);
  if(!running||!changed)return;
  // Never retain an obsolete phase while fading it out. New words are already
  // present and readable, in one naturally wrapping node, on this same render.
  opacity.setValue(.86);offset.setValue(2);
  const move=(value:Animated.Value,toValue:number)=>Animated.timing(value,{toValue,duration:160,easing:Easing.out(Easing.quad),useNativeDriver:true,isInteraction:false});
  const entrance=Animated.parallel([move(opacity,1),move(offset,0)]);
  entrance.start();
  return()=>{entrance.stop();opacity.stopAnimation();offset.stopAnimation();};
 },[text,running,opacity,offset]);
 return <View testID="connection-status" pointerEvents="none" accessible accessibilityRole="text" accessibilityLabel={text} accessibilityLiveRegion="polite" style={s.container}>
  <Animated.View testID="status-label-transition" accessible={false} importantForAccessibility="no-hide-descendants" style={{opacity:running?opacity:1,transform:[{translateY:running?offset:0}]}}>
   <Text testID={running?'status-animated-text':'status-static-text'} accessible={false} style={s.text}>{text}</Text>
  </Animated.View>
  <View testID="status-signal-track" accessible={false} importantForAccessibility="no-hide-descendants" style={s.track}>
   <Animated.View testID="status-signal-glide" style={[s.signal,{transform:[{translateX:position}]}]}/>
  </View>
 </View>;
});
const sTheme=themed(({colors})=>StyleSheet.create({
 container:{minHeight:34,paddingHorizontal:8,paddingBottom:11},
 text:{color:colors.foreground,fontSize:13,lineHeight:22,fontWeight:'600',letterSpacing:0.3,fontFamily:APP_FONT_FAMILY,includeFontPadding:false},
 track:{width:70,maxWidth:'100%',height:2,marginTop:4,borderRadius:2,backgroundColor:colors.border},
 signal:{width:18,height:2,borderRadius:2,backgroundColor:colors.foreground},
}));
