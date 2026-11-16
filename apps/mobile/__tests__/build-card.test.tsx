import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {AppState,Modal,NativeModules,StyleSheet} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {BuildCard} from '../components/build-card';
import {UpdatePopover} from '../components/update-popover';
import type {BuildState} from '../use-build-status';
jest.mock('@react-native-async-storage/async-storage',()=>{const values=new Map();return{getItem:jest.fn(async(key:string)=>values.get(key)??null),setItem:jest.fn(async(key:string,value:string)=>{values.set(key,value);}),removeItem:jest.fn(async(key:string)=>{values.delete(key);}),clear:jest.fn(async()=>values.clear())};});
jest.mock('uuid',()=>({v4:()=> 'stable-build-id'}));
jest.mock('react-native-keychain',()=>({getGenericPassword:jest.fn(async()=>({password:'secret'}))}));
jest.mock('lucide-react-native',()=>new Proxy({},{get:(_,name)=>name==='__esModule'?true:()=>null}));
jest.mock('react-native-safe-area-context',()=>({useSafeAreaInsets:()=>({top:24,bottom:16,left:0,right:0})}));
const backend={backendId:'backend-id',endpoint:'https://backend.example.invalid',name:'Do not display hostname'},refresh=jest.fn(),dismiss=jest.fn();
const apk={releaseId:'release-id',sha256:'a'.repeat(64),size:1000,versionCode:2,versionName:'2.0'};
const ready:BuildState={enabled:true,jobs:[],apk};
let tree:Renderer.ReactTestRenderer|undefined;
const render=(state:BuildState|undefined=ready,focus=false,extra:Partial<React.ComponentProps<typeof BuildCard>>={})=><BuildCard backend={backend} state={state} focus={focus} onRefresh={refresh} onDismiss={dismiss} {...extra}/>;
async function mount(state:BuildState|undefined=ready,focus=false,open=true){await act(async()=>{tree=Renderer.create(render(state,focus));});if(open&&!focus&&tree!.root.findAllByProps({accessibilityLabel:'App update status'}).length)await act(async()=>button('App update status').props.onPress());return tree!;}
const button=(name:string)=>tree!.root.findByProps({accessibilityLabel:name});
const text=()=>JSON.stringify(tree!.toJSON());
const popup=()=>tree!.root.findByType(UpdatePopover);
const native=()=>NativeModules.BobFiles;
async function update(state:BuildState|undefined=ready,focus=false,extra:Partial<React.ComponentProps<typeof BuildCard>>={}){await act(async()=>tree!.update(render(state,focus,extra)));}
async function remount(state:BuildState|undefined=ready,focus=false){await act(async()=>tree!.unmount());tree=undefined;await mount(state,focus);}
beforeEach(async()=>{await AsyncStorage.clear();NativeModules.BobFiles={versionCode:1,versionName:'1.0',getUpdateStatus:jest.fn(async()=>({state:'idle'})),installUpdate:jest.fn(async()=>({state:'ready'}))};refresh.mockClear();dismiss.mockClear();});
afterEach(async()=>{if(tree)await act(async()=>tree!.unmount());tree=undefined;jest.restoreAllMocks();});

