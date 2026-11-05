import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {AppState,NativeModules,PermissionsAndroid,Platform} from 'react-native';
import {usePhoneTools,validatePhoneToolRequest,PhoneToolRequest,PhoneToolsBackend} from '../phone-tools';
jest.mock('react-native/Libraries/AppState/AppState',()=>({__esModule:true,default:{currentState:'active',addEventListener:jest.fn()}}));
const backend={backendId:'owner',endpoint:'https://owner.example',name:'Owner'};
let serial=0;
const item=(overrides:Partial<PhoneToolRequest>={}):PhoneToolRequest=>({id:(++serial).toString(16).padStart(64,'0'),action:'calendar_create',parameters:{title:'Test'},expiresAt:Date.now()+89000,status:'pending',...overrides});
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
let tree:Renderer.ReactTestRenderer|undefined,api:ReturnType<typeof usePhoneTools>;
let listener:(state:string)=>void;
let props:{backend?:PhoneToolsBackend;chat?:number;requests?:PhoneToolRequest[];request:jest.Mock};
function Fixture(){api=usePhoneTools(props);return null;}
async function mount(requests:PhoneToolRequest[]=[],request?:jest.Mock){
 props={backend,chat:1,requests,request:request??jest.fn(async(_path,_method,body)=>body.action==='claim'?{execute:true,status:'executing'}:{accepted:true,enabled:body.enabled})};
 await act(async()=>{tree=Renderer.create(<Fixture/>);});
}
async function render(changes:Partial<typeof props>={}){props={...props,...changes};await act(async()=>tree!.update(<Fixture/>));}
async function appState(state:string){await act(async()=>{(AppState as any).currentState=state;listener(state);});}
const claims=()=>props.request.mock.calls.filter(call=>call[2]?.action==='claim');
const results=()=>props.request.mock.calls.filter(call=>call[2]?.action==='result');
beforeEach(()=>{
 jest.useFakeTimers();jest.replaceProperty(Platform,'OS','android');(AppState as any).currentState='active';
 (AppState.addEventListener as jest.Mock).mockImplementation((_type,callback)=>{listener=callback;return {remove:jest.fn()};});
 NativeModules.BobPhoneTools={enabled:jest.fn(async()=>true),setEnabled:jest.fn(async()=>undefined),execute:jest.fn(async()=>JSON.stringify({status:'ok',data:{eventId:'new'}})),getResult:jest.fn(async()=>null)};
 jest.spyOn(PermissionsAndroid,'check').mockResolvedValue(true);
 jest.spyOn(PermissionsAndroid,'requestMultiple').mockResolvedValue({} as Awaited<ReturnType<typeof PermissionsAndroid.requestMultiple>>);
});
afterEach(async()=>{if(tree){await act(async()=>tree!.unmount());tree=undefined;}jest.restoreAllMocks();jest.useRealTimers();});

test('claims before native execution, strips server status, uses explicit source, and deduplicates render/SSE churn',async()=>{
 const claim=deferred<any>(),request=jest.fn(async(_path,_method,body)=>body.action==='claim'?claim.promise:{accepted:true,enabled:body.enabled});const task=item();
 await mount([task,task],request);expect(claims()).toHaveLength(1);expect(NativeModules.BobPhoneTools.execute).not.toHaveBeenCalled();
 await render({requests:[{...task}],request:jest.fn(request)});await render({requests:[task,task]});
 await act(async()=>claim.resolve({execute:true,status:'executing'}));
 expect(NativeModules.BobPhoneTools.execute).toHaveBeenCalledTimes(1);
 expect(JSON.parse(NativeModules.BobPhoneTools.execute.mock.calls[0][1])).toEqual({id:task.id,action:task.action,parameters:task.parameters,expiresAt:task.expiresAt});
 expect(request.mock.calls.find(call=>call[2]?.action==='result')?.slice(0,4)).toEqual(['chats/1/phone-tools','POST',{id:task.id,action:'result',result:{status:'ok',data:{eventId:'new'}}},backend]);
});

