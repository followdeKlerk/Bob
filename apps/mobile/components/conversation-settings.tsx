import React,{useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Platform,Pressable,StyleSheet,Text,TextInput,View} from 'react-native';
import {ChevronDown,ChevronRight,FileText} from 'lucide-react-native';
import {colors} from '../theme';
export type ConversationChange={instructions:string|null}|{cwd:string};
export type SavedConversationSettings={instructions:string|null;cwd:string};
type Props={instructions:string;folder:string;inherited:boolean;onInstructionsChange:(text:string)=>void;onFolderChange:(text:string)=>void;onLoad:()=>Promise<SavedConversationSettings>;onSave:(change:ConversationChange)=>Promise<SavedConversationSettings>};
export function ConversationSettings({instructions,folder,inherited,onInstructionsChange,onFolderChange,onLoad,onSave}:Props){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState<'instructions'|'default'|'folder'>(),[feedback,setFeedback]=useState(''),[error,setError]=useState(false);
 const [loading,setLoading]=useState(false),[loaded,setLoaded]=useState(false),[loadError,setLoadError]=useState('');
 const loadedRef=useRef(false),loadingRef=useRef(false);
 const [feedbackKind,setFeedbackKind]=useState<'instructions'|'default'|'folder'>();
 const [saved,setSaved]=useState({instructions:inherited?null:instructions,cwd:folder});
 const alive=useRef(true),pending=useRef(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 async function load(){
  if(loadingRef.current||loadedRef.current)return;
  loadingRef.current=true;setLoading(true);setLoadError('');
  try{
   const result=await onLoad();
   if(!alive.current)return;
   setSaved(result);loadedRef.current=true;setLoaded(true);
  }catch(e){if(alive.current)setLoadError(String((e as Error).message??e));}
  finally{loadingRef.current=false;if(alive.current)setLoading(false);}
 }
 function toggle(){setOpen(value=>!value);if(!open&&!loadedRef.current)void load();}
 async function save(kind:'instructions'|'default'|'folder'){
  if(pending.current||!loadedRef.current)return;pending.current=true;setBusy(kind);setFeedbackKind(kind);setFeedback('');setError(false);
  const change:ConversationChange=kind==='folder'?{cwd:folder}:{instructions:kind==='default'?null:instructions};
  try{
   const result=await onSave(change);
   if(!alive.current)return;
   setSaved(result);setFeedback(kind==='folder'?'Folder saved.':kind==='default'?'Using backend default.':'Instructions saved.');
  }catch(e){if(alive.current){setError(true);setFeedback(String((e as Error).message??e));}}
  finally{pending.current=false;if(alive.current)setBusy(undefined);}
 }
 const changeInstructions=(text:string)=>{onInstructionsChange(text);setFeedback('');};
 const changeFolder=(text:string)=>{onFolderChange(text);setFeedback('');};
 const locked=!!busy;
 const mode=instructions!==(saved.instructions??'')?'Unsaved':inherited?'Backend default':'Custom';
 const notice=!!feedback&&<Text accessibilityRole="text" accessibilityLiveRegion="polite" style={[s.feedback,error&&{color:colors.foreground}]}>{feedback}</Text>;
 const action=(label:string,text:string,kind:'instructions'|'default'|'folder',disabled:boolean,primary=false)=><Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled:locked||disabled,busy:busy===kind}} disabled={locked||disabled} onPress={()=>void save(kind)} style={[s.action,primary&&s.primary,(locked||disabled)&&{opacity:.4}]}><Text style={[s.actionText,primary&&{color:colors.onAccent}]}>{busy===kind?'Saving…':text}</Text></Pressable>;
 return <View>
  <Pressable accessibilityRole="button" accessibilityLabel="Instructions & folder" accessibilityState={{expanded:open,disabled:locked,busy:loading||locked}} disabled={locked} onPress={toggle} style={s.heading}>
   <View style={s.icon}><FileText size={20} color={colors.accent}/></View><Text style={s.headingText}>Instructions & folder</Text>{loading?<ActivityIndicator testID="conversation-settings-loading" accessibilityLabel="Loading instructions and folder" size="small" color={colors.accent}/>:open?<ChevronDown size={17} color={colors.muted}/>:<ChevronRight size={17} color={colors.muted}/>}
  </Pressable>
  {open&&!!loadError&&<View style={s.body}><Text accessibilityLiveRegion="polite" style={[s.feedback,{color:colors.foreground}]}>{loadError}</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry loading instructions and folder" onPress={()=>void load()} style={[s.action,{alignSelf:'flex-start'}]}><Text style={s.actionText}>Retry</Text></Pressable></View>}
  {open&&loaded&&<View testID="conversation-settings-fields" style={s.body}>
   <View style={s.labelRow}><Text accessibilityRole="header" style={s.label}>Instructions</Text><Text style={s.mode}>{mode}</Text></View>
   <TextInput accessibilityLabel="Conversation instructions" editable={!locked} placeholder="Add instructions for this conversation…" placeholderTextColor={colors.muted} selectionColor={colors.accent} multiline textAlignVertical="top" value={instructions} onChangeText={changeInstructions} style={[s.input,s.instructions]}/>
   <View style={s.actions}>
    {action('Save conversation override','Save','instructions',saved.instructions===instructions,true)}
    {action('Use backend default instructions','Use default','default',inherited&&!instructions)}
   </View>
   {feedbackKind!=='folder'&&notice}
   <View style={s.folder}>
    <Text accessibilityRole="header" style={s.label}>Folder</Text><Text style={s.hint}>Absolute path on the selected workstation.</Text>
    <TextInput accessibilityLabel="Backend working directory" editable={!locked} placeholder="/path/to/project" placeholderTextColor={colors.muted} selectionColor={colors.accent} autoCapitalize="none" autoCorrect={false} spellCheck={false} value={folder} onChangeText={changeFolder} style={[s.input,s.path]}/>
    <View style={s.actions}>{action('Set conversation folder','Save folder','folder',!folder.trim()||saved.cwd===folder,true)}</View>
    {feedbackKind==='folder'&&notice}
   </View>
  </View>}
 </View>;
}
const s=StyleSheet.create({
 heading:{flexDirection:'row',alignItems:'center',gap:12,minHeight:62,paddingHorizontal:2,paddingVertical:10},icon:{width:34,height:34,borderRadius:11,backgroundColor:colors.iconSurface,alignItems:'center',justifyContent:'center'},headingText:{flex:1,color:colors.foreground,fontSize:16,lineHeight:23},
 body:{paddingHorizontal:2,paddingTop:10,paddingBottom:16,gap:12},labelRow:{flexDirection:'row',alignItems:'center',flexWrap:'wrap',gap:8},label:{color:colors.foreground,fontSize:15,fontWeight:'600'},mode:{color:colors.accent,fontSize:12,lineHeight:18},hint:{color:colors.muted,fontSize:13,lineHeight:20},
 input:{backgroundColor:colors.background,borderWidth:1,borderColor:colors.border,borderRadius:14,paddingHorizontal:12,paddingVertical:12,color:colors.foreground,fontSize:16,lineHeight:24},instructions:{minHeight:132,maxHeight:260},path:{fontSize:14,fontFamily:Platform.OS==='ios'?'Menlo':'monospace'},
 actions:{flexDirection:'row',flexWrap:'wrap',gap:8},action:{minHeight:48,minWidth:88,paddingVertical:12,paddingHorizontal:16,borderRadius:14,backgroundColor:colors.surface,alignItems:'center',justifyContent:'center'},primary:{backgroundColor:colors.accent},actionText:{color:colors.foreground,fontSize:15,lineHeight:22,fontWeight:'600'},folder:{borderTopWidth:1,borderColor:colors.subtle,marginTop:8,paddingTop:20,gap:12},feedback:{color:colors.accent,fontSize:13,lineHeight:20},
});
