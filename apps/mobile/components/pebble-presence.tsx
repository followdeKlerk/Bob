import React,{useEffect,useRef,useState} from 'react';
import {View} from 'react-native';
import {Text} from './app-text';
import {PebbleBob} from './pebble-bob';
import {MotionSurface} from './motion-surface';
import {useAppMotion} from '../app-motion';
import {useTheme} from '../theme';
import type {ComposerActivity} from '../composer-activity';
import {PEBBLE_QUIPS,pickPebbleQuip} from '../pebble-quips';

const SPEAK_AFTER=6500,QUIP_DURATION=7200,QUIP_GAP=32000;
/** Phase truth is always visible. Optional humour is local, sparse, unannounced
 * and cannot outlive its scope/phase. No content, tools or model calls needed. */
export function PebblePresence({active,scope,activity}:{active:boolean;scope:string;activity:ComposerActivity}) {
 const {colors}=useTheme(),motion=useAppMotion();
 const [joke,setJoke]=useState<{scope:string;phase:string;text:string}|null>(null);
 const history=useRef<{scope:string;recent:string[];lastAt:number}>({scope,recent:[],lastAt:0});
 const {phase,text}=activity;
 useEffect(()=>{
  if(history.current.scope!==scope)history.current={scope,recent:[],lastAt:0};
  setJoke(null);
  if(!active||!motion||!PEBBLE_QUIPS[phase]||text.startsWith('Retrying'))return;
  let alive=true,timer:ReturnType<typeof setTimeout>;
  const schedule=()=>{
   timer=setTimeout(()=>{
    if(!alive)return;
    const entry=history.current;
    const line=pickPebbleQuip(phase,entry.recent);
    if(!line)return;
    entry.lastAt=Date.now();entry.recent=[...entry.recent,line].slice(-16);
    setJoke({scope,phase,text:line});
    timer=setTimeout(()=>{if(alive){setJoke(null);schedule();}},QUIP_DURATION);
   },Math.max(SPEAK_AFTER,QUIP_GAP-(Date.now()-history.current.lastAt)));
  };
  schedule();
  return()=>{alive=false;clearTimeout(timer);};
 },[active,motion,scope,phase,text]);
 // Idle stays silent. Connection failures remain literal and joke-free,
 // including when there is no foreground response to narrate.
 const visible=active&&phase!=='idle'&&phase!=='connecting'&&phase!=='sending';
 const quip=active&&motion&&!text.startsWith('Retrying')&&joke?.scope===scope&&joke.phase===phase?joke.text:undefined;
 // Fixed avatar lane, floating speech: wrapping must never change the measured
 // composer clearance or move Pebble. The bottom anchor lets long bubbles grow up.
 return <View testID="pebble-presence" style={{position:'relative',height:76,flexDirection:'row',alignItems:'center',paddingTop:3,paddingBottom:9,overflow:'visible',zIndex:1}}>
  <PebbleBob active={active} working={visible&&phase!=='question'&&phase!=='stopping'}/>
  {visible&&<MotionSurface testID="pebble-speech" active={active} transitionKey={`${scope}:${phase}:${quip??''}`} distance={3} pointerEvents="none" style={{position:'absolute',left:78,right:3,bottom:18,minWidth:0,zIndex:2,overflow:'visible'}}>
   <View accessible accessibilityRole="text" accessibilityLabel={text} accessibilityLiveRegion="polite" style={{borderRadius:16,borderBottomLeftRadius:5,paddingHorizontal:12,paddingVertical:9,borderWidth:1,borderColor:colors.border,backgroundColor:colors.assistantBubble}}>
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={{position:'absolute',left:-4,bottom:18,width:7,height:7,transform:[{rotate:'45deg'}],borderLeftWidth:1,borderBottomWidth:1,borderColor:colors.border,backgroundColor:colors.assistantBubble}}/>
    <Text testID="pebble-status-text" accessible={false} style={{fontSize:13,lineHeight:19,color:quip?colors.muted:colors.foreground}}>{text}</Text>
    {quip&&<Text testID="pebble-quip" accessible={false} importantForAccessibility="no-hide-descendants" style={{fontSize:14,lineHeight:20,color:colors.foreground,marginTop:3}}>{quip}</Text>}
   </View>
  </MotionSurface>}
 </View>;
}