test('initially only one small top-right circle with a real 48dp target, no popup or inline card',async()=>{
 await mount(ready,false,false);
 expect((text().match(/App update status/g)??[])).toHaveLength(1);
 expect(popup().props.visible).toBe(false);expect(text()).not.toContain(backend.name);expect(text()).not.toContain('Build options');
 expect(StyleSheet.flatten(button('App update status').props.style)).toMatchObject({width:48,height:48});
 expect(StyleSheet.flatten(tree!.root.findByProps({testID:'update-indicator-anchor'}).props.style)).toMatchObject({position:'absolute',top:28,right:8});
 expect(button('App update status').props.accessibilityValue.text).toBe('App 2.0 available');
 expect(native().installUpdate).not.toHaveBeenCalled();
});
test('download and install each need an owner tap; ready never auto-opens installer',async()=>{
 native().installUpdate.mockResolvedValueOnce({state:'downloading'});
 await mount();await act(async()=>button('Download 2.0').props.onPress());
 expect(native().installUpdate).toHaveBeenCalledWith(backend.endpoint+'/v1/updates/release-id/apk','secret',backend.backendId,apk.sha256,apk.size);
 expect(text()).toContain('Downloading & verifying');expect(text()).not.toContain('ready to install');expect(text()).not.toContain('%');
 expect(tree!.root.findAllByProps({accessibilityLabel:'Download 2.0'})).toHaveLength(0);
 expect(await AsyncStorage.getItem('pending-install:backend-id')).toBeNull();
 native().getUpdateStatus.mockResolvedValue({state:'ready',message:'UNTRUSTED INSTRUCTIONS'});await remount();
 expect(text()).toContain('ready to install');expect(text()).not.toContain('UNTRUSTED INSTRUCTIONS');expect(native().installUpdate).toHaveBeenCalledTimes(1);
 await act(async()=>button('Install 2.0').props.onPress());expect(native().installUpdate).toHaveBeenCalledTimes(2);
 expect(await AsyncStorage.getItem('pending-install:backend-id')).toBe('2');
});
test.each(['Close updates','Close update bubble','back','escape'])('%s closes presentation only, without cancelling or persisting a dismissal',async(label)=>{
 native().getUpdateStatus.mockResolvedValue({state:'downloading'});await mount();
 const reads=native().getUpdateStatus.mock.calls.length;
 if(label==='back')act(()=>tree!.root.findByType(Modal).props.onRequestClose());
 else if(label==='escape')act(()=>tree!.root.findByProps({testID:'update-popover'}).props.onAccessibilityEscape());
 else act(()=>button(label).props.onPress());
 expect(popup().props.visible).toBe(false);expect(await AsyncStorage.getItem('build-dismissed:backend-id')).toBeNull();
 act(()=>button('App update status').props.onPress());expect(popup().props.visible).toBe(true);
 expect(native().getUpdateStatus).toHaveBeenCalledTimes(reads);expect(native().installUpdate).not.toHaveBeenCalled();
});
test('routine progress and ready transitions never automatically open the bubble',async()=>{
 await mount({...ready,jobs:[{id:'build',status:'queued',stage:'Queued'}]},false,false);
 expect(popup().props.visible).toBe(false);
 await update({...ready,jobs:[{id:'build',status:'building',stage:'Running Android tests'}]});expect(popup().props.visible).toBe(false);
 act(()=>button('App update status').props.onPress());expect(text()).toContain('Running Android tests');expect(text()).not.toContain('Downloaded update status is not confirmed');expect(tree!.root.findAllByProps({accessibilityLabel:'Check status'})).toHaveLength(0);
 act(()=>button('Close updates').props.onPress());await update(ready);expect(popup().props.visible).toBe(false);
});
test('installed acknowledgement is accurate and safely persists across remount',async()=>{
 native().versionCode=2;native().versionName='2.0';await AsyncStorage.setItem('pending-install:backend-id','2');await mount();
 expect(text()).toContain('2.0 installed');expect(native().installUpdate).not.toHaveBeenCalled();
 await act(async()=>button('Acknowledge update').props.onPress());expect(popup().props.visible).toBe(false);
 expect(await AsyncStorage.getItem('pending-install:backend-id')).toBeNull();await remount();
 expect(tree!.root.findAllByProps({accessibilityLabel:'App update status'})).toHaveLength(0);
 // Explicit management stays reachable after dismissing a terminal notice.
 await update(ready,true);expect(popup().props.visible).toBe(true);expect(button('Build app')).toBeDefined();
});
test.each([0,-1,undefined,NaN])('unknown installed version (%s) is never installable or called installed',async(code)=>{
 native().versionCode=code;await AsyncStorage.setItem('pending-install:backend-id','2');await mount();
 expect(text()).toContain('Installed app version unavailable');expect(text()).toContain('Fully close and reopen');
 expect(tree!.root.findAllByProps({accessibilityLabel:'Download 2.0'})).toHaveLength(0);expect(text()).not.toContain('2.0 installed');
 expect(native().getUpdateStatus).not.toHaveBeenCalled();expect(native().installUpdate).not.toHaveBeenCalled();
});
test('old APK leaves no idle indicator; explicit management is still usable',async()=>{
 native().versionCode=3;await mount();expect(tree!.root.findAllByProps({accessibilityLabel:'App update status'})).toHaveLength(0);
 await update(ready,true);expect(popup().props.visible).toBe(true);expect(button('Build app')).toBeDefined();
});
test('failed build exposes recorded error, no automatic rebuild, and no routine build clutter',async()=>{
 const fetch=jest.spyOn(globalThis,'fetch').mockRejectedValue(Error('offline'));
 await mount({enabled:true,jobs:[{id:'failed',status:'failed',stage:'Stopped safely',error:'Test suite failed'}]});
 expect(text()).toContain('Test suite failed');expect(text()).not.toContain('Build options');expect(tree!.root.findAllByProps({accessibilityLabel:'Build app'})).toHaveLength(0);expect(fetch).not.toHaveBeenCalled();
 await act(async()=>button('Dismiss update').props.onPress());await remount({enabled:true,jobs:[{id:'failed',status:'failed',stage:'Stopped safely',error:'Test suite failed'}]});
 expect(tree!.root.findAllByProps({accessibilityLabel:'App update status'})).toHaveLength(0);
});
test('uncertain build preserves request ID across close/remount; retry is explicit and idempotent',async()=>{
 const fetch=jest.spyOn(globalThis,'fetch').mockRejectedValue(Error('offline'));await mount({enabled:true,jobs:[]},true);
 await act(async()=>button('Build app').props.onPress());const first=JSON.parse(fetch.mock.calls[0][1]!.body as string);
 expect(first.id).toBe('app-stable-build-id');expect(await AsyncStorage.getItem('bob.update-request.backend-id')).toContain(first.id);
 act(()=>button('Close updates').props.onPress());await remount({enabled:true,jobs:[]},true);expect(fetch).toHaveBeenCalledTimes(1);
 await act(async()=>button('Retry same build request').props.onPress());expect(JSON.parse(fetch.mock.calls[1][1]!.body as string)).toEqual(first);
 await update({enabled:true,jobs:[{...first,status:'complete',stage:'Complete'}]},true);
 expect(await AsyncStorage.getItem('bob.update-request.backend-id')).toBeNull();
});
test.each(['install','queue'])('%s duplicate taps in the same render admit only one side effect',async(kind)=>{
 const fetch=jest.spyOn(globalThis,'fetch').mockResolvedValue({ok:true} as Response);await mount(ready,kind==='queue');
 const handler=button(kind==='install'?'Download 2.0':'Build app').props.onPress;
 await act(async()=>{handler();handler();});
 expect(kind==='install'?native().installUpdate:fetch).toHaveBeenCalledTimes(1);
});
test('native download remains observed while menus hide presentation, without a competing controller',async()=>{
 native().getUpdateStatus.mockResolvedValue({state:'downloading'});await mount(ready,true);
 expect(button('Build app').props.disabled).toBe(true);await act(async()=>button('Build app').props.onPress());expect(native().installUpdate).not.toHaveBeenCalled();
 await update(ready,false,{active:false});expect(popup().props.visible).toBe(false);
 await update();expect(popup().props.visible).toBe(false);expect(button('App update status').props.accessibilityValue.text).toContain('Downloading');
});
test.each(['busy','verifying','unknown'])('native %s is truthful and never installable',async(state)=>{
 native().getUpdateStatus.mockResolvedValue({state});await mount();expect(tree!.root.findAllByProps({accessibilityLabel:'Install 2.0'})).toHaveLength(0);expect(tree!.root.findAllByProps({accessibilityLabel:'Download 2.0'})).toHaveLength(0);
 expect(native().installUpdate).not.toHaveBeenCalled();
});
test('AppState suspends reads, fences late background results, recovers ready without retrying download',async()=>{
 jest.useFakeTimers();let listener:(state:string)=>void=()=>{};
 jest.spyOn(AppState,'addEventListener').mockImplementation((_event:unknown,callback:unknown)=>{listener=callback as typeof listener;return{remove:jest.fn()};});
 let resolve:(value:unknown)=>void=()=>{};native().getUpdateStatus.mockImplementationOnce(()=>new Promise(done=>{resolve=done;})).mockResolvedValue({state:'ready'});
 try{
  await mount();act(()=>listener('background'));const calls=native().getUpdateStatus.mock.calls.length;
  await act(async()=>resolve({state:'ready'}));expect(await AsyncStorage.getItem('pending-install:backend-id')).toBeNull();
  await act(async()=>jest.advanceTimersByTime(10000));expect(native().getUpdateStatus).toHaveBeenCalledTimes(calls);
  await act(async()=>listener('active'));expect(button('Install 2.0').props.disabled).toBe(false);expect(native().installUpdate).not.toHaveBeenCalled();
 }finally{if(tree)await act(async()=>tree!.unmount());tree=undefined;jest.useRealTimers();}
});
test.each(['backend','endpoint','artifact'])('late native read after %s change cannot overwrite current status',async(change)=>{
 let resolve:(value:unknown)=>void=()=>{};native().getUpdateStatus.mockImplementationOnce(()=>new Promise(done=>{resolve=done;})).mockResolvedValue({state:'idle'});
 await mount();await update(change==='artifact'?{...ready,apk:{...apk,releaseId:'next',sha256:'b'.repeat(64)}}:ready,false,{backend:change==='backend'?{...backend,backendId:'other'}:change==='endpoint'?{...backend,endpoint:'https://other.example.invalid'}:backend});
 await act(async()=>resolve({state:'ready'}));expect(await AsyncStorage.getItem('pending-install:backend-id')).toBeNull();expect(native().installUpdate).not.toHaveBeenCalled();
});
test.each(['install','queue'])('late %s completion after backend switch cannot mutate the new owner',async(kind)=>{
 let resolve:(value:any)=>void=()=>{};
 native().installUpdate.mockImplementation(()=>new Promise(done=>{resolve=done;}));
 const fetch=jest.spyOn(globalThis,'fetch').mockImplementation(()=>new Promise(done=>{resolve=done;}));
 await mount(ready,kind==='queue');await act(async()=>button(kind==='install'?'Download 2.0':'Build app').props.onPress());
 await update(ready,false,{backend:{...backend,backendId:'other'}});await act(async()=>resolve(kind==='install'?{state:'ready'}:{ok:true}));
 expect(await AsyncStorage.getItem('pending-install:backend-id')).toBeNull();expect(refresh).not.toHaveBeenCalled();
 if(kind==='queue')expect(await AsyncStorage.getItem('bob.update-request.backend-id')).toContain('app-stable-build-id');
 expect(kind==='install'?native().installUpdate:fetch).toHaveBeenCalledTimes(1);
});
test.each([
 ['not configured',{enabled:false},undefined,'Updates not configured'],
 ['offline',{enabled:true,supervisorOnline:false},undefined,'Update supervisor offline'],
 ['transport failure',{enabled:true,supervisorOnline:true},'Network request failed','Update status unavailable'],
] as const)('%s never presents stale APK as installable and guards build handlers',async(_name,status,error,title)=>{
 const fetch=jest.spyOn(globalThis,'fetch').mockResolvedValue({ok:true} as Response);
 await act(async()=>{tree=Renderer.create(render({...ready,...status},true,{error}));});
 expect(text()).toContain(title);expect(tree!.root.findAllByProps({accessibilityLabel:'Download 2.0'})).toHaveLength(0);expect(tree!.root.findAllByProps({accessibilityLabel:'Install 2.0'})).toHaveLength(0);
 for(const name of ['Build app','Build app and backend']){expect(button(name).props.disabled).toBe(true);await act(async()=>button(name).props.onPress());}
 expect(fetch).not.toHaveBeenCalled();expect(native().installUpdate).not.toHaveBeenCalled();expect(native().getUpdateStatus).not.toHaveBeenCalled();
 await act(async()=>button('Check status').props.onPress());expect(refresh).toHaveBeenCalledTimes(1);
});
test('Android build prerequisites gate builds, not an existing verified artifact',async()=>{
 native().getUpdateStatus.mockResolvedValue({state:'ready'});await mount({...ready,androidBuild:{configured:false}},true);
 expect(text()).toContain('prerequisites are not configured');expect(button('Build app').props.disabled).toBe(true);expect(button('Install 2.0').props.disabled).toBe(false);
});
test('offline uncertain request is retained and can only be retried explicitly after recovery',async()=>{
 const pending={id:'original-request',action:'update',target:'android'};await AsyncStorage.setItem('bob.update-request.backend-id',JSON.stringify(pending));
 const fetch=jest.spyOn(globalThis,'fetch').mockResolvedValue({ok:true} as Response);await mount({enabled:true,supervisorOnline:false,jobs:[]},true);
 expect(button('Retry same build request').props.disabled).toBe(true);await act(async()=>button('Retry same build request').props.onPress());expect(fetch).not.toHaveBeenCalled();
 await update({enabled:true,supervisorOnline:true,jobs:[]},true);expect(fetch).not.toHaveBeenCalled();
 await act(async()=>button('Retry same build request').props.onPress());expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual(pending);
});
test.each(['rollback','update'])('retained %s backend request is never resent by management',async(action)=>{
 const pending={id:'backend-request',action,target:'backend'};await AsyncStorage.setItem('bob.update-request.backend-id',JSON.stringify(pending));
 const fetch=jest.spyOn(globalThis,'fetch').mockResolvedValue({ok:true} as Response);await mount({enabled:true,supervisorOnline:true,jobs:[]},true);
 expect(text()).toContain('will not be resent here');expect(button('Retry same build request').props.disabled).toBe(true);
 await act(async()=>button('Retry same build request').props.onPress());expect(fetch).not.toHaveBeenCalled();expect(await AsyncStorage.getItem('bob.update-request.backend-id')).toBe(JSON.stringify(pending));
});
test('native status failure cannot imply installability; checking again is read-only',async()=>{
 native().getUpdateStatus.mockRejectedValue(Error('unavailable'));await mount();expect(text()).toContain('not confirmed');
 expect(tree!.root.findAllByProps({accessibilityLabel:'Download 2.0'})).toHaveLength(0);
 await act(async()=>button('Check status').props.onPress());expect(refresh).toHaveBeenCalled();expect(native().installUpdate).not.toHaveBeenCalled();
});