test('failed and denied claims never call native or retry the claim',async()=>{
 const tasks=[item(),item()];const request=jest.fn(async(_path,_method,body)=>{if(body.action==='claim'){if(body.id===tasks[0].id)throw Error('lost ACK');return {execute:false,status:'executing'};}return {accepted:true,enabled:body.enabled};});
 await mount(tasks,request);await render({requests:[...tasks]});
 await act(async()=>jest.advanceTimersByTime(25000));
 expect(claims()).toHaveLength(2);expect(NativeModules.BobPhoneTools.execute).not.toHaveBeenCalled();expect(NativeModules.BobPhoneTools.getResult).toHaveBeenCalled();
});

test('disable aborts a pending claim even when fetch ignores its signal; preference and availability are disabled',async()=>{
 const claim=deferred<any>();const request=jest.fn(async(_path,_method,body)=>body.action==='claim'?claim.promise:{accepted:true,enabled:body.enabled});
 await mount([item()],request);const signal=claims()[0][4];await act(async()=>api.toggle());
 expect(signal.aborted).toBe(true);expect(api.enabled).toBe(false);expect(NativeModules.BobPhoneTools.setEnabled).toHaveBeenCalledWith('owner',false);
 await act(async()=>claim.resolve({execute:true}));expect(NativeModules.BobPhoneTools.execute).not.toHaveBeenCalled();
 expect(request.mock.calls.some(call=>call[0]==='phone-tools/availability'&&call[2].enabled===false)).toBe(true);
});

test.each(['background','scope','unmount'])('%s invalidates a late claim before native execution',async(reason)=>{
 const claim=deferred<any>(),request=jest.fn(async(_path,_method,body)=>body.action==='claim'?claim.promise:{accepted:true,enabled:body.enabled});
 await mount([item()],request);const signal=claims()[0][4];
 if(reason==='background')await appState('background');
 if(reason==='scope')await render({backend:{...backend,backendId:'other'},chat:2,requests:[]});
 if(reason==='unmount'){await act(async()=>tree!.unmount());tree=undefined;}
 expect(signal.aborted).toBe(true);await act(async()=>claim.resolve({execute:true}));expect(NativeModules.BobPhoneTools.execute).not.toHaveBeenCalled();
});

test('an already-started native result goes to its original source after a chat/backend switch',async()=>{
 const result=deferred<string>();NativeModules.BobPhoneTools.execute.mockReturnValue(result.promise);const request=jest.fn(async(_path,_method,body)=>body.action==='claim'?{execute:true}:{accepted:true,enabled:body.enabled});
 await mount([item()],request);expect(NativeModules.BobPhoneTools.execute).toHaveBeenCalledTimes(1);
 await render({chat:2,backend:{...backend,backendId:'next'},requests:[],request:jest.fn(async()=>({}))});
 await act(async()=>result.resolve('{"status":"ok","data":{"eventId":"kept"}}'));
 expect(request.mock.calls.find(call=>call[2]?.action==='result')?.slice(0,4)).toEqual(['chats/1/phone-tools','POST',expect.objectContaining({result:{status:'ok',data:{eventId:'kept'}}}),backend]);
});

test('native completion in background waits for foreground and never reruns after upload failure',async()=>{
 const result=deferred<string>();NativeModules.BobPhoneTools.execute.mockReturnValue(result.promise);let reject=true;
 const request=jest.fn(async(_path,_method,body)=>{if(body.action==='claim')return {execute:true};if(body.action==='result'&&reject)throw Error('offline');return {accepted:true,enabled:body.enabled};});
 await mount([item()],request);await appState('background');await act(async()=>result.resolve('{"status":"ok","data":{"id":"saved"}}'));expect(results()).toHaveLength(0);
 await appState('active');expect(results()).toHaveLength(1);reject=false;
 await act(async()=>jest.advanceTimersByTime(25000));expect(results()).toHaveLength(2);expect(results()[0][2]).toEqual(results()[1][2]);expect(NativeModules.BobPhoneTools.execute).toHaveBeenCalledTimes(1);expect(claims()).toHaveLength(1);
});

