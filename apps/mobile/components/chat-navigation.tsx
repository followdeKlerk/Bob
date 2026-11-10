import {menuButtonChrome} from '../menu-button-style';
import React from 'react';
import {Modal,Pressable,ScrollView,StyleSheet,View} from 'react-native';
import {SafeAreaView,useSafeAreaInsets} from 'react-native-safe-area-context';
import {Menu as NavigationMenu,SquareTerminal,NotebookPen,Monitor,Users,Settings,MessageCircle,Check,X,type LucideIcon} from 'lucide-react-native';
import {Text} from './app-text';
import type {BottomDestination} from './bottom-tabs';
import {menuRadii,themed,useTheme,useThemedValue} from '../theme';
import {SectionHeading,SectionActions,SectionBody,RoundAction} from './section-ui';

const destinations:{id:BottomDestination;label?:string;icon:LucideIcon}[]=[
 {id:'Chat',icon:MessageCircle},
 {id:'Agents',label:'Agents and Sessions',icon:Users},
 {id:'Terminal',icon:SquareTerminal},
 {id:'Notes',icon:NotebookPen},
 {id:'Workstations',icon:Monitor},
 {id:'Settings',icon:Settings},
];
export function ChatNavigation({open,onOpen,onClose,onSelect,activeAgentCount=0,showTrigger=true,readOnly=false,selected='Chat',framedTrigger=false}:{framedTrigger?:boolean;selected?:BottomDestination;open:boolean;onOpen:()=>void;onClose:()=>void;onSelect:(destination:BottomDestination)=>void;activeAgentCount?:number;showTrigger?:boolean;readOnly?:boolean}){
 const {colors}=useTheme();
 const s=useThemedValue(sTheme);
 const insets=useSafeAreaInsets();
 const count=!readOnly&&Number.isSafeInteger(activeAgentCount)&&activeAgentCount>0?activeAgentCount:0;
 const agentActivity=`${count} active ${count===1?'agent':'agents'}`;
 return <>
  {showTrigger&&<Pressable accessibilityRole="button" accessibilityLabel="Menu" accessibilityHint="Open navigation" accessibilityValue={{text:agentActivity}} accessibilityState={{expanded:open}} onPress={onOpen} style={[s.trigger,framedTrigger&&s.framedTrigger]}>
   <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={s.glyph}>
    <NavigationMenu size={24} color={colors.foreground}/>
    {count>0&&<View testID="chat-menu-agent-badge" style={s.badge}><Text typography="ui" style={s.badgeText}>{count>99?'99+':count}</Text></View>}
   </View>
  </Pressable>}
  <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
   <View style={[s.overlay,{paddingTop:insets.top+12}]}>
    <Pressable accessibilityRole="button" accessibilityLabel="Dismiss navigation menu" onPress={onClose} style={StyleSheet.absoluteFill}/>
    <SafeAreaView edges={['left','right','bottom']} testID="chat-navigation-sheet" accessibilityViewIsModal onAccessibilityEscape={onClose} style={s.sheet}>
     <SectionHeading title="Menu"/>
     <SectionBody surfaceColor={colors.surface} style={{flex:undefined,flexShrink:1}} footer={<SectionActions overlay leading={<RoundAction label="Close navigation menu" onPress={onClose} icon={X}/>}/>}>{clearance=>
     <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[s.content,{paddingBottom:clearance+12}]} style={s.scroll}>
      {destinations.map(({id,label=id,icon:Icon})=><View key={id}>{id==='Agents'&&<Text typography="ui" accessibilityRole="header" style={s.group}>Workspace</Text>}{id==='Settings'&&<Text typography="ui" accessibilityRole="header" style={s.group}>App</Text>}<Pressable key={id} accessibilityRole="button" accessibilityLabel={label} accessibilityValue={id==='Agents'?{text:agentActivity}:undefined} accessibilityState={{selected:id===selected}} onPress={()=>onSelect(id)} style={[s.row,id===selected&&s.current]}>
       <Icon size={23} color={colors.foreground}/>
       <Text typography="ui" style={s.label}>{label}</Text>
       {id==='Agents'&&count>0&&<Text typography="ui" accessible={false} style={s.count}>{count}</Text>}
       {id===selected&&<Check size={18} color={colors.accent}/>}
      </Pressable></View>)}
     </ScrollView>
     }</SectionBody>
    </SafeAreaView>
   </View>
  </Modal>
 </>;
}
const sTheme=themed(({colors,shadows})=>StyleSheet.create({
 framedTrigger:{...menuButtonChrome({colors,shadows}).circle},
 trigger:{width:48,height:48,minWidth:48,minHeight:48,padding:0,alignItems:'center',justifyContent:'center'},
 glyph:{width:40,height:48,alignItems:'center',justifyContent:'center'},
 badge:{position:'absolute',right:-3,top:0,minWidth:18,minHeight:18,paddingHorizontal:4,borderRadius:12,backgroundColor:colors.selectedSurface,borderWidth:1,borderColor:colors.foreground,alignItems:'center',justifyContent:'center'},
 badgeText:{color:colors.foreground,fontSize:11,lineHeight:15,fontWeight:'700'},
 overlay:{flex:1,justifyContent:'flex-end',backgroundColor:'#00000088'},
 sheet:{...shadows.popup,width:'100%',maxWidth:760,maxHeight:'85%',alignSelf:'center',backgroundColor:colors.surface,borderTopLeftRadius:menuRadii.card,borderTopRightRadius:menuRadii.card},
 scroll:{flexGrow:0,flexShrink:1,minHeight:0},
 content:{paddingHorizontal:16,paddingBottom:12,gap:2},group:{paddingHorizontal:12,paddingTop:16,paddingBottom:6,color:colors.muted,fontSize:13,lineHeight:18,fontWeight:'600'},current:{borderColor:colors.border,borderRadius:menuRadii.control},
 row:{borderWidth:1,borderColor:'transparent',minHeight:52,paddingHorizontal:12,paddingVertical:12,flexDirection:'row',alignItems:'center',gap:16},
 label:{flex:1,flexShrink:1,color:colors.foreground,fontSize:16,lineHeight:24},
 count:{color:colors.muted,fontSize:15,lineHeight:23,flexShrink:1},
}));
