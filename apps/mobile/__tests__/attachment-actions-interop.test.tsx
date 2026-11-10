import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Platform,StyleSheet} from 'react-native';
import {ThemeContext,tokens} from '../theme-context';
import * as Keychain from 'react-native-keychain';
jest.mock('react-native-keychain',()=>({getGenericPassword:jest.fn()}));
jest.mock('lucide-react-native',()=>({FileText:'FileText',FileType:'FileType',Info:'Info',Download:'Download',X:'X'}));
Platform.OS='android';
// Exercise the production NativeWind wrappers, not Jest's interop-free shortcut.
require('react-native-css-interop/dist/runtime/components');
const {SentAttachmentThumbnail}=require('../components/attachment-thumbnail');
const artifact={id:'pdf',conversationId:7,name:'reader.pdf',mime:'application/pdf'};
const backend={backendId:'fixture',endpoint:'https://fixture.invalid'};
const host=(tree:Renderer.ReactTestRenderer,label:string)=>tree.root.findAll(node=>typeof node.type==='string'&&node.props.accessibilityRole==='button'&&node.props.accessibilityLabel===label)[0];

test.each(['light','dark'] as const)('Download and Details share one unboxed row beneath the preview in %s',async(scheme)=>{
 let tree!:Renderer.ReactTestRenderer;const open=jest.fn(),details=jest.fn(),save=jest.fn();
 try{
  await act(async()=>{tree=Renderer.create(<ThemeContext.Provider value={tokens[scheme]}><SentAttachmentThumbnail backend={backend} artifact={artifact} onOpen={open} onDetails={details} onSave={save} hideFilename/></ThemeContext.Provider>);});
  const row=tree.root.findAll(node=>typeof node.type==='string'&&node.props.testID==='attachment-actions')[0];
  expect(StyleSheet.flatten(row.props.style).flexDirection).toBe('row');
  const info=host(tree,'Attachment details: reader.pdf'),download=host(tree,'Save reader.pdf');
  expect(row.findAll(node=>node===info)).toHaveLength(1);expect(row.findAll(node=>node===download)).toHaveLength(1);
  for(const control of [info,download]){
   const style=StyleSheet.flatten(control.props.style);
   expect(style.width).toBe(48);expect(style.height).toBe(48);
   expect(style.borderWidth??0).toBe(0);expect(style.backgroundColor??'transparent').toBe('transparent');expect(style.marginBottom??0).toBe(0);
  }
  const infoIcon=tree.root.findByType('Info' as any),downloadIcon=tree.root.findByType('Download' as any);
  expect(downloadIcon.props.size).toBe(infoIcon.props.size);expect(downloadIcon.props.size).toBe(15);
  expect(downloadIcon.props.color).toBe(tokens[scheme].colors.muted);expect(infoIcon.props.color).toBe(downloadIcon.props.color);
  for(const [label,callback] of [['Attachment details: reader.pdf',details],['Save reader.pdf',save]] as const){
   await act(async()=>tree.root.findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0].props.onPress());
   expect(callback).toHaveBeenCalledTimes(1);
  }
  expect(open).not.toHaveBeenCalled();expect(Keychain.getGenericPassword).not.toHaveBeenCalled();
 }finally{await act(async()=>tree?.unmount());}
});

test('removing save permission leaves Details centered and the preview mounted',async()=>{
 let tree!:Renderer.ReactTestRenderer;const props={backend,artifact,onOpen:jest.fn(),onDetails:jest.fn(),hideFilename:true};
 try{
  await act(async()=>{tree=Renderer.create(<SentAttachmentThumbnail {...props} onSave={jest.fn()}/>);});
  const preview=host(tree,'Open attachment');
  await act(async()=>tree.update(<SentAttachmentThumbnail {...props}/>));
  expect(host(tree,'Open attachment')).toBe(preview);expect(host(tree,'Save reader.pdf')).toBeUndefined();
  expect(host(tree,'Attachment details: reader.pdf')).toBeDefined();
 }finally{await act(async()=>tree?.unmount());}
});
