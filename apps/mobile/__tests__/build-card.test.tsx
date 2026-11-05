import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {NativeModules,Pressable,Text} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {BuildCard} from '../components/build-card';
import type {BuildState} from '../use-build-status';
jest.mock('@react-native-async-storage/async-storage',()=>{const values=new Map();return{getItem:jest.fn(async(key:string)=>values.get(key)??null),setItem:jest.fn(async(key:string,value:string)=>{values.set(key,value);}),removeItem:jest.fn(async(key:string)=>{values.delete(key);}),clear:jest.fn(async()=>values.clear())};});
jest.mock('uuid',()=>({v4:()=> 'stable-build-id'}));
jest.mock('react-native-keychain',()=>({getGenericPassword:jest.fn(async()=>({password:'secret'}))}));
jest.mock('lucide-react-native',()=>new Proxy({},{get:(_,name)=>name==='__esModule'?true:()=>null}));
const backend={backendId:'backend-id',endpoint:'https://backend.ts.net',name:'Desktop'},refresh=jest.fn(),dismiss=jest.fn();
const apk={releaseId:'release-id',sha256:'a'.repeat(64),size:1000,versionCode:2,versionName:'2.0'};
const ready:BuildState={enabled:true,jobs:[],apk};
let tree:Renderer.ReactTestRenderer|undefined;
async function mount(state:BuildState|undefined=ready,focus=false){await act(async()=>{tree=Renderer.create(<BuildCard backend={backend} state={state} focus={focus} onRefresh={refresh} onDismiss={dismiss}/>);});return tree!;}
const button=(name:string)=>tree!.root.findByProps({accessibilityLabel:name});
const text=()=>JSON.stringify(tree!.toJSON());
beforeEach(async()=>{await AsyncStorage.clear();NativeModules.BobFiles={versionCode:1,versionName:'1.0',installUpdate:jest.fn(async()=>({opened:true}))};refresh.mockClear();dismiss.mockClear();});
afterEach(async()=>{if(tree)await act(async()=>tree!.unmount());tree=undefined;jest.restoreAllMocks();});
test('verified ready APK installs only after an explicit owner tap',async()=>{
 await mount();expect(text()).toContain('2.0 ready');expect(NativeModules.BobFiles.installUpdate).not.toHaveBeenCalled();
 await act(async()=>button('Install 2.0').props.onPress());
 expect(NativeModules.BobFiles.installUpdate).toHaveBeenCalledWith(backend.endpoint+'/v1/updates/release-id/apk','secret',backend.backendId,apk.sha256,apk.size);
 expect(await AsyncStorage.getItem('pending-install:backend-id')).toBe('2');expect(text()).toContain('Approve installation in Android');
});
test('actual stage is shown without fabricated percentages and collapse expands again when ready',async()=>{
 const active:BuildState={...ready,jobs:[{id:'build',status:'building',stage:'Running Android tests'}]};await mount(active);
 expect(text()).toContain('Running Android tests');expect(tree!.root.findAllByProps({accessibilityLabel:'Install 2.0'})).toHaveLength(0);
 act(()=>button('Collapse build card').props.onPress());expect(text()).not.toContain('Running Android tests');
 await act(async()=>tree!.update(<BuildCard backend={backend} state={ready} onRefresh={refresh} onDismiss={dismiss}/>));expect(button('Install 2.0')).toBeDefined();
});
test('an installed version gets one dismissible confirmation, never another install prompt',async()=>{
 NativeModules.BobFiles.versionCode=2;NativeModules.BobFiles.versionName='2.0';await AsyncStorage.setItem('pending-install:backend-id','2');await mount();expect(text()).toContain('2.0 installed');expect(tree!.root.findAllByProps({accessibilityLabel:'Install 2.0'})).toHaveLength(0);
 await act(async()=>button('Dismiss build card').props.onPress());expect(tree!.toJSON()).toBeNull();expect(dismiss).toHaveBeenCalled();expect(await AsyncStorage.getItem('pending-install:backend-id')).toBeNull();
});
test('old APKs do not leave a permanent idle card',async()=>{NativeModules.BobFiles.versionCode=3;await mount();expect(tree!.toJSON()).toBeNull();});
test('failed build gives the recorded error and no automatic rebuild',async()=>{
 const fetch=jest.spyOn(globalThis,'fetch').mockRejectedValue(Error('offline'));await mount({enabled:true,jobs:[{id:'failed',status:'failed',stage:'Stopped safely',error:'Test suite failed'}]});expect(text()).toContain('Test suite failed');expect(fetch).not.toHaveBeenCalled();
});
test('uncertain build requests retain their ID across remount; retry is explicit and idempotent',async()=>{
 const fetch=jest.spyOn(globalThis,'fetch').mockRejectedValue(Error('offline'));await mount({enabled:true,jobs:[]},true);
 act(()=>button('Build options').props.onPress());await act(async()=>button('Build app').props.onPress());
 const first=JSON.parse(fetch.mock.calls[0][1]!.body as string);expect(first.id).toBe('app-stable-build-id');expect(await AsyncStorage.getItem('bob.update-request.backend-id')).toContain(first.id);
 await act(async()=>tree!.unmount());tree=undefined;await mount({enabled:true,jobs:[]},true);expect(fetch).toHaveBeenCalledTimes(1);
 act(()=>button('Build options').props.onPress());await act(async()=>button('Retry same build request').props.onPress());
 expect(JSON.parse(fetch.mock.calls[1][1]!.body as string)).toEqual(first);
});

