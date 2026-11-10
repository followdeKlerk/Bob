import {menuButtonChrome} from '../menu-button-style';
import React,{useEffect,useRef,useState} from 'react';
import {Alert,BackHandler,Keyboard,Pressable,ScrollView,StyleSheet,View} from 'react-native';
import {Text,TextInput} from './app-text';
import {SectionAction,SectionActions,SectionBody} from './section-ui';
import {themed,useThemedValue,useTheme} from '../theme';
import type {AgentSession} from '../use-agent-overview';
import type {SessionAction} from './side-drawer';
/** Session metadata actions only; opening this sheet never selects or runs a chat. */
export function SessionActions({session,onClose,onAction}:{session:AgentSession;onClose:()=>void;onAction:(id:string,action:SessionAction,title?:string)=>Promise<void>}){
 const s=useThemedValue(styles),{colors}=useTheme();
 const [renaming,setRenaming]=useState(false),[title,setTitle]=useState(session.title),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const lock=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{const listener=BackHandler.addEventListener('hardwareBackPress',()=>{if(!lock.current){Keyboard.dismiss();onClose();}return true;});return()=>listener.remove();},[onClose]);
 async function perform(action:SessionAction,value?:string){
  if(lock.current||!mounted.current)return;
  lock.current=true;setBusy(true);setError('');
  try{await onAction(String(session.conversationId),action,value);if(mounted.current){Keyboard.dismiss();onClose();}}
  catch(e){if(mounted.current)setError(String((e as Error).message??e));}
  finally{lock.current=false;if(mounted.current)setBusy(false);}
 }
 const options:{label:string;action:SessionAction}[]=session.trashed?[{label:'Restore conversation',action:'restore'}]:[
  {label:'Rename',action:'rename'},{label:session.pinned?'Unpin':'Pin to top',action:session.pinned?'unpin':'pin'},
  {label:session.archived?'Unarchive':'Archive',action:session.archived?'unarchive':'archive'},{label:'Delete',action:'delete'},
 ];
 function choose(action:SessionAction){
  if(action==='rename'){setRenaming(true);return;}
  if(action==='delete'){Alert.alert('Move conversation to Trash?','Messages remain recoverable in Trash. This does not stop any running work.',[{text:'Cancel',style:'cancel'},{text:'Move to Trash',style:'destructive',onPress:()=>void perform('delete')}]);return;}
  void perform(action);
 }
 return <View testID="inline-session-actions" accessibilityViewIsModal onAccessibilityEscape={()=>{if(!busy)onClose();}} style={s.overlay}>
  <Pressable accessibilityRole="button" accessibilityLabel="Dismiss session controls" disabled={busy} onPress={()=>{Keyboard.dismiss();onClose();}} style={StyleSheet.absoluteFill}/>
  <View testID="session-action-sheet" style={s.sheet}><SectionBody surfaceColor={colors.surface} style={s.body} footer={<SectionActions overlay leading={<SectionAction label={renaming?'Cancel rename':'Close session controls'} text="Cancel" disabled={busy} onPress={()=>{Keyboard.dismiss();onClose();}}/>}>{renaming&&<SectionAction label="Save conversation name" text="Save" primary busy={busy} disabled={busy||!title.trim()} onPress={()=>void perform('rename',title.trim())}/>}</SectionActions>}>{clearance=>
   <ScrollView style={s.scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={[s.content,{paddingBottom:clearance+16}]}>
   <Text typography="ui" accessibilityRole="header" style={s.title}>{renaming?'Rename conversation':session.title}</Text>
   {renaming?<TextInput typography="ui" autoFocus accessibilityLabel="Conversation name" value={title} onChangeText={setTitle} maxLength={160} editable={!busy} style={s.input} placeholderTextColor={colors.muted}/>:options.map(option=><Pressable key={option.action} accessibilityRole="button" accessibilityLabel={option.label} accessibilityState={{disabled:busy}} disabled={busy} onPress={()=>choose(option.action)} style={[s.option,busy&&{opacity:0.4}]}><Text typography="ui" style={s.optionText}>{option.label}</Text></Pressable>)}
   {!!error&&<Text typography="ui" accessibilityRole="alert" style={s.error}>{error}</Text>}
  </ScrollView>}</SectionBody></View>
 </View>;
}
const styles=themed(({colors,menuChrome,shadows})=>StyleSheet.create({
 overlay:{position:'absolute',top:0,bottom:0,left:0,right:0,zIndex:50,backgroundColor:'#00000077',justifyContent:'flex-end'},sheet:{maxHeight:'100%',flexShrink:1,backgroundColor:colors.surface},body:{flex:undefined,flexShrink:1},scroll:{flexGrow:0,flexShrink:1,minHeight:0},content:{padding:16,gap:8},option:{...menuButtonChrome({colors,shadows}).pill,minHeight:48,minWidth:48,padding:8,justifyContent:'center'},optionText:{...menuButtonChrome({colors,shadows}).label,fontSize:14,lineHeight:24,color:colors.foreground},title:{fontSize:16,lineHeight:24,fontWeight:'600',color:colors.foreground},input:{...menuChrome.input,minHeight:48,fontSize:16,color:colors.foreground,padding:8},error:{color:colors.foreground,fontSize:13,lineHeight:24},
}));