test('a result is retained across unmount and uploaded to the original source, not a later fixture',async()=>{
 const result=deferred<string>();NativeModules.BobPhoneTools.execute.mockReturnValue(result.promise);const request=jest.fn(async(_path,_method,body)=>body.action==='claim'?{execute:true}:{accepted:true,enabled:body.enabled});
 await mount([item()],request);await act(async()=>tree!.unmount());tree=undefined;
 await act(async()=>result.resolve('{"status":"launched"}'));
 expect(request.mock.calls.some(call=>call[0]==='chats/1/phone-tools'&&call[2]?.action==='result')).toBe(true);
});

test('stale initial preference cannot enable a new scope or override an explicit disable',async()=>{
 const initial=deferred<boolean>();NativeModules.BobPhoneTools.enabled.mockReturnValueOnce(initial.promise);
 await mount();expect(api.enabled).toBe(false);
 await render({backend:{...backend,backendId:'second'},requests:[]});await act(async()=>api.toggle());expect(api.enabled).toBe(false);
 await act(async()=>initial.resolve(true));expect(api.enabled).toBe(false);expect(NativeModules.BobPhoneTools.setEnabled).toHaveBeenCalledWith('second',false);
});

test('default stays off until preference known; enable asks missing permissions once and denial does not block unrelated tools',async()=>{
 NativeModules.BobPhoneTools.enabled.mockResolvedValue(false);jest.mocked(PermissionsAndroid.check).mockResolvedValue(false);
 await mount();expect(api.enabled).toBe(false);expect(PermissionsAndroid.requestMultiple).not.toHaveBeenCalled();
 await act(async()=>{await Promise.all([api.toggle(),api.toggle()]);});
 expect(PermissionsAndroid.requestMultiple).toHaveBeenCalledTimes(1);expect(PermissionsAndroid.requestMultiple).toHaveBeenCalledWith([PermissionsAndroid.PERMISSIONS.READ_CALENDAR,PermissionsAndroid.PERMISSIONS.WRITE_CALENDAR,PermissionsAndroid.PERMISSIONS.READ_CONTACTS,PermissionsAndroid.PERMISSIONS.CAMERA]);
 expect(api.enabled).toBe(true);expect(api.permissions).toContain('0/4');
 await render({requests:[item({action:'timer_set',parameters:{seconds:30}})]});expect(NativeModules.BobPhoneTools.execute).toHaveBeenCalledTimes(1);
});

test('background cancels permission-enable continuation and resume rereads native preference',async()=>{
 NativeModules.BobPhoneTools.enabled.mockResolvedValue(false);jest.mocked(PermissionsAndroid.check).mockResolvedValue(false);const decision=deferred<any>();jest.mocked(PermissionsAndroid.requestMultiple).mockReturnValue(decision.promise);
 await mount();let toggle!:Promise<void>;await act(async()=>{toggle=api.toggle();});await appState('background');
 await act(async()=>{decision.resolve({});await toggle;});expect(NativeModules.BobPhoneTools.setEnabled).not.toHaveBeenCalled();
 await appState('active');expect(NativeModules.BobPhoneTools.enabled).toHaveBeenCalledTimes(2);expect(api.busy).toBe(false);
});

test('availability heartbeat runs only enabled and foreground, reopening refreshes without permission prompts',async()=>{
 await mount();const count=()=>props.request.mock.calls.filter(call=>call[0]==='phone-tools/availability'&&call[2].enabled).length;
 const initial=count();await act(async()=>jest.advanceTimersByTime(25000));expect(count()).toBe(initial+1);
 await appState('background');const paused=count();await act(async()=>jest.advanceTimersByTime(50000));expect(count()).toBe(paused);
 await appState('active');expect(count()).toBe(paused+1);expect(PermissionsAndroid.requestMultiple).not.toHaveBeenCalled();
});

test('executing snapshots recover a persisted receipt without claiming or executing again',async()=>{
 NativeModules.BobPhoneTools.getResult.mockResolvedValue('{"status":"ok","data":{"receipt":"persisted"}}');
 const task=item({status:'executing'});await mount([task]);expect(claims()).toHaveLength(0);expect(NativeModules.BobPhoneTools.execute).not.toHaveBeenCalled();
 expect(NativeModules.BobPhoneTools.getResult).toHaveBeenCalledWith('owner',task.id);expect(results()[0][2].result).toEqual({status:'ok',data:{receipt:'persisted'}});
});

