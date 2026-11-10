import {PageSearch} from '../components/page-search';
jest.mock('react-native/Libraries/Utilities/useWindowDimensions',()=>({__esModule:true,default:jest.fn(()=>({width:361,height:754,scale:1,fontScale:1}))}));
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Alert,Modal,Platform,FlatList,ScrollView,Text,View,StyleSheet,useWindowDimensions} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {useKeyboardInset} from '../keyboard-inset';
import {NotesScreen} from '../components/notes-screen';
import {SectionHeading,SectionActions,RoundAction} from '../components/section-ui';
import {colors} from '../theme';
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View,useSafeAreaInsets:()=>({top:24,bottom:20,left:0,right:0})}));
jest.mock('../components/ui/button',()=>({Button:require('react-native').Pressable}));
jest.mock('lucide-react-native',()=>new Proxy({},{get:(_,name)=>name==='__esModule'?true:()=>null}));
jest.mock('@react-native-async-storage/async-storage',()=>{const values=new Map();return{getItem:jest.fn(async(key:string)=>values.get(key)??null),setItem:jest.fn(async(key:string,value:string)=>{values.set(key,value);}),removeItem:jest.fn(async(key:string)=>{values.delete(key);}),clear:jest.fn(async()=>values.clear())};});
jest.mock('uuid',()=>{let next=1;return{v4:()=>`00000000-0000-4000-8000-${String(next++).padStart(12,'0')}`};});
const backend='11111111-1111-4111-8111-111111111111';
const press=(tree:Renderer.ReactTestRenderer,label:string)=>tree.root.findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0].props.onPress();
const input=(tree:Renderer.ReactTestRenderer,label:string,text:string)=>tree.root.findByProps({accessibilityLabel:label}).props.onChangeText(text);
const offline=async()=>{throw Error('Offline');};
jest.mock('../keyboard-inset',()=>({useKeyboardInset:jest.fn(()=>0)}));
beforeEach(async()=>{(useKeyboardInset as jest.Mock).mockReturnValue(0);await AsyncStorage.clear();});
test('real Notes UI creates a category and formatted checklist offline, saves once, and reopens from cache',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 const mount=async()=>{await act(async()=>{tree=Renderer.create(<NotesScreen backendId={backend} request={offline} visible topInset={72} onBack={()=>{}}/>);});};
 await mount();
 try{
  act(()=>press(tree,'Categories'));act(()=>input(tree,'Category name','Work'));
  await act(async()=>press(tree,'Create category'));act(()=>press(tree,'Close categories'));
  act(()=>press(tree,'Create note'));act(()=>input(tree,'Note title','My checklist'));act(()=>input(tree,'Note body','Milk'));
  act(()=>input(tree,'Note body','**Milk**'));expect(tree.root.findByProps({accessibilityLabel:'Note body'}).props.value).toBe('**Milk**');
  act(()=>input(tree,'Note body','## Shopping\n- [ ] Milk\n\n**Remember this**'));
  act(()=>press(tree,'Assign category Work'));act(()=>press(tree,'Note shade: Dark gray'));act(()=>press(tree,'Preview note'));
  const task=tree.root.findAll(node=>node.props.accessibilityLabel==='Milk'&&node.props.accessibilityRole==='checkbox')[0];
  expect(task.props.accessibilityState.checked).toBe(false);act(()=>task.props.onPress());
  await act(async()=>{const save=()=>press(tree,'Save note');save();save();});
  expect(tree.root.findAllByProps({accessibilityLabel:'Note body'})).toHaveLength(0);
  expect(tree.root.findAllByProps({accessibilityLabel:'Open note My checklist'}).length).toBeGreaterThan(0);
  const cached=JSON.parse((await AsyncStorage.getItem(`notes:v1:${backend}`))!);
  expect(cached.pending.filter((op:any)=>op.kind==='note')).toHaveLength(1);
  expect(cached.pending.find((op:any)=>op.kind==='note').value.body).toContain('- [x] Milk');
  expect(await AsyncStorage.getItem(`note-editor:v1:${backend}`)).toBeNull();
  await act(async()=>tree.unmount());await mount();
  act(()=>press(tree,'Open note My checklist'));
  expect(tree.root.findByProps({accessibilityLabel:'Note body'}).props.value).toContain('**Remember this**');
  const assigned=tree.root.findAll(node=>node.props.accessibilityLabel==='Assign category Work'&&node.props.accessibilityRole==='checkbox')[0];expect(assigned.props.accessibilityState.checked).toBe(true);
  act(()=>input(tree,'Note body','A draft that is not yet saved'));
  await act(async()=>press(tree,'Save note and go back'));
  await act(async()=>tree.unmount());await mount();
  expect(tree.root.findAllByProps({accessibilityLabel:'Resume unsaved note'})).toHaveLength(0);
  act(()=>press(tree,'Open note My checklist'));
  expect(tree.root.findByProps({accessibilityLabel:'Note body'}).props.value).toBe('A draft that is not yet saved');
 }finally{await act(async()=>tree.unmount());}
});
test('search, pinning, trash and restore work on locally cached notes without a server connection',async()=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<NotesScreen backendId={backend} request={offline} visible topInset={72} onBack={()=>{}}/>);});
 try{
  act(()=>press(tree,'Create note'));act(()=>input(tree,'Note title','Find me'));act(()=>input(tree,'Note body','Offline content'));await act(async()=>press(tree,'Save note'));
  act(()=>input(tree,'Search notes','no match'));expect(tree.root.findAllByProps({accessibilityLabel:'Open note Find me'})).toHaveLength(0);
  act(()=>input(tree,'Search notes','offline content'));expect(tree.root.findAllByProps({accessibilityLabel:'Open note Find me'}).length).toBeGreaterThan(0);
  await act(async()=>press(tree,'Pin note Find me'));expect(tree.root.findAllByProps({accessibilityLabel:'Unpin note Find me'}).length).toBeGreaterThan(0);
  await act(async()=>press(tree,'Trash note Find me'));expect(tree.root.findAllByProps({accessibilityLabel:'Open note Find me'})).toHaveLength(0);
  act(()=>press(tree,'Show trash'));expect(tree.root.findAllByProps({accessibilityLabel:'Open note Find me'}).length).toBeGreaterThan(0);
  await act(async()=>press(tree,'Restore note Find me'));act(()=>press(tree,'Show notes'));expect(tree.root.findAllByProps({accessibilityLabel:'Open note Find me'}).length).toBeGreaterThan(0);
 }finally{await act(async()=>tree.unmount());}
});

