import AsyncStorage from '@react-native-async-storage/async-storage';
import {MessageOutbox,visibleOutgoing,mergeOutgoing,outgoingAnchor,outgoingLabel,transcriptKey,type OutgoingMessage} from '../message-outbox';
jest.mock('@react-native-async-storage/async-storage',()=>{const values=new Map();return{getItem:jest.fn(async(key:string)=>values.get(key)??null),setItem:jest.fn(async(key:string,value:string)=>{values.set(key,value);}),removeItem:jest.fn(async(key:string)=>{values.delete(key);}),clear:jest.fn(async()=>values.clear())};});
const item=(id:string,scope='one:7'):OutgoingMessage=>({id,scope,backend:{backendId:'one',endpoint:'https://one.ts.net',name:'One'},chat:7,localId:-Number(id),files:[],message:{requestId:id,text:'Same text',mode:'steer',allowSubagents:true}});
beforeEach(async()=>{await AsyncStorage.clear();});
test('publishes before storage, persists several messages in order and restores after process restart',async()=>{
 const box=new MessageOutbox();await box.ready;
 const listener=jest.fn();box.subscribe(listener);
 const first=box.add(item('1')),second=box.add(item('2')),other=box.add(item('3','two:8'));
 expect(listener).toHaveBeenCalledTimes(3);expect(box.items.map(value=>value.id)).toEqual(['1','2','3']);
 await Promise.all([first,second,other]);
 const reopened=new MessageOutbox();await reopened.ready;
 expect(reopened.items).toEqual(box.items);
 expect(visibleOutgoing(reopened.items,'one:7',[]).map(value=>value.id)).toEqual(['1','2']);
 // Identical text is not a receipt: only the real entry/request identity joins.
 expect(visibleOutgoing(reopened.items,'one:7',[{id:5,data:{text:'Same text',requestId:'2'}}]).map(value=>value.id)).toEqual(['1']);
 await reopened.update('1',{admitted:true,entry:10});
 expect(visibleOutgoing(reopened.items,'one:7',[{id:10}]).map(value=>value.id)).toEqual(['2']);
 await reopened.remove('1');
 const final=new MessageOutbox();await final.ready;expect(final.items.map(value=>value.id)).toEqual(['2','3']);
});
test('messages tapped during initial storage load are merged with the saved queue, not overwritten',async()=>{
 const previous=new MessageOutbox();await previous.ready;await previous.add(item('1'));
 const reopened=new MessageOutbox();const saved=reopened.add(item('2'));await saved;
 expect(reopened.items.map(value=>value.id)).toEqual(['1','2']);
});

const localEntry=(value:OutgoingMessage)=>({id:value.localId,kind:'bob.user',data:{text:value.message.text}});
const serverEntry=(id:number)=>({id,kind:'pi.assistant',data:{text:`Reply ${id}`}});
test('failed messages stay at the original anchor instead of following newer replies',async()=>{
 const box=new MessageOutbox();await box.ready;
 await box.add({...item('1'),afterEntryId:20,rejected:true});
 expect(mergeOutgoing([serverEntry(20),serverEntry(10)],box.items,'one:7',localEntry).map(entry=>entry.id)).toEqual([-1,20,10]);
 const updated=[serverEntry(40),serverEntry(30),serverEntry(20),serverEntry(10)];
 expect(mergeOutgoing(updated,box.items,'one:7',localEntry).map(entry=>entry.id)).toEqual([40,30,-1,20,10]);
 const reopened=new MessageOutbox();await reopened.ready;
 expect(mergeOutgoing([...updated,serverEntry(5)],reopened.items,'one:7',localEntry).map(entry=>entry.id)).toEqual([40,30,-1,20,10,5]);
});
test('several offline messages preserve tap order and remain isolated by chat',()=>{
 const items=[{...item('1'),afterEntryId:10},{...item('2'),afterEntryId:10},{...item('3'),afterEntryId:20}, {...item('4','other:7'),afterEntryId:10}];
 expect(mergeOutgoing([serverEntry(30),serverEntry(20),serverEntry(10)],items,'one:7',localEntry).map(entry=>entry.id)).toEqual([30,-3,20,-2,-1,10]);
 // An anchor may refer to a hidden tool-result entry; it needn't be a visible row.
 expect(mergeOutgoing([serverEntry(30),serverEntry(10)],[{...item('1'),afterEntryId:20}],'one:7',localEntry).map(entry=>entry.id)).toEqual([30,-1,10]);
});
test('reconciliation replaces only the delivered bubble, without shifting an older failure',()=>{
 const items=[{...item('1'),afterEntryId:10,rejected:true},{...item('2'),afterEntryId:20,admitted:true,entry:40}];
 expect(mergeOutgoing([serverEntry(40),serverEntry(30),serverEntry(20),serverEntry(10)],items,'one:7',localEntry).map(entry=>entry.id)).toEqual([40,30,20,-1,10]);
});
test('legacy queue recovers anchors from model timestamps; unknown history does not pin old messages to the bottom',()=>{
 const legacy={...item('1'),localId:-1500};
 const entries=[{...serverEntry(10),model:[{timestamp:1000}]},{...serverEntry(20),model:[{timestamp:2000}]}];
 expect(outgoingAnchor(legacy,entries)).toBe(10);
 expect(outgoingAnchor(legacy,[serverEntry(20)])).toBe(0);
 const anchored={...legacy,afterEntryId:10};
 expect(outgoingAnchor(anchored,[...entries,{...serverEntry(30),model:[{timestamp:3000}]}])).toBe(10);
});
test('delivery labels distinguish failure, waiting for connection and confirmed admission',()=>{
 expect(outgoingLabel({...item('1'),rejected:true})).toBe('Not sent');
 expect(outgoingLabel(item('1'))).toBe('Waiting to send');
 expect(outgoingLabel({...item('1'),admitted:true})).toBe('Queued');
});

test('temporary device read errors recover without overwriting the previously saved queue',async()=>{
 const previous=new MessageOutbox();await previous.ready;await previous.add(item('1'));
 const original=(AsyncStorage.getItem as jest.Mock).getMockImplementation()!;
 const read=(AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(Error('Device storage busy'));
 const box=new MessageOutbox();await expect(box.ready).rejects.toThrow('Device storage busy');
 await box.add(item('2'));await box.saved();expect(box.items.map(value=>value.id)).toEqual(['1','2']);expect(box.storageError).toBeUndefined();read.mockImplementation(original);
});
test('corrupt saved queues are not silently replaced by a fresh empty queue',async()=>{
 await AsyncStorage.setItem('message-outbox:v2','bad JSON');const box=new MessageOutbox();await expect(box.ready).rejects.toThrow();
 await expect(box.add(item('1'))).rejects.toThrow();expect(box.items).toHaveLength(1);expect(box.storageError).toBeDefined();expect(await AsyncStorage.getItem('message-outbox:v2')).toBe('bad JSON');
});
test('local and admitted bubbles retain the same list identity, without colliding with other entry kinds',()=>{
 const local={id:-1,kind:'bob.user',data:{requestId:'original-request'}};
 expect(transcriptKey(local)).toBe(transcriptKey({...local,id:42}));
 expect(transcriptKey({id:43,kind:'bob.artifact',data:{requestId:'original-request'}})).toBe('entry:43');
 expect(transcriptKey({id:42,kind:'bob.user'})).toBe('entry:42');
});
