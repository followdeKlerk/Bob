import React,{useState} from 'react';
import {Pressable,StyleSheet,View} from 'react-native';
import {Text} from './app-text';
import {colors} from '../theme';
import {CompactActivityRow} from './compact-activity-row';
import {CopyAction} from './message-actions';
import {toolPresentation} from '../tool-presentation';
import type {NestedToolActivity as Activity,NestedToolRow} from '../nested-tool-results';

function Branch({row,source}:{row:NestedToolRow;source:Activity['source']}){
 const [expanded,setExpanded]=useState(false);
 const presentation=row.args?toolPresentation(row.name,row.args):undefined;
 const hint=presentation?.command??presentation?.detail??row.args;
 return <View style={[styles.branch,{marginLeft:Math.min(row.depth,3)*8}]}>
  <CompactActivityRow title={row.name.replace(/^functions\./,'').replaceAll('_',' ')} detail={hint} status={row.status} accessibilityLabel={`Nested tool details: ${row.name} · ${row.id}`} expanded={expanded} onPress={()=>setExpanded(!expanded)}/>
  {expanded&&<View style={styles.details}>
   <Text style={styles.text}>{row.name} · {row.status}{row.durationMs===undefined?'':` · ${Math.round(row.durationMs)} ms`}</Text>
   {!!row.args&&<><View style={styles.caption}><Text style={styles.text}>Arguments excerpt</Text><CopyAction text={row.args} label={`Copy nested arguments: ${row.name}`}/></View><Text selectable style={styles.code}>{row.args}</Text></>}
   {!!row.preview&&<><Text style={styles.text}>{row.status==='error'?'Error excerpt':'Progress excerpt'}</Text><Text selectable style={styles.code}>{row.preview}</Text></>}
   <Text style={styles.text}>{source==='audit'?'Recorded status and argument/error excerpts; full nested results are not included.':'Live progress excerpts only; a done call does not include its full result.'}</Text>
  </View>}
 </View>;
}

/** Compact branches remain visible below their parent, independently of its script panel. */
export function NestedToolActivity({activity}:{activity:Activity}){
 const [all,setAll]=useState(false);
 const active=(row:NestedToolRow)=>['running','pending','error'].includes(row.status);
 const rows=all?activity.rows:[...activity.rows.filter(active),...activity.rows.filter(row=>!active(row))].slice(0,4);
 return <View style={styles.container}>
  {rows.map(row=><Branch key={`${activity.source}:${row.id}`} row={row} source={activity.source}/>)}
  {!all&&activity.total>rows.length&&<Pressable accessibilityRole="button" accessibilityLabel="More nested tool calls" accessibilityState={{expanded:false}} onPress={()=>setAll(true)} style={styles.more}><Text style={styles.text}>{activity.total-rows.length} more calls — show branches</Text></Pressable>}
  {all&&activity.total>rows.length&&<Text style={styles.text}>{activity.total-rows.length} more calls not shown ({activity.source==='live'?'latest':'first'} 50 display limit)</Text>}
  {all&&activity.rows.length>4&&<Pressable accessibilityRole="button" accessibilityLabel="Fewer nested tool calls" onPress={()=>setAll(false)} style={styles.more}><Text style={styles.text}>Show fewer branches</Text></Pressable>}
 </View>;
}
const styles=StyleSheet.create({
 container:{marginLeft:7,paddingLeft:13,borderLeftWidth:1,borderLeftColor:colors.border},
 branch:{minWidth:0},
 details:{paddingLeft:21,paddingBottom:10,gap:6},
 caption:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
 more:{minHeight:48,justifyContent:'center'},
 text:{color:colors.muted,fontSize:12,lineHeight:20},
 code:{color:colors.body,fontSize:12,lineHeight:20},
});
