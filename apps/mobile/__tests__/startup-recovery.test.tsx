import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {DeviceEventEmitter,NativeModules,Text} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {useSessionShell,type SessionShell} from '../use-session-shell';
import {StartupRecovery} from '../components/startup-recovery';
import {savedBackends,savedSelection,savedChats,STARTUP_READ_TIMEOUT_MS,NOTIFICATION_STARTUP_TIMEOUT_MS} from '../startup-recovery';
import {recordAppEvent} from '../app-diagnostics';

jest.mock('@react-native-async-storage/async-storage',()=>({getItem:jest.fn(),setItem:jest.fn(async()=>{})}));
jest.mock('../use-mobile-runtime',()=>({useMobileRuntime:jest.fn(()=>({})),requestBackend:jest.fn()}));
jest.mock('../phone-tools',()=>({usePhoneTools:jest.fn(()=>({}))}));
jest.mock('../keep-connected',()=>({useKeepConnected:jest.fn(()=>({}))}));
jest.mock('../use-phone-location',()=>({usePhoneLocation:jest.fn(()=>({}))}));
jest.mock('../app-diagnostics',()=>({useAppDiagnostics:jest.fn(),recordAppEvent:jest.fn()}));
jest.mock('../speech',()=>({stopSpeech:jest.fn(async()=>{})}));
jest.mock('../download-cache',()=>({touchCachedConversation:jest.fn(async()=>{})}));
const a={backendId:'workstation-a',endpoint:'https://a.example.invalid',name:'Workstation A'};
const b={backendId:'workstation-b',endpoint:'https://b.example.invalid',name:'Workstation B',alias:'B'};
let shell:SessionShell,tree:Renderer.ReactTestRenderer|undefined,values:Record<string,string>;
function Probe(){shell=useSessionShell();return shell.ready?<Text>{shell.backends.length?'paired':'welcome'}</Text>:<StartupRecovery error={shell.startupError} onRetry={shell.retryStartup}/>;}
async function mount(){await act(async()=>{tree=Renderer.create(<Probe/>);});}
const retry=()=>tree!.root.findByProps({accessibilityLabel:'Retry startup'}).props.onPress();
const json=()=>JSON.stringify(tree!.toJSON());
beforeEach(()=>{
 jest.clearAllMocks();values={backends:JSON.stringify([a,b]),selection:JSON.stringify({backendId:b.backendId,chat:7}),'workstation-selections':JSON.stringify({[a.backendId]:3,[b.backendId]:7}),'notification-opt-in':'false'};
 (AsyncStorage.getItem as jest.Mock).mockImplementation(async key=>values[key]??null);
 NativeModules.BobPlatform={takeNotificationTarget:jest.fn(async()=>null)};
 NativeModules.BobNotifications={setReplyNotifications:jest.fn(),setAppContext:jest.fn()};
});
afterEach(async()=>{if(tree)await act(async()=>tree!.unmount());tree=undefined;jest.useRealTimers();});

test('hydrates validated profiles, per-workstation selection and notification preference without rewriting saved data',async()=>{
 await mount();expect(shell.ready).toBe(true);expect(shell.current).toEqual({backendId:b.backendId,chat:7});expect(shell.backends).toEqual([a,b]);expect(shell.notifyEnabled).toBe(false);
 expect(AsyncStorage.setItem).not.toHaveBeenCalled();expect(recordAppEvent).toHaveBeenCalledWith('startup.session-ready');
 await act(async()=>shell.selectBackend(a));expect(shell.current).toEqual({backendId:a.backendId,chat:3});expect(AsyncStorage.setItem).toHaveBeenCalledWith('selection',JSON.stringify({backendId:a.backendId,chat:3}));
});

