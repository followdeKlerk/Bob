jest.mock('react-native/Libraries/AppState/AppState',()=>({__esModule:true,default:{currentState:'active',addEventListener:jest.fn(()=>({remove:jest.fn()}))}}));
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {AppState,Modal,ScrollView,StyleSheet,Text} from 'react-native';
import {SectionHeading,SectionActions} from '../components/section-ui';
import {ChatNavigation} from '../components/chat-navigation';
import {Menu as NavigationMenu} from 'lucide-react-native';
jest.mock('lucide-react-native',()=>new Proxy({Menu:()=>null},{get:(icons,name)=>name==='__esModule'?true:icons[name as keyof typeof icons]??(()=>null)}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View,useSafeAreaInsets:()=>({top:24,bottom:20,left:0,right:0})}));

test.each([0,1,4,100,-1,NaN])('icon-only menu announces active agents and remains enabled (%s)',async(count)=>{
 const onOpen=jest.fn(),expected=Number.isSafeInteger(count)&&count>0?count:0;
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<ChatNavigation open={false} onOpen={onOpen} onClose={jest.fn()} onSelect={jest.fn()} activeAgentCount={count}/>);});
 const trigger=tree.root.findByProps({accessibilityLabel:'Menu'});
 expect(trigger.props.accessibilityState).toEqual({expanded:false});
 expect(trigger.props.accessibilityValue).toEqual({text:`${expected} active ${expected===1?'agent':'agents'}`});
 expect(trigger.props.disabled).not.toBe(true);
 expect(StyleSheet.flatten(trigger.props.style)).toMatchObject({minWidth:48,minHeight:48});
 expect(trigger.findAllByType(Text).map(text=>text.props.children)).not.toContain('Menu');
 expect(trigger.findAllByProps({testID:'chat-menu-agent-badge'}).length>0).toBe(expected>0);
 act(()=>trigger.props.onPress());expect(onOpen).toHaveBeenCalledTimes(1);
 await act(async()=>tree.unmount());
});

