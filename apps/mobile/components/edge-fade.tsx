import React,{useId} from 'react';
import {View} from 'react-native';
import Svg,{Defs,LinearGradient,Rect,Stop} from 'react-native-svg';
import {colors} from '../theme';

// Decorative only: never intercept gestures or create an accessibility target.
export function EdgeFade({edge,height}:{edge:'top'|'bottom';height:number}) {
 const id='edge'+useId().replace(/[^a-zA-Z0-9]/g,'');
 return <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={{position:'absolute',left:0,right:0,[edge]:0,height}}>
  <Svg width="100%" height="100%" opacity={edge==='top'?0.5:1}>
   <Defs><LinearGradient id={id} x1="0" y1={edge==='top'?'0%':'100%'} x2="0" y2={edge==='top'?'100%':'0%'}>
    <Stop offset="0" stopColor={colors.background} stopOpacity={1}/>
    <Stop offset="0.5" stopColor={colors.background} stopOpacity={0.94}/>
    <Stop offset="1" stopColor={colors.background} stopOpacity={0}/>
   </LinearGradient></Defs>
   <Rect width="100%" height="100%" fill={`url(#${id})`}/>
  </Svg>
 </View>;
}
