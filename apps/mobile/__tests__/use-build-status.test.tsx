import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {AppState} from 'react-native';
import * as Keychain from 'react-native-keychain';
import {useBuildStatus,type BuildBackend,type BuildState} from '../use-build-status';

jest.mock('react-native-keychain',()=>({getGenericPassword:jest.fn(async()=>({password:'test-token'}))}));
const backend={backendId:'desktop',endpoint:'https://desktop.example',name:'Desktop'};
let value:ReturnType<typeof useBuildStatus>,tree:Renderer.ReactTestRenderer|undefined;
function Probe({backend:source=backend}:{backend?:BuildBackend}){value=useBuildStatus(source);return null;}
async function mount(){await act(async()=>{tree=Renderer.create(<Probe/>);});}
function response(state:BuildState){return {ok:true,status:200,json:async()=>state} as Response;}
beforeEach(()=>{jest.useFakeTimers();Object.defineProperty(AppState,'currentState',{configurable:true,writable:true,value:'active'});});
afterEach(async()=>{if(tree)await act(async()=>tree!.unmount());tree=undefined;jest.restoreAllMocks();jest.useRealTimers();});

test('not installed and supervisor offline are successful status responses, never transport failures',async()=>{
 const fetch=jest.spyOn(globalThis,'fetch').mockResolvedValueOnce(response({enabled:false,reason:'not_installed',installCommand:'bob updates install --help'})).mockResolvedValue(response({enabled:true,supervisorOnline:false,androidBuild:{configured:false}}));
 await mount();expect(value.state).toMatchObject({enabled:false,reason:'not_installed'});expect(value.error).toBe('');
 await act(async()=>value.refresh());
 expect(value.state).toMatchObject({enabled:true,supervisorOnline:false,androidBuild:{configured:false}});expect(value.error).toBe('');
 expect(fetch.mock.calls.every(([,options])=>!options?.method||options.method==='GET')).toBe(true);
 expect(fetch.mock.calls[0][1]?.headers).toMatchObject({'x-bob-backend':'desktop',Authorization:'Bearer test-token'});
});

test('transport failures retain the last receipt and stay errors until a successful refresh, not merely a refresh tap',async()=>{
 const state:BuildState={enabled:true,supervisorOnline:true,jobs:[{id:'retained',status:'building',stage:'Running tests'}]};
 let resolveRefresh:(response:Response)=>void=()=>{};
 const fetch=jest.spyOn(globalThis,'fetch').mockResolvedValueOnce(response(state)).mockRejectedValueOnce(Error('Network request failed')).mockImplementationOnce(()=>new Promise(resolve=>{resolveRefresh=resolve;}));
 await mount();await act(async()=>jest.advanceTimersByTime(3000));
 expect(value.error).toBe('Network request failed');expect(value.state).toEqual(state);
 await act(async()=>value.refresh());expect(value.error).toBe('Network request failed');expect(value.state).toEqual(state);
 await act(async()=>resolveRefresh(response({...state,supervisorOnline:false})));
 expect(value.error).toBe('');expect(value.state?.supervisorOnline).toBe(false);expect(value.state?.jobs).toEqual(state.jobs);
 expect(fetch).toHaveBeenCalledTimes(3);
});

test('an HTTP error is a transport/status failure, not a disabled update capability',async()=>{
 jest.spyOn(globalThis,'fetch').mockResolvedValue({ok:false,status:503} as Response);
 await mount();expect(value.state).toBeUndefined();expect(value.error).toBe('Build status unavailable (503)');
});

test('a changed endpoint for the same backend cannot reuse old status or an old in-flight result',async()=>{
 let resolveOld:(response:Response)=>void=()=>{},resolveNew:(response:Response)=>void=()=>{};
 jest.spyOn(globalThis,'fetch').mockResolvedValueOnce(response({enabled:true,supervisorOnline:true})).mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;})).mockImplementationOnce(()=>new Promise(resolve=>{resolveNew=resolve;}));
 await mount();await act(async()=>value.refresh());
 await act(async()=>tree!.update(<Probe backend={{...backend,endpoint:'https://new-desktop.example'}}/>));
 expect(value.state).toBeUndefined();expect(value.error).toBe('');
 await act(async()=>resolveOld(response({enabled:true,supervisorOnline:true})));
 expect(value.state).toBeUndefined();
 await act(async()=>resolveNew(response({enabled:false,reason:'not_installed'})));
 expect(value.state).toMatchObject({enabled:false,reason:'not_installed'});
});

test('status errors do not leak across backend endpoints',async()=>{
 let resolveNew:(response:Response)=>void=()=>{};
 jest.spyOn(globalThis,'fetch').mockRejectedValueOnce(Error('old endpoint unavailable')).mockImplementationOnce(()=>new Promise(resolve=>{resolveNew=resolve;}));
 await mount();expect(value.error).toBe('old endpoint unavailable');
 await act(async()=>tree!.update(<Probe backend={{...backend,endpoint:'https://new-desktop.example'}}/>));
 expect(value.state).toBeUndefined();expect(value.error).toBe('');
 await act(async()=>resolveNew(response({enabled:true,supervisorOnline:true})));
 expect(value.error).toBe('');
});

test('missing pairing credentials do not fetch status or pretend updates are uninstalled',async()=>{
 jest.spyOn(Keychain,'getGenericPassword').mockResolvedValue(false);
 const fetch=jest.spyOn(globalThis,'fetch');
 await mount();expect(value.state).toBeUndefined();expect(value.error).toBe('Pairing credential unavailable');expect(fetch).not.toHaveBeenCalled();
});