test('background download returns promptly and only another explicit tap opens the ready installer',async()=>{
 let status={state:'idle',message:''};NativeModules.BobFiles.getUpdateStatus=jest.fn(async()=>status);
 NativeModules.BobFiles.installUpdate=jest.fn(async()=>({state:'downloading',message:'Downloading in the background. Return here when ready.'}));
 await mount();await act(async()=>button('Install 2.0').props.onPress());
 expect(button('Install 2.0').props.disabled).toBe(true);expect(text()).toContain('Downloading in the background');
 expect(await AsyncStorage.getItem('pending-install:backend-id')).toBeNull();
 status={state:'ready',message:'Update verified and ready. Tap Install here.'};
 const {AppState}=require('react-native');const change=jest.spyOn(AppState,'addEventListener');
 // Remount exercises native receipt recovery without a new download.
 await act(async()=>tree!.unmount());tree=undefined;await mount();
 expect(button('Install 2.0').props.disabled).toBe(false);expect(text()).toContain('verified and ready');
 expect(NativeModules.BobFiles.installUpdate).toHaveBeenCalledTimes(1);expect(change).toHaveBeenCalled();
 NativeModules.BobFiles.installUpdate.mockResolvedValue({state:'ready',message:'Android installer opening. Confirm there.'});
 await act(async()=>button('Install 2.0').props.onPress());expect(NativeModules.BobFiles.installUpdate).toHaveBeenCalledTimes(2);
 expect(await AsyncStorage.getItem('pending-install:backend-id')).toBe('2');
});

test('two cards observe one native download; build queue is disabled until it finishes',async()=>{
 NativeModules.BobFiles.getUpdateStatus=jest.fn(async()=>({state:'downloading',message:'Downloading in the background.'}));
 await act(async()=>{tree=Renderer.create(<><BuildCard backend={backend} state={ready} focus onRefresh={refresh} onDismiss={dismiss}/><BuildCard backend={backend} state={ready} focus onRefresh={refresh} onDismiss={dismiss}/></>);});
 const cards=tree!.root.findAllByType(BuildCard),installs=cards.map(card=>card.findByProps({accessibilityLabel:'Install 2.0'}));expect(installs).toHaveLength(2);expect(installs.every(node=>node.props.disabled)).toBe(true);
 act(()=>cards.forEach(card=>card.findByProps({accessibilityLabel:'Build options'}).props.onPress()));
 expect(cards.every(card=>card.findByProps({accessibilityLabel:'Build app'}).props.disabled)).toBe(true);
 expect(NativeModules.BobFiles.installUpdate).not.toHaveBeenCalled();
});