test('native modal supports Back, backdrop, close and accessibility escape; all scalable destinations scroll',async()=>{
 const onClose=jest.fn(),onSelect=jest.fn();let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<ChatNavigation open onOpen={jest.fn()} onClose={onClose} onSelect={onSelect} activeAgentCount={3}/>);});
 const modal=tree.root.findByType(Modal),sheet=tree.root.findByProps({testID:'chat-navigation-sheet'});
 expect(modal.props.visible).toBe(true);expect(modal.props.transparent).toBe(true);
 expect(sheet.props.accessibilityViewIsModal).toBe(true);
 expect(StyleSheet.flatten(sheet.props.style).maxHeight).toBe('85%');
 expect(StyleSheet.flatten(sheet.props.style).height).toBeUndefined();
 const scroll=sheet.findByType(ScrollView);
 expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
 expect(StyleSheet.flatten(scroll.props.style)).toMatchObject({flexGrow:0,flexShrink:1,minHeight:0});
 const heading=sheet.findByType(SectionHeading),footer=sheet.findByType(SectionActions);
 expect(heading.props).toEqual({title:'Menu'});
 expect(scroll.findAllByType(SectionHeading)).toHaveLength(0);
 expect(scroll.findAllByType(SectionActions)).toHaveLength(0);
 expect(footer.findByProps({testID:'section-footer-leading'}).findAllByProps({accessibilityLabel:'Close navigation menu'}).length).toBeGreaterThan(0);
 expect(footer.parent!.props.testID).toBe('section-footer-overlay');
 expect(StyleSheet.flatten(footer.parent!.props.style)).toMatchObject({position:'absolute',bottom:0});
 expect(scroll.parent!.props.testID).toBe('section-scroll-host');
 const overlay=sheet.findByProps({testID:'section-footer-overlay'});
 act(()=>overlay.props.onLayout({nativeEvent:{layout:{height:168}}}));
 expect(StyleSheet.flatten(scroll.props.contentContainerStyle).paddingBottom).toBe(192);
 expect(sheet.findByType(ScrollView)===scroll).toBe(true);
 const fade=sheet.findAllByType(require('../components/edge-fade').EdgeFade).find(node=>node.props.edge==='bottom')!;
 expect(fade.props).toMatchObject({edge:'bottom',height:180,color:StyleSheet.flatten(sheet.props.style).backgroundColor});
 expect(StyleSheet.flatten(footer.findByProps({testID:'section-footer'}).props.style)).toMatchObject({backgroundColor:'transparent',borderTopWidth:0});

 expect(scroll.findAllByProps({accessibilityLabel:'Sessions'})).toHaveLength(0);
 expect(scroll.findAllByProps({accessibilityLabel:'Agents'})).toHaveLength(0);
 const destinations=['Notes','Workstations','Agents','Terminal','Settings','Chat'];
 for(const destination of destinations){
  const row=scroll.findAll(node=>node.props.accessibilityLabel===(destination==='Agents'?'Agents and Sessions':destination)&&typeof node.props.onPress==='function')[0];
  expect(StyleSheet.flatten(row.props.style).minHeight).toBeGreaterThanOrEqual(48);
  expect(StyleSheet.flatten(row.props.style).height).toBeUndefined();
  expect(row.findAllByType(Text).every(text=>!text.props.numberOfLines&&text.props.allowFontScaling!==false)).toBe(true);
  act(()=>row.props.onPress());expect(onSelect).toHaveBeenLastCalledWith(destination);
 }
 expect(scroll.findAll(node=>node.props.accessibilityLabel==='Agents and Sessions')[0].props.accessibilityValue).toEqual({text:'3 active agents'});
 act(()=>modal.props.onRequestClose());
 act(()=>tree.root.findByProps({accessibilityLabel:'Dismiss navigation menu'}).props.onPress());
 act(()=>tree.root.findByProps({accessibilityLabel:'Close navigation menu'}).props.onPress());
 act(()=>sheet.props.onAccessibilityEscape());
 expect(onClose).toHaveBeenCalledTimes(4);
 await act(async()=>tree.unmount());
});

test('menu uses one static icon in the existing trigger with no decorative modal header copy',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 const onOpen=jest.fn(),props={open:false,onOpen,onClose:jest.fn(),onSelect:jest.fn(),activeAgentCount:100};
 try{
  await act(async()=>{tree=Renderer.create(<ChatNavigation {...props}/>);});
  const trigger=tree.root.findByProps({accessibilityLabel:'Menu'});
  expect(StyleSheet.flatten(trigger.props.style)).toMatchObject({height:48,width:48,minHeight:48,minWidth:48});
  const icon=trigger.findByType(NavigationMenu);
  expect(icon.props).toMatchObject({size:24,color:expect.any(String)});
  expect(icon.parent?.props).toMatchObject({accessible:false,accessibilityElementsHidden:true,importantForAccessibility:'no-hide-descendants'});
  expect(trigger.findByProps({testID:'chat-menu-agent-badge'}).findByType(Text).props.children).toBe('99+');
  act(()=>trigger.props.onPress());expect(onOpen).toHaveBeenCalledTimes(1);
  await act(async()=>tree.update(<ChatNavigation {...props} open/>));
  expect(tree.root.findByProps({accessibilityLabel:'Menu'}).props.accessibilityState).toEqual({expanded:true});
  expect(tree.root.findAllByType(NavigationMenu)).toHaveLength(1);
  expect(tree.root.findByType(NavigationMenu).props).toEqual(icon.props);
  const sheet=tree.root.findByProps({testID:'chat-navigation-sheet'});
  expect(sheet.findAllByProps({testID:'section-heading-menu'})).toHaveLength(0);
  expect(sheet.findAllByType(Text).filter(text=>text.props.children==='Menu')).toHaveLength(1);
  expect(sheet.findAllByProps({accessibilityLabel:'Agents and Sessions'})[0].findAllByType(Text).map(text=>text.props.children)).toContain(100);
 }finally{if(tree)await act(async()=>tree.unmount());}
});

