import {selectionHaptic} from '../haptics';
import {menuButtonChrome} from '../menu-button-style';
import React,{useState} from 'react';
import {View,useWindowDimensions} from 'react-native';
import {Sun,Moon,Monitor} from 'lucide-react-native';
import {Text} from './app-text';
import {TouchTarget} from './touch-target';
import {SettingsGroup} from './section-ui';
import {useTheme} from '../theme';
import type {ThemePreference} from '../theme-provider';
const options=[{value:'system',label:'System',icon:Monitor},{value:'light',label:'Light',icon:Sun},{value:'dark',label:'Dark',icon:Moon}] as const;
export function AppearanceSettings(){
 const {colors,shadows,preference,setPreference,storageError}=useTheme(),[error,setError]=useState('');
 const choose=(value:ThemePreference)=>{if(value!==preference)selectionHaptic();setError('');void setPreference(value).catch(()=>setError('Could not save appearance. Please try again.'));};
 const chrome=menuButtonChrome({colors,shadows}),{fontScale}=useWindowDimensions();
 // Reflow whole choices before short labels break into letter fragments.
 const choiceWidth=Math.ceil(80*Math.max(1,fontScale));
 return <SettingsGroup title="Theme">
  <View accessibilityRole="radiogroup" accessibilityLabel="Theme" style={{flexDirection:'row',flexWrap:'wrap',gap:8,paddingVertical:8}}>
   {options.map(({value,label,icon:Icon})=><TouchTarget haptic={false} key={value} accessibilityRole="radio" accessibilityLabel={`${label} theme`} accessibilityState={{checked:preference===value}} onPress={()=>choose(value)} style={[chrome.pill,{flex:1,flexBasis:choiceWidth,minWidth:choiceWidth,minHeight:56,padding:8,gap:5},preference===value&&chrome.selected]}><Icon size={20} color={colors.foreground}/><Text typography="ui" style={{...chrome.label,fontSize:15,lineHeight:23,color:colors.foreground,maxWidth:'100%'}}>{label}</Text></TouchTarget>)}
  </View>
  <Text typography="ui" style={{color:colors.muted,fontSize:13,lineHeight:20,paddingBottom:8}}>Light uses beige menus. Dark uses dark menus. System follows your phone. Your choice is saved on this phone.</Text>
  {!!(error||storageError)&&<Text typography="ui" accessibilityLiveRegion="polite" style={{color:colors.foreground,fontSize:13,lineHeight:20,paddingBottom:8}}>{error||storageError}</Text>}
 </SettingsGroup>;
}
