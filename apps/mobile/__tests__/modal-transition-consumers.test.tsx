jest.mock('react-native-reanimated',()=>({__esModule:true,default:{View:require('react-native').View},LinearTransition:{duration:(duration:number)=>({reduceMotion:(reduceMotion:string)=>({duration,reduceMotion})})},ReduceMotion:{System:'system'}}));
import React,{useState} from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Animated,BackHandler,DeviceEventEmitter,Keyboard,KeyboardAvoidingView,Modal,Platform,Pressable,StyleSheet,TextInput} from 'react-native';
import {ChatNavigation} from '../components/chat-navigation';
import {AgentsScreen} from '../components/agents-screen';
import {DraftInput} from '../components/draft-input';
import {ModelPicker} from '../components/model-picker';
import {OverlayHost,useOverlayScope} from '../components/overlay-host';
import {WorkstationAliasEditor} from '../components/workstation-alias-editor';
import {useAppMotion} from '../app-motion';
jest.mock('../app-motion',()=>({...jest.requireActual('../app-motion'),useAppMotion:jest.fn(()=>true)}));
jest.mock('lucide-react-native',()=>new Proxy({},{get:(_,name)=>name==='__esModule'?true:()=>null}));
jest.mock('@react-native-async-storage/async-storage',()=>({getItem:jest.fn(async()=>null),setItem:jest.fn(async()=>{})}));
jest.mock('../components/ui/button',()=>({Button:require('react-native').Pressable}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View,useSafeAreaInsets:()=>({top:0,bottom:0,left:0,right:0})}));

type Run={toValue:number;callback?:(result:{finished:boolean})=>void;stop:jest.Mock};
let runs:Run[],spy:jest.SpyInstance;
beforeEach(()=>{runs=[];jest.mocked(useAppMotion).mockReturnValue(true);spy=jest.spyOn(Animated,'timing').mockImplementation(((_value:any,config:any)=>{const run:Run={toValue:config.toValue,stop:jest.fn()};runs.push(run);return{start:(callback:any)=>{run.callback=callback;},stop:run.stop,reset:jest.fn()};}) as any);});
afterEach(()=>spy.mockRestore());
const press=(tree:Renderer.ReactTestRenderer,label:string)=>tree.root.findAll(n=>n.props.accessibilityLabel===label&&typeof n.props.onPress==='function')[0];
const exit=()=>runs.filter(run=>run.toValue===0).at(-1)!;

test('navigation retains a non-owning same-window exit and reverses without delaying selection',async()=>{
 let tree!:Renderer.ReactTestRenderer;const select=jest.fn(),close=jest.fn();
 const render=(open:boolean)=><OverlayHost><ChatNavigation open={open} onOpen={jest.fn()} onClose={close} onSelect={select}/></OverlayHost>;
 await act(async()=>{tree=Renderer.create(render(true));});
 expect(tree.root.findAllByType(Modal)).toHaveLength(0);
 act(()=>press(tree,'Tasks').props.onPress());expect(select).toHaveBeenCalledWith('Todos');
 await act(async()=>tree.update(render(false)));
 const oldExit=exit();expect(oldExit).toBeDefined();expect(tree.root.findByProps({testID:'overlay-exiting'}).props.pointerEvents).toBe('none');
 await act(async()=>tree.update(render(true)));expect(oldExit.stop).toHaveBeenCalled();
 act(()=>oldExit.callback?.({finished:true}));expect(tree.root.findByProps({testID:'overlay-active'})).toBeDefined();
 await act(async()=>tree.update(render(false)));const last=exit();act(()=>last.callback?.({finished:true}));
 expect(tree.root.findAllByProps({testID:'overlay-exiting'})).toHaveLength(0);
 await act(async()=>tree.unmount());
});

