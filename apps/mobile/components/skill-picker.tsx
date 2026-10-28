import React,{useEffect,useRef,useState} from 'react';
import {Pressable,ScrollView,StyleSheet,Text,View} from 'react-native';
import {colors} from '../theme';
import {filterSkills,pickerSkills,type PickerSkill} from '../skill-picker';

export function SkillPicker({scope,query,loadLibrary,bottom,maxHeight,onSelect,onDismiss}:{scope:string;query:string;loadLibrary:()=>Promise<unknown>;bottom:number;maxHeight:number;onSelect:(skill:PickerSkill)=>void;onDismiss:()=>void}){
 const loader=useRef(loadLibrary);loader.current=loadLibrary;
 const [state,setState]=useState<{scope:string;skills?:PickerSkill[];error?:boolean}>({scope});
 const [retry,setRetry]=useState(0);
 useEffect(()=>{
  let cancelled=false;setState({scope});
  void loader.current().then(library=>{const skills=pickerSkills(library);if(!cancelled)setState({scope,skills});}).catch(()=>{if(!cancelled)setState({scope,error:true});});
  return()=>{cancelled=true;};
 },[scope,retry]);
 const current=state.scope===scope?state:{scope};
 const rows=filterSkills(current.skills??[],query);
 return <View testID="skill-picker" accessibilityLabel="Skill suggestions" style={[s.popup,{bottom,maxHeight}]}>
  <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator contentContainerStyle={s.content}>
   <View style={s.heading}><Text style={s.title}>Skills</Text><Pressable accessibilityRole="button" accessibilityLabel="Dismiss skill suggestions" onPress={onDismiss} style={s.dismiss}><Text style={s.dismissText}>Close</Text></Pressable></View>
   {!current.skills&&!current.error&&<Text accessibilityLiveRegion="polite" style={s.message}>Loading skills…</Text>}
   {current.error&&<View><Text accessibilityLiveRegion="polite" style={s.message}>Couldn’t load skills. Check your connection.</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry loading skills" onPress={()=>setRetry(n=>n+1)} style={s.dismiss}><Text style={s.dismissText}>Retry</Text></Pressable></View>}
   {current.skills&&rows.length===0&&<Text accessibilityLiveRegion="polite" style={s.message}>{current.skills.length?'No matching skills.':'No skills saved yet. Ask Bob to create one.'}</Text>}
   {rows.map(skill=><Pressable key={skill.name} accessibilityRole="button" accessibilityLabel={`Use skill ${skill.name}${skill.enabled?'':' (disabled)'}`} accessibilityState={{disabled:!skill.enabled}} disabled={!skill.enabled} onPress={()=>onSelect(skill)} style={[s.row,!skill.enabled&&s.disabled]}><Text style={s.name}>/{skill.name}{skill.enabled?'':' · disabled'}</Text><Text style={s.description}>{skill.description}</Text></Pressable>)}
  </ScrollView>
 </View>;
}
const s=StyleSheet.create({popup:{position:'absolute',left:12,right:12,zIndex:24,elevation:12,borderRadius:20,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,overflow:'hidden'},content:{padding:8},heading:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingLeft:12},title:{fontSize:17,fontWeight:'600',color:colors.foreground},dismiss:{minHeight:48,paddingHorizontal:12,justifyContent:'center'},dismissText:{fontSize:16,color:colors.accent},message:{padding:12,fontSize:16,color:colors.muted},row:{minHeight:58,padding:12,borderTopWidth:1,borderColor:colors.border,gap:4},name:{fontSize:17,color:colors.foreground,fontWeight:'500'},description:{fontSize:15,lineHeight:21,color:colors.muted},disabled:{opacity:0.55}});
