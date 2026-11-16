import React,{useRef} from 'react';
import {AccessibilityInfo,findNodeHandle,Modal,Pressable,ScrollView,StyleSheet,View,useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Text} from './app-text';
import {themed,useThemedValue} from '../theme';

/** A native modal isolates TalkBack and Back handling without touching the chat
 * tree, keyboard, draft focus or scroll position. Only its content scrolls. */
export function UpdatePopover({visible,status,children,onClose,keyboardInset=0}:{visible:boolean;status:string;children:React.ReactNode;onClose:()=>void;keyboardInset?:number}){
 const s=useThemedValue(styles),insets=useSafeAreaInsets(),window=useWindowDimensions();
 const heading=useRef<React.ComponentRef<typeof Text>>(null);
 const bottom=Math.max(insets.bottom,keyboardInset)+12;
 const available=Math.max(0,window.height-insets.top-bottom);
 const top=insets.top+Math.min(52,Math.max(0,available-96));
 return <Modal transparent visible={visible} animationType="none" onRequestClose={onClose} onShow={()=>{const node=findNodeHandle(heading.current);if(node)AccessibilityInfo.setAccessibilityFocus(node);}}>
  <View style={[s.overlay,{paddingTop:top,paddingBottom:bottom,paddingLeft:insets.left+12,paddingRight:insets.right+12}]}>
   <Pressable accessibilityRole="button" accessibilityLabel="Close update bubble" onPress={onClose} style={StyleSheet.absoluteFill}/>
   <View testID="update-popover" accessibilityViewIsModal onAccessibilityEscape={onClose} style={[s.bubble,{maxWidth:Math.min(304,window.width-insets.left-insets.right-24),maxHeight:Math.max(0,window.height-top-bottom)}]}>
    <ScrollView style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="always" showsVerticalScrollIndicator>
     <Text ref={heading} accessible accessibilityLiveRegion="polite" style={s.status}>{status}</Text>
     {children}
     <Pressable accessibilityRole="button" accessibilityLabel="Close updates" onPress={onClose} style={s.close}><Text style={s.text}>Close</Text></Pressable>
    </ScrollView>
   </View>
  </View>
 </Modal>;
}
const styles=themed(({colors,shadows})=>StyleSheet.create({
 overlay:{flex:1,alignItems:'flex-end'},
 bubble:{...shadows.popup,flexShrink:1,width:304,borderRadius:20,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,overflow:'hidden'},
 scroll:{flexGrow:0,flexShrink:1,minHeight:0},content:{padding:16,gap:12},
 status:{fontSize:15,lineHeight:23,fontWeight:'600',color:colors.foreground},text:{fontSize:14,lineHeight:22,color:colors.body},
 close:{minHeight:48,justifyContent:'center',alignItems:'center'},
}));
