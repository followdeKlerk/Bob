import {withMenuTheme} from '../menu-theme';
import {menuButtonChrome} from '../menu-button-style';
import {Text} from './app-text';
import React,{useEffect,useRef,useState} from 'react';
import {Pressable,ScrollView,StyleSheet,View} from 'react-native';
import {themed,useTheme,useThemedValue} from '../theme';
import {SectionActions,SectionAction,SectionBody} from './section-ui';
import {filterSkills,pickerEntries,type PickerEntry} from '../skill-picker';

function SkillPickerContent({scope,query,loadLibrary,bottom,maxHeight,onSelect,onDismiss}:{scope:string;query:string;loadLibrary:()=>Promise<unknown>;bottom:number;maxHeight:number;onSelect:(entry:PickerEntry)=>void;onDismiss:()=>void}){
 const s=useThemedValue(sTheme),{colors}=useTheme();

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
  <View testID="skill-picker-heading" style={s.heading}><Text typography="ui" accessibilityRole="header" style={s.title}>Commands &amp; skills</Text></View>
  <SectionBody surfaceColor={colors.background} style={s.body} footer={<SectionActions overlay leading={<SectionAction label="Dismiss command suggestions" text="Cancel" onPress={onDismiss}/>}/>}>{clearance=>
  <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator style={s.scroll} contentContainerStyle={[s.content,{paddingBottom:clearance+8}]}>
   {!current.entries&&!current.error&&<Text typography="ui" accessibilityLiveRegion="polite" style={s.message}>Loading commands and skills…</Text>}
   {current.error&&<View><Text typography="ui" accessibilityLiveRegion="polite" style={s.message}>Couldn’t load commands and skills. Check your connection.</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry loading commands and skills" onPress={()=>setRetry(n=>n+1)} style={s.dismiss}><Text typography="ui" style={s.dismissText}>Retry</Text></Pressable></View>}
   {current.entries&&rows.length===0&&<Text typography="ui" accessibilityLiveRegion="polite" style={s.message}>{current.entries.length?'No matching commands or skills.':'No commands or skills available. Ask Bob to create a skill.'}</Text>}
   {rows.map((entry,index)=><View key={entry.name}><Pressable accessibilityRole="button" accessibilityLabel={`${entry.kind==='command'?'Insert command':'Use skill'} ${entry.name}${entry.enabled?'':' (disabled)'}`} accessibilityHint={entry.description} accessibilityState={{disabled:!entry.enabled}} disabled={!entry.enabled} onPress={()=>onSelect(entry)} style={[s.row,!entry.enabled&&s.disabled]}><Text typography="ui" style={s.name}>/{entry.name}{entry.enabled?'':' · disabled'}</Text><Text typography="ui" numberOfLines={3} style={s.description}>{entry.description}</Text></Pressable>{index<rows.length-1&&<View testID="skill-picker-separator" pointerEvents="none" style={s.separator}/>}</View>)}
  </ScrollView>
  }</SectionBody>
 </View>;
}
const sTheme=themed(({colors,shadows})=>StyleSheet.create({
 popup:{...shadows.popup,backgroundColor:colors.background,borderRadius:24,position:'absolute',left:12,right:12,zIndex:24,overflow:'hidden'},
 body:{flex:undefined,flexShrink:1,minHeight:0},scroll:{flexGrow:0,flexShrink:1,minHeight:0},content:{paddingHorizontal:8},
 heading:{paddingHorizontal:20,paddingTop:16,paddingBottom:12},title:{fontSize:17,lineHeight:25,fontWeight:'600',color:colors.foreground,flexShrink:1},
 dismiss:{...menuButtonChrome({colors,shadows}).pill,alignSelf:'flex-start',minWidth:48,minHeight:48,paddingHorizontal:12,justifyContent:'center'},
 dismissText:{...menuButtonChrome({colors,shadows}).label,fontSize:15,color:colors.foreground,flexShrink:1},
 message:{padding:12,fontSize:15,lineHeight:23,color:colors.muted},
 row:{minHeight:64,minWidth:48,paddingHorizontal:12,paddingVertical:12,gap:4},
 separator:{height:StyleSheet.hairlineWidth,marginHorizontal:12,backgroundColor:colors.border},
 name:{fontSize:16,lineHeight:24,color:colors.foreground,fontWeight:'500',flexShrink:1},
 description:{fontSize:14,lineHeight:21,color:colors.muted},disabled:{opacity:0.55},
}));

export const SkillPicker=withMenuTheme(SkillPickerContent);