test.each(['install','queue'])('closing management while %s awaits credentials is not cancellation',async(kind)=>{
 const credentials=require('react-native-keychain');let resolve:(value:unknown)=>void=()=>{};
 const fetch=jest.spyOn(globalThis,'fetch').mockResolvedValue({ok:true} as Response);
 await mount(ready,true);
 credentials.getGenericPassword.mockImplementationOnce(()=>new Promise((done:typeof resolve)=>{resolve=done;}));
 await act(async()=>button(kind==='install'?'Download 2.0':'Build app').props.onPress());
 act(()=>button('Close updates').props.onPress());await update(ready,false,{active:false});
 await act(async()=>resolve({password:'secret'}));
 expect(kind==='install'?native().installUpdate:fetch).toHaveBeenCalledTimes(1);
 expect(popup().props.visible).toBe(false);
});
test.each(['install','queue'])('availability loss during %s credential lookup fences the mutation',async(kind)=>{
 const credentials=require('react-native-keychain');let resolve:(value:unknown)=>void=()=>{};
 const fetch=jest.spyOn(globalThis,'fetch').mockResolvedValue({ok:true} as Response);
 await mount(ready,true);
 credentials.getGenericPassword.mockImplementationOnce(()=>new Promise((done:typeof resolve)=>{resolve=done;}));
 await act(async()=>button(kind==='install'?'Download 2.0':'Build app').props.onPress());
 await update({...ready,supervisorOnline:false},true);
 await act(async()=>resolve({password:'secret'}));
 expect(native().installUpdate).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
 if(kind==='queue')expect(await AsyncStorage.getItem('bob.update-request.backend-id')).toContain('app-stable-build-id');
});
test('a failed newest build is not concealed by an older downloadable APK',async()=>{
 await mount({...ready,jobs:[{id:'failed-latest',status:'failed',stage:'Build stopped',error:'Android checks failed'}]});
 expect(text()).toContain('Build needs attention');expect(text()).toContain('Android checks failed');
 expect(tree!.root.findAllByProps({accessibilityLabel:'Download 2.0'})).toHaveLength(0);
 expect(button('Check status')).toBeDefined();expect(native().installUpdate).not.toHaveBeenCalled();
});
test('a safely dismissed download failure stays dismissed while its native receipt is reloaded',async()=>{
 native().getUpdateStatus.mockResolvedValue({state:'failed'});await mount();await act(async()=>button('Dismiss update').props.onPress());
 let resolve:(value:unknown)=>void=()=>{};native().getUpdateStatus.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
 await remount(ready,false);
 expect(tree!.root.findAllByProps({accessibilityLabel:'App update status'})).toHaveLength(0);
 await act(async()=>resolve({state:'failed'}));
 expect(tree!.root.findAllByProps({accessibilityLabel:'App update status'})).toHaveLength(0);
});


test('a new explicit download attempt retires dismissal of the previous failure',async()=>{
 jest.useFakeTimers();
 try{
  native().getUpdateStatus.mockResolvedValue({state:'failed'});native().installUpdate.mockResolvedValue({state:'downloading'});
  await mount();await act(async()=>button('Dismiss update').props.onPress());expect(await AsyncStorage.getItem('build-dismissed:backend-id')).toContain('failed');
  await update(ready,true);await act(async()=>button('Retry download').props.onPress());
  expect(await AsyncStorage.getItem('build-dismissed:backend-id')).toBeNull();
  act(()=>button('Close updates').props.onPress());await update(ready,false);
  await act(async()=>jest.advanceTimersByTime(1500));
  expect(button('App update status').props.accessibilityValue.text).toBe('Download needs attention');expect(popup().props.visible).toBe(false);
 }finally{if(tree)await act(async()=>tree!.unmount());tree=undefined;jest.useRealTimers();}
});
