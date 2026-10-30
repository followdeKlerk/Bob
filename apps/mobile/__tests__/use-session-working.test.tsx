import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {AppState} from 'react-native';
import {useSessionWorking,workingSessions} from '../use-session-working';
jest.mock('react-native/Libraries/AppState/AppState',()=>({__esModule:true,default:{currentState:'active',addEventListener:jest.fn(()=>({remove:jest.fn()}))}}));

const backend={backendId:'one',endpoint:'https://one.ts.net'};
const status=(id='one',tasks=[{record:{conversationId:8,background:false}}],submissions:{conversationId:number}[]=[])=>({backendId:id,inspection:{tasks,submissions}});
let tree:Renderer.ReactTestRenderer|undefined,ids:ReadonlySet<number>;
const request=jest.fn();
function Probe({target=backend,visible=true}:{target?:typeof backend;visible?:boolean}){
 ids=useSessionWorking(target,visible,request);return null;
}
const mount=async(visible=true)=>{await act(async()=>{tree=Renderer.create(<Probe visible={visible}/>);});};
beforeEach(()=>{jest.useFakeTimers();request.mockReset();request.mockResolvedValue(status());jest.replaceProperty(AppState,'currentState','active');});
afterEach(async()=>{await act(async()=>tree?.unmount());tree=undefined;jest.restoreAllMocks();jest.useRealTimers();});

test('uses per-conversation unfinished foreground tasks and queued submissions, not background watchers',()=>{
 expect([...workingSessions(status('one',[{record:{conversationId:7,background:true}},{record:{conversationId:8,background:false}},{record:{conversationId:8,background:false}}],[{conversationId:9}]))]).toEqual([8,9]);
 expect([...workingSessions(status('one',[]))]).toEqual([]);
});
test('only polls while visible; settled work clears the next poll and hiding stops polling',async()=>{
 await mount(false);expect(request).not.toHaveBeenCalled();
 await act(async()=>tree!.update(<Probe/>));expect([...ids]).toEqual([8]);
 request.mockResolvedValue(status('one',[]));await act(async()=>jest.advanceTimersByTime(3000));expect([...ids]).toEqual([]);
 await act(async()=>tree!.update(<Probe visible={false}/>));
 expect((request.mock.calls[0][0] as AbortSignal).aborted).toBe(false);
 const calls=request.mock.calls.length;await act(async()=>jest.advanceTimersByTime(15000));expect(request).toHaveBeenCalledTimes(calls);
});
test('late status from another backend cannot set working flags; identity mismatch clears them',async()=>{
 let resolve!:(value:ReturnType<typeof status>)=>void;
 request.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));await mount();
 const oldSignal=request.mock.calls[0][0] as AbortSignal;
 request.mockResolvedValue(status('two',[{record:{conversationId:9,background:false}}]));
 await act(async()=>tree!.update(<Probe target={{backendId:'two',endpoint:'https://two.ts.net'}}/>));
 expect(oldSignal.aborted).toBe(true);expect([...ids]).toEqual([9]);
 await act(async()=>resolve(status()));expect([...ids]).toEqual([9]);
 request.mockResolvedValue(status());await act(async()=>jest.advanceTimersByTime(3000));expect([...ids]).toEqual([]);
});
test('backgrounding cancels an in-flight read and resume fetches fresh status',async()=>{
 let listener!:(state:any)=>void;
 jest.spyOn(AppState,'addEventListener').mockImplementation((_event,callback)=>{listener=callback;return{remove:jest.fn()};});
 await mount();expect([...ids]).toEqual([8]);
 let resolve!:(value:ReturnType<typeof status>)=>void;
 request.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
 await act(async()=>jest.advanceTimersByTime(3000));const signal=request.mock.calls[1][0] as AbortSignal;
 act(()=>{jest.replaceProperty(AppState,'currentState','background');listener('background');});expect(signal.aborted).toBe(true);expect([...ids]).toEqual([]);
 await act(async()=>resolve(status()));expect([...ids]).toEqual([]);
 const calls=request.mock.calls.length;await act(async()=>jest.advanceTimersByTime(15000));expect(request).toHaveBeenCalledTimes(calls);
 await act(async()=>{jest.replaceProperty(AppState,'currentState','active');listener('active');});expect([...ids]).toEqual([8]);
});
test('failed or malformed reads clear stale working flags and retry without changing history',async()=>{
 await mount();request.mockRejectedValueOnce(Error('Offline'));
 await act(async()=>jest.advanceTimersByTime(3000));expect([...ids]).toEqual([]);
 await act(async()=>jest.advanceTimersByTime(3000));expect([...ids]).toEqual([8]);
 request.mockResolvedValueOnce({backendId:'one'});await act(async()=>jest.advanceTimersByTime(3000));expect([...ids]).toEqual([]);
});
