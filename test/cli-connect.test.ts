import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {State} from '../src/state.js';

test('JSON pairing outputs a redeemable single-use invitation, with no QR or prose',()=>{
 const home=mkdtempSync(join(tmpdir(),'bob-json-pair-')),directory=join(home,'state');
 const run=(args:string[])=>spawnSync(process.execPath,['--import','tsx','src/cli.ts','--state',directory,...args],{env:{...process.env,HOME:home},encoding:'utf8',timeout:20000});
 try {
  for(const args of [['discover'],['connect','--local','--json']]){
   const result=run(args);assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(existsSync(directory),false);
  }
  const result=run(['connect','--endpoint','https://fixture.tailnet.ts.net','--json']);
  assert.equal(result.status,0,result.stderr);
  const invitation=JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(invitation).sort(),['backendId','endpoint','expiresAt','invitation','protocol']);
  assert.equal(invitation.protocol,1);assert.equal(invitation.endpoint,'https://fixture.tailnet.ts.net');
  assert.ok(invitation.expiresAt>Date.now());
  const state=new State(directory);
  try {
   assert.equal(invitation.backendId,state.id);
   assert.ok(state.pair(invitation.invitation,'Fixture Desktop').deviceId);
   assert.throws(()=>state.pair(invitation.invitation,'Second use'),/Invalid or expired/);
  } finally {state.close();}
  const stopped=run(['discover']);assert.equal(stopped.status,1);assert.equal(stopped.stdout,'');
  const normal=run(['pair']);assert.equal(normal.status,0,normal.stderr);
  assert.match(normal.stdout,/paste this JSON into Bob Desktop/);
  const jsonLine=normal.stdout.split('\n').find(line=>line.startsWith('{'))!;
  assert.equal(JSON.parse(jsonLine).backendId,invitation.backendId);
 } finally {rmSync(home,{recursive:true,force:true});}
});
