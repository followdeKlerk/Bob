import {APP_FONT_FAMILY} from '../typography';
import {Text} from './app-text';
import React,{memo,useEffect,useRef,useState} from 'react';
import {AccessibilityInfo,AppState,StyleSheet,View} from 'react-native';
import {themed,useTheme,useThemedValue} from '../theme';
import {typewriterFrame,statusDisplayLabel} from '../typewriter-status';
// Hermes supplies this monotonic clock; the native-only TS lib omits its declaration.
declare const performance:{now:()=>number};

/** Native status text, not a WebView. Full-label layout and accessibility stay
 * stable while only this small memoized component updates at stepped boundaries. */
export const ComposerStatus=memo(function ComposerStatus({text,animate=true}:{text:string;animate?:boolean}){
 const {colors}=useTheme();
 const s=useThemedValue(sTheme);

 const label=statusDisplayLabel(text);
 const [active,setActive]=useState(AppState.currentState==='active');
 // Default to static until platform preferences are known; no motion flash.
 const [reduceMotion,setReduceMotion]=useState(true),[screenReader,setScreenReader]=useState(true);
 const [frame,setFrame]=useState({text:'',count:0,cursor:true});
 const hasAnimated=useRef(false),initialLabel=useRef(label),hasChangedLabel=useRef(false);
 useEffect(()=>{if(label!==initialLabel.current)hasChangedLabel.current=true;},[label]);
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
  if(!running)return;
  let stopped=false,timer:ReturnType<typeof setTimeout>|undefined;
  // Type once on initial mount. Later phase changes show their full words
  // immediately, then cycle dots only; frequent live updates must not blank them.
  const offset=hasAnimated.current||hasChangedLabel.current||label!==initialLabel.current?3000:0;hasAnimated.current=true;
  const start=performance.now()-offset,length=Array.from(label).length;
  const tick=()=>{
   if(stopped)return;
   const next=typewriterFrame(performance.now()-start,length,Math.max(0,length-' . . .'.length));
   setFrame(previous=>previous.text===label&&previous.count===next.count&&previous.cursor===next.cursor?previous:{text:label,count:next.count,cursor:next.cursor});
   timer=setTimeout(tick,next.delay);
  };
  tick();
  return()=>{stopped=true;clearTimeout(timer);};
 },[label,running]);
 const letters=Array.from(label),retainWords=hasAnimated.current||hasChangedLabel.current||label!==initialLabel.current;
 const visible=frame.text===label?letters.slice(0,frame.count).join(''):retainWords?letters.slice(0,Math.max(0,letters.length-' . . .'.length)).join(''):'';
 return <View testID="connection-status" pointerEvents="none" accessible accessibilityRole="text" accessibilityLabel={text} accessibilityLiveRegion="polite" style={s.container}>
  {running?<View accessible={false} importantForAccessibility="no-hide-descendants">
   {/* Reserve the complete label, including large-font wrapping. Never animate layout width. */}
   <Text testID="status-layout-reservation" accessible={false} style={[s.text,s.reserve]}>{label}▏</Text>
   <Text testID="status-animated-text" accessible={false} style={[s.text,s.overlay]}>{visible}<Text style={{color:frame.cursor?colors.foreground:'transparent'}}>▏</Text></Text>
  </View>:<Text testID="status-static-text" accessible={false} importantForAccessibility="no-hide-descendants" style={s.text}>{label}</Text>}
 </View>;
});
const sTheme=themed(({colors,menuChrome})=>StyleSheet.create({
 container:{minHeight:34,paddingHorizontal:8,paddingBottom:11},
 text:{color:colors.foreground,fontSize:13,lineHeight:22,fontWeight:'600',letterSpacing:0.3,fontFamily:APP_FONT_FAMILY,includeFontPadding:false},
 reserve:{opacity:0},overlay:{position:'absolute',top:0,left:0,right:0},
}));
