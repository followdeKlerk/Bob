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

test('unchanged maintenance polls and restarts do not rewrite the persisted cursor',t=>{
 t.mock.timers.enable({apis:['setInterval']});
 const state=fixture(),write=t.mock.method(state,'set'),sent:string[]=[];let jobs:UpdateJob[]=[];
 const start=()=>watchPushMaintenance(state,key=>sent.push(key),{read:()=>jobs});
 let stop=start();assert.equal(write.mock.callCount(),1,'initialize the baseline once');
 t.mock.timers.tick(60000);assert.equal(write.mock.callCount(),1,'30 idle polls must not issue writes');
 jobs=[job('new')];t.mock.timers.tick(2000);assert.deepEqual(sent,['maintenance:new:complete']);assert.equal(write.mock.callCount(),2);
 jobs=[job('new','failed')];t.mock.timers.tick(2000);assert.deepEqual(sent,['maintenance:new:complete','maintenance:new:failed']);assert.equal(write.mock.callCount(),3);
 jobs=[job('active','building'),...jobs];t.mock.timers.tick(2000);assert.equal(write.mock.callCount(),3);
 stop();stop=start();assert.equal(write.mock.callCount(),3,'restart reuses the unchanged baseline');
 t.mock.timers.tick(60000);assert.equal(write.mock.callCount(),3);stop();
});

test('maintenance cursor pruning persists once and failed persistence remains retryable',t=>{
 t.mock.timers.enable({apis:['setInterval']});
 const state=fixture();state.set('pushMaintenanceSeen',Array.from({length:205},(_,i)=>`old-${i}:complete`));
 const write=t.mock.method(state,'set'),sent:string[]=[];let jobs:UpdateJob[]=[];
 const stop=watchPushMaintenance(state,key=>sent.push(key),{read:()=>jobs});
 assert.equal(write.mock.callCount(),1);assert.equal(state.get<string[]>('pushMaintenanceSeen')!.length,200);
 t.mock.timers.tick(2000);assert.equal(write.mock.callCount(),1);
 write.mock.mockImplementationOnce(()=>{throw Error('synthetic storage failure');});
 const log=t.mock.method(console,'error',()=>{});
 jobs=[job('new')];t.mock.timers.tick(2000);assert.equal(log.mock.callCount(),1);
 assert.ok(!state.get<string[]>('pushMaintenanceSeen')!.includes('new:complete'));
 t.mock.timers.tick(2000);
 assert.ok(state.get<string[]>('pushMaintenanceSeen')!.includes('new:complete'));
 assert.deepEqual(sent,['maintenance:new:complete','maintenance:new:complete'],'queue-before-cursor ordering permits deduplicated admission retry');
 const count=write.mock.callCount();t.mock.timers.tick(2000);assert.equal(write.mock.callCount(),count);stop();
});
