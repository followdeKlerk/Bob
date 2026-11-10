import {ActivityDisclosure} from './activity-disclosure';
import {APP_MONO_FONT_FAMILY} from '../typography';
import {Text} from './app-text';
import React,{useState} from 'react';
import {Pressable,StyleSheet,View} from 'react-native';
import {ChevronDown,ChevronRight} from 'lucide-react-native';
import {themed,useTheme,useThemedValue} from '../theme';
import {CopyAction} from './message-actions';
import {toolPresentation,toolResultPreview,toolText} from '../tool-presentation';
import type {LinkedResult} from '../tool-results';
import {NestedToolActivity} from './nested-tool-activity';
import {CompactActivityRow} from './compact-activity-row';
function pretty(content:string){try{return JSON.stringify(JSON.parse(content),null,2);}catch{return content;}}

/** Compact single-line activity; original arguments and recorded output stay expandable. */
function Content({name,content,result}:{name:string;content:string;result?:LinkedResult;quiet?:boolean}){
 const {colors}=useTheme();
 const styles=useThemedValue(stylesTheme);

 const [open,setOpen]=useState(false),[resultOpen,setResultOpen]=useState(false);
 const resultText=!open||result?.content===undefined?'Result not available yet.':toolText(result.content);
 const presentation=toolPresentation(name,content),preview=open&&result?toolResultPreview(result.content,!!result.isError):undefined;
 const failed=!!result?.isError||['failed','error'].includes(result?.status??'');
 const status=failed?'Failed':result?.status==='done'?'Completed':result?.status??'Status unavailable';
 const hint=presentation.command??presentation.detail;
 return <View style={styles.card}>
  <CompactActivityRow title={presentation.title==='Tool output'?name.replace(/^functions\./,'').replaceAll('_',' '):presentation.title} detail={hint} status={status} count={result?.nested?.total} accessibilityLabel={`Tool details: ${name}`} expanded={open} onPress={()=>setOpen(!open)}/>
  {result?.nested&&<NestedToolActivity activity={result.nested}/>}
  {open&&<ActivityDisclosure style={styles.details}>
   <Text style={styles.label}>{name} · {status}</Text>
   <View style={styles.row}><Text style={styles.label}>Arguments / content</Text><CopyAction text={content} label={`Copy tool content: ${name}`}/></View>
   <Text typography="mono" selectable style={styles.code}>{pretty(content)}</Text>
   {result&&<>
    <Pressable accessibilityRole="button" accessibilityLabel={`Tool result: ${name}`} accessibilityState={{expanded:resultOpen}} onPress={()=>setResultOpen(!resultOpen)} style={styles.resultButton}>
     <Text style={styles.summary}>{resultOpen?'Hide result':'Show full result'}</Text>
     {resultOpen?<ChevronDown size={18} color={colors.muted}/>:<ChevronRight size={18} color={colors.muted}/>}
    </Pressable>
    {resultOpen?<><CopyAction text={resultText} label={`Copy result: ${name}`}/><Text typography="mono" selectable style={styles.code}>{resultText}</Text></>:!!preview&&<Text numberOfLines={3} style={[styles.output,result.isError&&styles.error]}>{preview}</Text>}
   </>}
  </ActivityDisclosure>}
 </View>;
}
const stylesTheme=themed(({colors,menuChrome})=>StyleSheet.create({
 card:{minWidth:0},
 label:{color:colors.muted,fontSize:11,lineHeight:18,flexShrink:1},
 summary:{color:colors.body,fontSize:13,lineHeight:21,flexShrink:1},
 output:{color:colors.muted,fontSize:12,lineHeight:20},
 details:{paddingLeft:21,paddingBottom:10,gap:8},
 row:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
 code:{fontFamily:APP_MONO_FONT_FAMILY,color:colors.body,fontSize:12,lineHeight:20},
 resultButton:{minHeight:44,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
 error:{color:colors.foreground,fontSize:12,lineHeight:20},
}));

export const ToolContent=React.memo(Content,(a,b)=>a.quiet===b.quiet&&a.name===b.name&&a.content===b.content&&a.result?.status===b.result?.status&&a.result?.isError===b.result?.isError&&a.result?.content===b.result?.content&&a.result?.nested===b.result?.nested);
