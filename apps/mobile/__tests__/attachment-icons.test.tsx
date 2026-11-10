import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {StyleSheet,Text} from 'react-native';
import {AttachmentThumbnail,SentAttachmentThumbnail} from '../components/attachment-thumbnail';
jest.mock('react-native-keychain',()=>({getGenericPassword:jest.fn()}));
jest.mock('lucide-react-native',()=>({FileText:'FileText',File:'File',FileArchive:'FileArchive',FileCode:'FileCode',FileSpreadsheet:'FileSpreadsheet',FileVideo:'FileVideo',FileAudio:'FileAudio',FileImage:'FileImage',FileType:'FileType',Package:'Package',Presentation:'Presentation',Info:'Info',Download:'Download',X:'X'}));
test.each([
 ['app.apk','application/octet-stream','Package','APK'],['notes.txt','text/plain','FileText','TXT'],['CV.pdf','application/pdf','FileType','PDF'],
 ['voice.mp3','audio/mpeg','FileAudio','MP3'],['clip.mp4','video/mp4','FileVideo','MP4'],['unknown.blob','application/octet-stream','File','FILE'],
 ['package.zip','application/zip','FileArchive','ZIP'],['source.json','application/json','FileCode','JSON'],
])('%s renders a small meaningful icon and readable badge without showing filename',async(name,mime,icon,badge)=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<AttachmentThumbnail name={name} mime={mime} hideFilename/>);});
 expect(tree.root.findByType(icon as any).props.size).toBe(26);expect(tree.root.findAllByType(Text).map(node=>node.props.children)).toEqual([badge]);
 await act(async()=>tree.unmount());
});
test('Info and Save keep independent minimum 48dp targets and preserve details/open/save callbacks',async()=>{
 const open=jest.fn(),details=jest.fn(),save=jest.fn();let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<SentAttachmentThumbnail backend={{backendId:'fixture',endpoint:'https://owner.ts.net'}} artifact={{id:'file',conversationId:7,name:'app.apk',mime:'application/vnd.android.package-archive'}} onOpen={open} onDetails={details} onSave={save} hideFilename/>);});
 for(const [label,callback] of [['Attachment details: app.apk',details],['Save app.apk',save]] as const){
  const button=tree.root.findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0];
  const style=StyleSheet.flatten(button.props.style);expect(style.width).toBeGreaterThanOrEqual(48);expect(style.height).toBeGreaterThanOrEqual(48);
  await act(async()=>button.props.onPress());expect(callback).toHaveBeenCalledTimes(1);
 }
 const button=tree.root.findAll(node=>node.props.accessibilityLabel==='Open attachment'&&typeof node.props.onPress==='function')[0];await act(async()=>button.props.onPress());expect(open).toHaveBeenCalledTimes(1);
 await act(async()=>tree.unmount());
});
