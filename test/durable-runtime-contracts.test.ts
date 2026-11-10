import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {transformSync} from 'esbuild';
import {installedDurableVersion,supportedDurableVersion} from '../src/recovery.js';
import {moduleCatalog,validateModuleManifest} from '../src/modules.js';
import {State} from '../src/state.js';
import {diagnose} from '../src/doctor.js';
import {prepareFreshPi15Floor,prepareFreshPi151Floor,pi151Fingerprint} from '../src/maintenance-migration.js';

test('bundled module declarations match the installed exact native runtime, not a hardcoded release string',()=>{
 const installed=installedDurableVersion();
 assert.equal(installed,JSON.parse(readFileSync(new URL('../package.json',import.meta.resolve('@earendil-works/pi-durable')),'utf8')).version);
 const catalog=moduleCatalog();assert.equal(catalog.length,7);
 for(const module of catalog){assert.equal(module.durable,installed);assert.equal(module.dependencies['@earendil-works/pi-durable'],installed);}
 const manifest=JSON.parse(readFileSync(new URL('../packages/coding/package.json',import.meta.url),'utf8'));
 const other=installed==='1.5.1'?'1.5.0':'1.5.1';
 assert.throws(()=>validateModuleManifest({...manifest,bobExtension:{...manifest.bobExtension,durable:other}},'coding'),/match installed runtime/);
 assert.throws(()=>validateModuleManifest({...manifest,dependencies:{...manifest.dependencies,'@earendil-works/pi-durable':other}},'coding'),/match installed runtime/);
 for(const version of ['1.4.0','1.5.2','1.6.0','^1.5.1','1.5.1-beta.1'])assert.equal(supportedDurableVersion.safeParse(version).success,false,version);
});

test('installed version discovery accepts only the two exact reviewed package identities',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'bob-installed-runtime-'));
 try{
  mkdirSync(join(directory,'native/dist'),{recursive:true});
  // Exercise the production discovery code against disposable package metadata,
  // without modifying installed dependencies or loading a different native runtime.
  let source=readFileSync(new URL('../src/maintenance-migration.ts',import.meta.url),'utf8');
  const entry=pathToFileURL(join(directory,'native/dist/index.js')).href;
  source=source.replace("import.meta.resolve('@earendil-works/pi-durable')",JSON.stringify(entry));
  source=source.replace("'./ownership.js'",JSON.stringify(new URL('../src/ownership.ts',import.meta.url).href));
  writeFileSync(join(directory,'recovery.mjs'),transformSync(source,{loader:'ts',format:'esm',target:'node24'}).code);
  const discovery=await import(pathToFileURL(join(directory,'recovery.mjs')).href);
  for(const version of ['1.5.0','1.5.1']){
   writeFileSync(join(directory,'native/package.json'),JSON.stringify({name:'@earendil-works/pi-durable',version}));
   assert.equal(discovery.installedDurableVersion(),version);
  }
  for(const version of ['1.4.0','1.5.2','1.6.0','1.5.1-beta.1',null]){
   writeFileSync(join(directory,'native/package.json'),JSON.stringify({name:'@earendil-works/pi-durable',version}));
   assert.throws(()=>discovery.installedDurableVersion(),/Unrecognized installed Durable runtime/);
  }
  writeFileSync(join(directory,'native/package.json'),JSON.stringify({name:'impostor',version:'1.5.1'}));
  assert.throws(()=>discovery.installedDurableVersion(),/Unrecognized installed Durable runtime/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});


test('doctor reports the installed runtime and rejects incompatible physical floors without modifying either floor',()=>{
 const directory=mkdtempSync(join(tmpdir(),'bob-doctor-runtime-')),state=new State(join(directory,'state'));
 try{
  prepareFreshPi15Floor(state.dir);
  const historicalBytes=readFileSync(join(state.dir,'control.sqlite')),historical=diagnose(state.dir);
  assert.equal(historical.durable,installedDurableVersion());
  assert.equal(historical.checks.find(check=>check.id==='runtime-floor')?.status,installedDurableVersion()==='1.5.0'?'ok':'error');
  assert.deepEqual(readFileSync(join(state.dir,'control.sqlite')),historicalBytes);
  prepareFreshPi151Floor(state.dir,{id:'doctor-fixture',cli:join(directory,'dist/cli.js'),durableVersion:'1.5.1',compatibility:pi151Fingerprint});
  const patchBytes=readFileSync(join(state.dir,'control.sqlite')),patch=diagnose(state.dir);
  assert.equal(patch.durable,installedDurableVersion());assert.equal(patch.controlSchema,4);
  assert.equal(patch.checks.find(check=>check.id==='runtime-floor')?.status,installedDurableVersion()==='1.5.1'?'ok':'error');
  assert.deepEqual(readFileSync(join(state.dir,'control.sqlite')),patchBytes);
 }finally{state.close();rmSync(directory,{recursive:true,force:true});}
});