test('real navigation hands ownership to model picker then immediately back to the underlying editor',async()=>{
 const delivered=jest.fn(),dismiss=jest.spyOn(Keyboard,'dismiss').mockImplementation(()=>{}),callbacks:(()=>boolean)[]=[];
 const back=jest.spyOn(BackHandler,'addEventListener').mockImplementation((_name,fn)=>{callbacks.push(fn as ()=>boolean);return{remove:()=>{const index=callbacks.indexOf(fn as ()=>boolean);if(index>=0)callbacks.splice(index,1);}};});
 const models=[{provider:'p',modelId:'m',name:'Model',thinkingLevels:['medium']}];
 function Harness(){const [nav,setNav]=useState(true),[model,setModel]=useState(false),[draft,setDraft]=useState('exact');return <OverlayHost><TextInput testID="underlying-editor" value={draft} onChangeText={setDraft}/><ChatNavigation open={nav} onOpen={()=>setNav(true)} onClose={()=>setNav(false)} onSelect={choice=>{delivered(choice);setNav(false);setModel(true);}}/><ModelPicker visible={model} models={models} current={{model:{provider:'p',modelId:'m'},thinkingLevel:'medium'}} onClose={()=>setModel(false)} onApply={async()=>setModel(false)}/></OverlayHost>;}
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<Harness/>);});
 const editor=tree.root.findByProps({testID:'underlying-editor'});
 act(()=>press(tree,'Tasks').props.onPress());expect(delivered).toHaveBeenCalledWith('Todos');
 const oldExit=exit();expect(tree.root.findAllByType(Modal)).toHaveLength(0);
 const owner=tree.root.findByProps({testID:'overlay-active'});expect(owner.findAllByProps({accessibilityLabel:'Search models'}).length).toBeGreaterThan(0);
 if(Platform.OS==='android'){act(()=>DeviceEventEmitter.emit('BobKeyboardInset',{imeBottom:240}));expect(StyleSheet.flatten(owner.findByType(KeyboardAvoidingView).props.style).paddingBottom).toBe(240);}
 expect(tree.root.findByProps({testID:'overlay-exiting'}).props.pointerEvents).toBe('none');
 act(()=>oldExit.callback?.({finished:true}));expect(tree.root.findByProps({testID:'overlay-active'})).toBeDefined();
 act(()=>expect(callbacks.at(-1)!()).toBe(true));expect(dismiss).toHaveBeenCalled();
 expect(tree.root.findAllByProps({testID:'overlay-active'})).toHaveLength(0);
 expect(tree.root.findByProps({testID:'underlying-editor'})).toBe(editor);
 act(()=>editor.props.onChangeText('exact updated'));expect(editor.props.value).toBe('exact updated');
 jest.mocked(useAppMotion).mockReturnValue(false);await act(async()=>tree.update(<Harness/>));expect(tree.root.findAllByProps({testID:'overlay-exiting'})).toHaveLength(0);
 await act(async()=>tree.unmount());back.mockRestore();dismiss.mockRestore();
});

test('expanded draft retains an inert exit, preserves text and closes immediately on scope change',async()=>{
 let tree!:Renderer.ReactTestRenderer;const change=jest.fn();
 const render=(scope:string)=><OverlayHost><DraftInput scope={scope} value={'line one\nline two'} onChangeText={change}/></OverlayHost>;
 await act(async()=>{tree=Renderer.create(render('a'));});
 act(()=>press(tree,'Expand message editor').props.onPress());
 expect(tree.root.findAllByType(Modal)).toHaveLength(0);
 expect(tree.root.findByProps({accessibilityLabel:'Expanded message draft'}).props.value).toBe('line one\nline two');
 act(()=>press(tree,'Collapse message editor').props.onPress());
 const closing=exit();expect(closing).toBeDefined();expect(tree.root.findByProps({testID:'overlay-exiting'}).props.pointerEvents).toBe('none');
 expect(tree.root.findByProps({accessibilityLabel:'Expanded message draft'}).props.editable).toBe(false);
 act(()=>press(tree,'Expand message editor').props.onPress());expect(closing.stop).toHaveBeenCalled();
 act(()=>closing.callback?.({finished:true}));expect(tree.root.findAll(node=>(node.type as unknown)==='View'&&node.props.testID==='overlay-active')).toHaveLength(1);
 await act(async()=>tree.update(render('b')));expect(tree.root.findAllByProps({testID:'overlay-active'})).toHaveLength(0);expect(tree.root.findAllByProps({testID:'overlay-exiting'})).toHaveLength(0);
 expect(change).not.toHaveBeenCalled();await act(async()=>tree.unmount());
});

test('conditional alias retires its business owner immediately and reopens without a stale exit winning',async()=>{
 const closed=jest.fn(),save=jest.fn(async()=>{});
 function Harness(){const [show,setShow]=useState(true);return <OverlayHost><Pressable accessibilityLabel="Reopen alias" onPress={()=>setShow(true)}/>{show&&<WorkstationAliasEditor workstation={{backendId:'test-backend',name:'Test'}} onSave={save} onClose={()=>{closed();setShow(false);}}/>}</OverlayHost>;}
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<Harness/>);});
 act(()=>tree.root.findByProps({accessibilityLabel:'Workstation alias'}).props.onChangeText('Changed'));
 act(()=>press(tree,'Cancel workstation alias').props.onPress());expect(closed).toHaveBeenCalledTimes(1);
 expect(tree.root.findAllByType(WorkstationAliasEditor)).toHaveLength(0);expect(save).not.toHaveBeenCalled();
 const oldExit=exit();expect(oldExit).toBeDefined();expect(tree.root.findAllByProps({testID:'overlay-active'})).toHaveLength(0);
 act(()=>press(tree,'Reopen alias').props.onPress());
 act(()=>oldExit.callback?.({finished:true}));expect(tree.root.findAllByProps({testID:'overlay-active'}).length).toBeGreaterThan(0);
 expect(tree.root.findByProps({accessibilityLabel:'Workstation alias'}).props.value).toBe('');
 await act(async()=>tree.unmount());
});

