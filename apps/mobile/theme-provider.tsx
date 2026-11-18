import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Appearance,NativeModules,Platform,View,useColorScheme} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {nativewindVariables} from './theme-variables';
import {startupRead} from './startup-recovery';
import {StartupRecovery} from './components/startup-recovery';
import {recordAppEvent} from './app-diagnostics';

import {APPEARANCE_KEY,tokens,ThemeContext,PreferenceContext,type ThemePreference} from './theme-context';
export {type ThemePreference} from './theme-context';
export {nativewindVariables} from './theme-variables';
const validPreference=(value:unknown):value is ThemePreference=>value==='light'||value==='dark'||value==='system';
export function ThemeProvider({children}:{children:React.ReactNode}){
 const system=useColorScheme(),[preference,setSavedPreference]=useState<ThemePreference>(()=>validPreference(NativeModules.BobPlatform?.initialAppearance)?NativeModules.BobPlatform.initialAppearance:'system'),[attempt,setAttempt]=useState(0),[ready,setReady]=useState(false),[storageError,setStorageError]=useState('');
 const changed=useRef(false),writes=useRef<Promise<void>>(Promise.resolve());
 useEffect(()=>{
  let alive=true;setStorageError('');
  void startupRead(()=>AsyncStorage.getItem(APPEARANCE_KEY)).then(value=>{
   if(!alive||changed.current)return;
   if(value!==null&&!validPreference(value))throw Error('Invalid saved appearance');
   setSavedPreference(value??'system');setReady(true);
  }).catch(()=>{if(alive)setStorageError('Appearance could not be opened on this phone. Your saved choice was not changed. Retry to read it again.');});
  return()=>{alive=false;};
 },[attempt]);
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
 const noted=useRef(false);
 const themedFrame=()=>{if(ready&&!noted.current){noted.current=true;recordAppEvent('startup.theme-ready');}};
 useEffect(()=>{if(!ready)return;const frame=requestAnimationFrame(themedFrame);return()=>cancelAnimationFrame(frame);},[ready]);
 const variables=useMemo(()=>nativewindVariables(theme.colors),[theme]);
 return <ThemeContext.Provider value={theme}><PreferenceContext.Provider value={settings}><View testID="app-theme" onLayout={themedFrame} style={[{flex:1,backgroundColor:ready||validPreference(NativeModules.BobPlatform?.initialAppearance)||storageError?theme.colors.background:'transparent'},variables]}>{ready?children:storageError||validPreference(NativeModules.BobPlatform?.initialAppearance)?<StartupRecovery stage="appearance" error={storageError} onRetry={()=>setAttempt(value=>value+1)}/>:null}</View></PreferenceContext.Provider></ThemeContext.Provider>;
}
