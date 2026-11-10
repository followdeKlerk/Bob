import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

// Exercise the actual packaged renderer with an inert bridge, without requiring an Android SDK.
// Device IME, Fabric event delivery and Mosh connectivity remain separate acceptance checks.
test('embedded terminal renderer and native boundary retain lifecycle, theme and isolation contracts',()=>{
 const script=fileURLToPath(new URL('../apps/mobile/android/terminal/terminal-renderer-test.cjs',import.meta.url));
 const result=spawnSync(process.execPath,['--test',script],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
 assert.equal(result.status,0,result.error?.message??result.stdout+'\n'+result.stderr);
});
