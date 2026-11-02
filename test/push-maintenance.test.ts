import test from 'node:test';
import assert from 'node:assert/strict';
import {watchPushMaintenance} from '../src/push-maintenance.js';
import type {State} from '../src/state.js';
import type {UpdateJob} from '../src/maintenance.js';
const fixture=()=>{const values=new Map<string,unknown>();return {get:(key:string)=>values.get(key),set:(key:string,value:unknown)=>values.set(key,value)} as unknown as State;};
const job=(id:string,status='complete'):UpdateJob=>({id,status,action:'update',target:'all',stage:status,created:1,updated:2});
test('build relay baselines history, notices new terminal jobs once and preserves restart cursor',t=>{
 t.mock.timers.enable({apis:['setInterval']});
 const state=fixture(),sent:string[]=[];let jobs=[job('old')];
 const start=()=>watchPushMaintenance(state,key=>sent.push(key),{read:()=>jobs});
 let stop=start();assert.deepEqual(sent,[]);
 jobs=[job('new','building'),...jobs];t.mock.timers.tick(2000);assert.deepEqual(sent,[]);
 jobs=[job('new'),job('old')];t.mock.timers.tick(2000);assert.deepEqual(sent,['maintenance:new:complete']);
 t.mock.timers.tick(4000);assert.equal(sent.length,1);stop();
 stop=start();assert.equal(sent.length,1);
 jobs=[job('bad','failed'),...jobs];t.mock.timers.tick(2000);assert.deepEqual(sent,['maintenance:new:complete','maintenance:bad:failed']);
 stop();jobs=[job('later'),...jobs];t.mock.timers.tick(2000);assert.equal(sent.length,2);
});
test('build relay does not mark failed queue admission as handled',t=>{
 t.mock.timers.enable({apis:['setInterval']});
 const state=fixture(),sent:string[]=[];let jobs:UpdateJob[]=[];let fail=true;
 const log=t.mock.method(console,'error',()=>{});
 const stop=watchPushMaintenance(state,key=>{if(fail)throw Error('temporary transport queue unavailable');sent.push(key);},{read:()=>jobs});
 jobs=[job('ready')];t.mock.timers.tick(2000);assert.equal(sent.length,0);assert.equal(log.mock.callCount(),1);
 fail=false;t.mock.timers.tick(2000);assert.deepEqual(sent,['maintenance:ready:complete']);stop();
});
