import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {rawCompatibilityFingerprint,compatibilityFingerprint} from '../src/maintenance.js';
import {assertPi15Pair,assertBridgeBuild,pi151Fingerprint} from '../src/maintenance-migration.js';

const original='5c798ab849e5ebf456f1aa4da70f8ef88f87af72bd8e709292083776ba1d0b45';
const converted='95750e8918ed663e0607933a0e3867674fec8098d32981b45008b15806a072f9';
const legacy='328bbd2b3ec5505199382f781d7dc2dc5359e17b8356c92daef8be53155f8003';
const patchBridge='2a4bc4fcd5898898e00e03fb5d89702df671c264061eb2d8eff983e086e2f60c';
const files=['src/control-migrations.ts','packages/core/src/documents.ts','packages/subagents/src/index.ts','packages/peers/src/index.ts','packages/interactive/src/index.ts'];
test('only the exact reviewed schema conversion shares the Pi1.5 persistence identity',()=>{
 const root=new URL('..',import.meta.url).pathname,dir=mkdtempSync(join(tmpdir(),'bob-schema-fingerprint-'));
 try{
  for(const file of ['package.json',...files]){mkdirSync(dirname(join(dir,file)),{recursive:true});writeFileSync(join(dir,file),readFileSync(join(root,file)));}
  const raw=rawCompatibilityFingerprint(dir);assert.ok([original,converted,patchBridge,pi151Fingerprint].includes(raw),'Run this proof only against an exact reviewed source identity');
  assert.equal(compatibilityFingerprint(dir),raw===pi151Fingerprint?pi151Fingerprint:original);
  for(const file of files){
   const source=readFileSync(join(dir,file));writeFileSync(join(dir,file),Buffer.concat([source,Buffer.from('\n')]));
   const changed=rawCompatibilityFingerprint(dir);assert.notEqual(changed,raw);assert.equal(compatibilityFingerprint(dir),changed,'Unreviewed bytes must not gain an alias');
   assert.throws(()=>assertBridgeBuild({id:'old',cli:'unused',compatibility:original,durableVersion:'1.5.0'},{compatibility:changed,durableVersion:'1.5.0'},undefined),/allowlist/);
   writeFileSync(join(dir,file),source);
  }
  const manifest=JSON.parse(readFileSync(join(dir,'package.json'),'utf8'));
  for(const dependency of ['@earendil-works/pi-durable','@earendil-works/pi-ai','@earendil-works/chord']){
   const changed=structuredClone(manifest);changed.dependencies[dependency]=manifest.dependencies[dependency]==='1.5.1'?'1.5.2':'1.5.1';writeFileSync(join(dir,'package.json'),JSON.stringify(changed));
   assert.notEqual(compatibilityFingerprint(dir),original);assert.equal(compatibilityFingerprint(dir),rawCompatibilityFingerprint(dir));
  }
  assert.doesNotThrow(()=>assertPi15Pair(legacy,original));
  assert.throws(()=>assertPi15Pair(legacy,converted),/allowlist/,'Raw alias is not a new native migration pin');
  assert.throws(()=>assertPi15Pair(original,converted),/allowlist/,'Schema conversion never runs the native migration');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
