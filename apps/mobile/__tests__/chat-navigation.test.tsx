jest.mock('react-native/Libraries/AppState/AppState',()=>({__esModule:true,default:{currentState:'active',addEventListener:jest.fn(()=>({remove:jest.fn()}))}}));
jest.mock('../components/bob-mascot',()=>({BobMascot:({state,animated}:any)=>require('react').createElement(require('react-native').View,{testID:'bob-mascot',state,animated})}));
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {AppState,Modal,Platform,ScrollView,StyleSheet,Text} from 'react-native';
import {ChatNavigation} from '../components/chat-navigation';
import {BobMascot} from '../components/bob-mascot';
jest.mock('lucide-react-native',()=>new Proxy({},{get:(_,name)=>name==='__esModule'?true:()=>null}));
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
 const scroll=sheet.findByType(ScrollView);
 expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
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

test('mascot tap is one-shot; open pose is visible inside sheet; finish expires without replay',async()=>{
 jest.useFakeTimers();let tree!:Renderer.ReactTestRenderer;const onOpen=jest.fn();
 const props={open:false,onOpen,onClose:jest.fn(),onSelect:jest.fn(),scope:'chat-a',activity:'working' as const};
 try{
  await act(async()=>{tree=Renderer.create(<ChatNavigation {...props}/>);});
  const trigger=()=>tree.root.findByProps({accessibilityLabel:'Menu'});
  const mascot=()=>trigger().findByType(BobMascot);
  expect(mascot().props.state).toBe('working');
  expect(StyleSheet.flatten(trigger().props.style)).toMatchObject({height:48,width:48});
  act(()=>trigger().props.onPress());expect(mascot().props.state).toBe('tap');
  await act(async()=>tree.update(<ChatNavigation {...props} open/>));
  const header=()=>tree.root.findByProps({testID:'chat-navigation-sheet'}).findByType(BobMascot);
  expect(header().props).toMatchObject({state:'tap',animated:true});expect(mascot().props.animated).toBe(false);
  act(()=>jest.advanceTimersByTime(650));expect(header().props.state).toBe('open');
  await act(async()=>tree.update(<ChatNavigation {...props} activity="idle" completionKey="chat-a:20"/>));
  expect(mascot().props.state).toBe('done');
  act(()=>jest.advanceTimersByTime(5200));expect(mascot().props.state).toBe('idle');
  await act(async()=>tree.update(<ChatNavigation {...props} activity="idle" completionKey="chat-a:20"/>));
  expect(mascot().props.state).toBe('idle');
  await act(async()=>tree.update(<ChatNavigation {...props} activity="idle" completionKey="chat-a:21"/>));
  expect(mascot().props.state).toBe('done');
  await act(async()=>tree.update(<ChatNavigation {...props} scope="chat-b" activity="attention"/>));
  expect(mascot().props.state).toBe('attention');
  await act(async()=>tree.update(<ChatNavigation {...props} scope="chat-b" activity="idle"/>));expect(mascot().props.state).toBe('idle');
 }finally{if(tree)await act(async()=>tree.unmount());jest.useRealTimers();}
});

