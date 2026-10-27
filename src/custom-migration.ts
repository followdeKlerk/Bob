import {existsSync,rmSync,realpathSync} from 'node:fs';
import {resolve,dirname,basename,join,relative,isAbsolute} from 'node:path';
import {State} from './state.js';
import {backupState,restoreState} from './recovery.js';
import {openRuntime} from './runtime.js';
import {importCustomModule} from './custom-modules.js';

/** Resolve existing ancestors too: a symlink must not disguise overlapping output paths. */
export function canonicalPath(path:string):string{
 const full=resolve(path);if(existsSync(full))return realpathSync(full);
 const parent=dirname(full);if(parent===full)return full;
 return join(canonicalPath(parent),basename(full));
}
export function requireDisjoint(paths:string[]){
 const canonical=paths.map(canonicalPath);
 for(let i=0;i<canonical.length;i++)for(let j=i+1;j<canonical.length;j++){
  const nested=(a:string,b:string)=>{const r=relative(a,b);return r===''||(!isAbsolute(r)&&r!=='..'&&!r.startsWith('../'));};
  if(nested(canonical[i],canonical[j])||nested(canonical[j],canonical[i]))throw Error('State, backup and installation directories must not overlap');
 }
}
/** Native migrations run only in a disposable clone; source and rollback package are never replaced. */
export async function migrateCustomModule(state:State,id:string,source:string,previous:string,backup:string,destination:string){
 backup=resolve(backup);destination=resolve(destination);
 requireDisjoint([state.dir,backup,destination]);
 if(existsSync(backup)||existsSync(destination))throw Error('Migration backup and destination must be new');
 let result:unknown;
 await backupState(state,backup,async()=>{
  restoreState(backup,destination);
  try{
   const candidate=new State(destination);
   try{const runtime=await openRuntime(candidate,undefined,undefined,{resume:false});
    try{result=await importCustomModule(candidate,runtime,id,source,previous,true);}finally{await runtime.close();}
   }finally{candidate.close();}
   // Reload archived replacement code and persisted module selection independently.
   const verified=new State(destination);try{const runtime=await openRuntime(verified,undefined,undefined,{resume:false});await runtime.close();}finally{verified.close();}
  }catch(error){rmSync(destination,{recursive:true,force:true});throw error;}
 });
 return {result,state:destination,backup,backendId:state.id,activation:'Explicit cutover only; source unchanged. Restore pre-migration backup to use old code/schema. Subsequent new work is not included in that backup.'};
}
