import React,{memo,useEffect,useState} from 'react';
import Renderer,{act} from 'react-test-renderer';
import {NativeModules,ScrollView,StyleSheet,View} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {ChatTheme,MenuTheme,menuThemes,menuVariables} from '../menu-theme';
import {PreferenceContext,ThemeContext,tokens} from '../theme-context';
import {useTheme} from '../theme';
import {Text,TextInput} from '../components/app-text';
import {Button} from '../components/ui/button';
import {Text as ControlText} from '../components/ui/text';
import {Tabs,TabsList,TabsTrigger} from '../components/ui/tabs';
import {TouchTarget} from '../components/touch-target';
import {EdgeFade} from '../components/edge-fade';
import {AttachmentDetails} from '../components/attachment-details';
import {PlusMenu} from '../components/plus-menu';
import {ChatNavigation} from '../components/chat-navigation';
import {SessionActions} from '../components/session-actions';
import {AgentsScreen} from '../components/agents-screen';

jest.mock('lucide-react-native',()=>new Proxy({},{get:(_,name)=>name==='__esModule'?true:()=>null}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaProvider:require('react-native').View,SafeAreaView:require('react-native').View,useSafeAreaInsets:()=>({top:0,bottom:0,left:0,right:0})}));
jest.mock('react-native-svg',()=>({__esModule:true,default:'Svg',Defs:'Defs',LinearGradient:'LinearGradient',Rect:'Rect',Stop:'Stop'}));
jest.mock('@react-native-async-storage/async-storage',()=>({getItem:jest.fn(async()=>null),setItem:jest.fn(async()=>{})}));
const settings={preference:'dark' as const,setPreference:jest.fn(async()=>{}),storageError:''};
const seen:Record<string,ReturnType<typeof useTheme>>={};
const Probe=memo(function Probe({id}:{id:string}){seen[id]=useTheme();return <View testID={id}/>;});
let mounts=0;
function MenuDraft(){
 const [value,setValue]=useState('Keep this menu draft');
 useEffect(()=>{mounts++;},[]);
 return <><Probe id="menu"/><TextInput testID="menu-draft" value={value} onChangeText={setValue}/><MenuTheme><Probe id="nested"/></MenuTheme><ChatTheme><Probe id="helper"/></ChatTheme></>;
}
afterEach(()=>{jest.clearAllMocks();});

test('nested menus follow the resolved scheme while preserving tokens, preference authority and mounted draft identity',async()=>{
 const snapshots=JSON.stringify(tokens);mounts=0;
 NativeModules.BobPlatform={setAppearance:jest.fn()};
 const render=(scheme:'light'|'dark')=><ThemeContext.Provider value={tokens[scheme]}><PreferenceContext.Provider value={settings}><Probe id="chat"/><MenuTheme><MenuDraft/></MenuTheme></PreferenceContext.Provider></ThemeContext.Provider>;
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(render('dark'));});
 try{
  const draft=tree.root.findByProps({testID:'menu-draft'});
  act(()=>draft.props.onChangeText('Still editing'));
  for(const scheme of ['light','dark','light'] as const){
   await act(async()=>tree.update(render(scheme)));
   expect(seen.chat.colors).toBe(tokens[scheme].colors);expect(seen.helper.colors).toBe(tokens[scheme].colors);
   expect(seen.menu.colors).toBe(tokens[scheme].colors);expect(seen.nested.colors).toBe(tokens[scheme].colors);
   expect(seen.menu.colors.background).toBe(scheme==='light'?'#e8dfd0':'#1b1c1d');expect(seen.menu.scheme).toBe(scheme);
   expect(seen.menu.preference).toBe('dark');expect(seen.menu.setPreference).toBe(settings.setPreference);
   expect(tree.root.findByProps({testID:'menu-draft'})).toBe(draft);expect(draft.props.value).toBe('Still editing');
  }
  expect(mounts).toBe(1);expect(JSON.stringify(tokens)).toBe(snapshots);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  expect(NativeModules.BobPlatform.setAppearance).not.toHaveBeenCalled();expect(settings.setPreference).not.toHaveBeenCalled();
 }finally{await act(async()=>tree.unmount());}
});

test.each(['dark','light'] as const)('nested nativewind controls and fades use local menu variables under %s chat',async scheme=>{
 const style={minHeight:48};let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<ThemeContext.Provider value={tokens[scheme]}><MenuTheme>
  <Button variant="outline" style={style}><ControlText>Readable control</ControlText></Button>
  <Tabs value="one" onValueChange={()=>{}}><TabsList><TabsTrigger value="one"><ControlText>One</ControlText></TabsTrigger></TabsList></Tabs>
  <EdgeFade edge="bottom" height={72}/>
 </MenuTheme></ThemeContext.Provider>);});
 try{
  expect(tree.root.findByType(TouchTarget).props.style).toEqual([menuVariables[scheme],style]);
  const control=tree.root.findAllByType(Text).find(node=>node.props.children==='Readable control')!;
  expect(control.props.style[0]).toBe(menuVariables[scheme]);
  const tabHost=tree.root.findByType(Tabs).children[0] as Renderer.ReactTestInstance;
  expect(tabHost.props.style[0]).toBe(menuVariables[scheme]);
  for(const stop of tree.root.findAllByType('Stop' as any))expect(stop.props.stopColor).toBe(tokens[scheme].colors.background);
 }finally{await act(async()=>tree.unmount());}
});

