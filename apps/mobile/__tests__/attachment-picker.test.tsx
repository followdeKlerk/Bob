import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {NativeModules,PermissionsAndroid,Platform} from 'react-native';
import {AttachmentPicker,requestGalleryAccess} from '../components/attachment-picker';
import {PlusMenu} from '../components/plus-menu';
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View}));
jest.mock('lucide-react-native',()=>({ArrowLeft:()=>null,Check:()=>null,ChevronRight:()=>null,FileText:()=>null,Folder:()=>null,FolderOpen:()=>null,Image:()=>null,Search:()=>null,Upload:()=>null,X:()=>null,Camera:()=>null,Paperclip:()=>null,SlidersHorizontal:()=>null,Ellipsis:()=>null}));
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
 const gallery=jest.fn(),more=jest.fn();let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<PlusMenu bottom={90} maxHeight={400} disabled={false} onCamera={()=>{}} onGallery={gallery} onFiles={()=>{}} onModel={()=>{}} onMore={more}/>);});
 for(const label of ['Camera','Gallery','Files','Model & thinking','More'])expect(find(tree,label)).toBeDefined();
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
  await act(async()=>find(tree,'Files tab').props.onPress());
  await act(async()=>find(tree,'report.pdf').props.onPress());
  await act(async()=>find(tree,'Add 2 attachments').props.onPress());
  expect(add.mock.calls[0][0].map((item:{name:string})=>item.name)).toEqual(['Screenshot.jpg','report.pdf']);
 }finally{if(tree)await act(async()=>tree.unmount());permission.mockRestore();Object.defineProperty(Platform,'OS',os);Object.defineProperty(Platform,'Version',version);}
});
