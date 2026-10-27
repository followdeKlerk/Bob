import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {State} from '../src/state.js';
import {createBackendModels} from '../src/runtime.js';
import {acquireOwner} from '../src/ownership.js';

test('CLI validates provider catalog and folder before changing configuration',async()=>{
 const directory=mkdtempSync(join(process.env.TMPDIR!,'bob-cli-provider-'));
 const run=(args:string[],input='')=>spawnSync(process.execPath,['--import','tsx','src/cli.ts','--state',directory,...args],{input,encoding:'utf8'});
 const initial=run(['setup','--cwd',directory]);assert.equal(initial.status,0,initial.stderr);
 const state=new State(directory);
 try{
  const models=createBackendModels(state),supported=models.getModels().find(model=>model.provider==='openai')!;
  assert.ok(supported);assert.deepEqual(await models.getAvailable(),[]);
  const invalid=run(['provider','--model','not-a-supported-model'],'noncredential-fixture');
  assert.notEqual(invalid.status,0);assert.match(invalid.stderr,/Unknown model/);
  assert.equal(state.get('model'),undefined);assert.equal(state.get('openaiKey'),undefined);
  const missing=run(['provider','--model',supported.id]);assert.notEqual(missing.status,0);assert.match(missing.stderr,/No credential supplied/);
  const unsupported=run(['provider','--provider','unregistered','--model',supported.id],'noncredential-fixture');assert.notEqual(unsupported.status,0);assert.match(unsupported.stderr,/Unsupported provider/);
  const accepted=run(['provider','--model',supported.id],'noncredential-fixture');assert.equal(accepted.status,0,accepted.stderr);assert.doesNotMatch(accepted.stdout,/noncredential-fixture/);
  assert.deepEqual(state.get('model'),{provider:'openai',modelId:supported.id});
  const badFolder=run(['setup','--cwd',join(directory,'missing')]);assert.notEqual(badFolder.status,0);assert.match(badFolder.stderr,/existing directory/);assert.equal(state.get('cwd'),directory);
  const anthropic=models.getModels().find(model=>model.provider==='anthropic')!;assert.ok(anthropic);
  state.set('model',{provider:'anthropic',modelId:anthropic.id});
  const doctor=()=>{const result=run(['doctor']);assert.equal(result.status,0,result.stderr);assert.doesNotMatch(result.stdout,/noncredential-fixture/);return JSON.parse(result.stdout);};
  const missingSelected=doctor();assert.equal(missingSelected.providerCredentialPresent,false);assert.deepEqual(missingSelected.providerCredentials,{openai:true,anthropic:false});assert.equal(missingSelected.ownership,'available');
  const configured=run(['provider','--provider','anthropic','--model',anthropic.id],'noncredential-fixture');assert.equal(configured.status,0,configured.stderr);state.delete('openaiKey');
  const release=acquireOwner(directory);
  try{const held=doctor();assert.equal(held.ownership,'owned');assert.equal(held.providerCredentialPresent,true);assert.deepEqual(held.providerCredentials,{openai:false,anthropic:true});assert.equal(held.browser.executable,'/usr/bin/chromium');}finally{release();}
  assert.equal(doctor().ownership,'available');
 }finally{state.close();}
});
