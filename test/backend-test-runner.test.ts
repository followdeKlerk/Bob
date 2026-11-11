import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync,type SpawnSyncReturns} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test('npm test bounds real fixture concurrency, covers every file and propagates failures',()=>{
 const root=process.cwd(),script=JSON.parse(readFileSync(join(root,'package.json'),'utf8')).scripts.test;
 const [command,...args]=script.split(' ');
 assert.equal(command,'node');
 assert.deepEqual(args,['--import','./test/runner-environment.mjs','--import','tsx','--import','./test/environment.mjs','--test','--test-concurrency=3','test/*.test.ts']);
 const dir=mkdtempSync(join(tmpdir(),'bob-test-runner-'));
 try{
  mkdirSync(join(dir,'test'));symlinkSync(join(root,'node_modules'),join(dir,'node_modules'),'dir');
  writeFileSync(join(dir,'package.json'),JSON.stringify({type:'module'}));
  for(const file of ['environment.mjs','runner-environment.mjs'])writeFileSync(join(dir,'test',file),readFileSync(join(root,'test',file)));
  for(let i=0;i<7;i++)writeFileSync(join(dir,`test/fixture-${i}.test.ts`),`
import test from 'node:test';import assert from 'node:assert/strict';import {appendFileSync,existsSync} from 'node:fs';
test('fixture-${i}',async()=>{appendFileSync('events.jsonl',JSON.stringify({id:${i},phase:'start'})+'\\n');try{await new Promise(resolve=>setTimeout(resolve,200));assert.ok(!(${i}===3&&existsSync('fail')));}finally{appendFileSync('events.jsonl',JSON.stringify({id:${i},phase:'end'})+'\\n');}});
`);
  for(const fail of [false,true]){
   writeFileSync(join(dir,'events.jsonl'),'');if(fail)writeFileSync(join(dir,'fail'),'');
   // Start an independent runner, not a child inheriting this test process's IPC mode.
   const env={...process.env};delete env.NODE_TEST_CONTEXT;
   const result:SpawnSyncReturns<string>=spawnSync(process.execPath,args,{cwd:dir,env,encoding:'utf8',timeout:30000});
   assert.equal(result.error,undefined);assert.equal(result.status,fail?1:0,result.stderr+'\n'+result.stdout);
   let active=0,peak=0;const starts=new Set<number>(),ends=new Set<number>();
   for(const line of readFileSync(join(dir,'events.jsonl'),'utf8').trim().split('\n')){
    const event=JSON.parse(line);if(event.phase==='start'){assert.ok(!starts.has(event.id));starts.add(event.id);active++;peak=Math.max(peak,active);}else{assert.ok(starts.has(event.id));assert.ok(!ends.has(event.id));ends.add(event.id);active--;}
    assert.ok(active>=0&&active<=3,'configured worker budget must hold during actual execution');
   }
   assert.equal(starts.size,7);assert.equal(ends.size,7);assert.equal(active,0);assert.ok(peak>0&&peak<=3);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('test temporary storage avoids the Linux service cache and honors an explicit filesystem override',()=>{
 const setup=join(process.cwd(),'test/runner-environment.mjs');
 const probe="import {tmpdir} from 'node:os';console.log(JSON.stringify({path:tmpdir(),values:[process.env.TMPDIR,process.env.TMP,process.env.TEMP]}));";
 const inherited=join(tmpdir(),'fixture-service-cache'),override=join(tmpdir(),'fixture-selected-filesystem');
 for(const selected of [undefined,override]){
  const env:NodeJS.ProcessEnv={...process.env,TMPDIR:inherited,TMP:inherited,TEMP:inherited};delete env.BOB_TEST_TMPDIR;delete env.NODE_TEST_CONTEXT;
  if(selected)env.BOB_TEST_TMPDIR=selected;
  const result:SpawnSyncReturns<string>=spawnSync(process.execPath,['--import',setup,'--input-type=module','-e',probe],{env,encoding:'utf8',timeout:15000});
  assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);
  const expected=selected??(process.platform==='linux'?'/tmp':inherited);
  assert.deepEqual(JSON.parse(result.stdout),{path:expected,values:[expected,expected,expected]});
 }
});
