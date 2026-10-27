import {DatabaseSync} from 'node:sqlite';
import {chmodSync,existsSync} from 'node:fs';
import {join} from 'node:path';
/** Point-in-time diagnostic; do not mistake a legacy directory for the actual SQLite ownership lock. */
export function inspectOwner(directory:string):'available'|'owned'|'legacy-lock'|'unknown'{
 if(existsSync(join(directory,'runtime.lock')))return 'legacy-lock';
 const path=join(directory,'owner.sqlite');if(!existsSync(path))return 'available';
 let db:DatabaseSync|undefined;
 try{db=new DatabaseSync(path);db.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE; ROLLBACK;');return 'available';}
 catch(error){const code=(error as {errcode?:number}).errcode;return code===5||code===6?'owned':'unknown';}
 finally{db?.close();}
}
/** OS-backed SQLite exclusive lock: released by the kernel on process death, not by a stale-PID heuristic. */
export function acquireOwner(directory:string){
 if(existsSync(join(directory,'runtime.lock')))throw Error('Legacy runtime lock exists; stop and verify the previous owner before migration');
 const path=join(directory,'owner.sqlite'),db=new DatabaseSync(path);chmodSync(path,0o600);
 try{db.exec('PRAGMA busy_timeout=0; CREATE TABLE IF NOT EXISTS owner(id INTEGER PRIMARY KEY); BEGIN EXCLUSIVE; INSERT OR REPLACE INTO owner VALUES(1);');}
 catch(e){db.close();throw Error('Bob state is already owned by a runtime or recovery operation',{cause:e});}
 let closed=false;return ()=>{if(!closed){closed=true;try{db.exec('ROLLBACK');}finally{db.close();}}};
}
