import {menuButtonChrome} from '../menu-button-style';
import React,{useState} from 'react';
import {Pressable,View} from 'react-native';
import {Sun,Moon,Monitor} from 'lucide-react-native';
import {Text} from './app-text';
import {SettingsGroup} from './section-ui';
import {useTheme} from '../theme';
import type {ThemePreference} from '../theme-provider';
const options=[{value:'system',label:'System',icon:Monitor},{value:'light',label:'Light',icon:Sun},{value:'dark',label:'Dark',icon:Moon}] as const;
export function AppearanceSettings(){
 const {colors,shadows,preference,setPreference,storageError}=useTheme(),[error,setError]=useState('');
 const choose=(value:ThemePreference)=>{setError('');void setPreference(value).catch(()=>setError('Could not save appearance. Please try again.'));};
 return <SettingsGroup title="Theme">
  <View accessibilityRole="radiogroup" accessibilityLabel="App theme" style={{flexDirection:'row',flexWrap:'wrap',gap:8,paddingVertical:8}}>
   {options.map(({value,label,icon:Icon})=><Pressable key={value} accessibilityRole="radio" accessibilityLabel={`${label} theme`} accessibilityState={{checked:preference===value}} onPress={()=>choose(value)} style={[menuButtonChrome({colors,shadows}).pill,{flex:1,minWidth:72,minHeight:56,padding:8,gap:5},preference===value&&menuButtonChrome({colors,shadows}).selected]}><Icon size={20} color={colors.foreground}/><Text typography="ui" style={{...menuButtonChrome({colors,shadows}).label,fontSize:13,color:colors.foreground,maxWidth:'100%'}}>{label}</Text></Pressable>)}
  </View>
  <Text typography="ui" style={{color:colors.muted,fontSize:12,lineHeight:20,paddingBottom:8}}>System follows your phone. This choice is saved on this phone.</Text>
  {!!(error||storageError)&&<Text typography="ui" accessibilityLiveRegion="polite" style={{color:colors.foreground,fontSize:13,paddingBottom:8}}>{error||storageError}</Text>}
 </SettingsGroup>;
}
