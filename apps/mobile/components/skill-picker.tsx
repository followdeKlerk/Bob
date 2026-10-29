import {Text} from './app-text';
import React,{useEffect,useRef,useState} from 'react';
import {Pressable,ScrollView,StyleSheet,View} from 'react-native';
import {colors} from '../theme';
import {filterSkills,pickerEntries,type PickerEntry} from '../skill-picker';

export function SkillPicker({scope,query,loadLibrary,bottom,maxHeight,onSelect,onDismiss}:{scope:string;query:string;loadLibrary:()=>Promise<unknown>;bottom:number;maxHeight:number;onSelect:(entry:PickerEntry)=>void;onDismiss:()=>void}){
 const loader=useRef(loadLibrary);loader.current=loadLibrary;
 const [state,setState]=useState<{scope:string;entries?:PickerEntry[];error?:boolean}>({scope});
 const [retry,setRetry]=useState(0);
 useEffect(()=>{
  let cancelled=false;setState({scope});
  void loader.current().then(library=>{const entries=pickerEntries(library);if(!cancelled)setState({scope,entries});}).catch(()=>{if(!cancelled)setState({scope,error:true});});
  return()=>{cancelled=true;};
 },[scope,retry]);
 const current=state.scope===scope?state:{scope};
 const rows=filterSkills(current.entries??[],query);
 return <View testID="skill-picker" accessibilityLabel="Command and skill suggestions" style={[s.popup,{bottom,maxHeight}]}>
  <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator contentContainerStyle={s.content}>
   <View style={s.heading}><Text style={s.title}>Commands &amp; skills</Text><Pressable accessibilityRole="button" accessibilityLabel="Dismiss command suggestions" onPress={onDismiss} style={s.dismiss}><Text style={s.dismissText}>Close</Text></Pressable></View>
   {!current.entries&&!current.error&&<Text accessibilityLiveRegion="polite" style={s.message}>Loading commands and skills…</Text>}
   {current.error&&<View><Text accessibilityLiveRegion="polite" style={s.message}>Couldn’t load commands and skills. Check your connection.</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry loading commands and skills" onPress={()=>setRetry(n=>n+1)} style={s.dismiss}><Text style={s.dismissText}>Retry</Text></Pressable></View>}
   {current.entries&&rows.length===0&&<Text accessibilityLiveRegion="polite" style={s.message}>{current.entries.length?'No matching commands or skills.':'No commands or skills available. Ask Bob to create a skill.'}</Text>}
   {rows.map(entry=><Pressable key={entry.name} accessibilityRole="button" accessibilityLabel={`${entry.kind==='command'?'Insert command':'Use skill'} ${entry.name}${entry.enabled?'':' (disabled)'}`} accessibilityState={{disabled:!entry.enabled}} disabled={!entry.enabled} onPress={()=>onSelect(entry)} style={[s.row,!entry.enabled&&s.disabled]}><Text style={s.name}>/{entry.name}{entry.enabled?'':' · disabled'}</Text><Text style={s.description}>{entry.description}</Text></Pressable>)}
  </ScrollView>
 </View>;
}
const s=StyleSheet.create({popup:{position:'absolute',left:12,right:12,zIndex:24,elevation:12,borderRadius:20,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,overflow:'hidden'},content:{padding:8},heading:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingLeft:12},title:{fontSize:17,fontWeight:'600',color:colors.foreground,flexShrink:1},dismiss:{minHeight:48,paddingHorizontal:12,justifyContent:'center'},dismissText:{fontSize:16,color:colors.accent},message:{padding:12,fontSize:16,color:colors.muted},row:{minHeight:58,padding:12,borderTopWidth:1,borderColor:colors.border,gap:4},name:{fontSize:17,color:colors.foreground,fontWeight:'500'},description:{fontSize:15,lineHeight:21,color:colors.muted},disabled:{opacity:0.55}});
