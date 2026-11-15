import {cacheGeneration} from '../download-cache';
jest.mock('../download-cache',()=>({cacheGeneration:jest.fn(()=>0)}));
import {snapshotPersistence} from '../snapshot-persistence';
jest.mock('../history-cache',()=>({writeHistoryCache:jest.fn(async()=>{})}));
beforeEach(()=>{(cacheGeneration as jest.Mock).mockReturnValue(0);jest.useFakeTimers();jest.setSystemTime(0);});
afterEach(()=>jest.useRealTimers());
test('fast partial updates retain only the latest snapshot before serialization',async()=>{
 const write=jest.fn(async()=>{}),cache=snapshotPersistence('history:a',write);
 const serialize=jest.fn(()=>({text:'latest'}));
 for(let i=0;i<40;i++)cache.push({text:String(i)});
 cache.push({toJSON:serialize});expect(write).not.toHaveBeenCalled();expect(serialize).not.toHaveBeenCalled();
 await jest.advanceTimersByTimeAsync(1000);
 expect(write).toHaveBeenCalledTimes(1);expect(write).toHaveBeenLastCalledWith('history:a','{"text":"latest"}',expect.any(Number));expect(serialize).toHaveBeenCalledTimes(1);
 await cache.close();expect(jest.getTimerCount()).toBe(0);
});
test('a slow write cannot build an unbounded queue, and final/close flush the newest value',async()=>{
 let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 const write=jest.fn().mockImplementationOnce(()=>gate).mockResolvedValue(undefined),cache=snapshotPersistence('history:b',write);
 cache.push({text:'first'},true);await Promise.resolve();
 for(let i=0;i<50;i++)cache.push({text:String(i)});
 cache.push({text:'final'},true);expect(write).toHaveBeenCalledTimes(1);
 const closing=cache.close();release();await closing;
 expect(write).toHaveBeenCalledTimes(2);expect(write).toHaveBeenLastCalledWith('history:b','{"text":"final"}',expect.any(Number));
 cache.push({text:'too late'},true);await Promise.resolve();expect(write).toHaveBeenCalledTimes(2);expect(jest.getTimerCount()).toBe(0);
});
test('scopes stay separate, background flush is immediate, and cache failures do not reject',async()=>{
 const write=jest.fn(async(_key:string,_value:string)=>{throw Error('offline cache failure');});
 const a=snapshotPersistence('a',write),b=snapshotPersistence('b',write);
 a.push({text:'A'});b.push({text:'B'});await a.flush();await b.close();await a.close();
 expect(write.mock.calls.map(call=>call[0])).toEqual(['a','b']);expect(jest.getTimerCount()).toBe(0);
});

 test('a pending snapshot keeps its producer epoch instead of borrowing the later flush epoch',async()=>{
  const write=jest.fn(async()=>{}),cache=snapshotPersistence('history:alpha:1',write);
  (cacheGeneration as jest.Mock).mockReturnValue(7);cache.push({text:'admitted before clear'});
  (cacheGeneration as jest.Mock).mockReturnValue(8);await cache.flush();
  expect(write).toHaveBeenLastCalledWith('history:alpha:1','{"text":"admitted before clear"}',7);
  cache.push({text:'admitted after clear'});await cache.close();
  expect(write).toHaveBeenLastCalledWith('history:alpha:1','{"text":"admitted after clear"}',8);
 });