test('conditional session filter retains its exit and delivers selection immediately; gate disable settles it',async()=>{
 const change=jest.fn();let tree!:Renderer.ReactTestRenderer;
 const render=()=><OverlayHost><AgentsScreen sessions={[]} onSelect={jest.fn()} onOpenSession={jest.fn()} onBack={jest.fn()} onHistoryChange={jest.fn()} status="Connected" onFilterChange={change}>{null}</AgentsScreen></OverlayHost>;
 await act(async()=>{tree=Renderer.create(render());});
 act(()=>press(tree,'Session filter: Active').props.onPress());
 expect(tree.root.findAllByType(Modal)).toHaveLength(0);
 act(()=>press(tree,'Trash').props.onPress());expect(change).toHaveBeenCalledWith('trash');
 const closing=exit();expect(closing).toBeDefined();expect(tree.root.findAllByProps({testID:'overlay-exiting'}).length).toBeGreaterThan(0);
 expect(tree.root.findByProps({testID:'session-filter-picker'}).parent!.props.pointerEvents).toBe('none');
 jest.mocked(useAppMotion).mockReturnValue(false);
 await act(async()=>tree.update(render()));expect(tree.root.findAllByProps({testID:'overlay-exiting'})).toHaveLength(0);
 act(()=>closing.callback?.({finished:true}));expect(tree.root.findAllByProps({testID:'overlay-exiting'})).toHaveLength(0);
 await act(async()=>tree.unmount());
});

test('retiring a retained chat immediately removes its expanded editor and does not reopen it',async()=>{
 const render=(active:boolean)=><OverlayHost><DraftInput active={active} scope="a" value={'one\ntwo'} onChangeText={jest.fn()}/></OverlayHost>;
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(render(true));});
 act(()=>press(tree,'Expand message editor').props.onPress());
 expect(tree.root.findAllByProps({testID:'overlay-active'}).length).toBeGreaterThan(0);
 await act(async()=>tree.update(render(false)));
 expect(tree.root.findAllByProps({testID:'overlay-active'})).toHaveLength(0);
 expect(tree.root.findAllByProps({testID:'overlay-exiting'})).toHaveLength(0);
 await act(async()=>tree.update(render(true)));
 expect(tree.root.findAllByProps({testID:'overlay-active'})).toHaveLength(0);
 expect(tree.root.findByProps({accessibilityLabel:'Message draft'}).props.value).toBe('one\ntwo');
 await act(async()=>tree.unmount());
});

test('a session scope change removes an already-retired conditional exit immediately',async()=>{
 function Contents({scope}:{scope:string}){const [show,setShow]=useState(true);useOverlayScope(scope);return <>{show&&<WorkstationAliasEditor workstation={{backendId:'a',name:'Private workspace'}} onSave={async()=>{}} onClose={()=>setShow(false)}/>}</>;}
 const render=(scope:string)=><OverlayHost><Contents scope={scope}/></OverlayHost>;
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(render('a'));});
 act(()=>press(tree,'Cancel workstation alias').props.onPress());const closing=exit();
 expect(tree.root.findAllByProps({testID:'overlay-exiting'}).length).toBeGreaterThan(0);
 await act(async()=>tree.update(render('b')));
 expect(tree.root.findAllByProps({testID:'overlay-exiting'})).toHaveLength(0);
 act(()=>closing.callback?.({finished:true}));expect(tree.root.findAllByProps({testID:'overlay-active'})).toHaveLength(0);
 await act(async()=>tree.unmount());
});

