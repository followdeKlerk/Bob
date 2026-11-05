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
 const fade=sheet.findByType(require('../components/edge-fade').EdgeFade);
 expect(fade.props).toMatchObject({edge:'bottom',height:180,color:StyleSheet.flatten(sheet.props.style).backgroundColor});
 expect(StyleSheet.flatten(footer.findByProps({testID:'section-footer'}).props.style)).toMatchObject({backgroundColor:'transparent',borderTopWidth:0});

 const destinations=['Sessions','Notes','Workstations','Agents','Settings','Chat'];
 for(const destination of destinations){
  const row=scroll.findAll(node=>node.props.accessibilityLabel===destination&&typeof node.props.onPress==='function')[0];
  expect(StyleSheet.flatten(row.props.style).minHeight).toBeGreaterThanOrEqual(48);
  expect(StyleSheet.flatten(row.props.style).height).toBeUndefined();
  expect(row.findAllByType(Text).every(text=>!text.props.numberOfLines&&text.props.allowFontScaling!==false)).toBe(true);
  act(()=>row.props.onPress());expect(onSelect).toHaveBeenLastCalledWith(destination);
 }
 expect(scroll.findAll(node=>node.props.accessibilityLabel==='Agents')[0].props.accessibilityValue).toEqual({text:'3 active agents'});
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
  expect(sheet.findAllByProps({accessibilityLabel:'Agents'})[0].findAllByType(Text).map(text=>text.props.children)).toContain(100);
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
  for(const destination of ['Sessions','Notes','Workstations','Agents','Settings','Chat']){
   const row=tree.root.findAll(node=>node.props.accessibilityLabel===destination&&typeof node.props.onPress==='function')[0];
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