test('Notes has no top back button or idle sync boilerplate; large text uses one column',async()=>{
 const dimensions=useWindowDimensions as jest.Mock;
 const online=async()=>({backendId:backend,version:0,notes:[],categories:[]});
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<NotesScreen backendId={backend} request={online} visible topInset={0}/>);});
 try{
  expect(tree.root.findAllByProps({accessibilityLabel:'Back to chat'})).toHaveLength(0);
  expect(tree.root.findAll(node=>node.type===Text&&node.props.children==='Notes sync automatically')).toHaveLength(0);
  expect(tree.root.findByType(FlatList).props.numColumns).toBe(1);
  dimensions.mockReturnValue({width:361,height:754,scale:1,fontScale:3.37});
  await act(async()=>tree.update(<NotesScreen backendId={backend} request={online} visible topInset={0}/>));
  expect(tree.root.findByType(FlatList).props.numColumns).toBe(1);
  act(()=>press(tree,'Create note'));
  expect(tree.root.findAllByProps({accessibilityLabel:'Save note and go back'}).length).toBeGreaterThan(0);
 }finally{await act(async()=>tree.unmount());dimensions.mockReturnValue({width:361,height:754,scale:1,fontScale:1});}
});

 test('Notes hides transient syncing text while retaining consistent actions and error feedback',async()=>{
 let finish!:(value:any)=>void;
 const snapshot={backendId:backend,version:0,notes:[],categories:[]};
 const request=jest.fn().mockResolvedValueOnce(snapshot).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockRejectedValueOnce(Error('Sync unavailable'));
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<NotesScreen backendId={backend} request={request} visible topInset={0}/>);});
 try{
  const button=tree.root.findAll(node=>node.props.accessibilityLabel==='Categories'&&typeof node.props.onPress==='function')[0];
  expect(StyleSheet.flatten(button.props.style).minHeight).toBe(48);
  expect(button.findAllByType(View).some(node=>StyleSheet.flatten(node.props.style)?.minHeight===48)).toBe(true);
  await act(async()=>press(tree,'Sync notes'));
  expect(tree.root.findAll(node=>node.type===Text&&String(node.props.children).includes('Syncing'))).toHaveLength(0);
  await act(async()=>finish(snapshot));
  await act(async()=>press(tree,'Sync notes'));
  expect(tree.root.findAll(node=>node.type===Text&&String(node.props.children).includes('Offline — showing cached notes.')).length).toBeGreaterThan(0);
 }finally{await act(async()=>tree.unmount());}
 });

