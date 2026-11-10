import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Modal,NativeModules,PermissionsAndroid,Platform,StyleSheet,TextInput,View} from 'react-native';
import {SectionHeading,SectionActions,RoundAction} from '../components/section-ui';
import {colors} from '../theme';
import {AttachmentPicker,requestGalleryAccess} from '../components/attachment-picker';
import {PlusMenu} from '../components/plus-menu';
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View}));
jest.mock('lucide-react-native',()=>({ArrowLeft:()=>null,Check:()=>null,ChevronRight:()=>null,FileText:()=>null,Folder:()=>null,FolderOpen:()=>null,Image:()=>null,Search:()=>null,Upload:()=>null,X:()=>null,Camera:()=>null,Paperclip:()=>null,PenTool:()=>null,SlidersHorizontal:()=>null,Ellipsis:()=>null}));
const file={uri:'content://folder/report',name:'report.pdf',mime:'application/pdf',size:200,directory:false};
const staged={id:'staged',uri:'file:///draft',name:'report.pdf',mime:'application/pdf'};
const find=(tree:Renderer.ReactTestRenderer,label:string)=>tree.root.findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0];
beforeEach(()=>{
 NativeModules.BobFiles={savedAttachmentFolder:jest.fn().mockResolvedValue('content://tree/root'),folderPage:jest.fn().mockResolvedValue({items:[file],more:false}),galleryPage:jest.fn().mockResolvedValue({items:[],next:null}),chooseAttachmentFolder:jest.fn().mockResolvedValue('content://tree/other'),chooseAttachment:jest.fn().mockResolvedValue(staged),stageLibraryItem:jest.fn().mockResolvedValue(staged),removeAttachment:jest.fn().mockResolvedValue(null)};
});
test('custom file browser stages selection only when Add is pressed',async()=>{
 const add=jest.fn();let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<AttachmentPicker initialTab="files" limit={1000} onClose={()=>{}} onAdd={add}/>);});
 expect(NativeModules.BobFiles.folderPage).toHaveBeenCalledWith('content://tree/root',null,0);
 await act(async()=>find(tree,'report.pdf').props.onPress());
 expect(NativeModules.BobFiles.stageLibraryItem).not.toHaveBeenCalled();
 await act(async()=>find(tree,'Add 1 attachments').props.onPress());
 expect(NativeModules.BobFiles.stageLibraryItem).toHaveBeenCalledWith(file.uri,1000);
 expect(add).toHaveBeenCalledWith([staged]);
 await act(async()=>tree.unmount());
 expect(NativeModules.BobFiles.removeAttachment).not.toHaveBeenCalled();
});
test('closing the picker deletes files staged through the system browser',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<AttachmentPicker initialTab="files" limit={1000} onClose={()=>{}} onAdd={()=>{}}/>);});
 const browse=tree.root.findAll(node=>typeof node.props.onPress==='function'&&node.props.children?.[1]?.props?.children==='Browse files…')[0];
 await act(async()=>browse.props.onPress());
 await act(async()=>tree.unmount());
 expect(NativeModules.BobFiles.removeAttachment).toHaveBeenCalledWith('staged');
});
test('a failed multi-select staging removes partial copies without admitting attachments',async()=>{
 const add=jest.fn();let tree!:Renderer.ReactTestRenderer;
 NativeModules.BobFiles.folderPage.mockResolvedValue({items:[file,{...file,uri:'content://folder/second',name:'second.pdf'}]});
 NativeModules.BobFiles.stageLibraryItem.mockResolvedValueOnce(staged).mockRejectedValueOnce(Error('File removed'));
 await act(async()=>{tree=Renderer.create(<AttachmentPicker initialTab="files" limit={1000} onClose={()=>{}} onAdd={add}/>);});
 await act(async()=>find(tree,'report.pdf').props.onPress());await act(async()=>find(tree,'second.pdf').props.onPress());
 await act(async()=>find(tree,'Add 2 attachments').props.onPress());
 expect(add).not.toHaveBeenCalled();expect(NativeModules.BobFiles.removeAttachment).toHaveBeenCalledWith('staged');
 await act(async()=>tree.unmount());
});
test('compact menu exposes common actions and moves advanced actions behind More',async()=>{
 const gallery=jest.fn(),more=jest.fn(),drawing=jest.fn();let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<PlusMenu bottom={90} maxHeight={400} disabled={false} onCamera={()=>{}} onGallery={gallery} onFiles={()=>{}} onDrawing={drawing} onModel={()=>{}} onMore={more}/>);});
 for(const label of ['Camera','Gallery','Files','Drawing','Model & thinking','More'])expect(find(tree,label)).toBeDefined();
 await act(async()=>find(tree,'Drawing').props.onPress());expect(drawing).toHaveBeenCalledTimes(1);
 await act(async()=>find(tree,'Gallery').props.onPress());expect(gallery).toHaveBeenCalledTimes(1);
 await act(async()=>find(tree,'More').props.onPress());expect(more).toHaveBeenCalledTimes(1);
 expect(find(tree,'Updates')).toBeUndefined();await act(async()=>tree.unmount());
});
test('Android 14 limited photo permission is accepted without assuming whole-library access',async()=>{
 const os=Object.getOwnPropertyDescriptor(Platform,'OS')!,version=Object.getOwnPropertyDescriptor(Platform,'Version')!;
 Object.defineProperty(Platform,'OS',{configurable:true,value:'android'});Object.defineProperty(Platform,'Version',{configurable:true,value:34});
 const permission=jest.spyOn(PermissionsAndroid,'requestMultiple').mockResolvedValue({'android.permission.READ_MEDIA_IMAGES':'denied','android.permission.READ_MEDIA_VISUAL_USER_SELECTED':'granted'} as Awaited<ReturnType<typeof PermissionsAndroid.requestMultiple>>);
 try{expect(await requestGalleryAccess()).toBe('limited');}finally{permission.mockRestore();Object.defineProperty(Platform,'OS',os);Object.defineProperty(Platform,'Version',version);}
});

