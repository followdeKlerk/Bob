import React,{useEffect,useRef,useState} from 'react';
import {Alert,NativeModules,ToastAndroid,View} from 'react-native';
import {Copy,Check,type LucideIcon} from 'lucide-react-native';
import {Button} from './ui/button';
import {colors} from '../theme';

export function ActionRow({children}:{children:React.ReactNode}) {
 return <View style={{flexDirection:'row',alignItems:'center',flexWrap:'wrap',gap:2,marginTop:4}}>{children}</View>;
}
export function ActionIcon({icon:Icon,label,onPress,expanded,selected=false,disabled=false}:{icon:LucideIcon;label:string;onPress:()=>void;expanded?:boolean;selected?:boolean;disabled?:boolean}) {
 return <Button variant="ghost" size="icon" accessibilityLabel={label} accessibilityState={{expanded,selected,disabled}} onPress={onPress} disabled={disabled} onLongPress={()=>ToastAndroid.show(label,ToastAndroid.SHORT)} style={{width:44,height:44,padding:0,borderRadius:12,opacity:disabled?0.4:1}}><Icon size={19} strokeWidth={1.8} color={selected?colors.accent:colors.muted}/></Button>;
}
export function CopyAction({text,label='Copy reply'}:{text:string;label?:string}) {
 const [copied,setCopied]=useState(false);
 const mounted=useRef(true),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;clearTimeout(timer.current);};},[]);
 useEffect(()=>{clearTimeout(timer.current);setCopied(false);},[text]);
 async function copy(){
  try {
   await NativeModules.BobPlatform.copyText(text);
   if(!mounted.current)return;
   clearTimeout(timer.current);setCopied(true);timer.current=setTimeout(()=>setCopied(false),1600);
  }catch{if(mounted.current)Alert.alert('Copy failed','The clipboard could not be updated. Your original content is unchanged.');}
 }
 return <ActionIcon icon={copied?Check:Copy} label={copied?'Copied':label} selected={copied} disabled={!text} onPress={()=>void copy()}/>;
}
