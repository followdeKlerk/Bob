import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,openSync,closeSync,copyFileSync,statSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {MaintenanceStore,sourceFingerprint,compatibilityFingerprint,type MaintenanceConfig,type UpdateJob,type Release} from './maintenance.js';
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
 if(active?.compatibility&&active.compatibility!==compatibility)throw Error('Durable/storage/task-bearing source changed. Explicit compatible migration required; running code untouched.');
 const android=job.target!=='backend';
 if(android){
  if(!config.javaHome||!config.androidHome||!config.signingProperties||!config.referenceApk)throw Error('Android build/signing configuration missing');
  const gradlePath=join(root,'apps/mobile/android/app/build.gradle');let gradle=readFileSync(gradlePath,'utf8');
  const code=Number(gradle.match(/versionCode\s+(\d+)/)?.[1]),version=gradle.match(/versionName\s+"([^"]+)"/)?.[1];
  if(!Number.isInteger(code)||!version||!/^\d+\.\d+\.\d+$/.test(version))throw Error('Invalid Android version metadata');
  const last=store.get<Release>('latestApk')?.apk?.versionCode??0;
  if(code<=last){const next=last+1,parts=version.split('.').map(Number);parts[2]=parts[2]!+1;const nextVersion=parts.join('.');gradle=gradle.replace(/versionCode\s+\d+/,'versionCode '+next).replace(/versionName\s+"[^"]+"/,'versionName "'+nextVersion+'"');writeFileSync(gradlePath,gradle);for(const file of ['apps/mobile/package.json','apps/mobile/package-lock.json']){const path=join(root,file),data=JSON.parse(readFileSync(path,'utf8'));data.version=nextVersion;if(data.packages?.[''])data.packages[''].version=nextVersion;writeFileSync(path,JSON.stringify(data,null,2)+'\n');}}
 }
 const sourceHash=sourceFingerprint(root);
 stage('Compiling backend');await run('npm',['run','build']);
 stage('Running automated backend checks');await run('npm',['test'],root,600000);
 const release:Release={id:job.id,cli:'',sourceHash,compatibility};
 if(android){
  stage('Compiling interactive content and checking mobile TypeScript');await run('npm',['run','build:interactive']);await run(join(root,'node_modules/.bin/tsc'),['--noEmit'],join(root,'apps/mobile'));
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
 stage('Packaging isolated backend release');
 const packageManifest=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
 await run('npm',['pack','--silent','--pack-destination',dir]);
 const archive=join(dir,'bob-local-cli-'+packageManifest.version+'.tgz'),installation=join(dir,'installation');
 await run('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--omit=dev','--prefix',installation,archive],root,180000);
 const packageRoot=join(installation,'node_modules/@bob-local/cli');const manifest=JSON.parse(readFileSync(join(packageRoot,'package.json'),'utf8'));
 if(manifest.name!=='@bob-local/cli'||manifest.dependencies?.['@earendil-works/pi-durable']!=='1.4.0')throw Error('Native Durable package identity mismatch');
 release.cli=join(packageRoot,'dist/cli.js');
 stage('Checking installed package in a disposable state');
 await run(config.node,[release.cli,'--state',join(dir,'verification-state'),'doctor'],root,60000);
 await run(config.node,[release.cli,'--state',join(dir,'verification-state'),'module','list'],root,60000);
 if(sourceFingerprint(root)!==sourceHash)throw Error('Source changed during build; candidate not published. Finish editing and request a new build.');
 writeFileSync(join(dir,'release.json'),JSON.stringify(release,null,2),{mode:0o600});store.set('release:'+release.id,release);
 if(release.apk)store.set('latestApk',release);
 store.patch(job.id,{status:'ready',stage:release.apk?'Verified APK ready to install':'Backend release ready',releaseId:release.id});
 return release;
}
