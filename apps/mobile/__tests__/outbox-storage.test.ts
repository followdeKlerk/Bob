import AsyncStorage from '@react-native-async-storage/async-storage';
import {readOutbox,writeOutbox} from '../outbox-storage';
jest.mock('@react-native-async-storage/async-storage',()=>({getItem:jest.fn(),setItem:jest.fn(),removeItem:jest.fn()}));
let values:Map<string,string>;
beforeEach(()=>{
 values=new Map();jest.clearAllMocks();
 (AsyncStorage.getItem as jest.Mock).mockImplementation(async(key:string)=>values.get(key)??null);
 (AsyncStorage.setItem as jest.Mock).mockImplementation(async(key:string,value:string)=>{values.set(key,value);});
 (AsyncStorage.removeItem as jest.Mock).mockImplementation(async(key:string)=>{values.delete(key);});
});
test('large offline queues round-trip in small rows, including Unicode at chunk boundaries',async()=>{
 const items=[{id:'first',text:'x'.repeat(59970)+'😀'.repeat(1100000)}];await writeOutbox(items);
 expect(await readOutbox()).toEqual(items);
 for(const [key,value] of values)if(key.startsWith('message-outbox:v2:')){expect(value.length).toBeLessThanOrEqual(60000);expect(/[\uD800-\uDBFF]$/.test(value)).toBe(false);}
});
test('a failed part write leaves the previous committed queue readable',async()=>{
 await writeOutbox([{text:'previous'}]);const write=(AsyncStorage.setItem as jest.Mock).getMockImplementation()!;let count=0;
 (AsyncStorage.setItem as jest.Mock).mockImplementation(async(key,value)=>{if(key.startsWith('message-outbox:v2:')&&++count===2)throw Error('Disk full');return write(key,value);});
 await expect(writeOutbox([{text:'x'.repeat(200000)}])).rejects.toThrow('Disk full');expect(await readOutbox()).toEqual([{text:'previous'}]);
});
test('a manifest write with an uncertain response never deletes possibly committed chunks',async()=>{
 await writeOutbox([{text:'previous'}]);const write=(AsyncStorage.setItem as jest.Mock).getMockImplementation()!;
 (AsyncStorage.setItem as jest.Mock).mockImplementation(async(key,value)=>{await write(key,value);if(key==='message-outbox:v2')throw Error('Bridge response lost');});
 await expect(writeOutbox([{text:'new complete queue'}])).rejects.toThrow('Bridge response lost');expect(await readOutbox()).toEqual([{text:'new complete queue'}]);
});
test('migration publishes v2 before removing v1, and a failed migration preserves v1',async()=>{
 values.set('message-outbox:v1',JSON.stringify([{id:'saved'}]));expect(await readOutbox()).toEqual([{id:'saved'}]);
 const write=(AsyncStorage.setItem as jest.Mock).getMockImplementation()!;
 (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(Error('Disk full'));
 await expect(writeOutbox([{id:'saved'},{id:'new'}])).rejects.toThrow();expect(await readOutbox()).toEqual([{id:'saved'}]);
 (AsyncStorage.setItem as jest.Mock).mockImplementation(write);await writeOutbox([{id:'saved'},{id:'new'}]);
 expect(values.has('message-outbox:v1')).toBe(false);expect(await readOutbox()).toEqual([{id:'saved'},{id:'new'}]);
});
test('an incomplete or corrupt v2 queue fails closed instead of resurrecting a stale v1 queue',async()=>{
 values.set('message-outbox:v1',JSON.stringify([{id:'already sent'}]));values.set('message-outbox:v2',JSON.stringify({version:2,generation:'saved',parts:1}));
 await expect(readOutbox()).rejects.toThrow('incomplete');values.set('message-outbox:v2','invalid JSON');await expect(readOutbox()).rejects.toThrow();
});
