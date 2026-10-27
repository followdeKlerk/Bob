import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {useStoredHistory,mergeLatestHistory} from '../stored-history';
import {readHistoryCache,writeHistoryCache} from '../history-cache';
jest.mock('../../../src/contracts',()=>jest.requireActual('../../../packages/core/src/contracts'));
jest.mock('../history-cache',()=>({readHistoryCache:jest.fn(),writeHistoryCache:jest.fn().mockResolvedValue(undefined)}));
const backend='11111111-1111-4111-8111-111111111111';
const page=(chat=781,ids=[2,3],next:string|undefined=undefined)=>({backendId:backend,conversationId:chat,coverage:'stored-entries' as const,items:ids.map(id=>({id,kind:'bob.user',data:{text:`Message ${id}`}})),next});
let history!:ReturnType<typeof useStoredHistory>;
function Harness({chat=781,request}:{chat?:number;request:(path:string)=>Promise<unknown>}){history=useStoredHistory(backend,chat,request);return null;}
beforeEach(()=>{jest.clearAllMocks();(readHistoryCache as jest.Mock).mockResolvedValue(undefined);});
test('opening a conversation automatically restores authoritative history even when the cache read fails',async()=>{
 (readHistoryCache as jest.Mock).mockRejectedValue(Error('Oversized cache row'));
 const request=jest.fn().mockResolvedValue(page());let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<Harness request={request}/>);});
 expect(request).toHaveBeenCalledWith('chats/781/history',expect.anything());expect(history.page?.items.map(item=>item.id)).toEqual([2,3]);expect(history.ready).toBe(true);expect(history.error).toBeUndefined();
 await act(async()=>tree.unmount());
});
test('cached messages remain visible while a fresh page loads, then merge with new messages',async()=>{
 (readHistoryCache as jest.Mock).mockResolvedValue(JSON.stringify(page(781,[1,2],'older')));
 let resolve!:(value:unknown)=>void;const request=jest.fn(()=>new Promise<unknown>(done=>{resolve=done;}));let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<Harness request={request}/>);});
 expect(history.page?.items.map(item=>item.id)).toEqual([1,2]);expect(history.loading).toBe(true);
 await act(async()=>resolve(page(781,[2,3],'new-page-cursor')));
 expect(history.page?.items.map(item=>item.id)).toEqual([1,2,3]);expect(history.page?.next).toBe('older');expect(writeHistoryCache).toHaveBeenCalled();
 await act(async()=>tree.unmount());
});
test('old conversation responses cannot overwrite a newly selected conversation',async()=>{
 let finishOld!:(value:unknown)=>void;const request=jest.fn((path:string)=>path==='chats/781/history'?new Promise<unknown>(resolve=>{finishOld=resolve;}):Promise.resolve(page(782,[20,21])));let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<Harness request={request}/>);});
 await act(async()=>tree.update(<Harness chat={782} request={request}/>));
 await act(async()=>finishOld(page(781,[2,3])));
 expect(history.page?.conversationId).toBe(782);expect(history.page?.items.map(item=>item.id)).toEqual([20,21]);
 await act(async()=>tree.unmount());
});
test('network failure exposes a retry state without clearing cached messages',async()=>{
 (readHistoryCache as jest.Mock).mockResolvedValue(JSON.stringify(page()));
 const request=jest.fn().mockRejectedValueOnce(Error('Backend offline')).mockResolvedValue(page(781,[2,3,4]));let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<Harness request={request}/>);});
 expect(history.page?.items).toHaveLength(2);expect(history.error).toBe('Backend offline');expect(history.loading).toBe(false);
 await act(async()=>history.refresh());expect(history.error).toBeUndefined();expect(history.page?.items).toHaveLength(3);
 await act(async()=>tree.unmount());
});
test('loading earlier messages uses the stored cursor and retains newer messages',async()=>{
 const request=jest.fn().mockResolvedValueOnce(page(781,[3,4],'older cursor')).mockResolvedValueOnce(page(781,[1,2]));let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<Harness request={request}/>);});await act(async()=>history.load());
 expect(request).toHaveBeenLastCalledWith('chats/781/history?cursor=older%20cursor',expect.anything());expect(history.page?.items.map(item=>item.id)).toEqual([1,2,3,4]);
 await act(async()=>tree.unmount());
});
test('refresh does not skip an unseen middle range when more than one page arrived while offline',()=>{
 const result=mergeLatestHistory(page(781,[1,2],'very old'),page(781,[200,201],'middle-range'));
 expect(result.items.map(item=>item.id)).toEqual([200,201]);expect(result.next).toBe('middle-range');
});

