import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,existsSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {State} from '../src/state.js';
import {diagnose} from '../src/doctor.js';
import {acquireOwner} from '../src/ownership.js';
const run=(directory:string,args:string[]=[])=>spawnSync(process.execPath,['--import','tsx','src/cli.ts','--state',directory,'doctor',...args],{encoding:'utf8'});
test('doctor never initializes missing state and --check opts into failure exit',()=>{
 const dir=join(mkdtempSync(join(tmpdir(),'bob-doctor-')),'missing');
 const result=run(dir,['--check']);assert.equal(result.status,1,result.stderr);
 const report=JSON.parse(result.stdout);assert.equal(report.status,'error');assert.equal(report.state,dir);assert.ok(report.checks.find((c:any)=>c.id==='state'));
 assert.equal(existsSync(dir),false);assert.equal(run(dir).status,0);assert.equal(existsSync(dir),false);
});
test('doctor inspects configured state without rewriting config or exposing credentials',()=>{
 const dir=mkdtempSync(join(tmpdir(),'bob-doctor-'));const s=new State(dir);
 s.set('cwd',dir);s.set('model',{provider:'openai',modelId:'fixture',unexpectedSecret:'private-model-field'});s.set('openaiKey','private-provider-key');
 const browser=join(dir,'chromium');writeFileSync(browser,'fixture',{mode:0o700});s.set('browserExecutable',browser);
 const rows=s.db.prepare('SELECT * FROM config ORDER BY key').all();s.close();
 const path=join(dir,'control.sqlite'),before=readFileSync(path),mode=statSync(path).mode;
 const result=run(dir,['--check']);assert.equal(result.status,0,result.stderr);const report=JSON.parse(result.stdout);
 assert.equal(report.providerCredentialPresent,true);assert.equal(report.browser.executablePresent,true);assert.equal(report.ownership,'available');
 assert.doesNotMatch(result.stdout,/private-provider-key|private-model-field/);assert.deepEqual(readFileSync(path),before);assert.equal(statSync(path).mode,mode);
 const release=acquireOwner(dir);try{assert.equal(diagnose(dir).ownership,'owned');}finally{release();}
 const reopened=new State(dir);assert.deepEqual(reopened.db.prepare('SELECT * FROM config ORDER BY key').all(),rows);
 reopened.set('cwd',join(dir,'missing'));reopened.delete('openaiKey');reopened.close();
 const bad=JSON.parse(run(dir,['--check']).stdout);assert.equal(bad.status,'error');assert.ok(bad.checks.some((c:any)=>c.id==='working-directory'&&c.status==='error'));assert.ok(bad.checks.some((c:any)=>c.id==='credentials'&&c.status==='error'));
});
test('doctor reports corrupt/unsupported state without dumping stored data',()=>{
 const dir=mkdtempSync(join(tmpdir(),'bob-doctor-'));writeFileSync(join(dir,'control.sqlite'),'private-corrupt-data');
 const result=run(dir,['--check']);assert.equal(result.status,1);assert.doesNotMatch(result.stdout+result.stderr,/private-corrupt-data/);
 const other=mkdtempSync(join(tmpdir(),'bob-doctor-'));const s=new State(other);s.db.exec('PRAGMA user_version=99');s.close();assert.equal(diagnose(other).status,'error');
});
