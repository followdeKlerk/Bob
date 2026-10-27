import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {customRecords,importCustomModule} from '../src/custom-modules.js';
import {selectModules,changeModule,listModules} from '../src/modules.js';
import {restoreState} from '../src/recovery.js';
import {migrateCustomModule,requireDisjoint} from '../src/custom-migration.js';
function fixture(directory:string,version='0.1.0',step=1,stateVersion=1){
 mkdirSync(join(directory,'dist'),{recursive:true});
 writeFileSync(join(directory,'package.json'),JSON.stringify({name:'bob-custom-fixture',version,type:'module',exports:'./dist/index.js',dependencies:{'@earendil-works/pi-durable':'1.4.0','@earendil-works/pi-ai':'1.4.0'},bobExtension:{api:1,durable:'1.4.0',stateVersion,name:'fixture.counter',requires:[]}}));
 writeFileSync(join(directory,'dist/helper.js'),`export const increment=value=>value+${step};`);
 writeFileSync(join(directory,'dist/index.js'),`import{defineExtension,defineTool,defineDoc}from'@earendil-works/pi-durable';import{Type}from'@earendil-works/pi-ai';import{increment}from'./helper.js';export const Counter=defineDoc({kind:'fixture.counter',version:1,scope:'conversation',history:'latest',fork:'initial',initial:()=>({count:0}),checkpointWhen:()=>true});export default defineExtension({name:'fixture.counter',tools:[defineTool({name:'fixture_counter',description:'Explicit test counter',parameters:Type.Object({}),execute:async(args,api,context)=>{const count=await api.commit(async tx=>{const doc=await tx.doc(Counter,api.conversationId);doc.count=increment(doc.count);return doc.count;},context);return{output:[{type:'text',text:String(count)}]};}})]});`);
}
const cli=(directory:string,args:string[])=>spawnSync(process.execPath,['--import','tsx','src/cli.ts','--state',directory,...args],{encoding:'utf8'});
const codePath=(s:State)=>{const r=customRecords(s)[0];return join(s.dir,'custom-modules',r.id,`${r.manifest.version}-${r.hash}`,'dist/index.js');};

test('staged native document schema migration preserves authority, supports old-code rollback and isolates failure',async()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR!,'bob-schema-')),source=join(dir,'package'),original=join(dir,'original');fixture(source);
 assert.equal(cli(original,['module','import','fixture',source,'--trust-backend-code','--backup',join(dir,'install-backup')]).status,0);
 let state=new State(original),runtime=await openRuntime(state,undefined,undefined,{resume:false});const grant=state.pair(state.invite().token,'Schema device'),identity=state.id;
 const {Counter:OldCounter}=await import(pathToFileURL(codePath(state)).href);
 const chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
 await runtime.harness.commit(async tx=>{const doc=await tx.doc(OldCounter,chat.id);(doc as any).count=7;await tx.appendEntry(chat.id,{kind:'schema-proof',data:{original:true}});},ctx);
 await runtime.close();state.close();
 fixture(source,'0.2.0',10,2);
 const entry=join(source,'dist/index.js'),code=readFileSync(entry,'utf8').replace("version:1,scope:","version:2,migrate:(value,from)=>{if(from!==1)throw Error('unexpected schema');return{count:value.count,migrated:true};},scope:");
 writeFileSync(entry,code+'\nexport const bobMigration={from:1,to:2,documents:[Counter]};');
 const destination=join(dir,'candidate'),backup=join(dir,'migration-backup');
 const migrated=cli(original,['module','migrate','fixture',source,'--trust-backend-code','--replace','0.1.0','--backup',backup,'--destination',destination]);assert.equal(migrated.status,0,migrated.stderr);
 state=new State(destination);runtime=await openRuntime(state,undefined,undefined,{resume:false});
 try{const {Counter}=await import(pathToFileURL(codePath(state)).href);assert.deepEqual(await runtime.harness.snapshot(Counter,chat.id,ctx),{count:7,migrated:true});assert.equal(state.id,identity);assert.ok(state.authenticate(grant.credential));assert.equal(customRecords(state)[0].manifest.bobExtension.stateVersion,2);await assert.rejects(()=>runtime.harness.snapshot(OldCounter,chat.id,ctx),/newer version/);}finally{await runtime.close();state.close();}
 const restored=join(dir,'restored');restoreState(backup,restored);
 for(const path of [original,restored]){state=new State(path);runtime=await openRuntime(state,undefined,undefined,{resume:false});try{assert.deepEqual(await runtime.harness.snapshot(OldCounter,chat.id,ctx),{count:7});assert.equal(customRecords(state)[0].manifest.version,'0.1.0');assert.ok(state.authenticate(grant.credential));}finally{await runtime.close();state.close();}}
 writeFileSync(entry,code.replace('return{count:value.count,migrated:true};',"throw Error('deliberate migration failure');")+'\nexport const bobMigration={from:1,to:2,documents:[Counter]};');
 state=new State(original);try{await assert.rejects(()=>migrateCustomModule(state,'fixture',source,'0.1.0',join(dir,'failed-backup'),join(dir,'failed-state')),/deliberate migration failure/);}finally{state.close();}
 assert.equal(existsSync(join(dir,'failed-state')),false);assert.equal(existsSync(join(dir,'failed-backup/manifest.json')),true);
 symlinkSync(original,join(dir,'alias'),'dir');assert.throws(()=>requireDisjoint([original,join(dir,'alias/nested')]),/overlap/);
});