test('gallery and file selections are preserved when switching tabs and added together',async()=>{
 const os=Object.getOwnPropertyDescriptor(Platform,'OS')!,version=Object.getOwnPropertyDescriptor(Platform,'Version')!;
 Object.defineProperty(Platform,'OS',{configurable:true,value:'android'});Object.defineProperty(Platform,'Version',{configurable:true,value:34});
 const permission=jest.spyOn(PermissionsAndroid,'requestMultiple').mockResolvedValue({'android.permission.READ_MEDIA_IMAGES':'granted'} as Awaited<ReturnType<typeof PermissionsAndroid.requestMultiple>>);
 const photo={uri:'content://media/image/1',name:'Screenshot.jpg',mime:'image/jpeg',size:500,directory:false};
 NativeModules.BobFiles.galleryPage.mockResolvedValue({items:[photo],next:null});
 NativeModules.BobFiles.stageLibraryItem.mockImplementation(async(uri:string)=>({...staged,id:uri,name:uri===photo.uri?photo.name:file.name}));
 const add=jest.fn();let tree!:Renderer.ReactTestRenderer;
 try{
  await act(async()=>{tree=Renderer.create(<AttachmentPicker initialTab="gallery" limit={1000} onClose={()=>{}} onAdd={add}/>);});
  expect(NativeModules.BobFiles.galleryPage).toHaveBeenCalledTimes(1);
  await act(async()=>find(tree,'Screenshot.jpg').props.onPress());
  expect(StyleSheet.flatten(find(tree,'Screenshot.jpg').props.style)).toMatchObject({borderRadius:20,borderWidth:1,borderColor:colors.selectedBorder});
  await act(async()=>find(tree,'Files tab').props.onPress());
  await act(async()=>find(tree,'report.pdf').props.onPress());
  await act(async()=>find(tree,'Add 2 attachments').props.onPress());
  expect(add.mock.calls[0][0].map((item:{name:string})=>item.name)).toEqual(['Screenshot.jpg','report.pdf']);
 }finally{if(tree)await act(async()=>tree.unmount());permission.mockRestore();Object.defineProperty(Platform,'OS',os);Object.defineProperty(Platform,'Version',version);}
});

test('hardware Back pops each nested file path before close while preserving selected and staged files',async()=>{
 const directory={...file,uri:'content://folder/dir',name:'Documents',directory:true,documentId:'dir'};
 const child={...directory,uri:'content://folder/child',name:'Child',documentId:'child'};
 NativeModules.BobFiles.folderPage.mockImplementation(async(_tree:string,doc:string|null)=>({items:doc==='dir'?[child]:doc==='child'?[]:[file,directory]}));
 const close=jest.fn();let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<AttachmentPicker initialTab="files" limit={1000} onClose={close} onAdd={()=>{}}/>);});
 await act(async()=>find(tree,'report.pdf').props.onPress());
 const browse=tree.root.findAll(node=>typeof node.props.onPress==='function'&&node.props.children?.[1]?.props?.children==='Browse files…')[0];
 await act(async()=>browse.props.onPress());
 await act(async()=>find(tree,'Documents').props.onPress());
 await act(async()=>find(tree,'Child').props.onPress());
 expect(NativeModules.BobFiles.folderPage).toHaveBeenLastCalledWith('content://tree/root','child',0);
 await act(async()=>tree.root.findByType(Modal).props.onRequestClose());
 expect(NativeModules.BobFiles.folderPage).toHaveBeenLastCalledWith('content://tree/root','dir',0);expect(close).not.toHaveBeenCalled();
 await act(async()=>tree.root.findByType(Modal).props.onRequestClose());
 expect(NativeModules.BobFiles.folderPage).toHaveBeenLastCalledWith('content://tree/root',null,0);expect(close).not.toHaveBeenCalled();
 expect(find(tree,'report.pdf').props.accessibilityState.checked).toBe(true);
 expect(find(tree,'Add 2 attachments')).toBeDefined();
 expect(NativeModules.BobFiles.removeAttachment).not.toHaveBeenCalled();
 expect(NativeModules.BobFiles.stageLibraryItem).not.toHaveBeenCalled();
 await act(async()=>tree.root.findByType(Modal).props.onRequestClose());expect(close).toHaveBeenCalledTimes(1);
 await act(async()=>tree.unmount());expect(NativeModules.BobFiles.removeAttachment).toHaveBeenCalledWith(staged.id);
});

