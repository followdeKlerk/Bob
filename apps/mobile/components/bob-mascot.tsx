import React,{useEffect,useRef,useState} from 'react';
import {AccessibilityInfo,AppState,Platform} from 'react-native';
import Svg,{Circle,G,Path} from 'react-native-svg';
import Animated,{cancelAnimation,Easing,interpolate,ReduceMotion,useAnimatedProps,useSharedValue,withRepeat,withTiming} from 'react-native-reanimated';
import {useTheme} from '../theme';

export type BobMascotState='idle'|'tap'|'open'|'working'|'done'|'attention';

// Geometry from the approved 80×96 stickman, not a nested native SVG icon.
const poses={
 idle:{arms:'M39 44 Q30 48 26 59 M41 44 Q51 48 54 58',legs:'M40 64 L32 81 M40 64 L49 81',mouth:'M35 29 Q40 32 45 29',tilt:-5,eye:0},
 tap:{arms:'M38 45 L27 39 L23 30 M42 45 L53 38 L57 29',legs:'M40 64 L30 76 L25 77 M40 64 L50 76 L55 77',mouth:'M35 28 Q40 35 45 28',tilt:6,eye:0},
 open:{arms:'M38 45 L28 52 L23 49 M42 45 L54 46 L61 39',legs:'M40 64 L34 81 M40 64 L50 80',mouth:'M35 29 Q40 33 45 28',tilt:10,eye:1},
 working:{arms:'M38 45 L27 56 L40 59 M42 45 L51 44 L49 31',legs:'M40 64 L33 81 M40 64 L48 81',mouth:'M37 30 L43 29',tilt:-9,eye:-1},
 done:{arms:'M38 45 L29 52 L26 59 M42 45 L53 35 L53 20',legs:'M40 64 L32 81 M40 64 L48 81',mouth:'M35 28 Q40 34 45 28',tilt:7,eye:0},
 attention:{arms:'M38 45 L28 51 L20 43 M42 45 L52 51 L60 43',legs:'M40 64 L32 81 M40 64 L48 81',mouth:'M36 31 Q40 28 44 31',tilt:-7,eye:0},
} satisfies Record<BobMascotState,{arms:string;legs:string;mouth:string;tilt:number;eye:number}>;
const durations:Record<BobMascotState,number>={idle:3600,tap:650,open:2600,working:3200,done:900,attention:3000};
const AnimatedG=Animated.createAnimatedComponent(G);

function transformAt(x:number,y:number,angle=0,sx=1,sy=1,dy=0):[number,number,number,number,number,number]{
 'worklet';
 const radians=angle*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);
 const a=c*sx,b=s*sx,d=c*sy,e=-s*sy;
 return [a,b,e,d,x-a*x-e*y,y+dy-b*x-d*y];
}
// SVG's Fabric group expects a six-element matrix, not RN's View transform.
const svgTransformAdapter=(props:Record<string,unknown>)=>{
 'worklet';
 if(Array.isArray(props.transform)){props.matrix=props.transform;delete props.transform;}
};

// Articulate the limbs, not just the whole silhouette. Smooth full-cycle motion
// avoids multi-second static holds that look like a stopped loop at 40×48.
function armTransform(state:BobMascotState,p:number,left:boolean){
 'worklet';
 const sway=Math.sin(2*Math.PI*p),lift=(1-Math.cos(2*Math.PI*p))/2;
 let angle=0;
 if(state==='idle')angle=(left?4:-4)*lift;
 else if(state==='open')angle=(left?-5:17)*sway;
 else if(state==='working')angle=left?3*sway:-10*lift;
 else if(state==='attention')angle=(left?18:-18)*lift;
 else if(state==='done'&&!left)angle=18*sway;
 return transformAt(left?38:42,45,angle);
}

