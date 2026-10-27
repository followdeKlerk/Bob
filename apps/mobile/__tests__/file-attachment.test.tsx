import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Pressable,Text} from 'react-native';
import {FileAttachment} from '../components/file-attachment';
jest.mock('../components/attachment-thumbnail',()=>({SentAttachmentThumbnail:()=>null}));
const backend={backendId:'fixture',endpoint:'https://fixture.ts.net'},artifact={id:'file',conversationId:1,name:'My CV.pdf',mime:'application/pdf',size:2048};
test('received files expose their name, size and an explicit user-controlled save action',()=>{
 const onOpen=jest.fn(),onSave=jest.fn();let tree!:Renderer.ReactTestRenderer;
 act(()=>{tree=Renderer.create(<FileAttachment backend={backend} artifact={artifact} fromBob onOpen={onOpen} onSave={onSave}/>);});
 const text=tree.root.findAllByType(Text).map(node=>node.props.children);expect(text).toEqual(expect.arrayContaining(['File from Bob','My CV.pdf','2 KB','Save file']));
 expect(onSave).not.toHaveBeenCalled();const button=tree.root.findAll(node=>node.props.accessibilityRole==='button'&&typeof node.props.onPress==='function')[0];expect(button.props.accessibilityLabel).toBe('Save My CV.pdf');
 act(()=>button.props.onPress());expect(onSave).toHaveBeenCalledTimes(1);expect(onOpen).not.toHaveBeenCalled();act(()=>tree.unmount());
});
test('user uploads are not labeled as files sent by Bob',()=>{
 let tree!:Renderer.ReactTestRenderer;act(()=>{tree=Renderer.create(<FileAttachment backend={backend} artifact={{...artifact,size:0}} fromBob={false} onOpen={()=>{}} onSave={()=>{}}/>);});
 const text=tree.root.findAllByType(Text).map(node=>node.props.children);expect(text).not.toContain('File from Bob');expect(text).toContain('0 bytes');act(()=>tree.unmount());
});
