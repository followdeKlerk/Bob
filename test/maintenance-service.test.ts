import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {dropInDigest,handoverMaintenanceService,unitDigest} from '../src/maintenance-service.js';
import {renderMaintenanceService} from '../src/maintenance-install.js';
import {setupUnitName} from '../src/setup-service.js';
const backendId='11111111-1111-4111-8111-111111111111';
function fixture(t:any,previous?:string){
 const directory=mkdtempSync(join(tmpdir(),'bob-unit-handover-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const name=setupUnitName(backendId),file=join(directory,name),calls:string[]=[],content=renderMaintenanceService('/node','/maintenance',backendId);
 if(previous!==undefined)writeFileSync(file,previous);
 const run=(args:string[])=>{calls.push(args.join(' '));if(args[0]==='list-unit-files')return previous!==undefined?name+' enabled':'';if(args.includes('--property=FragmentPath'))return file;if(args.includes('--property=DropInPaths'))return '';if(args.includes('--property=ActiveState'))return 'active';if(args.includes('--property=UnitFileState'))return 'enabled';return '';};
 const options={directory,backendId,content,prepare:async()=>{calls.push('prepare');return 'package';},commit:async(p:string)=>{assert.equal(p,'package');calls.push('commit');return {rollback:()=>{calls.push('rollback');}};},verify:async()=>{calls.push('verify');}};
 return {directory,name,file,calls,content,run,options};
}
test('supervisor rendering uses private umask, stable loader and bounded graceful stop',()=>{
 const text=renderMaintenanceService('/node','/private/home',backendId);
 assert.match(text,/UMask=0077/);assert.match(text,/TimeoutStopSec=45/);assert.match(text,/"\/node" "\/private\/home\/maintenance-loader.js" "\/private\/home"/);
 assert.throws(()=>renderMaintenanceService('/node','relative',backendId));
});
test('new service packages before committing state, starts and verifies',async t=>{
 const f=fixture(t);await handoverMaintenanceService(f.options,f.run);
 assert.equal(readFileSync(f.file,'utf8'),f.content);assert.ok(f.calls.indexOf('prepare')<f.calls.indexOf('commit'));assert.ok(f.calls.indexOf('commit')<f.calls.indexOf('enable --now '+f.name));assert.equal(f.calls.at(-1),'verify');
});
test('active standalone conversion requires exact consent hash and stages before stopping',async t=>{
 const f=fixture(t,'standalone bytes');await assert.rejects(handoverMaintenanceService(f.options,f.run),/current SHA-256/);assert.ok(!f.calls.some(s=>s.startsWith('stop')));
 await handoverMaintenanceService({...f.options,replaceHash:unitDigest('standalone bytes')},f.run);
 assert.ok(f.calls.indexOf('prepare')<f.calls.indexOf('stop '+f.name));assert.ok(f.calls.indexOf('stop '+f.name)<f.calls.indexOf('commit'));
});
test('failed candidate restores settings and original unit before restarting standalone',async t=>{
 const f=fixture(t,'original unit');await assert.rejects(handoverMaintenanceService({...f.options,replaceHash:unitDigest('original unit'),verify:async()=>{throw Error('unhealthy');}},f.run),/recovery was attempted/);
 assert.equal(readFileSync(f.file,'utf8'),'original unit');assert.ok(f.calls.indexOf('rollback')<f.calls.indexOf('start '+f.name));
});
test('failed fresh installation removes the candidate service',async t=>{
 const f=fixture(t);await assert.rejects(handoverMaintenanceService({...f.options,verify:async()=>{throw Error('unhealthy');}},f.run));assert.equal(existsSync(f.file),false);assert.ok(f.calls.includes('rollback'));
});
test('unrelated unit path, drop-ins, and concurrently changed units cannot be stopped',async t=>{
 for(const problem of ['fragment','dropins','changed']){
  const f=fixture(t,'standalone');const run=(args:string[])=>problem==='fragment'&&args.includes('--property=FragmentPath')?'/elsewhere/unit':problem==='dropins'&&args.includes('--property=DropInPaths')?'/elsewhere/override':f.run(args);
  const prepare=async()=>{if(problem==='changed')writeFileSync(f.file,'changed');return 'package';};
  await assert.rejects(handoverMaintenanceService({...f.options,replaceHash:unitDigest('standalone'),prepare},run));assert.ok(!f.calls.some(s=>s.startsWith('stop')));
 }
});
test('failed ownership commit restarts only the original service and never starts a candidate',async t=>{
 const f=fixture(t,'original');await assert.rejects(handoverMaintenanceService({...f.options,replaceHash:unitDigest('original'),commitFailedCleanly:()=>true,commit:async()=>{throw Error('state owned');}},f.run));
 assert.equal(readFileSync(f.file,'utf8'),'original');assert.ok(!f.calls.some(s=>s.startsWith('enable')));assert.ok(f.calls.includes('start '+f.name));
});

test('explicitly approved drop-ins survive handover and changed drop-ins prevent stopping',async t=>{
 const f=fixture(t,'standalone'),drop=join(f.directory,'environment.conf');writeFileSync(drop,'[Service]\nEnvironment=PATH=/private/bin:/usr/bin\n');
 const digest=dropInDigest([drop]),run=(args:string[])=>args.includes('--property=DropInPaths')?drop:f.run(args);
 await handoverMaintenanceService({...f.options,replaceHash:unitDigest('standalone'),dropInsHash:digest},run);
 assert.equal(readFileSync(drop,'utf8'),'[Service]\nEnvironment=PATH=/private/bin:/usr/bin\n');
 const g=fixture(t,'standalone'),other=join(g.directory,'environment.conf');writeFileSync(other,'[Service]\nEnvironment=PATH=/original\n');const otherDigest=dropInDigest([other]);
 const runOther=(args:string[])=>args.includes('--property=DropInPaths')?other:g.run(args);
 await assert.rejects(handoverMaintenanceService({...g.options,replaceHash:unitDigest('standalone'),dropInsHash:otherDigest,prepare:async()=>{writeFileSync(other,'[Service]\nEnvironment=PATH=/changed\n');return 'package';}},runOther),/drop-ins changed/);
 assert.ok(!g.calls.some(s=>s.startsWith('stop')));
});

test('unknown or incomplete commit cleanup never restarts standalone',async t=>{
 const f=fixture(t,'original');await assert.rejects(handoverMaintenanceService({...f.options,replaceHash:unitDigest('original'),commit:async()=>{throw new AggregateError([Error('cleanup failed')],'metadata rollback incomplete');}},f.run),/not restarted/);
 assert.ok(!f.calls.some(s=>s.startsWith('start ')));assert.ok(!f.calls.some(s=>s.startsWith('enable')));
});
test('approved digests cannot authorize drop-ins overriding loader restart policy',async t=>{
 const f=fixture(t,'original'),drop=join(f.directory,'override.conf');writeFileSync(drop,'[Service]\nRestart=on-failure\n');const run=(args:string[])=>args.includes('--property=DropInPaths')?drop:f.run(args);
 await assert.rejects(handoverMaintenanceService({...f.options,replaceHash:unitDigest('original'),dropInsHash:dropInDigest([drop])},run),/Environment drop-ins/);assert.ok(!f.calls.some(s=>s.startsWith('stop')));
});