test('AppState pauses polling; ready clears earlier failure and explains denied notifications',async()=>{
 jest.useFakeTimers();const {AppState}=require('react-native');let listener:(state:string)=>void=()=>{};
 jest.spyOn(AppState,'addEventListener').mockImplementation((_event:unknown,callback:unknown)=>{listener=callback as typeof listener;return{remove:jest.fn()};});
 let status={state:'failed',message:'Download interrupted. No automatic retry.'};NativeModules.BobFiles.getUpdateStatus=jest.fn(async()=>status);
 try{
  await mount();expect(text()).toContain('Download interrupted');
  act(()=>listener('background'));const calls=NativeModules.BobFiles.getUpdateStatus.mock.calls.length;
  await act(async()=>jest.advanceTimersByTime(10000));expect(NativeModules.BobFiles.getUpdateStatus).toHaveBeenCalledTimes(calls);
  status={state:'ready',message:'Update verified and ready. Notifications are disabled; tap Install here.'};
  await act(async()=>listener('active'));expect(text()).not.toContain('Download interrupted');expect(text()).toContain('Notifications are disabled');
  expect(button('Install 2.0').props.disabled).toBe(false);expect(NativeModules.BobFiles.installUpdate).not.toHaveBeenCalled();
  await act(async()=>jest.advanceTimersByTime(1500));expect(NativeModules.BobFiles.getUpdateStatus).toHaveBeenCalledTimes(calls+2);
 }finally{if(tree)await act(async()=>tree!.unmount());tree=undefined;jest.useRealTimers();}
});

test('late native status from a previous backend/APK cannot overwrite the current card',async()=>{
 let resolveOld:(value:unknown)=>void=()=>{};
 NativeModules.BobFiles.getUpdateStatus=jest.fn().mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;})).mockResolvedValue({state:'idle',message:''});
 await mount();const nextBackend={...backend,backendId:'other-backend'},nextState={...ready,apk:{...apk,releaseId:'next-release',sha256:'b'.repeat(64)}};
 await act(async()=>tree!.update(<BuildCard backend={nextBackend} state={nextState} onRefresh={refresh} onDismiss={dismiss}/>));
 await act(async()=>resolveOld({state:'ready',message:'STALE READY RECEIPT'}));
 expect(text()).not.toContain('STALE READY RECEIPT');expect(await AsyncStorage.getItem('pending-install:backend-id')).toBeNull();
 expect(NativeModules.BobFiles.installUpdate).not.toHaveBeenCalled();
});

test('late install completion after backend switch is ignored, and a status error never strands disabled Install',async()=>{
 let resolveInstall:(value:unknown)=>void=()=>{};
 NativeModules.BobFiles.getUpdateStatus=jest.fn(async()=>({state:'idle',message:''}));
 NativeModules.BobFiles.installUpdate=jest.fn(()=>new Promise(resolve=>{resolveInstall=resolve;}));
 await mount();await act(async()=>button('Install 2.0').props.onPress());
 const nextBackend={...backend,backendId:'other-backend'};
 NativeModules.BobFiles.getUpdateStatus.mockRejectedValue(Error('native query unavailable'));
 await act(async()=>tree!.update(<BuildCard backend={nextBackend} state={ready} onRefresh={refresh} onDismiss={dismiss}/>));
 await act(async()=>resolveInstall({state:'ready',message:'STALE INSTALL COMPLETION'}));
 expect(text()).not.toContain('STALE INSTALL COMPLETION');expect(button('Install 2.0').props.disabled).toBe(false);
 expect(text()).toContain('Update status unavailable');expect(await AsyncStorage.getItem('pending-install:backend-id')).toBeNull();
 expect(NativeModules.BobFiles.installUpdate).toHaveBeenCalledTimes(1);
});
