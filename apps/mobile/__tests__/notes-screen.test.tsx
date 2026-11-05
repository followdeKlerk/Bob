jest.mock('react-native/Libraries/Utilities/useWindowDimensions',()=>({__esModule:true,default:jest.fn(()=>({width:361,height:754,scale:1,fontScale:1}))}));
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Alert,Modal,Platform,FlatList,Text,View,StyleSheet,useWindowDimensions} from 'react-native';
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
  act(()=>tree.root.findByProps({accessibilityLabel:'Note body'}).props.onSelectionChange({nativeEvent:{selection:{start:0,end:4}}}));
  act(()=>press(tree,'Bold'));expect(tree.root.findByProps({accessibilityLabel:'Note body'}).props.value).toBe('**Milk**');
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
  expect(tree.root.findByType(FlatList).props.numColumns).toBe(2);
  dimensions.mockReturnValue({width:361,height:754,scale:1,fontScale:2});
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


test('Notes keeps Sync before primary Create in a separate bottom footer and uses semantic card/control/input chrome',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<NotesScreen backendId={backend} request={offline} visible topInset={0}/>);});
 try{
  const heading=tree.root.findByType(SectionHeading);
  expect(heading.props.title).toBe('Notes');
  const footer=tree.root.findByType(SectionActions);
  expect(heading.findAllByType(RoundAction)).toHaveLength(0);
  expect(footer.findAllByType(RoundAction).map(node=>node.props.label)).toEqual(['Categories','Sync notes','Create note']);
  expect(footer.findAllByType(RoundAction)[2].props.primary).toBe(true);
  expect(tree.root.findByType(FlatList).findAll(node=>node.props.accessibilityLabel==='Sync notes')).toHaveLength(0);
  const button=tree.root.findAll(node=>node.props.accessibilityLabel==='Categories'&&typeof node.props.onPress==='function')[0];
  expect(StyleSheet.flatten(button.props.style)).toMatchObject({width:48,height:48,borderRadius:24});
  expect(button.props.variant).toBe('ghost');
  expect(tree.root.findAllByType(View).some(node=>{const style=StyleSheet.flatten(node.props.style);return style?.flexDirection==='row'&&style.borderRadius===14&&style.borderWidth===1&&style.borderColor===colors.border;})).toBe(true);
  act(()=>press(tree,'Categories'));act(()=>input(tree,'Category name','Style check'));
  await act(async()=>press(tree,'Create category'));act(()=>press(tree,'Close categories'));
  const all=tree.root.findByProps({accessibilityLabel:'All categories'});
  expect(StyleSheet.flatten(all.props.style)).toMatchObject({borderRadius:14,borderWidth:1,borderColor:colors.selectedBorder,backgroundColor:colors.selectedSurface});
  act(()=>press(tree,'Create note'));
  expect(StyleSheet.flatten(tree.root.findByProps({accessibilityLabel:'Note title'}).props.style)).toMatchObject({borderRadius:14,borderWidth:1,borderColor:colors.border});
  const editorHeading=tree.root.findAllByType(SectionHeading).find(node=>node.props.title==='New note')!;
  expect(editorHeading.findAllByType(RoundAction)).toHaveLength(0);
  const editorFooter=tree.root.findAllByType(SectionActions).find(node=>!!node.props.leading)!;
  expect(editorFooter.findByProps({testID:'section-footer-leading'}).findAll(node=>node.props.accessibilityLabel==='Save note and go back').length).toBeGreaterThan(0);
  expect(editorFooter.findByProps({testID:'section-footer-actions'}).findAll(node=>node.props.accessibilityLabel==='Save note').length).toBeGreaterThan(0);
  const save=tree.root.findAll(node=>node.props.accessibilityLabel==='Save note'&&typeof node.props.onPress==='function')[0];
  expect(save.findAllByType(View).some(node=>{const style=StyleSheet.flatten(node.props.style);return style?.backgroundColor===colors.accent&&style.borderColor===colors.accent&&style.borderWidth===1;})).toBe(true);
  const shade=tree.root.findByProps({accessibilityLabel:'Note shade: Standard gray'});
  expect(StyleSheet.flatten(shade.props.style)).toMatchObject({borderRadius:24,borderWidth:2,borderColor:colors.accent,backgroundColor:colors.surface});
  act(()=>input(tree,'Note title','Outlined card'));await act(async()=>press(tree,'Save note'));
  expect(tree.root.findAllByType(View).some(node=>{const style=StyleSheet.flatten(node.props.style);return style?.overflow==='hidden'&&style.borderRadius===20&&style.borderWidth===1&&style.borderColor===colors.border;})).toBe(true);
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
  expect(StyleSheet.flatten(list.props.contentContainerStyle).paddingBottom).toBe(224);

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
  expect(categoryBody.findAllByProps({accessibilityLabel:'Create category'}).length).toBeGreaterThan(0);
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
  act(()=>body.props.onSelectionChange({nativeEvent:{selection:{start:5,end:7}}}));
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

  act(()=>press(tree,'Bold'));expect(body.props.value).toBe('Keep **my** caret');
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
