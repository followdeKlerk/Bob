import React,{createContext,useContext,useLayoutEffect,useRef,useState,useSyncExternalStore} from 'react';
import {Animated,BackHandler,Dimensions,Easing,Platform,StyleSheet,View,useWindowDimensions} from 'react-native';
import {useKeyboardInset} from '../keyboard-inset';
import {APP_MOTION,useAppMotion} from '../app-motion';

type Entry={id:string;open:boolean;node:React.ReactNode;onBack:()=>void;order:number;opacity?:Animated.Value;generation?:number;orphan?:boolean};
class OverlayStore{
 private entries=new Map<string,Entry>();private listeners=new Set<()=>void>();private serial=0;
 private snapshot:Entry[]=[];
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>this.listeners.delete(listener);};
 getSnapshot=()=>this.snapshot;
 put(id:string,open:boolean,node:React.ReactNode,onBack:()=>void){
  const old=this.entries.get(id),order=open&&!old?.open?++this.serial:old?.order??0;
  this.entries.set(id,{id,open,node,onBack,order});this.publish();
 }
 remove(id:string){const entry=this.entries.get(id);entry?.opacity?.stopAnimation();if(this.entries.delete(id))this.publish();}
 putRetainable(id:string,node:React.ReactNode,onBack:()=>void,motion:boolean){
  const previous=this.entries.get(id),opening=!previous||!previous.open;
  const opacity=previous?.opacity??new Animated.Value(motion?0:1),generation=(previous?.generation??0)+Number(opening);
  if(opening||!motion){opacity.stopAnimation();if(opening&&motion)Animated.timing(opacity,{toValue:1,duration:APP_MOTION.enter,easing:Easing.out(Easing.cubic),useNativeDriver:true,isInteraction:false}).start();else opacity.setValue(1);}
  this.entries.set(id,{id,open:true,node,onBack,order:opening?++this.serial:previous!.order,opacity,generation});this.publish();
 }
 retire(id:string,motion:boolean){
  const entry=this.entries.get(id);if(!entry)return;
  if(!motion||!entry.opacity){this.remove(id);return;}
  const generation=(entry.generation??0)+1;entry.opacity.stopAnimation();
  this.entries.set(id,{...entry,open:false,orphan:true,generation});this.publish();
  Animated.timing(entry.opacity,{toValue:0,duration:APP_MOTION.enter,easing:Easing.out(Easing.cubic),useNativeDriver:true,isInteraction:false}).start(({finished})=>{const current=this.entries.get(id);if(finished&&current?.orphan&&current.generation===generation)this.remove(id);});
 }
 settleOrphans(){for(const entry of this.snapshot)if(entry.orphan)this.remove(entry.id);}
 private publish(){this.snapshot=[...this.entries.values()].sort((a,b)=>a.order-b.order);this.listeners.forEach(listener=>listener());}
 back(){const owner=this.snapshot.filter(entry=>entry.open).at(-1);if(!owner)return false;owner.onBack();return true;}
}
const Context=createContext<OverlayStore|null>(null);
const KeyboardClearance=createContext<number|null>(null);
/** The host may already have been resized by Android. Only the overlap of its
 * measured bottom with the screen-space IME needs additional clearance. */
export function overlayKeyboardOverlap(screenHeight:number,hostBottom:number,ime:number){
 if(!Number.isFinite(screenHeight)||!Number.isFinite(hostBottom)||!Number.isFinite(ime)||screenHeight<=0||hostBottom<=0||ime<=0)return 0;
 return Math.max(0,Math.min(ime,hostBottom-(screenHeight-ime)));
}
export function useOverlayKeyboardClearance(){return useContext(KeyboardClearance);}

let nextOverlay=0;
/** One same-window overlay plane per retained session. Closed exit visuals are
 * non-interactive; opening a new surface immediately makes it the sole owner. */