test.each(['dark','light'] as const)('app-owned popups use the resolved %s palette with readable ink and matching chat trigger',async scheme=>{
 const noop=()=>{},menuTheme=menuThemes[scheme];let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<ThemeContext.Provider value={tokens[scheme]}>
  <PlusMenu bottom={20} maxHeight={300} disabled={false} onCamera={noop} onGallery={noop} onFiles={noop} onDrawing={noop} onModel={noop} onMore={noop}/>
  <AttachmentDetails artifact={{name:'Synthetic.pdf',mime:'application/pdf',size:2048}} onClose={noop}/>
  <ChatNavigation open onOpen={noop} onClose={noop} onSelect={noop}/>
  <SessionActions session={{conversationId:7,title:'Synthetic session',status:'idle',agents:[]}} onClose={noop} onAction={async()=>{}}/>
 </ThemeContext.Provider>);});
 try{
  for(const testID of ['plus-menu-popup','attachment-details-sheet','chat-navigation-sheet','session-action-sheet'])expect(StyleSheet.flatten(tree.root.findByProps({testID}).props.style).backgroundColor).toBe(scheme==='light'?'#e8dfd0':'#1b1c1d');
  const popup=tree.root.findByProps({testID:'plus-menu-popup'});
  expect(StyleSheet.flatten(popup.findAllByType(Text)[0].props.style).color).toBe(menuTheme.colors.foreground);
  const nav=tree.root.findByType(ChatNavigation),trigger=nav.findByProps({accessibilityLabel:'Menu'});
  expect(trigger.findAll(node=>node.props.color===tokens[scheme].colors.foreground).length).toBeGreaterThan(0);
  const sheet=nav.findByProps({testID:'chat-navigation-sheet'}),scroll=sheet.findByType(ScrollView);
  const destination=scroll.findAllByType(Text).find(node=>node.props.children==='Notes')!;
  const heading=scroll.findAllByType(Text).find(node=>node.props.children==='Workspace')!;
  expect(StyleSheet.flatten(destination.props.style).color).toBe(menuTheme.colors.foreground);
  expect(StyleSheet.flatten(heading.props.style).color).toBe(menuTheme.colors.muted);
  for(const stop of sheet.findAllByType('Stop' as any))expect(stop.props.stopColor).toBe(tokens[scheme].colors.background);
 }finally{await act(async()=>tree.unmount());}
});

test('helper transcript escapes menu colors without replacing its mounted list owner',async()=>{
 const selected={parentId:7,title:'Synthetic session',agent:{conversationId:8,name:'Helper',status:'idle' as const}};
 const render=(scheme:'light'|'dark')=><ThemeContext.Provider value={tokens[scheme]}><AgentsScreen sessions={[]} onHistoryChange={()=>{}} selected={selected} onSelect={()=>{}} onOpenSession={()=>{}} onBack={()=>{}} status="Connected"><Probe id="agent-transcript"/></AgentsScreen></ThemeContext.Provider>;
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(render('dark'));});
 try{
  const host=tree.root.findByProps({testID:'agent-transcript'}),list=tree.root.findByProps({testID:'agent-session-tree'});
  expect(seen['agent-transcript'].colors).toBe(tokens.dark.colors);
  await act(async()=>tree.update(render('light')));
  expect(seen['agent-transcript'].colors).toBe(tokens.light.colors);
  expect(tree.root.findByProps({testID:'agent-transcript'})).toBe(host);expect(tree.root.findByProps({testID:'agent-session-tree'})).toBe(list);
 }finally{await act(async()=>tree.unmount());}
});

test.each(['light','dark'] as const)('%s menu text retains normal-text contrast on canvas, cards, inputs and selection',scheme=>{
 const luminance=(hex:string)=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
 const contrast=(a:string,b:string)=>{const [high,low]=[luminance(a),luminance(b)].sort((a,b)=>b-a);return(high+.05)/(low+.05);};
 const menuTheme=menuThemes[scheme],{colors}=menuTheme;
 for(const shade of Object.values(menuTheme.noteShades)){
  for(const ink of [colors.foreground,colors.body])expect(contrast(ink,shade)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(colors.muted,shade)).toBeGreaterThanOrEqual(3); // icons, not snippet/status text
 }
 for(const canvas of [colors.background,colors.panel,colors.surface,colors.selectedSurface])for(const ink of [colors.foreground,colors.body,colors.muted,colors.danger])expect(contrast(ink,canvas)).toBeGreaterThanOrEqual(4.5);
});
