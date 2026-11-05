import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {AppState,NativeModules,PermissionsAndroid,Platform} from 'react-native';
import * as Keychain from 'react-native-keychain';
import {useKeepConnected} from '../keep-connected';
jest.mock('react-native-keychain',()=>({getGenericPassword:jest.fn()}));
jest.mock('react-native/Libraries/AppState/AppState',()=>({__esModule:true,default:{currentState:'active',addEventListener:jest.fn()}}));
const one={backendId:'11111111-1111-4111-8111-111111111111',endpoint:'https://one.ts.net',name:'One'},two={backendId:'22222222-2222-4222-8222-222222222222',endpoint:'https://two.ts.net',name:'Two'};
type State={enabled:boolean;running:boolean;status:string;batteryRestricted:boolean;error?:string};
let tree:Renderer.ReactTestRenderer|undefined,api:ReturnType<typeof useKeepConnected>,native:any;
let props:{backend?:typeof one;chat?:number;visible?:boolean},states:Map<string,State>,listeners:Map<string,Set<Function>>,selection:[string,number];
const state=(patch:Partial<State>={}):State=>({enabled:false,running:false,status:'off',batteryRestricted:true,...patch});
const saved=(id=one.backendId)=>states.get(id)??state();
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>resolve=yes);return {resolve,promise};}
function Fixture(){api=useKeepConnected(props.backend,props.chat,props.visible);return null;}
async function mount(changes:Partial<typeof props>={}){props={backend:one,chat:7,...changes};await act(async()=>{tree=Renderer.create(<Fixture/>);});}
async function update(changes:Partial<typeof props>){props={...props,...changes};await act(async()=>tree!.update(<Fixture/>));}
async function lifecycle(value:string){await act(async()=>{(AppState as any).currentState=value;for(const listener of listeners.get('change')??[])listener(value);});}
beforeEach(()=>{
 jest.useFakeTimers();jest.replaceProperty(Platform,'OS','android');jest.spyOn(Platform,'Version','get').mockReturnValue(35);(AppState as any).currentState='active';
 states=new Map();listeners=new Map();selection=['',0];
 (AppState.addEventListener as jest.Mock).mockImplementation((type,listener)=>{const set=listeners.get(type)??new Set();set.add(listener);listeners.set(type,set);return {remove:()=>set.delete(listener)};});
 (Keychain.getGenericPassword as jest.Mock).mockReset().mockResolvedValue({password:'secret-pairing-token'});
 jest.spyOn(PermissionsAndroid,'check').mockResolvedValue(true);jest.spyOn(PermissionsAndroid,'request').mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
 native=NativeModules.BobConnection={
  select:jest.fn(async(id:string,chat:number)=>{if(selection[0]!==id||selection[1]!==chat){const previous=states.get(selection[0]);if(previous)states.set(selection[0],{...previous,running:false,status:'off'});}selection=[id,chat];}),
  state:jest.fn(async(id:string)=>JSON.stringify(saved(id))),
  start:jest.fn(async(_endpoint:string,id:string,_token:string,chat:number,allowEnable:boolean)=>{if(selection[0]!==id||selection[1]!==chat)return false;const before=saved(id);if(!allowEnable&&!before.enabled)return false;states.set(id,state({enabled:true,running:true,status:'connected'}));return true;}),
  stop:jest.fn(async(id:string)=>{states.set(id,state());}),openBatterySettings:jest.fn(async()=>true),
 };
 NativeModules.BobPhoneTools={execute:jest.fn(),setEnabled:jest.fn()};
});
afterEach(async()=>{if(tree){await act(async()=>tree!.unmount());tree=undefined;}delete NativeModules.BobConnection;delete NativeModules.BobPhoneTools;jest.restoreAllMocks();jest.useRealTimers();});

