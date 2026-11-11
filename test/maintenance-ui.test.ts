import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {MaintenanceStore,compatibilityFingerprint,type MaintenanceConfig,type Release} from '../src/maintenance.js';
import {buildRelease} from '../src/maintenance-build.js';
import {sourceManifest,sameManifest,uiFastPath,createUiBaseline,uiBaselineKey,mobilePackageVersion,type UiBaseline} from '../src/maintenance-ui.js';

function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'bob-ui-validation-')),root=join(dir,'source');mkdirSync(root);
 const put=(path:string,text:string,mode=0o600)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),text,{mode});};
 put('package.json',JSON.stringify({name:'@bob-local/cli',version:'0.3.0',dependencies:{'@earendil-works/pi-durable':'1.4.0','@earendil-works/pi-ai':'1.4.0','@earendil-works/chord':'1.4.0'}}));
 for(const path of ['src/control-migrations.ts','packages/core/src/documents.ts','packages/subagents/src/index.ts','packages/peers/src/index.ts','packages/interactive/src/index.ts'])put(path,'// stable input\n');
 put('apps/mobile/android/app/build.gradle','android {\n defaultConfig {\n  versionCode 100\n  versionName "0.3.100"\n }\n}\n');
 put('apps/mobile/package.json','{\n  "version": "0.3.100",\n  "dependencies": {"react": "19.3.0"}\n}\n');
 put('apps/mobile/package-lock.json','{"version":"0.3.100","packages":{"":{"version":"0.3.100"},"node_modules/example":{"version":"1.0.0"}}}\n');
 put('apps/mobile/theme-tokens.ts','export const color="black";\n');
 put('apps/mobile/App.tsx','// application wiring\n');
 put('tools/build.sh','echo stable\n',0o700);
 const cli=join(dir,'active-cli.js');writeFileSync(cli,'// immutable active CLI\n');
 const release:Release={id:'validated',cli,sourceHash:'a'.repeat(64),compatibility:compatibilityFingerprint(root),durableVersion:'1.4.0'};
 const baseline=()=>createUiBaseline(root,release,sourceManifest(root));
 return {dir,root,put,release,baseline,close(){rmSync(dir,{recursive:true,force:true});}};
}

test('only android accepts an exact validated baseline and existing reviewed presentation changes',()=>{
 const f=fixture();try{
  const b=f.baseline();f.put('apps/mobile/theme-tokens.ts','export const color="white";\n');
  const current=sourceManifest(f.root);
  for(const target of ['all','backend','unknown',''])assert.equal(uiFastPath(target,f.root,current,b,f.release,f.release).eligible,false,target);
  const decision=uiFastPath('android',f.root,current,b,f.release,f.release);
  assert.equal(decision.eligible,true);assert.equal(decision.baselineId,'validated');assert.deepEqual(decision.changedFiles,['apps/mobile/theme-tokens.ts']);
  assert.equal(uiFastPath('android',f.root,b.manifest,b,f.release,f.release).eligible,true,'version-only/no-op builds are safe');
 }finally{f.close();}
});

test('missing, unknown, malformed, mismatched and unproven baselines fail closed',()=>{
 const f=fixture();try{
  const b=f.baseline(),m=sourceManifest(f.root);
  for(const baseline of [undefined,null,{},'HEAD',{...b,policy:2},{...b,root:f.dir},{...b,manifest:{policy:1,files:[]}}, {...b,manifest:{policy:1,files:{'../escape':'f'.repeat(64)}}},{...b,manifest:{policy:1,files:{x:'not-a-hash'}}},{...b,sourceHash:undefined}])assert.equal(uiFastPath('android',f.root,m,baseline,f.release,f.release).eligible,false);
  for(const validated of [undefined,{...f.release,id:'other'},{...f.release,sourceHash:'different'},{...f.release,compatibility:'different'},{...f.release,durableVersion:'1.5.0'}])assert.equal(uiFastPath('android',f.root,m,b,validated,f.release).eligible,false);
  for(const active of [undefined,{...f.release,cli:''},{...f.release,cli:join(f.dir,'missing')},{...f.release,cli:f.dir},{...f.release,compatibility:'different'},{...f.release,durableVersion:'1.5.0'}])assert.equal(uiFastPath('android',f.root,m,b,f.release,active).eligible,false);
  assert.equal(uiFastPath('android',f.root,undefined,b,f.release,f.release).eligible,false);
 }finally{f.close();}
});