test('an unchanged resume refresh preserves the page and immutable message objects',async()=>{
 const first=page(781,[1,2,3],'older');expect(mergeLatestHistory(first,JSON.parse(JSON.stringify(first)))).toBe(first);
 const request=jest.fn(async()=>JSON.parse(JSON.stringify(first)));let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<Harness request={request}/>);});
 const original=history.page;await act(async()=>history.refresh());expect(request).toHaveBeenCalledTimes(2);expect(history.page).toBe(original);expect(history.page?.items[0]).toBe(original?.items[0]);await act(async()=>tree.unmount());
});
test('a refresh appends genuinely new messages without replacing the existing cells',()=>{
 const original=page(781,[1,2,3],'older'),result=mergeLatestHistory(original,page(781,[2,3,4],'new-cursor'));
 expect(result.items.map(item=>item.id)).toEqual([1,2,3,4]);expect(result.items[0]).toBe(original.items[0]);expect(result.items[1]).toBe(original.items[1]);expect(result.items[2]).toBe(original.items[2]);expect(result.next).toBe('older');
});

test('a foreground history failure retries automatically without clearing the cached conversation or blinking its error',async()=>{
 jest.useFakeTimers();const random=jest.spyOn(Math,'random').mockReturnValue(0.5);
 (readHistoryCache as jest.Mock).mockResolvedValue(JSON.stringify(page()));let complete!:(value:unknown)=>void;
 const request=jest.fn().mockRejectedValueOnce(Error('Backend offline')).mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));let tree!:Renderer.ReactTestRenderer;
 try{
  await act(async()=>{tree=Renderer.create(<Harness request={request}/>);});const cached=history.page;
  expect(history.error).toBe('Backend offline');await act(async()=>jest.advanceTimersByTime(1000));
  expect(request).toHaveBeenCalledTimes(2);expect(history.page).toBe(cached);expect(history.loading).toBe(true);expect(history.error).toBe('Backend offline');
  await act(async()=>complete(page(781,[2,3,4])));expect(history.error).toBeUndefined();expect(history.page?.items.map(item=>item.id)).toEqual([2,3,4]);
 }finally{await act(async()=>tree?.unmount());random.mockRestore();jest.useRealTimers();}
});
test('authorization failure does not create an endless history retry loop',async()=>{
 jest.useFakeTimers();const request=jest.fn().mockRejectedValue(Object.assign(Error('Pair again'),{httpStatus:401}));let tree!:Renderer.ReactTestRenderer;
 try{await act(async()=>{tree=Renderer.create(<Harness request={request}/>);});await act(async()=>jest.advanceTimersByTime(60000));expect(request).toHaveBeenCalledTimes(1);expect(history.error).toBe('Pair again');}
 finally{await act(async()=>tree?.unmount());jest.useRealTimers();}
});
test('changing conversations cancels an old pending history retry',async()=>{
 jest.useFakeTimers();const request=jest.fn(async(path:string)=>{if(path.includes('/781/'))throw Error('Offline');return page(782,[20]);});let tree!:Renderer.ReactTestRenderer;
 try{await act(async()=>{tree=Renderer.create(<Harness request={request}/>);});await act(async()=>tree.update(<Harness chat={782} request={request}/>));await act(async()=>jest.advanceTimersByTime(30000));expect(request).toHaveBeenCalledTimes(2);expect(history.page?.conversationId).toBe(782);}
 finally{await act(async()=>tree?.unmount());jest.useRealTimers();}
});
test('history refresh and reconnection cannot bypass a server Retry-After instruction',async()=>{
 jest.useFakeTimers();const request=jest.fn().mockRejectedValueOnce(Object.assign(Error('Rate limited'),{httpStatus:429,retryAfterMs:60000})).mockResolvedValue(page());let tree!:Renderer.ReactTestRenderer;
 try{await act(async()=>{tree=Renderer.create(<Harness request={request}/>);});await act(async()=>history.refresh());expect(request).toHaveBeenCalledTimes(1);await act(async()=>jest.advanceTimersByTime(59999));expect(request).toHaveBeenCalledTimes(1);await act(async()=>jest.advanceTimersByTime(1));expect(request).toHaveBeenCalledTimes(2);expect(history.error).toBeUndefined();}
 finally{await act(async()=>tree?.unmount());jest.useRealTimers();}
});
