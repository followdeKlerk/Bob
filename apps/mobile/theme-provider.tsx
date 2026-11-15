import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Appearance,NativeModules,Platform,View,useColorScheme} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {nativewindVariables} from './theme-variables';

import {APPEARANCE_KEY,tokens,ThemeContext,PreferenceContext,type ThemePreference} from './theme-context';
export {type ThemePreference} from './theme-context';
export {nativewindVariables} from './theme-variables';
export function ThemeProvider({children}:{children:React.ReactNode}){
 const system=useColorScheme(),[preference,setSavedPreference]=useState<ThemePreference>('system'),[ready,setReady]=useState(false),[storageError,setStorageError]=useState('');
 const changed=useRef(false),writes=useRef<Promise<void>>(Promise.resolve());
 useEffect(()=>{let alive=true;void AsyncStorage.getItem(APPEARANCE_KEY).then(value=>{if(alive&&!changed.current&&(value==='light'||value==='dark'||value==='system'))setSavedPreference(value);}).catch(()=>{if(alive)setStorageError('Appearance could not be loaded from this phone.');}).finally(()=>{if(alive)setReady(true);});return()=>{alive=false;};},[]);
 const setPreference=useCallback(async(value:ThemePreference)=>{
  if(value!=='light'&&value!=='dark'&&value!=='system')throw Error('Unknown appearance');
  changed.current=true;
  const write=writes.current.catch(()=>{}).then(()=>AsyncStorage.setItem(APPEARANCE_KEY,value));writes.current=write;
  await write;setSavedPreference(value);setStorageError('');
 },[]);
 const scheme=preference==='system'?(system==='light'?'light':'dark'):preference,theme=tokens[scheme];
 // Android uses owned native chrome, not AppCompat night-mode overrides/recreation.
 useEffect(()=>{if(ready&&Platform.OS!=='android')Appearance.setColorScheme(preference==='system'?'unspecified':preference);},[ready,preference]);
 useEffect(()=>{if(!ready)return;try{void Promise.resolve(NativeModules.BobPlatform?.setAppearance?.(preference)).catch(()=>setStorageError('Native appearance could not be updated. Reopen Bob to try again.'));}catch{setStorageError('Native appearance could not be updated. Reopen Bob to try again.');}},[ready,preference,scheme]);
 const settings=useMemo(()=>({preference,setPreference,storageError}),[preference,setPreference,storageError]);
 const variables=useMemo(()=>nativewindVariables(theme.colors),[theme]);
 return <ThemeContext.Provider value={theme}><PreferenceContext.Provider value={settings}><View testID="app-theme" style={[{flex:1,backgroundColor:ready?theme.colors.background:'transparent'},variables]}>{ready?children:null}</View></PreferenceContext.Provider></ThemeContext.Provider>;
}
