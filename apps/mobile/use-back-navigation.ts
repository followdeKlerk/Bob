import {useEffect,useRef} from 'react';
import {BackHandler,Keyboard,Platform} from 'react-native';
import {recordAppEvent} from './app-diagnostics';
/** Back dismisses UI/keyboard, but never exits or minimizes the root chat.
 * Home and Recents remain the explicit ways to leave Bob. */
export function useBackNavigation(onBack:()=>boolean){
 const current=useRef(onBack);current.current=onBack;
 useEffect(()=>{
  if(Platform.OS!=='android')return;
  const subscription=BackHandler.addEventListener('hardwareBackPress',()=>{
   if(current.current()){recordAppEvent('back.ui');return true;}
   if(Keyboard.isVisible()){Keyboard.dismiss();recordAppEvent('back.keyboard');return true;}
   recordAppEvent('back.root-ignored');return true;
  });
  return()=>subscription.remove();
 },[]);
}
