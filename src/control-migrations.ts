import type {State} from './state.js';

export const controlSchemaVersion = 2;
export function controlSchema(state: State): number {
  const value=Number(state.db.prepare('PRAGMA user_version').get()?.user_version??0);
  return value===0?1:value; // Existing 0.1.0 databases had no explicit version.
}
/** Explicit caller-owned maintenance transaction; never runs implicitly on startup. */
export function migrateControl(state: State) {
  const from=controlSchema(state);
  if(from>controlSchemaVersion||from<1)throw Error('Unsupported control schema; no migration performed');
  if(from===controlSchemaVersion)return {from,to:from,changed:false};
  state.db.exec('BEGIN IMMEDIATE');
  try {
    // Historical creation/revocation times are unknown, not manufactured as migration time.
    state.db.exec('ALTER TABLE devices ADD COLUMN created_at INTEGER; ALTER TABLE devices ADD COLUMN revoked_at INTEGER;');
    state.db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);');
    state.db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(2,new Date().toISOString());
    state.db.exec('PRAGMA user_version=2');
    if(state.db.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok')throw Error('Migrated control database integrity failed');
    state.db.exec('COMMIT');
  }catch(error){state.db.exec('ROLLBACK');throw error;}
  return {from,to:2,changed:true};
}
