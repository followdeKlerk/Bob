import {DeviceEventEmitter,NativeModules,Platform} from 'react-native';
import {chatSnapshotStream,nativeSnapshotStream,continuousSnapshotSupported} from '../continuous-snapshot-stream';
import {snapshotStream,type SnapshotLifecycle} from '../snapshot-stream';
jest.mock('../snapshot-stream',()=>({snapshotStream:jest.fn()}));
const scope={backendId:'example-backend',chat:7};
const snapshot=(text='one',identity=scope)=>JSON.stringify({backendId:identity.backendId,conversationId:identity.chat,view:{entries:[{id:1,kind:'pi.assistant',data:{text}}],docs:{}}});
let native:any,value:any,foreground:boolean,listeners:Set<(active:boolean)=>void>,lifecycle:SnapshotLifecycle,close:jest.Mock;
const deferred=<T,>()=>{let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {resolve,reject,promise};};
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
async function transition(active:boolean){foreground=active;for(const listener of listeners)listener(active);await flush();}
const notice=(patch:Record<string,unknown>={})=>DeviceEventEmitter.emit('BobConnectionStream',{backendId:scope.backendId,conversationId:scope.chat,...patch});
const create=()=>{
 const onSnapshot=jest.fn(),onStatus=jest.fn(),onReconnect=jest.fn(),onDisabled=jest.fn();
 return {stream:nativeSnapshotStream(scope,onSnapshot,onStatus,onReconnect,lifecycle,onDisabled),onSnapshot,onStatus,onReconnect,onDisabled};
};
beforeEach(()=>{
 jest.useFakeTimers();jest.replaceProperty(Platform,'OS','android');
 foreground=true;listeners=new Set();lifecycle={active:()=>foreground,subscribe:fn=>{listeners.add(fn);return{remove:()=>listeners.delete(fn)};}};
 value={backendId:scope.backendId,conversationId:scope.chat,enabled:true,selected:true,status:'connected',revision:1,epoch:1,snapshot:snapshot(),heartbeatAgeMs:0};
 native=NativeModules.BobConnection={readStream:jest.fn(async(_id,_chat,_observer,after)=>JSON.stringify({...value,snapshot:after===value.revision?undefined:value.snapshot})),releaseStream:jest.fn(async()=>true),start:jest.fn(),stop:jest.fn()};
 close=jest.fn();(snapshotStream as jest.Mock).mockReset().mockReturnValue({close});
});
afterEach(()=>{delete NativeModules.BobConnection;DeviceEventEmitter.removeAllListeners('BobConnectionStream');jest.restoreAllMocks();jest.useRealTimers();});