test('uncertain claim only reads receipt on a later reconciliation and uploads known result',async()=>{
 NativeModules.BobPhoneTools.getResult.mockResolvedValue('{"status":"launched"}');
 const request=jest.fn(async(_path,_method,body)=>{if(body.action==='claim')throw Error('lost ACK');return {accepted:true,enabled:body.enabled};});await mount([item()],request);
 expect(NativeModules.BobPhoneTools.getResult).not.toHaveBeenCalled();await act(async()=>jest.advanceTimersByTime(25000));
 expect(NativeModules.BobPhoneTools.execute).not.toHaveBeenCalled();expect(claims()).toHaveLength(1);expect(results()[0][2].result).toEqual({status:'launched'});
});

test('invalid native results and native rejection are uncertain, never fabricated receipts or repeated mutations',async()=>{
 NativeModules.BobPhoneTools.execute.mockResolvedValueOnce('not json').mockRejectedValueOnce(Error('bridge lost'));
 const tasks=[item(),item()];await mount(tasks);await render({requests:[...tasks]});
 expect(results()).toHaveLength(0);expect(api.error).toContain('No valid native receipt');expect(NativeModules.BobPhoneTools.execute).toHaveBeenCalledTimes(2);
});

test('malformed, oversized, expired and unknown actions never reach claim or native',async()=>{
 const valid=item(),bad=[null,{}, {...valid,id:'bad'},{...valid,action:'contacts_delete'},{...valid,status:'ok'},{...valid,parameters:[]},{...valid,expiresAt:Date.now()-1},{...valid,expiresAt:Date.now()+100000},{...valid,parameters:{text:'x'.repeat(32769)}},{...valid,parameters:{value:NaN}}];
 bad.forEach(value=>expect(validatePhoneToolRequest(value)).toBeUndefined());expect(validatePhoneToolRequest(valid)).toEqual(valid);
 await mount(bad as PhoneToolRequest[]);expect(claims()).toHaveLength(0);expect(NativeModules.BobPhoneTools.execute).not.toHaveBeenCalled();
});

test('a same-scope initial preference read cannot overwrite a later explicit enable',async()=>{
 const initial=deferred<boolean>();NativeModules.BobPhoneTools.enabled.mockReturnValueOnce(initial.promise);
 await mount();await act(async()=>api.toggle());expect(api.enabled).toBe(true);
 await act(async()=>initial.resolve(false));expect(api.enabled).toBe(true);
});

test('failed disable remains locally locked and a second Disable retries saving, never enables',async()=>{
 NativeModules.BobPhoneTools.setEnabled.mockRejectedValueOnce(Error('disk busy'));
 await mount();await act(async()=>api.toggle());expect(api.error).toContain('disabled preference');
 await render({requests:[item()]});expect(NativeModules.BobPhoneTools.execute).not.toHaveBeenCalled();
 await act(async()=>api.refresh());expect(NativeModules.BobPhoneTools.execute).not.toHaveBeenCalled();
 await act(async()=>api.toggle());expect(NativeModules.BobPhoneTools.setEnabled.mock.calls).toEqual([['owner',false],['owner',false]]);expect(api.enabled).toBe(false);
});

test('a claim ACK received after request expiry never starts native execution',async()=>{
 const claim=deferred<any>(),request=jest.fn(async(_path,_method,body)=>body.action==='claim'?claim.promise:{accepted:true,enabled:body.enabled});
 await mount([item({expiresAt:Date.now()+100})],request);
 await act(async()=>{jest.advanceTimersByTime(101);claim.resolve({execute:true});});
 expect(NativeModules.BobPhoneTools.execute).not.toHaveBeenCalled();
});

