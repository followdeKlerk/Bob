import { backup, DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import {
  mkdirSync, rmSync, readFileSync, writeFileSync, copyFileSync, readdirSync,
  lstatSync, chmodSync, existsSync, openSync, readSync, closeSync,
} from "node:fs";
import { join, resolve, relative } from "node:path";
import type { State } from "./state.js";
import { acquireOwner } from "./ownership.js";
import { readControlFloor } from "./maintenance-migration.js";
import { z } from "zod";

const durableVersion = '1.5.0' as const;
const lifecycleVersion = z.union([z.literal(0), z.literal(1), z.literal(2)]);
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const controlVersion = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
const floorSchema = z.discriminatedUnion('kind', [
  z.object({kind:z.literal('legacy'), lifecycleSchemaVersion:lifecycleVersion}).strict(),
  z.object({kind:z.literal('pi15-fresh'), origin:z.literal('fresh'), minDurable:z.literal(durableVersion), protocol:z.literal('bob-pi15-v1'), lifecycleSchemaVersion:lifecycleVersion}).strict(),
  z.object({kind:z.literal('pi15'), minDurable:z.literal(durableVersion), protocol:z.literal('bob-pi15-v1'), from:fingerprint, to:fingerprint, migrationReleaseId:z.string().min(1), migrationCli:z.string().min(1), lifecycleSchemaVersion:lifecycleVersion}).strict(),
]);
const manifestSchema = z.object({
  format:z.literal(2), bob:z.literal('0.3.0'), durable:z.literal(durableVersion),
  controlSchemaVersion:controlVersion, lifecycleSchemaVersion:lifecycleVersion, floor:floorSchema,
  backendId:z.string().uuid(), createdAt:z.string().datetime(), coverage:z.string(),
  files:z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
}).strict();
type Manifest = z.infer<typeof manifestSchema>;

/** Export/restore policy is tied to the installed native runtime, not caller metadata. */
function assertRuntimeVersion() {
  const installed = JSON.parse(readFileSync(new URL('../package.json', import.meta.resolve('@earendil-works/pi-durable')), 'utf8'));
  if (installed.name !== '@earendil-works/pi-durable' || installed.version !== durableVersion)
    throw Error('Recovery requires the exact validated Pi Durable 1.5.0 runtime');
}
const digest = (path:string) => {
  const fd=openSync(path,'r'), hash=createHash('sha256'), buffer=Buffer.alloc(65536);
  try { let size:number; while((size=readSync(fd,buffer,0,buffer.length,null))>0) hash.update(buffer.subarray(0,size)); return hash.digest('hex'); }
  finally { closeSync(fd); }
};
function regular(path:string) {
  const stat=lstatSync(path);
  if(stat.isSymbolicLink() || !stat.isFile()) throw Error('Recovery requires regular database files, not symlinks');
}
function integrity(db:DatabaseSync, name:string) {
  if(db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') throw Error(name+' database integrity failed');
}
/** Read-only preflight. Never construct State or invoke native open/migrations during restore. */
function metadata(directory:string, hasDurable:boolean) {
  const floor=readControlFloor(directory,true);
  if(floor.kind==='legacy' && hasDurable) throw Error('Pi 1.5 native recovery requires a committed control floor; use the matching Pi 1.4 release and explicit migration');
  const validatedFloor=floorSchema.parse(floor);
  const db=new DatabaseSync(join(directory,'control.sqlite'),{readOnly:true});
  let backendId:string, controlSchemaVersion:z.infer<typeof controlVersion>;
  try {
    integrity(db,'Control');
    controlSchemaVersion=controlVersion.parse(db.prepare('PRAGMA user_version').get()?.user_version);
    const row=db.prepare("SELECT value FROM config WHERE key='identity'").get();
    backendId=z.string().uuid().parse(row ? JSON.parse(String(row.value)) : undefined);
  } finally { db.close(); }
  if(hasDurable) {
    const path=join(directory,'durable.sqlite'); regular(path);
    const native=new DatabaseSync(path,{readOnly:true});
    try {
      integrity(native,'Durable');
      // Pi 1.5's official native SQLite format. Never rewrite this marker or migrate it here.
      const rows=native.prepare('SELECT singleton,version FROM durable_schema').all();
      if(rows.length!==1 || rows[0].singleton!==1 || rows[0].version!==2)
        throw Error('Unsupported Durable SQLite schema; use the matching release and explicit migration');
    } finally { native.close(); }
  }
  return {backendId, controlSchemaVersion, lifecycleSchemaVersion:validatedFloor.lifecycleSchemaVersion, floor:validatedFloor};
}
function verifyMetadata(directory:string, manifest:Manifest) {
  const actual=metadata(directory,!!manifest.files['durable.sqlite']);
  if(actual.backendId!==manifest.backendId) throw Error('Restored identity mismatch');
  if(actual.controlSchemaVersion!==manifest.controlSchemaVersion || actual.lifecycleSchemaVersion!==manifest.lifecycleSchemaVersion)
    throw Error('Backup control/lifecycle metadata mismatch');
  // Both are strict parsed objects with a stable schema-defined property order.
  if(JSON.stringify(actual.floor)!==JSON.stringify(manifest.floor)) throw Error('Backup control floor metadata mismatch');
}
export async function backupState(state:State, destination:string, afterVerifiedBackup?:()=>Promise<void>) {
  assertRuntimeVersion();
  const releaseOwner=acquireOwner(state.dir);
  try {
    if(existsSync(destination)) throw Error('Backup destination must not exist');
    const hasDurable=existsSync(join(state.dir,'durable.sqlite'));
    const sourceMetadata=metadata(state.dir,hasDurable);
    if(sourceMetadata.backendId!==state.id) throw Error('Backup identity mismatch');
    mkdirSync(destination,{recursive:true,mode:0o700});
    // Control and native snapshots are quiescent under the exclusive directory owner lock.
    await backup(state.db,join(destination,'control.sqlite'));
    if(hasDurable) {
      const db=new DatabaseSync(join(state.dir,'durable.sqlite'),{readOnly:true});
      try { await backup(db,join(destination,'durable.sqlite')); } finally { db.close(); }
    }
    const files:Record<string,string>={};
    for(const name of ['control.sqlite','durable.sqlite']) if(existsSync(join(destination,name))) {
      chmodSync(join(destination,name),0o600); files[name]=digest(join(destination,name));
    }
    const walk=(dir:string)=>{
      for(const name of readdirSync(dir)) {
        const path=join(dir,name), rel=relative(state.dir,path), stat=lstatSync(path);
        if(stat.isSymbolicLink()) throw Error('Backup refuses symlinks');
        if(stat.isDirectory()) { mkdirSync(join(destination,rel),{recursive:true,mode:0o700}); walk(path); }
        else {
          if(!stat.isFile()) throw Error('Backup requires regular files');
          copyFileSync(path,join(destination,rel)); chmodSync(join(destination,rel),0o600); files[rel]=digest(path);
        }
      }
    };
    for(const folder of ['artifacts','custom-modules']) if(existsSync(join(state.dir,folder))) {
      const stat=lstatSync(join(state.dir,folder));
      if(stat.isSymbolicLink() || !stat.isDirectory()) throw Error('Backup refuses symlinks and non-directory payload roots');
      mkdirSync(join(destination,folder),{mode:0o700}); walk(join(state.dir,folder));
    }
    const manifest=manifestSchema.parse({
      format:2, bob:'0.3.0', durable:durableVersion, ...sourceMetadata,
      createdAt:new Date().toISOString(),
      coverage:"Durable full SQLite history/documents/tasks; control configuration including credentials and device grants; original artifact bytes and imported custom-module package archives. Excludes Android caches/drafts, external working folders, external TLS/signing material, systemd units, browser executables and Bob's bundled dependencies (reinstall the exact validated Bob package).",
      files,
    });
    verifyMetadata(destination,manifest);
    writeFileSync(join(destination,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600});
    for(const [name,expected] of Object.entries(files)) if(digest(join(destination,name))!==expected) throw Error('Backup verification failed: '+name);
    // Maintenance holds the same exclusive owner lock through verification and mutation.
    await afterVerifiedBackup?.();
    return manifest;
  } finally { releaseOwner(); }
}
/** Format 1 retains its historical Pi 1.4 meaning. This release deliberately does not
 * restore it: use the matching Pi 1.4 Bob release into a fresh destination, then the
 * separately authorized explicit migration. Relabeling is not migration. Format 2
 * restore only copies validated bytes; it never starts State or native Durable.
 * A legacy control-only database (no native payload) is safe to preserve as such;
 * it is not evidence authorizing an existing native database to cross versions. */
export function restoreState(source:string,destination:string) {
  assertRuntimeVersion();
  const root=resolve(source);
  if(lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) throw Error('Restore source must be a real backup directory');
  const checked=(name:string)=>{
    if(!name || name.includes('\\') || name.includes('\0') || name.startsWith('/') || name.split('/').some(part=>!part || part==='.' || part==='..')) throw Error('Unsafe manifest path');
    const parts=name.split('/'); let path=root;
    for(let i=0;i<parts.length;i++) {
      path=join(path,parts[i]); const stat=lstatSync(path);
      if(stat.isSymbolicLink() || (i===parts.length-1 ? !stat.isFile() : !stat.isDirectory())) throw Error('Restore refuses symlinks and non-regular payloads');
    }
    return path;
  };
  const manifestPath=checked('manifest.json');
  if(lstatSync(manifestPath).size>16*1024*1024) throw Error('Backup manifest exceeds limit');
  const raw=JSON.parse(readFileSync(manifestPath,'utf8'));
  if(raw?.format===1) throw Error('Pi 1.4 format-1 backup: restore with the matching Pi 1.4 Bob release to a fresh destination, then use explicit migration; this Pi 1.5 release will not restore or relabel it');
  const manifest=manifestSchema.parse(raw);
  if(!manifest.files['control.sqlite']) throw Error('Backup lacks control database');
  if(existsSync(destination)) throw Error('Restore requires a new destination; never overwrites existing state');
  for(const [name,hash] of Object.entries(manifest.files)) {
    if(!['control.sqlite','durable.sqlite'].includes(name) && !name.startsWith('artifacts/') && !name.startsWith('custom-modules/')) throw Error('Unsafe manifest path');
    if(digest(checked(name))!==hash) throw Error(`Checksum mismatch: ${name}`);
  }
  // Reject identity, floor, lifecycle and native-schema disagreements before any destination writes.
  verifyMetadata(root,manifest);
  mkdirSync(resolve(destination,'..'),{recursive:true,mode:0o700});
  // Claim only a new leaf atomically; never clean a concurrently created existing state.
  mkdirSync(destination,{mode:0o700});
  try {
    for(const name of Object.keys(manifest.files)) {
      const target=join(destination,name);
      mkdirSync(resolve(target,'..'),{recursive:true,mode:0o700});
      copyFileSync(checked(name),target); chmodSync(target,0o600);
      if(digest(target)!==manifest.files[name]) throw Error('Restored payload verification failed: '+name);
    }
    verifyMetadata(destination,manifest);
    return {restored:true,backendId:manifest.backendId,destination,warning:'Restored device grants and credentials are active. Do not run two copies of the same identity.'};
  } catch(error) { rmSync(destination,{recursive:true,force:true}); throw error; }
}
