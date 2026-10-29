import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Alert,AppState,FlatList,Modal,Pressable,ScrollView,StyleSheet,Text,TextInput,View,useWindowDimensions} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {v4 as uuid} from 'uuid';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {ArrowLeft,Check,Plus,Pin,Trash2,X,RefreshCw,Search} from 'lucide-react-native';
import {NotesStore,type NotesTransport} from '../notes-store';
import {formatNote,noteSnippet,toggleNoteTask,type NoteFormat} from '../notes-format';
import {ChatMarkdown} from './chat-markdown';
import {colors} from '../theme';
import {SectionHeading,RoundAction} from './section-ui';
import {useKeyboardInset} from '../keyboard-inset';
import {NoteValue,type NoteRecord,type CategoryRecord} from '../../../src/notes-contracts';
type Value=ReturnType<typeof NoteValue.parse>;
type Draft=Value&{id?:string;baseRevision:number};
const empty=():Draft=>({title:'',body:'',categoryIds:[],pinned:false,trashed:false,color:'neutral',baseRevision:0});
// Preserve stored color IDs while presenting neutral shades. No note data is rewritten.
const palette={neutral:colors.surface,sage:'#303030',sand:'#383838',blue:'#202020',rose:'#444444'};
const valueOf=(note:Value):Value=>({title:note.title,body:note.body,categoryIds:note.categoryIds,pinned:note.pinned,trashed:note.trashed,color:note.color});
function Action({label,text=label,onPress,disabled=false,primary=false}:{label:string;text?:string;onPress:()=>void;disabled?:boolean;primary?:boolean}){
 return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={[s.action,disabled&&{opacity:0.4}]}><View style={[s.actionSurface,primary&&s.primary]}><Text style={[s.actionText,primary&&{color:colors.onAccent}]}>{text}</Text></View></Pressable>;
}
function NotesPreview({body,onToggle}:{body:string;onToggle:(line:number)=>void}){
 const blocks:React.ReactNode[]=[];let text:string[]=[],fence:string|undefined;
 const flush=(key:number)=>{if(text.length){blocks.push(<ChatMarkdown key={`text-${key}`} text={text.join('\n')}/>);text=[];}};
 body.split('\n').forEach((line,index)=>{
  const marker=line.match(/^ {0,3}(`{3,}|~{3,})/);
  if(marker){if(!fence)fence=marker[1][0];else if(fence===marker[1][0])fence=undefined;text.push(line);return;}
  if(fence){text.push(line);return;}
  const task=line.match(/^ {0,3}[-*] \[([ xX])\]\s+(.*)$/);
  if(!task){text.push(line);return;}
  flush(index);const checked=task[1]!==' ';
  blocks.push(<Pressable key={`task-${index}`} accessibilityRole="checkbox" accessibilityLabel={task[2]||'Checklist item'} accessibilityState={{checked}} onPress={()=>onToggle(index)} style={s.task}><View style={[s.check,checked&&{backgroundColor:colors.accent}]}>{checked&&<Check size={16} color={colors.onAccent}/>}</View><Text style={[s.body,checked&&{textDecorationLine:'line-through',color:colors.muted}]}>{task[2]}</Text></Pressable>);
 });flush(-1);return <View style={{gap:8}}>{blocks}</View>;
}
export function NotesScreen({backendId,request,visible,topInset}:{backendId:string;request:NotesTransport;visible:boolean;topInset:number;onBack?:()=>void}){
 const requestRef=useRef(request);requestRef.current=request;
 const store=useMemo(()=>new NotesStore(backendId,(...args)=>requestRef.current(...args)),[backendId]);
 const [,refresh]=useState(0);
 useEffect(()=>store.subscribe(()=>refresh(value=>value+1)),[store]);
 useEffect(()=>{if(visible)void store.sync();const timer=setInterval(()=>{if(AppState.currentState==='active'&&(visible||store.pendingCount))void store.sync();},8000);const listener=AppState.addEventListener('change',state=>{if(state==='active'&&(visible||store.pendingCount))void store.sync();});return()=>{clearInterval(timer);listener.remove();};},[store,visible]);
 const [query,setQuery]=useState(''),[category,setCategory]=useState(''),[trash,setTrash]=useState(false),[editing,setEditing]=useState(false),[draft,setDraft]=useState<Draft>(),[preview,setPreview]=useState(false),[saving,setSaving]=useState(false),[draftError,setDraftError]=useState(''),[editorReady,setEditorReady]=useState(false);
 const [managing,setManaging]=useState(false),[categoryForm,setCategoryForm]=useState<{id?:string;name:string;revision?:number}>({name:''});
 const editorWrites=useRef<Promise<unknown>>(Promise.resolve()),draftKey=`note-editor:v1:${backendId}`;
 const savingRef=useRef(false),categorySaving=useRef(false);
 const originalValue=useRef<string|undefined>(undefined);
 const [savingCategory,setSavingCategory]=useState(false);
 const selection=useRef({start:0,end:0}),bodyInput=useRef<React.ComponentRef<typeof TextInput>>(null);
 const keyboard=useKeyboardInset(),{width,fontScale}=useWindowDimensions();
 const columns=width>=350&&(fontScale??1)<=1.25?2:1;
 useEffect(()=>{let cancelled=false;void AsyncStorage.getItem(draftKey).then(raw=>{if(cancelled)return;if(raw){const saved=JSON.parse(raw);setDraft({...NoteValue.parse(valueOf(saved)),id:saved.id,baseRevision:saved.baseRevision??0});setEditing(true);}setEditorReady(true);}).catch(()=>{if(!cancelled)setDraftError('The unsaved note draft could not be loaded. It has not been overwritten.');});return()=>{cancelled=true;};},[draftKey]);
 useEffect(()=>{if(!editorReady)return;editorWrites.current=editorWrites.current.catch(()=>{}).then(()=>draft?AsyncStorage.setItem(draftKey,JSON.stringify(draft)):AsyncStorage.removeItem(draftKey));void editorWrites.current.catch(()=>{});},[draft,draftKey,editorReady]);
 const categories=store.categories.filter(item=>!item.deleted).sort((a,b)=>a.name.localeCompare(b.name));
 const categoryNames=new Map(categories.map(item=>[item.id,item.name]));
 useEffect(()=>{if(category&&store.ready&&!categories.some(item=>item.id===category))setCategory('');},[category,categories,store.ready]);
 const notes=store.notes.filter(note=>note.trashed===trash&&(!category||note.categoryIds.includes(category))&&`${note.title}\n${note.body}\n${note.categoryIds.map(id=>categoryNames.get(id)??'').join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.updatedAt-a.updatedAt||a.id.localeCompare(b.id));
 const invoke=(action:()=>Promise<unknown>)=>{void action().catch(error=>Alert.alert('Notes',String(error.message??error)));};
 const open=(note?:NoteRecord)=>{
  if(!editorReady)return;
  const next=()=>{originalValue.current=note?JSON.stringify(valueOf(note)):undefined;setDraft(note?{...valueOf(note),id:note.id,baseRevision:note.revision}:empty());setPreview(false);selection.current={start:0,end:0};setEditing(true);};
  if(draft)Alert.alert('Keep your unsaved draft?','Resume your draft, or discard it to open another note.',[{text:'Cancel',style:'cancel'},{text:'Resume draft',onPress:()=>setEditing(true)},{text:'Discard draft',style:'destructive',onPress:next}]);else next();
 };
 const save=async()=>{
  if(!draft||savingRef.current)return;
  // Back and explicit Save share the same durable local queue and duplicate guard.
  savingRef.current=true;setSaving(true);
  try{
   const value=valueOf(draft);
   const emptyNew=!draft.id&&!draft.title.trim()&&!draft.body.trim();
   const unchanged=draft.id&&originalValue.current===JSON.stringify(value);
   if(!emptyNew&&!unchanged){
    const id=draft.id??uuid();setDraft({...draft,id});
    await store.saveNote(value,id,draft.baseRevision);
   }
   setEditing(false);setDraft(undefined);originalValue.current=undefined;
  }catch(error){Alert.alert('Could not save note',`${String((error as Error).message??error)} Your text is still here. Try going back again to save.`);}
  finally{savingRef.current=false;setSaving(false);}
 };
 const closeEditor=()=>{void save();};
 const format=(kind:NoteFormat)=>{
  if(!draft)return;const result=formatNote(draft.body,selection.current.start,selection.current.end,kind);if(result.text.length>100000)return;
  setDraft({...draft,body:result.text});selection.current=result.selection;bodyInput.current?.focus();bodyInput.current?.setNativeProps({selection:result.selection});
 };
 if(!visible)return null;
 return <View testID="notes-screen" style={[StyleSheet.absoluteFill,s.screen,{paddingTop:topInset,zIndex:25}]}>
  <SectionHeading title="Notes"><RoundAction label="Create note" compact icon={Plus} disabled={!store.ready||!editorReady} onPress={()=>open()} primary/></SectionHeading>
  <FlatList key={columns===2?'grid':'list'} data={notes} numColumns={columns} keyExtractor={note=>note.id} contentContainerStyle={{paddingHorizontal:20,paddingBottom:28,gap:12}} columnWrapperStyle={columns===2?{gap:12}:undefined} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
   ListHeaderComponent={<View style={{gap:12,marginBottom:4}}>
    <View style={s.search}><Search size={20} color={colors.muted}/><TextInput accessibilityLabel="Search notes" placeholder="Search notes" placeholderTextColor={colors.muted} value={query} onChangeText={setQuery} style={s.searchInput}/></View>
    <View style={{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:8}}><Action label="Categories" onPress={()=>setManaging(true)} disabled={!store.ready}/><Action label={trash?'Show notes':'Show trash'} text={trash?'Notes':'Trash'} onPress={()=>setTrash(value=>!value)}/><View style={{flex:1}}/><RoundAction label="Sync notes" compact icon={RefreshCw} onPress={()=>void store.sync()} disabled={store.syncing||!store.ready}/></View>
    {categories.length>0&&<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:8}}><Pressable accessibilityRole="tab" accessibilityLabel="All categories" accessibilityState={{selected:!category}} onPress={()=>setCategory('')} style={[s.chip,!category&&s.selected]}><Text style={s.small}>All</Text></Pressable>{categories.map(item=><Pressable key={item.id} accessibilityRole="tab" accessibilityLabel={`Filter category ${item.name}`} accessibilityState={{selected:category===item.id}} onPress={()=>setCategory(item.id)} style={[s.chip,category===item.id&&s.selected]}><Text style={s.small}>{item.name}</Text></Pressable>)}</ScrollView>}
    {!!draftError&&<View style={{gap:8}}><Text style={s.status}>{draftError}</Text><Action label="Discard unreadable draft" onPress={()=>Alert.alert('Discard unreadable draft?','Only the unsaved editor draft will be removed. Your saved notes are kept.',[{text:'Cancel',style:'cancel'},{text:'Discard draft',style:'destructive',onPress:()=>{setDraftError('');setDraft(undefined);setEditorReady(true);}}])}/></View>}
    {(!store.ready||store.error||store.pendingCount>0)&&<Text accessibilityLiveRegion="polite" style={s.status}>{!store.ready?(store.error||'Loading notes…'):store.error||`${store.pendingCount} pending · Saved on this device`}</Text>}
   </View>}
   ListEmptyComponent={<Text style={[s.body,{paddingVertical:24,color:colors.muted}]}>{!store.ready?'Your saved notes will appear here.':query||category?'No matching notes.':trash?'Trash is empty.':'No notes yet. Tap + to add one.'}</Text>}
   renderItem={({item})=><View style={[s.card,{backgroundColor:palette[item.color],flex:1}]}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Open note ${item.title||'Untitled'}`} disabled={!editorReady} onPress={()=>open(item)} style={{gap:10,padding:14}}>
     {item.pinned&&<Pin size={15} color={colors.accent}/>}<Text numberOfLines={3} style={s.noteTitle}>{item.title||'Untitled'}</Text>{!!item.body&&<Text numberOfLines={6} style={s.snippet}>{noteSnippet(item.body)}</Text>}
     {!!item.categoryIds.length&&<Text numberOfLines={2} style={s.status}>{item.categoryIds.map(id=>categoryNames.get(id)).filter(Boolean).join(' · ')}</Text>}
     {item.conflictOf&&<Text style={s.status}>Preserved conflict copy</Text>}{store.isPending('note',item.id)&&<Text style={s.status}>{store.localError?'Local save failed':'Saved locally'}</Text>}
    </Pressable>
    <View style={s.cardActions}><Pressable accessibilityRole="button" accessibilityLabel={`${item.pinned?'Unpin':'Pin'} note ${item.title||'Untitled'}`} onPress={()=>invoke(()=>store.saveNote({...valueOf(item),pinned:!item.pinned},item.id))} style={s.icon}><Pin size={18} color={item.pinned?colors.accent:colors.muted}/></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`${item.trashed?'Restore':'Trash'} note ${item.title||'Untitled'}`} onPress={()=>invoke(()=>store.saveNote({...valueOf(item),trashed:!item.trashed},item.id))} style={s.icon}>{item.trashed?<ArrowLeft size={18} color={colors.muted}/>:<Trash2 size={18} color={colors.muted}/>}</Pressable></View>
   </View>}/>
  {editing&&draft&&<Modal visible animationType="slide" onRequestClose={closeEditor}><SafeAreaView style={[s.screen,{flex:1,paddingBottom:keyboard}]}>
   <View style={s.heading}><Pressable accessibilityRole="button" accessibilityLabel="Save note and go back" disabled={saving} onPress={closeEditor} style={s.icon}><ArrowLeft size={22} color={colors.foreground}/></Pressable><Text style={[s.title,{fontSize:19}]}>{draft.id?'Edit note':'New note'}</Text><Action label={saving?'Saving note…':'Save note'} primary disabled={saving||(!draft.title.trim()&&!draft.body.trim())} onPress={()=>void save()}/></View>
   <ScrollView keyboardShouldPersistTaps="handled" pointerEvents={saving?'none':'auto'} contentContainerStyle={{padding:16,gap:16}}>
    <TextInput accessibilityLabel="Note title" editable={!saving} placeholder="Title" placeholderTextColor={colors.muted} value={draft.title} maxLength={200} onChangeText={title=>setDraft({...draft,title})} style={[s.input,{fontSize:23,fontWeight:'600'}]}/>
    <View style={s.wrap}>{(['bold','italic','heading','bullet','checklist'] as const).map(kind=><Action key={kind} label={{bold:'Bold',italic:'Italic',heading:'Heading',bullet:'Bullet list',checklist:'Checklist'}[kind]} disabled={preview} onPress={()=>format(kind)}/>)}<Action label={preview?'Edit text':'Preview note'} onPress={()=>setPreview(value=>!value)}/></View>
    {preview?<NotesPreview body={draft.body} onToggle={line=>setDraft({...draft,body:toggleNoteTask(draft.body,line)})}/>:<TextInput ref={bodyInput} accessibilityLabel="Note body" editable={!saving} placeholder="Write a note…" placeholderTextColor={colors.muted} multiline textAlignVertical="top" value={draft.body} maxLength={100000} onSelectionChange={event=>{selection.current=event.nativeEvent.selection;}} onChangeText={body=>setDraft({...draft,body})} style={[s.input,{minHeight:240,lineHeight:26}]}/>}
    <Text style={s.label}>Categories</Text><View style={s.wrap}>{categories.length?categories.map(item=><Pressable key={item.id} accessibilityRole="checkbox" accessibilityLabel={`Assign category ${item.name}`} accessibilityState={{checked:draft.categoryIds.includes(item.id)}} onPress={()=>setDraft({...draft,categoryIds:draft.categoryIds.includes(item.id)?draft.categoryIds.filter(id=>id!==item.id):draft.categoryIds.length<20?[...draft.categoryIds,item.id]:draft.categoryIds})} style={[s.chip,draft.categoryIds.includes(item.id)&&s.selected]}><Text style={s.small}>{item.name}</Text></Pressable>):<Text style={s.status}>Create categories from the Notes screen.</Text>}</View>
    <Text style={s.label}>Shade</Text><View style={s.wrap}>{(Object.keys(palette) as (keyof typeof palette)[]).map(color=><Pressable key={color} accessibilityRole="radio" accessibilityLabel={`Note color ${color}`} accessibilityState={{checked:draft.color===color}} onPress={()=>setDraft({...draft,color})} style={[s.color,{backgroundColor:palette[color]},draft.color===color&&s.selected]}>{draft.color===color&&<Check size={20} color={colors.foreground}/>}</Pressable>)}</View>
    <Action label={draft.pinned?'Unpin this note':'Pin this note'} onPress={()=>setDraft({...draft,pinned:!draft.pinned})}/>
    <Action label="Discard unsaved draft" onPress={()=>Alert.alert('Discard unsaved changes?','Saved notes and server copies are not deleted.',[{text:'Keep editing',style:'cancel'},{text:'Discard draft',style:'destructive',onPress:()=>{setEditing(false);setDraft(undefined);}}])}/>
   </ScrollView>
  </SafeAreaView></Modal>}
  {managing&&<Modal visible animationType="slide" onRequestClose={()=>setManaging(false)}><SafeAreaView style={[s.screen,{flex:1,paddingBottom:keyboard}]}><View style={s.heading}><Text style={s.title}>Categories</Text><Pressable accessibilityRole="button" accessibilityLabel="Close categories" onPress={()=>setManaging(false)} style={s.icon}><X size={22} color={colors.foreground}/></Pressable></View><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{padding:16,gap:12}}>
   <TextInput accessibilityLabel="Category name" editable={!savingCategory} placeholder="Category name" placeholderTextColor={colors.muted} maxLength={60} value={categoryForm.name} onChangeText={name=>setCategoryForm({...categoryForm,name})} style={s.input}/>
   <Action label={categoryForm.id?'Save category name':'Create category'} primary disabled={savingCategory||!categoryForm.name.trim()} onPress={()=>invoke(async()=>{if(categorySaving.current)return;categorySaving.current=true;setSavingCategory(true);try{const id=categoryForm.id??uuid();setCategoryForm({...categoryForm,id});await store.saveCategory({name:categoryForm.name.trim(),deleted:false},id,categoryForm.revision);setCategoryForm({name:''});}finally{categorySaving.current=false;setSavingCategory(false);}})}/>
   {categoryForm.id&&<Action label="Cancel category rename" onPress={()=>setCategoryForm({name:''})}/>}
   {categories.map((item:CategoryRecord)=><View key={item.id} style={[s.card,{padding:12,gap:8}]}><Text style={s.label}>{item.name}</Text><View style={s.wrap}><Action label={`Rename ${item.name}`} onPress={()=>setCategoryForm({id:item.id,name:item.name,revision:item.revision})}/><Action label={`Remove category ${item.name}`} onPress={()=>Alert.alert('Remove category?','Your notes will be kept.',[{text:'Cancel',style:'cancel'},{text:'Remove',style:'destructive',onPress:()=>invoke(async()=>{await store.saveCategory({name:item.name,deleted:true},item.id);if(category===item.id)setCategory('');})}])}/></View></View>)}
  </ScrollView></SafeAreaView></Modal>}
 </View>;
}
const s=StyleSheet.create({search:{flexDirection:'row',alignItems:'center',gap:10,paddingHorizontal:14,backgroundColor:colors.surface,borderRadius:16},searchInput:{flex:1,color:colors.foreground,fontSize:16,minHeight:52,paddingVertical:12},screen:{backgroundColor:colors.background},heading:{flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:12,paddingVertical:8},title:{flex:1,color:colors.foreground,fontSize:28,fontWeight:'600'},icon:{minWidth:48,minHeight:48,alignItems:'center',justifyContent:'center'},input:{color:colors.foreground,backgroundColor:colors.surface,borderRadius:14,padding:14,fontSize:17},action:{minHeight:48,justifyContent:'center'},actionSurface:{minHeight:32,paddingHorizontal:10,paddingVertical:6,borderRadius:12,backgroundColor:colors.surface,alignItems:'center',justifyContent:'center'},primary:{backgroundColor:colors.accent},actionText:{color:colors.foreground,fontSize:14,fontWeight:'500'},chip:{minHeight:44,paddingHorizontal:14,paddingVertical:10,borderRadius:24,borderWidth:1,borderColor:colors.border,justifyContent:'center'},selected:{borderColor:colors.accent,borderWidth:2},small:{color:colors.foreground,fontSize:14},status:{color:colors.muted,fontSize:13,lineHeight:20},body:{color:colors.body,fontSize:17,lineHeight:26,flexShrink:1},card:{borderRadius:20,borderWidth:1,borderColor:colors.subtle,overflow:'hidden'},cardActions:{flexDirection:'row',justifyContent:'flex-end',paddingHorizontal:4},noteTitle:{fontSize:17,lineHeight:24,fontWeight:'600',color:colors.foreground},snippet:{fontSize:14,lineHeight:22,color:colors.body},wrap:{flexDirection:'row',flexWrap:'wrap',gap:8},label:{color:colors.foreground,fontSize:16,fontWeight:'500'},color:{height:48,width:48,borderRadius:24,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:colors.border},task:{minHeight:48,flexDirection:'row',alignItems:'center',gap:12},check:{width:24,height:24,borderRadius:5,borderWidth:1,borderColor:colors.accent,alignItems:'center',justifyContent:'center'}});
