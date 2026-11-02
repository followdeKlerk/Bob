import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {DeviceEventEmitter,NativeModules} from 'react-native';
import * as Keychain from 'react-native-keychain';
import {InlineSurface} from '../components/inline-surface';
import {INITIAL_INLINE_HEIGHT,MAX_INLINE_HEIGHT,initialInlineHeight,rememberInlineHeight,forgetInlineHeight} from '../inline-visual-policy';
jest.mock('react-native-keychain',()=>({getGenericPassword:jest.fn()}));
jest.mock('lucide-react-native',()=>new Proxy({},{get:(_,name)=>name==='__esModule'?true:()=>null}));
jest.mock('../components/ui/button',()=>({Button:require('react-native').Pressable}));
const backend={backendId:'paired-backend',endpoint:'https://test.ts.net'};
const surface={id:'saved-visual',conversationId:7,title:'Natural content',kind:'visual',presentation:'inline' as const};
const emit=(height:unknown,scope:Record<string,unknown>={})=>DeviceEventEmitter.emit('BobSurfaceLayout',{...backend,...surface,session:'mount-one',height,...scope});
const native=(tree:Renderer.ReactTestRenderer)=>tree.root.findByProps({testID:'bob-inline-native-surface'});
beforeEach(()=>{
 jest.clearAllMocks();
 forgetInlineHeight({...surface,backendId:backend.backendId});
 forgetInlineHeight({id:'next-visual',conversationId:8,backendId:backend.backendId});
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({password:'test-token'});
 NativeModules.BobInteractive={prepare:jest.fn(async()=> 'mount-one'),releasePrepared:jest.fn()};
});
afterEach(()=>jest.restoreAllMocks());
test('loading starts at 420; scoped natural measurements grow/shrink through the emergency boundary without remount',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<InlineSurface backend={backend} surface={surface} onExpand={jest.fn()}/>);});
 const view=native(tree);expect(view.props.style).toEqual({height:INITIAL_INLINE_HEIGHT,width:'100%'});
 for(const height of [650,1200,180,8192,650]){
  act(()=>emit(height));expect(native(tree)).toBe(view);expect(view.props.style).toEqual({height,width:'100%'});
 }
 for(const invalid of [0,-1,8193,Infinity,NaN,650.5,'1200',null]){
  act(()=>emit(invalid));expect(view.props.style.height).toBe(650);
 }
 for(const scope of [{session:'stale-mount'},{backendId:'other-backend'},{conversationId:8},{id:'other-visual'}]){
  act(()=>emit(1200,scope));expect(view.props.style.height).toBe(650);
 }
 expect(MAX_INLINE_HEIGHT).toBe(8192);expect(NativeModules.BobInteractive.prepare).toHaveBeenCalledTimes(1);
 act(()=>DeviceEventEmitter.emit('BobSurfaceDataStatus',{...backend,...surface,session:'mount-one',message:'Live updates disconnected'}));
 expect(JSON.stringify(tree.toJSON())).toContain('Live updates disconnected');expect(native(tree)).toBe(view);
 await act(async()=>tree.unmount());expect(NativeModules.BobInteractive.releasePrepared).toHaveBeenCalledWith('mount-one');
});
test('new scope resets to loading height and rejects the old session; unmount removes every listener',async()=>{
 const add=DeviceEventEmitter.addListener.bind(DeviceEventEmitter),removers:jest.SpyInstance[]=[];
 jest.spyOn(DeviceEventEmitter,'addListener').mockImplementation((name,callback)=>{
  const listener=add(name,callback);removers.push(jest.spyOn(listener,'remove'));return listener;
 });
 let tree!:Renderer.ReactTestRenderer;const onExpand=jest.fn();
 await act(async()=>{tree=Renderer.create(<InlineSurface backend={backend} surface={surface} onExpand={onExpand}/>);});
 act(()=>emit(1200));expect(native(tree).props.style.height).toBe(1200);
 NativeModules.BobInteractive.prepare.mockResolvedValue('mount-two');
 const next={...surface,id:'next-visual',conversationId:8};
 await act(async()=>tree.update(<InlineSurface backend={backend} surface={next} onExpand={onExpand}/>));
 expect(native(tree).props.style.height).toBe(420);expect(NativeModules.BobInteractive.releasePrepared).toHaveBeenCalledWith('mount-one');
 act(()=>emit(650));expect(native(tree).props.style.height).toBe(420);
 act(()=>emit(1200,{id:next.id,conversationId:next.conversationId,session:'mount-two'}));expect(native(tree).props.style.height).toBe(1200);
 await act(async()=>tree.unmount());expect(NativeModules.BobInteractive.releasePrepared).toHaveBeenCalledWith('mount-two');
 expect(removers).toHaveLength(6);for(const remove of removers)expect(remove).toHaveBeenCalledTimes(1);
});
test('only current overflow replaces the row with full-view action and releases its prepared handle',async()=>{
 let tree!:Renderer.ReactTestRenderer;const onExpand=jest.fn();
 await act(async()=>{tree=Renderer.create(<InlineSurface backend={backend} surface={surface} onExpand={onExpand}/>);});
 const event={...backend,...surface,session:'mount-one'};
 act(()=>DeviceEventEmitter.emit('BobSurfaceOverflow',{...event,session:'stale'}));expect(native(tree)).toBeDefined();
 await act(async()=>DeviceEventEmitter.emit('BobSurfaceOverflow',event));
 expect(tree.root.findAllByProps({testID:'bob-inline-native-surface'})).toHaveLength(0);
 expect(NativeModules.BobInteractive.releasePrepared).toHaveBeenCalledWith('mount-one');
 const expand=tree.root.findAll(node=>node.props.accessibilityLabel==='Expand visual: Natural content'&&typeof node.props.onPress==='function')[0];
 act(()=>expand.props.onPress());expect(onExpand).toHaveBeenCalledTimes(1);
 await act(async()=>tree.unmount());
});
test('an unmounted asynchronous preparation is released and never attached',async()=>{
 let finish!:(value:string)=>void;NativeModules.BobInteractive.prepare.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<InlineSurface backend={backend} surface={surface} onExpand={jest.fn()}/>);});
 expect(tree.root.findAllByProps({testID:'bob-inline-native-surface'})).toHaveLength(0);
 await act(async()=>tree.unmount());await act(async()=>finish('late-mount'));
 expect(NativeModules.BobInteractive.releasePrepared).toHaveBeenCalledWith('late-mount');
});
test.each(['mcp','legacy'])('no fit contract (%s) retains the full-view action without preparing inline',async kind=>{
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<InlineSurface backend={backend} surface={{...surface,kind:kind==='mcp'?'mcp':'visual',presentation:undefined}} onExpand={jest.fn()}/>);});
 expect(NativeModules.BobInteractive.prepare).not.toHaveBeenCalled();expect(tree.root.findAllByProps({testID:'bob-inline-native-surface'})).toHaveLength(0);
 await act(async()=>tree.unmount());
});

