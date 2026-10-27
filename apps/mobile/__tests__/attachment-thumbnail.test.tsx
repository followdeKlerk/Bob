import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Image,Text} from 'react-native';
import {AttachmentThumbnail,SentAttachmentThumbnail} from '../components/attachment-thumbnail';
import * as Keychain from 'react-native-keychain';
jest.mock('react-native-keychain',()=>({getGenericPassword:jest.fn()}));
jest.mock('lucide-react-native',()=>({FileText:()=>null,X:()=>null}));

test('draft image is a compact preview with an accessible remove button, not metadata or action buttons',async()=>{
 const remove=jest.fn();let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<AttachmentThumbnail name="Screenshot.jpg" mime="image/jpeg" source={{uri:'file:///draft'}} onRemove={remove}/>);});
 expect(tree.root.findByType(Image).props.source.uri).toBe('file:///draft');
 expect(tree.root.findAllByType(Text)).toHaveLength(0);
 const button=tree.root.findAll(item=>item.props.accessibilityLabel==='Remove Screenshot.jpg'&&typeof item.props.onPress==='function')[0];
 await act(async()=>button.props.onPress());expect(remove).toHaveBeenCalledTimes(1);
 await act(async()=>tree.unmount());
});
test('sent images use paired backend authentication and do not offer draft removal',async()=>{
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({password:'device-token'});
 const open=jest.fn();let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<SentAttachmentThumbnail backend={{backendId:'backend',endpoint:'https://paired.ts.net'}} artifact={{id:'image-id',conversationId:12,name:'Screenshot.jpg',mime:'image/jpeg'}} onOpen={open}/>);});
 expect(tree.root.findByType(Image).props.source).toEqual({uri:'https://paired.ts.net/v1/chats/12/artifacts/image-id',headers:{Authorization:'Bearer device-token','x-bob-backend':'backend'}});
 expect(tree.root.findAll(item=>item.props.accessibilityLabel?.startsWith('Remove')).length>0).toBe(false);
 await act(async()=>tree.root.findAll(item=>item.props.accessibilityLabel==='Open Screenshot.jpg'&&typeof item.props.onPress==='function')[0].props.onPress());expect(open).toHaveBeenCalledTimes(1);
 await act(async()=>tree.unmount());
});
test('unreadable images and non-image files retain a compact readable fallback',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<AttachmentThumbnail name="Screenshot.jpg" mime="image/jpeg" source={{uri:'file:///missing'}}/>);});
 await act(async()=>tree.root.findByType(Image).props.onError());
 expect(tree.root.findAllByType(Image)).toHaveLength(0);
 expect(tree.root.findByType(Text).props.children).toBe('Screenshot.jpg');
 await act(async()=>tree.update(<AttachmentThumbnail name="notes.txt" mime="text/plain"/>));
 expect(tree.root.findByType(Text).props.children).toBe('notes.txt');
 await act(async()=>tree.unmount());
});
