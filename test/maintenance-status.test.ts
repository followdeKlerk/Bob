import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {State} from '../src/state.js';
import {MaintenanceStore,type MaintenanceConfig} from '../src/maintenance.js';
import {updateStatus,maintenancePort} from '../src/maintenance-port.js';

function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'bob-update-status-')),state=new State(join(dir,'state')),home=join(dir,'maintenance');
 const config:MaintenanceConfig={backendId:state.id,stateDir:state.dir,sourceRoot:join(dir,'source'),node:process.execPath,serveArgs:[],origin:'http://127.0.0.1'};
 return {state,home,config,install(){mkdirSync(home);state.set('maintenanceHome',home);this.configure(config);},configure(value:MaintenanceConfig){writeFileSync(join(home,'config.json'),JSON.stringify(value));},close(){state.close();rmSync(dir,{recursive:true,force:true});}};
}

test('standalone backend reports not-installed capability and an explicit local setup command without installing anything',()=>{
 const f=fixture();try{
  assert.deepEqual(updateStatus(f.state),{enabled:false,reason:'not_installed',message:'Updates not configured on this backend',installCommand:'bob updates install --help'});
  assert.equal(f.state.get('maintenanceHome'),undefined);
  assert.equal(maintenancePort(f.state),undefined);
 }finally{f.close();}
});

test('configured service distinguishes supervisor heartbeat from missing Android build configuration and keeps receipts',()=>{
 const f=fixture();try{
  f.install();const store=new MaintenanceStore(f.home);
  try{
   const receipt=store.enqueue({id:'retained-request',action:'update',target:'backend'});
   const offline=updateStatus(f.state);
   assert.equal(offline.enabled,true);assert.equal(offline.supervisorOnline,false);
   assert.deepEqual(offline.androidBuild,{configured:false,reason:'Android build/signing prerequisites are not configured on this backend.'});
   assert.deepEqual(offline.jobs,[receipt]);
   assert.match(maintenancePort(f.state)!.describe(),/Android app builds are not configured.*use target=backend/);
   store.set('heartbeat',Date.now());
   assert.equal(updateStatus(f.state).supervisorOnline,true);
   store.set('heartbeat',Date.now()-16000);
   assert.equal(updateStatus(f.state).supervisorOnline,false);
  }finally{store.close();}
 }finally{f.close();}
});

test('Android configuration readiness is additive and does not disclose private config or claim a verified build',()=>{
 const f=fixture();try{
  f.install();
  const complete={...f.config,javaHome:'/private/java',androidHome:'/private/sdk',signingProperties:'/private/signing.properties',referenceApk:'/private/reference.apk'};
  f.configure(complete);
  assert.deepEqual(updateStatus(f.state).androidBuild,{configured:true,reason:undefined});
  assert.doesNotMatch(maintenancePort(f.state)!.describe(),/Android app builds are not configured|\/private/);
  assert.doesNotMatch(JSON.stringify(updateStatus(f.state)),/\/private|signingProperties|serveArgs|sourceRoot/);
  for(const key of ['javaHome','androidHome','signingProperties','referenceApk'] as const){
   f.configure({...complete,[key]:undefined});
   assert.equal(updateStatus(f.state).enabled,true);
   assert.equal(updateStatus(f.state).androidBuild?.configured,false,key);
  }
 }finally{f.close();}
});

test('broken installed configuration is an error, never a false claim that updates are uninstalled',()=>{
 const f=fixture();try{
  f.install();f.configure({...f.config,backendId:'another-backend'});
  assert.throws(()=>updateStatus(f.state),/backend identity mismatch/);
  writeFileSync(join(f.home,'config.json'),'{invalid');
  assert.throws(()=>updateStatus(f.state),SyntaxError);
 }finally{f.close();}
});
