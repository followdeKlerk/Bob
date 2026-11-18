import React from 'react';
import {ActivityIndicator,Pressable,View} from 'react-native';
import {Text} from './app-text';
import {useTheme} from '../theme';

/** Never offers re-pair/reset: an unreadable saved record is not an empty phone. */
export function StartupRecovery({error,onRetry,stage='workstations'}:{error?:string;onRetry:()=>void;stage?:'appearance'|'workstations'}){
 const {colors}=useTheme();
 return <View testID="startup-recovery" style={{flex:1,justifyContent:'center',padding:24,gap:16,backgroundColor:colors.background}}>
  {error?<>
   <Text accessibilityRole="header" style={{fontSize:22,lineHeight:30}}>Could not open {stage==='appearance'?'appearance':'saved workstations'}</Text>
   <Text accessibilityRole="alert" style={{fontSize:16,lineHeight:24}}>{error}</Text>
   <Pressable accessibilityRole="button" accessibilityLabel="Retry startup" onPress={onRetry} style={{minHeight:48,alignSelf:'flex-start',justifyContent:'center',paddingHorizontal:20,borderRadius:16,backgroundColor:colors.accent}}><Text style={{color:colors.onAccent,fontSize:16,lineHeight:24}}>Retry</Text></Pressable>
  </>:<><ActivityIndicator color={colors.accent} accessibilityLabel={stage==='appearance'?'Opening appearance':'Opening saved workstations'}/><Text style={{textAlign:'center',fontSize:16,lineHeight:24}}>Opening Bob…</Text></>}
 </View>;
}