test('back saves a new note offline once and an empty new note is not created',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<NotesScreen backendId={backend} request={offline} visible topInset={0}/>);});
 try{
  act(()=>press(tree,'Create note'));
  await act(async()=>press(tree,'Save note and go back'));
  expect(tree.root.findAllByProps({accessibilityLabel:'Open note Untitled'})).toHaveLength(0);
  act(()=>press(tree,'Create note'));act(()=>input(tree,'Note body','Saved by Android back'));
  await act(async()=>{const modal=tree.root.findByType(Modal);modal.props.onRequestClose();modal.props.onRequestClose();});
  expect(tree.root.findAllByProps({accessibilityLabel:'Note body'})).toHaveLength(0);
  const cache=JSON.parse((await AsyncStorage.getItem(`notes:v1:${backend}`))!);
  expect(cache.pending.filter((op:any)=>op.kind==='note')).toHaveLength(1);
  expect(cache.pending[0].value.body).toBe('Saved by Android back');
  act(()=>press(tree,'Open note Untitled'));
  await act(async()=>press(tree,'Save note and go back'));
  expect(JSON.parse((await AsyncStorage.getItem(`notes:v1:${backend}`))!).pending).toHaveLength(1);
 }finally{await act(async()=>tree.unmount());}
});
test('interrupted drafts reopen directly, with no resume button and no lost text',async()=>{
 await AsyncStorage.setItem(`note-editor:v1:${backend}`,JSON.stringify({title:'Recovered',body:'Retained text',categoryIds:[],pinned:false,trashed:false,color:'neutral',baseRevision:0}));
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<NotesScreen backendId={backend} request={offline} visible topInset={0}/>);});
 try{
  expect(tree.root.findByProps({accessibilityLabel:'Note body'}).props.value).toBe('Retained text');
  expect(tree.root.findAllByProps({accessibilityLabel:'Resume unsaved note'})).toHaveLength(0);
  await act(async()=>press(tree,'Save note and go back'));
  expect(tree.root.findAllByProps({accessibilityLabel:'Open note Recovered'}).length).toBeGreaterThan(0);
 }finally{await act(async()=>tree.unmount());}
});
test('failed local autosave keeps the editor open and retains text for retry',async()=>{
 let tree!:Renderer.ReactTestRenderer;const alert=jest.spyOn(Alert,'alert').mockImplementation(()=>{});
 await act(async()=>{tree=Renderer.create(<NotesScreen backendId={backend} request={offline} visible topInset={0}/>);});
 const original=(AsyncStorage.setItem as jest.Mock).getMockImplementation()!;
 try{
  act(()=>press(tree,'Create note'));act(()=>input(tree,'Note body','Do not lose me'));
  (AsyncStorage.setItem as jest.Mock).mockImplementation(async(key:string,value:string)=>{if(key===`notes:v1:${backend}`)throw Error('Disk full');return original(key,value);});
  await act(async()=>press(tree,'Save note and go back'));
  expect(tree.root.findByProps({accessibilityLabel:'Note body'}).props.value).toBe('Do not lose me');
  expect(alert).toHaveBeenCalledWith('Could not save note',expect.stringContaining('Your text is still here'));
  (AsyncStorage.setItem as jest.Mock).mockImplementation(original);
  await act(async()=>press(tree,'Save note and go back'));
  expect(tree.root.findAllByProps({accessibilityLabel:'Note body'})).toHaveLength(0);
  expect(tree.root.findAllByProps({accessibilityLabel:'Open note Untitled'}).length).toBeGreaterThan(0);
 }finally{(AsyncStorage.setItem as jest.Mock).mockReset();(AsyncStorage.setItem as jest.Mock).mockImplementation(original);await act(async()=>tree.unmount());alert.mockRestore();}
});


