import {readFileSync,createReadStream,statSync} from 'node:fs';
import {join} from 'node:path';
import type {ServerResponse} from 'node:http';
import {pipeline} from 'node:stream/promises';
import {MaintenanceStore,type MaintenanceConfig,type Release,type UpdateRequest} from './maintenance.js';
import type {State} from './state.js';
export function withMaintenance<T>(state:State,fn:(store:MaintenanceStore,config:MaintenanceConfig)=>T):T{
 const home=state.get<string>('maintenanceHome');if(!home)throw Error('Self-update has not been installed on this backend');
 const config=JSON.parse(readFileSync(join(home,'config.json'),'utf8')) as MaintenanceConfig;
 if(config.backendId!==state.id||config.stateDir!==state.dir)throw Error('Self-update backend identity mismatch');
 const store=new MaintenanceStore(home);try{return fn(store,config);}finally{store.close();}
}
export function updateStatus(state:State){
 if(!state.get('maintenanceHome'))return {enabled:false};
 return withMaintenance(state,(store)=>{const latest=store.get<Release>('latestApk');return {enabled:true,supervisorOnline:Date.now()-(store.get<number>('heartbeat')??0)<15000,active:store.get<Release>('active')?.id,previous:store.get<Release>('previous')?.id,draining:store.get<boolean>('draining')??false,jobs:store.jobs(),apk:latest?.apk?{releaseId:latest.id,sha256:latest.apk.sha256,size:latest.apk.size,versionCode:latest.apk.versionCode,versionName:latest.apk.versionName}:undefined};});
}
export function queueUpdate(state:State,request:UpdateRequest){return withMaintenance(state,store=>store.enqueue(request));}
export function maintenancePort(state:State){
 if(!state.get('maintenanceHome'))return undefined;
 return {describe:()=>withMaintenance(state,(_store,config)=>`This backend supports self_update. Bob source: ${config.sourceRoot}. Make requested edits there with coding tools, then call self_update(action=update,target=all) for app and backend, android for app-only, backend for backend-only. It runs tests, creates signed release APKs, and uses one supervised production backend, not Metro or another dev server. End your turn after queueing; build progress and the verified APK appear inline in chat (Build & install in chat actions). Android requires the owner to approve install. Never kill or restart this process yourself, never uninstall the Android app, and never restore an old database to roll code back. Preserve official Durable state authority; schema-changing upgrades need explicit compatible migration. Source changes during a build invalidate it; do not edit until that build settles.`),request:(action:string,target:string,id:string,conversationId:number)=>action==='status'?updateStatus(state):queueUpdate(state,{id:'tool-'+id,action:action as UpdateRequest['action'],target:target as UpdateRequest['target'],conversationId})};
}
export async function downloadUpdate(state:State,id:string,res:ServerResponse){
 const release=withMaintenance(state,store=>store.get<Release>('release:'+id));
 if(!release?.apk)throw Error('Update APK not found');
 const size=statSync(release.apk.path).size;if(size!==release.apk.size)throw Error('Update artifact changed');
 res.writeHead(200,{'content-type':'application/vnd.android.package-archive','content-length':size,'cache-control':'no-store','x-content-type-options':'nosniff','content-disposition':`attachment; filename="bob-${release.apk.versionName}.apk"`});
 await pipeline(createReadStream(release.apk.path),res);
}
