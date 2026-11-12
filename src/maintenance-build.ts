import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,openSync,closeSync,copyFileSync,statSync,cpSync,lstatSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {MaintenanceStore,sourceFingerprint,compatibilityFingerprint,type MaintenanceConfig,type UpdateJob,type Release} from './maintenance.js';
import {assertBridgeBuild,type SupervisorEvidence} from './maintenance-migration.js';
import {sourceManifest,sameManifest,uiFastPath,uiBaselineKey,createUiBaseline,mobilePackageVersion,type SourceManifest,type UiBaseline} from './maintenance-ui.js';
export async function buildRelease(home:string,config:MaintenanceConfig,store:MaintenanceStore,job:UpdateJob):Promise<Release>{
 const root=config.sourceRoot,dir=join(home,'releases',job.id);mkdirSync(dir,{recursive:true,mode:0o700});
 const log=join(dir,'build.log'),env={...process.env,PATH:[config.javaHome?join(config.javaHome,'bin'):'',dirname(config.node),process.env.PATH].filter(Boolean).join(':'),JAVA_HOME:config.javaHome,ANDROID_HOME:config.androidHome,BOB_SIGNING_PROPERTIES:config.signingProperties};
 const run=async(command:string,args:string[],cwd=root,timeout=1800000)=>{
  const fd=openSync(log,'a',0o600);let output='';
  try{await new Promise<void>((resolve,reject)=>{const child=spawn(command,args,{cwd,env,stdio:['ignore','pipe',fd],detached:true});const timer=setTimeout(()=>{try{process.kill(-child.pid!,'SIGTERM');}catch{}},timeout);child.stdout!.on('data',chunk=>{const text=String(chunk);if(output.length<1048576)output+=text;writeFileSync(fd,text);});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',(code,signal)=>{clearTimeout(timer);code===0?resolve():reject(Error(`${command.split('/').pop()} failed (${code??signal}); private build log: ${log}`));});});}finally{closeSync(fd);}return output;
 };
 const stage=(text:string)=>store.patch(job.id,{status:'building',stage:text});
 stage('Checking source and release compatibility');
 const compatibility=compatibilityFingerprint(root),active=store.get<Release>('active');
 const durableVersion=JSON.parse(readFileSync(join(root,'package.json'),'utf8')).dependencies?.['@earendil-works/pi-durable'];
 if(active?.compatibility&&active.compatibility!==compatibility)assertBridgeBuild(active,{compatibility,durableVersion},store.get<SupervisorEvidence>('supervisorEvidence'));
 else if(durableVersion!=='1.4.0'&&durableVersion!==active?.durableVersion)throw Error('Unrecognized Durable package transition');
 const android=job.target!=='backend';
 if(android){
  if(!config.javaHome||!config.androidHome||!config.signingProperties||!config.referenceApk)throw Error('Android build/signing configuration missing');
  const gradlePath=join(root,'apps/mobile/android/app/build.gradle');let gradle=readFileSync(gradlePath,'utf8');
  const code=Number(gradle.match(/versionCode\s+(\d+)/)?.[1]),version=gradle.match(/versionName\s+"([^"]+)"/)?.[1];
  if(!Number.isInteger(code)||!version||!/^\d+\.\d+\.\d+$/.test(version))throw Error('Invalid Android version metadata');
  const last=store.get<Release>('latestApk')?.apk?.versionCode??0;
  if(code<=last){const next=last+1,parts=version.split('.').map(Number);parts[2]=parts[2]!+1;const nextVersion=parts.join('.');gradle=gradle.replace(/versionCode\s+\d+/,'versionCode '+next).replace(/versionName\s+"[^"]+"/,'versionName "'+nextVersion+'"');writeFileSync(gradlePath,gradle);for(const file of ['apps/mobile/package.json','apps/mobile/package-lock.json']){const path=join(root,file);writeFileSync(path,mobilePackageVersion(readFileSync(path,'utf8'),file.endsWith('package-lock.json'),nextVersion));}}
 }
 const sourceHash=sourceFingerprint(root);
 let manifest:SourceManifest|undefined;
 // Unknown inputs (including symlinks) disable the optimization, never the checks.
 try{manifest=sourceManifest(root);}catch{}
 const baseline=store.get<UiBaseline>(uiBaselineKey);
 const decision=uiFastPath(job.target,root,manifest,baseline,baseline?.releaseId?store.get<Release>('release:'+baseline.releaseId):undefined,active);
 const fast=decision.eligible;
 store.patch(job.id,{validation:{lane:fast?'ui-fast':'full',reason:decision.reason,baselineId:decision.baselineId,changedFiles:decision.changedFiles}});
 if(!fast){
  stage('Compiling backend');await run('npm',['run','build']);
  stage('Running automated backend checks');await run('npm',['test'],root,600000);
 }
 const release:Release={id:job.id,cli:fast?active!.cli:'',sourceHash,compatibility,durableVersion};
 if(android){
  // Mobile's src/contracts.ts imports generated @bob-local/core/contracts.
  // Rebuild even with unchanged source: a previous backend build may have left
  // different dist output behind. This is shared-contract compilation, not the backend.
  if(fast){stage('Compiling shared mobile contracts');await run('npm',['run','build','--workspace','@bob-local/core']);}
  stage('Compiling interactive content and checking mobile TypeScript');await run('npm',['run','build:interactive']);await run(join(root,'node_modules/.bin/tsc'),['--noEmit'],join(root,'apps/mobile'));
  stage('Running all mobile tests');await run('npm',['test','--','--runInBand','--ci'],join(root,'apps/mobile'),600000);
  stage('Building signed Android release');await run(join(root,'apps/mobile/android/gradlew'),['-p','android','assembleRelease','-PreactNativeArchitectures=x86_64,arm64-v8a'],join(root,'apps/mobile'));
  const apk=join(dir,'bob.apk');copyFileSync(join(root,'apps/mobile/android/app/build/outputs/apk/release/app-release.apk'),apk);
  const tools=join(config.androidHome!,'build-tools/36.0.0');
  const certificate=(text:string)=>text.match(/Signer #1 certificate SHA-256 digest: ([a-f0-9]+)/)?.[1];
  stage('Verifying package identity, upgrade version and signing certificate');
  const signer=certificate(await run(join(tools,'apksigner'),['verify','--print-certs',apk]));
  const referenceSigner=certificate(await run(join(tools,'apksigner'),['verify','--print-certs',config.referenceApk!]));
  if(!signer||signer!==referenceSigner)throw Error('Android signing identity changed');
  const metadata=await run(join(tools,'aapt'),['dump','badging',apk]);
  const match=metadata.match(/package: name='com\.bobmobile' versionCode='(\d+)' versionName='([^']+)'/);
  if(!match||Number(match[1])<=(store.get<Release>('latestApk')?.apk?.versionCode??0))throw Error('APK is not an in-place Bob upgrade');
  release.apk={path:apk,sha256:createHash('sha256').update(readFileSync(apk)).digest('hex'),size:statSync(apk).size,versionCode:Number(match[1]),versionName:match[2]!,signer};
 }
 if(!fast){
 stage('Packaging isolated backend release');
 const packageManifest=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
 await run('npm',['pack','--silent','--pack-destination',dir]);
 const archive=join(dir,'bob-local-cli-'+packageManifest.version+'.tgz'),installation=join(dir,'installation');
 const packageRoot=await installLockedRuntime({sourceRoot:root,archive,installation,run});const manifest=JSON.parse(readFileSync(join(packageRoot,'package.json'),'utf8'));
 if(manifest.name!=='@bob-local/cli'||manifest.dependencies?.['@earendil-works/pi-durable']!==durableVersion)throw Error('Native Durable package identity mismatch');
 release.cli=join(packageRoot,'dist/cli.js');
 stage('Checking installed package in a disposable state');
 await run(config.node,[release.cli,'--state',join(dir,'verification-state'),'setup','--cwd',dir],root,60000);
 await run(config.node,[release.cli,'--state',join(dir,'verification-state'),'doctor'],root,60000);
 await run(config.node,[release.cli,'--state',join(dir,'verification-state'),'module','list'],root,60000);
 }
 if(sourceFingerprint(root)!==sourceHash)throw Error('Source changed during build; candidate not published. Finish editing and request a new build.');
 if(manifest){
  let finalManifest:SourceManifest;
  try{finalManifest=sourceManifest(root);}catch{throw Error('Source manifest changed during build; candidate not published.');}
  if(!sameManifest(manifest,finalManifest))throw Error('Source changed during build; candidate not published. Finish editing and request a new build.');
 }
 writeFileSync(join(dir,'release.json'),JSON.stringify(release,null,2),{mode:0o600});store.set('release:'+release.id,release);
 if(release.apk)store.set('latestApk',release);
 store.patch(job.id,{status:'ready',stage:release.apk?'Verified APK ready to install':'Backend release ready',releaseId:release.id});
 // Only a full Android/all build has passed backend, mobile, signing and installed
 // package checks. Backend-only and fast builds cannot advance this authority.
 if(!fast&&android&&manifest)store.set(uiBaselineKey,createUiBaseline(root,release,manifest));
 return release;
}

/** Install the packed executable with the reviewed lock, never resolve a new
 * dependency graph around a tarball. npm pack omits package-lock.json and bundles
 * workspaces under node_modules; restore their declared layout before npm ci. */
export async function installLockedRuntime({sourceRoot,archive,installation,run}:{sourceRoot:string;archive:string;installation:string;run:(command:string,args:string[],cwd:string,timeout:number)=>Promise<unknown>}):Promise<string>{
 const root=join(installation,'node_modules/@bob-local/cli');mkdirSync(root,{recursive:true,mode:0o700});
 await run('tar',['--extract','--gzip','--file',archive,'--strip-components=1','--directory',root],sourceRoot,60000);
 if(existsSync(join(root,'npm-shrinkwrap.json')))throw Error('Packed shrinkwrap cannot override the reviewed lock');
 const manifest=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
 const bytes=readFileSync(join(sourceRoot,'package-lock.json')),lock=JSON.parse(bytes.toString());
 if(manifest.name!=='@bob-local/cli'||lock.lockfileVersion!==3||!lock.packages?.['']||!Array.isArray(manifest.workspaces)||!manifest.workspaces.length)throw Error('Locked runtime requires the original v3 workspace lock');
 const names:string[]=[];
 for(const workspace of manifest.workspaces){
  if(typeof workspace!=='string'||!/^packages\/[a-z][a-z0-9-]*$/.test(workspace))throw Error('Unsupported locked runtime workspace');
  const expected=lock.packages[workspace],name=expected?.name;
  if(typeof name!=='string'||!/^@bob-local\/[a-z][a-z0-9-]*$/.test(name)||names.includes(name))throw Error('Workspace identity is absent or duplicated in the reviewed lock');
  names.push(name);const bundled=join(root,'node_modules',name);
  if(!lstatSync(bundled).isDirectory()||lstatSync(bundled).isSymbolicLink())throw Error('Expected a bundled workspace directory');
  const actual=JSON.parse(readFileSync(join(bundled,'package.json'),'utf8'));
  if(actual.name!==name||actual.version!==expected.version)throw Error('Bundled workspace differs from the reviewed lock');
  cpSync(bundled,join(root,workspace),{recursive:true});
 }
 if(!Array.isArray(manifest.bundleDependencies)||JSON.stringify([...manifest.bundleDependencies].sort())!==JSON.stringify([...names].sort()))throw Error('Runtime workspaces must match the bundled workspace inventory');
 copyFileSync(join(sourceRoot,'package-lock.json'),join(root,'package-lock.json'));
 await run('npm',['ci','--prefer-offline','--fetch-retries=1','--fetch-timeout=30000','--ignore-scripts','--no-audit','--no-fund','--omit=dev','--prefix',root],sourceRoot,180000);
 if(!readFileSync(join(root,'package-lock.json')).equals(bytes))throw Error('Runtime installation changed the reviewed dependency lock');
 return root;
}