test('Notes keeps swipeable filters by content and Trash, Tags, Sync, Create in the footer',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<NotesScreen backendId={backend} request={offline} visible topInset={0}/>);});
 try{
  const heading=tree.root.findByType(SectionHeading);
  expect(heading.props.title).toBe('Notes');
  const footer=tree.root.findByType(SectionActions);
  expect(heading.findAllByType(RoundAction)).toHaveLength(0);
  expect(footer.findAllByType(RoundAction).map(node=>node.props.label)).toEqual(['Show trash','Categories','Sync notes','Create note']);
  expect(footer.findAllByType(RoundAction)[3].props.primary).toBe(true);
  expect(tree.root.findByType(FlatList).findAll(node=>node.props.accessibilityLabel==='Sync notes')).toHaveLength(0);
  const button=tree.root.findAll(node=>node.props.accessibilityLabel==='Categories'&&typeof node.props.onPress==='function')[0];
  expect(StyleSheet.flatten(button.props.style)).toMatchObject({width:48,height:48,borderRadius:24});
  expect(button.props.variant).toBe('outline');
  expect(tree.root.findByProps({testID:'notes-search-and-filters'}).findAllByProps({accessibilityLabel:'Categories'})).toHaveLength(0);
  expect(footer.findAllByProps({accessibilityLabel:'Categories'}).length).toBeGreaterThan(0);
  act(()=>press(tree,'Categories'));act(()=>input(tree,'Category name','Style check'));
  await act(async()=>press(tree,'Create category'));act(()=>press(tree,'Close categories'));
  const all=tree.root.findByProps({accessibilityLabel:'All categories'});
  expect(StyleSheet.flatten(all.props.style)).toMatchObject({borderRadius:999,minHeight:48,backgroundColor:colors.selectedSurface});
  const strip=tree.root.findAllByType(ScrollView).find(node=>node.props.testID==='notes-category-strip')!;
  expect(strip.props).toMatchObject({horizontal:true,showsHorizontalScrollIndicator:false,keyboardShouldPersistTaps:'handled'});
  expect(StyleSheet.flatten(strip.props.contentContainerStyle)).toMatchObject({flexDirection:'row',flexWrap:'nowrap',paddingVertical:6});
  expect(StyleSheet.flatten(all.props.style)).toMatchObject({flexShrink:0});
  expect(StyleSheet.flatten(all.props.style).maxWidth).toBeUndefined();
  expect(StyleSheet.flatten(all.findByType(Text).props.style)).toMatchObject({textAlign:'center',textAlignVertical:'center',includeFontPadding:false});
  act(()=>press(tree,'Create note'));
  expect(StyleSheet.flatten(tree.root.findByProps({accessibilityLabel:'Note title'}).props.style)).toMatchObject({borderRadius:14,borderWidth:1,borderColor:colors.border});
  const editorHeading=tree.root.findAllByType(SectionHeading).find(node=>node.props.title==='New note')!;
  expect(editorHeading.findAllByType(RoundAction)).toHaveLength(0);
  const editorFooter=tree.root.findAllByType(SectionActions).find(node=>!!node.props.leading)!;
  expect(editorFooter.findByProps({testID:'section-footer-leading'}).findAll(node=>node.props.accessibilityLabel==='Save note and go back').length).toBeGreaterThan(0);
  expect(editorFooter.findByProps({testID:'section-footer-actions'}).findAll(node=>node.props.accessibilityLabel==='Save note').length).toBeGreaterThan(0);
  const save=tree.root.findAll(node=>node.props.accessibilityLabel==='Save note'&&typeof node.props.onPress==='function')[0];
  expect(save.findAllByType(View).some(node=>{const style=StyleSheet.flatten(node.props.style);return style?.backgroundColor===colors.surface&&style?.borderRadius===999&&style?.borderColor===colors.foreground;})).toBe(true);
  const shade=tree.root.findByProps({accessibilityLabel:'Note shade: Standard gray'});
  expect(StyleSheet.flatten(shade.props.style)).toMatchObject({borderRadius:24,borderWidth:2,borderColor:colors.accent,backgroundColor:colors.surface});
  act(()=>input(tree,'Note title','Outlined card'));await act(async()=>press(tree,'Save note'));
  const noteRow=tree.root.findAll(node=>typeof node.props.testID==='string'&&node.props.testID.startsWith('note-row-'))[0];
  expect(StyleSheet.flatten(noteRow.props.style).borderWidth).toBeUndefined();
  expect(StyleSheet.flatten(noteRow.props.style).borderRadius).toBeUndefined();
 }finally{await act(async()=>tree.unmount());}
});