for(const path of ['apps/mobile/App.tsx','apps/mobile/network-policy.ts','apps/mobile/notes-store.ts','apps/mobile/theme-provider.tsx','apps/mobile/components/notes-screen.tsx','apps/mobile/android/app/src/main/java/com/bobmobile/MainApplication.kt','apps/mobile/package.json','apps/mobile/babel.config.js','packages/core/src/documents.ts','src/control-migrations.ts','test/backend.test.ts','tools/build.sh','.github/workflows/build.yml','.env','build/custom-script.sh'])test('risky or unknown input falls back: '+path,()=>{
 const f=fixture();try{
  if(!['apps/mobile/package.json','apps/mobile/App.tsx','packages/core/src/documents.ts','src/control-migrations.ts','tools/build.sh'].includes(path))f.put(path,'// before\n');
  const b=f.baseline();f.put(path,path==='apps/mobile/package.json'?'{"version":"0.3.100","dependencies":{"react":"99.0.0"}}':'// changed\n');
  assert.equal(uiFastPath('android',f.root,sourceManifest(f.root),b,f.release,f.release).eligible,false);
 }finally{f.close();}
});

test('new/deleted/renamed inputs never count as reviewed existing-file changes',()=>{
 for(const operation of ['new','deleted','renamed']){
  const f=fixture();try{
   const b=f.baseline();
   if(operation!=='new')rmSync(join(f.root,'apps/mobile/theme-tokens.ts'));
   if(operation!=='deleted')f.put('apps/mobile/components/edge-fade.tsx','// a new allowlisted name still needs full checks\n');
   assert.equal(uiFastPath('android',f.root,sourceManifest(f.root),b,f.release,f.release).eligible,false,operation);
  }finally{f.close();}
 }
});

test('only release version fields normalize; dependency/native edits and formatting remain visible',()=>{
 const f=fixture();try{
  const b=f.baseline();
  for(const file of ['apps/mobile/package.json','apps/mobile/package-lock.json'])f.put(file,mobilePackageVersion(readFileSync(join(f.root,file),'utf8'),file.endsWith('package-lock.json'),'0.3.101'));
  f.put('apps/mobile/android/app/build.gradle',readFileSync(join(f.root,'apps/mobile/android/app/build.gradle'),'utf8').replace('versionCode 100','versionCode 101').replace('"0.3.100"','"0.3.101"'));
  assert.ok(sameManifest(b.manifest,sourceManifest(f.root)));
  assert.equal(uiFastPath('android',f.root,sourceManifest(f.root),b,f.release,f.release).eligible,true);
  f.put('apps/mobile/package-lock.json',readFileSync(join(f.root,'apps/mobile/package-lock.json'),'utf8').replace('"1.0.0"','"2.0.0"'));
  assert.equal(uiFastPath('android',f.root,sourceManifest(f.root),b,f.release,f.release).eligible,false,'nested dependency version is not generated release metadata');
  f.put('apps/mobile/package-lock.json','{"version":"0.3.101","packages":{"":{"version":"0.3.101"},"node_modules/example":{"version":"1.0.0"}}}\n');
  f.put('apps/mobile/package.json',readFileSync(join(f.root,'apps/mobile/package.json'),'utf8')+' ');
  assert.equal(uiFastPath('android',f.root,sourceManifest(f.root),b,f.release,f.release).eligible,false,'no JSON reserialization masking');
 }finally{f.close();}
});

test('version rewrite preserves every other byte including nested dependency versions',()=>{
 const text=' { "version" : "1.2.3", "packages": { "": {"version":"1.2.3"}, "dep":{"version":"1.2.3"}}, "escaped\\\"key": [true,null,{"version":"1.2.3"}] }\n';
 assert.equal(mobilePackageVersion(text,true,'2.3.4'),text.replace('"version" : "1.2.3"','"version" : "2.3.4"').replace('"": {"version":"1.2.3"}','"": {"version":"2.3.4"}'));
 assert.throws(()=>mobilePackageVersion('{bad json}',true));
});