test('file search honestly filters only loaded files and keeps pagination available',async()=>{
 NativeModules.BobFiles.folderPage.mockResolvedValueOnce({items:[file],more:true}).mockResolvedValueOnce({items:[{...file,uri:'content://folder/second',name:'second.pdf'}],more:false});
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<AttachmentPicker initialTab="files" limit={1000} onClose={()=>{}} onAdd={()=>{}}/>);});
 const input=tree.root.findByType(TextInput);expect(input.props.placeholder).toBe('Search loaded files');expect(input.props.accessibilityLabel).toBe('Search loaded files');
 const calls=NativeModules.BobFiles.folderPage.mock.calls.length;
 await act(async()=>input.props.onChangeText('SECOND'));
 expect(NativeModules.BobFiles.folderPage).toHaveBeenCalledTimes(calls);expect(find(tree,'report.pdf')).toBeUndefined();expect(find(tree,'second.pdf')).toBeUndefined();
 const more=tree.root.findAll(node=>typeof node.props.onPress==='function'&&node.props.children?.props?.children==='Load more')[0];
 await act(async()=>more.props.onPress());
 expect(NativeModules.BobFiles.folderPage).toHaveBeenLastCalledWith('content://tree/root',null,1);expect(find(tree,'second.pdf')).toBeDefined();
 await act(async()=>tree.unmount());
});

test('small picker controls are at least 48dp and selected files have checked state and visible selection',async()=>{
 NativeModules.BobFiles.folderPage.mockResolvedValue({items:[file],more:true});
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<AttachmentPicker initialTab="files" limit={1000} onClose={()=>{}} onAdd={()=>{}}/>);});
 const initial=StyleSheet.flatten(find(tree,'report.pdf').props.style);
 await act(async()=>find(tree,'report.pdf').props.onPress());
 const selected=find(tree,'report.pdf');expect(selected.props.accessibilityState.checked).toBe(true);
 expect(StyleSheet.flatten(selected.props.style)).toMatchObject({borderColor:colors.selectedBorder});
 expect(StyleSheet.flatten(selected.props.style).backgroundColor).not.toBe(initial.backgroundColor);
 expect(find(tree,'Files tab').props.accessibilityState.selected).toBe(true);expect(find(tree,'Gallery tab').props.accessibilityState.selected).toBe(false);
 const controls=tree.root.findAll(node=>typeof node.props.onPress==='function'&&!!node.props.style);
 for(const node of controls){const style=StyleSheet.flatten(node.props.style);expect(style.minHeight??style.height).toBeGreaterThanOrEqual(48);}
 expect(StyleSheet.flatten(tree.root.findByType(TextInput).props.style).minHeight).toBeGreaterThanOrEqual(48);
 await act(async()=>find(tree,'Clear selection').props.onPress());expect(find(tree,'report.pdf').props.accessibilityState.checked).toBe(false);
 await act(async()=>tree.unmount());
});


