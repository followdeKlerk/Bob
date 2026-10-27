import {AppState} from 'react-native';
import EventSource from 'react-native-sse';
import {snapshotStream,SNAPSHOT_CONNECTION_MAX_CHARS,SNAPSHOT_CONNECTION_MAX_MS} from '../snapshot-stream';
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
test('large snapshot traffic rotates the read connection without replay/reconciliation or stale callbacks',()=>{
 const value=create(),data='x'.repeat(SNAPSHOT_CONNECTION_MAX_CHARS/4);
 for(let n=0;n<4;n++)emit(0,'snapshot',{data});
 expect(clients[0].close).toHaveBeenCalledTimes(1);expect(clients).toHaveLength(1);
 emit(0,'snapshot',{data:'stale'});jest.advanceTimersByTime(1);expect(clients).toHaveLength(2);
 emit(1,'snapshot',{data:'fresh'});expect(value.onSnapshot).toHaveBeenCalledTimes(5);
 expect(value.onSnapshot).toHaveBeenLastCalledWith('fresh');expect(value.onReconnect).toHaveBeenCalledTimes(1);
 expect(value.onStatus).not.toHaveBeenCalledWith(expect.stringContaining('Offline'));
 value.stream.close();
});
test('healthy small traffic also rotates by age, then real network errors still reconcile',()=>{
 const value=create();
 for(let t=0;t<SNAPSHOT_CONNECTION_MAX_MS;t+=3000){emit(0,'snapshot',{data:'heartbeat'});jest.advanceTimersByTime(3000);}
 jest.advanceTimersByTime(1);expect(clients).toHaveLength(2);expect(clients[0].close).toHaveBeenCalledTimes(1);
 emit(1,'snapshot',{data:'fresh'});expect(value.onReconnect).toHaveBeenCalledTimes(1);
 emit(1,'error',{xhrStatus:0});jest.advanceTimersByTime(1000);emit(2,'snapshot',{data:'recovered'});
 expect(value.onReconnect).toHaveBeenCalledTimes(2);value.stream.close();
});
test.each(['close','background'])('pending buffer rotation is cancelled by %s',action=>{
 const value=create();emit(0,'snapshot',{data:'x'.repeat(SNAPSHOT_CONNECTION_MAX_CHARS)});
 if(action==='close')value.stream.close();else for(const listener of listeners)listener('background');
 jest.advanceTimersByTime(120000);expect(clients).toHaveLength(1);value.stream.close();
});
test('real SSE parser releases cumulative XHR responses during sustained multi-megabyte snapshots',()=>{
 const ActualEventSource=jest.requireActual('react-native-sse').default;
 const original=globalThis.XMLHttpRequest;
 const requests:BufferedXHR[]=[];
 class BufferedXHR {
  static DONE=4;static LOADING=3;
  readyState=3;status=200;responseText='';onreadystatechange?:()=>void;onerror?:()=>void;aborted=false;
  constructor(){requests.push(this);}
  open(){}setRequestHeader(){}send(){}
  abort(){this.aborted=true;this.responseText='';}
  receive(data:string){if(this.aborted)throw Error('Write to closed request');this.responseText+=data;this.onreadystatechange?.();}
 }
 globalThis.XMLHttpRequest=BufferedXHR as any;
 (EventSource as unknown as jest.Mock).mockImplementation((url,options)=>new ActualEventSource(url,options));
 let stream:ReturnType<typeof snapshotStream>|undefined;
 try{
  const onSnapshot=jest.fn(),onReconnect=jest.fn();stream=snapshotStream('https://test.ts.net/events',{},onSnapshot,jest.fn(),onReconnect);
  jest.advanceTimersByTime(1);const data='x'.repeat(2*1024*1024);let peak=0;
  for(let n=0;n<150;n++){
   const request=requests[requests.length-1];peak=Math.max(peak,request.responseText.length+data.length+24);
   request.receive('event: snapshot\ndata: '+data+'\n\n');jest.advanceTimersByTime(1);
  }
  expect(onSnapshot).toHaveBeenCalledTimes(150);expect(onReconnect).toHaveBeenCalledTimes(1);
  expect(requests.length).toBeGreaterThan(30);expect(peak).toBeLessThan(SNAPSHOT_CONNECTION_MAX_CHARS+data.length+128);
  expect(requests.slice(0,-1).every(request=>request.aborted&&request.responseText==='')).toBe(true);
 }finally{stream?.close();globalThis.XMLHttpRequest=original;}
});
