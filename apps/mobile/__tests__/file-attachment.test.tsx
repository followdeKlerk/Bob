import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Alert} from 'react-native';
import {FileAttachment} from '../components/file-attachment';
import {AttachmentDetails} from '../components/attachment-details';
import {StreamingMedia} from '../components/streaming-media';
import {SentAttachmentThumbnail} from '../components/attachment-thumbnail';
const backend={backendId:'fixture',endpoint:'https://fixture.ts.net'},artifact={id:'file',conversationId:1,name:'My CV.pdf',mime:'application/pdf',size:2048};
let thumbnailProps:any,mediaProps:any;
const mockMediaMount=jest.fn(),mockMediaUnmount=jest.fn();
jest.mock('../components/attachment-details',()=>({AttachmentDetails:()=>null}));
jest.mock('../components/streaming-media',()=>({StreamingMedia:(props:any)=>{mediaProps=props;require('react').useEffect(()=>{mockMediaMount();return mockMediaUnmount;},[]);return null;}}));
jest.mock('../components/attachment-thumbnail',()=>({SentAttachmentThumbnail:(props:any)=>{thumbnailProps=props;return null;}}));
const details=(tree:Renderer.ReactTestRenderer)=>tree.root.findAllByType(AttachmentDetails);
beforeEach(()=>jest.clearAllMocks());

test('user upload hides visual filename and save action, with local details available on demand instead of a native alert',()=>{
 const alert=jest.spyOn(Alert,'alert').mockImplementation(()=>{}),open=jest.fn();let tree!:Renderer.ReactTestRenderer;
 act(()=>{tree=Renderer.create(<FileAttachment backend={backend} artifact={artifact} fromBob={false} onOpen={open}/>);});
 expect(thumbnailProps.artifact.name).toBe(artifact.name);expect(thumbnailProps.hideFilename).toBe(true);expect(thumbnailProps.onOpen).toBe(open);expect(thumbnailProps.onSave).toBeUndefined();expect(typeof thumbnailProps.onDetails).toBe('function');
 expect(details(tree)).toHaveLength(0);
 const thumbnail=tree.root.findByType(SentAttachmentThumbnail),showDetails=thumbnailProps.onDetails;
 act(()=>showDetails());expect(details(tree)[0].props.artifact).toBe(artifact);expect(alert).not.toHaveBeenCalled();
 expect(tree.root.findByType(SentAttachmentThumbnail)).toBe(thumbnail);expect(thumbnailProps.onDetails).toBe(showDetails);expect(thumbnailProps.onOpen).toBe(open);expect(thumbnailProps.hideFilename).toBe(true);
 act(()=>details(tree)[0].props.onClose());expect(details(tree)).toHaveLength(0);
 act(()=>tree.unmount());alert.mockRestore();
});
test('Bob file keeps its small save action without restoring the large filename row',()=>{
 const save=jest.fn();let tree!:Renderer.ReactTestRenderer;act(()=>{tree=Renderer.create(<FileAttachment backend={backend} artifact={artifact} fromBob onOpen={()=>{}} onSave={save}/>);});
 expect(thumbnailProps.hideFilename).toBe(true);expect(thumbnailProps.onSave).toBe(save);act(()=>thumbnailProps.onSave());expect(save).toHaveBeenCalledTimes(1);act(()=>tree.unmount());
});
test('user uploads are not labeled as files sent by Bob',()=>{
 let tree!:Renderer.ReactTestRenderer;act(()=>{tree=Renderer.create(<FileAttachment backend={backend} artifact={{...artifact,size:0}} fromBob={false} onOpen={()=>{}}/>);});
 expect(tree.root.findAllByType(require('react-native').Text).map(node=>node.props.children)).not.toContain('File from Bob');act(()=>tree.unmount());
});

test('media routes to the inline player with lifecycle scope, while Open and optional Save remain separate',()=>{
 const open=jest.fn(),save=jest.fn();let tree!:Renderer.ReactTestRenderer;
 act(()=>{tree=Renderer.create(<FileAttachment backend={backend} artifact={{...artifact,name:'clip.mp4',mime:'application/octet-stream'}} fromBob onOpen={open} onSave={save} active={false}/>);});
 expect(mediaProps.video).toBe(true);expect(mediaProps.active).toBe(false);expect(mediaProps.onOpen).toBe(open);expect(mediaProps.onSave).toBe(save);
 act(()=>mediaProps.onDetails());expect(details(tree)).toHaveLength(0);
 act(()=>tree.update(<FileAttachment backend={backend} artifact={{...artifact,name:'song.mp3',mime:'audio/mpeg'}} fromBob={false} onOpen={open} onSave={save}/>));
 expect(mediaProps.video).toBe(false);expect(mediaProps.active).toBe(true);expect(mediaProps.onSave).toBeUndefined();act(()=>tree.unmount());
});

