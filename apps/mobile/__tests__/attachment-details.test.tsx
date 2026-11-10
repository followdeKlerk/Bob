import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Modal,ScrollView,StyleSheet,Text as NativeText} from 'react-native';
import {AttachmentDetails} from '../components/attachment-details';
import {Button} from '../components/ui/button';
import {ThemeContext,tokens} from '../theme-context';
import {APP_FONT_FAMILY,APP_UI_FONT_FAMILY} from '../typography';

jest.mock('react-native-safe-area-context',()=>({SafeAreaProvider:'SafeAreaProvider',SafeAreaView:'SafeAreaView'}));
jest.mock('lucide-react-native',()=>({X:()=>null}));
const artifact={name:'My CV.pdf',mime:'application/pdf',size:2048};
const text=(tree:Renderer.ReactTestRenderer,value:string)=>tree.root.findAllByType(NativeText).find(node=>node.props.children===value)!;
const close=(tree:Renderer.ReactTestRenderer)=>tree.root.findByType(Button);

test.each(['light','dark'] as const)('%s sheet uses Bob palette and typography for every text surface, with safe areas and one 48dp close action',scheme=>{
 let tree!:Renderer.ReactTestRenderer;act(()=>{tree=Renderer.create(<ThemeContext.Provider value={tokens[scheme]}><AttachmentDetails artifact={artifact} onClose={()=>{}}/></ThemeContext.Provider>);});
 const {colors}=tokens[scheme],sheet=tree.root.findByProps({testID:'attachment-details-sheet'});
 expect(StyleSheet.flatten(sheet.props.style).backgroundColor).toBe(colors.panel);
 for(const value of ['Attachment details',artifact.name])expect(StyleSheet.flatten(text(tree,value).props.style).color).toBe(colors.foreground);
 for(const value of ['Type','MIME type','Size'])expect(StyleSheet.flatten(text(tree,value).props.style).color).toBe(colors.muted);
 for(const value of ['PDF document','application/pdf','2 KB'])expect(StyleSheet.flatten(text(tree,value).props.style).color).toBe(colors.body);
 for(const node of tree.root.findAllByType(NativeText))expect(StyleSheet.flatten(node.props.style).fontFamily).toBe(node.props.children===artifact.mime?APP_FONT_FAMILY:APP_UI_FONT_FAMILY);
 expect(tree.root.findByType('SafeAreaView' as any).props.edges).toEqual(['top','right','bottom','left']);
 expect(tree.root.findByType(ScrollView).findAllByType(Button)).toHaveLength(0);
 expect(sheet.props.accessibilityViewIsModal).toBe(true);expect(tree.root.findByType(Modal).props.transparent).toBe(true);
 expect(tree.root.findAllByType(Button)).toHaveLength(1);expect(close(tree).props.accessibilityLabel).toBe('Close attachment details');
 const target=StyleSheet.flatten(close(tree).props.style);expect(target.minWidth).toBeGreaterThanOrEqual(48);expect(target.minHeight).toBeGreaterThanOrEqual(48);
 act(()=>tree.unmount());
});

test('a mounted sheet follows palette changes without remounting its scroll host',()=>{
 let tree!:Renderer.ReactTestRenderer;const render=(scheme:'light'|'dark')=><ThemeContext.Provider value={tokens[scheme]}><AttachmentDetails artifact={artifact} onClose={()=>{}}/></ThemeContext.Provider>;
 act(()=>{tree=Renderer.create(render('dark'));});const scroll=tree.root.findByType(ScrollView);
 act(()=>tree.update(render('light')));expect(tree.root.findByType(ScrollView)).toBe(scroll);expect(StyleSheet.flatten(text(tree,artifact.name).props.style).color).toBe(tokens.light.colors.foreground);act(()=>tree.unmount());
});

test('explicit close and Android Back use the same dismissal callback',()=>{
 const onClose=jest.fn();let tree!:Renderer.ReactTestRenderer;act(()=>{tree=Renderer.create(<AttachmentDetails artifact={artifact} onClose={onClose}/>);});
 expect(close(tree).props.onPress).toBe(onClose);expect(tree.root.findByType(Modal).props.onRequestClose).toBe(onClose);
 act(()=>close(tree).props.onPress());expect(onClose).toHaveBeenCalledTimes(1);
 act(()=>tree.root.findByType(Modal).props.onRequestClose());expect(onClose).toHaveBeenCalledTimes(2);act(()=>tree.unmount());
});

