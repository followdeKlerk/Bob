import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, randomUUID, createHash } from "node:crypto";
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const secret = () => randomBytes(32).toString("base64url");
export class State {
  readonly db: DatabaseSync;
  readonly id: string;
  constructor(readonly dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    this.db = new DatabaseSync(join(dir, "control.sqlite"));
    chmodSync(join(dir, "control.sqlite"), 0o600);
    const schema=Number(this.db.prepare('PRAGMA user_version').get()?.user_version??0);
    if(schema>2){this.db.close();throw Error('Unsupported newer control schema; use the matching Bob release');}
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
   CREATE TABLE IF NOT EXISTS config(key TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS invites(hash TEXT PRIMARY KEY,expires INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,name TEXT NOT NULL,hash TEXT UNIQUE NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
  `);
    this.id = this.get<string>("identity") ?? randomUUID();
    this.set("identity", this.id);
  }
  get<T>(key: string): T | undefined {
    const r = this.db.prepare("SELECT value FROM config WHERE key=?").get(key);
    return r ? JSON.parse(String(r.value)) : undefined;
  }
  set(key: string, value: unknown) {
    this.db
      .prepare(
        "INSERT INTO config VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
      )
      .run(key, JSON.stringify(value));
  }
  delete(key: string) {
    this.db.prepare("DELETE FROM config WHERE key=?").run(key);
  }
  invite() {
    const token = secret(),
      expiresAt = Date.now() + 120000;
    this.db
      .prepare("INSERT INTO invites(hash,expires) VALUES(?,?)")
      .run(hash(token), expiresAt);
    return { token, expiresAt };
  }
  pair(token: string, name: string) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare(
          "UPDATE invites SET used=1 WHERE hash=? AND used=0 AND expires>? RETURNING hash"
        )
        .get(hash(token), Date.now());
      if (!row) throw new Error("Invalid or expired invitation");
      const id = randomUUID(),
        credential = secret();
      this.db
        .prepare("INSERT INTO devices(id,name,hash) VALUES(?,?,?)")
        .run(id, name, hash(credential));
      if(Number(this.db.prepare('PRAGMA user_version').get()?.user_version)===2)
        this.db.prepare('UPDATE devices SET created_at=? WHERE id=?').run(Date.now(),id);
      this.db.exec("COMMIT");
      return { deviceId: id, credential };
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  authenticate(token: string) {
    return this.db
      .prepare("SELECT id,name FROM devices WHERE hash=? AND revoked=0")
      .get(hash(token));
  }
  devices() {
    return this.db.prepare("SELECT id,name,revoked FROM devices").all();
  }
  revoke(id: string) {
    if(Number(this.db.prepare('PRAGMA user_version').get()?.user_version)===2)
      this.db.prepare('UPDATE devices SET revoked=1,revoked_at=COALESCE(revoked_at,?) WHERE id=?').run(Date.now(),id);
    else this.db.prepare("UPDATE devices SET revoked=1 WHERE id=?").run(id);
  }
  close() {
    this.db.close();
  }
}
