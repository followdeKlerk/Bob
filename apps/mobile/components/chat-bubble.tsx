import React from 'react';
import {StyleSheet,View,type StyleProp,type ViewStyle} from 'react-native';
import {themed,useThemedValue} from '../theme';

/** Presentation only. Activity and rich surfaces retain the transcript's full width. */
export function ChatBubble({variant='assistant',wide=false,children,style,testID}:{variant?:'owner'|'assistant'|'activity'|'upload';wide?:boolean;children:React.ReactNode;style?:StyleProp<ViewStyle>;testID?:string}){
 const styles=useThemedValue(bubbleTheme);
 return <View testID={testID??`chat-bubble-${variant}`} style={[styles.base,styles[variant],wide&&variant==='assistant'&&styles.wide,style]}>{children}</View>;
}

// Code and tables need the reading column, not a messenger's narrow text width.
export function needsWideBubble(text:string):boolean {
 return /^(?:\s{0,3}(?:`{3,}|~{3,})|\s*\|.*\|\s*$|\s*:?[-]{3,}[- :|]*\|)/m.test(text);
}
const bubbleTheme=themed(({colors})=>StyleSheet.create({
 base:{minWidth:0},
 owner:{alignSelf:'flex-end',maxWidth:'90%',paddingHorizontal:16,paddingVertical:12,borderRadius:20,borderBottomRightRadius:6,backgroundColor:colors.selectedSurface},
 assistant:{alignSelf:'stretch',marginRight:12,paddingHorizontal:14,paddingVertical:12,borderRadius:20,borderBottomLeftRadius:6,backgroundColor:colors.assistantBubble},
 wide:{marginRight:0},
 activity:{alignSelf:'stretch'},
 upload:{alignSelf:'flex-end',maxWidth:'100%'},
}));
