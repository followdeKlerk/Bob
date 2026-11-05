import React from 'react';
import {Modal,Pressable,ScrollView,StyleSheet,View} from 'react-native';
import {SafeAreaView,useSafeAreaInsets} from 'react-native-safe-area-context';
import {Menu as NavigationMenu,MessagesSquare,NotebookPen,Monitor,Users,Settings,MessageCircle,X,type LucideIcon} from 'lucide-react-native';
import {Text} from './app-text';
import type {BottomDestination} from './bottom-tabs';
import {menuRadii,themed,useTheme,useThemedValue} from '../theme';
import {SectionHeading,SectionActions,RoundAction} from './section-ui';

const destinations:{id:BottomDestination;icon:LucideIcon}[]=[
 {id:'Sessions',icon:MessagesSquare},
 {id:'Notes',icon:NotebookPen},
 {id:'Workstations',icon:Monitor},
 {id:'Agents',icon:Users},
 {id:'Settings',icon:Settings},
 {id:'Chat',icon:MessageCircle},
];
export function ChatNavigation({open,onOpen,onClose,onSelect,activeAgentCount=0,showTrigger=true}:{open:boolean;onOpen:()=>void;onClose:()=>void;onSelect:(destination:BottomDestination)=>void;activeAgentCount?:number;showTrigger?:boolean}){
 const {colors}=useTheme();
 const s=useThemedValue(sTheme);
 const insets=useSafeAreaInsets();
 const count=Number.isSafeInteger(activeAgentCount)&&activeAgentCount>0?activeAgentCount:0;
 const agentActivity=`${count} active ${count===1?'agent':'agents'}`;
 return <>
  {showTrigger&&<Pressable accessibilityRole="button" accessibilityLabel="Menu" accessibilityHint="Open navigation" accessibilityValue={{text:agentActivity}} accessibilityState={{expanded:open}} onPress={onOpen} style={s.trigger}>
   <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={s.glyph}>
    <NavigationMenu size={24} color={colors.foreground}/>
    {count>0&&<View testID="chat-menu-agent-badge" style={s.badge}><Text style={s.badgeText}>{count>99?'99+':count}</Text></View>}
   </View>
  </Pressable>}
  <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
   <View style={[s.overlay,{paddingTop:insets.top+12}]}>
    <Pressable accessibilityRole="button" accessibilityLabel="Dismiss navigation menu" onPress={onClose} style={StyleSheet.absoluteFill}/>
    <SafeAreaView edges={['left','right','bottom']} testID="chat-navigation-sheet" accessibilityViewIsModal onAccessibilityEscape={onClose} style={s.sheet}>
     <SectionHeading title="Menu"/>
     <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content} style={s.scroll}>
      {destinations.map(({id,icon:Icon})=><Pressable key={id} accessibilityRole="button" accessibilityLabel={id} accessibilityValue={id==='Agents'?{text:agentActivity}:undefined} accessibilityState={{selected:id==='Chat'}} onPress={()=>onSelect(id)} style={s.row}>
       <Icon size={23} color={colors.foreground}/>
       <Text style={s.label}>{id}</Text>
       {id==='Agents'&&count>0&&<Text accessible={false} style={s.count}>{count}</Text>}
      </Pressable>)}
     </ScrollView>
     <SectionActions leading={<RoundAction label="Close navigation menu" onPress={onClose} icon={X}/>}/>
    </SafeAreaView>
   </View>
  </Modal>
 </>;
}
const sTheme=themed(({colors})=>StyleSheet.create({
 trigger:{width:48,height:48,minWidth:48,minHeight:48,padding:0,alignItems:'center',justifyContent:'center'},
 glyph:{width:40,height:48,alignItems:'center',justifyContent:'center'},
 badge:{position:'absolute',right:-3,top:0,minWidth:18,minHeight:18,paddingHorizontal:4,borderRadius:12,backgroundColor:colors.selectedSurface,borderWidth:1,borderColor:colors.foreground,alignItems:'center',justifyContent:'center'},
 badgeText:{color:colors.foreground,fontSize:11,lineHeight:15,fontWeight:'700'},
 overlay:{flex:1,justifyContent:'flex-end',backgroundColor:'#00000088'},
 sheet:{width:'100%',maxWidth:760,maxHeight:'85%',alignSelf:'center',backgroundColor:colors.surface,borderTopLeftRadius:menuRadii.card,borderTopRightRadius:menuRadii.card},
 scroll:{flexGrow:0,flexShrink:1,minHeight:0},
 content:{paddingBottom:12,gap:4},
 row:{marginHorizontal:8,minHeight:56,paddingHorizontal:12,paddingVertical:14,flexDirection:'row',alignItems:'center',gap:16},
 label:{flex:1,flexShrink:1,color:colors.foreground,fontSize:17,lineHeight:25},
 count:{color:colors.muted,fontSize:15,lineHeight:23,flexShrink:1},
}));
