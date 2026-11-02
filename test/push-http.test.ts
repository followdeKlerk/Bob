import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {State} from '../src/state.js';
import {openRuntime} from '../src/runtime.js';
import {serve} from '../src/server.js';

test('push endpoints require device and backend identity, validate tokens, and scope mutations to the caller',{timeout:20000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bob-push-http-')),state=new State(dir),runtime=await openRuntime(state);
 const registered:Array<{deviceId:string;token:string}>=[],removed:string[]=[];
 const app=await serve(state,{port:0,runtime:{...runtime,push:{...runtime.push,
  register:(deviceId:string,token:string)=>{registered.push({deviceId,token});return {registered:true,enabled:true};},
  unregister:(deviceId:string)=>{removed.push(deviceId);return {registered:false};},
 }} as typeof runtime});
 const base=`http://127.0.0.1:${(app.server.address() as {port:number}).port}/v1/push/register`,device=state.pair(state.invite().token,'Phone'),other=state.pair(state.invite().token,'Other');
 const headers={'content-type':'application/json',authorization:`Bearer ${device.credential}`,'x-bob-backend':state.id};
 const token='generic_valid_fcm_registration_token:1234567890';
 const post=(value:unknown,h:Record<string,string>=headers)=>fetch(base,{method:'POST',headers:h,body:JSON.stringify(value)});
 try{
  assert.equal((await post({token},{})).status,401);
  assert.equal((await post({token},{...headers,'x-bob-backend':randomUUID()})).status,409);
  for(const value of [{token:'short'},{token:'a'.repeat(4097)},{token:token+'\n'},{token,deviceId:other.deviceId},{token,extra:'no'}])assert.equal((await post(value)).status,400);
  assert.deepEqual(registered,[]);
  const response=await post({token});assert.equal(response.status,200);assert.deepEqual(await response.json(),{registered:true,enabled:true});
  assert.deepEqual(registered,[{deviceId:device.deviceId,token}]);
  const deleted=await fetch(base,{method:'DELETE',headers});assert.equal(deleted.status,200);assert.deepEqual(removed,[device.deviceId]);
  assert.equal((await fetch(base,{headers})).status,405);
  state.revoke(device.deviceId);assert.equal((await post({token})).status,401);assert.equal(registered.length,1);
 }finally{await app.close();state.close();rmSync(dir,{recursive:true,force:true});}
});
