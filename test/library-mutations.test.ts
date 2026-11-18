import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {serve} from '../src/server.js';
import {Library} from '../src/documents.js';

test('paired library PATCH changes only one reviewed value, rejects stale edits and preserves legacy PUT',async()=>{
 const home=mkdtempSync(join(tmpdir(),'bob-library-api-')),state=new State(join(home,'state')),runtime=await openRuntime(state),app=await serve(state,{port:0,runtime});
 const base=`http://127.0.0.1:${(app.server.address() as any).port}`,device=state.pair(state.invite().token,'Synthetic device');
 const headers={authorization:'Bearer '+device.credential,'x-bob-backend':state.id,'content-type':'application/json'};
 const patch=(body:unknown)=>fetch(base+'/v1/library',{method:'PATCH',headers,body:JSON.stringify(body)});
 const read=async()=>{const response=await fetch(base+'/v1/library',{headers});assert.equal(response.status,200);return response.json();};
 const skill={description:'Example',markdown:'Original skill',enabled:true};
 try{
  await runtime.library.commit(async tx=>{const library=await tx.doc(Library,runtime.library.id);library.instructions='Original';library.templates={keep:'Keep',edit:'Before'};library.skills.example=skill;},ctx);
  assert.equal((await fetch(base+'/v1/library',{method:'PATCH',body:'{}'})).status,401);
  assert.equal((await fetch(base+'/v1/library',{method:'PATCH',headers:{...headers,'x-bob-backend':'other'},body:'{}'})).status,409);
  const instructions={field:'instructions',expected:'Original',value:'Changed'};
  assert.equal((await patch(instructions)).status,200);assert.equal((await patch(instructions)).status,200);
  assert.equal((await patch({...instructions,value:'Stale replacement'})).status,409);
  assert.deepEqual((await read()).templates,{keep:'Keep',edit:'Before'});
  const template={field:'template',name:'edit',expected:'Before',value:'After'};
  assert.equal((await patch(template)).status,200);assert.equal((await patch(template)).status,200);
  assert.equal((await patch({...template,value:null})).status,409);
  assert.equal((await patch({field:'template',name:'new',expected:null,value:'New'})).status,200);
  assert.equal((await patch({field:'template',name:'edit',expected:'After',value:null})).status,200);
  let library=await read();assert.equal(library.instructions,'Changed');assert.deepEqual(library.templates,{keep:'Keep',new:'New'});assert.deepEqual(library.skills.example,skill);
  const changedSkill={...skill,markdown:'Edited skill'};
  assert.equal((await patch({field:'skill',name:'example',expected:skill,value:changedSkill})).status,200);
  assert.equal((await patch({field:'skill',name:'example',expected:skill,value:{...skill,markdown:'Stale'}})).status,409);
  assert.equal((await patch({field:'skill',name:'example',expected:skill,value:null})).status,409);
  assert.equal((await patch({field:'skill',name:'example',expected:changedSkill,value:null})).status,200);
  library=await read();assert.equal(library.skills.example,undefined);assert.ok(library.archivedSkills.includes('example'));
  assert.equal((await patch({field:'skill',name:'example',expected:null,value:changedSkill})).status,200);
  library=await read();assert.deepEqual(library.skills.example,changedSkill);assert.equal(library.instructions,'Changed');assert.deepEqual(library.templates,{keep:'Keep',new:'New'});
  const competing=await Promise.all(['One','Two'].map(value=>patch({field:'instructions',expected:'Changed',value})));
  assert.deepEqual(competing.map(response=>response.status).sort(),[200,409],'one transaction wins; the stale writer cannot overwrite it');
  assert.equal((await patch({field:'template',name:'x',expected:null,value:'X',templates:{}})).status,400);
  assert.equal((await patch({field:'skill',name:'../bad',expected:null,value:skill})).status,400);
  assert.equal((await fetch(base+'/v1/library',{method:'PUT',headers,body:JSON.stringify({instructions:'Legacy',templates:{legacy:'Compatible'}})})).status,200);
  library=await read();assert.equal(library.instructions,'Legacy');assert.deepEqual(library.skills.example,changedSkill);
 }finally{await app.close();state.close();rmSync(home,{recursive:true,force:true});}
});
