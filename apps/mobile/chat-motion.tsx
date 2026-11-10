import React,{createContext,useContext,useEffect,useRef,useState} from 'react';
import {AccessibilityInfo,AppState} from 'react-native';

const ChatMotionContext=createContext(false);
/** One gate for chat motion. Unresolved accessibility preferences always mean off. */
export function ChatMotionProvider({active,children}:{active:boolean;children:React.ReactNode}) {
 const [foreground,setForeground]=useState(AppState.currentState==='active');
 const lastForeground=useRef(foreground);
 const [preferences,setPreferences]=useState<{reduce:boolean|null;reader:boolean|null}|null>(null);
 useEffect(()=>{
  if(!active)return;
  lastForeground.current=AppState.currentState==='active';setForeground(lastForeground.current);
  const subscription=AppState.addEventListener('change',state=>{
   const next=state==='active';
   // Duplicate resume events must not clear preferences without triggering the
   // foreground effect that reloads them; that would leave motion off forever.
   if(lastForeground.current===next)return;
   lastForeground.current=next;setPreferences(null);setForeground(next);
  });
  return ()=>subscription.remove();
 },[active]);
 useEffect(()=>{
  setPreferences(null);
  if(!active||!foreground)return;
  let alive=true,reduceEvent=false,readerEvent=false;
  const reduce=AccessibilityInfo.addEventListener('reduceMotionChanged',value=>{
   reduceEvent=true;
   if(alive)setPreferences(previous=>({reader:previous?.reader??null,reduce:value}));
  });
  const reader=AccessibilityInfo.addEventListener('screenReaderChanged',value=>{
   readerEvent=true;
   if(alive)setPreferences(previous=>({reduce:previous?.reduce??null,reader:value}));
  });
  void AccessibilityInfo.isReduceMotionEnabled().then(value=>{
   if(alive&&!reduceEvent)setPreferences(previous=>({reader:previous?.reader??null,reduce:value}));
  }).catch(()=>{});
  void AccessibilityInfo.isScreenReaderEnabled().then(value=>{
   if(alive&&!readerEvent)setPreferences(previous=>({reduce:previous?.reduce??null,reader:value}));
  }).catch(()=>{});
  return ()=>{alive=false;reduce.remove();reader.remove();};
 },[active,foreground]);
 return <ChatMotionContext.Provider value={active&&foreground&&preferences?.reduce===false&&preferences.reader===false}>{children}</ChatMotionContext.Provider>;
}
export function useChatMotion():boolean {return useContext(ChatMotionContext);}
