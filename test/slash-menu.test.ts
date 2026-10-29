import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {State} from '../src/state.js';
import {serve} from '../src/server.js';
import {ctx} from '../src/runtime.js';
import {Library} from '../src/documents.js';
import {delegationMenuCommand} from '../src/delegation-command.js';
import {pickerEntries,pickerRequest} from '../apps/mobile/skill-picker.js';

test('authenticated slash menu advertises native delegation alongside Bro without changing library state',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bob-slash-menu-')),state=new State(dir),app=await serve(state,{port:0});
 const pair=state.pair(state.invite().token,'Slash menu owner'),base=`http://127.0.0.1:${(app.server.address() as {port:number}).port}/v1`;
 const headers={authorization:'Bearer '+pair.credential,'x-bob-backend':state.id,'content-type':'application/json'};
 const request=(path:string,method='GET',body?:unknown)=>fetch(`${base}/${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 try{
  assert.equal((await fetch(`${base}/library`)).status,401);
  assert.equal((await request('skills','PUT',{name:'bro',description:'Re-explain more simply',markdown:'Fixture skill, no live inference.',enabled:true})).status,200);
  const before=await app.runtime.harness.snapshot(Library,app.runtime.library.id,ctx);
  const response=await request('library');assert.equal(response.status,200);
  const library=await response.json() as any;
  assert.deepEqual(library.commands,[delegationMenuCommand]);
  assert.equal(library.skills.bro.enabled,true);
  assert.equal(Object.hasOwn(library.skills,'delegation'),false,'native commands are not counterfeit saved skills');
  assert.deepEqual(await app.runtime.harness.snapshot(Library,app.runtime.library.id,ctx),before,'menu metadata is a read-only host capability');
  const menu=pickerEntries(library),bro=menu.find(entry=>entry.name==='bro')!,delegation=menu.find(entry=>entry.name==='delegation')!;
  assert.equal(pickerRequest(bro),'Use the skill "bro". ');
  assert.equal(pickerRequest(delegation),'/delegation ');
  const created=await request('chats','POST',{title:'Command menu'});assert.equal(created.status,201);
  const {id}=await created.json() as {id:number};
  // The inserted draft reaches the real owner-command handler, without model credentials.
  const admitted=await request(`chats/${id}/messages`,'POST',{requestId:randomUUID(),text:pickerRequest(delegation),mode:'steer',allowSubagents:false});
  assert.equal(admitted.status,200);assert.equal((await admitted.json() as any).status,'done');
  assert.equal((await request('library','PUT',{instructions:'',templates:{},commands:[{name:'fake',description:'Not a native command'}]})).status,400);
  assert.deepEqual(await app.runtime.harness.snapshot(Library,app.runtime.library.id,ctx),before);
 }finally{await app.close();state.close();rmSync(dir,{recursive:true,force:true});}
});
