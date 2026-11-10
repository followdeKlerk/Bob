import React,{useContext} from 'react';
import {StyleSheet,View,type StyleProp,type ViewStyle} from 'react-native';
import {themed,useThemedValue} from '../theme';
import {ThemeContext} from '../theme-context';

/** Presentation only. Activity and rich surfaces retain the transcript's full width. */
export function ChatBubble({variant='assistant',wide=false,children,style,testID}:{variant?:'owner'|'assistant'|'activity'|'upload';wide?:boolean;children:React.ReactNode;style?:StyleProp<ViewStyle>;testID?:string}){
 const styles=useThemedValue(bubbleTheme),parentTheme=useContext(ThemeContext),contentTheme=useThemedValue(bubbleContentTheme);
 return <ThemeContext.Provider value={variant==='owner'||variant==='assistant'?contentTheme:parentTheme}><View testID={testID??`chat-bubble-${variant}`} style={[styles.base,styles[variant],wide&&variant==='assistant'&&styles.wide,style]}>{children}</View></ThemeContext.Provider>;
}

// Stronger secondary ink is scoped to filled bubbles, leaving other UI unchanged.
const bubbleContentTheme=themed(theme=>({...theme,colors:{...theme.colors,muted:theme.colors.bubbleMuted}}));

// Code and tables need the reading column, not a messenger's narrow text width.
export function needsWideBubble(text:string):boolean {
 return /^(?:\s{0,3}(?:`{3,}|~{3,})|\s*\|.*\|\s*$|\s*:?[-]{3,}[- :|]*\|)/m.test(text);
}
const bubbleTheme=themed(({colors})=>StyleSheet.create({
 base:{minWidth:0},
 owner:{alignSelf:'flex-end',maxWidth:'90%',paddingHorizontal:16,paddingVertical:12,borderRadius:20,borderBottomRightRadius:6,backgroundColor:colors.ownerBubble},
 assistant:{alignSelf:'stretch',marginRight:12,paddingHorizontal:14,paddingVertical:12,borderRadius:20,borderBottomLeftRadius:6,backgroundColor:colors.assistantBubble},
 wide:{marginRight:0},
 activity:{alignSelf:'stretch'},
 upload:{alignSelf:'flex-end',maxWidth:'100%'},
}));