test('static navigation schedules no timers and subscribes to no AppState events',async()=>{
 jest.useFakeTimers();
 const appState=jest.spyOn(AppState,'addEventListener');appState.mockClear();
 const timeout=jest.spyOn(globalThis,'setTimeout'),interval=jest.spyOn(globalThis,'setInterval');
 let tree!:Renderer.ReactTestRenderer;
 const props={open:false,onOpen:jest.fn(),onClose:jest.fn(),onSelect:jest.fn()};
 try{
  await act(async()=>{tree=Renderer.create(<ChatNavigation {...props}/>);});
  act(()=>tree.root.findByProps({accessibilityLabel:'Menu'}).props.onPress());
  await act(async()=>tree.update(<ChatNavigation {...props} open activeAgentCount={2}/>));
  await act(async()=>tree.update(<ChatNavigation {...props} showTrigger={false}/>));
  await act(async()=>tree.update(<ChatNavigation {...props}/>));
  await act(async()=>tree.unmount());
  expect(timeout).not.toHaveBeenCalled();
  expect(interval).not.toHaveBeenCalled();
  expect(appState).not.toHaveBeenCalled();
 }finally{jest.restoreAllMocks();jest.useRealTimers();}
});

test('hidden trigger leaves the modal and all navigation destinations available',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 const onOpen=jest.fn(),onClose=jest.fn(),onSelect=jest.fn();
 const props={open:false,onOpen,onClose,onSelect,activeAgentCount:1,showTrigger:false};
 try{
  await act(async()=>{tree=Renderer.create(<ChatNavigation {...props}/>);});
  expect(tree.root.findAllByProps({accessibilityLabel:'Menu'})).toHaveLength(0);
  expect(tree.root.findAllByType(NavigationMenu)).toHaveLength(0);
  expect(tree.root.findByType(Modal).props.visible).toBe(false);
  await act(async()=>tree.update(<ChatNavigation {...props} open/>));
  expect(tree.root.findAllByProps({accessibilityLabel:'Menu'})).toHaveLength(0);
  expect(tree.root.findAllByProps({testID:'chat-menu-agent-badge'})).toHaveLength(0);
  const modal=tree.root.findByType(Modal);
  expect(modal.props.visible).toBe(true);
  for(const destination of ['Notes','Workstations','Agents','Terminal','Settings','Chat']){
   const row=tree.root.findAll(node=>node.props.accessibilityLabel===(destination==='Agents'?'Agents and Sessions':destination)&&typeof node.props.onPress==='function')[0];
   act(()=>row.props.onPress());expect(onSelect).toHaveBeenLastCalledWith(destination);
  }
  expect(onSelect).toHaveBeenCalledTimes(6);
  act(()=>modal.props.onRequestClose());expect(onClose).toHaveBeenCalledTimes(1);
  expect(onOpen).not.toHaveBeenCalled();
  await act(async()=>tree.update(<ChatNavigation {...props} showTrigger/>));
  const trigger=tree.root.findByProps({accessibilityLabel:'Menu'});
  expect(trigger.props.accessibilityValue).toEqual({text:'1 active agent'});
  expect(trigger.findAllByType(NavigationMenu)).toHaveLength(1);
  act(()=>trigger.props.onPress());expect(onOpen).toHaveBeenCalledTimes(1);
 }finally{if(tree)await act(async()=>tree.unmount());}
});

test('read-only chat can still reach the combined session navigator without an activity badge',async()=>{
 let tree!:Renderer.ReactTestRenderer;const onSelect=jest.fn();
 await act(async()=>{tree=Renderer.create(<ChatNavigation open readOnly activeAgentCount={4} onOpen={jest.fn()} onClose={jest.fn()} onSelect={onSelect}/>);});
 const row=tree.root.findByProps({accessibilityLabel:'Agents and Sessions'});
 expect(row.props.accessibilityValue).toEqual({text:'0 active agents'});
 act(()=>row.props.onPress());expect(onSelect).toHaveBeenCalledWith('Agents');
 expect(tree.root.findAllByProps({accessibilityLabel:'Sessions'})).toHaveLength(0);
 await act(async()=>tree.unmount());
});

