import {BackgroundOutbox,type BackgroundPort} from '../background-outbox';
import type {OutgoingMessage} from '../message-outbox';
const item:OutgoingMessage={id:'request',scope:'backend:1',backend:{backendId:'backend',endpoint:'https://example.test',name:'Test'},chat:1,localId:-1,files:[],message:{requestId:'request',text:'Hello',mode:'steer',allowSubagents:true}};
const native=():jest.Mocked<BackgroundPort>=>({enqueue:jest.fn<ReturnType<BackgroundPort['enqueue']>,Parameters<BackgroundPort['enqueue']>>(async()=>true),status:jest.fn<ReturnType<BackgroundPort['status']>,Parameters<BackgroundPort['status']>>(async()=>JSON.stringify({state:'pending'})),list:jest.fn(async()=>[]),remove:jest.fn<ReturnType<BackgroundPort['remove']>,Parameters<BackgroundPort['remove']>>(async()=>true)});
test('prepared credentials dispatch to native synchronously before JS yields',async()=>{
 const port=native(),box=new BackgroundOutbox(port,async()=> 'secret');await box.prepare('backend');
 const pending=box.enqueue(item);expect(port.enqueue).toHaveBeenCalledTimes(1);
 expect(port.enqueue.mock.calls[0]).toEqual(['https://example.test','backend','secret',1,'request',JSON.stringify(item.message),'[]',JSON.stringify(item),false]);await pending;
});
test('concurrent drains join the native handoff and do not submit twice',async()=>{
 const port=native();let finish!:(value:unknown)=>void;port.enqueue.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const box=new BackgroundOutbox(port,async()=> 'secret');await box.prepare('backend');const first=box.enqueue(item),second=box.enqueue(item);expect(first).toBe(second);expect(port.enqueue).toHaveBeenCalledTimes(1);finish(true);await first;
});
test('recovery restores the full UI envelope, not credentials',async()=>{
 const port=native();port.list.mockResolvedValue([JSON.stringify(item)]);const box=new BackgroundOutbox(port,async()=>undefined);expect(await box.recover()).toEqual([item]);
});
test('missing credentials fail closed without sending',async()=>{
 const port=native(),box=new BackgroundOutbox(port,async()=>undefined);await expect(box.enqueue(item)).rejects.toThrow('Pair again');expect(port.enqueue).not.toHaveBeenCalled();
});
test('pending and rejection are exposed; explicit retry alone sets retry flag',async()=>{
 const port=native(),box=new BackgroundOutbox(port,async()=> 'secret');expect(await box.deliver(item)).toEqual({state:'pending'});
 port.status.mockResolvedValue(JSON.stringify({state:'rejected',error:'Pair again'}));expect(await box.deliver(item)).toEqual({state:'rejected',error:'Pair again'});await box.enqueue(item,true);expect(port.enqueue.mock.calls.at(-1)?.[8]).toBe(true);
});
test('attachment messages and text queued behind them retain one foreground sender',async()=>{
 const port=native(),box=new BackgroundOutbox(port,async()=> 'secret');
 const attachment={...item,files:[{id:'file',uri:'file:///draft',name:'photo.jpg',mime:'image/jpeg'}]};
 await box.enqueue(attachment);expect(await box.deliver(attachment)).toBeUndefined();
 await box.enqueue({...item,foregroundOnly:true});expect(await box.deliver({...item,foregroundOnly:true})).toBeUndefined();expect(port.enqueue).not.toHaveBeenCalled();expect(port.status).not.toHaveBeenCalled();
});
