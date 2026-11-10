import React,{useState} from 'react';
import {Pressable,StyleSheet,View,useWindowDimensions} from 'react-native';
import {ArrowDown,ArrowLeft,ArrowRight,ArrowUp} from 'lucide-react-native';
import {Text} from './app-text';
import {menuButtonChrome} from '../menu-button-style';
import {themed,useThemedValue,useTheme} from '../theme';
import {terminalKeyLayout} from '../terminal';

type Props={ready:boolean;ctrl:boolean;onCtrl:()=>void;onInput:(value:string)=>void};
/** Terminal keys deliberately use native Pressable: shared Button's size classes
 * add directional padding that competes with these tightly measured key faces.
 * Numeric outer/inner widths avoid percentage measurement inside a flex row. */
export function TerminalKeyRow({ready,ctrl,onCtrl,onInput}:Props){
 const styles=useThemedValue(stylesTheme),{colors}=useTheme(),window=useWindowDimensions();
 const [width,setWidth]=useState(0);
 const {basis,faceHeight}=terminalKeyLayout(width||window.width,window.fontScale);
 const size={width:basis},faceSize={width:basis-4,minHeight:faceHeight};
 const keys:[string,string|React.ReactNode,string][]=[['Escape','Esc','\u001b'],['Tab','Tab','\t'],['Arrow up',<ArrowUp size={18} color={colors.foreground}/>,'\u001b[A'],['Arrow down',<ArrowDown size={18} color={colors.foreground}/>,'\u001b[B'],['Arrow left',<ArrowLeft size={18} color={colors.foreground}/>,'\u001b[D'],['Arrow right',<ArrowRight size={18} color={colors.foreground}/>,'\u001b[C']];
 return <View testID="terminal-key-row" onLayout={event=>{const w=event.nativeEvent.layout.width;if(Number.isFinite(w)&&w>0)setWidth(w);}} style={styles.keys}>
  <Pressable accessibilityRole="button" accessibilityLabel="Control key" accessibilityState={{selected:ctrl,disabled:!ready}} disabled={!ready} onPress={onCtrl} android_ripple={{color:colors.selectedSurface}} style={[styles.key,size,!ready&&styles.disabled]}><View pointerEvents="none" style={[styles.keyFace,faceSize,ctrl&&styles.selectedKey]}><Text typography="ui" numberOfLines={1} style={styles.keyText}>Ctrl</Text></View></Pressable>
  {keys.map(([label,content,value])=><Pressable key={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled:!ready}} disabled={!ready} onPress={()=>onInput(value)} android_ripple={{color:colors.selectedSurface}} style={[styles.key,size,!ready&&styles.disabled]}><View pointerEvents="none" style={[styles.keyFace,faceSize]}>{typeof content==='string'?<Text typography="ui" numberOfLines={1} style={styles.keyText}>{content}</Text>:content}</View></Pressable>)}
 </View>;
}
const stylesTheme=themed(theme=>{const {colors}=theme;return StyleSheet.create({
 keys:{flexDirection:'row',flexWrap:'wrap',justifyContent:'center',alignItems:'center',flexShrink:0,paddingHorizontal:8,paddingTop:4,columnGap:2,rowGap:4},
 key:{flexGrow:0,flexShrink:0,minHeight:48,paddingVertical:4,alignItems:'center',justifyContent:'center',borderRadius:10},
 keyFace:{minHeight:36,paddingHorizontal:2,paddingVertical:6,borderRadius:10,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,alignItems:'center',justifyContent:'center'},
 keyText:{fontSize:14,lineHeight:20,color:colors.foreground},selectedKey:menuButtonChrome(theme).selected,disabled:{opacity:0.4},
});});
