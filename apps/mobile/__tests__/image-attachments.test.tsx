import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import * as Keychain from 'react-native-keychain';
import {ImageAttachments} from '../components/image-attachments';
import {ImageAttachmentStack} from '../components/image-attachment-stack';
import {AttachmentDetails} from '../components/attachment-details';
import type {ImageArtifact} from '../image-attachment-rows';
jest.mock('react-native-keychain',()=>({getGenericPassword:jest.fn(async()=>({password:'paired-token'}))}));
jest.mock('../components/image-attachment-stack',()=>({ImageAttachmentStack:()=>null}));
jest.mock('../components/attachment-details',()=>({AttachmentDetails:()=>null}));
const backend={backendId:'paired-one',endpoint:'https://one.test'};
const photo=(id:string,conversationId=7):ImageArtifact=>({id,conversationId,name:`${id}.png`,mime:'image/png',size:123,sha256:'a'.repeat(64)});
const props={backend,artifacts:[photo('one'),photo('two')],fromBob:false,onOpen:jest.fn(),onSave:jest.fn()};
const stack=(tree:Renderer.ReactTestRenderer)=>tree.root.findByType(ImageAttachmentStack);
const details=(tree:Renderer.ReactTestRenderer)=>tree.root.findAllByType(AttachmentDetails);
beforeEach(()=>{jest.clearAllMocks();(Keychain.getGenericPassword as jest.Mock).mockResolvedValue({password:'paired-token'});});

test('authenticated image sources and selected actions use exact metadata, not the first item',async()=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<ImageAttachments {...props}/>);});
 expect(Keychain.getGenericPassword).toHaveBeenCalledWith({service:'bob.paired-one'});
 expect(stack(tree).props.images[1].source).toEqual({uri:'https://one.test/v1/chats/7/artifacts/two',headers:{Authorization:'Bearer paired-token','x-bob-backend':'paired-one'}});
 expect(stack(tree).props.onSave).toBeUndefined();act(()=>stack(tree).props.onOpen(stack(tree).props.images[1]));expect(props.onOpen).toHaveBeenCalledWith(props.artifacts[1]);
 const child=stack(tree);act(()=>child.props.onDetails(child.props.images[1]));expect(details(tree)[0].props.artifact).toBe(props.artifacts[1]);expect(stack(tree)).toBe(child);expect(child.props.active).toBe(false);
 act(()=>details(tree)[0].props.onClose());expect(child.props.active).toBe(true);expect(stack(tree)).toBe(child);
 await act(async()=>tree.update(<ImageAttachments {...props} fromBob/>));act(()=>stack(tree).props.onSave(stack(tree).props.images[1]));expect(props.onSave).toHaveBeenCalledWith(props.artifacts[1]);
 await act(async()=>tree.unmount());
});
test('appending images keeps the existing stack and credential request',async()=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<ImageAttachments {...props}/>);});const child=stack(tree);
 await act(async()=>tree.update(<ImageAttachments {...props} artifacts={[...props.artifacts,photo('three')]}/>));expect(stack(tree)).toBe(child);expect(child.props.images).toHaveLength(3);expect(Keychain.getGenericPassword).toHaveBeenCalledTimes(1);
 await act(async()=>tree.unmount());
});
test('late old-backend credentials never paint into the new scope, even before the new lookup resolves',async()=>{
 let resolveOld!:(value:any)=>void,resolveNew!:(value:any)=>void;
 (Keychain.getGenericPassword as jest.Mock).mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;})).mockImplementationOnce(()=>new Promise(resolve=>{resolveNew=resolve;}));
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<ImageAttachments {...props}/>);});const old=stack(tree).props;
 await act(async()=>tree.update(<ImageAttachments {...props} backend={{backendId:'paired-two',endpoint:'https://two.test'}}/>));
 act(()=>old.onOpen(old.images[0]));expect(props.onOpen).not.toHaveBeenCalled();
 await act(async()=>resolveOld({password:'OLD-SECRET'}));expect(stack(tree).props.images.every((item:any)=>!item.source)).toBe(true);
 await act(async()=>resolveNew({password:'NEW-SECRET'}));expect(stack(tree).props.images[0].source.headers).toEqual({Authorization:'Bearer NEW-SECRET','x-bob-backend':'paired-two'});expect(JSON.stringify(stack(tree).props.images)).not.toContain('OLD-SECRET');
 await act(async()=>tree.unmount());
});
test.each(['backend','endpoint','conversation','inactive','removed'] as const)('%s changes revoke old actions/details and keep them dismissed',async change=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<ImageAttachments {...props} fromBob/>);});const old=stack(tree).props;
 act(()=>old.onDetails(old.images[0]));expect(details(tree)).toHaveLength(1);
 const changed=change==='backend'?{backend:{...backend,backendId:'other'}}:change==='endpoint'?{backend:{...backend,endpoint:'https://other.test'}}:change==='conversation'?{artifacts:[photo('one',8)]}:change==='inactive'?{active:false}:{artifacts:[photo('new')]};
 await act(async()=>tree.update(<ImageAttachments {...props} fromBob {...changed}/>));expect(details(tree)).toHaveLength(0);
 act(()=>{old.onOpen(old.images[0]);old.onSave(old.images[0]);old.onDetails(old.images[0]);});expect(props.onOpen).not.toHaveBeenCalled();expect(props.onSave).not.toHaveBeenCalled();expect(details(tree)).toHaveLength(0);
 await act(async()=>tree.update(<ImageAttachments {...props} fromBob/>));expect(details(tree)).toHaveLength(0);
 await act(async()=>tree.unmount());
});
test('unmount, absent credentials and removed save ownership do not invoke stale native actions',async()=>{
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue(false);let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<ImageAttachments {...props} fromBob/>);});const old=stack(tree).props;expect(old.images.every((item:any)=>!item.source)).toBe(true);
 await act(async()=>tree.update(<ImageAttachments {...props}/>));act(()=>old.onSave(old.images[0]));expect(props.onSave).not.toHaveBeenCalled();
 await act(async()=>tree.unmount());act(()=>old.onOpen(old.images[0]));expect(props.onOpen).not.toHaveBeenCalled();
});
test('untrusted image IDs cannot become path segments and mixed conversations are not fetched together',async()=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<ImageAttachments {...props} artifacts={[photo('../escape'),photo('other',8)]}/>);});
 expect(stack(tree).props.images).toHaveLength(1);expect(stack(tree).props.images[0].source.uri).toBe('https://one.test/v1/chats/7/artifacts/..%2Fescape');await act(async()=>tree.unmount());
});
