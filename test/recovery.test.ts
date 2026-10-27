import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync,rmSync,symlinkSync,renameSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {backupState,restoreState} from '../src/recovery.js';
test('quiescent SQLite backup, integrity-verified restore, tamper and overwrite refusal',async()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR!,'bob-recovery-')),s=new State(join(dir,'source'));const rt=await openRuntime(s);const c=await rt.harness.createConversation({ownership:{kind:'ownerless'}},ctx);await c.submit({type:'write',entry:{kind:'bob.test',data:{text:'persisted'}}},ctx);
 await assert.rejects(()=>backupState(s,join(dir,'busy')));await rt.close();const manifest=await backupState(s,join(dir,'backup'));assert.equal(manifest.backendId,s.id);const restored=restoreState(join(dir,'backup'),join(dir,'restored'));assert.equal(restored.backendId,s.id);assert.throws(()=>restoreState(join(dir,'backup'),join(dir,'restored')));
 const r=new State(join(dir,'restored')),rr=await openRuntime(r);try{const rc=(await rr.harness.conversation(c.id,ctx))!;assert.ok((await rc.entries({},100,undefined,ctx)).items.some(e=>e.kind==='bob.test'));}finally{await rr.close();r.close();s.close();}
 writeFileSync(join(dir,'backup/control.sqlite'),'tamper');assert.throws(()=>restoreState(join(dir,'backup'),join(dir,'invalid')));
});
test('restore validates complete manifest scope and rejects linked payloads before creating destination',async()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR!,'bob-restore-boundary-')),s=new State(join(dir,'source')),backup=join(dir,'backup');
 const bytes=Buffer.alloc(2000000,37);mkdirSync(join(s.dir,'artifacts'));writeFileSync(join(s.dir,'artifacts/fixture.bin'),bytes);
 try{await backupState(s,backup);}finally{s.close();}
 const manifestPath=join(backup,'manifest.json'),original=readFileSync(manifestPath,'utf8'),manifest=JSON.parse(original);
 const reject=(label:string,pattern:RegExp)=>{const target=join(dir,label);assert.throws(()=>restoreState(backup,target),pattern);assert.equal(existsSync(target),false);};
 rmSync(join(backup,'artifacts/fixture.bin'));symlinkSync(join(dir,'source/artifacts/fixture.bin'),join(backup,'artifacts/fixture.bin'));reject('linked-file',/symlinks/);rmSync(join(backup,'artifacts/fixture.bin'));writeFileSync(join(backup,'artifacts/fixture.bin'),bytes);
 renameSync(join(backup,'artifacts'),join(backup,'retained-artifacts'));symlinkSync(join(backup,'retained-artifacts'),join(backup,'artifacts'));reject('linked-directory',/symlinks/);rmSync(join(backup,'artifacts'));renameSync(join(backup,'retained-artifacts'),join(backup,'artifacts'));
 writeFileSync(manifestPath,JSON.stringify({...manifest,files:{...manifest.files,'artifacts/../control.sqlite':manifest.files['control.sqlite']}}));reject('traversal',/Unsafe/);
 writeFileSync(manifestPath,JSON.stringify({...manifest,files:{...manifest.files,'unrelated.txt':manifest.files['control.sqlite']}}));reject('outside-coverage',/Unsafe/);
 writeFileSync(manifestPath,JSON.stringify({...manifest,bob:'999.0.0'}));reject('wrong-version',/0.1.0/);writeFileSync(manifestPath,original);
 writeFileSync(manifestPath,JSON.stringify({...manifest,backendId:'00000000-0000-4000-8000-000000000001'}));reject('post-copy-identity-failure',/identity mismatch/);writeFileSync(manifestPath,original);
 restoreState(backup,join(dir,'post-copy-identity-failure'));
 symlinkSync(backup,join(dir,'backup-link'));assert.throws(()=>restoreState(join(dir,'backup-link'),join(dir,'linked-root')),/real backup directory/);
 restoreState(backup,join(dir,'good'));assert.deepEqual(readFileSync(join(dir,'good/artifacts/fixture.bin')),bytes);
});
