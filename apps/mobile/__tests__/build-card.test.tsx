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
