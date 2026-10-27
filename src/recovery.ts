import { backup, DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  readdirSync,
  lstatSync,
  chmodSync,
  existsSync,
  openSync,readSync,closeSync,
} from "node:fs";
import { join, resolve, relative } from "node:path";
import { State } from "./state.js";
import {acquireOwner} from "./ownership.js";
import {z} from 'zod';
const digest=(path:string)=>{const fd=openSync(path,'r'),hash=createHash('sha256'),buffer=Buffer.alloc(65536);try{let size:number;while((size=readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,size));return hash.digest('hex');}finally{closeSync(fd);}};
export async function backupState(state: State, destination: string, afterVerifiedBackup?:()=>Promise<void>) {
  const releaseOwner=acquireOwner(state.dir);
  try {
    if (existsSync(destination))
      throw Error("Backup destination must not exist");
    mkdirSync(destination, { recursive: true, mode: 0o700 });
    // Control backup has its own SQLite snapshot. Durable cannot run while this exclusive directory lock exists.
    await backup(state.db, join(destination, "control.sqlite"));
    if (existsSync(join(state.dir, "durable.sqlite"))) {
      const db = new DatabaseSync(join(state.dir, "durable.sqlite"), {
        readOnly: true,
      });
      try {
        await backup(db, join(destination, "durable.sqlite"));
      } finally {
        db.close();
      }
    }
    const files: Record<string, string> = {};
    for (const name of ["control.sqlite", "durable.sqlite"])
      if (existsSync(join(destination, name))) {
        chmodSync(join(destination, name), 0o600);
        files[name] = digest(join(destination, name));
      }
    const walk = (dir: string) => {
      if (!existsSync(dir)) return;
      for (const name of readdirSync(dir)) {
        const path = join(dir, name),
          rel = relative(state.dir, path);
        if (lstatSync(path).isSymbolicLink())
          throw Error("Backup refuses symlinks");
        if (lstatSync(path).isDirectory()) {
          mkdirSync(join(destination, rel), { recursive: true, mode: 0o700 });
          walk(path);
        } else {
          if(!lstatSync(path).isFile())throw Error('Backup requires regular files');
          copyFileSync(path, join(destination, rel));
          chmodSync(join(destination, rel), 0o600);
          files[rel] = digest(path);
        }
      }
    };
    for(const folder of ['artifacts','custom-modules'])if(existsSync(join(state.dir,folder))){mkdirSync(join(destination,folder),{mode:0o700});walk(join(state.dir,folder));}
    const manifest = {
      format: 1,
      bob: "0.3.0",
      durable: "1.4.0",
      backendId: state.id,
      createdAt: new Date().toISOString(),
      coverage:
        "Durable full SQLite history/documents/tasks; control configuration including credentials and device grants; original artifact bytes and imported custom-module package archives. Excludes Android caches/drafts, external working folders, external TLS/signing material, systemd units, browser executables and Bob's bundled dependencies (reinstall the exact validated Bob package).",
      files,
    };
    writeFileSync(
      join(destination, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      { mode: 0o600 }
    );
    for(const [name,expected]of Object.entries(files))if(digest(join(destination,name))!==expected)throw Error('Backup verification failed: '+name);
    // Maintenance holds the same exclusive owner lock through verification and mutation.
    await afterVerifiedBackup?.();
    return manifest;
  } finally {
    releaseOwner();
  }
}
export function restoreState(source: string, destination: string) {
  const root=resolve(source);
  if(lstatSync(root).isSymbolicLink()||!lstatSync(root).isDirectory())throw Error('Restore source must be a real backup directory');
  const checked=(name:string)=>{
    if(!name||name.includes('\\')||name.includes('\0')||name.startsWith('/')||name.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Unsafe manifest path');
    const parts=name.split('/');let path=root;
    for(let i=0;i<parts.length;i++){path=join(path,parts[i]);const stat=lstatSync(path);if(stat.isSymbolicLink()||(i===parts.length-1?!stat.isFile():!stat.isDirectory()))throw Error('Restore refuses symlinks and non-regular payloads');}
    return path;
  };
  const manifestPath=checked('manifest.json');if(lstatSync(manifestPath).size>16*1024*1024)throw Error('Backup manifest exceeds limit');
  const manifest=z.object({format:z.literal(1),bob:z.enum(['0.1.0','0.2.0','0.3.0']),durable:z.literal('1.4.0'),backendId:z.string().uuid(),createdAt:z.string().datetime(),coverage:z.string(),files:z.record(z.string(),z.string().regex(/^[a-f0-9]{64}$/))}).strict().parse(JSON.parse(readFileSync(manifestPath,'utf8')));
  if(!manifest.files['control.sqlite'])throw Error('Backup lacks control database');
  if (existsSync(destination))
    throw Error(
      "Restore requires a new destination; never overwrites existing state"
    );
  for (const [name, hash] of Object.entries(manifest.files)) {
    if(!['control.sqlite','durable.sqlite'].includes(name)&&!name.startsWith('artifacts/')&&!name.startsWith('custom-modules/'))throw Error('Unsafe manifest path');
    if (digest(checked(name)) !== hash)
      throw Error(`Checksum mismatch: ${name}`);
  }
  mkdirSync(resolve(destination,'..'), { recursive: true, mode: 0o700 });
  // Claim only a new leaf atomically; never clean a concurrently created existing state.
  mkdirSync(destination, { mode: 0o700 });
  try {
  for (const name of Object.keys(manifest.files)) {
    const target = join(destination, name);
    mkdirSync(resolve(target, ".."), { recursive: true, mode: 0o700 });
    copyFileSync(join(source, name), target);
    chmodSync(target, 0o600);
    if(digest(target)!==manifest.files[name])throw Error('Restored payload verification failed: '+name);
  }
  const s = new State(destination);
  try {
    if (s.id !== manifest.backendId) throw Error("Restored identity mismatch");
    const check = s.db.prepare("PRAGMA integrity_check").get();
    if (check?.integrity_check !== "ok")
      throw Error("Control database integrity failed");
  } finally {
    s.close();
  }
  if (existsSync(join(destination, "durable.sqlite"))) {
    const db = new DatabaseSync(join(destination, "durable.sqlite"), {
      readOnly: true,
    });
    try {
      if (db.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok")
        throw Error("Durable database integrity failed");
    } finally {
      db.close();
    }
  }
  return {
    restored: true,
    backendId: manifest.backendId,
    destination,
    warning:
      "Restored device grants and credentials are active. Do not run two copies of the same identity.",
  };
  } catch(error) {
    rmSync(destination,{recursive:true,force:true});
    throw error;
  }
}
