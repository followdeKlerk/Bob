import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider} from '@earendil-works/pi-ai/providers/faux';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {serve} from '../src/server.js';
import {Questions} from '../src/documents.js';
import {QuestionChoices} from '@bob-local/resources';
import {DelegationSession} from '../src/delegation.js';
import {DelegationCommands,handleDelegationCommand} from '../src/delegation-command.js';
import {saveDelegationConfig,readDelegationConfig,saveDelegationMode} from '../src/delegation-config.js';

test('AD bare command uses native choice cards without inference, then honors scope and device operation replay',{timeout:15000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bob-ad-command-')),state=new State(dir),models=createModels(),faux=fauxProvider();models.setProvider(faux.provider);
 await saveDelegationConfig(state,models,{mode:'default',modelMap:{options:[{name:'quick',description:'Short tasks',provider:'faux',model:'faux-1'}]}});
 const runtime=await openRuntime(state,models),app=await serve(state,{port:0,runtime}),pair=state.pair(state.invite().token,'owner');
 const base=`http://127.0.0.1:${(app.server.address() as any).port}/v1`,headers={authorization:'Bearer '+pair.credential,'x-bob-backend':state.id,'content-type':'application/json'};
 const chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
 const send=async(text:string,questionId?:string,requestId=randomUUID())=>{const response=await fetch(`${base}/chats/${chat.id}/messages`,{method:'POST',headers,body:JSON.stringify({text,questionId,requestId,mode:'steer',allowSubagents:false})});return {response,body:await response.json() as any,requestId};};
 try{
  const first=await send('/delegation');assert.equal(first.response.status,200);assert.equal(first.body.status,'done');
  let question=(await runtime.harness.snapshot(Questions,chat.id,ctx))!.pending!;
  assert.deepEqual((await runtime.harness.snapshot(QuestionChoices,chat.id,ctx))!.options,['Default','Model routes','Cancel']);
  const invalid=await send('invented mode',question.id);assert.equal(invalid.response.status,200);const replacement=(await runtime.harness.snapshot(Questions,chat.id,ctx))!.pending!;assert.notEqual(replacement.id,question.id);
  assert.equal((await send('Model routes',question.id)).response.status,409,'stale card must not infer or select another question');question=replacement;
  assert.equal((await send('Model routes',question.id)).response.status,200);assert.equal(readDelegationConfig(state).mode,'default');
  question=(await runtime.harness.snapshot(Questions,chat.id,ctx))!.pending!;assert.deepEqual((await runtime.harness.snapshot(QuestionChoices,chat.id,ctx))!.options,['Next session (recommended)','Now (refresh tools)','Cancel']);
  const saved=await send('Next session (recommended)',question.id);assert.equal(saved.response.status,200);assert.equal(readDelegationConfig(state).mode,'model_map');assert.equal((await runtime.harness.snapshot(DelegationSession,chat.id,ctx))!.config!.mode,'default');assert.equal((await runtime.harness.snapshot(Questions,chat.id,ctx))?.pending,undefined);
  const outcome=await (await fetch(`${base}/chats/${chat.id}/operations/${saved.requestId}`,{headers})).json() as any;assert.equal(outcome.admission.id,saved.body.id);assert.match(outcome.reply.text,/saved for new chats/);
  saveDelegationMode(state,'default');const replay=await send('Next session (recommended)',question.id,saved.requestId);assert.equal(replay.body.id,saved.body.id);assert.equal(readDelegationConfig(state).mode,'default');
  await send('/delegation');question=(await runtime.harness.snapshot(Questions,chat.id,ctx))!.pending!;await send('Model routes',question.id);question=(await runtime.harness.snapshot(Questions,chat.id,ctx))!.pending!;await send('Now (refresh tools)',question.id);assert.equal((await runtime.harness.snapshot(DelegationSession,chat.id,ctx))!.config!.mode,'model_map');
  assert.equal(faux.state.callCount,0,'neither commands nor card answers invoke a model');
  assert.deepEqual((await runtime.harness.snapshot(DelegationCommands,chat.id,ctx))!.pending,{});
 }finally{await app.close();state.close();rmSync(dir,{recursive:true,force:true});}
});

test('AD picker survives reopen and never replaces an unrelated question',{timeout:10000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bob-ad-picker-')),state=new State(dir),models=createModels();let runtime=await openRuntime(state,models,undefined,{resume:false});const chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx),id=chat.id;
 try{
  const questionId=randomUUID();await chat.commit(async tx=>{(await tx.doc(Questions,id)).pending={id:questionId,text:'Original question'};},ctx);
  await handleDelegationCommand(state,runtime.harness,runtime.delegation,chat,'/delegation','bare-1','client-1');assert.equal((await runtime.harness.snapshot(Questions,id,ctx))!.pending!.id,questionId);assert.equal((await runtime.harness.snapshot(DelegationCommands,id,ctx))?.picker,undefined);
  await chat.commit(async tx=>{delete (await tx.doc(Questions,id)).pending;},ctx);
  await handleDelegationCommand(state,runtime.harness,runtime.delegation,chat,'/delegation','bare-2','client-2');const picker=(await runtime.harness.snapshot(DelegationCommands,id,ctx))!.picker!;
  await runtime.close();runtime=await openRuntime(state,models,undefined,{resume:false});const reopened=(await runtime.harness.conversation(id,ctx))!;
  assert.equal((await runtime.harness.snapshot(Questions,id,ctx))!.pending!.id,picker.id);
  const result=await handleDelegationCommand(state,runtime.harness,runtime.delegation,reopened,'Cancel','cancel-1','client-3',picker.id);assert.equal(result?.status,'done');assert.equal((await runtime.harness.snapshot(Questions,id,ctx))?.pending,undefined);assert.equal(readDelegationConfig(state).mode,'default');
 }finally{await runtime.close();state.close();rmSync(dir,{recursive:true,force:true});}
});

test('AD CLI accepts noninteractive patches and secret stdin, preserves inactive lists and prints no key',{timeout:20000},()=>{
 const dir=mkdtempSync(join(tmpdir(),'bob-ad-cli-'));const run=(args:string[],input='')=>spawnSync(process.execPath,['--import','tsx','src/cli.ts','--state',dir,'delegation',...args],{input,encoding:'utf8'});
 try{
  const secret='fixture-only-DO-NOT-DISCLOSE';let result=run(['secret','local'],secret);assert.equal(result.status,0,result.stderr);assert.doesNotMatch(result.stdout+result.stderr,/DO-NOT-DISCLOSE/);
  const patch={mode:'model_map',modelMap:{options:[{name:'local',description:'Local declared model',provider:'local',model:'fixture-model',credential:{kind:'secret',name:'local'},endpoint:{baseUrl:'http://localhost:9876/v1',api:'openai-completions',contextWindow:4096,maxTokens:512,thinkingLevels:['off']}}]}};
  result=run(['config','--set','-'],JSON.stringify(patch));assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/Saved for new chats/);
  result=run(['config','--mode','default']);assert.equal(result.status,0,result.stderr);result=run(['config','--show']);assert.equal(result.status,0);assert.match(result.stdout,/Saved delegation mode: default/);assert.match(result.stdout,/local: Local declared model/);assert.doesNotMatch(result.stdout+result.stderr,/DO-NOT-DISCLOSE/);
  result=run(['config','--set','-'],JSON.stringify({defaultRoute:{provider:'openai',model:'arbitrary',api_key:secret}}));assert.notEqual(result.status,0);assert.doesNotMatch(result.stdout+result.stderr,/DO-NOT-DISCLOSE/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
