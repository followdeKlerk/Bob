import React,{useState} from 'react';
import {Pressable,StyleSheet,View} from 'react-native';
import {Text} from './app-text';
import {colors} from '../theme';
import type {NestedToolActivity as Activity} from '../nested-tool-results';

/** Bounded excerpts only: audit rows are not full nested tool results. */
export function NestedToolActivity({activity}:{activity:Activity}){
 const [expanded,setExpanded]=useState(false);
 const active=(status:string)=>status==='running'||status==='pending'||status==='error';
 const rows=expanded?activity.rows:[...activity.rows.filter(row=>active(row.status)),...activity.rows.filter(row=>!active(row.status))].slice(0,4);
 return <View style={styles.container}>
  <Pressable accessibilityRole="button" accessibilityLabel="Nested tool activity" accessibilityState={{expanded}} onPress={()=>setExpanded(!expanded)} style={styles.toggle}>
   <Text style={styles.label}>{activity.source==='audit'?'Nested call audit':'Nested tools'} · {activity.total}{expanded?' · Less':' · Details'}</Text>
  </Pressable>
  {rows.map(row=><View key={row.id} style={[styles.row,{marginLeft:Math.min(row.depth,3)*10}]}>
   <Text numberOfLines={2} style={styles.name}>{row.name} · {row.status}{row.durationMs===undefined?'':` · ${Math.round(row.durationMs)} ms`}</Text>
   {!!row.preview&&<Text selectable numberOfLines={expanded?5:2} style={styles.text}>{row.preview}</Text>}
   {expanded&&!!row.args&&<Text selectable numberOfLines={5} style={styles.text}>Arguments: {row.args}</Text>}
  </View>)}
  {activity.total>rows.length&&<Text style={styles.text}>{activity.total-rows.length} more calls{expanded?` not shown (${activity.source==='live'?'latest':'first'} 50 display limit)`:' — expand for details'}.</Text>}
  {expanded&&<Text style={styles.text}>{activity.source==='audit'?'Recorded status and argument/error excerpts; full nested results are not included.':'Live progress excerpts only; a done call does not include its full result.'}</Text>}
 </View>;
}
const styles=StyleSheet.create({
 container:{paddingHorizontal:12,paddingBottom:12,gap:6},
 toggle:{minHeight:44,justifyContent:'center'},
 label:{color:colors.muted,fontSize:12,lineHeight:20},
 row:{borderLeftWidth:1,borderLeftColor:colors.border,paddingLeft:10,gap:2},
 name:{color:colors.body,fontSize:12,lineHeight:20},
 text:{color:colors.muted,fontSize:12,lineHeight:20},
});
