import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Alert} from 'react-native';
import {FileAttachment} from '../components/file-attachment';
const backend={backendId:'fixture',endpoint:'https://fixture.ts.net'},artifact={id:'file',conversationId:1,name:'My CV.pdf',mime:'application/pdf',size:2048};
let thumbnailProps:any;
jest.mock('../components/attachment-thumbnail',()=>({SentAttachmentThumbnail:(props:any)=>{thumbnailProps=props;return null;}}));

test('user upload hides visual filename and save action, with details available on demand',()=>{
 const alert=jest.spyOn(Alert,'alert').mockImplementation(()=>{}),open=jest.fn();let tree!:Renderer.ReactTestRenderer;
 act(()=>{tree=Renderer.create(<FileAttachment backend={backend} artifact={artifact} fromBob={false} onOpen={open}/>);});
 expect(thumbnailProps.artifact.name).toBe(artifact.name);expect(thumbnailProps.hideFilename).toBe(true);expect(thumbnailProps.onOpen).toBe(open);expect(thumbnailProps.onSave).toBeUndefined();expect(typeof thumbnailProps.onDetails).toBe('function');
 act(()=>thumbnailProps.onDetails());expect(alert).toHaveBeenCalledWith('Attachment details','My CV.pdf\napplication/pdf\n2 KB');act(()=>tree.unmount());alert.mockRestore();
});
test('Bob file keeps its small save action without restoring the large filename row',()=>{
 const save=jest.fn();let tree!:Renderer.ReactTestRenderer;act(()=>{tree=Renderer.create(<FileAttachment backend={backend} artifact={artifact} fromBob onOpen={()=>{}} onSave={save}/>);});
 expect(thumbnailProps.hideFilename).toBe(true);expect(typeof thumbnailProps.onSave).toBe('function');act(()=>thumbnailProps.onSave());expect(save).toHaveBeenCalledTimes(1);act(()=>tree.unmount());
});
test('user uploads are not labeled as files sent by Bob',()=>{
 let tree!:Renderer.ReactTestRenderer;act(()=>{tree=Renderer.create(<FileAttachment backend={backend} artifact={{...artifact,size:0}} fromBob={false} onOpen={()=>{}}/>);});
 expect(tree.root.findAllByType(require('react-native').Text).map(node=>node.props.children)).not.toContain('File from Bob');act(()=>tree.unmount());
});
