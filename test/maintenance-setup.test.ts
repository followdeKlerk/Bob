import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtempSync,rmSync,existsSync,readFileSync,openSync,closeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {State} from '../src/state.js';
import {inspectOwner} from '../src/ownership.js';
import {installUpdatesOnHost,updateInstallOptions} from '../src/maintenance-setup.js';
import {dropInDigest,handoverMaintenanceService,unitDigest} from '../src/maintenance-service.js';
import {setupUnitName} from '../src/setup-service.js';
test('host options reject public listeners, incomplete TLS and non-loopback plaintext health checks',t=>{
 const base=mkdtempSync(join(tmpdir(),'bob-update-options-'));t.after(()=>rmSync(base,{recursive:true,force:true}));const stateDir=join(base,'state');const state=new State(stateDir);state.close();
 const args={stateDir,source:process.cwd(),origin:'http://127.0.0.1:49158',host:'127.0.0.1',port:49158,unitDirectory:join(base,'units')};
 for(const host of ['0.0.0.0','100.1.2.3','100.128.2.3','100.64.999.1'])assert.throws(()=>updateInstallOptions({...args,host}),/loopback|Tailscale/);
 assert.throws(()=>updateInstallOptions({...args,cert:'/cert'}),/together/);assert.throws(()=>updateInstallOptions({...args,origin:'http://example.com'}),/loopback/);
 assert.deepEqual(updateInstallOptions(args).serveArgs,['--state',stateDir,'serve','--host','127.0.0.1','--port','49158']);
});
test('real packaged fresh supervisor installs and serves the same identity without Android tools or model calls',{timeout:120000},async t=>{
 const base=mkdtempSync(join(tmpdir(),'bob-update-cold-')),stateDir=join(base,'state'),home=join(base,'maintenance'),units=join(base,'units');
 const state=new State(stateDir);state.set('cwd',base);const backendId=state.id;state.close();
 const reservation=createServer();await new Promise<void>(ok=>reservation.listen(0,'127.0.0.1',ok));const port=(reservation.address() as {port:number}).port;await new Promise<void>((ok,fail)=>reservation.close(error=>error?fail(error):ok()));
 let child:ChildProcess|undefined,verified=false;
 function stop(){if(!child?.pid)return;child.kill('SIGTERM');const until=Date.now()+10000;while(Date.now()<until&&inspectOwner(join(home,'supervisor-owner'))!=='available')Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,30);}
 t.after(()=>{stop();for(const file of [join(base,'supervisor.log'),join(home,'backend.log')])if(!verified&&existsSync(file))t.diagnostic(readFileSync(file,'utf8').slice(-5000));rmSync(base,{recursive:true,force:true});});
 const run=(args:string[])=>{if(args[0]==='enable'){const fd=openSync(join(base,'supervisor.log'),'a',0o600);child=spawn(process.execPath,[join(home,'maintenance-loader.js'),home],{stdio:['ignore',fd,fd],env:{...process.env}});closeSync(fd);}if(args[0]==='stop')stop();return '';};
 const result=await installUpdatesOnHost({stateDir,source:resolve('.'),currentCli:resolve('dist/cli.js'),home,unitDirectory:units,node:process.execPath,origin:`http://127.0.0.1:${port}`,host:'127.0.0.1',port},run);
 assert.equal(result.backendId,backendId);assert.equal(result.androidConfigured,false);assert.equal(result.supervised,true);
 const receipt=JSON.parse(readFileSync(join(home,'installation.json'),'utf8')),root=resolve(receipt.prepared.release.cli,'../..');
 assert.deepEqual(readFileSync(join(root,'package-lock.json')),readFileSync(resolve('package-lock.json')),'installed runtime retains the exact reviewed lock');
 const lock=JSON.parse(readFileSync(resolve('package-lock.json'),'utf8'));
 assert.equal(JSON.parse(readFileSync(join(root,'node_modules/@types/node/package.json'),'utf8')).version,lock.packages['node_modules/@types/node'].version,'new registry metadata cannot upgrade a locked transitive dependency');
 assert.match(readFileSync(join(units,setupUnitName(backendId)),'utf8'),/Restart=always/);
 const db=new DatabaseSync(join(stateDir,'control.sqlite'),{readOnly:true});try{assert.equal(JSON.parse(String(db.prepare("SELECT value FROM config WHERE key='identity'").get()!.value)),backendId);assert.equal(JSON.parse(String(db.prepare("SELECT value FROM config WHERE key='maintenanceHome'").get()!.value)),home);assert.equal(db.prepare('SELECT count(*) AS n FROM devices').get()!.n,0);}finally{db.close();}
 assert.equal(existsSync(join(stateDir,'durable.sqlite')),true);verified=true;
});