export function OverlayHost({children}:{children:React.ReactNode}){
 const store=useRef(new OverlayStore()).current,root=useRef<React.ComponentRef<typeof View>>(null),keyboard=useKeyboardInset(),window=useWindowDimensions();
 const [bottom,setBottom]=useState<number>(),measurement=useRef(0);
 const measure=()=>{const generation=++measurement.current;root.current?.measureInWindow((_x,y,_width,height)=>{const next=y+height;if(generation===measurement.current&&Number.isFinite(next)&&next>0)setBottom(old=>old===next?old:next);});};
 useLayoutEffect(()=>()=>{measurement.current++;},[]);
 useLayoutEffect(()=>{if(Platform.OS==='android')measure();},[keyboard,window.height,window.width]);
 const screenHeight=Dimensions.get('screen').height;
 const clearance=Platform.OS==='android'?(bottom===undefined?keyboard:overlayKeyboardOverlap(screenHeight,bottom,keyboard)):0;
 return <Context.Provider value={store}><KeyboardClearance.Provider value={clearance}><View ref={root} collapsable={false} testID="overlay-host-viewport" onLayout={measure} style={{flex:1}}><OverlayFrame store={store}>{children}</OverlayFrame></View></KeyboardClearance.Provider></Context.Provider>;
}
function OverlayFrame({store,children}:{store:OverlayStore;children:React.ReactNode}){
 const entries=useSyncExternalStore(store.subscribe,store.getSnapshot,store.getSnapshot),owner=entries.filter(entry=>entry.open).at(-1),motion=useAppMotion();
 React.useLayoutEffect(()=>{if(!motion)store.settleOrphans();},[motion,store]);
 React.useEffect(()=>{const back=BackHandler.addEventListener('hardwareBackPress',()=>store.back());return()=>back.remove();},[store]);
 return <View style={{flex:1}}><View style={{flex:1}} accessibilityElementsHidden={!!owner} importantForAccessibility={owner?'no-hide-descendants':'auto'}>{children}</View>
  {entries.map(entry=><View key={entry.id} testID={entry===owner?'overlay-active':'overlay-exiting'} pointerEvents={entry===owner?'auto':'none'} accessibilityElementsHidden={entry!==owner} importantForAccessibility={entry===owner?'auto':'no-hide-descendants'} style={[StyleSheet.absoluteFill,{zIndex:entry.order+1}]}><Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill,entry.opacity&&{opacity:entry.opacity}]}>{entry.node}</Animated.View></View>)}
 </View>;
}
/** Register presentation without moving business state out of its consumer.
 * Omit when no host exists so isolated consumers retain their native fallback. */
export function useOverlayHostAvailable(){return !!useContext(Context);}
/** Other Back listeners may register after the host: consult its current owner
 * before consuming Back, regardless of React Native subscription order. */
export function useOverlayBack(){
 const store=useContext(Context);
 return React.useCallback(()=>store?.back()??false,[store]);
}
/** An exit snapshot from an old session must not outlive a scope change. */
export function useOverlayScope(scope:string){
 const store=useContext(Context),previous=useRef(scope);
 useLayoutEffect(()=>{if(previous.current!==scope){previous.current=scope;store?.settleOrphans();}},[scope,store]);
}
export function useOverlayHost(open:boolean,mounted:boolean,node:React.ReactNode,onBack:()=>void){
 const store=useContext(Context),identity=useRef<string|null>(null);
 if(!identity.current)identity.current=`overlay-${++nextOverlay}`;
 const id=identity.current;
 useLayoutEffect(()=>{if(!store)return;if(mounted)store.put(id,open,node,onBack);else store.remove(id);});
 useLayoutEffect(()=>()=>store?.remove(id),[store,id]);
 return !!store;
}
/** For conditionally mounted surfaces: business state unmounts immediately,
 * while the host owns an inert exit snapshot. Only explicit user closes retain
 * it; scope retirement removes it synchronously. */
export function useRetainableOverlay(key:string,node:React.ReactNode,onBack:()=>void){
 const store=useContext(Context),motion=useAppMotion(),retire=useRef(false),motionRef=useRef(motion);motionRef.current=motion;
 useLayoutEffect(()=>{store?.putRetainable(key,node,onBack,motion);});
 useLayoutEffect(()=>()=>{if(retire.current)store?.retire(key,motionRef.current);else store?.remove(key);},[store,key]);
 return {hosted:!!store,retainExit:()=>{retire.current=true;}};
}
