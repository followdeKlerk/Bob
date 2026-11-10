import assert from 'node:assert/strict';
import test from 'node:test';
import {EventEmitter,once} from 'node:events';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate as turn} from 'node:timers/promises';
import {createModels} from '@earendil-works/pi-ai/models';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {serve} from '../src/server.js';

// Exercise the real authenticated request handler and native watch with a
// controlled transport, so drain/close/error ordering is deterministic.
class SlowResponse extends EventEmitter {
 headersSent=false;destroyed=false;closeOnWrite=false;frames:string[]=[];
 writeHead(status:number){assert.equal(status,200);this.headersSent=true;return this;}
 write(frame:string){this.frames.push(frame);this.emit('frame');if(this.closeOnWrite)this.end();return false;}
 end(){if(!this.destroyed){this.destroyed=true;this.emit('close');}return this;}
}
for(const outcome of ['drain','close','error','closed-write'] as const){
 test(`snapshot SSE ${outcome} releases wait listeners and stops its native watch`,{timeout:15000},async t=>{
  const dir=await mkdtemp(join(tmpdir(),'bob-sse-wait-')),state=new State(dir);
  let runtime:Awaited<ReturnType<typeof openRuntime>>|undefined,app:Awaited<ReturnType<typeof serve>>|undefined;
  const response=new SlowResponse();response.closeOnWrite=outcome==='closed-write';
  let running:Promise<void>|undefined,stops=0;
  try{
   runtime=await openRuntime(state,createModels(),undefined,{resume:false});
   const chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
   const originalConversation=runtime.harness.conversation.bind(runtime.harness);
   t.mock.method(runtime.harness,'conversation',((id:Parameters<typeof originalConversation>[0],context:Parameters<typeof originalConversation>[1])=>id===chat.id?Promise.resolve(chat):originalConversation(id,context)) as typeof originalConversation);
   const originalWatch=chat.watch.bind(chat);
   t.mock.method(chat,'watch',async context=>{
    const watch=await originalWatch(context),stop=watch.stop.bind(watch);
    t.mock.method(watch,'stop',()=>{stops++;return stop();});return watch;
   });
   let refresh:(()=>void)|undefined;
   const interval=globalThis.setInterval;
   t.mock.method(globalThis,'setInterval',((callback:()=>void,ms:number,...args:unknown[])=>{
    if(ms===3000){refresh=callback;return interval(callback,3600000,...args);}
    return interval(callback,ms,...args);
   }) as typeof setInterval);
   app=await serve(state,{port:0,runtime});
   const device=state.pair(state.invite().token,'SSE fixture');
   const request={method:'GET',url:`/v1/chats/${chat.id}/events`,headers:{authorization:`Bearer ${device.credential}`,'x-bob-backend':state.id}} as IncomingMessage;
   const handler=app.server.listeners('request')[0] as (req:IncomingMessage,res:ServerResponse)=>Promise<void>;
   const first=once(response,'frame');running=handler(request,response as unknown as ServerResponse);await first;
   assert.ok(refresh);assert.match(response.frames[0],/^event: snapshot\ndata: /);
   if(outcome==='drain'){
    for(let i=0;i<25;i++){
     response.emit('drain');await turn();
     assert.equal(response.listenerCount('drain'),0);
     assert.equal(response.listenerCount('error'),0,'no abandoned error listener after drain');
     assert.equal(response.listenerCount('close'),1,'only the stream lifecycle listener remains');
     if(i<24){const next=once(response,'frame');refresh();await next;}
    }
    await running;response.end();
   }else if(outcome==='close')response.end();
   else if(outcome==='error')response.emit('error',Error('synthetic transport error'));
   await running;await turn();
   assert.equal(response.destroyed,true);assert.equal(response.listenerCount('drain'),0);assert.equal(response.listenerCount('error'),0);
   assert.equal(response.listenerCount('close'),1,'wait cleanup does not remove the lifecycle listener');
   assert.equal(stops,1,'disconnect stops the native watch');
   const frames=response.frames.length;refresh();await turn();assert.equal(response.frames.length,frames,'closed streams never emit another frame');
  }finally{
   response.end();await running;
   if(app)await app.close();else await runtime?.close();state.close();await rm(dir,{recursive:true,force:true});
  }
 });
}