test('virtualized remount reuses only the scoped provisional height, then still accepts fresh measurement',async()=>{
 const onExpand=jest.fn();let tree!:Renderer.ReactTestRenderer;
 const mount=async(selectedBackend=backend,selectedSurface=surface)=>{
  await act(async()=>{tree=Renderer.create(<InlineSurface backend={selectedBackend} surface={selectedSurface} onExpand={onExpand}/>);});
 };
 await mount();act(()=>emit(1200));await act(async()=>tree.unmount());
 await mount();expect(native(tree).props.style.height).toBe(1200);
 act(()=>emit(650));expect(native(tree).props.style.height).toBe(650);await act(async()=>tree.unmount());
 const other={...backend,backendId:'other-paired-backend'};
 await mount(other);expect(native(tree).props.style.height).toBe(420);await act(async()=>tree.unmount());
 await mount(backend,{...surface,conversationId:9});expect(native(tree).props.style.height).toBe(420);await act(async()=>tree.unmount());
 await mount();expect(native(tree).props.style.height).toBe(650);
 await act(async()=>DeviceEventEmitter.emit('BobSurfaceOverflow',{...backend,...surface,session:'mount-one'}));
 await act(async()=>tree.unmount());await mount();expect(native(tree).props.style.height).toBe(420);
 await act(async()=>tree.unmount());
});
test('provisional height cache is bounded, validates measurements and evicts least recently used scopes',()=>{
 const scope=(id:string)=>({backendId:'cache-policy-test',conversationId:99,id});
 const oldest=scope('oldest'),recent=scope('recent');
 rememberInlineHeight(oldest,1200);rememberInlineHeight(recent,650);
 for(let i=0;i<62;i++)rememberInlineHeight(scope(String(i)),1000+i);
 expect(initialInlineHeight(recent)).toBe(650); // refresh only this entry
 rememberInlineHeight(scope('new'),8192);
 expect(initialInlineHeight(oldest)).toBe(420);expect(initialInlineHeight(recent)).toBe(650);
 for(const invalid of [0,8193,NaN,Infinity,650.5])rememberInlineHeight(recent,invalid);
 expect(initialInlineHeight(recent)).toBe(650);forgetInlineHeight(recent);expect(initialInlineHeight(recent)).toBe(420);
 for(let i=0;i<62;i++)forgetInlineHeight(scope(String(i)));forgetInlineHeight(scope('new'));
});
