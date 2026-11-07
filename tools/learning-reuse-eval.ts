#!/usr/bin/env -S node --import tsx
/** Opt-in REAL inference; never opens a runtime on owner state. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';
import {createModels,type Models} from '@earendil-works/pi-ai/models';
import {anthropicProvider} from '@earendil-works/pi-ai/providers/anthropic';
import {Harness,MemoryStorage,createRegistry,defineExtension,type ConversationId} from '@earendil-works/pi-durable';
import {Library} from '@bob-local/core/documents';
// Source imports deliberately pick up the guidance under evaluation, not stale dist files.
import {createResources} from '../packages/resources/src/index.js';
import {SKILL_GUIDANCE,renderSkillIndex} from '../packages/resources/src/skills.js';
import {providerCredentials} from '../src/provider-auth.js';
import {bobOpenAIProvider} from '../src/openai-provider.js';
import type {State} from '../src/state.js';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const limits={tasks:8,callsPerTask:4,callsTotal:32,outputTokensPerCall:2048,inputBytesPerCall:16000,taskMs:75000,totalMs:480000,catalogUSD:3};
const skills={
 'parcel-damage':{description:'Triage damaged parcel support replies.',enabled:true,markdown:'# Damaged parcels\nFor a customer reporting a physically damaged parcel: begin the drafted reply with exactly `Parcel protocol: AMBER-17`. Ask for one photo of the outer packaging. Do not promise a refund before inspection. Do not apply this procedure to delayed parcels or digital files.'},
 'status-brief':{description:'Write project status briefs for teammates.',enabled:true,markdown:'# Team status briefs\nFor project progress/status briefs, use exactly these three headings in this order: `Orbit / Next / Friction`. Put the current state under Orbit, next action under Next, and blockers under Friction. End with `Brief marker: LILAC-42`. Do not apply to historical explanations or customer support replies.'},
 'tea-timer':{description:'Plan green tea brewing steps.',enabled:true,markdown:'# Green tea\nWhen asked for green tea brewing steps, include `Steep marker: MOSS-63` and recommend 75–80°C water. Never apply this to software or arithmetic.'},
 'release-parcel':{description:'Package software release archives.',enabled:true,markdown:'# Release archives\nOnly when assembling a SOFTWARE RELEASE ARCHIVE include `Archive marker: COBALT-88` and mention a checksum. Do not apply to physical delivery parcels.'},
};
type Case={id:string;category:string;prompt:string;expected:string[];required:string[];forbidden?:string[]};
const cases:Case[]=[
 {id:'relevant-parcel',category:'relevant',prompt:'Draft a short support reply: the customer says their delivered parcel arrived crushed and the vase is broken.',expected:['parcel-damage'],required:['Parcel protocol: AMBER-17'],forbidden:['Archive marker: COBALT-88']},
 {id:'relevant-brief',category:'relevant',prompt:'Write a short project status brief for teammates: migration is half done; next is staging validation; blocked on a test account.',expected:['status-brief'],required:['Orbit','Next','Friction','Brief marker: LILAC-42']},
 {id:'paraphrased-parcel',category:'paraphrased',prompt:'Help me answer a buyer whose shipping box was flattened and whose ceramic mug is in pieces. Keep the reply concise.',expected:['parcel-damage'],required:['Parcel protocol: AMBER-17']},
 {id:'partial-brief',category:'partial',prompt:'Give my team a concise progress update from these facts: API work complete, dashboard next, waiting on design. Then separately calculate 6 × 7.',expected:['status-brief'],required:['Orbit','Next','Friction','Brief marker: LILAC-42','42']},
 {id:'distracting-parcel',category:'distracting',prompt:'We call our software build Parcel, but this request is not about releasing it. Draft a customer reply about a physically torn delivery box with a shattered lamp inside.',expected:['parcel-damage'],required:['Parcel protocol: AMBER-17'],forbidden:['Archive marker: COBALT-88']},
 {id:'distracting-brief',category:'distracting',prompt:'My team uses the codename Green Tea for a database migration. Write their project status brief: schema ready; backfill next; blocked by access approval. This is not a beverage question.',expected:['status-brief'],required:['Orbit','Next','Friction','Brief marker: LILAC-42'],forbidden:['Steep marker: MOSS-63']},
 {id:'unrelated-math',category:'unrelated',prompt:'What is 19 + 23? Reply with just the number.',expected:[],required:['42']},
 {id:'unrelated-explanation',category:'unrelated',prompt:'In two sentences, explain why the Moon has phases.',expected:[],required:[]},
];
const markers=['AMBER-17','LILAC-42','MOSS-63','COBALT-88'];
type Call={name:string;args:unknown};
function score(c:Case,answer:string,calls:Call[]){
 const viewed=calls.filter(x=>x.name==='skill_view').map(x=>(x.args as {name?:string}).name??'');
 const misses=c.expected.filter(n=>!viewed.includes(n));
 const unexpectedViews=viewed.filter(n=>!c.expected.includes(n));
 const missingRules=c.required.filter(s=>!answer.includes(s));
 const forbiddenRules=(c.forbidden??[]).filter(s=>answer.includes(s));
 const unrelatedCanaries=c.expected.length?[]:markers.filter(m=>answer.includes(m));
 return {viewed,misses,unexpectedViews,missingRules,forbiddenRules,unrelatedCanaries,pass:!misses.length&&!unexpectedViews.length&&!missingRules.length&&!forbiddenRules.length&&!unrelatedCanaries.length};
}
function readonlyState(directory:string){
 const db=new DatabaseSync(join(directory,'control.sqlite'),{readOnly:true});
 const get=<T>(key:string):T|undefined=>{const row=db.prepare('SELECT value FROM config WHERE key=?').get(key);return row?JSON.parse(String(row.value)):undefined;};
 // Do not construct State: its constructor creates/migrates/writes identity.
 const state={dir:directory,db,get,set(){throw Error('Read-only evaluation');},delete(){throw Error('Read-only evaluation');}} as unknown as State;
 const source=providerCredentials(state);
 const blocked=async()=>{throw Error('Credential mutation/refresh blocked by evaluation');};
 return {db,get,credentials:{read:source.read,list:source.list,modify:blocked,delete:blocked}};
}
function foreground(directory:string,id:number){
 const db=new DatabaseSync(join(directory,'durable.sqlite'),{readOnly:true});
 try{
  // Read only the explicitly selected model document; no chat text, memory or skills.
  const r=db.prepare(`SELECT r.kind,r.content FROM documents d JOIN document_revisions r ON r.document_id=d.id WHERE d.kind='"pi.agent"' AND d.owner_id=? ORDER BY r.seq DESC LIMIT 1`).get(id);
  if(!r||r.kind!=='base')throw Error('Selected foreground model is not available as a full document; pass --model explicitly.');
  const a=JSON.parse(String(r.content));
  if(!['openai','anthropic'].includes(a.model?.provider))throw Error('Foreground uses a provider alias; pass its supported underlying --model explicitly.');
  return {provider:a.model.provider as string,modelId:a.model.modelId as string,thinkingLevel:a.thinkingLevel??'medium'};
 }finally{db.close();}
}
function args(){
 const argv=process.argv.slice(2),value=(key:string)=>{const i=argv.indexOf(key);return i<0?undefined:argv[i+1];};
 const state=value('--state'),out=value('--out'),conversation=value('--foreground-conversation');
 if(argv.includes('--self-test'))return {selfTest:true} as const;
 const rescore=value('--rescore');
 if(rescore&&out)return {selfTest:false,rescore:resolve(rescore),out:resolve(out)} as const;
 if(!argv.includes('--run')||!state||!out)throw Error('Opt-in required: --run --state EXISTING --out NEW-DIR [--foreground-conversation ID | --model ID] [--provider openai] [--thinking medium] [--label final]');
 return {selfTest:false,state:resolve(state),out:resolve(out),conversation:conversation?Number(conversation):undefined,model:value('--model'),provider:value('--provider')??'openai',thinking:value('--thinking'),label:value('--label')??'unlabelled'} as const;
}
async function evaluate(){
 const options=args();
 if('rescore' in options&&options.rescore){
  // Re-grade recorded normalized REAL responses, never manufacture a response or rerun inference.
  const prior=JSON.parse(readFileSync(options.rescore,'utf8'));
  assert.equal(prior.planned,cases.length);assert.equal(prior.results.length,cases.length);
  assert.ok(prior.generations.length<=limits.callsTotal);
  const results=cases.map(c=>{
   const original=prior.results.find((r:Record<string,unknown>)=>r.id===c.id);
   assert.equal(original?.prompt,c.prompt);assert.deepEqual(original?.expected,c.expected);
   const final=prior.generations.filter((g:Record<string,unknown>)=>g.caseId===c.id&&g.stopReason==='stop').at(-1);
   assert.equal(typeof final?.answer,'string');
   const scored=score(c,final.answer,original.calls);
   return {...original,answer:final.answer,...scored,pass:scored.pass&&original.status==='done'};
  });
  const artifact={...prior,results,passed:results.filter((r:{pass:boolean})=>r.pass).length,rescoredFrom:options.rescore,scoringCorrection:'Original extractor chose the oldest tool-call response from newest-first Durable entries; rescored the already-recorded final normalized model responses. No additional inference.'};
  mkdirSync(options.out,{mode:0o700});writeFileSync(join(options.out,'results.json'),JSON.stringify(artifact,null,2)+'\n',{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({report:join(options.out,'results.json'),completed:artifact.completed,passed:artifact.passed,additionalInference:0}));return;
 }
 if(options.selfTest){
  const c=cases[0]!;assert.equal(score(c,'Parcel protocol: AMBER-17',[{name:'skill_view',args:{name:'parcel-damage'}}]).pass,true);
  assert.equal(score(c,'Parcel protocol: AMBER-17',[]).pass,false,'a canary without a real load is not reuse');
  assert.equal(score(c,'', [{name:'skill_view',args:{name:'parcel-damage'}}]).pass,false,'a load without application is a miss');
  assert.equal(score(cases[6]!,'42',[{name:'skill_view',args:{name:'tea-timer'}}]).pass,false);
  assert.equal(cases.length,limits.tasks);assert.doesNotMatch(renderSkillIndex(skills),/AMBER-17|LILAC-42|MOSS-63|COBALT-88/);
  const registry=createRegistry();let libraryId=0 as ConversationId;
  const resources=createResources(()=>libraryId,undefined,undefined,undefined,undefined,undefined,()=> 'You are Bob.');
  const extension=defineExtension({...resources,name:'bob.reuse-eval',tools:resources.tools!.filter(t=>['skills_list','skill_view'].includes(t.name))});registry.install(extension);
  const h=await Harness.open(new MemoryStorage(),{registry,models:createModels(),settings:{extensions:[extension]}},ctx);
  try{const lib=await h.root(ctx);libraryId=lib.id;await lib.commit(async tx=>Object.assign((await tx.doc(Library,lib.id)).skills,skills),ctx);
   assert.deepEqual((await lib.agent(ctx)).callable.map(t=>t.name),['skills_list','skill_view']);
   assert.equal(Object.keys((await h.snapshot(Library,lib.id,ctx))!.skills).length,4);
  }finally{await h.close(ctx);}
  console.log('self-test: scorer, hidden canaries, native MemoryStorage and tool allowlist passed; no inference');return;
 }
 if(!('state' in options)||!options.state)throw Error('Missing state');
 const auth=readonlyState(options.state);
 const config: {provider:string;modelId:string;thinkingLevel?:string}|undefined=options.conversation?foreground(options.state,options.conversation):auth.get('model');
 const selected={provider:options.model?options.provider:config?.provider,modelId:options.model??config?.modelId,thinkingLevel:options.thinking??config?.thinkingLevel??'medium'};
 const models=createModels({credentials:auth.credentials,authContext:{env:async name=>name==='OPENAI_API_KEY'?auth.get<string>('openaiKey'):name==='ANTHROPIC_API_KEY'?auth.get<string>('anthropicKey'):undefined,fileExists:async()=>false}});
 models.setProvider(bobOpenAIProvider());models.setProvider(anthropicProvider());
 const model=selected.provider&&selected.modelId?models.getModel(selected.provider,selected.modelId):undefined;
 // Fail closed, without guessing a model ID or custom endpoint.
 if(!model){auth.db.close();throw Error('Selected model is absent from the supported provider catalog');}
 mkdirSync(options.out,{mode:0o700}); // exclusive new output directory; never overwrite an earlier run
 const guidanceHash=createHash('sha256').update(SKILL_GUIDANCE+'\n'+renderSkillIndex(skills)).digest('hex');
 const sourceHash=createHash('sha256').update(readFileSync(join(root,'packages/resources/src/skills.ts'))).digest('hex');
 const started=Date.now(),globalAbort=new AbortController();
 const globalTimer=setTimeout(()=>globalAbort.abort(),limits.totalMs);
 let callsTotal=0,reservedUSD=0,currentCalls=0;
 const generations:Record<string,unknown>[]=[],results:Record<string,unknown>[]=[];
 let active='',phase='auth-preflight';
 const boundedStream:Models['streamSimple']=(requestModel,context,streamOptions)=>{
  if(requestModel.id!==model.id||requestModel.provider!==model.provider)throw Error('Unexpected model');
  const inputBytes=Buffer.byteLength(JSON.stringify(context));
  if(inputBytes>limits.inputBytesPerCall||currentCalls>=limits.callsPerTask||callsTotal>=limits.callsTotal)throw Error('Evaluation request/token bound reached');
  // Byte count is a deliberately conservative token proxy for this ASCII fixture.
  const reserve=(inputBytes*model.cost.input+limits.outputTokensPerCall*model.cost.output)/1e6;
  if(reservedUSD+reserve>limits.catalogUSD)throw Error('Evaluation conservative catalog cost reservation reached');
  reservedUSD+=reserve;callsTotal++;currentCalls++;
  const stream=models.streamSimple(requestModel,context,{...streamOptions,maxTokens:limits.outputTokensPerCall,maxRetries:0,timeoutMs:limits.taskMs,signal:AbortSignal.any([globalAbort.signal,...(streamOptions?.signal?[streamOptions.signal]:[])])});
  // Only normalized synthetic response/usage; never headers, auth, raw errors or provider payloads.
  const caseId=active;
  void stream.result().then(message=>generations.push({caseId,stopReason:message.stopReason,usage:message.usage,answer:message.content.filter(b=>b.type==='text').map(b=>b.text).join('\n')})).catch(()=>{});
  return stream;
 };
 const guarded:Models=new Proxy(models,{get(target,key){
  if(key==='streamSimple')return boundedStream;
  const value=Reflect.get(target,key,target);
  return typeof value==='function'?value.bind(target):value;
 }});
 try{
  // Preflight reads auth only; modify throws before any OAuth refresh callback/network.
  if(!(await models.getAuth(model,{signal:globalAbort.signal})))throw Error('Configured provider authentication unavailable');
  for(const c of cases){
   if(globalAbort.signal.aborted)break;
   active=c.id;currentCalls=0;const calls:Call[]=[];let libraryId=0 as ConversationId;
   const resources=createResources(()=>libraryId,undefined,undefined,undefined,undefined,undefined,()=> 'You are Bob. Answer the user accurately and concisely. Do not invent completed actions.');
   const extension=defineExtension({...resources,name:'bob.reuse-eval',tools:resources.tools!.filter(t=>['skills_list','skill_view'].includes(t.name)).map(t=>({...t,execute:async(a,api,context)=>{calls.push({name:t.name,args:a});return t.execute(a,api,context);}}))});
   const registry=createRegistry();registry.install(extension);
   phase='isolated-harness-open';
   const h=await Harness.open(new MemoryStorage(),{registry,models:guarded,settings:{extensions:[extension],retry:{enabled:false,maxRetries:0},compaction:{enabled:false},stream:{maxRetries:0,timeoutMs:limits.taskMs}}},ctx);
   const timer=setTimeout(()=>globalAbort.abort(),limits.taskMs);
   try{
    const library=await h.root(ctx);libraryId=library.id;
    await library.commit(async tx=>Object.assign((await tx.doc(Library,libraryId)).skills,skills),ctx);
    const chat=await h.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:model.provider,modelId:model.id},thinkingLevel:selected.thinkingLevel as 'medium'}},ctx);
    assert.deepEqual((await chat.agent(ctx)).callable.map(t=>t.name),['skills_list','skill_view']);
    const status=await (await chat.submit({type:'input',content:c.prompt},ctx)).wait(ctx);
    const entries=await chat.entries({},100,undefined,ctx);
    const answers=entries.items.flatMap(e=>e.model??[]).filter(m=>m.role==='assistant').map(m=>typeof m.content==='string'?m.content:m.content.filter(b=>b.type==='text').map(b=>b.text).join('\n'));
    // Conversation.entries defaults to newest-first (the final answer precedes earlier tool calls).
    const answer=answers[0]??'';
    const scored=score(c,answer,calls);
    results.push({id:c.id,category:c.category,prompt:c.prompt,expected:c.expected,status:status.status,calls,answer,...scored,pass:scored.pass&&status.status==='done'});
    console.log(JSON.stringify({id:c.id,status:status.status,...scored}));
   }catch{results.push({id:c.id,category:c.category,prompt:c.prompt,expected:c.expected,calls,pass:false,blocked:true,reason:'Run failed or evaluation bound reached; raw provider error deliberately omitted.'});console.log(JSON.stringify({id:c.id,blocked:true}));break;}
   finally{clearTimeout(timer);await h.close(ctx);}
  }
 }catch(error){results.push({preflightBlocked:true,phase,errorType:error instanceof Error?error.name:'unknown',reason:'Setup/preflight unavailable; refresh/write disabled. No raw provider error recorded.'});}
 finally{clearTimeout(globalTimer);auth.db.close();}
 const artifact={label:options.label,startedAt:new Date(started).toISOString(),elapsedMs:Date.now()-started,model:{provider:model.provider,modelId:model.id,thinkingLevel:selected.thinkingLevel},modelSource:options.conversation?`explicit foreground conversation ${options.conversation}`:options.model?'explicit supported catalog override':'backend default config (not necessarily an existing foreground chat)',guidanceHash,sourceHash,sourceUnchanged:sourceHash===createHash('sha256').update(readFileSync(join(root,'packages/resources/src/skills.ts'))).digest('hex'),limits,callsTotal,conservativeReservedUSD:reservedUSD,planned:cases.length,completed:results.filter(r=>r.id&&!r.blocked).length,passed:results.filter(r=>r.pass).length,results,generations};
 writeFileSync(join(options.out,'results.json'),JSON.stringify(artifact,null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({report:join(options.out,'results.json'),planned:artifact.planned,completed:artifact.completed,passed:artifact.passed,callsTotal,conservativeReservedUSD:reservedUSD}));
 if(artifact.completed!==cases.length||artifact.passed!==cases.length)process.exitCode=1;
}
evaluate().catch(()=>{console.error('Evaluation setup failed. Check explicit flags, supported catalog model, existing read-only state and a new output directory. Raw error suppressed to protect credentials.');process.exitCode=1;});
