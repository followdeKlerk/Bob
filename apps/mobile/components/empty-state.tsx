import React from 'react';
import {StyleSheet,View} from 'react-native';
import type {LucideIcon} from 'lucide-react-native';
import {Text} from './app-text';
import {themed,useTheme,useThemedValue} from '../theme';

/** A quiet, scalable empty state. Actions remain explicit and never run on mount. */
export function EmptyState({icon:Icon,title,description,children}:{icon:LucideIcon;title:string;description:string;children?:React.ReactNode}){
 const {colors}=useTheme(),s=useThemedValue(styles);
 return <View testID="empty-state" style={s.root}>
  <View accessible={false} importantForAccessibility="no-hide-descendants" style={s.emblem}><Icon size={30} strokeWidth={1.5} color={colors.muted}/></View>
  <Text typography="ui" accessibilityRole="header" style={s.title}>{title}</Text>
  <Text typography="ui" style={s.description}>{description}</Text>
  {!!children&&<View style={s.action}>{children}</View>}
 </View>;
}
const styles=themed(({colors})=>StyleSheet.create({
 root:{alignItems:'center',paddingHorizontal:12,paddingTop:36,paddingBottom:28,gap:12},
 emblem:{width:72,height:72,borderRadius:26,backgroundColor:colors.panel,alignItems:'center',justifyContent:'center',marginBottom:8},
 title:{color:colors.foreground,fontSize:22,lineHeight:30,fontWeight:'600',textAlign:'center'},
 description:{color:colors.muted,fontSize:15,lineHeight:23,textAlign:'center',maxWidth:360},
 action:{marginTop:8,maxWidth:'100%',alignItems:'center'},
}));
