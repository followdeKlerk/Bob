import React,{memo} from 'react';
import {StyleSheet,type StyleProp,type TextStyle} from 'react-native';
import {Text} from './app-text';

type Props={text:string;style?:StyleProp<TextStyle>};
function sameStyle(before:Props['style'],after:Props['style']):boolean {
 if(before===after)return true;
 const a=StyleSheet.flatten(before)??{},b=StyleSheet.flatten(after)??{};
 const keys=Object.keys(a) as (keyof TextStyle)[];
 return keys.length===Object.keys(b).length&&keys.every(key=>Object.is(a[key],b[key]));
}
/** Render received text immediately, including corrections and partial graphemes.
 * Fabric's nested Text opacity is an attributed span, not a native view fade.
 * Stepping that opacity with JS timers added commits, not smooth frames. Keep
 * one stable text node instead; skip unchanged spans when Markdown recreates
 * equivalent inherited styles. Never gate content, split Unicode or replay
 * already-received text. */
export const StreamingText=memo(function StreamingText({text,style}:Props) {
 return <Text style={style}>{text}</Text>;
},(before,after)=>before.text===after.text&&sameStyle(before.style,after.style));
