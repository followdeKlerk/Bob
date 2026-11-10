import {PageSearch} from './page-search';
import {menuButtonChrome} from '../menu-button-style';
import {Text,TextInput} from './app-text';
import React,{memo,useEffect,useMemo,useRef,useState} from 'react';
import {ActivityIndicator,Alert,BackHandler,FlatList,Image,Keyboard,Modal,Pressable,StyleSheet,View,useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Clock3,Archive,ArchiveRestore,ChevronDown,ChevronRight,Check,Edit3,Ellipsis,Pin,PinOff,QrCode,Server,Settings,SquarePen,Trash2,Undo2,X,type LucideIcon} from 'lucide-react-native';
import {EdgeFade} from './edge-fade';
import {ActionIcon} from './message-actions';
import {menuRadii,themed,useTheme,useThemedValue} from '../theme';
import {SectionHeading,SectionActions,RoundAction,SectionSegments} from './section-ui';
import {useKeyboardInset} from '../keyboard-inset';
export type SessionAction='rename'|'pin'|'unpin'|'archive'|'unarchive'|'delete'|'restore';
type Row={id:string;label:string;selected?:boolean;disabled?:boolean;onPress:()=>void;pinned?:boolean;archived?:boolean;trashed?:boolean;working?:boolean};
type Props={menu?:React.ReactNode;headingTitle?:string;onBack?:()=>void;embedded?:boolean;mode?:'sessions'|'workstations';workspaceLabel?:string;visible:boolean;onClose:()=>void;navigation:(Row&{icon:LucideIcon})[];workspaces:Row[];conversations:Row[];onSchedules?:()=>void;onNew:()=>void;onSettings:()=>void;disabled:boolean;loadMore?:()=>void;pairing:React.ReactNode;onSessionAction:(id:string,action:SessionAction,title?:string)=>Promise<void>};
const MenuRow=memo(function MenuRow({label,icon:Icon,selected,disabled,onPress,onLongPress,pinned,working,card=false,text=label}:Omit<Row,'id'>&{icon?:LucideIcon;card?:boolean;text?:string;onLongPress?:(y:number)=>void}){
 const {colors}=useTheme();
 const s=useThemedValue(sTheme);

 const target=<Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={onLongPress?'Long press for session controls':undefined} accessibilityState={{selected:!!selected,disabled:!!disabled,...(working!==undefined?{busy:working}:{})}} disabled={disabled} onPress={()=>{Keyboard.dismiss();onPress();}} onLongPress={onLongPress?event=>{Keyboard.dismiss();onLongPress(event.nativeEvent.pageY);}:undefined} delayLongPress={400} style={[s.row,onLongPress&&s.sessionTarget,card&&s.cardRow,selected&&{backgroundColor:card?colors.selectedSurface:colors.surface},disabled&&{opacity:0.4}]}>{Icon&&<View style={card?s.rowIcon:undefined}><Icon size={card?20:22} color={selected?colors.accent:colors.muted}/></View>}<Text typography="ui" numberOfLines={card?2:1} style={s.rowText}>{text}</Text>{pinned&&<Pin size={14} color={colors.accent}/>}{working&&<ActivityIndicator size="small" color={colors.accent} accessible={false} importantForAccessibility="no-hide-descendants" style={s.working}/>}{card&&(selected?<Check size={18} color={colors.accent}/>:<ChevronRight size={16} color={colors.muted}/>)}</Pressable>;
 // Session controls are a sibling target, never a nested pressable that can
 // also activate the session navigation row.
 return onLongPress?<View style={[s.sessionRow,selected&&{backgroundColor:colors.surface}]}>{target}<Pressable accessibilityRole="button" accessibilityLabel={`Session controls for ${label}`} accessibilityHint="Open available session actions" accessibilityState={{disabled:!!disabled}} disabled={disabled} onPress={event=>{Keyboard.dismiss();onLongPress(event.nativeEvent.pageY);}} style={[s.overflow,disabled&&{opacity:0.4}]}><Ellipsis size={22} color={colors.muted}/></Pressable></View>:target;
});
export function SideDrawer({menu:sectionMenu,headingTitle,onBack,onSchedules,visible,onClose,navigation,workspaces,conversations,onNew,onSettings,disabled,loadMore,pairing,onSessionAction,embedded=false,mode,workspaceLabel}:Props){
 const {colors}=useTheme();
 const s=useThemedValue(sTheme);

 const keyboard=useKeyboardInset(),insets=useSafeAreaInsets();
 const [headerHeight,setHeaderHeight]=useState(128),[footerHeight,setFooterHeight]=useState(80);
 const bottomInset=embedded||keyboard>0?0:insets.bottom;
 const topClearance=(embedded?0:insets.top)+headerHeight+(embedded?0:36),bottomClearance=embedded?footerHeight+12:mode==='workstations'?24:bottomInset+footerHeight+44;
 const {width,height}=useWindowDimensions(),[query,setQuery]=useState(''),[pairingOpen,setPairingOpen]=useState(false),[tab,setTab]=useState<'chats'|'archived'|'trash'>('chats');
 const [menu,setMenu]=useState<{row:Row;y:number}>(),[renaming,setRenaming]=useState<Row>(),[title,setTitle]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const listRef=useRef<FlatList<Row>>(null);
 const togglePairing=()=>{Keyboard.dismiss();setPairingOpen(value=>!value);listRef.current?.scrollToOffset({offset:0,animated:true});};
 const searchLabel=mode==='workstations'?'Search workstations':'Search loaded sessions';
 const filteredWorkspaces=workspaces.filter(row=>mode!=='workstations'||row.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
 const filtered=useMemo(()=>conversations.filter(row=>(tab==='trash'?row.trashed:tab==='archived'?row.archived&&!row.trashed:!row.archived&&!row.trashed)&&row.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||Number(b.id)-Number(a.id)),[conversations,tab,query]);
 const close=()=>{Keyboard.dismiss();setMenu(undefined);setRenaming(undefined);onClose();};
 async function act(row:Row,action:SessionAction,value?:string){setBusy(true);setError('');try{await onSessionAction(row.id,action,value);setRenaming(undefined);setMenu(undefined);}catch(e){setError(String((e as Error).message??e));}finally{setBusy(false);}}
 function choose(action:SessionAction){
  if(!menu)return;const row=menu.row;setMenu(undefined);setError('');
  if(action==='rename'){setTitle(row.label);setRenaming(row);return;}
  if(action==='delete'){Alert.alert('Move conversation to Trash?','Messages remain recoverable in Trash. This does not stop any running work.',[{text:'Cancel',style:'cancel'},{text:'Move to Trash',style:'destructive',onPress:()=>void act(row,'delete')}]);return;}
  void act(row,action);
 }
 // Close local editing/search/pairing before leaving this destination.
 const dismissLocal=()=>{
  if(Keyboard.isVisible()){Keyboard.dismiss();return true;}
  if(renaming){setRenaming(undefined);return true;}
  if(menu){setMenu(undefined);return true;}
  if(query){setQuery('');return true;}
  if(pairingOpen){setPairingOpen(false);return true;}
  return false;
 };
 useEffect(()=>{
  if(!embedded||!visible)return;
  const subscription=BackHandler.addEventListener('hardwareBackPress',dismissLocal);
  return ()=>subscription.remove();
 },[embedded,visible,renaming,menu,query,pairingOpen]);
 if(!visible)return null;
 const options:{label:string;icon:LucideIcon;action:SessionAction}[]=menu?.row.trashed?[{label:'Restore conversation',icon:Undo2,action:'restore'}]:[{label:'Rename',icon:Edit3,action:'rename'},{label:menu?.row.pinned?'Unpin':'Pin to top',icon:menu?.row.pinned?PinOff:Pin,action:menu?.row.pinned?'unpin':'pin'},{label:menu?.row.archived?'Unarchive':'Archive',icon:menu?.row.archived?ArchiveRestore:Archive,action:menu?.row.archived?'unarchive':'archive'},{label:'Delete',icon:Trash2,action:'delete'}];
 const panel=<View testID={embedded?'navigation-panel':undefined} style={embedded?[StyleSheet.absoluteFill,{backgroundColor:colors.background,zIndex:25}]:s.overlay}>
  {!embedded&&<Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Close side menu" onPress={close}/>}
  <View testID="drawer-panel" style={[s.drawer,{width:embedded?'100%':Math.min(width*0.88,420)},embedded&&{borderRightWidth:0}]}>
   <View testID="drawer-viewport" style={{flex:1,marginBottom:Math.max(0,keyboard-insets.bottom)}}>
   {/* The list spans the whole viewport. Controls and gradients float above it,
       rather than reserving opaque header/footer strips in normal layout. */}
   <View testID="drawer-scroll-region" style={StyleSheet.absoluteFill}>
   <FlatList ref={listRef} testID="drawer-scroll-list" style={{flex:1}} data={mode==='workstations'?[]:filtered} keyExtractor={row=>row.id} initialNumToRender={15} maxToRenderPerBatch={12} windowSize={5} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{paddingHorizontal:embedded?20:16,paddingTop:topClearance,paddingBottom:bottomClearance}} extraData={busy}
    ListHeaderComponent={<View>{mode!=='sessions'&&(!query||mode==='workstations')&&<>
     {!query&&navigation.map(row=><MenuRow key={row.id} {...row}/>)}
     {pairingOpen&&<View testID="workstation-pairing" style={s.pairing}><View style={s.pairingHeading}><Text typography="ui" accessibilityRole="header" style={s.pairingTitle}>Connect a workstation</Text><RoundAction label="Close workstation pairing" icon={X} onPress={()=>{Keyboard.dismiss();setPairingOpen(false);}}/></View>{pairing}</View>}
     {!embedded&&<Text typography="ui" style={s.section}>Workstations</Text>}
     {filteredWorkspaces.map(row=><MenuRow key={row.id} {...row} icon={Server} card={embedded}/>)}
     {mode==='workstations'&&filteredWorkspaces.length===0&&<Text typography="ui" style={s.empty}>{query?'No matching workstations.':'Connect a workstation to find your sessions here.'}</Text>}
     {!embedded&&<MenuRow label="Connect backend" icon={QrCode} selected={pairingOpen} onPress={togglePairing}/>}
    </>}{mode!=='workstations'&&<>{!embedded&&<Text typography="ui" style={s.section}>Conversations</Text>}<SectionSegments label="Session filters" options={[{value:'chats',label:embedded?'All':'Chats'},{value:'archived',label:'Archived'},{value:'trash',label:'Trash'}]} value={tab} onChange={setTab} style={s.tabs}/></>}{!!error&&<Text typography="ui" style={s.error}>{error}</Text>}</View>}
    renderItem={({item})=><MenuRow {...item} disabled={busy||item.disabled} onLongPress={y=>setMenu({row:item,y})}/>}
    ListEmptyComponent={mode==='workstations'?undefined:<Text typography="ui" style={s.empty}>{query?'No matching loaded sessions.':tab==='chats'?'No sessions yet.':tab==='archived'?'No archived sessions.':'Trash is empty.'}</Text>}
    ListFooterComponent={mode!=='workstations'&&loadMore?<MenuRow label="Load more conversations" icon={ChevronDown} onPress={loadMore}/>:undefined}/>
   </View>
   <View testID="drawer-fades" pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
    <EdgeFade edge="top" height={topClearance}/><EdgeFade edge="bottom" height={bottomClearance}/>
   </View>
   <View testID="drawer-header" pointerEvents="box-none" onLayout={event=>{const height=event.nativeEvent.layout.height;if(Number.isFinite(height)&&height>0)setHeaderHeight(height);}} style={[s.headerOverlay,{top:embedded?0:insets.top}]}>
    {embedded?<SectionHeading title={headingTitle??(mode==='workstations'?'Workstations':'Sessions')} subtitle={mode==='sessions'?workspaceLabel:undefined}/>:<View pointerEvents="box-none" style={s.heading}><View pointerEvents="none" style={{flex:1}}><Image accessibilityLabel="Bob logo" accessible source={require('../assets/bob-wordmark.png')} resizeMode="contain" style={s.brand}/></View></View>}
    <View style={s.searchHeader}><PageSearch label={searchLabel} placeholder={mode==='workstations'?'Search workstations':'Search loaded sessions'} hint={mode==='workstations'?'Searches saved workstations':'Searches loaded conversations'} value={query} onChangeText={setQuery}/></View>
   </View>
   {embedded&&<View testID="drawer-footer" pointerEvents="box-none" onLayout={event=>{const height=event.nativeEvent.layout.height;if(Number.isFinite(height)&&height>0)setFooterHeight(height);}} style={{position:'absolute',left:0,right:0,bottom:0}}><SectionActions overlay menu={sectionMenu} onBack={onBack?()=>{if(!dismissLocal())onBack();}:undefined}>
     {mode==='sessions'&&onSchedules&&<RoundAction label="Schedules" icon={Clock3} disabled={disabled} onPress={onSchedules}/>}
     {mode==='sessions'&&<RoundAction label="New conversation" icon={SquarePen} disabled={disabled} primary onPress={()=>{Keyboard.dismiss();onNew();}}/>}
     {mode==='workstations'&&<RoundAction label="Add workstation" icon={QrCode} primary onPress={togglePairing}/>}
   </SectionActions></View>}
   {!embedded&&mode!=='workstations'&&<View testID="drawer-footer" pointerEvents="box-none" onLayout={event=>{const height=event.nativeEvent.layout.height;if(Number.isFinite(height)&&height>0)setFooterHeight(height);}} style={[s.footer,{bottom:bottomInset}]}><Pressable disabled={disabled} accessibilityRole="button" accessibilityLabel="New conversation" onPress={()=>{Keyboard.dismiss();onNew();}} style={s.new}><SquarePen size={21} color={colors.foreground}/><Text typography="ui" style={s.newText}>New chat</Text></Pressable>{!embedded&&<View style={s.control}><ActionIcon icon={Settings} label="Settings" disabled={disabled} onPress={()=>{Keyboard.dismiss();onSettings();}}/></View>}</View>}
   </View>
  </View>
  {menu&&<><Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Dismiss session controls" onPress={()=>setMenu(undefined)}/><View style={[s.menu,{top:Math.max(56,Math.min(menu.y-24,height-(options.length*54+80))),left:22,width:Math.min(width-44,280)}]}><Text typography="ui" numberOfLines={1} style={s.menuTitle}>{menu.row.label}</Text>{options.map(({label,icon:Icon,action})=><Pressable key={action} accessibilityRole="button" accessibilityLabel={label} onPress={()=>choose(action)} style={s.menuRow}><View style={s.menuIcon}><Icon size={20} color={colors.foreground}/></View><Text typography="ui" style={s.menuText}>{label}</Text></Pressable>)}</View></>}
  {renaming&&<View style={[s.renameOverlay,{paddingBottom:20+keyboard}]}><View style={s.rename}><Text typography="ui" style={s.renameTitle}>Rename conversation</Text><TextInput typography="ui" autoFocus value={title} onChangeText={setTitle} maxLength={160} accessibilityLabel="Conversation name" placeholder="Conversation name" placeholderTextColor={colors.muted} style={s.renameInput}/>{!!error&&<Text typography="ui" style={s.error}>{error}</Text>}<View style={{flexDirection:'row',justifyContent:'space-between',gap:8}}><Pressable disabled={busy} accessibilityRole="button" accessibilityLabel="Cancel rename" onPress={()=>setRenaming(undefined)} style={s.renameButton}><Text typography="ui" style={s.menuText}>Cancel</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Save conversation name" disabled={busy||!title.trim()} onPress={()=>void act(renaming,'rename',title.trim())} style={s.renameButton}><Text typography="ui" style={s.menuText}>{busy?'Saving…':'Save'}</Text></Pressable></View></View></View>}
 </View>;
 return embedded?panel:<Modal visible transparent statusBarTranslucent navigationBarTranslucent animationType="none" onRequestClose={()=>{if(!dismissLocal())close();}}>{panel}</Modal>;
}
const sTheme=themed(({colors,menuChrome,shadows})=>StyleSheet.create({sessionRow:{flexDirection:'row',alignItems:'stretch',borderRadius:menuRadii.card},sessionTarget:{flex:1,minWidth:0,width:'auto'},overflow:{...menuButtonChrome({colors,shadows}).circle},working:{width:20,height:20},cardRow:{minHeight:56,paddingHorizontal:12,paddingVertical:10},rowIcon:{width:28,height:34,alignItems:'center',justifyContent:'center'},pairing:{gap:12,paddingBottom:24},pairingHeading:{flexDirection:'row',alignItems:'center',gap:8},pairingTitle:{fontSize:17,lineHeight:24,fontWeight:'600',color:colors.foreground,flex:1},searchHeader:{paddingHorizontal:16,paddingBottom:8},overlay:{flex:1,backgroundColor:'#00000077'},drawer:{height:'100%',backgroundColor:colors.background,overflow:'hidden',borderRightWidth:1,borderRightColor:colors.foreground},heading:{flexDirection:'row',alignItems:'center',paddingHorizontal:20,paddingVertical:12},headerOverlay:{position:'absolute',left:0,right:0,backgroundColor:'transparent'},brand:{width:90,height:42,tintColor:colors.foreground},control:{...menuChrome.control},row:{width:'100%',minHeight:50,flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:12,paddingVertical:12,borderRadius:14},rowText:{fontSize:15,lineHeight:23,color:colors.foreground,flex:1},section:{color:colors.muted,fontSize:13,marginTop:24,marginBottom:10,marginHorizontal:12},renameInput:{...menuChrome.input,minHeight:48,marginHorizontal:20,marginBottom:12,padding:12,color:colors.foreground,fontSize:15},tabs:{marginBottom:8},empty:{fontSize:13,color:colors.muted,padding:12,lineHeight:22},footer:{position:'absolute',left:0,right:0,padding:16,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12,backgroundColor:'transparent'},new:{...menuButtonChrome({colors,shadows}).pill,minHeight:48,paddingHorizontal:18,paddingVertical:12,flexShrink:1,flexDirection:'row',alignItems:'center',gap:8,backgroundColor:colors.surface},newText:{...menuButtonChrome({colors,shadows}).label,color:colors.foreground,fontSize:15,fontWeight:'600',flexShrink:1},menu:{...menuChrome.card,...shadows.popup,position:'absolute',padding:8,zIndex:12},menuTitle:{fontSize:13,color:colors.muted,paddingHorizontal:12,paddingVertical:8},menuRow:{...menuButtonChrome({colors,shadows}).pill,minHeight:54,flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:10},menuIcon:{width:34,height:34,alignItems:'center',justifyContent:'center'},menuText:{...menuButtonChrome({colors,shadows}).label,fontSize:15,color:colors.foreground,flexShrink:1},renameOverlay:{position:'absolute',top:0,bottom:0,left:0,right:0,justifyContent:'center',padding:20,backgroundColor:'#00000099'},rename:{...menuChrome.card,...shadows.popup,padding:16,gap:14},renameTitle:{fontSize:18,color:colors.foreground},renameButton:{...menuButtonChrome({colors,shadows}).pill,minHeight:48,paddingHorizontal:16,justifyContent:'center'},error:{fontSize:12,lineHeight:20,color:colors.foreground,padding:8}}));
