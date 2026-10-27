import {test} from 'node:test';
import assert from 'node:assert/strict';
import {snapshotStream} from '../apps/mobile/snapshot-stream.js';

class FixtureXHR {
 static readonly LOADING=3;static readonly DONE=4;static calls:FixtureXHR[]=[];
 readyState=1;status=0;responseText='';method='';url='';timeout=0;withCredentials=false;
 onreadystatechange?:()=>void;onerror?:()=>void;
 constructor(){FixtureXHR.calls.push(this);}
 open(method:string,url:string){this.method=method;this.url=url;}
 setRequestHeader(_name:string,_value:string){}
 send(){} abort(){}
}
test('mobile snapshot stream reconnects status-0 failure using GET only; revocation stops retry',t=>{
 const original=(globalThis as any).XMLHttpRequest;(globalThis as any).XMLHttpRequest=FixtureXHR;
 t.mock.timers.enable({apis:['setTimeout','setInterval','Date']});FixtureXHR.calls=[];
 const snapshots:string[]=[],statuses:string[]=[];
 const stream=snapshotStream('http://127.0.0.1/events',{},s=>snapshots.push(s),s=>statuses.push(s));
 try {
  t.mock.timers.tick(1000);assert.equal(FixtureXHR.calls.length,1);
  const first=FixtureXHR.calls[0];first.readyState=4;first.onerror!();
  assert.ok(statuses.some(s=>s.includes('Offline')));
  t.mock.timers.tick(3000);assert.equal(FixtureXHR.calls.length,2);
  const second=FixtureXHR.calls[1];second.status=200;second.readyState=3;second.responseText='event: snapshot\ndata: {"authoritative":true}\n\n';second.onreadystatechange!();
  assert.deepEqual(snapshots,['{"authoritative":true}']);
  second.status=401;second.readyState=4;second.responseText='unauthorized';second.onreadystatechange!();
  t.mock.timers.tick(90000);assert.equal(FixtureXHR.calls.length,2);assert.ok(statuses.some(s=>s.includes('Authorization')));
  assert.ok(FixtureXHR.calls.every(call=>call.method==='GET'));
 }finally{stream.close();t.mock.timers.reset();(globalThis as any).XMLHttpRequest=original;}
});
