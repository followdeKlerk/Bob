import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {State} from '../src/state.js';
import {serve} from '../src/server.js';
import {ctx} from '../src/runtime.js';
import {Library} from '../src/documents.js';
import {SkillMetadata,mutateSkill} from '@bob-local/resources';

test('existing skill screen API keeps audit/support files and archives without destroying bodies',{timeout:15000},async()=>{
 const state=new State(mkdtempSync(join(tmpdir(),'bob-learning-http-'))),app=await serve(state,{port:0}),device=state.pair(state.invite().token,'Skill owner');
 const base=`http://127.0.0.1:${(app.server.address() as any).port}/v1`,headers={authorization:'Bearer '+device.credential,'x-bob-backend':state.id,'content-type':'application/json'};
 const request=(path:string,method='GET',body?:unknown)=>fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 try{
  const skill={name:'screen-skill',description:'Screen fixture.',markdown:'Original body',enabled:true};
  assert.equal((await request('/skills','PUT',skill)).status,200);
  const root=app.runtime.library.id;
  await app.runtime.library.commit(tx=>mutateSkill(tx,root,root,{name:skill.name,action:'write_file',file_path:'references/fixture.md',file_content:'Retained reference'}),ctx);
  assert.equal((await request('/skills','PUT',{...skill,markdown:'Edited body'})).status,200);
  let meta=(await app.runtime.harness.snapshot(SkillMetadata,root,ctx))!.skills[skill.name];assert.equal(meta.files['references/fixture.md'],'Retained reference');assert.equal(meta.ledger.length,3);
  assert.equal((await request('/skills/'+skill.name,'DELETE')).status,200);
  assert.equal((await request('/skills/'+skill.name,'DELETE')).status,200,'repeated delete is idempotent');
  const visible=await(await request('/library')).json() as any;assert.equal(visible.skills[skill.name],undefined);assert.ok(visible.archivedSkills.includes(skill.name));
  assert.equal((await app.runtime.harness.snapshot(Library,root,ctx))!.skills[skill.name].markdown,'Edited body');
  assert.equal((await request('/skills','PUT',{...skill,markdown:'Restored through screen'})).status,200);
  meta=(await app.runtime.harness.snapshot(SkillMetadata,root,ctx))!.skills[skill.name];assert.equal(meta.archived,false);assert.equal(meta.files['references/fixture.md'],'Retained reference');
  assert.equal((await(await request('/library')).json() as any).skills[skill.name].markdown,'Restored through screen');
 }finally{await app.close();state.close();}
});