test('background/focus loss clears transient celebrations; hidden section disables decorative motion',async()=>{
 jest.useFakeTimers();jest.replaceProperty(Platform,'OS','android');
 const listeners:Record<string,((value?:any)=>void)[]>={};jest.spyOn(AppState,'addEventListener').mockImplementation((name,callback)=>{(listeners[name]??=[]).push(callback as any);return{remove:jest.fn()};});
 let tree!:Renderer.ReactTestRenderer;const props={open:false,onOpen:jest.fn(),onClose:jest.fn(),onSelect:jest.fn(),scope:'a'};
 try{
  await act(async()=>{tree=Renderer.create(<ChatNavigation {...props} completionKey="a:1"/>);});
  const mascot=()=>tree.root.findByProps({accessibilityLabel:'Menu'}).findByType(BobMascot);
  expect(mascot().props.state).toBe('done');act(()=>listeners.blur.forEach(fn=>fn()));expect(mascot().props.state).toBe('idle');
  act(()=>listeners.focus.forEach(fn=>fn()));
  await act(async()=>tree.update(<ChatNavigation {...props} completionKey="a:2"/>));expect(mascot().props.state).toBe('done');
  act(()=>listeners.change.forEach(fn=>fn('background')));expect(mascot().props.state).toBe('idle');
  act(()=>tree.root.findByProps({accessibilityLabel:'Menu'}).props.onPress());
  await act(async()=>tree.update(<ChatNavigation {...props} open/>));
  act(()=>listeners.blur.forEach(fn=>fn()));
  // Activity blur from the native Dialog opening is not backgrounding.
  expect(tree.root.findByProps({testID:'chat-navigation-sheet'}).findByType(BobMascot).props).toMatchObject({state:'tap',insideModal:true,animated:true});
  await act(async()=>tree.update(<ChatNavigation {...props} activity="working" animated={false}/>));expect(mascot().props).toMatchObject({state:'working',animated:false});
 }finally{if(tree)await act(async()=>tree.unmount());jest.useRealTimers();jest.restoreAllMocks();}
});

test.each(['hidden','background','blurred','open'] as const)('completion arriving while already %s is consumed without replay on return',async(mode)=>{
 jest.useFakeTimers();jest.replaceProperty(Platform,'OS','android');jest.replaceProperty(AppState,'currentState','active');
 const listeners:Record<string,((value?:any)=>void)[]>={};jest.spyOn(AppState,'addEventListener').mockImplementation((name,callback)=>{(listeners[name]??=[]).push(callback as any);return{remove:jest.fn()};});
 let tree!:Renderer.ReactTestRenderer;const props={open:false,onOpen:jest.fn(),onClose:jest.fn(),onSelect:jest.fn(),scope:'a'};
 const emit=(name:string,value?:any)=>act(()=>listeners[name]?.forEach(fn=>fn(value)));
 try{
  await act(async()=>{tree=Renderer.create(<ChatNavigation {...props}/>);});
  const pose=()=>tree.root.findByProps({accessibilityLabel:'Menu'}).findByType(BobMascot).props.state;
  const hidden=mode==='hidden',open=mode==='open';
  if(mode==='background')emit('change','background');
  if(mode==='blurred')emit('blur');
  await act(async()=>tree.update(<ChatNavigation {...props} animated={!hidden} open={open}/>));
  await act(async()=>tree.update(<ChatNavigation {...props} animated={!hidden} open={open} completionKey="a:1"/>));
  expect(pose()).not.toBe('done');
  if(mode==='background')emit('change','active');
  if(mode==='blurred')emit('focus');
  await act(async()=>tree.update(<ChatNavigation {...props} completionKey="a:1"/>));
  expect(pose()).toBe('idle');
  // A genuinely new completion while visible still produces the intended finite wave.
  await act(async()=>tree.update(<ChatNavigation {...props} completionKey="a:2"/>));
  expect(pose()).toBe('done');
  act(()=>jest.advanceTimersByTime(5200));expect(pose()).toBe('idle');
 }finally{if(tree)await act(async()=>tree.unmount());jest.useRealTimers();jest.restoreAllMocks();}
});


test('hidden composer observer consumes completions without retaining a second visible menu trigger',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 const props={open:false,onOpen:jest.fn(),onClose:jest.fn(),onSelect:jest.fn()};
 await act(async()=>{tree=Renderer.create(<ChatNavigation {...props} animated={false} showTrigger={false}/>);});
 expect(tree.root.findAllByProps({accessibilityLabel:'Menu'})).toHaveLength(0);
 await act(async()=>tree.update(<ChatNavigation {...props} animated={false} showTrigger={false} completionKey="hidden-arrival"/>));
 await act(async()=>tree.update(<ChatNavigation {...props} animated showTrigger completionKey="hidden-arrival"/>));
 expect(tree.root.findByProps({accessibilityLabel:'Menu'})).toBeDefined();
 expect(tree.root.findByType(BobMascot).props.state).toBe('idle');
 await act(async()=>tree.unmount());
});
