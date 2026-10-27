import {AppState} from 'react-native';
import EventSource from 'react-native-sse';
import {snapshotStream} from '../snapshot-stream';
jest.mock('react-native-sse',()=>jest.fn());
jest.mock('react-native/Libraries/AppState/AppState',()=>({__esModule:true,default:{currentState:'active',addEventListener:jest.fn(()=>({remove:jest.fn()}))}}));
type Client={handlers:Record<string,(event:any)=>void>;close:jest.Mock};
let clients:Client[],listeners:Set<(state:string)=>void>;
const create=(onSnapshot=jest.fn(),onStatus=jest.fn(),onReconnect=jest.fn())=>({stream:snapshotStream('https://one.ts.net/events',{},onSnapshot,onStatus,onReconnect,{active:()=>AppState.currentState==='active',subscribe:fn=>AppState.addEventListener('change',state=>fn(state==='active'))}),onSnapshot,onStatus,onReconnect});
const emit=(index:number,type:string,event:any)=>clients[index].handlers[type]?.(event);
beforeEach(()=>{
 jest.useFakeTimers();jest.setSystemTime(0);jest.spyOn(Math,'random').mockReturnValue(0.5);jest.replaceProperty(AppState,'currentState','active');
 clients=[];listeners=new Set();jest.spyOn(AppState,'addEventListener').mockImplementation((_event,fn)=>{listeners.add(fn as any);return{remove:()=>{listeners.delete(fn as any);}};});
 (EventSource as unknown as jest.Mock).mockImplementation(()=>{const client={handlers:{},close:jest.fn(),addEventListener:jest.fn((event:string,fn:any)=>{(client.handlers as any)[event]=fn;})};clients.push(client);return client;});
});
afterEach(()=>{jest.restoreAllMocks();jest.useRealTimers();});
test('network errors reconnect around one second later; old-connection callbacks cannot overwrite new data',()=>{
 const value=create();emit(0,'snapshot',{data:'first'});expect(value.onReconnect).toHaveBeenCalledTimes(1);
 emit(0,'error',{xhrStatus:0});emit(0,'error',{xhrStatus:0});jest.advanceTimersByTime(999);expect(clients).toHaveLength(1);
 jest.advanceTimersByTime(1);expect(clients).toHaveLength(2);
 emit(0,'snapshot',{data:'stale'});emit(1,'snapshot',{data:'new'});expect(value.onSnapshot.mock.calls.map(call=>call[0])).toEqual(['first','new']);
 expect(value.onReconnect).toHaveBeenCalledTimes(2);value.stream.close();jest.advanceTimersByTime(60000);expect(clients).toHaveLength(2);
});
test('foregrounding opens a fresh read stream immediately; backgrounding cancels reconnect work',()=>{
 const value=create();emit(0,'error',{xhrStatus:0});for(const listener of listeners)listener('background');jest.advanceTimersByTime(60000);expect(clients).toHaveLength(1);
 for(const listener of listeners)listener('active');expect(clients).toHaveLength(2);expect(clients[0].close).toHaveBeenCalled();
 emit(1,'snapshot',{data:'restored'});expect(value.onSnapshot).toHaveBeenCalledWith('restored');value.stream.close();expect(listeners.size).toBe(0);
});
test.each([401,403,409])('authorization/identity rejection %s stops rather than endlessly reconnecting',xhrStatus=>{
 const value=create();emit(0,'error',{xhrStatus});jest.advanceTimersByTime(120000);expect(clients).toHaveLength(1);expect(value.onStatus).toHaveBeenCalledWith(expect.stringContaining('pair again'));expect(listeners.size).toBe(0);
});
test('invalid/truncated snapshot data is recoverable and does not permanently stop the stream',()=>{
 const value=create(jest.fn(data=>JSON.parse(data)));emit(0,'snapshot',{data:'{"partial"'});jest.advanceTimersByTime(1000);expect(clients).toHaveLength(2);
 emit(1,'snapshot',{data:'{"complete":true}'});expect(value.onReconnect).toHaveBeenCalledTimes(1);value.stream.close();
});
test('a silent stalled socket is detected without clearing the last good snapshot',()=>{
 const value=create();emit(0,'snapshot',{data:'saved'});jest.advanceTimersByTime(18000);expect(clients[0].close).toHaveBeenCalled();jest.advanceTimersByTime(1000);expect(clients).toHaveLength(2);expect(value.onSnapshot).toHaveBeenCalledTimes(1);value.stream.close();
});