test('oversized native results and malformed stored receipts are not uploaded as fabricated native receipts',async()=>{
 NativeModules.BobPhoneTools.execute.mockResolvedValue(JSON.stringify({status:'ok',data:{text:'☃'.repeat(22000)}}));
 NativeModules.BobPhoneTools.getResult.mockResolvedValue('invalid stored JSON');
 await mount([item(),item({status:'executing'})]);
 expect(results()).toHaveLength(0);expect(api.error).toContain('No valid native receipt');
});

test('permission checks resolving after a scope switch do not prompt on behalf of the old scope',async()=>{
 NativeModules.BobPhoneTools.enabled.mockResolvedValue(false);await mount();
 const check=deferred<boolean>();jest.mocked(PermissionsAndroid.check).mockReturnValue(check.promise);
 let toggle!:Promise<void>;await act(async()=>{toggle=api.toggle();});await render({backend:undefined,requests:[]});
 await act(async()=>{check.resolve(false);await toggle;});
 expect(PermissionsAndroid.requestMultiple).not.toHaveBeenCalled();expect(NativeModules.BobPhoneTools.setEnabled).not.toHaveBeenCalled();
});

test('callbacks retained from a prior scope cannot operate the new scope, even after switching back',async()=>{
 await mount();const old={toggle:api.toggle,refresh:api.refresh,permissions:api.requestPermissions};
 await render({chat:2});await render({chat:1});const reads=NativeModules.BobPhoneTools.enabled.mock.calls.length;
 await act(async()=>{await old.toggle();await old.refresh();await old.permissions();});
 expect(NativeModules.BobPhoneTools.setEnabled).not.toHaveBeenCalled();expect(PermissionsAndroid.requestMultiple).not.toHaveBeenCalled();expect(NativeModules.BobPhoneTools.enabled).toHaveBeenCalledTimes(reads);
});

test('native bridge rejection can later recover the actual persisted receipt without execute',async()=>{
 NativeModules.BobPhoneTools.execute.mockRejectedValue(Error('bridge lost'));
 await mount([item()]);expect(results()).toHaveLength(0);expect(NativeModules.BobPhoneTools.execute).toHaveBeenCalledTimes(1);
 NativeModules.BobPhoneTools.getResult.mockResolvedValue('{"status":"ok","data":{"id":"recovered"}}');
 await act(async()=>jest.advanceTimersByTime(25000));
 expect(results()[0][2].result).toEqual({status:'ok',data:{id:'recovered'}});expect(NativeModules.BobPhoneTools.execute).toHaveBeenCalledTimes(1);
});

test('negative result ACK retries only the identical receipt, without another action',async()=>{
 let accepted=false;const request=jest.fn(async(_path,_method,body)=>body.action==='claim'?{execute:true}:{accepted,enabled:body.enabled});
 await mount([item()],request);expect(results()).toHaveLength(1);accepted=true;
 await act(async()=>jest.advanceTimersByTime(25000));expect(results()).toHaveLength(2);expect(results()[0][2]).toEqual(results()[1][2]);expect(NativeModules.BobPhoneTools.execute).toHaveBeenCalledTimes(1);
});

test.each(['clipboard_write','share_text'])('%s accepts 20k Unicode text and stays within the native UTF-8 request limit',async action=>{
 const task=item({action,parameters:{text:'界'.repeat(20000),...(action==='share_text'?{title:'T'.repeat(500)}:{})}});
 expect(validatePhoneToolRequest(task)).toEqual(task);await mount([task]);
 expect(NativeModules.BobPhoneTools.execute).toHaveBeenCalledTimes(1);
 expect(JSON.parse(NativeModules.BobPhoneTools.execute.mock.calls[0][1]).parameters).toEqual(task.parameters);
});

test('request budget accommodates 20k escaped characters and rejects oversized combined UTF-8 envelopes',()=>{
 expect(validatePhoneToolRequest(item({action:'clipboard_write',parameters:{text:'\u0000'.repeat(20000)}}))).toBeDefined();
 expect(validatePhoneToolRequest(item({parameters:{a:'界'.repeat(20000),b:'界'.repeat(20000)}}))).toBeDefined();
 expect(validatePhoneToolRequest(item({parameters:{a:'界'.repeat(20000),b:'界'.repeat(20000),c:'界'.repeat(20000)}}))).toBeUndefined();
 expect(validatePhoneToolRequest(item({parameters:{text:'x'.repeat(20001)}}))).toBeUndefined();
});

