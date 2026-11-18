import React,{createContext,useContext,useEffect} from 'react';
import {Platform,requireNativeComponent,UIManager,type ViewProps} from 'react-native';
import Animated,{useAnimatedStyle,useEvent,useSharedValue,type SharedValue} from 'react-native-reanimated';

type NativeProps=ViewProps&{imeActive:boolean;onImeProgress?:(event:{overlap:number;fraction?:number})=>void};
export const nativeKeyboardLayout=Platform.OS==='android'&&Number(Platform.Version)>=30&&!!UIManager.getViewManagerConfig('BobImeLayout');
const Host=nativeKeyboardLayout?Animated.createAnimatedComponent(requireNativeComponent<NativeProps>('BobImeLayout')):undefined;
const ComposerOffset=createContext<ReturnType<typeof useAnimatedStyle>|undefined>(undefined);
const ComposerProgress=createContext<SharedValue<number>|undefined>(undefined);
type KeyboardLayoutProps={active:boolean;children:React.ReactNode;clearanceColor?:string};
function NativeLayout({active,children,clearanceColor}:KeyboardLayoutProps){
 const overlap=useSharedValue(0),fraction=useSharedValue(0),enabled=useSharedValue(active);
 useEffect(()=>{enabled.value=active;},[active,enabled]);
 const onImeProgress=useEvent<{overlap:number;fraction?:number}>(event=>{
  'worklet';
  if(enabled.value&&Number.isFinite(event.overlap)&&event.overlap>=0){
   overlap.value=event.overlap;
   if(typeof event.fraction==='number'&&Number.isFinite(event.fraction)&&event.fraction>=0&&event.fraction<=1)fraction.value=event.fraction;
  }
 },['onImeProgress']);
 const viewport=useAnimatedStyle(()=>({paddingBottom:overlap.value}));
 const clearance=useAnimatedStyle(()=>({height:overlap.value}));
 const composer=useAnimatedStyle(()=>({bottom:overlap.value}));
 // A hosted opaque form must paint its reserved band too: native IME and
 // React layout can publish on adjacent frames during a quick reversal.
 // Otherwise the transparent padding briefly reveals the chat underneath.
 return Host?<Host testID="native-keyboard-layout" collapsable={false} imeActive={active} onImeProgress={onImeProgress} style={[{flex:1},viewport]}>{clearanceColor&&<Animated.View testID="keyboard-clearance-surface" pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[{position:'absolute',left:0,right:0,bottom:0,backgroundColor:clearanceColor},clearance]}/>}<ComposerOffset.Provider value={composer}><ComposerProgress.Provider value={fraction}>{children}</ComposerProgress.Provider></ComposerOffset.Provider></Host>:null;
}
/** One UI-thread overlap owner for the retained transcript AND composer. Older
 * clients/platforms keep the established JS layout, without another wrapper. */
export function KeyboardLayout({active,children,clearanceColor}:KeyboardLayoutProps){
 return Host?<NativeLayout active={active} clearanceColor={clearanceColor}>{children}</NativeLayout>:<>{children}</>;
}
export function KeyboardComposer({style,...props}:React.ComponentProps<typeof Animated.View>){
 const offset=useContext(ComposerOffset);
 return <Animated.View {...props} style={[style,offset]}/>;
}
export function useNativeComposerMotion(){return !!useContext(ComposerProgress);}
type DraftMotion={frame:ReturnType<typeof useAnimatedStyle>;input:ReturnType<typeof useAnimatedStyle>;controls:ReturnType<typeof useAnimatedStyle>;expansion:ReturnType<typeof useAnimatedStyle>};
function NativeDraftGeometry({progress,height,trailingWidth,children}:{progress:SharedValue<number>;height:number;trailingWidth:number;children:(motion?:DraftMotion)=>React.ReactNode}){
 const frame=useAnimatedStyle(()=>({paddingBottom:52*progress.value}));
 const input=useAnimatedStyle(()=>({height:48+(height-48)*progress.value,marginLeft:56*(1-progress.value),marginRight:(trailingWidth+8)*(1-progress.value)}));
 const controls=useAnimatedStyle(()=>({position:'absolute',left:0,right:0,bottom:0,height:48,marginTop:0}));
 const expansion=useAnimatedStyle(()=>({width:48*progress.value,opacity:progress.value,overflow:'hidden'}));
 return children({frame,input,controls,expansion});
}
/** Morph with native IME progress, not a settled JS event or a second timer. */
export function KeyboardDraftGeometry({enabled,height,trailingWidth,children}:{enabled:boolean;height:number;trailingWidth:number;children:(motion?:DraftMotion)=>React.ReactNode}){
 const progress=useContext(ComposerProgress);
 return progress&&enabled?<NativeDraftGeometry progress={progress} height={height} trailingWidth={trailingWidth}>{children}</NativeDraftGeometry>:children();
}
function NativeCapsule({progress,style,...props}:React.ComponentProps<typeof Animated.View>&{progress:SharedValue<number>}){
 const geometry=useAnimatedStyle(()=>({padding:8*progress.value,gap:4*progress.value}));
 return <Animated.View {...props} style={[style,geometry]}/>;
}
export function KeyboardCapsule(props:React.ComponentProps<typeof Animated.View>){
 const progress=useContext(ComposerProgress);
 return progress?<NativeCapsule {...props} progress={progress}/>:<Animated.View {...props}/>;
}
