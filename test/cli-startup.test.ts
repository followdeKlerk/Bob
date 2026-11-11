import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test('CLI help, invalid serve arguments and local inspection do not load the backend runtime',()=>{
 const dir=mkdtempSync(join(tmpdir(),'bob-cli-startup-')),state=join(dir,'missing-state'),hook=join(dir,'guard.mjs');
 try{
  writeFileSync(hook,`import{registerHooks}from'node:module';registerHooks({resolve(specifier,context,next){const result=next(specifier,context);if(/\\/(runtime|server)\\.(ts|js)$/.test(new URL(result.url).pathname))throw Error('Unexpected backend runtime import for a lightweight CLI operation');return result;}});`);
  for(const [args,status] of [[['--help'],0],[['setup','--help'],0],[['serve','--key',join(dir,'unused.pem')],1],[['doctor'],0]] as const){
   const result=spawnSync(process.execPath,['--import','tsx','--import',hook,'src/cli.ts','--state',state,...args],{env:{...process.env,HOME:dir},encoding:'utf8',timeout:15000});
   assert.equal(result.error,undefined);assert.equal(result.status,status,result.stderr);
   assert.doesNotMatch(result.stderr,/Unexpected backend runtime import/);
   if(args[0]==='serve')assert.match(result.stderr,/--cert and --key must be supplied together/);
   if(args[0]==='doctor')assert.equal(JSON.parse(result.stdout).status,'error');
   assert.equal(existsSync(state),false,'help, validation and doctor must not initialize state');
  }
  for(const args of [['setup','--cwd',dir],['mcp','configure','fixture','--endpoint','https://example.invalid/mcp','--tools','show','--disabled'],['mcp','list'],['module','list'],['delegation','config','--show'],['delegation','behavior','--show']]){
   const result=spawnSync(process.execPath,['--import','tsx','--import',hook,'src/cli.ts','--state',state,...args],{env:{...process.env,HOME:dir},encoding:'utf8',timeout:15000});
   assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);
   assert.doesNotMatch(result.stderr,/Unexpected backend runtime import/);
  }
  assert.equal(existsSync(join(state,'control.sqlite')),true);
  assert.equal(existsSync(join(state,'durable.sqlite')),false,'local configuration must not open native conversation storage');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
