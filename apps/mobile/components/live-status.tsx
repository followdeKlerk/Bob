import React from 'react';
import {StyleSheet,View} from 'react-native';
import {Text} from './app-text';
import {themed,useThemedValue} from '../theme';
import {liveStatuses} from '../live-status';

export function LiveStatus({live,showProgress=true}:{live:unknown;showProgress?:boolean}){
 const styles=useThemedValue(stylesTheme);

 const statuses=liveStatuses(live,showProgress);
 if(!statuses.length)return null;
 return <View testID="native-run-status" style={styles.stack}>{statuses.map(status=><View key={status.key} style={styles.row}>
  <Text accessibilityLiveRegion="polite" style={styles.text}>{status.text}</Text>
 </View>)}</View>;
}
const stylesTheme=themed(({colors,menuChrome})=>StyleSheet.create({stack:{gap:8},row:{...menuChrome.control,padding:12},text:{color:colors.foreground,fontSize:13,lineHeight:20}}));