test('hosted model picker consumes only unresized IME overlap and disables its own avoidance',async()=>{
 const {Dimensions}=require('react-native'),original=Dimensions.get.bind(Dimensions),oldOS=Object.getOwnPropertyDescriptor(Platform,'OS')!;
 Object.defineProperty(Platform,'OS',{configurable:true,value:'android'});
 const dimensions=jest.spyOn(Dimensions,'get').mockImplementation((name:any)=>name==='screen'?{width:400,height:800,scale:1,fontScale:1}:original(name));
 let bottom=800,tree!:Renderer.ReactTestRenderer;const measured=jest.fn((cb:any)=>cb(0,0,400,bottom));
 const render=()=><OverlayHost><ModelPicker visible models={[]} current={{model:undefined,thinkingLevel:'medium'}} onClose={jest.fn()} onApply={async()=>{}}/></OverlayHost>;
 try{
  await act(async()=>{tree=Renderer.create(render());});
  tree.root.findAllByProps({testID:'overlay-host-viewport'}).forEach((node:any)=>{if(node.instance)node.instance.measureInWindow=measured;});
  await act(async()=>tree.root.findByProps({testID:'overlay-host-viewport'}).props.onLayout({nativeEvent:{layout:{height:800}}}));
  act(()=>DeviceEventEmitter.emit('BobKeyboardInset',{imeBottom:300}));
  const avoidance=()=>tree.root.findByProps({testID:'overlay-active'}).findByType(KeyboardAvoidingView);
  expect(avoidance().props.enabled).toBe(false);expect(StyleSheet.flatten(avoidance().props.style).paddingBottom).toBe(300);
  bottom=500;await act(async()=>tree.root.findByProps({testID:'overlay-host-viewport'}).props.onLayout({nativeEvent:{layout:{height:500}}}));
  expect(StyleSheet.flatten(avoidance().props.style).paddingBottom).toBe(0);
  expect(tree.root.findByProps({testID:'overlay-active'}).findAllByProps({accessibilityLabel:'Search models'}).length).toBeGreaterThan(0);
 }finally{if(tree)await act(async()=>tree.unmount());dimensions.mockRestore();Object.defineProperty(Platform,'OS',oldOS);}
});

test('keyboard-open model search budgets a complete result row without losing the effort and footer controls',async()=>{
 const oldOS=Object.getOwnPropertyDescriptor(Platform,'OS')!;Object.defineProperty(Platform,'OS',{configurable:true,value:'android'});
 const catalog=[{provider:'openai',modelId:'gpt-6.1',name:'GPT-6.1 Sol',thinkingLevels:['off','medium','high']}];
 const apply=jest.fn(async()=>{}),close=jest.fn();let tree!:Renderer.ReactTestRenderer;
 try{
  await act(async()=>{tree=Renderer.create(<OverlayHost><ModelPicker visible models={catalog} current={{model:{provider:'openai',modelId:'gpt-6.1'},thinkingLevel:'medium'}} onClose={close} onApply={apply}/></OverlayHost>);});
  const owner=()=>tree.root.findByProps({testID:'overlay-active'});
  const search=owner().findAll(node=>node.props.accessibilityLabel==='Search models'&&typeof node.props.onChangeText==='function')[0];
  act(()=>DeviceEventEmitter.emit('BobKeyboardInset',{imeBottom:300}));
  await act(async()=>search.props.onChangeText('gpt-6.1'));
  const layout=owner().findByProps({testID:'model-body-layout'});
  // A real SectionBody receives 260 dp after the persistent search and keyboard.
  // Simulate native layout to exercise the production allocation, not an inset-only helper.
  act(()=>layout.props.onLayout({nativeEvent:{layout:{height:260}}}));
  const list=owner().findByType(require('react-native').FlatList),panel=owner().findByProps({testID:'selected-model-panel'});
  const cap=StyleSheet.flatten(panel.props.style).maxHeight;
  expect(cap).toBe(164);expect(260-cap).toBeGreaterThanOrEqual(96);
  expect(StyleSheet.flatten(list.props.style)).toMatchObject({flex:1,minHeight:0});
  const model=owner().findAll(n=>n.props.accessibilityLabel==='Select GPT-6.1 Sol (openai)'&&typeof n.props.onPress==='function')[0];
  expect(StyleSheet.flatten(model.props.style).minHeight).toBe(72);
  expect(owner().findAll(n=>n.props.children==='All models')).toHaveLength(0);
  expect(owner().findAll(n=>n.props.title==='Model & thinking')).toHaveLength(0);
  expect(owner().findAll(n=>n.props.accessibilityLabel==='Medium thinking').length).toBeGreaterThan(0);
  expect(owner().findAll(n=>n.props.accessibilityLabel==='Close model selection').length).toBeGreaterThan(0);
  expect(owner().findAll(n=>n.props.accessibilityLabel==='Apply model selection').length).toBeGreaterThan(0);
  expect(owner().findAll(n=>n.props.accessibilityLabel==='Search models'&&typeof n.props.onChangeText==='function')[0]).toBe(search);
  act(()=>model.props.onPress());expect(apply).not.toHaveBeenCalled();
  act(()=>DeviceEventEmitter.emit('BobKeyboardInset',{imeBottom:0}));
  expect(owner().findAll(n=>n.props.title==='Model & thinking').length).toBeGreaterThan(0);
  expect(StyleSheet.flatten(owner().findByProps({testID:'selected-model-panel'}).props.style).maxHeight).toBe('70%');
 }finally{if(tree)await act(async()=>tree.unmount());Object.defineProperty(Platform,'OS',oldOS);}
});