test('long unbroken names and exact MIME remain selectable and naturally wrapped, with uncapped font scaling inside a bounded scroll host',()=>{
 const name=`${'a-very-long-unbroken-filename'.repeat(35)}.pdf`,mime='application/pdf; profile="Full Exact MIME"';
 const dimensions=jest.spyOn(require('react-native'),'useWindowDimensions').mockReturnValue({width:320,height:420,scale:1,fontScale:3});
 let tree!:Renderer.ReactTestRenderer;act(()=>{tree=Renderer.create(<AttachmentDetails artifact={{name,mime,size:1234567}} onClose={()=>{}}/>);});
 expect(text(tree,name).props.selectable).toBe(true);expect(text(tree,mime).props.selectable).toBe(true);expect(text(tree,'PDF document')).toBeDefined();
 const scroll=tree.root.findByType(ScrollView),sheet=tree.root.findByProps({testID:'attachment-details-sheet'});
 expect(StyleSheet.flatten(sheet.props.style).maxHeight).toBe('85%');expect(StyleSheet.flatten(scroll.props.style).flexShrink).toBe(1);expect(scroll.props.scrollEnabled).not.toBe(false);
 for(const node of tree.root.findAllByType(NativeText)){
  expect(node.props.numberOfLines).toBeUndefined();expect(node.props.adjustsFontSizeToFit).not.toBe(true);expect(node.props.allowFontScaling).not.toBe(false);expect(node.props.maxFontSizeMultiplier).toBeUndefined();
  const style=StyleSheet.flatten(node.props.style);expect(style.height).toBeUndefined();expect(style.maxHeight).toBeUndefined();expect(style.overflow).not.toBe('hidden');
 }
 act(()=>tree.unmount());dimensions.mockRestore();
});

test.each([[0,'0 bytes'],[1,'1 byte'],[1023,'1023 bytes'],[1024,'1 KB'],[1536,'1.5 KB'],[1048576,'1 MB'],[1073741824,'1 GB']] as const)('size %s is readable as %s',(size,label)=>{
 let tree!:Renderer.ReactTestRenderer;act(()=>{tree=Renderer.create(<AttachmentDetails artifact={{...artifact,size}} onClose={()=>{}}/>);});expect(text(tree,label)).toBeDefined();act(()=>tree.unmount());
});

test.each([
 ['clip.mp4','application/octet-stream','Video'],['song.mp3','audio/mpeg','Audio'],['Bob.apk','application/vnd.android.package-archive','Android app'],['unknown.blob','application/x-unknown','File'],
])('friendly type for %s preserves the exact declared MIME',(name,mime,label)=>{
 let tree!:Renderer.ReactTestRenderer;act(()=>{tree=Renderer.create(<AttachmentDetails artifact={{name,mime,size:1}} onClose={()=>{}}/>);});expect(text(tree,label)).toBeDefined();expect(text(tree,mime)).toBeDefined();act(()=>tree.unmount());
});

test('details are local-only and omit transport metadata and duplicate Open/Save actions',()=>{
 const fetch=jest.spyOn(globalThis,'fetch');
 const localArtifact={...artifact,id:'private-artifact-id',conversationId:782,endpoint:'https://private-backend.ts.net',token:'private-token'};
 let tree!:Renderer.ReactTestRenderer;act(()=>{tree=Renderer.create(<AttachmentDetails artifact={localArtifact} onClose={()=>{}}/>);});
 expect(fetch).not.toHaveBeenCalled();const visible=tree.root.findAllByType(NativeText).map(node=>node.props.children).join('\n');
 for(const hidden of [localArtifact.id,String(localArtifact.conversationId),localArtifact.endpoint,localArtifact.token,'Open','Save'])expect(visible).not.toContain(hidden);
 expect(tree.root.findAllByType(Button)).toHaveLength(1);act(()=>tree.unmount());fetch.mockRestore();
});