test('Gradle fields outside the two generated values and executable mode are inputs',()=>{
 const f=fixture();try{
  const b=f.baseline();
  f.put('apps/mobile/android/app/build.gradle',readFileSync(join(f.root,'apps/mobile/android/app/build.gradle'),'utf8')+'// native config change\n');
  assert.equal(uiFastPath('android',f.root,sourceManifest(f.root),b,f.release,f.release).eligible,false);
  assert.throws(()=>{f.put('apps/mobile/android/app/build.gradle','versionCode 1\nversionCode 2\nversionName "1.2.3"\n');sourceManifest(f.root);},/version metadata/);
  f.put('apps/mobile/android/app/build.gradle','android {\n defaultConfig {\n  versionCode 100\n  versionName "0.3.100"\n }\n}\n');
  chmodSync(join(f.root,'tools/build.sh'),0o600);
  assert.equal(uiFastPath('android',f.root,sourceManifest(f.root),b,f.release,f.release).eligible,false);
 }finally{f.close();}
});

for(const kind of ['leaf','directory','dangling','excluded-output'])test('hostile symlinks disable manifest: '+kind,()=>{
 const f=fixture();try{
  const path=kind==='excluded-output'?'dist':kind==='leaf'?'apps/mobile/theme-tokens.ts':kind==='directory'?'tools':'dangling';
  rmSync(join(f.root,path),{recursive:true,force:true});symlinkSync(kind==='dangling'?join(f.dir,'missing'):kind==='directory'?f.dir:f.release.cli,join(f.root,path));
  assert.throws(()=>sourceManifest(f.root),/Symlink/);
 }finally{f.close();}
});

test('known generated outputs do not invalidate a source manifest, arbitrary build directories do',()=>{
 const f=fixture();try{
  const before=sourceManifest(f.root);
  for(const path of ['dist/cli.js','packages/core/dist/index.js','apps/mobile/android/app/build/outputs/app.apk','apps/mobile/android/app/src/main/assets/bob-host.js','apps/mobile/android/.gradle/cache','node_modules/pkg/index.js'])f.put(path,'generated');
  assert.ok(sameManifest(before,sourceManifest(f.root)));
  f.put('tools/build/helper.ts','not generated');assert.ok(!sameManifest(before,sourceManifest(f.root)));
 }finally{f.close();}
});

function builderFixture(){
 const f=fixture(),home=join(f.dir,'maintenance'),bin=join(f.dir,'bin'),control=join(f.dir,'control.json'),commands=join(f.dir,'commands.jsonl');mkdirSync(bin);
 writeFileSync(control,'{}');
 const script=`#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');
const root=${JSON.stringify(f.root)},control=${JSON.stringify(control)},commands=${JSON.stringify(commands)};
const cmd=path.basename(process.argv[1]),args=process.argv.slice(2),cwd=process.cwd(),mobile=cwd===path.join(root,'apps/mobile');
const op=cmd==='npm'?(args[0]==='test'?(mobile?'mobile-jest':'backend-tests'):args[0]==='run'?(args.includes('--workspace')?'core-build':args[1]):args[0]):cmd;
fs.appendFileSync(commands,JSON.stringify({cmd,args,cwd,op})+'\\n');
const settings=JSON.parse(fs.readFileSync(control,'utf8'));
if(settings.fail===op)process.exit(23);
if(op==='core-build'){
 const contracts=path.join(root,'packages/core/dist/contracts.js');fs.mkdirSync(path.dirname(contracts),{recursive:true});fs.writeFileSync(contracts,'// rebuilt shared contracts');
}
if(cmd==='gradlew'){
 const apk=path.join(root,'apps/mobile/android/app/build/outputs/apk/release/app-release.apk');fs.mkdirSync(path.dirname(apk),{recursive:true});fs.writeFileSync(apk,'signed fixture apk');
 if(settings.mutate)fs.writeFileSync(path.join(root,settings.mutate),'changed during build');
}
if(cmd==='apksigner')console.log('Signer #1 certificate SHA-256 digest: '+(settings.badSigner&&args.at(-1).endsWith('reference.apk')?'b':'a').repeat(64));
if(cmd==='aapt'){
 const gradle=fs.readFileSync(path.join(root,'apps/mobile/android/app/build.gradle'),'utf8');
 console.log("package: name='com.bobmobile' versionCode='"+gradle.match(/versionCode\\s+(\\d+)/)[1]+"' versionName='"+gradle.match(/versionName\\s+\"([^\"]+)\"/)[1]+"'");
}
if(cmd==='npm'&&args[0]==='install'){
 const pkg=path.join(args[args.indexOf('--prefix')+1],'node_modules/@bob-local/cli');fs.mkdirSync(path.join(pkg,'dist'),{recursive:true});
 fs.writeFileSync(path.join(pkg,'package.json'),JSON.stringify({name:'@bob-local/cli',dependencies:{'@earendil-works/pi-durable':'1.4.0'}}));
 fs.writeFileSync(path.join(pkg,'dist/cli.js'),'// installed fixture cli');
}
`;
 const executable=(path:string)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,script,{mode:0o700});};
 for(const name of ['node','npm'])executable(join(bin,name));
 executable(join(f.root,'node_modules/.bin/tsc'));
 executable(join(f.root,'apps/mobile/android/gradlew'));
 for(const name of ['apksigner','aapt'])executable(join(f.dir,'android/build-tools/36.0.0',name));
 const config:MaintenanceConfig={sourceRoot:f.root,stateDir:join(f.dir,'state'),backendId:'test',node:join(bin,'node'),serveArgs:[],origin:'http://127.0.0.1',javaHome:join(f.dir,'java'),androidHome:join(f.dir,'android'),signingProperties:join(f.dir,'signing.properties'),referenceApk:join(f.dir,'reference.apk')};
 const store=new MaintenanceStore(home);store.set('active',f.release);
 let serial=0;
 return {...f,store,control,
  settings(value:unknown){writeFileSync(control,JSON.stringify(value));},
  clear(){writeFileSync(commands,'');},
  operations(){return readFileSync(commands,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line).op as string);},
  async build(target:'android'|'all'|'backend'='android'){
   const job=store.enqueue({id:'job-'+(++serial),action:'build',target});return {job,release:await buildRelease(home,config,store,job)};
  },
  close(){store.close();f.close();}
 };
}

