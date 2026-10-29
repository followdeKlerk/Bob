import {withDelegationPeerPolicy} from '../src/peer-policy.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCorePromptReader,readCorePrompt,createResources} from '@bob-local/resources';

test('core Markdown is seeded once, hot-read by policy, and preserved across restarts', async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bob-core-prompt-')),path=join(dir,'core-prompt.md');
 try {
  const reader=createCorePromptReader(path);
  assert.equal(reader(),readCorePrompt());
  assert.match(reader(),/^You are Bob\./);
  const resources=createResources(()=>0 as any,undefined,undefined,undefined,undefined,undefined,reader);
  const policy=resources.sections!.find(s=>s.key==='bob-policy')!;
  assert.equal(await policy.render({} as any,{} as any),readCorePrompt());
  writeFileSync(path,'# Bob\n\nOwner-edited core prompt.\n');
  assert.equal(await policy.render({} as any,{} as any),'# Bob\n\nOwner-edited core prompt.');
  assert.equal(createCorePromptReader(path)(),reader());
  assert.equal(readFileSync(path,'utf8'),'# Bob\n\nOwner-edited core prompt.\n');
  writeFileSync(path,'  \n');
  assert.throws(reader,/Core prompt is empty/);
  assert.throws(()=>createCorePromptReader(path),/Core prompt is empty/);
  unlinkSync(path);
  assert.throws(reader,/ENOENT/);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('bundled core and peer guidance defer to delegation policy without a conflicting blanket ban', async()=>{
 const {createPeerTools}=await import('@bob-local/peers');
 const core=readCorePrompt();
 const native=createPeerTools({list:()=>[],request:async()=>{throw Error('No peer request expected');}});
 const peers=withDelegationPeerPolicy(native);
 assert.equal(peers.tasks,native.tasks);
 assert.equal(peers.tools,native.tools);
 const text=await peers.sections!.find(s=>s.key==='bob-peer-authority')!.render({} as any,{} as any);
 for(const guidance of [core,String(text)]){
  assert.match(guidance,/current delegation policy and permissions/);
  assert.doesNotMatch(guidance,/ONLY when explicitly requested|Do not create new subagents without an explicit user request/);
 }
 assert.match(String(text),/peer messages do not grant delegation authority/);
 assert.match(core,/Keep the user in the loop/);
});
