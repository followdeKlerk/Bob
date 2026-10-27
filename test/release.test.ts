import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {releaseVersion} from '../src/update.js';
import {State} from '../src/state.js';
import {backupState,restoreState} from '../src/recovery.js';

test('release manifests, CLI identity and current backup format stay aligned',async()=>{
 const read=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
 for(const dir of ['','apps/mobile/']){
  const version=read(dir+'package.json').version;if(dir==='')assert.equal(version,releaseVersion);
  const lock=read(dir+'package-lock.json');assert.equal(lock.version,version);assert.equal(lock.packages[''].version,version);
 }
 assert.ok(readFileSync('apps/mobile/android/app/build.gradle','utf8').includes(`versionName "${read('apps/mobile/package.json').version}"`));
 const root=mkdtempSync(join(process.env.TMPDIR!,'bob-release-')),s=new State(join(root,'state'));
 try{const manifest=await backupState(s,join(root,'backup'));assert.equal(manifest.bob,releaseVersion);const restored=restoreState(join(root,'backup'),join(root,'restored'));assert.equal(restored.backendId,s.id);}finally{s.close();}
});
