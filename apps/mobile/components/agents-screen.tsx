import {withMenuTheme,ChatTheme,useChatTheme} from '../menu-theme';
import {selectionHaptic} from '../haptics';
import {PersistentMotionSurface} from './motion-surface';
import {PageSearch} from './page-search';
import {EmptyState} from './empty-state';
import {menuButtonChrome} from '../menu-button-style';
import React,{useEffect,useMemo,useState} from 'react';
import {View,FlatList,Pressable,StyleSheet,ActivityIndicator,Keyboard,Modal,ScrollView} from 'react-native';
import {ChevronDown,ArrowLeft,Pin,Plus,Ellipsis,Clock3,Check,MessagesSquare} from 'lucide-react-native';
import {Text} from './app-text';
import {themed,useTheme,useThemedValue} from '../theme';
import {EdgeFade} from './edge-fade';
import {SectionActions,RoundAction,SECTION_HEADING_TOP} from './section-ui';
import {SessionActions} from './session-actions';
import {SafeAreaView} from 'react-native-safe-area-context';
const FILTERS=[{value:'all',text:'Active'},{value:'archived',text:'Archived'},{value:'trash',text:'Trash'}] as const;
import type {SessionAction} from './side-drawer';
import type {AgentSession,AgentStatus,OverviewAgent,SessionFilter} from '../use-agent-overview';
type TreeRow={kind:'session';session:AgentSession;first:boolean}|{kind:'agent';session:AgentSession;agent:OverviewAgent;last:boolean};
const active=(status:AgentStatus)=>status==='working'||status==='stopping';
const label=(status:AgentStatus)=>({working:'Running',stopping:'Stopping',idle:'Idle',unknown:'Status unavailable'}[status]);
type Props={menu?:React.ReactNode;sessions:AgentSession[];currentSessionId?:number;selected?:{parentId:number;agent:OverviewAgent;title:string};onSelect:(parentId:number,id:number)=>void;onOpenSession:(id:number)=>void;onBack:()=>void;status:string;children:React.ReactNode|((clearance:number)=>React.ReactNode);visible?:boolean;bottomInset?:number;history?:boolean;onHistoryChange:(value:boolean)=>void;workstation?:string;loading?:boolean;error?:string;onRetry?:()=>void;hasMore?:boolean;onLoadMore?:()=>void;onNew?:()=>void;newBusy?:boolean;onSchedules?:()=>void;filter?:SessionFilter;onFilterChange?:(filter:SessionFilter)=>void;onSessionAction?:(id:string,action:SessionAction,title?:string)=>Promise<void>};
/** Conversation-first presentation only. Membership/status remain server-authoritative. */
function AgentsScreenContent({menu,sessions,currentSessionId,selected,onSelect,onOpenSession,onBack,status,children,visible=true,bottomInset=0,loading=false,error,onRetry,hasMore,onLoadMore,onNew,newBusy=false,onSchedules,filter='all',onFilterChange,onSessionAction}:Props){
 const s=useThemedValue(sTheme),{colors}=useTheme(),chatTheme=useChatTheme();
 const [actionSession,setActionSession]=useState<AgentSession>(),[filterOpen,setFilterOpen]=useState(false);
 useEffect(()=>{if(!visible){setActionSession(undefined);setFilterOpen(false);}if(selected||!onFilterChange)setFilterOpen(false);},[visible,selected,onFilterChange]);
 const [query,setQuery]=useState('');
 const rows=useMemo(()=>{
  const term=query.trim().toLowerCase();
  return sessions.map(session=>({...session,agents:session.agents.filter(agent=>!term||session.title.toLowerCase().includes(term)||String(session.conversationId).includes(term)||agent.name.toLowerCase().includes(term))}))
   .filter(session=>!term||session.title.toLowerCase().includes(term)||String(session.conversationId).includes(term)||session.agents.length>0)
   .sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||Number(active(b.status)||b.agents.some(agent=>active(agent.status)))-Number(active(a.status)||a.agents.some(agent=>active(agent.status))));
 },[sessions,query]);
 // Every loaded helper stays visible, but each remains its own virtualized row.
 // Derive endpoints after search filtering so even a single match gets an L branch.
 const treeRows=useMemo(()=>rows.flatMap((session,index)=>{
  const entries:TreeRow[]=[{kind:'session',session,first:index===0}];
  session.agents.forEach((agent,index)=>entries.push({kind:'agent',session,agent,last:index===session.agents.length-1}));
  return entries;
 }),[rows]);
 const state=(value:AgentStatus)=><View accessibilityLabel={`Session status: ${label(value)}`} style={s.state}><View accessible={false} style={[s.dot,{backgroundColor:active(value)?colors.accent:colors.muted}]}/><Text typography="ui" style={s.statusText}>{label(value)}</Text></View>;
 const action=(name:string,text:string,onPress:()=>void,disabled=false,primary=false)=><Pressable accessibilityRole="button" accessibilityLabel={name} accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={[s.action,primary&&s.primary,disabled&&{opacity:.45}]}>{primary&&<Plus size={19} color={colors.foreground}/>}<Text typography="ui" style={[s.actionText,primary&&{fontWeight:'600'}]}>{text}</Text></Pressable>;
 return <PersistentMotionSurface active={visible} testID="agents-screen" pointerEvents={visible?'auto':'none'} accessibilityElementsHidden={!visible} importantForAccessibility={visible?'auto':'no-hide-descendants'} style={[s.screen,{opacity:visible?1:0,bottom:bottomInset}]}>
  <View testID="agent-screen-content" style={s.body} accessibilityElementsHidden={!!actionSession||filterOpen} importantForAccessibility={actionSession||filterOpen?'no-hide-descendants':'auto'}>
   <View testID="sessions-heading" style={s.heading}><Text typography="ui" accessibilityRole="header" style={s.headingText}>{selected?selected.agent.name:'Sessions'}</Text>{selected&&<Text typography="ui" style={s.context}>{`${selected.title} · View only`}</Text>}</View>
   <View style={s.body}>
    <View testID="sessions-list-content" pointerEvents={selected?'none':'auto'} accessibilityElementsHidden={!!selected} importantForAccessibility={selected?'no-hide-descendants':'auto'} style={[s.body,{opacity:selected?0:1}]}>
     <View testID="sessions-search-and-filters" style={s.tools}>
      <PageSearch label="Search agents and sessions" hint="Searches loaded conversations and their helpers" placeholder="Search conversations…" value={query} onChangeText={setQuery}/>
     </View>
     <View testID="sessions-scroll-region" style={s.body}>
     <FlatList testID="agent-session-tree" data={treeRows} extraData={currentSessionId} keyExtractor={row=>row.kind+':'+row.session.conversationId+(row.kind==='agent'?':'+row.agent.conversationId:'')} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={s.list}
      ListHeaderComponent={<View style={s.listHeading}><Text typography="ui" style={s.context}>{rows.length} loaded {rows.length===1?'session':'sessions'}</Text>{!!error&&<View style={s.notice}><Text typography="ui" accessibilityLiveRegion="polite" style={s.context}>{error}</Text>{onRetry&&action('Retry agent overview','Retry',onRetry)}</View>}{loading&&!sessions.length&&<ActivityIndicator accessibilityLabel="Refreshing agents" size="small" color={colors.accent}/>}</View>}
      ListEmptyComponent={<EmptyState icon={MessagesSquare} title={loading?'Loading sessions…':error?'Sessions could not be loaded':query?'No matching conversations':filter==='trash'?'Trash is empty':filter==='archived'?'No archived sessions':'No sessions yet'} description={error?'Check your connection and try Retry.':loading?'Fetching this list…':query?'Try another title or helper name.':filter==='all'?'Start a new session with Bob.':'Sessions you move here will appear in this list.'}/>}
      ListFooterComponent={hasMore&&onLoadMore?action('Load more agent sessions','More sessions',onLoadMore,loading):undefined}
      renderItem={({item})=>{
       const session=item.session;
       if(item.kind==='agent'){
        const agent=item.agent;return <View testID={`agent-row-${session.conversationId}-${agent.conversationId}`} style={s.childWrap}>
         <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="agent-tree-connector" style={StyleSheet.absoluteFill}>
          <View testID="agent-tree-stem" style={[s.branchStem,item.last&&s.branchEnd]}/><View testID="agent-tree-arm" style={s.branchArm}/>
         </View>
         <Pressable accessibilityRole="button" accessibilityLabel={`View agent ${agent.name}`} accessibilityState={{selected:selected?.parentId===session.conversationId&&selected.agent.conversationId===agent.conversationId}} accessibilityHint={`Under ${session.title}, session ${session.conversationId}. ${label(agent.status)}. Opens a view-only transcript.`} onPress={()=>{selectionHaptic();onSelect(session.conversationId,agent.conversationId);}} style={s.child}><Text typography="ui" style={s.helperName}>{agent.name}</Text><Text typography="ui" style={s.statusText}>{label(agent.status)}</Text></Pressable>
        </View>;
       }
       const current=currentSessionId===session.conversationId;
       return <View testID={`agent-session-${session.conversationId}`} style={[s.session,!item.first&&s.nextSession]}>
        <View style={s.rootRow}>
         <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={s.rootGuide}>
          {session.agents.length>0&&<View testID={`session-tree-stem-${session.conversationId}`} style={s.rootStem}/>}
          <View testID={`session-tree-marker-${session.conversationId}`} style={[s.rootMarker,current&&s.currentMarker]}/>
          {current&&<View testID={`session-tree-selection-${session.conversationId}`} style={s.selectionRing}/>}
         </View>
         <Pressable accessibilityRole="button" accessibilityLabel={`Open Bob session ${session.title}`} accessibilityState={{selected:current}} onPress={()=>{selectionHaptic();onOpenSession(session.conversationId);}} onLongPress={onSessionAction?()=>{Keyboard.dismiss();setActionSession(session);}:undefined} accessibilityHint={`Opens this conversation. ${label(session.status)}.${onSessionAction?' Long press for session controls.':''}`} style={s.rootLink}>
          <View style={s.titleLine}><Text typography="ui" style={s.sessionTitle}>{session.title}</Text>{session.pinned&&<Pin accessibilityLabel="Pinned session" size={14} color={colors.accent}/>}</View>
          <View testID={`session-metadata-${session.conversationId}`} style={s.metadata}><Text typography="ui" style={s.context}>Bob</Text><Text typography="mono" style={s.sessionId}>#{session.conversationId}</Text>{state(session.status)}{session.readOnly&&<Text typography="ui" style={s.context}>Read only</Text>}</View>
         </Pressable>
         {onSessionAction&&<Pressable accessibilityRole="button" accessibilityLabel={`Session controls for ${session.title}`} onPress={()=>{Keyboard.dismiss();setActionSession(session);}} style={s.overflow}><Ellipsis size={22} color={colors.muted}/></Pressable>}
        </View>
       </View>;
      }}/>
     <EdgeFade edge="top" height={16}/><EdgeFade edge="bottom" height={24}/>
     </View>
    </View>
    {!!selected&&<View style={s.viewer}><Text typography="ui" accessibilityLiveRegion="polite" style={s.connectionStatus}>{status}</Text><View style={[s.body,{backgroundColor:chatTheme.colors.background}]}><ChatTheme>{typeof children==='function'?children(0):children}</ChatTheme></View></View>}
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
 </PersistentMotionSurface>;
}
const sTheme=themed(({colors,shadows})=>StyleSheet.create({
 screen:{position:'absolute',top:0,bottom:0,left:0,right:0,backgroundColor:colors.background,zIndex:25},body:{flex:1,minHeight:0},
 heading:{paddingHorizontal:16,paddingTop:SECTION_HEADING_TOP,paddingBottom:8},headingText:{color:colors.foreground,fontSize:26,lineHeight:34,fontWeight:'600'},context:{color:colors.muted,fontSize:13,lineHeight:20},tools:{paddingHorizontal:16,gap:8,paddingBottom:8},
 utility:{width:48,height:48,minWidth:48,minHeight:48,alignItems:'center',justifyContent:'center'},newSession:{width:48,height:48,minWidth:48,minHeight:48,borderRadius:24,backgroundColor:colors.accent,alignItems:'center',justifyContent:'center'},filterTrigger:{minHeight:48,minWidth:48,maxWidth:'100%',flexDirection:'row',alignItems:'center',gap:6,paddingHorizontal:8},filterText:{color:colors.foreground,fontSize:14,lineHeight:22,flexShrink:1},
 filterOverlay:{flex:1,backgroundColor:'#00000055',justifyContent:'flex-end'},filterSheet:{maxHeight:'80%',flexShrink:1,backgroundColor:colors.background,borderTopLeftRadius:20,borderTopRightRadius:20},filterScroll:{flexGrow:0,flexShrink:1,minHeight:0},filterOptions:{padding:16,gap:4},filterTitle:{fontSize:16,lineHeight:24,fontWeight:'600',color:colors.foreground,paddingBottom:8},filterOption:{minHeight:48,paddingVertical:12,paddingHorizontal:8,flexDirection:'row',alignItems:'center',gap:12},filterOptionText:{flex:1,fontSize:16,lineHeight:24,color:colors.foreground},
 list:{paddingHorizontal:16,paddingTop:12,paddingBottom:24},listHeading:{paddingTop:4,paddingBottom:8,gap:8},
 // The line pieces fill each independently virtualized row; percentage joins
 // follow its natural height when titles wrap or Android text scaling changes.
 session:{position:'relative'},nextSession:{marginTop:12},rootRow:{flexDirection:'row',alignItems:'stretch'},rootGuide:{width:24,flexShrink:0},rootStem:{position:'absolute',left:8,top:'50%',bottom:0,width:1,backgroundColor:colors.muted},rootMarker:{position:'absolute',left:5,top:'50%',marginTop:-3.5,width:7,height:7,borderRadius:3.5,backgroundColor:colors.muted},currentMarker:{backgroundColor:colors.accent},selectionRing:{position:'absolute',left:2,top:'50%',marginTop:-6.5,width:13,height:13,borderRadius:6.5,borderWidth:1,borderColor:colors.accent},
 rootLink:{flex:1,minWidth:0,minHeight:48,paddingVertical:6,paddingRight:8,justifyContent:'center'},titleLine:{flexDirection:'row',alignItems:'center',gap:8},sessionTitle:{flex:1,minWidth:0,fontSize:16,lineHeight:23,fontWeight:'600',color:colors.foreground},metadata:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',columnGap:8,rowGap:0},sessionId:{fontSize:11,lineHeight:18,color:colors.muted},state:{flexDirection:'row',alignItems:'center',flexShrink:1,minWidth:0,gap:5},dot:{width:6,height:6,borderRadius:3,flexShrink:0},statusText:{fontSize:12,lineHeight:18,color:colors.muted,flexShrink:1},overflow:{width:48,minHeight:48,alignSelf:'flex-start',alignItems:'center',justifyContent:'center'},
 childWrap:{position:'relative',paddingLeft:48},branchStem:{position:'absolute',left:8,top:0,bottom:0,width:1,backgroundColor:colors.muted},branchEnd:{bottom:'50%'},branchArm:{position:'absolute',left:8,top:'50%',width:32,height:1,backgroundColor:colors.muted},child:{minWidth:0,minHeight:48,paddingVertical:4,paddingRight:8,justifyContent:'center'},helperName:{fontSize:15,lineHeight:22,color:colors.foreground},
 action:{...menuButtonChrome({colors,shadows}).pill,minHeight:48,minWidth:48,maxWidth:'100%',paddingHorizontal:16,paddingVertical:12,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,borderRadius:999},primary:{...menuButtonChrome({colors,shadows}).primary},actionText:{...menuButtonChrome({colors,shadows}).label,flexShrink:1,fontSize:15,lineHeight:22,fontWeight:'600',color:colors.foreground},bottomBar:{flexShrink:0,backgroundColor:colors.background},empty:{paddingVertical:32,gap:8},emptyTitle:{fontSize:17,lineHeight:25,color:colors.foreground},notice:{gap:8},viewer:{position:'absolute',top:0,bottom:0,left:0,right:0,backgroundColor:colors.background},connectionStatus:{color:colors.muted,fontSize:12,lineHeight:18,paddingHorizontal:16,paddingVertical:4},
}));

export const AgentsScreen=withMenuTheme(AgentsScreenContent);
