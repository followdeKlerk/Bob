import {useModalTransition} from './modal-transition';
import {useOverlayHost,useOverlayHostAvailable,useOverlayKeyboardClearance} from './overlay-host';
import {Text,TextInput} from './app-text';
import React,{useEffect,useRef,useState} from 'react';
import {Animated as NativeAnimated,Keyboard,Modal,Platform,Pressable,StyleSheet,View,useWindowDimensions} from 'react-native';
import {SafeAreaView,useSafeAreaInsets} from 'react-native-safe-area-context';
import {Maximize2,Minimize2} from 'lucide-react-native';
import {useKeyboardInset} from '../keyboard-inset';
import {draftMetrics} from '../composer-geometry';
import {KeyboardDraftGeometry,useNativeComposerMotion} from './keyboard-layout';
import {themed,useTheme,useThemedValue} from '../theme';
import Animated,{LinearTransition,ReduceMotion} from 'react-native-reanimated';
const AnimatedSafeAreaView=NativeAnimated.createAnimatedComponent(SafeAreaView);
export const composerTransition=LinearTransition.duration(180).reduceMotion(ReduceMotion.System);
export function DraftInput({value,onChangeText,scope,maxHeight=260,leading,trailing,trailingWidth=48,compact=false,onExpandedChange,onFocusChange,editable=true,active=true,animateLayout=true}:{editable?:boolean;active?:boolean;animateLayout?:boolean;value:string;onChangeText:(value:string)=>void;scope:string;maxHeight?:number;compact?:boolean;onFocusChange?:(focused:boolean)=>void;onExpandedChange?:(expanded:boolean)=>void;leading?:React.ReactNode;trailing?:React.ReactNode;trailingWidth?:number}){
 const {colors}=useTheme();
 const s=useThemedValue(sTheme);

 const [contentHeight,setContentHeight]=useState(48),[expanded,setExpanded]=useState(false);
 const editorScope=useRef(scope),editorOpen=active&&expanded&&editorScope.current===scope;
 const transition=useModalTransition(editorOpen,active&&editorScope.current===scope);
 const input=useRef<React.ComponentRef<typeof TextInput>>(null),fullInput=useRef<React.ComponentRef<typeof TextInput>>(null);
 const [focused,setFocused]=useState<'inline'|'expanded'>();
 useEffect(()=>{onExpandedChange?.(expanded);},[expanded,onExpandedChange]);
 useEffect(()=>{onFocusChange?.(focused==='inline'&&!expanded);},[focused,expanded,onFocusChange]);
 const blur=()=>{input.current?.blur();fullInput.current?.blur();setFocused(undefined);};
 const keyboard=useKeyboardInset(),insets=useSafeAreaInsets(),hostAvailable=useOverlayHostAvailable(),overlayKeyboard=useOverlayKeyboardClearance();
 const previousKeyboard=useRef(keyboard);
 useEffect(()=>{setExpanded(false);setContentHeight(48);blur();},[scope]);
 useEffect(()=>{if(!active&&expanded){fullInput.current?.blur();setFocused(current=>current==='expanded'?undefined:current);setExpanded(false);}},[active]);
 useEffect(()=>{const listener=Keyboard.addListener('keyboardDidHide',blur);return()=>listener.remove();},[]);
 useEffect(()=>{if(previousKeyboard.current>0&&keyboard===0)blur();previousKeyboard.current=keyboard;},[keyboard]);
 // At larger font scales, preserve full-width text and the reachable expansion
 // action instead of squeezing a scaled line between three fixed-size buttons.
 const {fontScale}=useWindowDimensions();
 const nativeMotion=useNativeComposerMotion(),nativeMorph=nativeMotion&&fontScale<=1;
 const {inline:compactRow,input:minimum}=draftMetrics(fontScale,compact&&!nativeMorph);
 const limit=compactRow?48:Math.max(minimum,maxHeight),height=Math.min(limit,Math.max(minimum,Math.ceil(contentHeight)));
 const canExpand=contentHeight>minimum+1||value.includes('\n');
 const close=()=>{blur();setExpanded(false);Keyboard.dismiss();};
 useEffect(()=>{if(editorOpen&&transition.mounted)fullInput.current?.focus();},[editorOpen,transition.mounted]);
 const overlay=<AnimatedSafeAreaView pointerEvents={editorOpen?'auto':'none'} accessibilityElementsHidden={!editorOpen} importantForAccessibility={editorOpen?'auto':'no-hide-descendants'} style={[s.editor,{paddingBottom:hostAvailable&&(Platform.OS==='android')?(overlayKeyboard??0):Math.max(0,keyboard-insets.bottom)},transition.panel]}><View style={s.heading}><Text style={s.title}>Message</Text><Pressable accessibilityRole="button" accessibilityLabel="Collapse message editor" onPress={close} style={s.done}><Minimize2 size={19} color={colors.foreground}/><Text style={s.doneText}>Done</Text></Pressable></View><TextInput ref={fullInput} autoFocus caretHidden={focused!=='expanded'} onFocus={()=>setFocused('expanded')} onBlur={()=>setFocused(current=>current==='expanded'?undefined:current)} accessibilityLabel="Expanded message draft" editable={editable&&editorOpen} multiline textAlignVertical="top" value={value} onChangeText={onChangeText} style={s.expandedInput}/></AnimatedSafeAreaView>;
 const hosted=useOverlayHost(editorOpen,transition.mounted,overlay,()=>{if(editorOpen)close();});
 return <KeyboardDraftGeometry enabled={nativeMorph} height={height} trailingWidth={trailingWidth}>{motion=><Animated.View testID="draft-editor" layout={animateLayout?composerTransition:undefined} style={[{overflow:'hidden'},motion?.frame]}>
  <Animated.View testID="draft-input-frame" style={motion?.input}><TextInput ref={input} caretHidden={focused!=='inline'} onFocus={()=>setFocused('inline')} onBlur={()=>setFocused(current=>current==='inline'?undefined:current)} accessibilityLabel="Message draft" editable={editable} multiline textAlignVertical="top" underlineColorAndroid="transparent" selectionColor={colors.accent} value={value} onChangeText={onChangeText} scrollEnabled={contentHeight>limit} onContentSizeChange={event=>{const next=event.nativeEvent.contentSize.height;if(Number.isFinite(next)&&next>0)setContentHeight(next);}} style={[s.input,motion?{flex:1}:{height,maxHeight:limit},compactRow&&[s.compactInput,{marginLeft:56,marginRight:trailingWidth+8}]]}/></Animated.View>
  <Animated.View layout={animateLayout?composerTransition:undefined} testID="composer-controls" pointerEvents="box-none" style={[s.controls,compactRow&&s.compactControls,motion?.controls]}>
   {leading}<View pointerEvents="none" style={{flex:1}}/>
   {!compactRow&&canExpand&&<Animated.View pointerEvents={motion&&compact?'none':'auto'} accessibilityElementsHidden={!!motion&&compact} importantForAccessibility={motion&&compact?'no-hide-descendants':'auto'} style={motion?.expansion}><Pressable accessibilityRole="button" accessibilityLabel="Expand message editor" onPress={()=>{input.current?.blur();editorScope.current=scope;setExpanded(true);}} style={s.expand}><Maximize2 size={20} color={colors.muted}/></Pressable></Animated.View>}
   {trailing}
  </Animated.View>
  {!hosted&&editorOpen&&<Modal visible transparent animationType="none" onShow={()=>{if(editorOpen)fullInput.current?.focus();}} onRequestClose={close}>{overlay}</Modal>}
 </Animated.View>}</KeyboardDraftGeometry>;
}
const sTheme=themed(({colors,menuChrome})=>StyleSheet.create({input:{color:colors.foreground,backgroundColor:'transparent',fontSize:17,lineHeight:26,minHeight:48,paddingHorizontal:8,paddingVertical:10},compactInput:{fontSize:15,lineHeight:24,paddingTop:7,paddingBottom:7},compactControls:{position:'absolute',top:0,left:0,right:0,height:48,marginTop:0},controls:{flexDirection:'row',alignItems:'center',gap:8,minHeight:48,marginTop:4},expand:{width:48,height:48,borderRadius:24,alignItems:'center',justifyContent:'center'},editor:{flex:1,backgroundColor:colors.background},heading:{paddingHorizontal:20,paddingVertical:12,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},title:{color:colors.foreground,fontSize:20,fontWeight:'500'},done:{minHeight:48,paddingHorizontal:14,flexDirection:'row',alignItems:'center',gap:8,borderRadius:24,backgroundColor:colors.surface},doneText:{color:colors.foreground,fontSize:15},expandedInput:{flex:1,marginHorizontal:20,marginBottom:16,padding:16,borderRadius:20,backgroundColor:colors.composer,color:colors.foreground,fontSize:17,lineHeight:27}}));
