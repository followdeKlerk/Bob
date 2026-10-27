import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {State} from '../src/state.js';
import {createBackendModels} from '../src/runtime.js';
import {providerCredentials,setProviderKey,hasProviderCredential} from '../src/provider-auth.js';

test('Bob-only OAuth storage resolves exact supported model without importing ambient auth; replacement and logout are explicit',async()=>{
 const state=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-oauth-')));
 try{
  const models=createBackendModels(state),store=providerCredentials(state);
  assert.ok(models.getModel('openai','gpt-6-luna'));assert.equal(await models.getAuth('openai'),undefined);
  assert.equal(hasProviderCredential(state,'openai'),false);
  await setProviderKey(state,'openai','synthetic-api-fixture');
  await store.modify('openai',async()=>({type:'oauth',access:'synthetic-oauth-fixture',refresh:'synthetic-refresh-fixture',expires:Date.now()+3600000,clientId:'synthetic-client'}));
  assert.equal(state.get('openaiKey'),undefined);
  assert.deepEqual(await store.list(),[{providerId:'openai',type:'oauth'}]);
  assert.equal((await models.getAuth('openai'))?.auth.apiKey,'synthetic-oauth-fixture');
  assert.equal(statSync(join(state.dir,'provider-locks/openai/owner.sqlite')).mode&0o777,0o600);
  await setProviderKey(state,'openai','synthetic-replacement-fixture');assert.equal(await store.read('openai'),undefined);
  assert.equal((await models.getAuth('openai'))?.auth.apiKey,'synthetic-replacement-fixture');
  await store.delete('openai');assert.equal(await models.getAuth('openai'),undefined);assert.equal(hasProviderCredential(state,'openai'),false);
 }finally{state.close();}
});
test('independent Bob credential stores serialize asynchronous refresh mutations and preserve a failed refresh',async()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR!,'bob-oauth-lock-')),a=new State(dir),b=new State(dir),one=providerCredentials(a),two=providerCredentials(b);
 try{
  await one.modify('openai',async()=>({type:'oauth',access:'synthetic-fixture',refresh:'synthetic-refresh',expires:Date.now()+3600000,generation:0}));
  await Promise.all([one,two].map(store=>store.modify('openai',async old=>{await delay(30);return {...old!,generation:Number((old as any).generation)+1};})));
  assert.equal((await one.read('openai') as any).generation,2);
  await assert.rejects(()=>two.modify('openai',async()=>{throw Error('deliberate refresh failure');}),/deliberate/);
  assert.equal((await one.read('openai') as any).generation,2);
  await assert.rejects(()=>one.read('../unrelated'),/Unsupported provider/);
 }finally{a.close();b.close();}
});
