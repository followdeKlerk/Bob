import React from 'react';
import {StyleSheet,View} from 'react-native';
import {Text} from './app-text';
import {themed,useThemedValue} from '../theme';
import {terminalHostname} from '../terminal';

/** Keep one compact orientation row mounted across IME and theme changes. */
export function TerminalHeader({workstation}:{workstation?:string}){
 const styles=useThemedValue(stylesTheme);
 return <View testID="terminal-header" style={styles.header}>
  <Text typography="ui" accessibilityRole="header" style={styles.title}>Terminal</Text>
  {!!workstation&&<Text typography="ui" numberOfLines={1} ellipsizeMode="middle" accessibilityLabel={workstation} style={styles.host}>{terminalHostname(workstation)}</Text>}
 </View>;
}
const stylesTheme=themed(({colors})=>StyleSheet.create({
 header:{paddingHorizontal:16,paddingTop:10,paddingBottom:8,flexDirection:'row',flexWrap:'wrap',alignItems:'baseline',columnGap:12,rowGap:2,flexShrink:0},
 title:{fontSize:18,lineHeight:26,fontWeight:'500',color:colors.foreground},
 host:{fontSize:13,lineHeight:20,color:colors.muted,flexShrink:1,minWidth:0},
}));
