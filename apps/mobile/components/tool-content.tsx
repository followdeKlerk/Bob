import {APP_FONT_FAMILY} from '../typography';
import {Text} from './app-text';
import React,{useState} from 'react';
import {Pressable,StyleSheet,View} from 'react-native';
import {ChevronDown,ChevronRight,SquareTerminal} from 'lucide-react-native';
import {colors} from '../theme';
import {CopyAction} from './message-actions';
import {toolPresentation,toolResultPreview,toolText} from '../tool-presentation';
import type {LinkedResult} from '../tool-results';
function pretty(content:string){try{return JSON.stringify(JSON.parse(content),null,2);}catch{return content;}}

/** Useful collapsed previews; original arguments and full recorded output stay expandable. */
function Content({name,content,result,quiet=false}:{name:string;content:string;result?:LinkedResult;quiet?:boolean}){
 const [open,setOpen]=useState(false),[resultOpen,setResultOpen]=useState(false);
 const resultText=!open||result?.content===undefined?'Result not available yet.':toolText(result.content);
 const presentation=toolPresentation(name,content),preview=(!quiet||open)&&result?toolResultPreview(result.content,!!result.isError):undefined;
 return <View style={styles.card}>
  <Pressable accessibilityRole="button" accessibilityLabel={`Tool details: ${name}`} accessibilityState={{expanded:open}} accessibilityHint={quiet?[presentation.title,result?.isError?'Failed':result?.status].filter(Boolean).join('. '):undefined} onPress={()=>setOpen(!open)} style={styles.header}>
   <SquareTerminal size={18} color={result?.isError?colors.foreground:colors.muted}/>
   <View style={{flex:1,gap:3}}>
    <Text numberOfLines={1} style={styles.label}>{name}{result?` · ${result.isError?'failed':result.status}`:''}</Text>
    <Text numberOfLines={quiet?1:2} style={styles.summary}>{presentation.title}</Text>
   </View>
   {open?<ChevronDown size={18} color={colors.muted}/>:<ChevronRight size={18} color={colors.muted}/>}
  </Pressable>
  {!quiet&&!open&&(presentation.detail||presentation.command||preview||result?.isError)&&<View style={styles.preview}>
   {!!presentation.detail&&<Text numberOfLines={2} style={styles.path}>{presentation.detail}</Text>}
   {!!presentation.command&&<Text numberOfLines={3} style={styles.command}>{presentation.command}</Text>}
   {!!preview&&<View style={{gap:3}}><Text style={styles.label}>{result?.isError?'Error':'Result'}</Text><Text numberOfLines={2} style={[styles.output,result?.isError&&styles.error]}>{preview}</Text></View>}
   {result?.isError&&!preview&&<Text style={styles.error}>Tool failed — expand for details.</Text>}
  </View>}
  {open&&<View style={styles.details}>
   <View style={styles.row}><Text style={styles.label}>Arguments / content</Text><CopyAction text={content} label={`Copy tool content: ${name}`}/></View>
   <Text selectable style={styles.code}>{pretty(content)}</Text>
   {result&&<>
    <Pressable accessibilityRole="button" accessibilityLabel={`Tool result: ${name}`} accessibilityState={{expanded:resultOpen}} onPress={()=>setResultOpen(!resultOpen)} style={styles.resultButton}>
     <Text style={styles.summary}>{resultOpen?'Hide result':'Show full result'}</Text>
     {resultOpen?<ChevronDown size={18} color={colors.muted}/>:<ChevronRight size={18} color={colors.muted}/>}
    </Pressable>
    {resultOpen?<><CopyAction text={resultText} label={`Copy result: ${name}`}/><Text selectable style={styles.code}>{resultText}</Text></>:!!preview&&<Text numberOfLines={3} style={[styles.output,result.isError&&styles.error]}>{preview}</Text>}
   </>}
  </View>}
 </View>;
}
const styles=StyleSheet.create({
 card:{borderWidth:1,borderColor:colors.border,borderRadius:12,backgroundColor:colors.surface,overflow:'hidden'},
 header:{minHeight:60,flexDirection:'row',alignItems:'center',gap:10,padding:12},
 label:{color:colors.muted,fontSize:12,lineHeight:18,flexShrink:1},
 summary:{color:colors.body,fontSize:14,lineHeight:21,flexShrink:1},
 preview:{paddingHorizontal:12,paddingBottom:12,gap:10},
 path:{color:colors.muted,fontSize:12,lineHeight:18},
 command:{fontFamily:APP_FONT_FAMILY,color:colors.body,fontSize:13,lineHeight:20},
 output:{color:colors.muted,fontSize:13,lineHeight:20},
 details:{padding:12,paddingTop:0,gap:8},
 row:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
 code:{fontFamily:APP_FONT_FAMILY,color:colors.body,fontSize:13,lineHeight:20},
 resultButton:{minHeight:44,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
 error:{color:colors.foreground,fontSize:13,lineHeight:20},
});

export const ToolContent=React.memo(Content,(a,b)=>a.quiet===b.quiet&&a.name===b.name&&a.content===b.content&&a.result?.status===b.result?.status&&a.result?.isError===b.result?.isError&&a.result?.content===b.result?.content);
