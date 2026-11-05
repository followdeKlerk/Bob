import {Text,TextInput} from './app-text';
import React,{useEffect,useRef,useState} from 'react';
import {ActivityIndicator,FlatList,Image,Modal,NativeModules,PermissionsAndroid,Linking,Platform,Pressable,StyleSheet,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {ArrowLeft,Check,ChevronRight,FileText,Folder,FolderOpen,Image as ImageIcon,Search,Upload,X} from 'lucide-react-native';
import {themed,useTheme,useThemedValue} from '../theme';
import {SectionHeading,SectionActions,SectionBody,RoundAction,SectionAction} from './section-ui';
import type {DraftAttachment} from './attachment-thumbnail';
export type LibraryItem={uri:string;name:string;mime:string;size:number;directory:boolean;documentId?:string};
type Page={items:LibraryItem[];next?:string;more?:boolean};
export async function requestGalleryAccess():Promise<'full'|'limited'|'denied'>{
 if(Platform.OS!=='android')return 'denied';
 if(Number(Platform.Version)<33)return await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE)==='granted'?'full':'denied';
 const images=PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES;
 const selected='android.permission.READ_MEDIA_VISUAL_USER_SELECTED' as Parameters<typeof PermissionsAndroid.request>[0];
 const result=await PermissionsAndroid.requestMultiple(Number(Platform.Version)>=34?[images,selected]:[images]);
 return result[images]==='granted'?'full':result[selected]==='granted'?'limited':'denied';
}
export function AttachmentPicker({initialTab,limit,onClose,onAdd}:{initialTab:'gallery'|'files';limit:number;onClose:()=>void;onAdd:(items:DraftAttachment[])=>void}){
 const {colors}=useTheme();
 const s=useThemedValue(sTheme);

 const [tab,setTab]=useState(initialTab),[items,setItems]=useState<LibraryItem[]>([]),[selected,setSelected]=useState<Record<string,LibraryItem>>({}),[query,setQuery]=useState('');
 const [tree,setTree]=useState<string>(),[path,setPath]=useState<{id:string;name:string}[]>([]),[next,setNext]=useState<string>(),[more,setMore]=useState(false);
 const [loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[access,setAccess]=useState<'full'|'limited'|'denied'>('denied');
 const [extras,setExtras]=useState<DraftAttachment[]>([]);
 const extrasRef=useRef<DraftAttachment[]>([]),committed=useRef(false),generation=useRef(0),alive=useRef(true),fetching=useRef(false);
 const doc=path[path.length-1]?.id;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;if(!committed.current)extrasRef.current.forEach(file=>void NativeModules.BobFiles.removeAttachment(file.id).catch(()=>{}));};},[]);
 useEffect(()=>{void NativeModules.BobFiles.savedAttachmentFolder().then((value:string|null)=>{if(alive.current&&value)setTree(value);}).catch(()=>{});},[]);
 async function load(append=false){
  if(fetching.current)return;
  const token=generation.current;fetching.current=true;setLoading(true);setError('');
  try{
   const page:Page=tab==='gallery'?await NativeModules.BobFiles.galleryPage(append?next??null:null):tree?await NativeModules.BobFiles.folderPage(tree,doc??null,append?items.length:0):{items:[]};
   if(!alive.current||token!==generation.current)return;
   setItems(previous=>append?[...previous,...page.items.filter(item=>!previous.some(old=>old.uri===item.uri))]:page.items);setNext(page.next);setMore(tab==='gallery'?!!page.next:!!page.more);
  }catch(e){if(alive.current&&token===generation.current)setError(String((e as Error).message??e));}
  finally{if(token===generation.current){fetching.current=false;if(alive.current)setLoading(false);}}
 }
 useEffect(()=>{
  generation.current++;fetching.current=false;setItems([]);setNext(undefined);setMore(false);setQuery('');setError('');
  const token=generation.current;
  if(tab==='gallery'){
   setLoading(true);
   void requestGalleryAccess().then(value=>{if(!alive.current||token!==generation.current)return;setAccess(value);if(value==='denied'){setLoading(false);return;}void load();}).catch(e=>{if(alive.current&&token===generation.current){setLoading(false);setError(String(e.message??e));}});
  }else void load();
 },[tab,tab==='files'?tree:undefined,tab==='files'?doc:undefined]);
 function toggle(item:LibraryItem){
  if(saving)return;
  if(item.directory){setPath(previous=>[...previous,{id:item.documentId!,name:item.name}]);return;}
  setError('');
  if(item.size>limit){setError(`${item.name} exceeds the attachment size limit.`);return;}
  setSelected(previous=>{const value={...previous};if(value[item.uri])delete value[item.uri];else if(Object.keys(value).length+extras.length<20)value[item.uri]=item;return value;});
  if(!selected[item.uri]&&Object.keys(selected).length+extras.length>=20)setError('Add up to 20 items at a time.');
 }
 async function chooseFolder(){
  setError('');try{const value=await NativeModules.BobFiles.chooseAttachmentFolder();if(alive.current&&value){setPath([]);setTree(value);}}catch(e){if(alive.current)setError(String((e as Error).message??e));}
 }
 async function browse(){
  setError('');setSaving(true);
  try{const file=await NativeModules.BobFiles.chooseAttachment(limit) as DraftAttachment|null;if(file){if(!alive.current){void NativeModules.BobFiles.removeAttachment(file.id);return;}extrasRef.current=[...extrasRef.current,file];setExtras(extrasRef.current);}}
  catch(e){if(alive.current)setError(String((e as Error).message??e));}finally{if(alive.current)setSaving(false);}
 }
 async function add(){
  if(saving)return;setSaving(true);setError('');const staged:DraftAttachment[]=[];
  try{
   for(const item of Object.values(selected)){staged.push(await NativeModules.BobFiles.stageLibraryItem(item.uri,limit));if(!alive.current)throw Error('Picker closed');}
   if(!alive.current)throw Error('Picker closed');committed.current=true;onAdd([...extrasRef.current,...staged]);
  }catch(e){await Promise.all(staged.map(file=>NativeModules.BobFiles.removeAttachment(file.id).catch(()=>{})));if(alive.current)setError(String((e as Error).message??e));}
  finally{if(alive.current)setSaving(false);}
 }
 function clearSelection(){
  setSelected({});const files=extrasRef.current;extrasRef.current=[];setExtras([]);files.forEach(file=>void NativeModules.BobFiles.removeAttachment(file.id).catch(()=>{}));
 }
 function requestBack(){
  if(saving)return;
  if(tab==='files'&&path.length){setPath(previous=>previous.slice(0,-1));return;}
  onClose();
 }
 const count=Object.keys(selected).length+extras.length;
 const shown=items.filter(item=>item.name.toLowerCase().includes(query.toLowerCase()));
 // Android RN Modal owns IME resize; do not add Activity-derived keyboard padding here.
 return <Modal visible animationType="slide" onRequestClose={requestBack}><SafeAreaView style={s.root}>
  <SectionHeading title="Add files"/>
  <View accessibilityRole="tablist" style={s.tabs}>{(['gallery','files'] as const).map(value=><Pressable key={value} accessibilityRole="tab" accessibilityLabel={value==='gallery'?'Gallery tab':'Files tab'} accessibilityState={{selected:tab===value,disabled:saving}} disabled={saving} onPress={()=>setTab(value)} style={[s.tab,tab===value&&s.active]}>{value==='gallery'?<ImageIcon size={18} color={colors.foreground}/>:<Folder size={18} color={colors.foreground}/>}<Text style={s.tabText}>{value==='gallery'?'Gallery':'Files'}</Text></Pressable>)}</View>
  {tab==='files'&&<><Pressable accessibilityRole="button" disabled={saving||count>=20} onPress={()=>void browse()} style={s.row}><Upload size={23} color={colors.foreground}/><Text style={s.rowText}>Browse files…</Text></Pressable><Pressable accessibilityRole="button" disabled={saving} onPress={()=>void chooseFolder()} style={s.row}><FolderOpen size={23} color={colors.foreground}/><Text style={s.rowText}>{tree?'Change folder':'Choose a folder'}</Text></Pressable></>}
  {tab==='gallery'&&access!=='full'&&!loading&&<View style={s.notice}><Text style={s.caption}>{access==='limited'?'Showing only the photos you allowed.':'Allow photo access to show your gallery here.'}</Text><Pressable accessibilityRole="button" onPress={()=>{void requestGalleryAccess().then(value=>{if(!alive.current)return;setAccess(value);if(value!=='denied')void load();}).catch(e=>setError(String(e.message??e)));}} style={s.smallButton}><Text style={s.tabText}>Manage photo access</Text></Pressable>{access==='denied'&&<Pressable accessibilityRole="button" onPress={()=>void Linking.openSettings()} style={s.smallButton}><Text style={s.tabText}>Open Android settings</Text></Pressable>}</View>}
  <View style={s.search}><Search size={19} color={colors.muted}/><TextInput accessibilityLabel={tab==='gallery'?'Search loaded photos':'Search loaded files'} placeholder={tab==='gallery'?'Search loaded photos':'Search loaded files'} placeholderTextColor={colors.muted} value={query} onChangeText={setQuery} style={s.input}/></View>
  <View style={s.section}>{tab==='files'&&path.length>0&&<Pressable accessibilityRole="button" accessibilityLabel="Parent folder" disabled={saving} onPress={()=>setPath(previous=>previous.slice(0,-1))} style={s.icon}><ArrowLeft size={22} color={colors.foreground}/></Pressable>}<Text numberOfLines={1} style={s.sectionTitle}>{tab==='gallery'?'Recent':path[path.length-1]?.name??'Folder contents'}</Text>{loading&&<ActivityIndicator color={colors.accent}/>}</View>
  {!!error&&<Text accessibilityLiveRegion="polite" style={s.error}>{error}</Text>}
  <SectionBody footer={<>{count>0&&<View style={s.footer}>{count>0&&<View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}><Text accessibilityLiveRegion="polite" style={s.caption}>{count} selected across Gallery and Files</Text><Pressable accessibilityRole="button" accessibilityLabel="Clear selection" disabled={saving} onPress={clearSelection} style={s.smallButton}><Text style={s.tabText}>Clear</Text></Pressable></View>}{extras.length>0&&<Text style={s.caption}>{extras.length} file{extras.length===1?'':'s'} chosen with Browse files</Text>}</View>}
  <SectionActions overlay leading={<RoundAction label="Close add files" disabled={saving} onPress={onClose} icon={X}/>}><SectionAction label={`Add ${count} attachments`} text={count?`Add ${count} ${count===1?'item':'items'}`:'Select items'} busy={saving} primary disabled={!count||saving} onPress={()=>void add()}/></SectionActions></>}>{clearance=>
  <FlatList style={s.body} key={tab} data={shown} numColumns={tab==='gallery'?2:1} keyExtractor={item=>item.uri} contentContainerStyle={[s.list,{paddingBottom:clearance+16}]} columnWrapperStyle={tab==='gallery'?{gap:10}:undefined} showsVerticalScrollIndicator={false} extraData={selected}
   renderItem={({item})=>{const checked=!!selected[item.uri];return tab==='gallery'?<Pressable accessibilityRole="checkbox" accessibilityLabel={item.name} accessibilityState={{checked,disabled:saving}} disabled={saving} onPress={()=>toggle(item)} style={[s.photo,checked&&s.selected]}><Image source={{uri:item.uri}} resizeMode="cover" resizeMethod="resize" style={s.image}/><View style={[s.circle,checked&&s.checked]}>{checked&&<Check size={17} color={colors.onAccent}/>}</View></Pressable>:<Pressable accessibilityRole={item.directory?'button':'checkbox'} accessibilityLabel={item.name} accessibilityState={{checked:item.directory?undefined:checked,disabled:saving}} disabled={saving} onPress={()=>toggle(item)} style={[s.file,checked&&s.fileSelected]}>{item.directory?<Folder size={25} color={colors.accent}/>:<FileText size={25} color={colors.muted}/>}<View style={{flex:1,gap:4}}><Text numberOfLines={2} style={s.fileName}>{item.name}</Text>{!item.directory&&<Text style={s.caption}>{item.size?`${Math.ceil(item.size/1024)} KB`:'File'}</Text>}</View>{item.directory?<ChevronRight size={21} color={colors.muted}/>:<View style={[s.fileCircle,checked&&s.checked]}>{checked&&<Check size={17} color={colors.onAccent}/>}</View>}</Pressable>;}}
   ListEmptyComponent={!loading?<Text style={s.empty}>{query?'No matching items in the loaded results.':tab==='gallery'?'No photos available.':tree?'This folder is empty or unavailable.':'Choose a folder to browse its files here, or use Browse files.'}</Text>:undefined}
   ListFooterComponent={more?<Pressable accessibilityRole="button" disabled={loading||saving} onPress={()=>void load(true)} style={s.smallButton}><Text style={s.tabText}>Load more</Text></Pressable>:undefined}/>
  }</SectionBody>
 </SafeAreaView></Modal>;
}
const sTheme=themed(({colors,menuChrome})=>StyleSheet.create({
 body:{flex:1,minHeight:0},root:{flex:1,backgroundColor:colors.background},icon:{...menuChrome.control,width:48,height:48,alignItems:'center',justifyContent:'center'},tabs:{...menuChrome.card,marginHorizontal:20,flexDirection:'row',padding:4},tab:{...menuChrome.control,flex:1,minHeight:48,flexDirection:'row',gap:8,alignItems:'center',justifyContent:'center'},active:{...menuChrome.selected},tabText:{fontSize:14,color:colors.foreground},row:{minHeight:56,flexDirection:'row',alignItems:'center',gap:16,marginHorizontal:20,borderBottomWidth:StyleSheet.hairlineWidth,borderColor:colors.border},rowText:{fontSize:16,color:colors.foreground},notice:{paddingHorizontal:20,paddingTop:12,gap:8},caption:{fontSize:12,lineHeight:19,color:colors.muted},search:{...menuChrome.input,marginHorizontal:20,marginTop:14,paddingHorizontal:14,flexDirection:'row',gap:10,alignItems:'center'},input:{flex:1,minHeight:48,fontSize:15,color:colors.foreground},section:{flexDirection:'row',alignItems:'center',gap:10,paddingHorizontal:20,paddingVertical:14},sectionTitle:{fontSize:18,color:colors.foreground,flex:1},list:{paddingHorizontal:20,paddingBottom:16,gap:10,flexGrow:1},photo:{...menuChrome.card,flex:1,maxWidth:'50%',aspectRatio:0.82,overflow:'hidden',backgroundColor:colors.surface},selected:{...menuChrome.selected},image:{width:'100%',height:'100%'},circle:{position:'absolute',top:10,right:10,width:28,height:28,borderRadius:14,borderWidth:2,borderColor:colors.muted,backgroundColor:colors.composer+'dd',alignItems:'center',justifyContent:'center'},checked:{backgroundColor:colors.accent,borderColor:colors.accent},fileCircle:{width:26,height:26,borderRadius:13,borderWidth:1,borderColor:colors.muted,alignItems:'center',justifyContent:'center'},file:{...menuChrome.card,minHeight:72,padding:12,flexDirection:'row',alignItems:'center',gap:12,backgroundColor:colors.surface},fileSelected:{...menuChrome.selected},fileName:{fontSize:15,color:colors.foreground},empty:{paddingVertical:32,paddingHorizontal:10,color:colors.muted,lineHeight:22,fontSize:14,textAlign:'center'},error:{fontSize:13,lineHeight:20,color:colors.foreground,paddingHorizontal:20,paddingBottom:12},smallButton:{...menuChrome.control,minHeight:48,paddingHorizontal:12,alignItems:'center',justifyContent:'center'},footer:{paddingHorizontal:20,paddingVertical:12,gap:8},
}));
