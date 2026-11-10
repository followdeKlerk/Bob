import {PageSearch} from './page-search';
import {menuButtonChrome} from '../menu-button-style';
import {Text,TextInput} from './app-text';
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Alert,AppState,FlatList,Modal,Platform,Pressable,ScrollView,StyleSheet,View} from 'react-native';
import {SafeAreaView,useSafeAreaInsets} from 'react-native-safe-area-context';
import {v4 as uuid} from 'uuid';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {ArrowLeft,Check,Plus,Pin,Trash2,RefreshCw,Eye,Pencil,Tags} from 'lucide-react-native';
import {NotesStore,type NotesTransport} from '../notes-store';
import {noteSnippet,toggleNoteTask} from '../notes-format';
import {ChatMarkdown} from './chat-markdown';
import {themed,useTheme,useThemedValue} from '../theme';
import {SectionHeading,SectionActions,SectionBody,RoundAction,SectionAction} from './section-ui';
import {useKeyboardInset} from '../keyboard-inset';
import {NoteValue,type NoteRecord,type CategoryRecord} from '../../../src/notes-contracts';
type Value=ReturnType<typeof NoteValue.parse>;
type Draft=Value&{id?:string;baseRevision:number};
const empty=():Draft=>({title:'',body:'',categoryIds:[],pinned:false,trashed:false,color:'neutral',baseRevision:0});
// Preserve stored color IDs while presenting neutral shades. No note data is rewritten.
const paletteTheme=themed(({noteShades})=>noteShades);
const shadeLabels={neutral:'Standard gray',sage:'Medium gray',sand:'Light gray',blue:'Dark gray',rose:'Lightest gray'};
const valueOf=(note:Value):Value=>({title:note.title,body:note.body,categoryIds:note.categoryIds,pinned:note.pinned,trashed:note.trashed,color:note.color});
function Action({label,text=label,onPress,disabled=false,primary=false}:{label:string;text?:string;onPress:()=>void;disabled?:boolean;primary?:boolean}){
 const {colors}=useTheme();
 const s=useThemedValue(sTheme);

 return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={[s.action,disabled&&{opacity:0.4}]}><View style={[s.actionSurface,primary&&s.primary]}><Text typography="ui" style={[s.actionText,primary&&{fontWeight:'600'}]}>{text}</Text></View></Pressable>;
}
function NotesPreview({body,onToggle}:{body:string;onToggle:(line:number)=>void}){
 const {colors}=useTheme();
 const s=useThemedValue(sTheme);

 const blocks:React.ReactNode[]=[];let text:string[]=[],fence:string|undefined;
 const flush=(key:number)=>{if(text.length){blocks.push(<ChatMarkdown key={`text-${key}`} text={text.join('\n')}/>);text=[];}};
 body.split('\n').forEach((line,index)=>{
  const marker=line.match(/^ {0,3}(`{3,}|~{3,})/);
  if(marker){if(!fence)fence=marker[1][0];else if(fence===marker[1][0])fence=undefined;text.push(line);return;}
  if(fence){text.push(line);return;}
  const task=line.match(/^ {0,3}[-*] \[([ xX])\]\s+(.*)$/);
  if(!task){text.push(line);return;}
  flush(index);const checked=task[1]!==' ';
  blocks.push(<Pressable key={`task-${index}`} accessibilityRole="checkbox" accessibilityLabel={task[2]||'Checklist item'} accessibilityState={{checked}} onPress={()=>onToggle(index)} style={s.task}><View style={[s.check,checked&&{backgroundColor:colors.accent}]}>{checked&&<Check size={16} color={colors.onAccent}/>}</View><Text typography="ui" style={[s.body,checked&&{textDecorationLine:'line-through',color:colors.muted}]}>{task[2]}</Text></Pressable>);
 });flush(-1);return <View style={{gap:8}}>{blocks}</View>;
}
export function NotesScreen({menu,backendId,request,visible,topInset}:{menu?:React.ReactNode;backendId:string;request:NotesTransport;visible:boolean;topInset:number;onBack?:()=>void}){
 const {colors}=useTheme();
 const palette=useThemedValue(paletteTheme);
 const s=useThemedValue(sTheme);

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
 const bodyInput=useRef<React.ComponentRef<typeof TextInput>>(null);
 const insets=useSafeAreaInsets();
 const keyboard=useKeyboardInset();
 const categoryScroll=useRef<React.ComponentRef<typeof ScrollView>>(null),categoryInput=useRef<React.ComponentRef<typeof TextInput>>(null);
 // Android RN Modal owns dialog ADJUST_RESIZE; BobKeyboard only observes the Activity.
 // Keep the existing JS keyboard owner on iOS, never apply Activity IME padding to Android dialogs.
 const modalKeyboard=Platform.OS==='android'?0:keyboard;
 useEffect(()=>{let cancelled=false;void AsyncStorage.getItem(draftKey).then(raw=>{if(cancelled)return;if(raw){const saved=JSON.parse(raw);setDraft({...NoteValue.parse(valueOf(saved)),id:saved.id,baseRevision:saved.baseRevision??0});setEditing(true);}setEditorReady(true);}).catch(()=>{if(!cancelled)setDraftError('The unsaved note draft could not be loaded. It has not been overwritten.');});return()=>{cancelled=true;};},[draftKey]);
 useEffect(()=>{if(!editorReady)return;editorWrites.current=editorWrites.current.catch(()=>{}).then(()=>draft?AsyncStorage.setItem(draftKey,JSON.stringify(draft)):AsyncStorage.removeItem(draftKey));void editorWrites.current.catch(()=>{});},[draft,draftKey,editorReady]);
 const categories=store.categories.filter(item=>!item.deleted).sort((a,b)=>a.name.localeCompare(b.name));
 const categoryNames=new Map(categories.map(item=>[item.id,item.name]));
 useEffect(()=>{if(category&&store.ready&&!categories.some(item=>item.id===category))setCategory('');},[category,categories,store.ready]);
 const notes=store.notes.filter(note=>note.trashed===trash&&(!category||note.categoryIds.includes(category))&&`${note.title}\n${note.body}\n${note.categoryIds.map(id=>categoryNames.get(id)??'').join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.updatedAt-a.updatedAt||a.id.localeCompare(b.id));
 const invoke=(action:()=>Promise<unknown>)=>{void action().catch(error=>Alert.alert('Notes',String(error.message??error)));};
 const open=(note?:NoteRecord)=>{
  if(!editorReady)return;
  const next=()=>{originalValue.current=note?JSON.stringify(valueOf(note)):undefined;setDraft(note?{...valueOf(note),id:note.id,baseRevision:note.revision}:empty());setPreview(false);setEditing(true);};
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
 const saveCategory=()=>invoke(async()=>{
  if(categorySaving.current)return;categorySaving.current=true;setSavingCategory(true);
  try{const id=categoryForm.id??uuid();setCategoryForm({...categoryForm,id});await store.saveCategory({name:categoryForm.name.trim(),deleted:false},id,categoryForm.revision);setCategoryForm({name:''});}
  finally{categorySaving.current=false;setSavingCategory(false);}
 });
 if(!visible)return null;
 // This absolute overlay owns its IME clearance; App already consumes the bottom safe area.
 return <View testID="notes-screen" style={[StyleSheet.absoluteFill,s.screen,{paddingTop:topInset,paddingBottom:Math.max(0,keyboard-insets.bottom),zIndex:25}]}>
  <SectionHeading title="Notes"/>
  <View testID="notes-search-header" style={s.searchHeader}><PageSearch label="Search notes" placeholder="Search notes" value={query} onChangeText={setQuery}/></View>
  <SectionBody footer={<SectionActions overlay menu={menu}><RoundAction label={trash?'Show notes':'Show trash'} icon={trash?ArrowLeft:Trash2} selected={trash} onPress={()=>setTrash(value=>!value)}/><RoundAction label="Categories" icon={Tags} onPress={()=>setManaging(true)} disabled={!store.ready}/><RoundAction label="Sync notes" icon={RefreshCw} onPress={()=>void store.sync()} disabled={store.syncing||!store.ready}/><RoundAction label="Create note" icon={Plus} disabled={!store.ready||!editorReady} onPress={()=>open()} primary/></SectionActions>}>{clearance=>
  <FlatList style={s.bodyRegion} data={notes} numColumns={1} keyExtractor={note=>note.id} contentContainerStyle={{paddingHorizontal:16,paddingBottom:clearance+16,gap:8}} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
   ListHeaderComponent={<View testID="notes-search-and-filters" style={{gap:8,marginBottom:8}}>
    {categories.length>0&&<ScrollView testID="notes-category-strip" horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={s.categoryScroller} contentContainerStyle={s.categoryStrip}><Pressable accessibilityRole="tab" accessibilityLabel="All categories" accessibilityState={{selected:!category}} onPress={()=>setCategory('')} style={[s.chip,s.categoryFilter,!category&&s.selected]}><Text typography="ui" style={s.small}>All</Text></Pressable>{categories.map(item=><Pressable key={item.id} accessibilityRole="tab" accessibilityLabel={`Filter category ${item.name}`} accessibilityState={{selected:category===item.id}} onPress={()=>setCategory(item.id)} style={[s.chip,s.categoryFilter,category===item.id&&s.selected]}><Text typography="ui" style={s.small}>{item.name}</Text></Pressable>)}</ScrollView>}
    {!!draftError&&<View style={{gap:8}}><Text typography="ui" style={s.status}>{draftError}</Text><Action label="Discard unreadable draft" onPress={()=>Alert.alert('Discard unreadable draft?','Only the unsaved editor draft will be removed. Your saved notes are kept.',[{text:'Cancel',style:'cancel'},{text:'Discard draft',style:'destructive',onPress:()=>{setDraftError('');setDraft(undefined);setEditorReady(true);}}])}/></View>}
    {(!store.ready||store.error||store.pendingCount>0)&&<Text typography="ui" accessibilityLiveRegion="polite" style={s.status}>{!store.ready?(store.error||'Loading notes…'):store.error||`${store.pendingCount} pending · Saved on this device`}</Text>}
   </View>}
   ListEmptyComponent={<Text typography="ui" style={[s.body,{paddingVertical:24,color:colors.muted}]}>{!store.ready?'Your saved notes will appear here.':query||category?'No matching notes.':trash?'Trash is empty.':'No notes yet. Tap + to add one.'}</Text>}
   renderItem={({item})=><View testID={`note-row-${item.id}`} style={[s.noteRow,item.color!=='neutral'&&{backgroundColor:palette[item.color]}]}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Open note ${item.title||'Untitled'}`} disabled={!editorReady} onPress={()=>open(item)} style={s.noteLink}>
     <Text typography="ui" numberOfLines={3} style={s.noteTitle}>{item.title||'Untitled'}</Text>{!!item.body&&<Text typography="ui" numberOfLines={6} style={s.snippet}>{noteSnippet(item.body)}</Text>}
     {!!item.categoryIds.length&&<Text typography="ui" numberOfLines={2} style={s.status}>{item.categoryIds.map(id=>categoryNames.get(id)).filter(Boolean).join(' · ')}</Text>}
     {item.conflictOf&&<Text typography="ui" style={s.status}>Preserved conflict copy</Text>}{store.isPending('note',item.id)&&store.localError&&<Text typography="ui" style={s.status}>Local save failed</Text>}
    </Pressable>
    <View style={s.cardActions}><Pressable accessibilityRole="button" accessibilityLabel={`${item.pinned?'Unpin':'Pin'} note ${item.title||'Untitled'}`} onPress={()=>invoke(()=>store.saveNote({...valueOf(item),pinned:!item.pinned},item.id))} style={s.icon}><Pin size={18} color={item.pinned?colors.accent:colors.muted}/></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`${item.trashed?'Restore':'Trash'} note ${item.title||'Untitled'}`} onPress={()=>invoke(()=>store.saveNote({...valueOf(item),trashed:!item.trashed},item.id))} style={s.icon}>{item.trashed?<ArrowLeft size={18} color={colors.muted}/>:<Trash2 size={18} color={colors.muted}/>}</Pressable></View>
   </View>}/>
  }</SectionBody>
  {editing&&draft&&<Modal visible animationType="slide" onRequestClose={closeEditor}><SafeAreaView style={[s.screen,{flex:1,paddingBottom:modalKeyboard}]}>
   <SectionHeading title={draft.id?'Edit note':'New note'}/>
   <SectionBody footer={<SectionActions overlay leading={<RoundAction label="Save note and go back" disabled={saving} onPress={closeEditor} icon={ArrowLeft}/>}>
    <RoundAction label={preview?'Edit text':'Preview note'} icon={preview?Pencil:Eye} selected={preview} disabled={saving} onPress={()=>{bodyInput.current?.blur();setPreview(value=>!value);}}/>
    <SectionAction disabled={saving} text="Discard" label="Discard unsaved draft" onPress={()=>Alert.alert('Discard unsaved changes?','Saved notes and server copies are not deleted.',[{text:'Keep editing',style:'cancel'},{text:'Discard draft',style:'destructive',onPress:()=>{setEditing(false);setDraft(undefined);}}])}/>
    <SectionAction text="Save" label={saving?'Saving note…':'Save note'} primary busy={saving} disabled={saving||(!draft.title.trim()&&!draft.body.trim())} onPress={()=>void save()}/></SectionActions>}>{clearance=>
   <ScrollView style={s.bodyRegion} keyboardShouldPersistTaps="handled" pointerEvents={saving?'none':'auto'} contentContainerStyle={{padding:16,paddingBottom:clearance+16,gap:8}}>
    <TextInput typography="ui" accessibilityLabel="Note title" editable={!saving} placeholder="Title" placeholderTextColor={colors.muted} value={draft.title} maxLength={200} onChangeText={title=>setDraft({...draft,title})} style={[s.input,{fontWeight:'600'}]}/>
    {preview&&<NotesPreview body={draft.body} onToggle={line=>setDraft({...draft,body:toggleNoteTask(draft.body,line)})}/>}<View testID="note-editor-input" accessibilityElementsHidden={preview} importantForAccessibility={preview?'no-hide-descendants':'auto'} style={preview?{display:'none'}:undefined}><TextInput typography="ui" ref={bodyInput} accessibilityLabel="Note body" editable={!saving} placeholder="Write a note…" placeholderTextColor={colors.muted} multiline textAlignVertical="top" value={draft.body} maxLength={100000} onChangeText={body=>setDraft({...draft,body})} style={[s.input,{minHeight:240,lineHeight:26}]}/></View>
    <Text typography="ui" style={s.label}>Categories</Text><View style={s.wrap}>{categories.length?categories.map(item=><Pressable key={item.id} accessibilityRole="checkbox" accessibilityLabel={`Assign category ${item.name}`} accessibilityState={{checked:draft.categoryIds.includes(item.id)}} onPress={()=>setDraft({...draft,categoryIds:draft.categoryIds.includes(item.id)?draft.categoryIds.filter(id=>id!==item.id):draft.categoryIds.length<20?[...draft.categoryIds,item.id]:draft.categoryIds})} style={[s.chip,draft.categoryIds.includes(item.id)&&s.selected]}><Text typography="ui" style={s.small}>{item.name}</Text></Pressable>):<Text typography="ui" style={s.status}>Create categories from the Notes screen.</Text>}</View>
    <Text typography="ui" style={s.label}>Shade</Text><View style={s.wrap}>{(Object.keys(palette) as (keyof typeof palette)[]).map(color=><Pressable key={color} accessibilityRole="radio" accessibilityLabel={`Note shade: ${shadeLabels[color]}`} accessibilityState={{checked:draft.color===color}} onPress={()=>setDraft({...draft,color})} style={[s.color,{backgroundColor:palette[color]},draft.color===color&&s.swatchSelected]}>{draft.color===color&&<Check size={20} color={colors.foreground}/>}</Pressable>)}</View>
    <Action label={draft.pinned?'Unpin this note':'Pin this note'} onPress={()=>setDraft({...draft,pinned:!draft.pinned})}/>
   </ScrollView>
   }</SectionBody>
  </SafeAreaView></Modal>}
  {managing&&<Modal visible animationType="slide" onRequestClose={()=>{if(!categorySaving.current)setManaging(false);}}><SafeAreaView style={[s.screen,{flex:1,paddingBottom:modalKeyboard}]}><SectionHeading title="Categories"/><SectionBody footer={<SectionActions overlay leading={<RoundAction label="Close categories" disabled={savingCategory} onPress={()=>setManaging(false)} icon={ArrowLeft}/>}>
   {categoryForm.id&&<SectionAction label="Cancel category rename" text="Cancel" disabled={savingCategory} onPress={()=>setCategoryForm({name:''})}/>}
   <SectionAction label={categoryForm.id?'Save category name':'Create category'} text={categoryForm.id?'Save':'Create'} primary busy={savingCategory} disabled={savingCategory||!categoryForm.name.trim()} onPress={saveCategory}/>
  </SectionActions>}>{clearance=><ScrollView ref={categoryScroll} style={s.bodyRegion} keyboardShouldPersistTaps="handled" contentContainerStyle={{padding:16,paddingBottom:clearance+16,gap:8}}>
   <Text typography="ui" style={s.label}>{categoryForm.id?'Rename category':'New category'}</Text>
   <TextInput typography="ui" ref={categoryInput} accessibilityLabel="Category name" editable={!savingCategory} placeholder="Category name" placeholderTextColor={colors.muted} maxLength={60} value={categoryForm.name} onChangeText={name=>setCategoryForm({...categoryForm,name})} style={s.input}/>
   {categories.map((item:CategoryRecord)=><View key={item.id} style={s.categoryRow}><Text typography="ui" style={s.categoryName}>{item.name}</Text><View style={s.wrap}><Action label={`Rename ${item.name}`} text="Rename" disabled={savingCategory} onPress={()=>{setCategoryForm({id:item.id,name:item.name,revision:item.revision});categoryScroll.current?.scrollTo({y:0,animated:true});categoryInput.current?.focus();}}/><Action label={`Remove category ${item.name}`} text="Remove" disabled={savingCategory} onPress={()=>Alert.alert('Remove category?','Your notes will be kept.',[{text:'Cancel',style:'cancel'},{text:'Remove',style:'destructive',onPress:()=>invoke(async()=>{await store.saveCategory({name:item.name,deleted:true},item.id);if(category===item.id)setCategory('');})}])}/></View></View>)}
  </ScrollView>}</SectionBody></SafeAreaView></Modal>}
 </View>;
}
const sTheme=themed(({colors,menuChrome,shadows})=>StyleSheet.create({
 bodyRegion:{flex:1,minHeight:0},screen:{backgroundColor:colors.background},
 searchHeader:{paddingHorizontal:16,paddingBottom:8},
 icon:{...menuButtonChrome({colors,shadows}).circle},input:{...menuChrome.input,minHeight:48,color:colors.foreground,padding:8,fontSize:16},
 action:{minHeight:48,minWidth:48,maxWidth:'100%',flexShrink:1,justifyContent:'center'},actionSurface:{...menuButtonChrome({colors,shadows}).pill,minHeight:48,paddingHorizontal:8,paddingVertical:8,borderRadius:999,alignItems:'center',justifyContent:'center'},primary:{...menuButtonChrome({colors,shadows}).primary},actionText:{...menuButtonChrome({colors,shadows}).label,color:colors.foreground,fontSize:13,lineHeight:20,fontWeight:'500',flexShrink:1,textAlign:'center'},
 categoryScroller:{flexGrow:0,flexShrink:0},categoryStrip:{flexDirection:'row',flexWrap:'nowrap',alignItems:'center',gap:8,paddingVertical:6},categoryFilter:{flexShrink:0,maxWidth:undefined},
 chip:{...menuButtonChrome({colors,shadows}).pill,minHeight:48,minWidth:48,maxWidth:'100%',paddingHorizontal:8,paddingVertical:8,borderRadius:999,justifyContent:'center'},selected:{...menuButtonChrome({colors,shadows}).selected},swatchSelected:{borderColor:colors.accent,borderWidth:2},small:{...menuButtonChrome({colors,shadows}).label,color:colors.foreground,fontSize:13,lineHeight:20,flexShrink:1},
 status:{color:colors.muted,fontSize:12,lineHeight:20},body:{color:colors.body,fontSize:16,lineHeight:24,flexShrink:1},noteRow:{paddingVertical:8,gap:8,flexDirection:'row',flexWrap:'wrap',alignItems:'center'},noteLink:{flexGrow:1,flexBasis:192,minWidth:0,maxWidth:'100%',minHeight:48,gap:8,paddingHorizontal:8},cardActions:{flexDirection:'row',justifyContent:'flex-end',gap:8,marginLeft:'auto'},noteTitle:{fontSize:16,lineHeight:24,fontWeight:'600',color:colors.foreground},snippet:{fontSize:13,lineHeight:24,color:colors.body},wrap:{flexDirection:'row',flexWrap:'wrap',gap:8},label:{color:colors.foreground,fontSize:13,lineHeight:24,fontWeight:'500'},categoryRow:{paddingVertical:8,gap:8},categoryName:{color:colors.foreground,fontSize:15,lineHeight:24},
 color:{height:48,width:48,borderRadius:24,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:colors.border},task:{minHeight:48,flexDirection:'row',alignItems:'center',gap:8},check:{width:24,height:24,borderRadius:5,borderWidth:1,borderColor:colors.accent,alignItems:'center',justifyContent:'center'},
}));
