import React,{useState} from 'react';
import {Pressable,View} from 'react-native';
import {Sun,Moon,Monitor} from 'lucide-react-native';
import {Text} from './app-text';
import {SettingsGroup} from './section-ui';
import {useTheme} from '../theme';
import type {ThemePreference} from '../theme-provider';
const options=[{value:'system',label:'System',icon:Monitor},{value:'light',label:'Light',icon:Sun},{value:'dark',label:'Dark',icon:Moon}] as const;
export function AppearanceSettings(){
 const {colors,preference,setPreference,storageError}=useTheme(),[error,setError]=useState('');
 const choose=(value:ThemePreference)=>{setError('');void setPreference(value).catch(()=>setError('Could not save appearance. Please try again.'));};
 return <SettingsGroup title="Appearance">
  <View accessibilityRole="radiogroup" accessibilityLabel="App theme" style={{flexDirection:'row',flexWrap:'wrap',gap:8,paddingVertical:8}}>
   {options.map(({value,label,icon:Icon})=><Pressable key={value} accessibilityRole="radio" accessibilityLabel={`${label} theme`} accessibilityState={{checked:preference===value}} onPress={()=>choose(value)} style={{flex:1,minWidth:72,minHeight:64,borderRadius:14,borderWidth:1,borderColor:preference===value?colors.accent:colors.border,backgroundColor:preference===value?colors.accent:colors.surface,alignItems:'center',justifyContent:'center',padding:8,gap:5}}><Icon size={20} color={preference===value?colors.onAccent:colors.foreground}/><Text style={{fontSize:13,color:preference===value?colors.onAccent:colors.foreground}}>{label}</Text></Pressable>)}
  </View>
  <Text style={{color:colors.muted,fontSize:12,lineHeight:20,paddingBottom:8}}>System follows your phone. This choice is saved on this phone.</Text>
  {!!(error||storageError)&&<Text accessibilityLiveRegion="polite" style={{color:colors.foreground,fontSize:13,paddingBottom:8}}>{error||storageError}</Text>}
 </SettingsGroup>;
}