test('native stream attaches locally and consumes one current snapshot without another network connection',async()=>{
 const view=create();await flush();
 expect(view.onSnapshot).toHaveBeenCalledWith(value.snapshot);expect(view.onStatus).toHaveBeenLastCalledWith('Connected');expect(view.onReconnect).toHaveBeenCalledTimes(1);
 expect(native.readStream).toHaveBeenCalledWith(scope.backendId,7,expect.any(String),0);expect(snapshotStream).not.toHaveBeenCalled();expect(native.start).not.toHaveBeenCalled();
 view.stream.close();expect(native.releaseStream).toHaveBeenCalledTimes(1);expect(native.stop).not.toHaveBeenCalled();
});
test('background and lock keep native ownership; return reads already-received state without reconnect reconciliation',async()=>{
 const view=create();await flush();const observer=native.readStream.mock.calls[0][2];
 await transition(false);value={...value,revision:5,snapshot:snapshot('received while locked')};for(let i=0;i<50;i++)notice({observerId:observer});await flush();
 expect(native.readStream).toHaveBeenCalledTimes(1);expect(native.releaseStream).not.toHaveBeenCalled();expect(native.stop).not.toHaveBeenCalled();
 await transition(true);expect(native.readStream).toHaveBeenCalledTimes(2);expect(view.onSnapshot).toHaveBeenLastCalledWith(value.snapshot);expect(view.onReconnect).toHaveBeenCalledTimes(1);
 expect(view.onStatus.mock.calls.flat()).not.toContain('Offline • reconnecting');expect(snapshotStream).not.toHaveBeenCalled();view.stream.close();
});
test('a healthy unchanged stream has no age/byte rotation, polling or redundant render on return',async()=>{
 const view=create();await flush();jest.advanceTimersByTime(30*60*1000);await flush();
 expect(native.readStream).toHaveBeenCalledTimes(1);await transition(false);await transition(true);
 expect(view.onSnapshot).toHaveBeenCalledTimes(1);expect(view.onReconnect).toHaveBeenCalledTimes(1);expect(native.start).not.toHaveBeenCalled();view.stream.close();
});
test('a real native reconnect reconciles once after the new connection has a fresh snapshot',async()=>{
 const view=create();await flush();value={...value,status:'reconnecting',epoch:2};notice();await flush();
 expect(view.onStatus).toHaveBeenLastCalledWith('Offline • reconnecting');expect(view.onReconnect).toHaveBeenCalledTimes(1);
 value={...value,status:'connected',revision:2,snapshot:snapshot('recovered')};notice();await flush();notice();await flush();
 expect(view.onReconnect).toHaveBeenCalledTimes(2);expect(view.onSnapshot).toHaveBeenCalledTimes(2);view.stream.close();
});
test('stale health cannot call a cached transcript connected or reconcile it as a new stream',async()=>{
 value.heartbeatAgeMs=30000;const view=create();await flush();
 expect(view.onStatus).toHaveBeenLastCalledWith('Offline • reconnecting');expect(view.onReconnect).not.toHaveBeenCalled();
 value.heartbeatAgeMs=0;notice();await flush();expect(view.onStatus).toHaveBeenLastCalledWith('Connected');expect(view.onReconnect).toHaveBeenCalledTimes(1);view.stream.close();
});
test('native invalidations are coalesced into one pending read and only matching scope/observer may signal it',async()=>{
 const pending=deferred<string>();native.readStream.mockReturnValueOnce(pending.promise);const view=create();
 const observer=native.readStream.mock.calls[0][2];for(let i=0;i<100;i++)notice({observerId:observer});await flush();expect(native.readStream).toHaveBeenCalledTimes(1);
 pending.resolve(JSON.stringify(value));await flush();expect(native.readStream).toHaveBeenCalledTimes(2);
 notice({backendId:'other'});notice({conversationId:8});notice({observerId:'old-observer'});await flush();expect(native.readStream).toHaveBeenCalledTimes(2);view.stream.close();
});
test('a read completing after a background/foreground roundtrip is discarded and rereads current local state',async()=>{
 const pending=deferred<string>();native.readStream.mockReturnValueOnce(pending.promise);const view=create();
 await transition(false);await transition(true);const old=JSON.stringify(value);value={...value,revision:4,snapshot:snapshot('latest')};pending.resolve(old);await flush();
 expect(view.onSnapshot).toHaveBeenCalledTimes(1);expect(view.onSnapshot).toHaveBeenCalledWith(value.snapshot);expect(native.readStream).toHaveBeenCalledTimes(2);view.stream.close();
});
test('late reads and old invalidations cannot update a closed observer or stop its replacement service',async()=>{
 const pending=deferred<string>();native.readStream.mockReturnValueOnce(pending.promise);const old=create();const observer=native.readStream.mock.calls[0][2];old.stream.close();
 const current=create();await flush();pending.resolve(JSON.stringify(value));notice({observerId:observer});await flush();
 expect(old.onSnapshot).not.toHaveBeenCalled();expect(current.onSnapshot).toHaveBeenCalledTimes(1);expect(native.stop).not.toHaveBeenCalled();expect(native.releaseStream.mock.calls.every((call:any[])=>call[0]===observer)).toBe(true);current.stream.close();
});
test('rejects a mismatched native envelope before publishing',async()=>{
 value.backendId='other';
 const view=create();await flush();expect(view.onSnapshot).not.toHaveBeenCalled();expect(view.onReconnect).not.toHaveBeenCalled();expect(view.onStatus).toHaveBeenLastCalledWith('Connection needs attention • open Connection settings');expect(native.start).not.toHaveBeenCalled();view.stream.close();
});
test('deselection cannot publish cached data from retired native ownership',async()=>{
 value.selected=false;const view=create();await flush();expect(view.onSnapshot).not.toHaveBeenCalled();expect(view.onReconnect).not.toHaveBeenCalled();view.stream.close();
});
test.each(['authorization','identity','overflow'])('terminal %s error stays visible without starting a new native stream',async(error)=>{
 value={...value,status:'attention',error};const view=create();await flush();
 expect(view.onStatus).toHaveBeenLastCalledWith(error==='overflow'?'Connection needs attention • open Connection settings':'Authorization or identity rejected • pair again');expect(view.onReconnect).not.toHaveBeenCalled();expect(native.start).not.toHaveBeenCalled();view.stream.close();
});
test('bridge failures retry only local reads, pause retries while backgrounded, and keep raw errors private',async()=>{
 native.readStream.mockRejectedValueOnce(Error('private url/token'));const view=create();await flush();expect(view.onStatus.mock.calls.flat().join(' ')).not.toContain('private');
 await transition(false);jest.advanceTimersByTime(60000);await flush();expect(native.readStream).toHaveBeenCalledTimes(1);
 await transition(true);expect(view.onSnapshot).toHaveBeenCalledTimes(1);expect(native.start).not.toHaveBeenCalled();view.stream.close();
});
test('explicit Keep connected mode selects native without a duplicate SSE and repeated selection is a no-op',async()=>{
 const onSnapshot=jest.fn(),onReconnect=jest.fn();const stream=chatSnapshotStream('https://example.invalid/events',{},scope,onSnapshot,jest.fn(),onReconnect,lifecycle,true);await flush();
 stream.setContinuous(true);await transition(false);await transition(true);expect(snapshotStream).not.toHaveBeenCalled();expect(onReconnect).toHaveBeenCalledTimes(1);stream.close();
});
test('turning continuous mode on/off changes only its observer/transport and never calls native stop or start',async()=>{
 const stream=chatSnapshotStream('https://example.invalid/events',{},scope,jest.fn(),jest.fn(),jest.fn(),lifecycle,false);expect(snapshotStream).toHaveBeenCalledTimes(1);
 stream.setContinuous(true);await flush();expect(close).toHaveBeenCalledTimes(1);stream.setContinuous(false);expect(snapshotStream).toHaveBeenCalledTimes(2);expect(native.releaseStream).toHaveBeenCalledTimes(1);expect(native.stop).not.toHaveBeenCalled();expect(native.start).not.toHaveBeenCalled();stream.close();
});
test('notification Turn off falls back to foreground-only streaming rather than silently restarting the service',async()=>{
 const stream=chatSnapshotStream('https://example.invalid/events',{},scope,jest.fn(),jest.fn(),jest.fn(),lifecycle,true);await flush();
 value.enabled=false;notice();await flush();expect(snapshotStream).toHaveBeenCalledTimes(1);expect(native.start).not.toHaveBeenCalled();expect(native.stop).not.toHaveBeenCalled();stream.close();
});
test('stale JS transport callbacks cannot overwrite native snapshots after switching',async()=>{
 const onSnapshot=jest.fn(),stream=chatSnapshotStream('https://example.invalid/events',{},scope,onSnapshot,jest.fn(),jest.fn(),lifecycle,false);
 const oldPublish=(snapshotStream as jest.Mock).mock.calls[0][2];stream.setContinuous(true);await flush();oldPublish('obsolete');expect(onSnapshot).toHaveBeenCalledTimes(1);expect(onSnapshot).toHaveBeenCalledWith(value.snapshot);stream.close();
});
test.each(['missing','ios'])('older or inapplicable native support (%s) preserves the normal read stream',async(kind)=>{
 if(kind==='missing')delete NativeModules.BobConnection.readStream;else jest.replaceProperty(Platform,'OS','ios');
 expect(continuousSnapshotSupported()).toBe(false);const stream=chatSnapshotStream('https://example.invalid/events',{},scope,jest.fn(),jest.fn(),jest.fn(),lifecycle,true);
 expect(snapshotStream).toHaveBeenCalledTimes(1);stream.close();
});
