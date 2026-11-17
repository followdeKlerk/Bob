import React from 'react';
import {ScrollView,StyleSheet,View} from 'react-native';
import {Text} from './app-text';
import {Button} from './ui/button';
import {themed,useThemedValue} from '../theme';

export const DRAFT_SAVE_WARNING='Draft could not be saved. Keep this conversation open and retry.';
export const DRAFT_LOAD_WARNING='Saved draft could not be loaded. It has not been overwritten.';
export type ComposerNotice={label:string;message:string};
/** Essential status replaces decoration, never stacks inside its fixed 48dp lane. */
export function ComposerStatusIndicator({notices,onOpen}:{notices:ComposerNotice[];onOpen:()=>void}){
 const s=useThemedValue(sTheme);
 return <Button variant="outline" testID="composer-status-indicator" accessibilityRole="button" accessibilityLabel={`${notices.map(item=>item.label).join('. ')}. Open composer recovery`} accessibilityHint={notices.map(item=>item.message).join(' ')} onPress={onOpen} style={s.indicator}><Text accessibilityLiveRegion="polite" numberOfLines={1} style={s.indicatorText}>{notices[0].label}{notices.length>1?` +${notices.length-1}`:''}</Text></Button>;
}
/** Parent owns safe-area/IME clearance exactly once. This is an in-tree overlay,
 * not a native Modal: opening/closing never blurs, dismisses or remounts the editor.
 * Only the warning body scrolls; scalable title and 48dp Retry/Close stay reachable. */
export function ComposerStatusRecovery({notices,retry,onClose,top,bottom}:{notices:ComposerNotice[];retry?:{label:string;onPress:()=>void};onClose:()=>void;top:number;bottom:number}){
 const s=useThemedValue(sTheme);
 return <View testID="composer-status-recovery" accessibilityViewIsModal style={[s.overlay,{top,bottom}]}>
  <View testID="composer-status-card" style={s.card}>
   <Text accessibilityRole="header" numberOfLines={2} style={s.title}>Composer recovery</Text>
   <ScrollView testID="composer-status-body" style={{flexShrink:1,flexGrow:0,minHeight:0}} contentContainerStyle={{gap:12}} keyboardShouldPersistTaps="always" keyboardDismissMode="none">{notices.map(item=><Text key={item.label} accessibilityLiveRegion="polite" style={s.message}>{item.message}</Text>)}</ScrollView>
   <View testID="composer-status-actions" style={s.actions}>
    {retry&&<Button variant="outline" accessibilityRole="button" accessibilityLabel={retry.label} onPress={retry.onPress} style={s.action}><Text style={s.actionText}>Retry</Text></Button>}
    <Button variant="outline" accessibilityRole="button" accessibilityLabel="Close composer recovery" onPress={onClose} style={s.action}><Text style={s.actionText}>Close</Text></Button>
   </View>
  </View>
 </View>;
}
const sTheme=themed(({colors})=>StyleSheet.create({
 indicator:{alignSelf:'flex-start',maxWidth:'100%',minHeight:48,minWidth:48,paddingHorizontal:8,paddingVertical:4,borderRadius:24,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border},
 indicatorText:{fontSize:13,lineHeight:18,color:colors.foreground},
 overlay:{position:'absolute',left:0,right:0,zIndex:50,backgroundColor:colors.background,padding:12,justifyContent:'center'},
 card:{maxHeight:'100%',padding:16,gap:12,borderRadius:24,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border},
 title:{fontSize:18,lineHeight:24,color:colors.foreground,flexShrink:0},
 message:{fontSize:14,lineHeight:20,color:colors.foreground},
 actions:{flexDirection:'row',gap:8,flexShrink:0},
 action:{flex:1,minWidth:48,minHeight:48,padding:8,borderRadius:24,borderWidth:1,borderColor:colors.border,backgroundColor:colors.background},
 actionText:{fontSize:14,lineHeight:20,color:colors.foreground},
}));
