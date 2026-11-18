import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {MaintenanceStore,type UpdateRequest,type Release} from '../src/maintenance.js';
import {runUpdateJob} from '../src/maintenance.js';

for(const action of ['build','update'] as const)for(const target of ['backend','android','all'] as const)test(`${action}/${target} distinguishes staging from activation and never claims Android installation`,async()=>{
 const home=mkdtempSync(join(tmpdir(),'bob-job-')),store=new MaintenanceStore(home);
 const candidate={id:'candidate',cli:'/unused/candidate'} as Release;let activations=0;
 try{
  const job=store.enqueue({id:'test',action,target});
  const result=await runUpdateJob(store,job,async()=>candidate,async release=>{assert.equal(release,candidate);activations++;});
  const activated=action==='update'&&target!=='android';
  assert.equal(activations,activated?1:0);assert.equal(result.status,'complete');
  if(activated)assert.match(result.stage,/Backend update activated/);
  else if(target!=='android')assert.match(result.stage,/staged; not activated/);
  else assert.match(result.stage,/backend unchanged/);
  if(target!=='backend')assert.match(result.stage,/installation requires owner approval/);
 }finally{store.close();rmSync(home,{recursive:true,force:true});}
});

test('rollback rejects Android and all at admission and in legacy queued jobs without building or activating',async()=>{
 const home=mkdtempSync(join(tmpdir(),'bob-job-')),store=new MaintenanceStore(home);
 try{
  for(const target of ['android','all'] as const){
   const request:UpdateRequest={id:target,action:'rollback',target};
   assert.throws(()=>store.enqueue(request),/target=backend only/);assert.equal(store.job(target),undefined);
   const legacy={...request,status:'queued',stage:'Queued',created:1,updated:1};
   await assert.rejects(runUpdateJob(store,legacy,async()=>{throw Error('must not build');},async()=>{throw Error('must not activate');}),/Android rollback is not supported/);
  }
  const previous={id:'previous',cli:'/unused/previous'} as Release;store.set('previous',previous);
  const job=store.enqueue({id:'supported',action:'rollback',target:'backend'});let called=false;
  const result=await runUpdateJob(store,job,async()=>{throw Error('must not build');},async release=>{assert.deepEqual(release,previous);called=true;});
  assert.equal(called,true);assert.match(result.stage,/Previous backend code activated.*Android app unchanged/);
 }finally{store.close();rmSync(home,{recursive:true,force:true});}
});

test('failed activation cannot write a successful completion receipt',async()=>{
 const home=mkdtempSync(join(tmpdir(),'bob-job-')),store=new MaintenanceStore(home);
 try{
  const job=store.enqueue({id:'failed',action:'update',target:'backend'});
  await assert.rejects(runUpdateJob(store,job,async()=>({id:'new',cli:'/unused'} as Release),async()=>{throw Error('activation failed');}),/activation failed/);
  assert.equal(store.job(job.id)?.status,'activating');
 }finally{store.close();rmSync(home,{recursive:true,force:true});}
});
