import AsyncStorage from '@react-native-async-storage/async-storage';
import {readHistoryCache,writeHistoryCache} from '../history-cache';
jest.mock('@react-native-async-storage/async-storage',()=>({getItem:jest.fn(),setItem:jest.fn(),removeItem:jest.fn(),getMany:jest.fn(),setMany:jest.fn(),removeMany:jest.fn()}));
let values:Map<string,string>;
beforeEach(()=>{
 values=new Map();jest.clearAllMocks();
 (AsyncStorage.getItem as jest.Mock).mockImplementation(async(key:string)=>values.get(key)??null);
 (AsyncStorage.setItem as jest.Mock).mockImplementation(async(key:string,value:string)=>{values.set(key,value);});
 (AsyncStorage.removeItem as jest.Mock).mockImplementation(async(key:string)=>{values.delete(key);});
 (AsyncStorage.getMany as jest.Mock).mockImplementation(async(keys:string[])=>Object.fromEntries(keys.map(key=>[key,values.get(key)??null])));
 (AsyncStorage.setMany as jest.Mock).mockImplementation(async(items:Record<string,string>)=>{for(const [key,value] of Object.entries(items))values.set(key,value);});
 (AsyncStorage.removeMany as jest.Mock).mockImplementation(async(keys:string[])=>{keys.forEach(key=>values.delete(key));});
});
test('large transcripts round-trip in small rows without splitting Unicode characters',async()=>{
 const content='a'.repeat(59999)+'😀'+ 'Full conversation 🐈\n'.repeat(150000);
 await writeHistoryCache('history:large',content);
 expect(await readHistoryCache('history:large')).toBe(content);
 for(const [key,value] of values)if(key.startsWith('chunked:history:large:')){
  expect(value.length).toBeLessThanOrEqual(60000);
  expect(value.charCodeAt(value.length-1)>=0xD800&&value.charCodeAt(value.length-1)<=0xDBFF).toBe(false);
 }
});
test('a failed cache write retains the previously readable generation',async()=>{
 await writeHistoryCache('history:failure','Previous transcript');
 (AsyncStorage.setMany as jest.Mock).mockRejectedValueOnce(Error('Disk full'));
 await expect(writeHistoryCache('history:failure','New transcript')).resolves.toBeUndefined();
 expect(await readHistoryCache('history:failure')).toBe('Previous transcript');
});
test('unreadable oversized legacy rows are optional and can be replaced by a new chunked cache',async()=>{
 (AsyncStorage.getItem as jest.Mock).mockImplementation(async(key:string)=>{if(key==='history:legacy')throw Error('Row too big to fit into CursorWindow');return values.get(key)??null;});
 expect(await readHistoryCache('history:legacy')).toBeUndefined();
 await writeHistoryCache('history:legacy','Restored from authoritative history');
 expect(await readHistoryCache('history:legacy')).toBe('Restored from authoritative history');
});
test('concurrent writes are serialized and the newest complete cache wins',async()=>{
 await Promise.all([writeHistoryCache('history:concurrent','first'),writeHistoryCache('history:concurrent','second')]);
 expect(await readHistoryCache('history:concurrent')).toBe('second');
 expect([...values.keys()].filter(key=>key.startsWith('chunked:history:concurrent:'))).toHaveLength(1);
});