test('Notes root, category and editor footers stay after shrinking bodies with one host-owned keyboard inset and retained editor identity',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 const props={backendId:backend,request:offline,visible:true,topInset:0,menu:<View testID="notes-menu-control"/>};
 await act(async()=>{tree=Renderer.create(<NotesScreen {...props}/>);});
 try{
  const list=tree.root.findByType(FlatList),rootFooter=tree.root.findByType(SectionActions);
  expect(StyleSheet.flatten(list.props.style)).toMatchObject({flex:1,minHeight:0});
  expect(rootFooter.parent!.props.testID).toBe('section-footer-overlay');
  const rootOverlay=tree.root.findByProps({testID:'section-footer-overlay'});
  act(()=>rootOverlay.props.onLayout({nativeEvent:{layout:{height:184}}}));
  expect(StyleSheet.flatten(list.props.contentContainerStyle).paddingBottom).toBe(212);

  expect(StyleSheet.flatten(rootFooter.parent!.props.style)).toMatchObject({position:'absolute',bottom:0});
  expect(list.parent!.props.testID).toBe('section-scroll-host');
  expect(rootFooter.findByProps({testID:'section-footer-menu'}).findAllByProps({testID:'notes-menu-control'}).length).toBeGreaterThan(0);
  (useKeyboardInset as jest.Mock).mockReturnValue(300);
  await act(async()=>tree.update(<NotesScreen {...props}/>));
  expect(tree.root.findByType(FlatList)).toBe(list);
  expect(StyleSheet.flatten(tree.root.findByProps({testID:'notes-screen'}).props.style).paddingBottom).toBe(280);
  act(()=>press(tree,'Categories'));
  const categoryHost=tree.root.findByType(Modal).findByType(SectionHeading).parent!;
  const categoryBody=categoryHost.findByType(require('react-native').ScrollView),categoryFooter=categoryHost.findByType(SectionActions);
  expect(categoryHost.findByType(SectionHeading).props).toEqual({title:'Categories'});
  expect(categoryBody.findAllByProps({accessibilityLabel:'Close categories'})).toHaveLength(0);
  expect(categoryBody.findAllByProps({accessibilityLabel:'Create category'})).toHaveLength(0);
  expect(categoryFooter.findAllByProps({accessibilityLabel:'Create category'}).length).toBeGreaterThan(0);
  expect(StyleSheet.flatten(categoryBody.props.style)).toMatchObject({flex:1,minHeight:0});
  expect(StyleSheet.flatten(categoryHost.props.style).paddingBottom).toBe(300);
  expect(categoryFooter.findByProps({testID:'section-footer-leading'}).findAllByProps({accessibilityLabel:'Close categories'}).length).toBeGreaterThan(0);
  expect(categoryFooter.parent!.props.testID).toBe('section-footer-overlay');
  const categoryOverlay=categoryHost.findByProps({testID:'section-footer-overlay'}),categoryInput=categoryHost.findByProps({accessibilityLabel:'Category name'});
  act(()=>categoryInput.props.onChangeText('Unsent category'));
  act(()=>categoryOverlay.props.onLayout({nativeEvent:{layout:{height:144}}}));
  expect(StyleSheet.flatten(categoryBody.props.contentContainerStyle).paddingBottom).toBe(172);
  expect(categoryHost.findByProps({accessibilityLabel:'Category name'})===categoryInput).toBe(true);
  expect(categoryInput.props.value).toBe('Unsent category');

  expect(categoryBody.parent!.props.testID).toBe('section-scroll-host');
  act(()=>press(tree,'Close categories'));act(()=>press(tree,'Create note'));act(()=>input(tree,'Note body','Keep my caret'));
  const body=tree.root.findByProps({accessibilityLabel:'Note body'});
  (useKeyboardInset as jest.Mock).mockReturnValue(0);
  await act(async()=>tree.update(<NotesScreen {...props}/>));
  expect(tree.root.findByProps({accessibilityLabel:'Note body'})).toBe(body);
  expect(body.props.value).toBe('Keep my caret');
  const modal=tree.root.findByType(Modal),footer=modal.findByType(SectionActions),scroll=modal.findByType(require('react-native').ScrollView);
  expect(StyleSheet.flatten(scroll.props.style)).toMatchObject({flex:1,minHeight:0});
  expect(scroll.findAllByProps({accessibilityLabel:'Discard unsaved draft'})).toHaveLength(0);
  expect(footer.findAllByProps({accessibilityLabel:'Discard unsaved draft'}).length).toBeGreaterThan(0);
  expect(scroll.parent!.props.testID).toBe('section-scroll-host');
  const editorOverlay=modal.findByProps({testID:'section-footer-overlay'});
  act(()=>editorOverlay.props.onLayout({nativeEvent:{layout:{height:224}}}));
  expect(StyleSheet.flatten(scroll.props.contentContainerStyle).paddingBottom).toBe(252);
  expect(tree.root.findByProps({accessibilityLabel:'Note body'})===body).toBe(true);
  expect(body.props.value).toBe('Keep my caret');
  expect(StyleSheet.flatten(footer.findByProps({testID:'section-footer'}).props.style)).toMatchObject({backgroundColor:'transparent',borderTopWidth:0});

  expect(body.props.value).toBe('Keep my caret');expect(tree.root.findAllByProps({accessibilityLabel:'Bold'})).toHaveLength(0);
 }finally{await act(async()=>tree.unmount());}
});