test('real live standalone with existing v4 conversations converts without changing identity, phone grant or floor',{timeout:150000},async t=>{
 const {writeFileSync,mkdirSync}=await import('node:fs');const {readControlFloor}=await import('../src/maintenance-migration.js');
 const base=mkdtempSync(join(tmpdir(),'bob-update-live-')),stateDir=join(base,'state'),home=join(base,'maintenance'),units=join(base,'units');
 const state=new State(stateDir);state.set('cwd',base);state.set('preserved-owner-setting',{value:'keep'});const phone=state.pair(state.invite().token,'Existing phone');const backendId=state.id;state.close();
 mkdirSync(units);const unit=join(units,setupUnitName(backendId)),previous='[Service]\nExecStart=original-standalone\n';writeFileSync(unit,previous);
 const reservation=createServer();await new Promise<void>(ok=>reservation.listen(0,'127.0.0.1',ok));const port=(reservation.address() as {port:number}).port;await new Promise<void>((ok,fail)=>reservation.close(error=>error?fail(error):ok()));
 let child=spawn(process.execPath,[resolve('dist/cli.js'),'--state',stateDir,'serve','--host','127.0.0.1','--port',String(port)],{stdio:'ignore'});
 function stop(){if(!child.pid)return;child.kill('SIGTERM');const until=Date.now()+15000;while(Date.now()<until&&(inspectOwner(stateDir)!=='available'||existsSync(join(home,'supervisor-owner'))&&inspectOwner(join(home,'supervisor-owner'))!=='available'))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,30);}
 t.after(()=>{stop();rmSync(base,{recursive:true,force:true});});
 const until=Date.now()+20000;let ready=false;while(Date.now()<until){try{const response=await fetch(`http://127.0.0.1:${port}/v1/pair`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({backendId,invitation:'!'.repeat(43),name:'readiness'}),signal:AbortSignal.timeout(500)});if(response.status===401){ready=true;break;}}catch{}await new Promise(ok=>setTimeout(ok,100));}
 assert.equal(ready,true,'standalone fixture starts');
 const headers={Authorization:'Bearer '+phone.credential,'x-bob-backend':backendId,'content-type':'application/json'};
 const created=await fetch(`http://127.0.0.1:${port}/v1/chats`,{method:'POST',headers,body:JSON.stringify({title:'Preserved owner conversation'})});assert.equal(created.ok,true);
 assert.equal(inspectOwner(stateDir),'owned');const floor=readControlFloor(stateDir,true);
 const beforeDb=new DatabaseSync(join(stateDir,'control.sqlite'),{readOnly:true});let before:any;try{before=beforeDb.prepare("SELECT key,value FROM config WHERE key NOT IN ('maintenanceHome','maintenanceFailureReportsV1') ORDER BY key").all();}finally{beforeDb.close();}
 const run=(args:string[])=>{
  if(args[0]==='list-unit-files')return setupUnitName(backendId)+' enabled';
  if(args.includes('--property=FragmentPath'))return unit;if(args.includes('--property=DropInPaths'))return '';if(args.includes('--property=ActiveState'))return 'active';if(args.includes('--property=UnitFileState'))return 'enabled';
  if(args[0]==='stop')stop();if(args[0]==='enable')child=spawn(process.execPath,[join(home,'maintenance-loader.js'),home],{stdio:'ignore'});return '';
 };
 const result=await installUpdatesOnHost({stateDir,source:resolve('.'),currentCli:resolve('dist/cli.js'),home,unitDirectory:units,node:process.execPath,origin:`http://127.0.0.1:${port}`,host:'127.0.0.1',port,replaceStandalone:true,expectedUnitSha256:unitDigest(previous)},run);
 assert.equal(result.backendId,backendId);assert.deepEqual(readControlFloor(stateDir,true),floor);
 const db=new DatabaseSync(join(stateDir,'control.sqlite'),{readOnly:true});try{assert.deepEqual(db.prepare("SELECT key,value FROM config WHERE key NOT IN ('maintenanceHome','maintenanceFailureReportsV1') ORDER BY key").all(),before);assert.equal(db.prepare('SELECT count(*) AS n FROM devices').get()!.n,1);}finally{db.close();}
 const chats=await fetch(`http://127.0.0.1:${port}/v1/chats`,{headers});assert.equal(chats.ok,true);assert.ok((await chats.json() as {items:{meta:{title:string}}[]}).items.some(chat=>chat.meta.title==='Preserved owner conversation'));
 const receipt=JSON.parse(readFileSync(join(home,'installation.json'),'utf8'));assert.equal(typeof receipt.backup,'string');assert.equal(existsSync(join(receipt.backup,'durable.sqlite')),true);
});
