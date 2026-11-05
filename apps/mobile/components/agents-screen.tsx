import React from 'react';
import {View,ScrollView,Pressable,StyleSheet} from 'react-native';
import {Text} from './app-text';
import {themed,useThemedValue} from '../theme';
import {SectionHeading,SectionActions} from './section-ui';
export type AgentItem=[string,{conversationId:number;status?:string}];
/** A viewer only: selecting an agent never sends, starts or stops work. */
export function AgentsScreen({menu,agents,selected,onSelect,status,hasConversation,children,visible=true,history=false,historyCount=0,onHistoryChange}:{menu?:React.ReactNode;agents:AgentItem[];selected?:number;onSelect:(id:number)=>void;status:string;hasConversation:boolean;children:React.ReactNode;visible?:boolean;history?:boolean;historyCount?:number;onHistoryChange?:(value:boolean)=>void}){
 const s=useThemedValue(sTheme);

 return <View testID="agents-screen" pointerEvents={visible?'auto':'none'} accessibilityElementsHidden={!visible} importantForAccessibility={visible?'auto':'no-hide-descendants'} style={[s.screen,{opacity:visible?1:0}]}>
  <SectionHeading title="Agents" subtitle="This conversation · view only"/>
  <View style={s.body}>
  {!agents.length?<View style={s.empty}><Text style={s.message}>{!hasConversation?'Open a conversation to view its agents.':history?'No inactive agents.':'No active agents.'}</Text><Text style={s.caption}>{history?'Agent records and transcripts are retained.':historyCount?'View inactive agents in History.':'Agents will appear here when Bob delegates work.'}</Text></View>:<>
   <View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.selector} accessibilityRole="tablist">{agents.map(([name,agent])=><Pressable key={agent.conversationId} accessibilityRole="tab" accessibilityLabel={`View agent ${name}`} accessibilityState={{selected:selected===agent.conversationId}} onPress={()=>onSelect(agent.conversationId)} style={[s.agent,selected===agent.conversationId&&s.selected]}><Text style={s.name}>{name}</Text><Text style={s.caption}>{agent.status??'unknown'}</Text></Pressable>)}</ScrollView></View>
   {!!selected&&<><Text accessibilityLiveRegion="polite" style={s.status}>{status}</Text><View style={s.transcript}>{children}</View></>}
  </>}
  </View>
  <SectionActions menu={menu}>{(historyCount>0||history)&&onHistoryChange&&<Pressable accessibilityRole="switch" accessibilityLabel="Agent history" accessibilityState={{checked:history}} onPress={()=>onHistoryChange(!history)} style={[s.history,history&&s.historySelected]}><Text style={history?s.name:s.caption}>History</Text></Pressable>}</SectionActions>
 </View>;
}
const sTheme=themed(({colors,menuChrome})=>StyleSheet.create({screen:{position:'absolute',top:0,bottom:0,left:0,right:0,backgroundColor:colors.background,zIndex:25},history:{...menuChrome.control,minHeight:48,minWidth:64,paddingHorizontal:12,alignItems:'center',justifyContent:'center'},historySelected:{...menuChrome.selected},caption:{color:colors.muted,fontSize:12,lineHeight:18},selector:{paddingHorizontal:20,paddingBottom:8,gap:8},agent:{...menuChrome.control,minHeight:52,minWidth:96,maxWidth:240,paddingVertical:8,paddingHorizontal:12,gap:2,justifyContent:'center'},selected:{...menuChrome.selected},name:{color:colors.foreground,fontSize:14},status:{color:colors.muted,fontSize:12,lineHeight:18,paddingHorizontal:20,paddingVertical:4},body:{flex:1,minHeight:0},transcript:{flex:1,minHeight:0},empty:{flex:1,justifyContent:'center',padding:24,gap:8},message:{color:colors.foreground,fontSize:16,lineHeight:24}}));