test.each(['android','ios'])('Notes input dialogs use one platform keyboard owner (%s)',async os=>{
 const originalOS=Object.getOwnPropertyDescriptor(Platform,'OS')!;
 Object.defineProperty(Platform,'OS',{configurable:true,value:os});
 (useKeyboardInset as jest.Mock).mockReturnValue(300);
 let tree!:Renderer.ReactTestRenderer;
 try{
  await act(async()=>{tree=Renderer.create(<NotesScreen backendId={backend} request={offline} visible topInset={0}/>);});
  expect(StyleSheet.flatten(tree.root.findByProps({testID:'notes-screen'}).props.style).paddingBottom).toBe(280);
  for(const open of ['Categories','Create note']){
   act(()=>press(tree,open));
   const modal=tree.root.findByType(Modal),host=modal.findByType(SectionHeading).parent!;
   expect(modal.props.statusBarTranslucent).not.toBe(true);
   expect(modal.props.navigationBarTranslucent).not.toBe(true);
   expect(StyleSheet.flatten(host.props.style).paddingBottom).toBe(os==='android'?0:300);
   expect(modal.findAllByType(require('react-native').KeyboardAvoidingView)).toHaveLength(0);
   expect(modal.findByType(SectionActions).findAllByProps({testID:'section-footer'}).length).toBeGreaterThan(0);
   if(open==='Categories')act(()=>press(tree,'Close categories'));
  }
 }finally{
  if(tree)await act(async()=>tree.unmount());
  Object.defineProperty(Platform,'OS',originalOS);
 }
});

