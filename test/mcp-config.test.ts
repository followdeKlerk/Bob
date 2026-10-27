import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {State} from '../src/state.js';
import {serve} from '../src/server.js';

test('MCP CLI explicitly configures, protects credentials, disables and removes', {timeout:30000},()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR!,'bob-mcp-cli-'));
 const run=(args:string[],input?:string)=>{const r=spawnSync(process.execPath,['--import','tsx','src/cli.ts','--state',dir,'mcp',...args],{encoding:'utf8',input});assert.equal(r.status,0,r.stderr);return r.stdout;};
 run(['configure','fixture','--endpoint','https://example.invalid/mcp','--tools','show,increment','--disabled']);
 assert.equal(JSON.parse(run(['list']))[0].enabled,false);
 const credential=randomBytes(32).toString('hex');run(['key','fixture'],credential);
 const listing=run(['list']);assert.equal(listing.includes(credential),false);assert.equal(JSON.parse(listing)[0].credentialPresent,true);
 run(['enable','fixture']);assert.equal(JSON.parse(run(['list']))[0].enabled,true);
 run(['disable','fixture']);assert.equal(JSON.parse(run(['list']))[0].enabled,false);
 run(['configure','fixture','--endpoint','https://other.invalid/mcp','--tools','show']);assert.equal(JSON.parse(run(['list']))[0].credentialPresent,false);
 run(['remove','fixture']);assert.deepEqual(JSON.parse(run(['list'])),[]);
 const bad=spawnSync(process.execPath,['--import','tsx','src/cli.ts','--state',dir,'mcp','configure','bad','--endpoint','http://public.example/mcp','--tools','show'],{encoding:'utf8'});assert.notEqual(bad.status,0);
});

test('authenticated MCP configuration readback, credential clearing, deletion and transport validation',async()=>{
 const state=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-mcp-http-'))),app=await serve(state,{port:0});
 const device=state.pair(state.invite().token,'MCP management test');
 const endpoint=`http://127.0.0.1:${(app.server.address() as any).port}/v1/mcp-connections`;
 const headers={'authorization':'Bearer '+device.credential,'x-bob-backend':state.id,'content-type':'application/json'};
 const config={id:'fixture',endpoint:'https://example.invalid/mcp',allowedTools:['show'],enabled:false};
 try {
  assert.equal((await fetch(endpoint)).status,401);
  assert.equal((await fetch(endpoint,{headers,method:'PUT',body:JSON.stringify(config)})).status,200);
  assert.deepEqual(await(await fetch(endpoint,{headers})).json(),[config]);
  state.set('mcpKey:fixture',randomBytes(32).toString('hex'));
  const changed={...config,endpoint:'https://other.invalid/mcp',enabled:true};
  assert.equal((await fetch(endpoint,{headers,method:'PUT',body:JSON.stringify(changed)})).status,200);
  assert.equal(state.get('mcpKey:fixture'),undefined);
  assert.deepEqual(await(await fetch(endpoint,{headers})).json(),[changed]);
  for(const bad of ['http://public.invalid/mcp','https://example.invalid/mcp?key=not-a-real-secret'])assert.notEqual((await fetch(endpoint,{headers,method:'PUT',body:JSON.stringify({...config,endpoint:bad})})).status,200);
  assert.equal((await fetch(endpoint,{headers,method:'DELETE',body:JSON.stringify({id:'fixture'})})).status,200);
  assert.deepEqual(await(await fetch(endpoint,{headers})).json(),[]);
 }finally{await app.close();state.close();}
});