test('menu puts the current chat first and separates workspace and app destinations with only the selected row outlined',async()=>{
 const {Text:AppText}=require('../components/app-text');
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<ChatNavigation open onOpen={()=>{}} onClose={()=>{}} onSelect={()=>{}}/>);});
 const scroll=tree.root.findByType(ScrollView);
 const rows=scroll.findAll(node=>typeof node.props.onPress==='function'&&node.props.accessibilityRole==='button');
 expect([...new Set(rows.map(node=>node.props.accessibilityLabel))]).toEqual(['Chat','Agents and Sessions','Terminal','Notes','Workstations','Settings']);
 const headers=scroll.findAllByType(Text).filter(node=>node.props.accessibilityRole==='header').map(node=>node.props.children);
 expect(headers).toEqual(['Workspace','App']);
 expect(rows[0].props.accessibilityState.selected).toBe(true);
 for(const row of rows){const style=StyleSheet.flatten(row.props.style);expect(style.borderWidth).toBe(1);expect(style.borderColor==='transparent').toBe(!row.props.accessibilityState.selected);}
 expect(tree.root.findAllByType(AppText).every(node=>node.props.typography==='ui')).toBe(true);
 await act(async()=>tree.unmount());
});


test.each(['Notes','Workstations','Agents','Terminal','Settings'] as const)('menu opened from %s marks only that destination selected',async selected=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<ChatNavigation selected={selected} open onOpen={()=>{}} onClose={()=>{}} onSelect={()=>{}}/>);});
 try{
  const rows=tree.root.findByType(ScrollView).findAll(node=>node.props.accessibilityRole==='button'&&typeof node.props.onPress==='function');
  expect([...new Set(rows.filter(node=>node.props.accessibilityState?.selected).map(node=>node.props.accessibilityLabel))]).toEqual([selected==='Agents'?'Agents and Sessions':selected]);
 }finally{await act(async()=>tree.unmount());}
});

test.each(['light','dark'] as const)('%s selected menu row uses a thin outline without a filled highlight or remount',async scheme=>{
 const {ThemeContext,tokens}=require('../theme-context');let tree!:Renderer.ReactTestRenderer;
 const onSelect=jest.fn();const render=(selected:'Chat'|'Notes')=><ThemeContext.Provider value={tokens[scheme]}><ChatNavigation open selected={selected} onOpen={jest.fn()} onClose={jest.fn()} onSelect={onSelect}/></ThemeContext.Provider>;
 await act(async()=>{tree=Renderer.create(render('Chat'));});
 const chat=tree.root.findByProps({accessibilityLabel:'Chat'}),notes=tree.root.findByProps({accessibilityLabel:'Notes'});
 expect(StyleSheet.flatten(chat.props.style)).toMatchObject({borderWidth:1,borderColor:tokens[scheme].colors.border,borderRadius:14});
 expect(StyleSheet.flatten(chat.props.style).backgroundColor).toBeUndefined();
 expect(StyleSheet.flatten(notes.props.style)).toMatchObject({borderWidth:1,borderColor:'transparent'});
 act(()=>notes.props.onPress());expect(onSelect).toHaveBeenCalledWith('Notes');
 await act(async()=>tree.update(render('Notes')));
 expect(tree.root.findByProps({accessibilityLabel:'Chat'})).toBe(chat);expect(tree.root.findByProps({accessibilityLabel:'Notes'})).toBe(notes);
 expect(chat.props.accessibilityState.selected).toBe(false);expect(notes.props.accessibilityState.selected).toBe(true);
 expect(StyleSheet.flatten(chat.props.style).borderColor).toBe('transparent');
 expect(StyleSheet.flatten(notes.props.style).borderColor).toBe(tokens[scheme].colors.border);
 expect(StyleSheet.flatten(notes.props.style).backgroundColor).toBeUndefined();
 await act(async()=>tree.unmount());
});