test('custom native extension: trusted CLI import, independent code archive, compatible upgrade and code+data rollback',async()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR!,'bob-custom-')),source=join(dir,'source'),statePath=join(dir,'state');fixture(source);
 const rejected=cli(statePath,['module','import','fixture',source,'--backup',join(dir,'no-trust')]);assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/trust-backend-code/);
 const installed=cli(statePath,['module','import','fixture',source,'--trust-backend-code','--backup',join(dir,'before-install')]);assert.equal(installed.status,0,installed.stderr);assert.equal(JSON.parse(installed.stdout).defaultSelected,false);
 const models=createModels(),faux=fauxProvider({tokensPerSecond:10000});models.setProvider(faux.provider);let state=new State(statePath),runtime=await openRuntime(state,models),chatId:number;
 const increment=async(runtime:Awaited<ReturnType<typeof openRuntime>>,chat:any)=>{faux.setResponses([fauxAssistantMessage(fauxToolCall('fixture_counter',{}),{stopReason:'toolUse'}),fauxAssistantMessage('DETERMINISTIC custom tool complete')]);await(await chat.submit({type:'input',content:'Exercise real custom native tool'},ctx)).wait(ctx);const {Counter}=await import(pathToFileURL(codePath(state)).href);return(await runtime.harness.snapshot(Counter,chat.id,ctx) as any).count;};
 try{
  const chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);chatId=chat.id;
  assert.ok(!(await chat.agent(ctx)).extensions.some(e=>e.name==='fixture.counter'));
  await selectModules(state,runtime,chat,['resources','fixture']);assert.equal(await increment(runtime,chat),1);
 }finally{await runtime.close();state.close();}
 rmSync(source,{recursive:true});fixture(source,'0.2.0',10);
 const upgraded=cli(statePath,['module','import','fixture',source,'--trust-backend-code','--replace','0.1.0','--backup',join(dir,'before-upgrade')]);assert.equal(upgraded.status,0,upgraded.stderr);
 const manifest=JSON.parse(readFileSync(join(dir,'before-upgrade/manifest.json'),'utf8'));assert.ok(Object.keys(manifest.files).some(name=>name.startsWith('custom-modules/')));
 state=new State(statePath);runtime=await openRuntime(state,models);
 try{assert.equal(customRecords(state)[0].manifest.version,'0.2.0');assert.equal(await increment(runtime,(await runtime.harness.conversation(chatId! as any,ctx))!),11);}finally{await runtime.close();state.close();}
 const restored=join(dir,'restored');restoreState(join(dir,'before-upgrade'),restored);rmSync(source,{recursive:true});
 state=new State(restored);runtime=await openRuntime(state,models);
 try{assert.equal(customRecords(state)[0].manifest.version,'0.1.0');assert.equal(await increment(runtime,(await runtime.harness.conversation(chatId! as any,ctx))!),2);}finally{await runtime.close();}
 runtime=await openRuntime(state,models,undefined,{resume:false});try{await changeModule(state,runtime,'remove','fixture');}finally{await runtime.close();}
 runtime=await openRuntime(state,models);try{assert.equal((await listModules(state,runtime)).find(m=>m.id==='fixture')?.registered,false);const{Counter}=await import(pathToFileURL(codePath(state)).href);assert.equal((await runtime.harness.snapshot(Counter,chatId! as any,ctx) as any).count,2);}finally{await runtime.close();}
 runtime=await openRuntime(state,models,undefined,{resume:false});try{await changeModule(state,runtime,'install','fixture');}finally{await runtime.close();}
 const file=codePath(state),original=readFileSync(file);writeFileSync(file,Buffer.concat([original,Buffer.from('\n// tampered')]));await assert.rejects(()=>openRuntime(state,models),/integrity mismatch/);writeFileSync(file,original);state.close();
});

test('custom imports reject symlinks, incompatible dependencies, schema changes, collisions and unfinished work',async()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR!,'bob-custom-denials-')),source=join(dir,'source');fixture(source);
 const state=new State(join(dir,'state'));let runtime=await openRuntime(state,undefined,undefined,{resume:false});
 try{
  symlinkSync(join(source,'dist/helper.js'),join(source,'dist/link.js'));await assert.rejects(()=>importCustomModule(state,runtime,'fixture',source),/symlinks/);rmSync(join(source,'dist/link.js'));
  const manifest=JSON.parse(readFileSync(join(source,'package.json'),'utf8'));manifest.dependencies.unvalidated='1.0.0';writeFileSync(join(source,'package.json'),JSON.stringify(manifest));await assert.rejects(()=>importCustomModule(state,runtime,'fixture',source),/Unsupported/);
  fixture(source);await importCustomModule(state,runtime,'fixture',source);
 }finally{await runtime.close();}
 runtime=await openRuntime(state,undefined,undefined,{resume:false});
 try{
  fixture(source,'0.2.0',10,2);await assert.rejects(()=>importCustomModule(state,runtime,'fixture',source,'0.1.0'),/state-schema change refused/);
  fixture(source);await assert.rejects(()=>importCustomModule(state,runtime,'other',source),/collision/);assert.equal(customRecords(state).length,1);
  const chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx);await chat.submit({type:'input',content:'Pending, no model/provider used'},ctx);await assert.rejects(()=>importCustomModule(state,runtime,'another',source),/fully settled/);
 }finally{await runtime.close();state.close();}
});