test('opening/closing media details preserves native component identity, callback identity and save ownership',()=>{
 const props={backend,artifact:{...artifact,name:'clip.mp4',mime:'video/mp4'},fromBob:true,onOpen:jest.fn(),onSave:jest.fn()};let tree!:Renderer.ReactTestRenderer;
 act(()=>{tree=Renderer.create(<FileAttachment {...props}/>);});
 const player=tree.root.findByType(StreamingMedia),showDetails=mediaProps.onDetails;
 act(()=>showDetails());
 expect(details(tree)).toHaveLength(1);expect(tree.root.findByType(StreamingMedia)).toBe(player);expect(mediaProps.onDetails).toBe(showDetails);expect(mediaProps.onOpen).toBe(props.onOpen);expect(mediaProps.onSave).toBe(props.onSave);expect(mockMediaMount).toHaveBeenCalledTimes(1);expect(mockMediaUnmount).not.toHaveBeenCalled();
 act(()=>details(tree)[0].props.onClose());expect(details(tree)).toHaveLength(0);expect(mediaProps.onDetails).toBe(showDetails);
 act(()=>tree.update(<FileAttachment {...props} backend={{...backend}} artifact={{...props.artifact}} fromBob={false}/>));
 expect(mediaProps.onDetails).toBe(showDetails);expect(mediaProps.onSave).toBeUndefined();expect(mockMediaMount).toHaveBeenCalledTimes(1);expect(mockMediaUnmount).not.toHaveBeenCalled();expect(props.onOpen).not.toHaveBeenCalled();expect(props.onSave).not.toHaveBeenCalled();act(()=>tree.unmount());
});

test.each([
 ['artifact',{artifact:{...artifact,id:'replacement'}}],
 ['conversation',{artifact:{...artifact,conversationId:2}}],
 ['backend',{backend:{...backend,backendId:'another'}}],
 ['endpoint',{backend:{...backend,endpoint:'https://another.ts.net'}}],
 ['metadata',{artifact:{...artifact,name:'new-name.pdf',mime:'application/octet-stream',size:1}}],
 ['off-chat',{active:false}],
] as const)('details dismiss on %s changes and do not reappear when returning to the old scope',(_reason,changed)=>{
 const props={backend,artifact,fromBob:false,onOpen:jest.fn()};let tree!:Renderer.ReactTestRenderer;
 act(()=>{tree=Renderer.create(<FileAttachment {...props}/>);});const oldDetails=thumbnailProps.onDetails;
 act(()=>oldDetails());expect(details(tree)).toHaveLength(1);
 act(()=>tree.update(<FileAttachment {...props} {...changed}/>));expect(details(tree)).toHaveLength(0);
 act(()=>oldDetails());expect(details(tree)).toHaveLength(0);
 act(()=>tree.update(<FileAttachment {...props}/>));expect(details(tree)).toHaveLength(0);
 act(()=>thumbnailProps.onDetails());expect(details(tree)).toHaveLength(1);act(()=>tree.unmount());
});

test('APK Open stays the original verified-install owner; details never invokes Open or Save',()=>{
 const props={backend,artifact:{...artifact,name:'Bob.apk',mime:'application/vnd.android.package-archive'},fromBob:true,onOpen:jest.fn(),onSave:jest.fn()};let tree!:Renderer.ReactTestRenderer;
 act(()=>{tree=Renderer.create(<FileAttachment {...props}/>);});expect(thumbnailProps.onOpen).toBe(props.onOpen);expect(thumbnailProps.onSave).toBe(props.onSave);
 act(()=>thumbnailProps.onDetails());expect(props.onOpen).not.toHaveBeenCalled();expect(props.onSave).not.toHaveBeenCalled();
 act(()=>thumbnailProps.onOpen());expect(props.onOpen).toHaveBeenCalledTimes(1);act(()=>tree.unmount());
});
