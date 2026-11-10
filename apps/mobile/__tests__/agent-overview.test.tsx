jest.mock('react-native/Libraries/AppState/AppState',()=>({__esModule:true,default:{currentState:'active',addEventListener:jest.fn(()=>({remove:jest.fn()}))}}));
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {AppState} from 'react-native';
import {useAgentOverview,type AgentOverviewPage,type SessionFilter} from '../use-agent-overview';
const a={backendId:'a',endpoint:'https://a.test'},b={backendId:'b',endpoint:'https://b.test'};
const page=(backendId='a',id=7,next?:string):AgentOverviewPage=>({backendId,sessions:[{conversationId:id,title:'Session '+id,status:'working',agents:[{name:'Helper',conversationId:id+1,status:'working'}]}],next});
const deferred=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};};
let latest!:ReturnType<typeof useAgentOverview>,lifecycle:(state:any)=>void;
function Probe({backend=a,visible=true,request,filter}:{backend?:typeof a;visible?:boolean;filter?:SessionFilter;request:(path:string,signal:AbortSignal)=>Promise<AgentOverviewPage>}){latest=useAgentOverview(backend,visible,request,filter);return null;}
beforeEach(()=>{
 jest.useFakeTimers();jest.replaceProperty(AppState,'currentState','active');
 jest.spyOn(AppState,'addEventListener').mockImplementation((_event,callback)=>{lifecycle=callback;return {remove:jest.fn()};});
});
afterEach(()=>{jest.useRealTimers();jest.restoreAllMocks();});
test('metadata polling only runs while visible and foreground; hidden results cannot cross scope',async()=>{
 const old=deferred<AgentOverviewPage>(),request=jest.fn().mockReturnValueOnce(old.promise).mockResolvedValue(page('b',20));let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<Probe request={request} visible={false}/>);});expect(request).not.toHaveBeenCalled();
 await act(async()=>tree.update(<Probe request={request}/>));const signal=request.mock.calls[0][1] as AbortSignal;
 await act(async()=>tree.update(<Probe backend={b} request={request}/>));expect(signal.aborted).toBe(true);expect(latest.sessions[0].conversationId).toBe(20);
 await act(async()=>old.resolve(page('a')));expect(latest.sessions[0].conversationId).toBe(20);
 await act(async()=>tree.update(<Probe backend={b} visible={false} request={request}/>));expect(latest.sessions).toEqual([]);
 const count=request.mock.calls.length;await act(async()=>jest.advanceTimersByTime(10000));expect(request).toHaveBeenCalledTimes(count);
 await act(async()=>tree.unmount());
});
test('cursor continuation and periodic refresh keep multiple session groups without per-row streams',async()=>{
 const request=jest.fn(async(path:string)=>path.includes('?cursor=')?page('a',20):page('a',7,'older token'));
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<Probe request={request}/>);});
 expect(latest.sessions.map(s=>s.conversationId)).toEqual([7]);expect(latest.next).toBe('older token');
 await act(async()=>latest.loadMore());expect(latest.sessions.map(s=>s.conversationId)).toEqual([7,20]);
 expect(request.mock.calls.map(call=>call[0])).toContain('agent-overview?cursor=older%20token');
 await act(async()=>jest.advanceTimersByTime(5000));expect(latest.sessions.map(s=>s.conversationId)).toEqual([7,20]);
 expect(request.mock.calls.every(call=>call[0].startsWith('agent-overview'))).toBe(true);
 await act(async()=>tree.unmount());
});
test('failed refresh marks retained statuses unknown and offers explicit retry',async()=>{
 const request=jest.fn().mockResolvedValueOnce(page()).mockRejectedValueOnce(Error('offline')).mockResolvedValue(page());let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<Probe request={request}/>);});
 await act(async()=>jest.advanceTimersByTime(5000));expect(latest.error).toContain('Could not refresh');expect(latest.sessions[0].status).toBe('unknown');expect(latest.sessions[0].agents[0].status).toBe('unknown');
 await act(async()=>latest.retry());expect(latest.error).toBeUndefined();expect(latest.sessions[0].status).toBe('working');
 await act(async()=>tree.unmount());
});
test('backend identity mismatch and malformed rows are not accepted as session evidence',async()=>{
 for(const result of [page('other'),{...page(),sessions:[{...page().sessions[0],agents:[{name:'Bad',conversationId:-1,status:'working'}]}]}]){
  const request=jest.fn().mockResolvedValue(result);let tree!:Renderer.ReactTestRenderer;
  await act(async()=>{tree=Renderer.create(<Probe request={request}/>);});expect(latest.sessions).toEqual([]);expect(latest.error).toBeDefined();
  await act(async()=>tree.unmount());
 }
});
test('background aborts an in-flight request and foreground renews without late overwrite',async()=>{
 const pending=deferred<AgentOverviewPage>(),request=jest.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(page('a',30));let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<Probe request={request}/>);});const signal=request.mock.calls[0][1] as AbortSignal;
 await act(async()=>{jest.replaceProperty(AppState,'currentState','background');lifecycle('background');});expect(signal.aborted).toBe(true);
 await act(async()=>{jest.replaceProperty(AppState,'currentState','active');lifecycle('active');});expect(latest.sessions[0].conversationId).toBe(30);
 await act(async()=>pending.resolve(page('a',7)));expect(latest.sessions[0].conversationId).toBe(30);
 await act(async()=>tree.unmount());
});

test('filter switching cancels old responses, resets pagination and scopes archived/trash evidence',async()=>{
 const pending=deferred<AgentOverviewPage>(),request=jest.fn().mockResolvedValueOnce(page('a',7,'older')).mockReturnValueOnce(pending.promise).mockResolvedValue({...page('a',20),sessions:[{...page('a',20).sessions[0],trashed:true}]});let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<Probe request={request} filter="all"/>);});expect(request.mock.calls[0][0]).toBe('agent-overview?filter=all');
 await act(async()=>tree.update(<Probe request={request} filter="archived"/>));expect(latest.sessions).toEqual([]);const signal=request.mock.calls[1][1];
 await act(async()=>tree.update(<Probe request={request} filter="trash"/>));expect(signal.aborted).toBe(true);expect(request.mock.calls[2][0]).toBe('agent-overview?filter=trash');expect(latest.sessions[0].trashed).toBe(true);
 await act(async()=>pending.resolve(page('a',7)));expect(latest.sessions[0].conversationId).toBe(20);
 await act(async()=>tree.unmount());
});