test('same-backend chat switches never send a stale cleanup false after the replacement availability',async()=>{
 await mount();const request=props.request;request.mockClear();
 await render({chat:2});await render({chat:3});
 const writes=request.mock.calls.filter(call=>call[0]==='phone-tools/availability').map(call=>call[2].enabled);
 expect(writes).toEqual([true,true]);
});

test('a delayed background false is acknowledged before replacement true and pending claims',async()=>{
 const stopped=deferred<any>();
 const request=jest.fn(async(path,_method,body)=>path==='phone-tools/availability'?(body.enabled?{enabled:true}:stopped.promise):body.action==='claim'?{execute:true}:{accepted:true,enabled:body.enabled});
 await mount([],request);await appState('background');
 await render({chat:2,requests:[item()]});await appState('active');
 expect(request.mock.calls.filter(call=>call[0]==='phone-tools/availability').map(call=>call[2].enabled)).toEqual([true,false]);
 expect(claims()).toHaveLength(0);
 await act(async()=>stopped.resolve({enabled:false}));
 expect(request.mock.calls.filter(call=>call[0]==='phone-tools/availability').map(call=>call[2].enabled)).toEqual([true,false,true]);
 expect(claims()).toHaveLength(1);expect(NativeModules.BobPhoneTools.execute).toHaveBeenCalledTimes(1);
});

test('initial requests wait for availability ACK instead of consuming their one claim while unavailable',async()=>{
 const ready=deferred<any>();
 const request=jest.fn(async(path,_method,body)=>path==='phone-tools/availability'?ready.promise:body.action==='claim'?{execute:true}:{accepted:true});
 await mount([item()],request);expect(api.enabled).toBe(true);expect(claims()).toHaveLength(0);
 await act(async()=>ready.resolve({enabled:true}));expect(claims()).toHaveLength(1);expect(NativeModules.BobPhoneTools.execute).toHaveBeenCalledTimes(1);
});


test('a stalled background availability write times out and cannot wedge resumed controls or Refresh',async()=>{
 const never=new Promise<any>(()=>{});let blocked=false;
 const request=jest.fn(async(path,_method,body,_backend?:unknown,_signal?:AbortSignal)=>{if(path==='phone-tools/availability'){if(!body.enabled&&!blocked){blocked=true;return never;}return {enabled:body.enabled};}return body.action==='claim'?{execute:true}:{accepted:true};});
 await mount([],request);await appState('background');
 const falseWrite=request.mock.calls.find(call=>call[0]==='phone-tools/availability'&&call[2].enabled===false)!;
 await render({requests:[item()]});await appState('active');expect(claims()).toHaveLength(0);
 await act(async()=>jest.advanceTimersByTime(20001));
 expect(falseWrite[4]!.aborted).toBe(true);
 expect(request.mock.calls.filter(call=>call[0]==='phone-tools/availability').map(call=>call[2].enabled)).toEqual([true,false,true]);
 expect(claims()).toHaveLength(1);expect(NativeModules.BobPhoneTools.execute).toHaveBeenCalledTimes(1);
 await act(async()=>api.refresh());expect(api.busy).toBe(false);expect(claims()).toHaveLength(1);
});

test('a stalled claim is bounded but never resent or executed after its late acknowledgement',async()=>{
 const late=deferred<any>(),request=jest.fn(async(path,_method,body)=>body.action==='claim'?late.promise:{accepted:true,enabled:body.enabled});
 await mount([item()],request);const signal=claims()[0][4];
 await act(async()=>jest.advanceTimersByTime(20001));expect(signal.aborted).toBe(true);
 await act(async()=>late.resolve({execute:true,status:'executing'}));
 await act(async()=>api.refresh());await act(async()=>jest.advanceTimersByTime(25000));
 expect(claims()).toHaveLength(1);expect(NativeModules.BobPhoneTools.execute).not.toHaveBeenCalled();
});
