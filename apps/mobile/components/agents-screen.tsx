import {PageSearch} from './page-search';
import {menuButtonChrome} from '../menu-button-style';
import React,{useEffect,useMemo,useState} from 'react';
import {View,FlatList,Pressable,StyleSheet,ActivityIndicator,Keyboard,Modal,ScrollView} from 'react-native';
import {ChevronRight,ChevronDown,ArrowLeft,Pin,Plus,Ellipsis,Clock3,Check} from 'lucide-react-native';
import {Text} from './app-text';
import {themed,useTheme,useThemedValue} from '../theme';
import {EdgeFade} from './edge-fade';
import {SectionActions,RoundAction,SECTION_HEADING_TOP} from './section-ui';
import {SessionActions} from './session-actions';
import {SafeAreaView} from 'react-native-safe-area-context';
const FILTERS=[{value:'all',text:'Active'},{value:'archived',text:'Archived'},{value:'trash',text:'Trash'}] as const;
import type {SessionAction} from './side-drawer';
import type {AgentSession,AgentStatus,OverviewAgent,SessionFilter} from '../use-agent-overview';
type TreeRow={kind:'session';session:AgentSession;closed:boolean}|{kind:'agent';session:AgentSession;agent:OverviewAgent;last:boolean};
const active=(status:AgentStatus)=>status==='working'||status==='stopping';
const label=(status:AgentStatus)=>({working:'Running',stopping:'Stopping',idle:'Idle',unknown:'Status unavailable'}[status]);
type Props={menu?:React.ReactNode;sessions:AgentSession[];currentSessionId?:number;selected?:{parentId:number;agent:OverviewAgent;title:string};onSelect:(parentId:number,id:number)=>void;onOpenSession:(id:number)=>void;onBack:()=>void;status:string;children:React.ReactNode|((clearance:number)=>React.ReactNode);visible?:boolean;bottomInset?:number;history?:boolean;onHistoryChange:(value:boolean)=>void;workstation?:string;loading?:boolean;error?:string;onRetry?:()=>void;hasMore?:boolean;onLoadMore?:()=>void;onNew?:()=>void;newBusy?:boolean;onSchedules?:()=>void;filter?:SessionFilter;onFilterChange?:(filter:SessionFilter)=>void;onSessionAction?:(id:string,action:SessionAction,title?:string)=>Promise<void>};
/** Conversation-first presentation only. Membership/status remain server-authoritative. */
export function AgentsScreen({menu,sessions,currentSessionId,selected,onSelect,onOpenSession,onBack,status,children,visible=true,bottomInset=0,history=false,loading=false,error,onRetry,hasMore,onLoadMore,onNew,newBusy=false,onSchedules,filter='all',onFilterChange,onSessionAction}:Props){
 const s=useThemedValue(sTheme),{colors}=useTheme();
 const [actionSession,setActionSession]=useState<AgentSession>(),[filterOpen,setFilterOpen]=useState(false);
 useEffect(()=>{if(!visible){setActionSession(undefined);setFilterOpen(false);}if(selected||!onFilterChange)setFilterOpen(false);},[visible,selected,onFilterChange]);
 const [query,setQuery]=useState(''),[expanded,setExpanded]=useState<ReadonlyMap<number,boolean>>(new Map());
 useEffect(()=>{setExpanded(new Map());},[query,history]);
 const rows=useMemo(()=>{
  const term=query.trim().toLowerCase();
  return sessions.map(session=>({...session,agents:session.agents.filter(agent=>!term||session.title.toLowerCase().includes(term)||String(session.conversationId).includes(term)||agent.name.toLowerCase().includes(term))}))
   .filter(session=>!term||session.title.toLowerCase().includes(term)||String(session.conversationId).includes(term)||session.agents.length>0)
   .sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||Number(active(b.status)||b.agents.some(agent=>active(agent.status)))-Number(active(a.status)||a.agents.some(agent=>active(agent.status))));
 },[sessions,query]);
 const treeRows=useMemo(()=>rows.flatMap(session=>{
  const closed=!(expanded.get(session.conversationId)??Boolean(query||history));
  const entries:TreeRow[]=[{kind:'session',session,closed}];
  if(!closed)session.agents.forEach((agent,index)=>entries.push({kind:'agent',session,agent,last:index===session.agents.length-1}));
  return entries;
 }),[rows,expanded,query,history]);
 const toggle=(id:number,closed:boolean)=>setExpanded(previous=>new Map(previous).set(id,closed));
 const state=(value:AgentStatus)=><View accessibilityLabel={`Session status: ${label(value)}`} style={s.state}><View accessible={false} style={[s.dot,{backgroundColor:active(value)?colors.accent:colors.muted}]}/><Text typography="ui" style={s.statusText}>{label(value)}</Text></View>;
 const action=(name:string,text:string,onPress:()=>void,disabled=false,primary=false)=><Pressable accessibilityRole="button" accessibilityLabel={name} accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={[s.action,primary&&s.primary,disabled&&{opacity:.45}]}>{primary&&<Plus size={19} color={colors.foreground}/>}<Text typography="ui" style={[s.actionText,primary&&{fontWeight:'600'}]}>{text}</Text></Pressable>;
 return <View testID="agents-screen" pointerEvents={visible?'auto':'none'} accessibilityElementsHidden={!visible} importantForAccessibility={visible?'auto':'no-hide-descendants'} style={[s.screen,{opacity:visible?1:0,bottom:bottomInset}]}>
  <View testID="agent-screen-content" style={s.body} accessibilityElementsHidden={!!actionSession||filterOpen} importantForAccessibility={actionSession||filterOpen?'no-hide-descendants':'auto'}>
   <View testID="sessions-heading" style={s.heading}><Text typography="ui" accessibilityRole="header" style={s.headingText}>{selected?selected.agent.name:'Sessions'}</Text>{selected&&<Text typography="ui" style={s.context}>{`${selected.title} · View only`}</Text>}</View>
   <View style={s.body}>
    <View testID="sessions-list-content" pointerEvents={selected?'none':'auto'} accessibilityElementsHidden={!!selected} importantForAccessibility={selected?'no-hide-descendants':'auto'} style={[s.body,{opacity:selected?0:1}]}>
     <View testID="sessions-search-and-filters" style={s.tools}>
      <PageSearch label="Search agents and sessions" hint="Searches loaded conversations and their helpers" placeholder="Search conversations…" value={query} onChangeText={setQuery}/>
     </View>
     <View testID="sessions-scroll-region" style={s.body}>
     <FlatList testID="agent-session-tree" data={treeRows} keyExtractor={row=>row.kind+':'+row.session.conversationId+(row.kind==='agent'?':'+row.agent.conversationId:'')} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={s.list}
      ListHeaderComponent={<View style={s.listHeading}><Text typography="ui" style={s.context}>{rows.length} loaded {rows.length===1?'session':'sessions'}</Text>{!!error&&<View style={s.notice}><Text typography="ui" accessibilityLiveRegion="polite" style={s.context}>{error}</Text>{onRetry&&action('Retry agent overview','Retry',onRetry)}</View>}{loading&&!sessions.length&&<ActivityIndicator accessibilityLabel="Refreshing agents" size="small" color={colors.accent}/>}</View>}
      ListEmptyComponent={<View style={s.empty}><Text typography="ui" style={s.emptyTitle}>{loading?'Loading sessions…':error?'Sessions could not be loaded':query?'No matching conversations':filter==='trash'?'Trash is empty':filter==='archived'?'No archived sessions':'No sessions yet'}</Text><Text typography="ui" style={s.context}>{error?'Check your connection and try Retry.':loading?'Fetching this list…':query?'Try another title or helper name.':filter==='all'?'Start a new session with Bob.':'Sessions you move here will appear in this list.'}</Text></View>}
      ListFooterComponent={hasMore&&onLoadMore?action('Load more agent sessions','More sessions',onLoadMore,loading):undefined}
      renderItem={({item})=>{
       const session=item.session;
       if(item.kind==='agent'){
        const agent=item.agent;return <View style={[s.childWrap,item.last&&s.lastChild]}>
         <View pointerEvents="none" testID="agent-tree-connector" style={s.connector}/>
         <Pressable accessibilityRole="button" accessibilityLabel={`View agent ${agent.name}`} accessibilityState={{selected:selected?.parentId===session.conversationId&&selected.agent.conversationId===agent.conversationId}} accessibilityHint={`Under ${session.title}, session ${session.conversationId}. ${label(agent.status)}. Opens a view-only transcript.`} onPress={()=>onSelect(session.conversationId,agent.conversationId)} style={s.child}><View style={s.childText}><Text typography="ui" style={s.helperName}>{agent.name}</Text><Text typography="ui" style={s.context}>{label(agent.status)}</Text></View><ChevronRight size={18} color={colors.muted}/></Pressable>
        </View>;
       }
       const closed=item.closed,count=session.agents.length,running=session.agents.filter(agent=>active(agent.status)).length;
       return <View testID={`agent-session-${session.conversationId}`} style={[s.session,currentSessionId===session.conversationId&&s.currentSession]}>
        <View style={s.rootRow}>
         <View style={s.rootContent}><Pressable accessibilityRole="button" accessibilityLabel={`Open Bob session ${session.title}`} accessibilityState={{selected:currentSessionId===session.conversationId}} onPress={()=>onOpenSession(session.conversationId)} onLongPress={onSessionAction?()=>{Keyboard.dismiss();setActionSession(session);}:undefined} accessibilityHint={`Opens this conversation. ${label(session.status)}.${onSessionAction?' Long press for session controls.':''}`} style={s.rootLink}>
          <View style={s.titleLine}><Text typography="ui" style={s.sessionTitle}>{session.title}</Text>{session.pinned&&<Pin accessibilityLabel="Pinned session" size={14} color={colors.accent}/>}</View>
         </Pressable>
          <View testID={`session-metadata-${session.conversationId}`} style={s.metadata}><Text typography="ui" style={s.context}>Bob</Text><Text style={s.sessionId}>#{session.conversationId}</Text>{state(session.status)}{session.readOnly&&<Text typography="ui" style={s.context}>Read only</Text>}
          {count>0&&<Pressable accessibilityRole="button" accessibilityLabel={`${closed?'Expand':'Collapse'} agents for ${session.title}`} accessibilityState={{expanded:!closed}} onPress={()=>toggle(session.conversationId,closed)} style={s.helperToggle}>{closed?<ChevronRight size={16} color={colors.muted}/>:<ChevronDown size={16} color={colors.muted}/>}<Text typography="ui" style={s.helperCount}>{count} {count===1?'helper':'helpers'}{running?' · '+running+' running':''}</Text></Pressable>}
          </View></View>
         {onSessionAction&&<Pressable accessibilityRole="button" accessibilityLabel={`Session controls for ${session.title}`} onPress={()=>{Keyboard.dismiss();setActionSession(session);}} style={s.overflow}><Ellipsis size={22} color={colors.muted}/></Pressable>}
        </View>
       </View>;
      }}/>
     <EdgeFade edge="top" height={16}/><EdgeFade edge="bottom" height={24}/>
     </View>
    </View>
    {!!selected&&<View style={s.viewer}><Text typography="ui" accessibilityLiveRegion="polite" style={s.connectionStatus}>{status}</Text><View style={s.body}>{typeof children==='function'?children(0):children}</View></View>}
   </View>
   <View testID="sessions-bottom-bar" style={s.bottomBar}>
    <SectionActions menu={menu} leading={selected?<RoundAction label="Back to agent list" icon={ArrowLeft} onPress={onBack}/>:onFilterChange?<Pressable accessibilityRole="button" accessibilityLabel={`Session filter: ${FILTERS.find(option=>option.value===filter)?.text??'Active'}`} accessibilityHint="Choose Active, Archived or Trash" accessibilityState={{expanded:filterOpen}} onPress={()=>{Keyboard.dismiss();setFilterOpen(true);}} style={s.filterTrigger}><Text typography="ui" style={s.filterText}>{FILTERS.find(option=>option.value===filter)?.text??'Active'}</Text><ChevronDown size={16} color={colors.muted}/></Pressable>:undefined}>
    {!selected&&<>{onSchedules&&<Pressable accessibilityRole="button" accessibilityLabel="Schedules" onPress={onSchedules} style={s.utility}><Clock3 size={22} color={colors.foreground}/></Pressable>}{onNew&&<Pressable accessibilityRole="button" accessibilityLabel="New session" accessibilityHint="Start a new conversation" accessibilityState={{disabled:newBusy,busy:newBusy}} disabled={newBusy} onPress={onNew} style={[s.newSession,newBusy&&{opacity:.45}]}>{newBusy?<ActivityIndicator size="small" color={colors.onAccent}/>:<Plus size={23} color={colors.onAccent}/>}</Pressable>}</>}
   </SectionActions></View>
  </View>
  {visible&&filterOpen&&onFilterChange&&<Modal visible transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={()=>setFilterOpen(false)}>
   <SafeAreaView style={s.filterOverlay}><Pressable accessibilityRole="button" accessibilityLabel="Dismiss session filters" onPress={()=>setFilterOpen(false)} style={StyleSheet.absoluteFill}/>
    <View testID="session-filter-picker" accessibilityViewIsModal onAccessibilityEscape={()=>setFilterOpen(false)} style={s.filterSheet}>
     <ScrollView style={s.filterScroll} keyboardShouldPersistTaps="handled" contentContainerStyle={s.filterOptions}><Text typography="ui" accessibilityRole="header" style={s.filterTitle}>Show sessions</Text>
      {FILTERS.map(option=><Pressable key={option.value} accessibilityRole="radio" accessibilityLabel={option.text} accessibilityState={{checked:filter===option.value}} accessibilityHint={option.value==='all'?'All sessions not archived or in Trash':undefined} onPress={()=>{setFilterOpen(false);onFilterChange(option.value);}} style={s.filterOption}><Text typography="ui" style={s.filterOptionText}>{option.text}</Text>{filter===option.value&&<Check size={20} color={colors.foreground}/>}</Pressable>)}
     </ScrollView><SectionActions leading={<RoundAction label="Close session filters" icon={ArrowLeft} onPress={()=>setFilterOpen(false)}/>}/>
    </View>
   </SafeAreaView>
  </Modal>}
  {visible&&actionSession&&onSessionAction&&<SessionActions key={actionSession.conversationId} session={actionSession} onClose={()=>setActionSession(undefined)} onAction={onSessionAction}/>}
 </View>;
}
const sTheme=themed(({colors,shadows})=>StyleSheet.create({
 screen:{position:'absolute',top:0,bottom:0,left:0,right:0,backgroundColor:colors.background,zIndex:25},body:{flex:1,minHeight:0},
 heading:{paddingHorizontal:16,paddingTop:SECTION_HEADING_TOP,paddingBottom:8},headingText:{color:colors.foreground,fontSize:24,lineHeight:30,fontWeight:'600'},context:{color:colors.muted,fontSize:13,lineHeight:20},tools:{paddingHorizontal:16,gap:8,paddingBottom:8},
 utility:{width:48,height:48,minWidth:48,minHeight:48,alignItems:'center',justifyContent:'center'},newSession:{width:48,height:48,minWidth:48,minHeight:48,borderRadius:24,backgroundColor:colors.accent,alignItems:'center',justifyContent:'center'},filterTrigger:{minHeight:48,minWidth:48,maxWidth:'100%',flexDirection:'row',alignItems:'center',gap:6,paddingHorizontal:8},filterText:{color:colors.foreground,fontSize:14,lineHeight:22,flexShrink:1},
 filterOverlay:{flex:1,backgroundColor:'#00000055',justifyContent:'flex-end'},filterSheet:{maxHeight:'80%',flexShrink:1,backgroundColor:colors.background,borderTopLeftRadius:20,borderTopRightRadius:20},filterScroll:{flexGrow:0,flexShrink:1,minHeight:0},filterOptions:{padding:16,gap:4},filterTitle:{fontSize:16,lineHeight:24,fontWeight:'600',color:colors.foreground,paddingBottom:8},filterOption:{minHeight:48,paddingVertical:12,paddingHorizontal:8,flexDirection:'row',alignItems:'center',gap:12},filterOptionText:{flex:1,fontSize:16,lineHeight:24,color:colors.foreground},
 list:{paddingHorizontal:16,paddingTop:12,paddingBottom:24},listHeading:{paddingTop:4,paddingBottom:8,gap:8},
 session:{borderLeftWidth:3,borderLeftColor:'transparent',borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:colors.subtle},currentSession:{borderLeftColor:colors.accent},rootRow:{flexDirection:'row',alignItems:'flex-start',paddingVertical:4},rootContent:{flex:1,minWidth:0},rootLink:{minWidth:0,minHeight:48,paddingVertical:8,paddingLeft:12,paddingRight:8,justifyContent:'center'},titleLine:{flexDirection:'row',alignItems:'center',gap:8},sessionTitle:{flex:1,minWidth:0,fontSize:16,lineHeight:23,fontWeight:'600',color:colors.foreground},metadata:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',columnGap:8,rowGap:0,paddingLeft:12,paddingRight:8,paddingBottom:8},sessionId:{fontSize:11,lineHeight:18,color:colors.muted},state:{flexDirection:'row',alignItems:'center',gap:5},dot:{width:6,height:6,borderRadius:3},statusText:{fontSize:12,lineHeight:20,color:colors.body},overflow:{width:48,minHeight:48,alignItems:'center',justifyContent:'center'},helperToggle:{minHeight:48,minWidth:48,maxWidth:'100%',flexDirection:'row',alignItems:'center',gap:4},helperCount:{flexShrink:1,fontSize:13,lineHeight:20,color:colors.muted},childWrap:{position:'relative',marginLeft:16,paddingLeft:16},lastChild:{paddingBottom:8},connector:{position:'absolute',left:0,top:0,bottom:0,width:1,backgroundColor:colors.subtle},child:{minHeight:56,flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:12,paddingVertical:8},childText:{flex:1,minWidth:0},helperName:{fontSize:15,lineHeight:22,color:colors.foreground},
 action:{...menuButtonChrome({colors,shadows}).pill,minHeight:48,minWidth:48,maxWidth:'100%',paddingHorizontal:16,paddingVertical:12,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,borderRadius:999},primary:{...menuButtonChrome({colors,shadows}).primary},actionText:{...menuButtonChrome({colors,shadows}).label,flexShrink:1,fontSize:15,lineHeight:22,fontWeight:'600',color:colors.foreground},bottomBar:{flexShrink:0,backgroundColor:colors.background},empty:{paddingVertical:32,gap:8},emptyTitle:{fontSize:17,lineHeight:25,color:colors.foreground},notice:{gap:8},viewer:{position:'absolute',top:0,bottom:0,left:0,right:0,backgroundColor:colors.background},connectionStatus:{color:colors.muted,fontSize:12,lineHeight:18,paddingHorizontal:16,paddingVertical:4},
}));