test.each(['read','parse','shape','duplicate','endpoint','selection','chats'])('%s failure is recoverable and never becomes welcome or rewrites profiles',async(kind)=>{
 const original={...values};
 if(kind==='read')(AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(Error('synthetic storage failure'));
 if(kind==='parse')values.backends='{bad';
 if(kind==='shape')values.backends='{}';
 if(kind==='duplicate')values.backends=JSON.stringify([a,a]);
 if(kind==='endpoint')values.backends=JSON.stringify([{...a,endpoint:'http://unsafe.example.invalid'}]);
 if(kind==='selection')values.selection='42';
 if(kind==='chats')values['workstation-selections']='[]';
 const before={...values};await mount();expect(shell.ready).toBe(false);expect(shell.startupError).toContain('Nothing was removed');expect(json()).not.toContain('welcome');expect(AsyncStorage.setItem).not.toHaveBeenCalled();expect(values).toEqual(before);
 values=original;await act(async()=>retry());expect(shell.ready).toBe(true);expect(shell.backends).toEqual([a,b]);expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('only a successfully read empty pairing list permits welcome',async()=>{
 values={};await mount();expect(shell.ready).toBe(true);expect(shell.backends).toEqual([]);expect(json()).toContain('welcome');expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('hung saved-pairing read reaches bounded recovery; retry wins over late original completion',async()=>{
 jest.useFakeTimers();let resolve!:(value:string)=>void;
 (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
 await mount();expect(shell.ready).toBe(false);expect(shell.startupError).toBe('');
 await act(async()=>jest.advanceTimersByTime(STARTUP_READ_TIMEOUT_MS));expect(shell.ready).toBe(false);expect(shell.startupError).toContain('Nothing was removed');
 await act(async()=>retry());expect(shell.ready).toBe(true);expect(shell.backends).toEqual([a,b]);
 await act(async()=>resolve('[]'));expect(shell.backends).toEqual([a,b]);expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('hung notification target cannot delay ordinary startup or apply a late route after its deadline',async()=>{
 jest.useFakeTimers();let resolve!:(value:unknown)=>void;
 NativeModules.BobPlatform.takeNotificationTarget.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
 await mount();expect(shell.ready).toBe(true);expect(shell.current).toEqual({backendId:b.backendId,chat:7});
 await act(async()=>jest.advanceTimersByTime(NOTIFICATION_STARTUP_TIMEOUT_MS));
 await act(async()=>resolve({backendId:a.backendId,conversationId:99}));expect(shell.current).toEqual({backendId:b.backendId,chat:7});
});

test('fresh notification routes after hydration but does not steal a newer explicit selection',async()=>{
 let resolve!:(value:unknown)=>void;NativeModules.BobPlatform.takeNotificationTarget.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
 await mount();await act(async()=>shell.selectBackend(a));await act(async()=>resolve({backendId:b.backendId,conversationId:99}));expect(shell.current).toEqual({backendId:a.backendId,chat:3});
 NativeModules.BobPlatform.takeNotificationTarget.mockResolvedValueOnce({backendId:b.backendId,conversationId:8});
 await act(async()=>DeviceEventEmitter.emit('BobNotificationOpen'));expect(shell.current).toEqual({backendId:b.backendId,chat:8});
});

test('saved record validation preserves opaque identity and rejects unsafe transport and malformed numeric selections',()=>{
 expect(savedBackends(JSON.stringify([a,b]))).toEqual([a,b]);expect(savedBackends(null)).toEqual([]);
 for(const endpoint of ['https://user:pass@a.example.invalid','https://a.example.invalid/path','https://a.example.invalid?token=secret','file:///tmp/record','http://127.0.0.1:9000'])expect(()=>savedBackends(JSON.stringify([{...a,endpoint}]))).toThrow();
 expect(savedBackends(JSON.stringify([{...a,endpoint:'http://127.0.0.1:9000'}]),true)).toHaveLength(1);
 for(const chat of [0,-1,1.5,'7',Number.MAX_SAFE_INTEGER+1]){
  expect(()=>savedSelection(JSON.stringify({backendId:a.backendId,chat}))).toThrow();expect(()=>savedChats(JSON.stringify({[a.backendId]:chat}))).toThrow();
 }
});
