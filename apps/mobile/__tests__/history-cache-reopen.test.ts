import AsyncStorage from '@react-native-async-storage/async-storage';
import {readHistoryCache,writeHistoryCache} from '../history-cache';
jest.mock('@react-native-async-storage/async-storage',()=>({getItem:jest.fn(),setItem:jest.fn(),removeItem:jest.fn(),getMany:jest.fn(),setMany:jest.fn(),removeMany:jest.fn()}));
const rows=new Map<string,string>();
beforeEach(()=>{
 jest.clearAllMocks();rows.clear();
 (AsyncStorage.getItem as jest.Mock).mockImplementation(async(key:string)=>rows.get(key)??null);
 (AsyncStorage.setItem as jest.Mock).mockImplementation(async(key:string,value:string)=>{rows.set(key,value);});
 (AsyncStorage.removeItem as jest.Mock).mockImplementation(async(key:string)=>{rows.delete(key);});
 (AsyncStorage.getMany as jest.Mock).mockImplementation(async(keys:string[])=>Object.fromEntries(keys.map(key=>[key,rows.get(key)??null])));
 (AsyncStorage.setMany as jest.Mock).mockImplementation(async(values:Record<string,string>)=>{for(const [key,value] of Object.entries(values))rows.set(key,value);});
 (AsyncStorage.removeMany as jest.Mock).mockImplementation(async(keys:string[])=>{for(const key of keys)rows.delete(key);});
});
test('oversized legacy Android cache read failure is optional, never a rejected reopen dependency',async()=>{
 (AsyncStorage.getItem as jest.Mock).mockRejectedValue(Error('Row too big to fit into CursorWindow'));
 await expect(readHistoryCache('history:backend:781')).resolves.toBeUndefined();
});
test('large conversation round trips through small rows, including Unicode across chunk boundaries',async()=>{
 const value='a'.repeat(59999)+'😀'+'界'.repeat(750000);
 await writeHistoryCache('history:backend:781',value);
 expect([...rows.values()].every(row=>row.length<=60000)).toBe(true);
 for(const row of rows.values())expect(row).not.toMatch(/[\uD800-\uDBFF]$/);
 await expect(readHistoryCache('history:backend:781')).resolves.toBe(value);
});
test('failed cache replacement leaves the previously published history readable',async()=>{
 await writeHistoryCache('history:test','previous transcript');
 (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(Error('disk full'));
 await expect(writeHistoryCache('history:test','replacement transcript')).resolves.toBeUndefined();
 await expect(readHistoryCache('history:test')).resolves.toBe('previous transcript');
});
test('concurrent snapshot writes publish the latest complete value and remove obsolete chunks',async()=>{
 await Promise.all([writeHistoryCache('history:test','old'.repeat(50000)),writeHistoryCache('history:test','latest')]);
 await expect(readHistoryCache('history:test')).resolves.toBe('latest');
 expect(rows.size).toBe(2);
});
test('missing chunks do not return truncated JSON',async()=>{
 await writeHistoryCache('history:test','a'.repeat(120000));
 rows.delete([...rows.keys()].find(key=>key.endsWith(':1'))!);
 await expect(readHistoryCache('history:test')).resolves.toBeUndefined();
});