export function BobMascot({state,animated=true,insideModal=false}:{state:BobMascotState;animated?:boolean;insideModal?:boolean}){
 const {colors}=useTheme();

 const pose=poses[state];
 const arms=pose.arms.match(/M[^M]+/g)!;
 const [reduceMotion,setReduceMotion]=useState(true);
 const [active,setActive]=useState(AppState.currentState==='active');
 const [focused,setFocused]=useState(true);
 const phase=useSharedValue(0),blink=useSharedValue(0);
 const oneShot=useRef<{state:BobMascotState;started:boolean}>({state,started:false});
 useEffect(()=>{
  let alive=true,changed=false;
  const motion=AccessibilityInfo.addEventListener('reduceMotionChanged',value=>{changed=true;setReduceMotion(value);});
  void AccessibilityInfo.isReduceMotionEnabled().then(value=>{if(alive&&!changed)setReduceMotion(value);}).catch(()=>{});
  const lifecycle=AppState.addEventListener('change',value=>setActive(value==='active'));
  return()=>{alive=false;motion.remove();lifecycle.remove();};
 },[]);
 useEffect(()=>{
  // AppState focus/blur follows the Activity window, not the Modal Dialog.
  // Opening a native modal can blur that Activity while its header is visible.
  // Modal copies therefore use AppState + animated for visibility instead.
  if(insideModal||Platform.OS!=='android')return;
  setFocused(true);
  const focus=AppState.addEventListener('focus',()=>setFocused(true));
  const blur=AppState.addEventListener('blur',()=>setFocused(false));
  return()=>{focus.remove();blur.remove();};
 },[insideModal]);
 useEffect(()=>{
  cancelAnimation(phase);cancelAnimation(blink);
  phase.value=0;blink.value=0;
  if(oneShot.current.state!==state)oneShot.current={state,started:false};
  if(animated&&!reduceMotion&&active&&(insideModal||focused)){
   const finite=state==='tap'||state==='done';
   if(!finite||!oneShot.current.started){
    if(finite)oneShot.current.started=true;
    const cycle=withTiming(1,{duration:durations[state],easing:Easing.linear,reduceMotion:ReduceMotion.System});
    // A tap is one pop; done waves twice and then rests in its finished pose.
    phase.value=state==='tap'?cycle:withRepeat(cycle,state==='done'?2:-1,false,undefined,ReduceMotion.System);
    if(state==='idle')blink.value=withRepeat(withTiming(1,{duration:5300,easing:Easing.linear,reduceMotion:ReduceMotion.System}),-1,false,undefined,ReduceMotion.System);
   }
  }
  return()=>{cancelAnimation(phase);cancelAnimation(blink);};
 },[state,animated,reduceMotion,active,focused,insideModal,phase,blink]);
 const figureProps=useAnimatedProps(()=>{
  const p=phase.value;
  let angle=0,sx=1,sy=1,dy=0;
  if(state==='idle'){
   const breath=(1-Math.cos(2*Math.PI*p))/2;
   sy+=.035*breath;dy=-1.2*breath;
   angle=1.4*Math.sin(2*Math.PI*p);
  }else if(state==='tap'){
   sx=interpolate(p,[0,.22,.56,.78,1],[1,1.1,.93,1.025,1]);
   // The browser's taller pop clips at this size: keep the head inside the canvas.
   sy=interpolate(p,[0,.22,.56,.78,1],[1,.8,1.07,.98,1]);
   dy=interpolate(p,[0,.22,.56,.78,1],[0,2,-1,0,0]);
  }else if(state==='open'){
   angle=-2*Math.sin(2*Math.PI*p);
   dy=-1.4*(1-Math.cos(2*Math.PI*p))/2;
  }else if(state==='done'){
   angle=interpolate(p,[0,.3,.65,1],[0,-8,4,0]);
  }else if(state==='attention'){
   dy=-1.8*(1-Math.cos(2*Math.PI*p))/2;
  }
  return {transform:transformAt(40,81,angle,sx,sy,dy)};
 },null,svgTransformAdapter);
 const headProps=useAnimatedProps(()=>{
  const p=phase.value,thought=state==='working'?(1-Math.cos(2*Math.PI*p))/2:0;
  const tilt=state==='idle'?3*Math.sin(2*Math.PI*p):state==='attention'?5*Math.sin(2*Math.PI*p):0;
  const transform=transformAt(40,24,pose.tilt-8*thought+tilt);
  transform[4]-=thought;transform[5]-=.5*thought;
  return {transform};
 },null,svgTransformAdapter);
 const leftArmProps=useAnimatedProps(()=>({transform:armTransform(state,phase.value,true)}),null,svgTransformAdapter);
 const rightArmProps=useAnimatedProps(()=>({transform:armTransform(state,phase.value,false)}),null,svgTransformAdapter);
 const eyeProps=useAnimatedProps(()=>({transform:transformAt(40,23,0,1,state==='idle'?interpolate(blink.value,[0,.85,.88,.91,1],[1,1,.08,1,1]):1)}),null,svgTransformAdapter);
 return <Svg testID="bob-mascot" width={40} height={48} viewBox="0 0 80 96" fill="none" pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
  <AnimatedG testID="bob-mascot-figure" animatedProps={figureProps} stroke={colors.foreground} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
   <Path testID="bob-mascot-body" d={`M40 39 Q${state==='working'?37:40} 52 40 64`}/>
   <G testID="bob-mascot-arms">
    <AnimatedG testID="bob-mascot-left-arm" animatedProps={leftArmProps}><Path testID="bob-mascot-left-arm-path" d={arms[0].trim()}/></AnimatedG>
    <AnimatedG testID="bob-mascot-right-arm" animatedProps={rightArmProps}><Path testID="bob-mascot-right-arm-path" d={arms[1].trim()}/></AnimatedG>
   </G>
   <Path testID="bob-mascot-legs" d={pose.legs}/>
   <AnimatedG testID="bob-mascot-head" transform={`rotate(${pose.tilt} 40 24)`} animatedProps={headProps}>
    <Circle cx={40} cy={24} r={14} fill="none"/>
    <AnimatedG testID="bob-mascot-eyes" animatedProps={eyeProps} fill={colors.foreground} stroke="none">
     <Circle cx={35+pose.eye} cy={23} r={1.65}/><Circle cx={45+pose.eye} cy={23} r={1.65}/>
    </AnimatedG>
    <Path testID="bob-mascot-mouth" strokeWidth={2} d={pose.mouth}/>
    {state==='attention'&&<Path testID="bob-mascot-brows" strokeWidth={2} d="M32 17 L37 16 M43 16 L48 18"/>}
   </AnimatedG>
  </AnimatedG>
 </Svg>;
}