test('is off by default and does not retrieve credentials or change phone-tool permissions',async()=>{
 await mount();expect(api.enabled).toBe(false);expect(api.busy).toBe(false);expect(native.select).toHaveBeenCalledWith(one.backendId,7);expect(native.start).not.toHaveBeenCalled();expect(Keychain.getGenericPassword).not.toHaveBeenCalled();expect(NativeModules.BobPhoneTools.setEnabled).not.toHaveBeenCalled();
});
test('explicit enable checks notification permission and starts only the selected native read connection',async()=>{
 await mount();await act(async()=>api.toggle());
 expect(PermissionsAndroid.check).toHaveBeenCalledWith(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
 expect(native.start).toHaveBeenCalledWith(one.endpoint,one.backendId,'secret-pairing-token',7,true);expect(api.enabled).toBe(true);expect(api.status).toBe('connected');
 expect(NativeModules.BobPhoneTools.execute).not.toHaveBeenCalled();expect(NativeModules.BobPhoneTools.setEnabled).not.toHaveBeenCalled();
 await act(async()=>api.toggle());expect(native.stop).toHaveBeenCalledWith(one.backendId);expect(api.enabled).toBe(false);
});
test('notification denial leaves mode off and exposes a bounded actionable error',async()=>{
 (PermissionsAndroid.check as jest.Mock).mockResolvedValue(false);(PermissionsAndroid.request as jest.Mock).mockResolvedValue(PermissionsAndroid.RESULTS.DENIED);
 await mount();await act(async()=>api.toggle());expect(native.start).not.toHaveBeenCalled();expect(api.enabled).toBe(false);expect(api.error).toContain('Allow notifications');expect(api.error).not.toContain('secret');
});
test('no credential cannot turn the service on',async()=>{
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue(false);await mount();await act(async()=>api.toggle());expect(native.start).not.toHaveBeenCalled();expect(api.error).toContain('check pairing');
});
test('saved opt-in resumes with allowEnable false, survives background and React unmount, and reconciles on return',async()=>{
 states.set(one.backendId,state({enabled:true}));await mount();expect(native.start).toHaveBeenLastCalledWith(one.endpoint,one.backendId,'secret-pairing-token',7,false);
 await lifecycle('background');await act(async()=>api.refresh());expect(native.stop).not.toHaveBeenCalled();expect(saved().running).toBe(true);expect(native.start).toHaveBeenCalledTimes(1);
 await lifecycle('active');expect(native.start).toHaveBeenCalledTimes(2);expect(native.start.mock.calls.every((call:any[])=>call[4]===false)).toBe(true);
 const calls=native.select.mock.calls.length;await act(async()=>tree!.unmount());tree=undefined;expect(native.stop).not.toHaveBeenCalled();expect(native.select).toHaveBeenCalledTimes(calls);expect(saved().running).toBe(true);
});
test('a foreground-late credential cannot start after the phone locks',async()=>{
 const auth=deferred<any>();states.set(one.backendId,state({enabled:true}));(Keychain.getGenericPassword as jest.Mock).mockReturnValue(auth.promise);await mount();await lifecycle('background');await act(async()=>auth.resolve({password:'late-token'}));expect(native.start).not.toHaveBeenCalled();
});
test('backend switch immediately retires the old selection; delayed old credentials never start it',async()=>{
 const auth=deferred<any>();states.set(one.backendId,state({enabled:true}));states.set(two.backendId,state({enabled:true}));(Keychain.getGenericPassword as jest.Mock).mockImplementation(({service})=>service===`bob.${one.backendId}`?auth.promise:Promise.resolve({password:'two-token'}));
 await mount();await update({backend:two,chat:8});expect(native.select).toHaveBeenLastCalledWith(two.backendId,8);expect(native.start).toHaveBeenCalledTimes(1);expect(native.start.mock.calls[0][1]).toBe(two.backendId);
 await act(async()=>auth.resolve({password:'one-late-token'}));expect(native.start).toHaveBeenCalledTimes(1);expect(api.enabled).toBe(true);
});
test('A to B to A rejects first A credential callbacks and follows the new chat without restarting the UI',async()=>{
 const first=deferred<any>();states.set(one.backendId,state({enabled:true}));(Keychain.getGenericPassword as jest.Mock).mockImplementationOnce(()=>first.promise).mockResolvedValue({password:'current-token'});
 await mount();await update({backend:two,chat:8});await update({backend:one,chat:9});await act(async()=>first.resolve({password:'obsolete-token'}));
 expect(native.start).toHaveBeenCalledTimes(1);expect(native.start).toHaveBeenLastCalledWith(one.endpoint,one.backendId,'current-token',9,false);
});
test('notification Turn off during a delayed automatic resume cannot be undone',async()=>{
 const auth=deferred<any>();states.set(one.backendId,state({enabled:true}));(Keychain.getGenericPassword as jest.Mock).mockReturnValue(auth.promise);await mount();await native.stop(one.backendId);await act(async()=>auth.resolve({password:'late-token'}));
 expect(native.start).toHaveBeenCalledWith(one.endpoint,one.backendId,'late-token',7,false);expect(saved().enabled).toBe(false);expect(api.enabled).toBe(false);expect(api.running).toBe(false);
});
test('credentials resolved after explicit enable changes scope are discarded',async()=>{
 const auth=deferred<any>();(Keychain.getGenericPassword as jest.Mock).mockReturnValue(auth.promise);await mount();let operation!:Promise<void>;await act(async()=>{operation=api.toggle();});await update({backend:two,chat:8});await act(async()=>{auth.resolve({password:'late-token'});await operation;});expect(native.start).not.toHaveBeenCalled();expect(api.enabled).toBe(false);
});
test('terminal native errors stay visible without autoretry, and raw native error details are not shown',async()=>{
 states.set(one.backendId,state({enabled:true,status:'attention',error:'authorization'}));await mount({visible:true});expect(api.error).toContain('Pair this phone again');await lifecycle('background');await lifecycle('active');await act(async()=>jest.advanceTimersByTime(12000));expect(native.start).not.toHaveBeenCalled();
 states.set(one.backendId,state({enabled:true,status:'attention',error:'https://private.invalid/secret-pairing-token'}));await act(async()=>api.refresh());expect(api.error).not.toContain('private');expect(api.error).toContain('needs attention');
});
test('missing conversation selects nothing, cannot enable, but can disable an existing per-backend opt-in',async()=>{
 states.set(one.backendId,state({enabled:true}));await mount({chat:undefined});expect(native.select).toHaveBeenCalledWith('',0);expect(native.start).not.toHaveBeenCalled();expect(api.canEnable).toBe(false);expect(api.enabled).toBe(true);
 await act(async()=>api.toggle());expect(native.stop).toHaveBeenCalledWith(one.backendId);expect(api.enabled).toBe(false);
});
test('selection removal closes background ownership without enabling anything else',async()=>{
 states.set(one.backendId,state({enabled:true}));await mount();await update({backend:undefined,chat:undefined});expect(native.select).toHaveBeenLastCalledWith('',0);expect(saved().running).toBe(false);expect(api.enabled).toBe(false);
});
test('an endpoint change under one backend identity reconciles the native configuration',async()=>{
 states.set(one.backendId,state({enabled:true}));await mount();await update({backend:{...one,endpoint:'https://new.ts.net'}});expect(native.start).toHaveBeenLastCalledWith('https://new.ts.net',one.backendId,'secret-pairing-token',7,false);
});
test('visible status polling is foreground-only and never reads unlocked credentials for a healthy native service',async()=>{
 states.set(one.backendId,state({enabled:true}));await mount({visible:true});const credentials=(Keychain.getGenericPassword as jest.Mock).mock.calls.length;
 await act(async()=>jest.advanceTimersByTime(9000));expect((Keychain.getGenericPassword as jest.Mock).mock.calls.length).toBe(credentials);
 await lifecycle('background');const reads=native.state.mock.calls.length;await act(async()=>jest.advanceTimersByTime(9000));expect(native.state).toHaveBeenCalledTimes(reads);expect(native.stop).not.toHaveBeenCalled();
});
test('missing or malformed native module does not enable a JS-only background workaround',async()=>{
 delete NativeModules.BobConnection;await mount();expect(api.supported).toBe(false);expect(api.enabled).toBe(false);expect(Keychain.getGenericPassword).not.toHaveBeenCalled();
});
test('native permission/start errors settle the busy state and retry remains an explicit owner action',async()=>{
 native.start.mockRejectedValue(Error('private endpoint/token details'));await mount();await act(async()=>api.toggle());expect(api.busy).toBe(false);expect(api.enabled).toBe(false);expect(api.error).not.toContain('private');expect(api.error).toContain('Could not enable');await lifecycle('background');await lifecycle('active');expect(native.start).toHaveBeenCalledTimes(1);
});

test('visible Disable wins over a pending automatic credential lookup',async()=>{
 const auth=deferred<any>();states.set(one.backendId,state({enabled:true}));(Keychain.getGenericPassword as jest.Mock).mockReturnValue(auth.promise);await mount();expect(api.enabled).toBe(true);await act(async()=>api.toggle());expect(native.stop).toHaveBeenCalledWith(one.backendId);expect(api.enabled).toBe(false);await act(async()=>auth.resolve({password:'obsolete'}));expect(native.start).not.toHaveBeenCalled();expect(api.enabled).toBe(false);
});

test('a stale settings action cannot turn on another workstation after switching',async()=>{
 states.set(one.backendId,state({enabled:true,running:true,status:'connected'}));await mount();const oldDisable=api.toggle,oldRefresh=api.refresh;await update({backend:two,chat:8});const starts=native.start.mock.calls.length;await act(async()=>{await oldDisable();await oldRefresh();});expect(native.start).toHaveBeenCalledTimes(starts);expect(native.stop).not.toHaveBeenCalled();expect(saved(two.backendId).enabled).toBe(false);expect(api.enabled).toBe(false);
});
