import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage} from '@earendil-works/pi-ai/providers/faux';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {Library} from '../src/documents.js';

test('native prompt resolution separates defaults, conversation overrides, templates and enabled skills',async()=>{
 const state=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-prompts-'))),models=createModels(),faux=fauxProvider();models.setProvider(faux.provider);
 const seen:string[]=[];faux.setResponses(Array.from({length:3},()=>context=>{seen.push(JSON.stringify(context.messages.filter(m=>m.role==='system')));return fauxAssistantMessage('DETERMINISTIC PROMPT TEST');}));
 const runtime=await openRuntime(state,models);
 try {
   await runtime.library.commit(async tx=>{const library=await tx.doc(Library,runtime.library.id);library.instructions='BACKEND_DEFAULT_MARKER';library.templates={example:'TEMPLATE_NOT_SYSTEM_MARKER'};library.skills={on:{description:'Enabled',markdown:'ENABLED_SKILL_MARKER',enabled:true},off:{description:'Disabled',markdown:'DISABLED_SKILL_MARKER',enabled:false}};},ctx);
   for(const instructions of [undefined,'CONVERSATION_OVERRIDE_MARKER','']) {
     const chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'},instructions}},ctx);
     await chat.submit({type:'input',content:'Inspect prompt fixture'},ctx);await chat.waitForIdle(ctx);
   }
   assert.match(seen[0],/BACKEND_DEFAULT_MARKER/);
   assert.doesNotMatch(seen[1],/BACKEND_DEFAULT_MARKER/);assert.match(seen[1],/CONVERSATION_OVERRIDE_MARKER/);
   assert.doesNotMatch(seen[2],/BACKEND_DEFAULT_MARKER/);
   for(const prompt of seen){assert.match(prompt,/ENABLED_SKILL_MARKER/);assert.doesNotMatch(prompt,/DISABLED_SKILL_MARKER|TEMPLATE_NOT_SYSTEM_MARKER/);}
 } finally {await runtime.close();state.close();}
});
