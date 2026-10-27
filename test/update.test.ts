import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {State} from '../src/state.js';
import {controlSchema} from '../src/control-migrations.js';
import {migrateState,updateRelease} from '../src/update.js';
import {restoreState} from '../src/recovery.js';
import {openRuntime,ctx} from '../src/runtime.js';

test('explicit schema 1→2 migration preserves authority, records new lifecycle timestamps and restores old schema',async()=>{
 const root=mkdtempSync(join(process.env.TMPDIR!,'bob-schema-')),s=new State(join(root,'state'));
 try{
  const existing=s.pair(s.invite().token,'Existing device'),identity=s.id;
  assert.equal(controlSchema(s),1);
  const backup=join(root,'backup');assert.equal((await migrateState(s,backup)).to,2);
  assert.equal(controlSchema(s),2);assert.equal(s.id,identity);assert.ok(s.authenticate(existing.credential));
  assert.equal(s.db.prepare('SELECT created_at FROM devices WHERE id=?').get(existing.deviceId)?.created_at,null);
  const fresh=s.pair(s.invite().token,'New device');s.revoke(fresh.deviceId);
  const row=s.db.prepare('SELECT created_at,revoked_at FROM devices WHERE id=?').get(fresh.deviceId)!;
  assert.equal(typeof row.created_at,'number');assert.equal(typeof row.revoked_at,'number');assert.equal(s.authenticate(fresh.credential),undefined);
  const copy=join(root,'restored');restoreState(backup,copy);const restored=new State(copy);
  try{assert.equal(controlSchema(restored),1);assert.equal(restored.id,identity);assert.ok(restored.authenticate(existing.credential));assert.equal(restored.devices().length,1);}finally{restored.close();}
 }finally{s.close();}
});

test('failed cross-schema migration rolls back all DDL, preserves backup and refuses unfinished work',async()=>{
 const root=mkdtempSync(join(process.env.TMPDIR!,'bob-schema-fail-')),s=new State(join(root,'state'));
 try{
  // A pre-existing incompatible table induces a real DDL failure after both ALTERs.
  s.db.exec('CREATE TABLE schema_migrations(incompatible TEXT)');
  await assert.rejects(()=>migrateState(s,join(root,'backup')),/already exists/);
  assert.equal(controlSchema(s),1);assert.ok(existsSync(join(root,'backup/manifest.json')));
  assert.ok(!s.db.prepare('PRAGMA table_info(devices)').all().some(row=>row.name==='created_at'));
  s.db.exec('DROP TABLE schema_migrations');
  const runtime=await openRuntime(s,undefined,undefined,{resume:false});
  const chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
  await chat.submit({type:'input',content:'Queued deterministic fixture; must not run'},ctx);await runtime.close();
  await assert.rejects(()=>migrateState(s,join(root,'busy-backup')),/Settle/);assert.ok(!existsSync(join(root,'busy-backup')));
 }finally{s.close();}
});

test('updater rejects unsupported versions and missing code trust before touching destinations',async()=>{
 const root=mkdtempSync(join(process.env.TMPDIR!,'bob-update-deny-')),s=new State(join(root,'state'));
 const options={version:'999.0.0',package:'absent',sha256:'0'.repeat(64),installation:join(root,'install'),destination:join(root,'new'),backup:join(root,'backup'),trustReleaseCode:true};
 try{await assert.rejects(()=>updateRelease(s,options),/not Bob-validated/);await assert.rejects(()=>updateRelease(s,{...options,version:'0.3.0',trustReleaseCode:false}),/trust-release-code/);assert.ok(!existsSync(options.installation));}finally{s.close();}
});
