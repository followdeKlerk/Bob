import {APP_FONT_FAMILY} from '../typography';
import {Text} from './app-text';
import React,{useState} from 'react';
import {Pressable,StyleSheet,View} from 'react-native';
import {Check,ChevronDown,ChevronRight,Users} from 'lucide-react-native';
import {colors} from '../theme';
export function PeerAdmission({data,peerName}:{data:unknown;peerName?:string}){
 const [open,setOpen]=useState(false);
 const value=data&&typeof data==='object'?data as Record<string,any>:{};
 const result=value.result&&typeof value.result==='object'?value.result:{};
 const admission=result.admission&&typeof result.admission==='object'?result.admission:{};
 const conversation=Number.isSafeInteger(value.conversationId)?value.conversationId:undefined;
 const status=typeof admission.status==='string'?admission.status:undefined;
 return <View style={s.card}>
  <Pressable accessibilityRole="button" accessibilityLabel="Peer admission details" accessibilityState={{expanded:open}} onPress={()=>setOpen(value=>!value)} style={s.header}>
   <Users size={20} color={colors.muted}/><View style={{flex:1,gap:4}}><Text style={s.label}>Peer admission</Text><Text style={s.title}>Message admission recorded</Text></View>{open?<ChevronDown size={18} color={colors.muted}/>:<ChevronRight size={18} color={colors.muted}/>}
  </Pressable>
  <View style={s.body}>
   <Text style={s.destination}>{peerName?`${peerName} · `:''}{conversation?`Conversation ${conversation}`:'Connected conversation'}</Text>
   <View style={{flexDirection:'row',gap:7,alignItems:'center'}}><Check size={15} color={colors.accent}/><Text style={s.caption}>Receipt confirmed{status?` · ${status}`:''}</Text></View>
   <Text style={s.caption}>Admission confirms receipt, not a completed reply.</Text>
   {open&&<><Text style={s.label}>Recorded details</Text><Text selectable style={s.code}>{JSON.stringify(data,null,2)??'No additional details recorded.'}</Text></>}
  </View>
 </View>;
}
const s=StyleSheet.create({card:{borderWidth:1,borderColor:colors.border,borderRadius:12,backgroundColor:colors.surface,overflow:'hidden'},header:{minHeight:60,flexDirection:'row',alignItems:'center',gap:10,padding:12},label:{fontSize:11,lineHeight:18,color:colors.muted},title:{fontSize:13,lineHeight:21,color:colors.body},body:{paddingHorizontal:12,paddingBottom:12,gap:9},destination:{fontSize:13,lineHeight:21,color:colors.body},caption:{fontSize:12,lineHeight:20,color:colors.muted,flexShrink:1},code:{fontFamily:APP_FONT_FAMILY,fontSize:12,lineHeight:20,color:colors.body}});