test('first Android build validates fully; later UI fast build keeps all mobile/signing checks and never advances baseline',async()=>{
 const f=builderFixture();try{
  const first=await f.build(),baseline=f.store.get<UiBaseline>(uiBaselineKey)!;
  assert.equal(baseline.releaseId,first.release.id);assert.equal(f.store.job(first.job.id)?.validation?.lane,'full');
  assert.match(f.store.job(first.job.id)!.validation!.reason,/no fully validated/);
  for(const op of ['build','backend-tests','build:interactive','tsc','mobile-jest','gradlew','apksigner','aapt','pack','install','node'])assert.ok(f.operations().includes(op),op);
  f.clear();f.put('apps/mobile/theme-tokens.ts','export const color="white";\n');
  f.put('packages/core/dist/contracts.js','// stale generated contracts from a different backend build');
  const fast=await f.build();assert.equal(f.store.job(fast.job.id)?.validation?.lane,'ui-fast');
  assert.equal(fast.release.cli,f.release.cli,'only android may reuse active CLI');
  for(const op of ['build','backend-tests','pack','install','node'])assert.ok(!f.operations().includes(op),op+' must be skipped');
  for(const op of ['core-build','build:interactive','tsc','mobile-jest','gradlew','apksigner','aapt'])assert.ok(f.operations().includes(op),op+' is mandatory');
  assert.ok(f.operations().indexOf('core-build')<f.operations().indexOf('tsc'));
  assert.equal(readFileSync(join(f.root,'packages/core/dist/contracts.js'),'utf8'),'// rebuilt shared contracts');
  assert.deepEqual(f.store.get(uiBaselineKey),baseline);
  assert.ok(fast.release.apk!.versionCode>first.release.apk!.versionCode,'normal version bump still runs');
  f.clear();const again=await f.build();assert.equal(f.store.job(again.job.id)?.validation?.lane,'ui-fast','normal generated bumps never poison baseline');
  assert.deepEqual(f.store.get(uiBaselineKey),baseline);
 }finally{f.close();}
});

