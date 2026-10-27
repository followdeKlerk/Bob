import React,{useEffect,useRef,useState} from 'react';
import {Keyboard,Modal,Pressable,StyleSheet,Text,TextInput,View} from 'react-native';
import {SafeAreaView,useSafeAreaInsets} from 'react-native-safe-area-context';
import {Maximize2,Minimize2} from 'lucide-react-native';
import {useKeyboardInset} from '../keyboard-inset';
import {colors} from '../theme';
import Animated,{LinearTransition,ReduceMotion} from 'react-native-reanimated';
export const composerTransition=LinearTransition.duration(180).reduceMotion(ReduceMotion.System);
export function DraftInput({value,onChangeText,scope,maxHeight=260,leading,trailing,compact=false}:{value:string;onChangeText:(value:string)=>void;scope:string;maxHeight?:number;compact?:boolean;leading?:React.ReactNode;trailing?:React.ReactNode}){
 const [contentHeight,setContentHeight]=useState(48),[expanded,setExpanded]=useState(false);
 const input=useRef<React.ComponentRef<typeof TextInput>>(null),fullInput=useRef<React.ComponentRef<typeof TextInput>>(null);
 const [focused,setFocused]=useState<'inline'|'expanded'>();
 const blur=()=>{input.current?.blur();fullInput.current?.blur();setFocused(undefined);};
 const keyboard=useKeyboardInset(),insets=useSafeAreaInsets();
 const previousKeyboard=useRef(keyboard);
 useEffect(()=>{setExpanded(false);setContentHeight(48);blur();},[scope]);
 useEffect(()=>{const listener=Keyboard.addListener('keyboardDidHide',blur);return()=>listener.remove();},[]);
 useEffect(()=>{if(previousKeyboard.current>0&&keyboard===0)blur();previousKeyboard.current=keyboard;},[keyboard]);
 const limit=compact?48:Math.max(48,maxHeight),height=Math.min(limit,Math.max(48,Math.ceil(contentHeight)));
 const canExpand=contentHeight>49||value.includes('\n');
 const close=()=>{blur();setExpanded(false);Keyboard.dismiss();};
 return <Animated.View testID="draft-editor" layout={composerTransition} style={{overflow:'hidden'}}>
  <TextInput ref={input} caretHidden={focused!=='inline'} onFocus={()=>setFocused('inline')} onBlur={()=>setFocused(current=>current==='inline'?undefined:current)} accessibilityLabel="Message draft" multiline textAlignVertical="top" underlineColorAndroid="transparent" selectionColor={colors.accent} placeholder="Message Bob…" placeholderTextColor={colors.muted} value={value} onChangeText={onChangeText} scrollEnabled={contentHeight>limit} onContentSizeChange={event=>{const next=event.nativeEvent.contentSize.height;if(Number.isFinite(next)&&next>0)setContentHeight(next);}} style={[s.input,{height,maxHeight:limit},compact&&s.compactInput]}/>
  <Animated.View layout={composerTransition} testID="composer-controls" pointerEvents="box-none" style={[s.controls,compact&&s.compactControls]}>
   {leading}<View pointerEvents="none" style={{flex:1}}/>
   {!compact&&canExpand&&<Pressable accessibilityRole="button" accessibilityLabel="Expand message editor" onPress={()=>{input.current?.blur();setExpanded(true);}} style={s.expand}><Maximize2 size={20} color={colors.muted}/></Pressable>}
   {trailing}
  </Animated.View>
  {expanded&&<Modal visible animationType="slide" onShow={()=>fullInput.current?.focus()} onRequestClose={close}><SafeAreaView style={[s.editor,{paddingBottom:Math.max(0,keyboard-insets.bottom)}]}><View style={s.heading}><Text style={s.title}>Message</Text><Pressable accessibilityRole="button" accessibilityLabel="Collapse message editor" onPress={close} style={s.done}><Minimize2 size={19} color={colors.foreground}/><Text style={s.doneText}>Done</Text></Pressable></View><TextInput ref={fullInput} autoFocus caretHidden={focused!=='expanded'} onFocus={()=>setFocused('expanded')} onBlur={()=>setFocused(current=>current==='expanded'?undefined:current)} accessibilityLabel="Expanded message draft" multiline textAlignVertical="top" value={value} onChangeText={onChangeText} placeholder="Message Bob…" placeholderTextColor={colors.muted} style={s.expandedInput}/></SafeAreaView></Modal>}
 </Animated.View>;
}
const s=StyleSheet.create({input:{color:colors.foreground,backgroundColor:'transparent',fontSize:18,lineHeight:26,minHeight:48,paddingHorizontal:8,paddingVertical:10},compactInput:{marginHorizontal:44,fontSize:16,lineHeight:24,paddingVertical:12},compactControls:{position:'absolute',top:0,left:0,right:0,height:48,marginTop:0},controls:{flexDirection:'row',alignItems:'center',gap:8,minHeight:48,marginTop:4},expand:{width:48,height:48,borderRadius:24,alignItems:'center',justifyContent:'center'},editor:{flex:1,backgroundColor:colors.background},heading:{paddingHorizontal:20,paddingVertical:12,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},title:{color:colors.foreground,fontSize:21,fontWeight:'500'},done:{minHeight:48,paddingHorizontal:14,flexDirection:'row',alignItems:'center',gap:8,borderRadius:24,backgroundColor:colors.surface},doneText:{color:colors.foreground,fontSize:16},expandedInput:{flex:1,marginHorizontal:20,marginBottom:16,padding:16,borderRadius:20,backgroundColor:colors.composer,color:colors.foreground,fontSize:18,lineHeight:27}});
