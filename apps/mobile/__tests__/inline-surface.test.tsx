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

const press=(tree:Renderer.ReactTestRenderer,label:string)=>tree.root.findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0].props.onPress();
const deferred=()=>{let resolve!:(handle:string)=>void,reject!:(error:Error)=>void;const promise=new Promise<string>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};

test('local retry preserves the card and scope, admits one preparation, and recovers after repeated failures',async()=>{
 const retry=deferred();const onExpand=jest.fn();let tree!:Renderer.ReactTestRenderer;
 NativeModules.BobInteractive.prepare.mockRejectedValueOnce(Error('Offline')).mockRejectedValueOnce(Error('Still offline')).mockReturnValueOnce(retry.promise);
 try{
  await act(async()=>{tree=Renderer.create(<InlineSurface backend={backend} surface={surface} onExpand={onExpand}/>);});
  const card=tree.root.findByProps({testID:'inline-surface-container'});
  expect(JSON.stringify(tree.toJSON())).toContain('Offline');
  await act(async()=>press(tree,'Retry visual: Natural content'));
  expect(JSON.stringify(tree.toJSON())).toContain('Still offline');
  await act(async()=>{const action=tree.root.findAll(node=>node.props.accessibilityLabel==='Retry visual: Natural content'&&typeof node.props.onPress==='function')[0];action.props.onPress();action.props.onPress();});
  expect(NativeModules.BobInteractive.prepare).toHaveBeenCalledTimes(3);
  expect(tree.root.findAllByProps({accessibilityLabel:'Retry visual: Natural content'})).toHaveLength(0);
  expect(JSON.stringify(tree.toJSON())).toContain('Loading visual');
  expect(onExpand).not.toHaveBeenCalled();
  for(const args of NativeModules.BobInteractive.prepare.mock.calls)expect(args).toEqual([backend.endpoint,backend.backendId,'test-token',surface.conversationId,surface.id]);
  await act(async()=>retry.resolve('retried-session'));
  expect(tree.root.findByProps({testID:'inline-surface-container'})).toBe(card);
  expect(native(tree).props.session).toBe('retried-session');
  act(()=>emit(1200));expect(native(tree).props.style.height).toBe(420);
  act(()=>emit(650,{session:'retried-session'}));expect(native(tree).props.style.height).toBe(650);
  act(()=>press(tree,'Expand visual: Natural content'));expect(onExpand).toHaveBeenCalledTimes(1);
 }finally{if(tree)await act(async()=>tree.unmount());}
 expect(NativeModules.BobInteractive.releasePrepared).toHaveBeenCalledWith('retried-session');
});

test.each(['resolve','reject'] as const)('late retry %s cannot attach or change errors after a card scope change',async result=>{
 const pending=deferred();let tree!:Renderer.ReactTestRenderer;
 NativeModules.BobInteractive.prepare.mockRejectedValueOnce(Error('Offline')).mockReturnValueOnce(pending.promise).mockResolvedValueOnce('new-card-session');
 try{
  await act(async()=>{tree=Renderer.create(<InlineSurface backend={backend} surface={surface} onExpand={jest.fn()}/>);});
  await act(async()=>press(tree,'Retry visual: Natural content'));
  const next={...surface,id:'next-visual',conversationId:8};
  await act(async()=>tree.update(<InlineSurface backend={backend} surface={next} onExpand={jest.fn()}/>));
  await act(async()=>result==='resolve'?pending.resolve('abandoned-retry'):pending.reject(Error('Stale failure')));
  expect(native(tree).props.session).toBe('new-card-session');
  expect(JSON.stringify(tree.toJSON())).not.toContain('Stale failure');
  if(result==='resolve')expect(NativeModules.BobInteractive.releasePrepared).toHaveBeenCalledWith('abandoned-retry');
 }finally{if(tree)await act(async()=>tree.unmount());}
});

test('expanding to fullscreen while retry is pending releases the late handle and never mounts inline',async()=>{
 const pending=deferred();let tree!:Renderer.ReactTestRenderer;const onExpand=jest.fn();
 NativeModules.BobInteractive.prepare.mockRejectedValueOnce(Error('Offline')).mockReturnValueOnce(pending.promise);
 try{
  await act(async()=>{tree=Renderer.create(<InlineSurface backend={backend} surface={surface} onExpand={onExpand}/>);});
  await act(async()=>press(tree,'Retry visual: Natural content'));
  act(()=>press(tree,'Expand visual: Natural content'));expect(onExpand).toHaveBeenCalledTimes(1);
  await act(async()=>tree.update(<InlineSurface backend={backend} surface={{...surface,presentation:'fullscreen'}} onExpand={onExpand}/>));
  await act(async()=>pending.resolve('late-fullscreen'));
  expect(tree.root.findAllByProps({testID:'bob-inline-native-surface'})).toHaveLength(0);
  expect(tree.root.findAllByProps({accessibilityLabel:'Retry visual: Natural content'})).toHaveLength(0);
  expect(NativeModules.BobInteractive.releasePrepared).toHaveBeenCalledWith('late-fullscreen');
 }finally{if(tree)await act(async()=>tree.unmount());}
});

test('retry rechecks pairing and preserves native unsafe-content rejection without a fallback renderer',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValueOnce(false).mockResolvedValue({password:'refreshed-token'});
 NativeModules.BobInteractive.prepare.mockRejectedValue(Error('Unsafe visual rejected'));
 try{
  await act(async()=>{tree=Renderer.create(<InlineSurface backend={backend} surface={surface} onExpand={jest.fn()}/>);});
  expect(NativeModules.BobInteractive.prepare).not.toHaveBeenCalled();
  await act(async()=>press(tree,'Retry visual: Natural content'));
  await act(async()=>press(tree,'Retry visual: Natural content'));
  expect(Keychain.getGenericPassword).toHaveBeenCalledTimes(3);
  expect(NativeModules.BobInteractive.prepare).toHaveBeenCalledTimes(2);
  expect(NativeModules.BobInteractive.prepare).toHaveBeenLastCalledWith(backend.endpoint,backend.backendId,'refreshed-token',surface.conversationId,surface.id);
  expect(tree.root.findAllByProps({testID:'bob-inline-native-surface'})).toHaveLength(0);
  expect(JSON.stringify(tree.toJSON())).toContain('Unsafe visual rejected');
 }finally{if(tree)await act(async()=>tree.unmount());}
});

test('overflow fallback does not leak into a different card session',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 try{
  await act(async()=>{tree=Renderer.create(<InlineSurface backend={backend} surface={surface} onExpand={jest.fn()}/>);});
  await act(async()=>DeviceEventEmitter.emit('BobSurfaceOverflow',{...backend,...surface,session:'mount-one'}));
  expect(tree.root.findAllByProps({testID:'bob-inline-native-surface'})).toHaveLength(0);
  NativeModules.BobInteractive.prepare.mockResolvedValueOnce('new-card');
  await act(async()=>tree.update(<InlineSurface backend={backend} surface={{...surface,id:'next-visual',conversationId:8}} onExpand={jest.fn()}/>));
  expect(native(tree).props.session).toBe('new-card');
 }finally{if(tree)await act(async()=>tree.unmount());}
});
