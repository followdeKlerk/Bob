import React from 'react';
import {View} from 'react-native';
import {Text} from './app-text';
import {PebbleBob} from './pebble-bob';
import {MotionSurface} from './motion-surface';
import {useTheme} from '../theme';
import type {ComposerActivity} from '../composer-activity';

/** Only the current observed lifecycle label belongs here, never invented
 * narration, private reasoning or timed filler. */
export function PebblePresence({active,scope,activity}:{active:boolean;scope:string;activity:ComposerActivity}) {
 const {colors}=useTheme();
 const {phase,text}=activity;
 // Idle stays silent; connection failures remain visible even without a run.
 const visible=active&&phase!=='idle'&&phase!=='connecting'&&phase!=='sending';
 // Fixed avatar lane, floating speech: wrapping must never change the measured
 // composer clearance or move Pebble. The bottom anchor lets long bubbles grow up.
 return <View testID="pebble-presence" style={{position:'relative',height:76,flexDirection:'row',alignItems:'center',paddingTop:3,paddingBottom:9,overflow:'visible',zIndex:1}}>
  <PebbleBob active={active} working={visible&&phase!=='question'&&phase!=='stopping'}/>
  {visible&&<MotionSurface testID="pebble-speech" active={active} transitionKey={`${scope}:${phase}`} distance={3} pointerEvents="none" style={{position:'absolute',left:78,right:3,bottom:18,minWidth:0,zIndex:2,overflow:'visible'}}>
   <View accessible accessibilityRole="text" accessibilityLabel={text} accessibilityLiveRegion="polite" style={{borderRadius:16,borderBottomLeftRadius:5,paddingHorizontal:12,paddingVertical:9,borderWidth:1,borderColor:colors.border,backgroundColor:colors.assistantBubble}}>
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={{position:'absolute',left:-4,bottom:18,width:7,height:7,transform:[{rotate:'45deg'}],borderLeftWidth:1,borderBottomWidth:1,borderColor:colors.border,backgroundColor:colors.assistantBubble}}/>
    <Text testID="pebble-status-text" accessible={false} style={{fontSize:13,lineHeight:19,color:colors.foreground}}>{text}</Text>
   </View>
  </MotionSurface>}
 </View>;
}
