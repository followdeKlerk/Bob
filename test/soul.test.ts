import {withDelegationPeerPolicy} from '../src/peer-policy.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,unlinkSync,existsSync,mkdirSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSoulReader,readSoul,createResources} from '@bob-local/resources';

test('soul Markdown is seeded once, hot-read by policy, and preserved across restarts', async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bob-soul-')),path=join(dir,'soul.md');
 try {
  const reader=createSoulReader(path);
  assert.equal(reader(),readSoul());
  assert.match(reader(),/^You are Bob\./);
  const resources=createResources(()=>0 as any,undefined,undefined,undefined,undefined,undefined,reader);
  const policy=resources.sections!.find(s=>s.key==='bob-policy')!;
  assert.equal(await policy.render({} as any,{} as any),readSoul());
  writeFileSync(path,'# Bob\n\nOwner-edited soul.\n');
  assert.equal(await policy.render({} as any,{} as any),'# Bob\n\nOwner-edited soul.');
  assert.equal(createSoulReader(path)(),reader());
  assert.equal(readFileSync(path,'utf8'),'# Bob\n\nOwner-edited soul.\n');
  writeFileSync(path,'  \n');
  assert.throws(reader,/Soul is empty/);
  assert.throws(()=>createSoulReader(path),/Soul is empty/);
  unlinkSync(path);
  assert.throws(reader,/ENOENT/);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('bundled soul and peer guidance defer to delegation policy without a conflicting blanket ban', async()=>{
 const {createPeerTools}=await import('@bob-local/peers');
 const core=readSoul();
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


test('legacy owner edits migrate byte-for-byte once, while both files remain intact',()=>{
 const dir=mkdtempSync(join(tmpdir(),'bob-soul-migration-')),path=join(dir,'soul.md'),legacy=join(dir,'core-prompt.md');
 const original='  # My Bob\r\n\r\nOwner personality and rules.\r\n';
 try{
  writeFileSync(legacy,original);
  const reader=createSoulReader(path);
  assert.equal(readFileSync(path,'utf8'),original);
  assert.equal(readFileSync(legacy,'utf8'),original);
  assert.equal(reader(),original.trim());
  assert.equal(statSync(path).mode&0o777,0o600);
  writeFileSync(path,'New soul edits\n');
  writeFileSync(legacy,'Later legacy edits must not replace the soul\n');
  assert.equal(createSoulReader(path)(),'New soul edits');
  assert.equal(readFileSync(legacy,'utf8'),'Later legacy edits must not replace the soul\n');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('an existing soul is authoritative even when legacy is invalid, and an empty soul never falls back',()=>{
 const dir=mkdtempSync(join(tmpdir(),'bob-soul-authority-')),path=join(dir,'soul.md'),legacy=join(dir,'core-prompt.md');
 try{
  writeFileSync(path,'Owner soul\n');writeFileSync(legacy,'  \n');
  assert.equal(createSoulReader(path)(),'Owner soul');
  writeFileSync(legacy,'Valid legacy\n');writeFileSync(path,'  \n');
  assert.throws(()=>createSoulReader(path),/Soul is empty/);
  assert.equal(readFileSync(path,'utf8'),'  \n');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('invalid legacy files fail visibly rather than creating a default soul',()=>{
 const dir=mkdtempSync(join(tmpdir(),'bob-soul-invalid-')),path=join(dir,'soul.md'),legacy=join(dir,'core-prompt.md');
 try{
  writeFileSync(legacy,'  \n');
  assert.throws(()=>createSoulReader(path),/Legacy core prompt is empty/);
  assert.equal(existsSync(path),false);
  unlinkSync(legacy);mkdirSync(legacy);
  assert.throws(()=>createSoulReader(path),/EISDIR/);
  assert.equal(existsSync(path),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('legacy exported reader names remain compatible aliases',async()=>{
 const resources=await import('@bob-local/resources');
 assert.equal(resources.readCorePrompt,readSoul);
 assert.equal(resources.createCorePromptReader,createSoulReader);
});

test('private soul filenames are Git-ignored while only the generic template is packaged',async()=>{
 const {spawnSync}=await import('node:child_process');
 const {fileURLToPath}=await import('node:url');
 const root=fileURLToPath(new URL('../',import.meta.url));
 const ignored=spawnSync('git',['check-ignore','--no-index','--stdin'],{cwd:root,encoding:'utf8',input:'soul.md\nSOUL.md\nlocal/soul.md\nlocal/core-prompt.md\npackages/resources/soul.default.md\n'});
 assert.equal(ignored.status,0,ignored.stderr);
 assert.deepEqual(ignored.stdout.trim().split('\n'),['soul.md','SOUL.md','local/soul.md','local/core-prompt.md']);
 const manifest=JSON.parse(readFileSync(join(root,'packages/resources/package.json'),'utf8'));
 assert.ok(manifest.files.includes('soul.default.md'));
 assert.ok(!manifest.files.includes('soul.md'));
 assert.ok(!manifest.files.includes('core-prompt.md'));
 assert.equal(readFileSync(join(root,'packages/resources/soul.default.md'),'utf8').trim(),readSoul());
});
