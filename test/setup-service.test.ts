import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,chmodSync,symlinkSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {State} from '../src/state.js';
import {acquireOwner} from '../src/ownership.js';
import {inspectSetup,saveSetupConnection} from '../src/setup-host.js';
import {connectionEndpoint,installSetupService,renderSetupService,setupUnitName,systemdQuote,validateConnection,validateEndpoint,verifyCertificate,verifySetupEndpoint} from '../src/setup-service.js';
const id='11111111-1111-4111-8111-111111111111';
const connection={host:'100.64.1.2',hostname:'machine.tailnet.ts.net',port:49158,cert:'/private/cert.pem',key:'/private/key.pem'};
const temp=()=>mkdtempSync(join(tmpdir(),'bob-setup-test-'));
test('connection and unit validation reject public binds, injection, insecure origins and privileged ports',()=>{
 assert.equal(connectionEndpoint(connection),'https://machine.tailnet.ts.net:49158');
 for(const host of ['0.0.0.0','127.0.0.1','100.64.attacker.example','100.64.01.2','100.128.0.1','100.64.256.1'])assert.throws(()=>validateConnection({...connection,host}));
 for(const hostname of ['example.com','machine.ts.net.evil','x.ts.net\nInjected=1','-x.ts.net'])assert.throws(()=>validateConnection({...connection,hostname}));
 for(const port of [0,443,65536,1.5])assert.throws(()=>validateConnection({...connection,port}));
 for(const value of ['http://machine.ts.net','https://user:secret@machine.ts.net','https://machine.ts.net/path','https://machine.ts.net/?x=1'])assert.throws(()=>validateEndpoint(value));
 assert.throws(()=>systemdQuote('x\nExecStart=bad'));assert.throws(()=>setupUnitName('../../bad'));
 assert.equal(systemdQuote('/a/$value%name"\\b'),'"/a/$$value%%name\\"\\\\b"');
});
test('user service has exact executable/state/TLS paths, private umask and no unrelated authority changes',()=>{
 const content=renderSetupService('/node path/node','/checkout/bob/dist/cli.js','/private/state',id,connection);
 assert.match(content,/UMask=0077/);assert.match(content,/"--cert" "\/private\/cert.pem" "--key" "\/private\/key.pem"/);assert.match(content,/WantedBy=default.target/);
 assert.doesNotMatch(content,/sudo|User=root|0\.0\.0\.0|disable.*tls|NODE_TLS_REJECT_UNAUTHORIZED/);
 const directory=temp(),name=setupUnitName(id);assert.equal(installSetupService(directory,name,content).created,true);const path=join(directory,name),before=readFileSync(path);
 assert.equal(statSync(path).mode&0o777,0o600);assert.equal(installSetupService(directory,name,content).created,false);
 assert.throws(()=>installSetupService(directory,name,content+'changed'),/not overwritten/);assert.deepEqual(readFileSync(path),before);
 const another=temp();symlinkSync(path,join(another,name));assert.throws(()=>installSetupService(another,name,content),/not overwritten/);
});
test('existing state inspection is read-only, excludes secrets, detects ownership/managed state and refuses ambiguous paths',()=>{
 const base=temp(),missing=join(base,'missing');assert.equal(inspectSetup(missing,join(base,'none')).exists,false);assert.equal(existsSync(missing),false);
 writeFileSync(join(base,'unrelated'),'keep');assert.throws(()=>inspectSetup(base),/nonempty/);
 const path=join(base,'state'),s=new State(path);s.set('cwd',base);s.set('model',{provider:'openai',modelId:'fixture'});s.set('openaiKey','do-not-print-this');s.set('maintenanceHome','/managed');const rows=s.db.prepare('SELECT * FROM config ORDER BY key').all();s.close();
 const report=inspectSetup(path,join(base,'none'));assert.equal(report.configurationReady,true);assert.equal(report.managed,true);assert.equal(report.owned,false);assert.doesNotMatch(JSON.stringify(report),/do-not-print-this/);
 const release=acquireOwner(path);try{assert.equal(inspectSetup(path,join(base,'none')).owned,true);}finally{release();}
 const reopened=new State(path);assert.deepEqual(reopened.db.prepare('SELECT * FROM config ORDER BY key').all(),rows);reopened.close();
 const link=join(base,'linked');symlinkSync(path,link);assert.throws(()=>inspectSetup(link),/symlink/);
 const corrupt=join(base,'corrupt'),bad=new State(corrupt);bad.db.exec('PRAGMA user_version=99');bad.close();assert.throws(()=>inspectSetup(corrupt),/safely inspected/);
});
test('TLS material must match the hostname/key and keep the key private',()=>{
 const dir=temp(),cert=join(dir,'cert.pem'),key=join(dir,'key.pem');
 const result=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=machine.tailnet.ts.net','-addext','subjectAltName=DNS:machine.tailnet.ts.net'],{stdio:'ignore'});assert.equal(result.status,0);
 chmodSync(key,0o600);verifyCertificate({...connection,cert,key});
 assert.throws(()=>verifyCertificate({...connection,hostname:'other.tailnet.ts.net',cert,key}),/another host/);
 chmodSync(key,0o644);assert.throws(()=>verifyCertificate({...connection,cert,key}),/owner-only/);chmodSync(key,0o600);
 const link=join(dir,'key-link');symlinkSync(key,link);assert.throws(()=>verifyCertificate({...connection,cert,key:link}),/regular files/);
});
test('guided setup rejects noninteractive invocation without initializing state; legacy setup stays scriptable',()=>{
 const dir=join(temp(),'state');const run=(args:string[])=>spawnSync(process.execPath,['dist/cli.js','--state',dir,'setup',...args],{encoding:'utf8'});
 const denied=run(['--guided']);assert.notEqual(denied.status,0);assert.match(denied.stderr,/interactive local terminal|non-root/);assert.equal(existsSync(dir),false);
 const existing=temp(),legacy=run(['--cwd',existing]);assert.equal(legacy.status,0,legacy.stderr);assert.equal(JSON.parse(legacy.stdout).state,dir);
});
test('real HTTPS readiness validates backend identity and certificate without consuming an invitation or registering a device',{timeout:20000},async()=>{
 const {serve}=await import('../src/server.js');
 const dir=temp(),cert=join(dir,'cert.pem'),key=join(dir,'key.pem');
 assert.equal(spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=machine.tailnet.ts.net','-addext','subjectAltName=DNS:machine.tailnet.ts.net'],{stdio:'ignore'}).status,0);
 const state=new State(join(dir,'state'));state.invite();const before=state.db.prepare('SELECT * FROM invites').all();
 const app=await serve(state,{host:'127.0.0.1',port:0,tls:{cert,key}});
 try{
  const endpoint=`https://machine.tailnet.ts.net:${(app.server.address() as {port:number}).port}`;
  const lookup:any=(_:string,options:any,callback:any)=>options.all?callback(null,[{address:'127.0.0.1',family:4}]):callback(null,'127.0.0.1',4);
  await verifySetupEndpoint(endpoint,state.id,{ca:readFileSync(cert),lookup});
  await assert.rejects(verifySetupEndpoint(endpoint,id,{ca:readFileSync(cert),lookup}),/Could not verify/);
  await assert.rejects(verifySetupEndpoint(endpoint,state.id,{lookup}),/Could not verify/);
  assert.deepEqual(state.db.prepare('SELECT * FROM invites').all(),before);assert.equal(state.db.prepare('SELECT COUNT(*) AS n FROM devices').get()?.n,0);
 }finally{await app.close();state.close();}
});

test('rejected service changes preserve the previous connection metadata and service bytes',()=>{
 const state=temp(),units=temp(),node='/exact/node',cli='/exact/cli.js',name=setupUnitName(id),content=renderSetupService(node,cli,state,id,connection);
 const file=join(state,'setup-connection.json');writeFileSync(file,JSON.stringify(connection));installSetupService(units,name,content);
 const before=readFileSync(file),calls:string[][]=[],run=(_:string,args:string[])=>{calls.push(args);return args.includes('list-unit-files')?name+' enabled':join(units,name);};
 assert.throws(()=>saveSetupConnection(state,id,{...connection,port:49159},units,node,cli,run),/not overwritten/);
 assert.deepEqual(readFileSync(file),before);assert.equal(readFileSync(join(units,name),'utf8'),content);
 saveSetupConnection(state,id,connection,units,node,cli,run);assert.deepEqual(JSON.parse(readFileSync(file,'utf8')),connection);assert.equal(statSync(file).mode&0o777,0o600);
 assert.ok(calls.some(args=>args.includes('list-unit-files')));
 const saved=readFileSync(file);assert.throws(()=>saveSetupConnection(state,id,connection,units,node,cli,()=>'/elsewhere/unit.service'),/managed elsewhere/);assert.deepEqual(readFileSync(file),saved);
});