test('attachment modal keeps Close left and Add right in a separate bottom footer and standardizes cards, input and Add with consistent selected borders',async()=>{
 const close=jest.fn();let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<AttachmentPicker initialTab="files" limit={1000} onClose={close} onAdd={()=>{}}/>);});
 try{
  const heading=tree.root.findByType(SectionHeading);
  expect(heading.props.title).toBe('Add files');expect(heading.props.onBack).toBeUndefined();
  expect(heading.findAllByType(RoundAction)).toHaveLength(0);
  const footer=tree.root.findByType(SectionActions);
  const list=tree.root.findByType(require('react-native').FlatList);
  expect(StyleSheet.flatten(list.props.style)).toMatchObject({flex:1,minHeight:0});
  expect(heading.props.children).toBeUndefined();
  expect(footer.parent!.props.testID).toBe('section-footer-overlay');
  expect(StyleSheet.flatten(footer.parent!.props.style)).toMatchObject({position:'absolute',bottom:0});
  expect(list.parent!.props.testID).toBe('section-scroll-host');
  expect(list.findAllByProps({testID:'section-footer'})).toHaveLength(0);
  expect(footer.findByProps({testID:'section-footer-leading'}).findAllByType(RoundAction).map(node=>node.props.label)).toEqual(['Close add files']);
  expect(StyleSheet.flatten(heading.findAllByType(View)[0].props.style)).toMatchObject({paddingHorizontal:16,paddingTop:28,paddingBottom:8});
  expect(StyleSheet.flatten(find(tree,'report.pdf').props.style)).toMatchObject({minHeight:64});
  expect(StyleSheet.flatten(find(tree,'Gallery tab').props.style)).toMatchObject({borderRadius:999,minHeight:48});
  expect(footer.findByProps({testID:'section-footer-actions'}).findAll(node=>node.props.accessibilityLabel==='Add 0 attachments').length).toBeGreaterThan(0);
  expect(StyleSheet.flatten(find(tree,'Add 0 attachments').props.style)).toMatchObject({borderRadius:999,borderWidth:1,borderColor:colors.foreground,backgroundColor:colors.surface});
  expect(StyleSheet.flatten(tree.root.findByProps({testID:'page-search'}).props.style)).toMatchObject({borderRadius:12,backgroundColor:colors.surface});
  await act(async()=>find(tree,'report.pdf').props.onPress());
  expect(StyleSheet.flatten(find(tree,'report.pdf').props.style)).toMatchObject({borderColor:colors.selectedBorder,backgroundColor:colors.selectedSurface});
  await act(async()=>find(tree,'Close add files').props.onPress());expect(close).toHaveBeenCalledTimes(1);
 }finally{await act(async()=>tree.unmount());}
});


test('attachment input dialog preserves native Android resize without adding Activity keyboard clearance',async()=>{
 const originalOS=Object.getOwnPropertyDescriptor(Platform,'OS')!;
 Object.defineProperty(Platform,'OS',{configurable:true,value:'android'});
 let tree!:Renderer.ReactTestRenderer;
 try{
  await act(async()=>{tree=Renderer.create(<AttachmentPicker initialTab="files" limit={1000} onClose={()=>{}} onAdd={()=>{}}/>);});
  const modal=tree.root.findByType(Modal),host=modal.findByType(SectionHeading).parent!;
  expect(modal.props.statusBarTranslucent).not.toBe(true);
  expect(modal.props.navigationBarTranslucent).not.toBe(true);
  expect(StyleSheet.flatten(host.props.style).paddingBottom).toBeUndefined();
  expect(modal.findAllByType(require('react-native').KeyboardAvoidingView)).toHaveLength(0);
 }finally{
  if(tree)await act(async()=>tree.unmount());
  Object.defineProperty(Platform,'OS',originalOS);
 }
});


test('selection summary and Add/Close share one measured overlay; browser viewport and selection survive footer reflow',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<AttachmentPicker initialTab="files" limit={1000} onClose={()=>{}} onAdd={()=>{}}/>);});
 try{
  const list=tree.root.findByType(require('react-native').FlatList),overlay=tree.root.findByProps({testID:'section-footer-overlay'});
  await act(async()=>find(tree,'report.pdf').props.onPress());
  expect(overlay.findAll(node=>node.props.accessibilityLabel==='Clear selection').length).toBeGreaterThan(0);
  expect(overlay.findAll(node=>node.props.accessibilityLabel==='Add 1 attachments').length).toBeGreaterThan(0);
  for(const height of [216,144]){
   act(()=>overlay.props.onLayout({nativeEvent:{layout:{height}}}));
   expect(StyleSheet.flatten(list.props.contentContainerStyle).paddingBottom).toBe(height+28);
   expect(tree.root.findByType(require('react-native').FlatList)===list).toBe(true);
   expect(find(tree,'report.pdf').props.accessibilityState.checked).toBe(true);
   expect(tree.root.findAllByType(require('../components/edge-fade').EdgeFade).find(node=>node.props.edge==='bottom')!.props.height).toBe(height+12);
  }
  await act(async()=>find(tree,'Clear selection').props.onPress());
  expect(find(tree,'report.pdf').props.accessibilityState.checked).toBe(false);
  act(()=>overlay.props.onLayout({nativeEvent:{layout:{height:64}}}));
  expect(StyleSheet.flatten(list.props.contentContainerStyle).paddingBottom).toBe(92);
  expect(StyleSheet.flatten(tree.root.findByProps({testID:'section-footer'}).props.style)).toMatchObject({backgroundColor:'transparent',borderTopWidth:0});
 }finally{await act(async()=>tree.unmount());}
});
