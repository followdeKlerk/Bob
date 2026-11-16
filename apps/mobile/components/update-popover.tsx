import React,{useRef,useState} from 'react';
import {AccessibilityInfo,findNodeHandle,Modal,Pressable,ScrollView,StyleSheet,View,useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Text} from './app-text';
import {themed,useThemedValue} from '../theme';

/** The dialog owns Back/accessibility isolation, not the underlying chat tree.
 * Measure its viewport: Android Modal can resize for the IME even when the
 * Activity does not. Reserve only keyboard occlusion not already removed. */
export function UpdatePopover({visible,status,children,onClose,keyboardInset=0,acknowledge}:{visible:boolean;status:string;children:React.ReactNode;onClose:()=>void;keyboardInset?:number;acknowledge?:{label:string;onPress:()=>void}}){
 const s=useThemedValue(styles),insets=useSafeAreaInsets(),window=useWindowDimensions();
 const heading=useRef<React.ComponentRef<typeof Text>>(null);
 const [viewport,setViewport]=useState<{width:number;height:number}>();
 const width=Math.min(window.width,viewport?.width??window.width),height=Math.min(window.height,viewport?.height??window.height);
 const occlusion=Math.max(0,keyboardInset-Math.max(0,window.height-height));
 const bottom=Math.max(insets.bottom,occlusion)+12;
 const available=Math.max(0,height-insets.top-bottom);
 const top=insets.top+Math.min(52,Math.max(0,available-96));
 return <Modal transparent statusBarTranslucent navigationBarTranslucent visible={visible} animationType="none" onRequestClose={onClose} onShow={()=>{const node=findNodeHandle(heading.current);if(node)AccessibilityInfo.setAccessibilityFocus(node);}}>
  <View testID="update-popover-viewport" onLayout={({nativeEvent:{layout}})=>{if(layout.width>0&&layout.height>0)setViewport(old=>old?.width===layout.width&&old.height===layout.height?old:{width:layout.width,height:layout.height});}} style={[s.overlay,{paddingTop:top,paddingBottom:bottom,paddingLeft:insets.left+12,paddingRight:insets.right+12}]}>
   <Pressable accessibilityRole="button" accessibilityLabel="Close update bubble" onPress={onClose} style={StyleSheet.absoluteFill}/>
   <View testID="update-popover" accessibilityViewIsModal onAccessibilityEscape={onClose} style={[s.bubble,{maxWidth:Math.max(0,Math.min(304,width-insets.left-insets.right-24)),maxHeight:Math.max(0,height-top-bottom)}]}>
    <ScrollView style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="always" showsVerticalScrollIndicator>
     <Text ref={heading} accessible accessibilityLiveRegion="polite" style={s.status}>{status}</Text>
     {children}
     <Pressable accessibilityRole="button" accessibilityLabel={acknowledge?.label??'Close updates'} onPress={acknowledge?.onPress??onClose} style={s.close}><Text style={s.text}>{acknowledge?'Done':'Close'}</Text></Pressable>
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
