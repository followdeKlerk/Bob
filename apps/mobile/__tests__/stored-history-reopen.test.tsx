import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {useStoredHistory,mergeLatestHistory} from '../stored-history';
import {readHistoryCache,writeHistoryCache} from '../history-cache';
jest.mock('../history-cache',()=>({readHistoryCache:jest.fn(),writeHistoryCache:jest.fn().mockResolvedValue(undefined)}));
const backend='11111111-1111-4111-8111-111111111111';
const page=(id:number,ids:number[],next?:string)=>({backendId:backend,conversationId:id,coverage:'stored-entries' as const,items:ids.map(id=>({id,kind:'pi.user',model:[{role:'user',content:'saved message'}]})),...(next?{next}:{})});
let history:ReturnType<typeof useStoredHistory>;
function Probe({id,request}:{id:number;request:(path:string)=>Promise<unknown>}){history=useStoredHistory(backend,id,request);return null;}
beforeEach(()=>{jest.clearAllMocks();(readHistoryCache as jest.Mock).mockResolvedValue(undefined);});
test('cold reopening fetches stored messages even without a live snapshot or usable cache',async()=>{
 (readHistoryCache as jest.Mock).mockRejectedValue(Error('unreadable cache'));
 const request=jest.fn().mockResolvedValue(page(781,[1,2,3]));let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<Probe id={781} request={request}/>);});
 expect(request.mock.calls[0][0]).toBe('chats/781/history');expect(history.page?.items.map(item=>item.id)).toEqual([1,2,3]);
 expect(history.error).toBeUndefined();expect(history.loading).toBe(false);expect(writeHistoryCache).toHaveBeenCalled();
 await act(async()=>tree.unmount());
});
test('switching sessions ignores a delayed response from the previous conversation',async()=>{
 let resolve!:(value:unknown)=>void;
 const request=jest.fn((path:string)=>path.includes('/781/')?new Promise(done=>{resolve=done;}):Promise.resolve(page(772,[20])));
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<Probe id={781} request={request}/>);});
 await act(async()=>{tree.update(<Probe id={772} request={request}/>);});
 await act(async()=>{resolve(page(781,[1]));});
 expect(history.page?.conversationId).toBe(772);expect(history.page?.items.map(item=>item.id)).toEqual([20]);
 await act(async()=>tree.unmount());
});
test('history request failure is visible and refresh retries without clearing cached messages',async()=>{
 (readHistoryCache as jest.Mock).mockResolvedValue(JSON.stringify(page(781,[1])));
 const request=jest.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValue(page(781,[1,2]));let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<Probe id={781} request={request}/>);});
 expect(history.error).toBe('offline');expect(history.page?.items).toHaveLength(1);
 await act(async()=>{await history.refresh();});
 expect(history.error).toBeUndefined();expect(history.page?.items).toHaveLength(2);
 await act(async()=>tree.unmount());
});
test('disjoint newest pages preserve pagination instead of hiding an offline gap',()=>{
 const merged=mergeLatestHistory(page(781,[1,2]),page(781,[10,11],'earlier'));
 expect(merged.items.map(item=>item.id)).toEqual([10,11]);expect(merged.next).toBe('earlier');
});
