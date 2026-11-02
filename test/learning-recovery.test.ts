import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Harness,createRegistry,defineExtension,type ConversationId} from '@earendil-works/pi-durable';
import {openNodeSqliteStorage} from '@earendil-works/pi-durable/storage/sqlite/node';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
import {createResources,mutateSkill,mutateCuratedMemory,CuratedMemory} from '@bob-local/resources';
import {Library} from '../src/documents.js';
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function until(check:()=>boolean){for(let i=0;i<500;i++){if(check())return;await sleep(10);}throw Error('Timed out');}

for(const kind of ['skill','memory'] as const)test(`${kind} mutation survives crash after artifact commit and before tool settlement exactly once`,{timeout:20000},async()=>{
 const path=join(mkdtempSync(join(tmpdir(),'bob-learning-replay-')),'durable.sqlite'),models=createModels(),faux=fauxProvider({tokensPerSecond:100000});models.setProvider(faux.provider);
 let libraryId=0 as ConversationId,committed=false,interrupt=true;
 async function open(){
  const base=createResources(()=>libraryId,undefined,undefined,undefined,undefined,undefined,()=> 'You are Bob.');
  const target=kind==='skill'?'skill_manage':'memory';
  const extension=defineExtension({...base,tools:base.tools?.map(tool=>tool.name!==target?tool:{...tool,execute:async(args:any,api:any,context:any)=>{
   const result=await tool.execute(args,api,context);
   if(interrupt){committed=true;await new Promise<void>(resolve=>{if(context.abortSignal.aborted)resolve();else context.abortSignal.addEventListener('abort',()=>resolve(),{once:true});});throw Error('Simulated process interruption after native artifact commit');}
   return result;
  }})});
  const registry=createRegistry();registry.install(extension);
  const h=await Harness.open(await openNodeSqliteStorage(path),{registry,models,settings:{extensions:[extension]}},ctx);libraryId=(await h.root(ctx)).id;return h;
 }
 let h=await open();
 try{
  const chat=await h.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);
  if(kind==='skill')await h.commit(tx=>mutateSkill(tx,libraryId,chat.id,{action:'create',name:'repeat',description:'Replay fixture.',markdown:'A'}),ctx);
  else await h.commit(tx=>mutateCuratedMemory(tx,libraryId,chat.id,{action:'add',target:'user',content:'A'}),ctx);
  const args=kind==='skill'?{action:'patch',name:'repeat',old_string:'A',new_string:'AB',expectedRevision:1}:{action:'patch',target:'user',old_text:'A',content:'AB',expectedRevision:1};
  faux.setResponses([fauxAssistantMessage([fauxToolCall(kind==='skill'?'skill_manage':'memory',args)],{stopReason:'toolUse'})]);
  const submission=await chat.submit({type:'input',requestId:'replay-fixture',content:'Make the single patch.'},ctx);
  await until(()=>committed);await h.close(ctx);interrupt=false;
  faux.setResponses([fauxAssistantMessage('The single patch is complete.')]);h=await open();h.resume();
  const recovered=await h.submission(submission.id,ctx);assert.ok(recovered);const settled=await recovered.wait(ctx);assert.equal(settled.status,'done');
  if(kind==='skill')assert.equal((await h.snapshot(Library,libraryId,ctx))!.skills.repeat.markdown,'AB');
  else assert.deepEqual((await h.snapshot(CuratedMemory,libraryId,ctx))!.user.entries,['AB']);
  const entries=await (await h.conversation(chat.id,ctx))!.entries({},100,undefined,ctx);
  if(kind==='skill'){const notices=entries.items.filter(e=>e.kind==='bob.learning-status');assert.equal(notices.length,2,'creation and patch each emit once across restart');assert.equal(notices.filter(e=>(e.data as any).text==="💾 Skill update: Skill 'repeat' patched").length,1);}
  const result=entries.items.find(e=>e.kind==='pi.tool-result');assert.ok(result);assert.doesNotMatch(JSON.stringify(result.model),/conflict|isError":true/);
 }finally{await h.close(ctx);}
});
