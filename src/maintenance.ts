import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync,openSync,closeSync,readFileSync,writeFileSync,copyFileSync,cpSync,existsSync,readdirSync,statSync} from 'node:fs';
import {spawn,type ChildProcess} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
export type UpdateRequest={id:string;action:'build'|'update'|'rollback';target:'android'|'backend'|'all';conversationId?:number};
export type UpdateJob=UpdateRequest&{status:string;stage:string;created:number;updated:number;error?:string;releaseId?:string};
/** Deployment journal only. Conversation/tool execution remains in official Durable. */
export class MaintenanceStore{
 readonly db:DatabaseSync;
 constructor(readonly home:string){mkdirSync(home,{recursive:true,mode:0o700});this.db=new DatabaseSync(join(home,'journal.sqlite'));chmodSync(join(home,'journal.sqlite'),0o600);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,request TEXT NOT NULL,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)');}
 enqueue(request:UpdateRequest):UpdateJob{
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(request.id)||!['build','update','rollback'].includes(request.action)||!['android','backend','all'].includes(request.target))throw Error('Invalid self-update request');
  const canonical=JSON.stringify({id:request.id,action:request.action,target:request.target,conversationId:request.conversationId});
  const job:UpdateJob={...request,status:'queued',stage:'Queued',created:Date.now(),updated:Date.now()};
  this.db.prepare('INSERT OR IGNORE INTO jobs VALUES(?,?,?)').run(request.id,canonical,JSON.stringify(job));
  const row=this.db.prepare('SELECT request,value FROM jobs WHERE id=?').get(request.id)!;
  if(row.request!==canonical)throw Error('Self-update request conflict');return JSON.parse(String(row.value));
 }
 jobs():UpdateJob[]{return this.db.prepare('SELECT value FROM jobs ORDER BY rowid DESC LIMIT 100').all().map(r=>JSON.parse(String(r.value)));}
 job(id:string):UpdateJob|undefined{const row=this.db.prepare('SELECT value FROM jobs WHERE id=?').get(id);return row?JSON.parse(String(row.value)):undefined;}
 patch(id:string,change:Partial<UpdateJob>){const job=this.job(id);if(!job)throw Error('Unknown update');const next={...job,...change,id,updated:Date.now()};this.db.prepare('UPDATE jobs SET value=? WHERE id=?').run(JSON.stringify(next),id);return next;}
 get<T>(key:string):T|undefined{const row=this.db.prepare('SELECT value FROM settings WHERE key=?').get(key);return row?JSON.parse(String(row.value)):undefined;}
 set(key:string,value:unknown){this.db.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)').run(key,JSON.stringify(value));}
 close(){this.db.close();}
}
export function sourceFingerprint(root:string){
 const hash=createHash('sha256');
 const excluded=new Set(['node_modules','dist','build','.gradle','.cxx','.git','local.properties','bob-host.js']);
 const visit=(relative:string)=>{const path=join(root,relative);if(!existsSync(path))return;const st=statSync(path);if(st.isDirectory()){for(const name of readdirSync(path).sort())if(!excluded.has(name))visit(join(relative,name));}else{hash.update(relative+'\0');hash.update(readFileSync(path));}};
 for(const path of ['src','packages','apps','test','package.json','package-lock.json','tsconfig.json'])visit(path);
 return hash.digest('hex');
}
export function compatibilityFingerprint(root:string){
 const hash=createHash('sha256');const manifest=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
 for(const name of ['@earendil-works/pi-durable','@earendil-works/pi-ai','@earendil-works/chord'])hash.update(name+':'+manifest.dependencies[name]);
 for(const file of ['src/control-migrations.ts','packages/core/src/documents.ts','packages/subagents/src/index.ts','packages/peers/src/index.ts','packages/interactive/src/index.ts'])hash.update(file+':').update(readFileSync(join(root,file)));
 return hash.digest('hex');
}
export type Release={id:string;cli:string;sourceHash?:string;compatibility?:string;apk?:{path:string;sha256:string;size:number;versionCode:number;versionName:string;signer:string}};
export type MaintenanceConfig={sourceRoot:string;stateDir:string;backendId:string;node:string;serveArgs:string[];origin:string;healthTimeoutMs?:number;javaHome?:string;androidHome?:string;signingProperties?:string;referenceApk?:string};
const sleep=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
export class MaintenanceSupervisor{
 child?:ChildProcess;transitioning=false;expectedStop=true;private healthToken=randomBytes(32).toString('hex');
 constructor(readonly home:string,readonly config:MaintenanceConfig,readonly store=new MaintenanceStore(home)){}
 async health(){const response=await fetch(this.config.origin+'/internal/update-health',{headers:{authorization:'Bearer '+this.healthToken},signal:AbortSignal.timeout(3000)});if(!response.ok)throw Error('Backend health unavailable');const value=await response.json() as {backendId:string;releaseId:string;foreground:number};if(value.backendId!==this.config.backendId)throw Error('Backend identity mismatch');return value;}
 async start(release:Release){
  if(this.child&&this.child.exitCode===null&&this.child.signalCode===null)throw Error('Backend already running');
  this.expectedStop=false;
  const fd=openSync(join(this.home,'backend.log'),'a',0o600);
  this.child=spawn(this.config.node,[release.cli,...this.config.serveArgs],{cwd:this.config.sourceRoot,env:{...process.env,BOB_MAINTENANCE_HOME:this.home,BOB_RELEASE_ID:release.id,BOB_HEALTH_TOKEN:this.healthToken},stdio:['ignore',fd,fd]});closeSync(fd);
  let spawnError=false;this.child.once('error',()=>{spawnError=true;});
  const until=Date.now()+(this.config.healthTimeoutMs??30000);
  while(Date.now()<until){if(spawnError||this.child.exitCode!==null||this.child.signalCode!==null)break;try{if((await this.health()).releaseId===release.id)return;}catch{}await sleep(150);}
  throw Error('Candidate backend unhealthy');
 }
 async stop(){
  this.expectedStop=true;
  const child=this.child;if(!child||child.exitCode!==null||child.signalCode!==null)return;
  child.kill('SIGTERM');const until=Date.now()+30000;
  while(child.exitCode===null&&child.signalCode===null&&Date.now()<until)await sleep(100);
  if(child.exitCode===null&&child.signalCode===null)throw Error('Backend did not stop gracefully; no second owner started');
 }
 async activate(candidate:Release){
  const previous=this.store.get<Release>('active');if(!previous)throw Error('No rollback release');
  if(previous.compatibility&&candidate.compatibility!==previous.compatibility)throw Error('Storage/task schema changed; explicit compatible migration required');
  this.transitioning=true;this.store.set('draining',true);
  try{
   const until=Date.now()+600000;
   while((await this.health()).foreground!==0){if(Date.now()>until)throw Error('Active work did not settle; release remains staged');await sleep(1000);}
   this.store.set('transition',{previous,candidate});await this.stop();
   try{
    if(existsSync(join(this.config.stateDir,'durable.sqlite'))){
     const backup=join(this.home,'backups',candidate.id+'-'+Date.now());mkdirSync(backup,{recursive:true,mode:0o700});
     for(const name of ['control.sqlite','control.sqlite-wal','durable.sqlite','durable.sqlite-wal','artifacts'])if(existsSync(join(this.config.stateDir,name)))cpSync(join(this.config.stateDir,name),join(backup,name),{recursive:true});
     for(const name of ['control.sqlite','durable.sqlite']){const db=new DatabaseSync(join(backup,name),{readOnly:true});try{const check=db.prepare('PRAGMA integrity_check').get();if(!check||Object.values(check)[0]!=='ok')throw Error('State backup integrity failed');}finally{db.close();}}
     this.store.set('lastBackup',backup);
    }
    await this.start(candidate);this.store.set('previous',previous);this.store.set('active',candidate);this.store.set('transition',null);
   }
   catch(error){await this.stop();await this.start(previous);this.store.set('active',previous);this.store.set('transition',null);throw Error('Unhealthy candidate rolled back to previous code; state retained');}
  }finally{this.store.set('draining',false);this.transitioning=false;}
 }
}

