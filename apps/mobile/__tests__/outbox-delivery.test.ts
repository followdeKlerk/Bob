import AsyncStorage from '@react-native-async-storage/async-storage';
import {MessageOutbox,outgoingLabel,type OutgoingMessage} from '../message-outbox';
import {OutboxDelivery} from '../outbox-delivery';
jest.mock('@react-native-async-storage/async-storage',()=>{const values=new Map();return{getItem:jest.fn(async(key:string)=>values.get(key)??null),setItem:jest.fn(async(key:string,value:string)=>{values.set(key,value);}),removeItem:jest.fn(async(key:string)=>{values.delete(key);}),clear:jest.fn(async()=>values.clear())};});
const storageWrite=(AsyncStorage.setItem as jest.Mock).getMockImplementation()!;
const backend={backendId:'one',endpoint:'https://one.ts.net',name:'One'};
const item=(id='first',chat=7,b=backend):OutgoingMessage=>({id,scope:`${b.backendId}:${chat}`,backend:b,chat,localId:-Date.now(),files:[],message:{requestId:id,text:id,mode:'steer',allowSubagents:true}});
const port=()=>({backends:()=>[backend],request:jest.fn(async(_path:string,method:string,_body:any,_backend:any):Promise<any>=>method==='POST'?{status:'placed',entry:42}:{admission:null}),upload:jest.fn(async()=>{}),cleanup:jest.fn(async()=>{}),watch:jest.fn(async()=>{})});
const flush=async()=>{for(let index=0;index<60;index++)await Promise.resolve();};
beforeEach(async()=>{(AsyncStorage.setItem as jest.Mock).mockImplementation(storageWrite);jest.useFakeTimers();jest.setSystemTime(10000);jest.spyOn(Math,'random').mockReturnValue(0.5);await AsyncStorage.clear();});
afterEach(()=>{jest.restoreAllMocks();jest.useRealTimers();});
test('lost POST response retries after about a second and recovers the server receipt without another POST',async()=>{
 const box=new MessageOutbox();await box.ready;await box.add(item());const io=port();let accepted=false;
 io.request.mockImplementation(async(_path,method)=>{if(method==='POST'){accepted=true;throw Error('Connection lost after admission');}return{admission:accepted?{status:'placed',entry:42}:null};});
 const delivery=new OutboxDelivery(box,io);await delivery.drain();
 expect(outgoingLabel(box.items[0])).toBe('Retrying automatically');expect(box.items[0].retryAt).toBe(11000);
 await delivery.drain();expect(io.request).toHaveBeenCalledTimes(2);
 jest.advanceTimersByTime(999);await delivery.drain();expect(io.request).toHaveBeenCalledTimes(2);
 jest.advanceTimersByTime(1);await delivery.drain();
 expect(io.request.mock.calls.filter(call=>call[1]==='POST')).toHaveLength(1);expect(box.items[0]).toMatchObject({admitted:true,entry:42,attempts:0});
 const reopened=new MessageOutbox();await reopened.ready;await new OutboxDelivery(reopened,io).drain();
 expect(io.request).toHaveBeenCalledTimes(3);expect(reopened.items[0].admitted).toBe(true);
});
test('unacknowledged requests replay only with the original identity, with bounded exponential backoff',async()=>{
 const box=new MessageOutbox();await box.ready;await box.add(item());const io=port();let online=false;
 io.request.mockImplementation(async(_path,method)=>{if(method==='POST'&&!online)throw Error('Offline');return method==='POST'?{status:'placed',entry:42}:{admission:null};});
 const delivery=new OutboxDelivery(box,io);
 for(const delay of [1000,2000,4000]){await delivery.drain();expect(box.items[0].retryAt).toBe(Date.now()+delay);jest.advanceTimersByTime(delay);}
 online=true;await delivery.drain();
 const posts=io.request.mock.calls.filter(call=>call[1]==='POST');expect(posts).toHaveLength(4);
 expect(new Set(posts.map(call=>call[2].requestId))).toEqual(new Set(['first']));expect(box.items[0].admitted).toBe(true);
});
test('pending messages preserve order within a chat; a deferred head cannot be overtaken',async()=>{
 const box=new MessageOutbox();await box.ready;await box.add(item('first'));await box.add(item('second'));const io=port();
 io.request.mockRejectedValueOnce(Error('Offline'));
 const delivery=new OutboxDelivery(box,io);await delivery.drain();await delivery.drain();
 expect(io.request).toHaveBeenCalledTimes(1);expect(box.items[1].admitted).toBeUndefined();
 jest.advanceTimersByTime(1000);await Promise.all([delivery.drain(),delivery.drain(),delivery.drain()]);
 expect(io.request.mock.calls.filter(call=>call[1]==='POST').map(call=>call[2].requestId)).toEqual(['first','second']);
});
test('one disconnected backend cannot hold up delivery to another backend',async()=>{
 const other={...backend,backendId:'two',endpoint:'https://two.ts.net'};
 const box=new MessageOutbox();await box.ready;await box.add(item('first'));await box.add(item('other',8,other));const io=port();io.backends=()=>[backend,other];
 let fail!:(error:Error)=>void;
 io.request.mockImplementation(async(_path,method,_body,b)=>b.backendId==='one'?new Promise((_,reject)=>{fail=reject;}):method==='POST'?{status:'placed',entry:55}:{admission:null});
 const draining=new OutboxDelivery(box,io).drain();await flush();
 expect(box.items.find(value=>value.id==='other')?.admitted).toBe(true);expect(box.items[0].admitted).toBeUndefined();
 fail(Error('Offline'));await draining;
});
test('foreground/reconnection bypasses ordinary backoff but never bypasses Retry-After',async()=>{
 const box=new MessageOutbox();await box.ready;await box.add(item());const io=port();
 io.request.mockRejectedValueOnce(Object.assign(Error('Busy'),{httpStatus:429,retryAfterMs:60000}));
 const delivery=new OutboxDelivery(box,io);await delivery.drain();await delivery.drain({force:true});await delivery.drain({forceBackendId:'one'});
 expect(io.request).toHaveBeenCalledTimes(1);expect(box.items[0].retryAt).toBe(70000);
 jest.advanceTimersByTime(60000);await delivery.drain();expect(box.items[0].admitted).toBe(true);
});
test('a terminal rejection stays visible with its reason and an explicit retry uses the same identity',async()=>{
 const box=new MessageOutbox();await box.ready;await box.add(item());const io=port();
 io.request.mockRejectedValueOnce(Object.assign(Error('Configure a provider credential'),{httpStatus:412}));
 const delivery=new OutboxDelivery(box,io);await delivery.drain();await delivery.drain({force:true});
 expect(box.items[0]).toMatchObject({rejected:true,lastError:'Configure a provider credential'});expect(io.request).toHaveBeenCalledTimes(1);
 await box.update('first',{rejected:false});await delivery.drain({force:true});
 expect(io.request.mock.calls.find(call=>call[1]==='POST')?.[2].requestId).toBe('first');expect(box.items[0].admitted).toBe(true);
});
test('a storage write failure cannot send an unsaved message, and later saving recovers the queue',async()=>{
 const box=new MessageOutbox();await box.ready;const io=port();
 const write=jest.spyOn(AsyncStorage,'setItem').mockRejectedValue(Error('Disk temporarily unavailable'));
 await expect(box.add(item())).rejects.toThrow('Disk temporarily unavailable');
 const delivery=new OutboxDelivery(box,io);await expect(delivery.drain()).rejects.toThrow();expect(io.request).not.toHaveBeenCalled();
 write.mockImplementation(storageWrite);await delivery.drain();expect(box.storageError).toBeUndefined();expect(box.items[0].admitted).toBe(true);const reopened=new MessageOutbox();await reopened.ready;expect(reopened.items[0]).toMatchObject({id:'first',admitted:true});
});
test('already admitted older conversations are not polled on every drain',async()=>{
 const box=new MessageOutbox();await box.ready;await box.add({...item('old',8),admitted:true,entry:10});await box.add(item('new'));const io=port();
 await new OutboxDelivery(box,io).drain({scope:'one:7'});expect(io.request.mock.calls.map(call=>call[0])).toEqual(['chats/7/operations/new','chats/7/messages']);
});
test('an attachment upload is retried before sending the message; cleanup waits for admission',async()=>{
 const box=new MessageOutbox();await box.ready;await box.add({...item(),files:[{id:'file',uri:'file:///draft',name:'photo.jpg',mime:'image/jpeg'}]});const io=port();
 io.upload.mockRejectedValueOnce(Error('Upload connection lost'));const delivery=new OutboxDelivery(box,io);
 await delivery.drain();expect(io.cleanup).not.toHaveBeenCalled();expect(io.request.mock.calls.some(call=>call[1]==='POST')).toBe(false);
 jest.advanceTimersByTime(1000);await delivery.drain();expect(io.upload).toHaveBeenCalledTimes(2);expect(io.cleanup).toHaveBeenCalledTimes(1);expect(box.items[0].admitted).toBe(true);
});
test('messages added during an initial drain cannot bypass the durable write barrier',async()=>{
 const box=new MessageOutbox();await box.ready;await box.add(item('first'));const io=port();const originalSaved=box.saved.bind(box);let added:Promise<unknown>|undefined,first=true;
 jest.spyOn(box,'saved').mockImplementation(async()=>{await originalSaved();if(first){first=false;added=box.add(item('second'));}});
 const write=(AsyncStorage.setItem as jest.Mock).getMockImplementation()!;let release!:()=>void;
 jest.spyOn(AsyncStorage,'setItem').mockImplementation(async(key,value)=>{if(key==='message-outbox:v2'&&!release)await new Promise<void>(resolve=>{release=resolve;});await write(key,value);});
 const draining=new OutboxDelivery(box,io).drain();await flush();expect(release).toBeDefined();expect(io.request).not.toHaveBeenCalled();
 release();await added;await draining;expect(io.request.mock.calls.filter(call=>call[1]==='POST').map(call=>call[2].requestId)).toEqual(['first','second']);
});
test('queued server admissions without an entry are polled conservatively, never reposted or watched every second',async()=>{
 const box=new MessageOutbox();await box.ready;await box.add(item());const io=port();let admitted=false;
 io.request.mockImplementation(async(_path,method)=>{if(method==='POST'){admitted=true;return{status:'queued'};}return{admission:admitted?{status:'queued'}:null};});
 const delivery=new OutboxDelivery(box,io);await delivery.drain();
 jest.advanceTimersByTime(1000);await delivery.drain();expect(io.request).toHaveBeenCalledTimes(2);
 jest.advanceTimersByTime(4000);await delivery.drain();expect(io.request).toHaveBeenCalledTimes(3);expect(io.watch).toHaveBeenCalledTimes(1);
 expect(io.request.mock.calls.filter(call=>call[1]==='POST')).toHaveLength(1);expect(outgoingLabel(box.items[0])).toBe('Queued');
});
test('a later receipt authorization error cannot relabel an already admitted message as Not sent',async()=>{
 const box=new MessageOutbox();await box.ready;await box.add({...item(),admitted:true});const io=port();io.request.mockRejectedValue(Object.assign(Error('Pair again'),{httpStatus:401}));
 await new OutboxDelivery(box,io).drain();expect(outgoingLabel(box.items[0])).toBe('Queued');expect(box.items[0].lastError).toBe('Pair again');expect(io.request.mock.calls.some(call=>call[1]==='POST')).toBe(false);
});
test('Android-owned pending delivery never falls back to a foreground POST',async()=>{
 const box=new MessageOutbox();await box.ready;await box.add(item());const io={...port(),background:jest.fn(async()=>({state:'pending' as const}))};
 await new OutboxDelivery(box,io).drain();expect(io.background).toHaveBeenCalledTimes(1);expect(io.request).not.toHaveBeenCalled();expect(box.items[0].admitted).toBeUndefined();
});
test('Android receipt merges into local bubble and native rejection stays visible',async()=>{
 const box=new MessageOutbox();await box.ready;await box.add(item());const io={...port(),background:jest.fn(async():Promise<import('../background-outbox').BackgroundReceipt>=>({state:'rejected',error:'Pair again'}))};
 const delivery=new OutboxDelivery(box,io);await delivery.drain();expect(box.items[0]).toMatchObject({rejected:true,lastError:'Pair again'});expect(io.request).not.toHaveBeenCalled();
 await box.update('first',{rejected:false});io.background.mockResolvedValue({state:'admitted',admission:{status:'placed',entry:42}});await delivery.drain();expect(box.items[0]).toMatchObject({admitted:true,entry:42});expect(io.cleanup).toHaveBeenCalledTimes(1);
});
test('an exhausted uncertain Android POST is not falsely labelled Not sent',async()=>{
 const box=new MessageOutbox();await box.ready;await box.add(item());const io={...port(),background:jest.fn(async()=>({state:'rejected' as const,uncertain:true,error:'Delivery not confirmed'}))};
 await new OutboxDelivery(box,io).drain();expect(outgoingLabel(box.items[0])).toBe('Delivery unconfirmed');expect(io.request).not.toHaveBeenCalled();
});

test('notification-origin sends cannot fall back to foreground HTTP when native handoff is unavailable',async()=>{
 const box=new MessageOutbox();await box.ready;await box.add({...item('native-reply'),notificationReply:true});const io=port();
 await new OutboxDelivery(box,io).drain();expect(io.request).not.toHaveBeenCalled();expect(box.items[0]).toMatchObject({id:'native-reply',lastError:expect.stringContaining('Native notification reply receipt unavailable')});expect(box.items[0].admitted).toBeUndefined();
});
test('undefined background result cannot bypass native reply pairing and foreground attachment barriers',async()=>{
 const box=new MessageOutbox();await box.ready;await box.add({...item('native-reply'),notificationReply:true});const io={...port(),background:jest.fn(async()=>undefined)};
 await new OutboxDelivery(box,io).drain();expect(io.background).toHaveBeenCalledTimes(1);expect(io.request).not.toHaveBeenCalled();expect(io.upload).not.toHaveBeenCalled();
});
