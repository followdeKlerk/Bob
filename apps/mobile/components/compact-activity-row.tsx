import React from 'react';
import {Pressable,StyleSheet,View} from 'react-native';
import {ChevronDown,ChevronRight,SquareTerminal} from 'lucide-react-native';
import {Text} from './app-text';
import {themed,useTheme,useThemedValue} from '../theme';

export type CompactActivityRowProps={
 title:string;
 detail?:string;
 status?:string;
 accessibilityLabel:string;
 expanded:boolean;
 onPress:()=>void;
 count?:number;
};

/** Only known terminal success states get a check. Missing/unknown is not success. */
export function activityStatusGlyph(status?:string):string {
 switch(status?.toLowerCase()){
  case 'done':case 'ok':case 'completed':return '✓';
  case 'failed':case 'error':return '!';
  case 'running':case 'pending':case 'queued':case 'processing':return '…';
  default:return '·';
 }
}

/** Shared compact header only: the caller owns expansion state and full content. */
export function CompactActivityRow({title,detail,status,accessibilityLabel,expanded,onPress,count}:CompactActivityRowProps){
 const {colors}=useTheme();
 const styles=useThemedValue(stylesTheme);

 const statusLabel=status??'Status unavailable';
 const hint=[detail,statusLabel,count===undefined?undefined:`${count} calls`,expanded?'Collapse details':'Expand details'].filter(Boolean).join(' · ');
 return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityHint={hint} accessibilityState={{expanded}} onPress={onPress} style={styles.row}>
  <SquareTerminal size={15} color={colors.muted}/>
  <Text numberOfLines={1} ellipsizeMode="tail" style={styles.title}>{title}</Text>
  {!!detail&&<Text numberOfLines={1} ellipsizeMode="tail" style={styles.detail}>{detail}</Text>}
  {count!==undefined&&<Text style={styles.count}>{count}</Text>}
  <View testID="activity-status-symbol" style={styles.symbol}><Text accessibilityLabel={statusLabel} style={styles.status}>{activityStatusGlyph(status)}</Text></View>
  {expanded?<ChevronDown size={15} color={colors.muted}/>:<ChevronRight size={15} color={colors.muted}/>}
 </Pressable>;
}

const stylesTheme=themed(({colors})=>StyleSheet.create({
 row:{minHeight:48,paddingVertical:6,flexDirection:'row',alignItems:'center',gap:6},
 title:{color:colors.foreground,fontSize:12,lineHeight:18,fontWeight:'600',flexShrink:1},
 detail:{color:colors.muted,fontSize:12,lineHeight:18,flex:1,minWidth:0},
 count:{color:colors.muted,fontSize:12,lineHeight:18,marginLeft:'auto'},
 symbol:{minWidth:18,minHeight:24,marginLeft:'auto',alignItems:'center',justifyContent:'center'},
 status:{color:colors.foreground,fontSize:12,lineHeight:18},
}));
