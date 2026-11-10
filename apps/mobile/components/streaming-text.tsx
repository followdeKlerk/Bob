import React,{useLayoutEffect,useRef,useState} from 'react';
import {type StyleProp,type TextStyle} from 'react-native';
import {useChatMotion} from '../chat-motion';
import {Text} from './app-text';

/** A brief leading-edge fade, not a typewriter: every character is present on
 * this render. Previous text becomes opaque immediately on the next append. */
export function StreamingText({text,start,style}:{text:string;start:number|null;style?:StyleProp<TextStyle>}) {
 const motion=useChatMotion();
 const [opacity,setOpacity]=useState(1);
 const consumed=useRef<{text:string;start:number|null}|null>(null);
 const animate=motion&&start!==null&&start<text.length;
 useLayoutEffect(()=>{
  const fresh=consumed.current?.text!==text||consumed.current?.start!==start;
  consumed.current={text,start};
  // Resolving preferences, resuming the app or returning to chat must not
  // replay the most recent edge. Only a new arriving-text revision can fade.
  if(!animate||!fresh){setOpacity(1);return;}
  // Fabric renders nested Text opacity as an attributed span. Native Animated
  // updates view alpha, not that span. Two finite React commits regenerate the
  // suffix's text attributes without rerendering/parsing the Markdown parent.
  // This is intentionally not a JS frame loop or a queued character reveal.
  let alive=true;
  const began=Date.now();
  setOpacity(.78);
  const midpoint=setTimeout(()=>{if(alive)setOpacity(Date.now()-began>=140?1:.91);},70);
  const finish=setTimeout(()=>{if(alive)setOpacity(1);},140);
  return ()=>{alive=false;clearTimeout(midpoint);clearTimeout(finish);};
 },[animate,start,text]);
 return <Text style={style}>{animate?<>{text.slice(0,start!)}<Text testID="streaming-text-edge" style={{opacity}}>{text.slice(start!)}</Text></>:text}</Text>;
}
