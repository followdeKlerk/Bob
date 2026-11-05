import {APP_FONT_FAMILY} from '../typography';
import {Text} from './app-text';
import React,{memo,useEffect,useMemo,useRef,useState} from 'react';
import {AccessibilityInfo,Animated,AppState,Easing,StyleSheet,View} from 'react-native';
import {themed,useThemedValue} from '../theme';

/** Native, indeterminate signal glide. The literal status remains separate from
 * its decoration; only an actual label change briefly fades/slides the words. */
export const ComposerStatus=memo(function ComposerStatus({text,animate=true}:{text:string;animate?:boolean}){
 const s=useThemedValue(sTheme);
 const [active,setActive]=useState(AppState.currentState==='active');
 // Wait for platform preferences before starting any motion.
 const [reduceMotion,setReduceMotion]=useState(true),[screenReader,setScreenReader]=useState(true);
 const [displayedText,setDisplayedText]=useState(text);
 const displayed=useRef(text);
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
 useEffect(()=>{
  let alive=true,incoming:Animated.CompositeAnimation|undefined;
  if(!running||displayed.current===text){
   displayed.current=text;setDisplayedText(text);opacity.setValue(1);offset.setValue(0);
   return;
  }
  const move=(value:Animated.Value,toValue:number,duration:number)=>Animated.timing(value,{toValue,duration,easing:Easing.inOut(Easing.quad),useNativeDriver:true,isInteraction:false});
  // A short sequential transition uses one naturally wrapping text node. There
  // are no absolute old/new layers to overlap the rail or composer at large type.
  const outgoing=Animated.parallel([move(opacity,0,90),move(offset,-3,90)]);
  outgoing.start(({finished})=>{
   if(!alive||!finished)return;
   displayed.current=text;setDisplayedText(text);offset.setValue(3);
   incoming=Animated.parallel([move(opacity,1,170),move(offset,0,170)]);
   incoming.start();
  });
  // A newer phase wins; cancelled native callbacks cannot restore an old label.
  return()=>{alive=false;outgoing.stop();incoming?.stop();opacity.stopAnimation();offset.stopAnimation();};
 },[text,running,opacity,offset]);
 return <View testID="connection-status" pointerEvents="none" accessible accessibilityRole="text" accessibilityLabel={text} accessibilityLiveRegion="polite" style={s.container}>
  <Animated.View testID="status-label-transition" accessible={false} importantForAccessibility="no-hide-descendants" style={{opacity:running?opacity:1,transform:[{translateY:running?offset:0}]}}>
   <Text testID={running?'status-animated-text':'status-static-text'} accessible={false} style={s.text}>{running?displayedText:text}</Text>
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