test('337% text and narrow layout retain the list, query, category field and note selection while footer actions remain separate',async()=>{
 const dimensions=useWindowDimensions as jest.Mock;
 let tree!:Renderer.ReactTestRenderer;
 const props={backendId:backend,request:offline,visible:true,topInset:0};
 await act(async()=>{tree=Renderer.create(<NotesScreen {...props}/>);});
 try{
  const list=tree.root.findByType(FlatList),search=tree.root.findByProps({accessibilityLabel:'Search notes'});
  act(()=>input(tree,'Search notes','kept search'));
  dimensions.mockReturnValue({width:337,height:540,scale:1,fontScale:3.37});
  await act(async()=>tree.update(<NotesScreen {...props}/>));
  expect(tree.root.findByType(FlatList)).toBe(list);expect(tree.root.findByProps({accessibilityLabel:'Search notes'})).toBe(search);expect(search.props.value).toBe('kept search');
  act(()=>press(tree,'Categories'));
  const categoryInput=tree.root.findByProps({accessibilityLabel:'Category name'});
  act(()=>input(tree,'Category name','A category name that wraps'));
  const categoryModal=tree.root.findByType(Modal),footer=categoryModal.findByType(SectionActions);
  expect(footer.findByProps({testID:'section-footer-actions'}).findAllByProps({accessibilityLabel:'Create category'}).length).toBeGreaterThan(0);
  act(()=>categoryModal.findByProps({testID:'section-footer-overlay'}).props.onLayout({nativeEvent:{layout:{height:240}}}));
  expect(tree.root.findByProps({accessibilityLabel:'Category name'})).toBe(categoryInput);
  await act(async()=>{press(tree,'Create category');press(tree,'Create category');});
  const cache=JSON.parse((await AsyncStorage.getItem(`notes:v1:${backend}`))!);
  expect(cache.pending.filter((op:any)=>op.kind==='category')).toHaveLength(1);
  act(()=>press(tree,'Rename A category name that wraps'));
  expect(tree.root.findByProps({accessibilityLabel:'Category name'})).toBe(categoryInput);expect(categoryInput.props.value).toBe('A category name that wraps');
  act(()=>input(tree,'Category name','Renamed category'));await act(async()=>press(tree,'Save category name'));act(()=>press(tree,'Close categories'));
  act(()=>input(tree,'Search notes',''));act(()=>press(tree,'Create note'));act(()=>input(tree,'Note body','Keep my caret and draft'));
  act(()=>press(tree,'Assign category Renamed category'));
  const body=tree.root.findByProps({accessibilityLabel:'Note body'});
  dimensions.mockReturnValue({width:800,height:400,scale:1,fontScale:1});
  await act(async()=>tree.update(<NotesScreen {...props}/>));
  expect(tree.root.findByProps({accessibilityLabel:'Note body'})).toBe(body);
  expect(body.props.value).toBe('Keep my caret and draft');expect(tree.root.findAllByProps({accessibilityLabel:'Bold'})).toHaveLength(0);
  expect(tree.root.findAll(node=>node.props.accessibilityLabel==='Assign category Renamed category'&&node.props.accessibilityRole==='checkbox')[0].props.accessibilityState.checked).toBe(true);
  expect(body.props.typography).toBe('ui');
 }finally{await act(async()=>tree.unmount());dimensions.mockReturnValue({width:361,height:754,scale:1,fontScale:1});}
});

test('many category filters stay in one swipeable row and keep selection, search and native list identity across footer actions',async()=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<NotesScreen backendId={backend} request={offline} visible topInset={0}/>);});
 try{
  act(()=>press(tree,'Categories'));
  for(const name of ['Bob','Business','Development','Personal','Research','Shopping','Work','A much longer category name']){
   act(()=>input(tree,'Category name',name));await act(async()=>press(tree,'Create category'));
  }
  act(()=>press(tree,'Close categories'));
  const strip=tree.root.findAllByType(ScrollView).find(node=>node.props.testID==='notes-category-strip')!,list=tree.root.findByType(FlatList),search=tree.root.findByProps({accessibilityLabel:'Search notes'});
  expect(strip.findAll(node=>node.props.accessibilityRole==='tab'&&typeof node.props.onPress==='function')).toHaveLength(9);
  expect(StyleSheet.flatten(strip.props.style)).toMatchObject({flexGrow:0,flexShrink:0});
  expect(StyleSheet.flatten(strip.props.style).height).toBeUndefined();
  for(const tab of strip.findAll(node=>node.props.accessibilityRole==='tab'&&typeof node.props.onPress==='function')){
   const style=StyleSheet.flatten(tab.props.style);expect(style).toMatchObject({minHeight:48,flexShrink:0});expect(style.width).toBeUndefined();expect(style.maxWidth).toBeUndefined();
   const label=tab.findByType(Text);expect(label.props.numberOfLines).toBeUndefined();expect(label.props.allowFontScaling).not.toBe(false);
  }
  act(()=>press(tree,'Filter category Development'));act(()=>input(tree,'Search notes','Retained search'));
  const selected=()=>tree.root.findByProps({accessibilityLabel:'Filter category Development'}).props.accessibilityState.selected;
  expect(selected()).toBe(true);
  act(()=>press(tree,'Show trash'));
  const toggle=tree.root.findAll(node=>node.props.accessibilityLabel==='Show notes'&&typeof node.props.onPress==='function')[0];
  expect(toggle.props.accessibilityState.selected).toBe(true);expect(selected()).toBe(true);
  act(()=>press(tree,'Show notes'));act(()=>press(tree,'Categories'));act(()=>press(tree,'Close categories'));
  expect(selected()).toBe(true);expect(tree.root.findByProps({accessibilityLabel:'Search notes'}).props.value).toBe('Retained search');
  expect(tree.root.findByType(FlatList)===list).toBe(true);expect(tree.root.findByProps({accessibilityLabel:'Search notes'})===search).toBe(true);
  expect(tree.root.findAllByType(ScrollView).find(node=>node.props.testID==='notes-category-strip')===strip).toBe(true);
  const header=tree.root.findByProps({testID:'notes-search-and-filters'}),footer=tree.root.findByType(SectionActions);
  for(const label of ['Show trash','Categories']){expect(header.findAllByProps({accessibilityLabel:label})).toHaveLength(0);expect(footer.findAllByProps({accessibilityLabel:label}).length).toBeGreaterThan(0);}
 }finally{await act(async()=>tree.unmount());}
});