for(const target of ['all','backend'] as const)test(target+' always runs backend compilation, tests and packaging',async()=>{
 const f=builderFixture();try{
  await f.build();f.clear();f.put('apps/mobile/theme-tokens.ts','// reviewed visual edit\n');
  const result=await f.build(target);
  assert.equal(f.store.job(result.job.id)?.validation?.lane,'full');assert.notEqual(result.release.cli,f.release.cli);
  for(const op of ['build','backend-tests','pack','install','node'])assert.ok(f.operations().includes(op),op);
  if(target==='backend')assert.ok(!f.operations().includes('mobile-jest'));
 }finally{f.close();}
});

test('full backend suite retains its ten-minute performance budget',async t=>{
 const deadlines:number[]=[],original=globalThis.setTimeout;
 t.mock.method(globalThis,'setTimeout',((callback:Parameters<typeof setTimeout>[0],delay?:number,...args:unknown[])=>{deadlines.push(delay??0);return original(callback,delay,...args);}) as typeof setTimeout);
 const f=builderFixture();try{
  await f.build('backend');
  assert.deepEqual(deadlines.slice(0,2),[1800000,600000],'backend checks retain their ten-minute budget; improve work rather than hiding a slowdown');
  assert.ok(f.operations().includes('backend-tests'));
 }finally{f.close();}
});

test('risky delta triggers full fallback and successful full checks replace the baseline',async()=>{
 const f=builderFixture();try{
  await f.build();f.put('tools/build.sh','echo risky change\n');f.clear();
  const full=await f.build();assert.equal(f.store.job(full.job.id)?.validation?.lane,'full');assert.match(f.store.job(full.job.id)!.validation!.reason,/outside reviewed/);
  assert.equal(f.store.get<UiBaseline>(uiBaselineKey)?.releaseId,full.release.id);assert.ok(f.operations().includes('backend-tests'));
 }finally{f.close();}
});

for(const fail of ['build','backend-tests','build:interactive','tsc','mobile-jest','gradlew','apksigner','aapt','pack','install','node'])test('failed full check cannot advance baseline: '+fail,async()=>{
 const f=builderFixture();try{
  await f.build();const before=f.store.get(uiBaselineKey);f.put('tools/build.sh','echo force full\n');f.settings({fail});
  await assert.rejects(f.build(),/failed/);assert.deepEqual(f.store.get(uiBaselineKey),before);
 }finally{f.close();}
});

for(const fail of ['core-build','tsc','mobile-jest','gradlew','apksigner','aapt'])test('failed fast check cannot publish or advance baseline: '+fail,async()=>{
 const f=builderFixture();try{
  await f.build();const before=f.store.get(uiBaselineKey),latest=f.store.get('latestApk');f.put('apps/mobile/theme-tokens.ts','// safe edit\n');f.settings({fail});
  await assert.rejects(f.build(),/failed/);assert.deepEqual(f.store.get(uiBaselineKey),before);assert.deepEqual(f.store.get('latestApk'),latest);
  assert.equal(f.store.get('release:job-2'),undefined);assert.equal(f.store.job('job-2')?.validation?.lane,'ui-fast');
 }finally{f.close();}
});

for(const fast of [false,true])test('source changes outside old fingerprint and signing mismatch still reject '+(fast?'fast':'full')+' publication',async()=>{
 const f=builderFixture();try{
  await f.build();const before=f.store.get(uiBaselineKey),latest=f.store.get('latestApk');
  f.put(fast?'apps/mobile/theme-tokens.ts':'tools/build.sh','// edit\n');f.settings({mutate:'tools/build.sh'});
  await assert.rejects(f.build(),/Source changed/);assert.deepEqual(f.store.get(uiBaselineKey),before);assert.deepEqual(f.store.get('latestApk'),latest);
  f.settings({badSigner:true});await assert.rejects(f.build(),/signing identity changed/);assert.deepEqual(f.store.get(uiBaselineKey),before);
 }finally{f.close();}
});

test('backend-only success and manifest uncertainty do not seed a UI baseline',async()=>{
 const f=builderFixture();try{
  await f.build('backend');assert.equal(f.store.get(uiBaselineKey),undefined);
  symlinkSync(f.release.cli,join(f.root,'tools/uncertain-link'));
  const built=await f.build();assert.equal(f.store.job(built.job.id)?.validation?.lane,'full');assert.match(f.store.job(built.job.id)!.validation!.reason,/manifest unavailable/);
  assert.equal(f.store.get(uiBaselineKey),undefined);assert.ok(f.operations().includes('mobile-jest'));
 }finally{f.close();}
});
