import React,{useState} from 'react';
import {StyleSheet,View} from 'react-native';
import {CompactActivityRow} from './compact-activity-row';
import {Text} from './app-text';
import {memoryStatusText,learningStatusText,inputAttribution} from '../chat-presentation';
import type {ToolEntry} from '../tool-results';
import {themed,useThemedValue} from '../theme';

function PassiveActivity({title,detail,status,accessibilityLabel,children}:{title:string;detail?:string;status:string;accessibilityLabel:string;children:React.ReactNode}){
 const styles=useThemedValue(stylesTheme);

 const [expanded,setExpanded]=useState(false);
 return <View>
  <CompactActivityRow title={title} detail={detail} status={status} accessibilityLabel={accessibilityLabel} expanded={expanded} onPress={()=>setExpanded(!expanded)}/>
  {expanded&&<View style={styles.details}>{children}</View>}
 </View>;
}

/** Backend metadata stays literal, never model content or supplied status text. */
export function HindsightActivity({entry}:{entry:ToolEntry}){
 const styles=useThemedValue(stylesTheme);

 const label=memoryStatusText(entry);
 if(label===undefined)return null;
 const {phase,count,receiptKey}=entry.data as {phase:string;count?:number;receiptKey?:unknown};
 const metadata={label,phase,...(count===undefined?{}:{count}),...(typeof receiptKey==='string'&&receiptKey.length>0&&receiptKey.length<=256?{receiptKey}:{})};
 const status=phase==='recall'||phase==='save-completed'?'completed':phase==='save-queued'?'queued':phase==='save-processing'?'processing':phase==='save-failed'?'failed':phase==='save-cancelled'?'cancelled':'saved with warnings';
 return <PassiveActivity title="Hindsight" detail={label.slice('Hindsight — '.length)} status={status} accessibilityLabel={label}>
  <Text selectable style={styles.metadata}>{JSON.stringify(metadata,null,2)}</Text>
 </PassiveActivity>;
}

/** A committed learning receipt is passive activity, not a new model/tool message. */
export function LearningActivity({entry}:{entry:ToolEntry}){
 const styles=useThemedValue(stylesTheme);
 const text=learningStatusText(entry);
 if(text===undefined)return null;
 const data=entry.data as {origin?:unknown;status:'completed'|'failed'|'cancelled'};
 const title=data.origin==='skill-update'?'Skill update':'Learning review';
 // The collapsed hint is only a literal excerpt. Status always comes from the receipt.
 const detail=text.replace(/^(?:💾|⚠️)\s*/u,'').replace(/^(?:Skill update|Self-improvement review):?\s*/,'').replace(/\s+/g,' ').trim().slice(0,240);
 return <PassiveActivity title={title} detail={detail} status={data.status} accessibilityLabel={`${title} · ${data.status}`}>
  <Text selectable style={styles.metadata}>{text}</Text>
 </PassiveActivity>;
}

/** Only explicit provenance metadata names the agent. Keep the original body/actions. */
export function AgentReportActivity({entry,children}:{entry:ToolEntry;children:React.ReactNode}){
 if(entry.kind!=='bob.subagent-report')return null;
 const name=(entry.data as {name?:unknown}|undefined)?.name;
 // A received report proves delivery, not successful completion of the agent's task.
 return <PassiveActivity title="Agent report" detail={typeof name==='string'&&name?name:undefined} status="received" accessibilityLabel={inputAttribution(entry).label!}>{children}</PassiveActivity>;
}

const stylesTheme=themed(({colors,menuChrome})=>StyleSheet.create({
 details:{paddingLeft:21,paddingBottom:10,gap:6},
 metadata:{color:colors.body,fontSize:12,lineHeight:20},
}));