test('Markdown editor has no formatting toolbar and footer Preview preserves the raw native editor and draft',async()=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<NotesScreen backendId={backend} request={offline} visible topInset={0}/>);});
 try{
  const list=tree.root.findByType(FlatList),search=tree.root.findByProps({testID:'notes-search-header'});
  expect(list.findAllByProps({testID:'page-search'})).toHaveLength(0);expect(search.findAllByType(PageSearch)).toHaveLength(1);
  act(()=>press(tree,'Create note'));const raw='## Heading\n\n**Own Markdown**\n- [ ] A task';act(()=>input(tree,'Note body',raw));
  const editor=tree.root.findByProps({accessibilityLabel:'Note body'}),modal=tree.root.findByType(Modal),footer=modal.findByType(SectionActions),scroll=modal.findByType(ScrollView);
  for(const label of ['Bold','Italic','Heading','Bullet list','Checklist'])expect(modal.findAllByProps({accessibilityLabel:label})).toHaveLength(0);
  expect(scroll.findAllByProps({accessibilityLabel:'Preview note'})).toHaveLength(0);
  expect(footer.findAllByType(RoundAction).map(node=>node.props.label)).toEqual(['Save note and go back','Preview note']);
  act(()=>press(tree,'Preview note'));
  expect(tree.root.findByProps({accessibilityLabel:'Note body'})===editor).toBe(true);expect(editor.props.value).toBe(raw);
  expect(tree.root.findByProps({testID:'note-editor-input'}).props.accessibilityElementsHidden).toBe(true);
  expect(StyleSheet.flatten(tree.root.findByProps({testID:'note-editor-input'}).props.style).display).toBe('none');
  expect(footer.findAllByProps({accessibilityLabel:'Edit text'}).length).toBeGreaterThan(0);
  act(()=>press(tree,'Edit text'));
  expect(tree.root.findByProps({accessibilityLabel:'Note body'})===editor).toBe(true);expect(editor.props.value).toBe(raw);
  expect(tree.root.findByProps({testID:'note-editor-input'}).props.accessibilityElementsHidden).toBe(false);
  await act(async()=>press(tree,'Save note'));expect(tree.root.findAllByProps({accessibilityLabel:'Note body'})).toHaveLength(0);
  const cache=JSON.parse((await AsyncStorage.getItem(`notes:v1:${backend}`))!);expect(cache.pending.find((op:any)=>op.kind==='note').value.body).toBe(raw);
 }finally{await act(async()=>tree.unmount());}
});

test('Sync remains available after local cache loading fails and recovers the mounted screen',async()=>{
 const read=(AsyncStorage.getItem as jest.Mock).getMockImplementation()!;
 let fail=true,tree!:Renderer.ReactTestRenderer;
 (AsyncStorage.getItem as jest.Mock).mockImplementation((key:string)=>key===`notes:v1:${backend}`&&fail?Promise.reject(Error('Storage unavailable')):read(key));
 try{
  await act(async()=>{tree=Renderer.create(<NotesScreen backendId={backend} request={offline} visible topInset={0}/>);});
  const action=(label:string)=>tree.root.findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0];
  expect(action('Create note').props.disabled).toBe(true);expect(action('Sync notes').props.disabled).toBe(false);
  fail=false;await act(async()=>press(tree,'Sync notes'));
  expect(action('Create note').props.disabled).toBe(false);act(()=>press(tree,'Create note'));
  expect(tree.root.findByProps({accessibilityLabel:'Note body'})).toBeTruthy();
 }finally{if(tree)await act(async()=>tree.unmount());(AsyncStorage.getItem as jest.Mock).mockImplementation(read);}
});
