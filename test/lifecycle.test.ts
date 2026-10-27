import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
import {ChatMeta} from '../src/documents.js';
import {Subagents} from '../src/subagents.js';
import {LiveDoc,InboxDoc} from '@earendil-works/pi-durable';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
test('deterministic official background subagent: root stop preserves child; tree stop settles child', {timeout:20000},async()=>{
 const s=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-stop-'))),models=createModels(),faux=fauxProvider({tokensPerSecond:500});models.setProvider(faux.provider);
 const route=(request:any)=>{const m=request.messages.findLast((x:any)=>x.role!=='system');const text=typeof m.content==='string'?m.content:JSON.stringify(m.content);if(m.role==='toolResult')return fauxAssistantMessage('Parent finished');if(text==='start child')return fauxAssistantMessage([fauxToolCall('subagent',{action:'spawn',name:'child',message:'long child work'})],{stopReason:'toolUse'});return fauxAssistantMessage('Long child work '.repeat(10000));};
 faux.setResponses(Array.from({length:10},()=>route));const rt=await openRuntime(s,models);
 try{const c=await rt.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);await c.commit(async tx=>{(await tx.doc(ChatMeta,c.id)).subagentRequests=['test-allow'];},ctx);
 const sub=await c.submit({type:'input',content:'start child',requestId:'test-allow',entry:{kind:'bob.user',data:{allowSubagents:true}}},ctx);await sub.wait(ctx);const state=await rt.harness.snapshot(Subagents,c.id,ctx);assert.ok(state?.agents.child);const id=state.agents.child.conversationId;
 await c.abort(ctx);assert.ok((await rt.harness.snapshot(LiveDoc,id,ctx))?.run,'root abort must preserve background child');
 await c.abort(ctx,{background:true});assert.equal((await rt.harness.snapshot(LiveDoc,id,ctx))?.run,undefined);
 }finally{await rt.close();s.close();}
});
test('deterministic official inbox separates steer and followUp; abort settles queued submissions',{timeout:10000},async()=>{
 const s=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-inbox-'))),models=createModels(),faux=fauxProvider({tokensPerSecond:20});models.setProvider(faux.provider);faux.setResponses([fauxAssistantMessage('Slow '.repeat(2000))]);const rt=await openRuntime(s,models);
 try{const c=await rt.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);await c.submit({type:'input',content:'first'},ctx);const a=await c.submit({type:'input',content:'steer',whenBusy:'steer'},ctx);const b=await c.submit({type:'input',content:'next',whenBusy:'followUp'},ctx);const inbox=await rt.harness.snapshot(InboxDoc,c.id,ctx);assert.ok(inbox?.items.some(i=>i.mode==='steer'));assert.ok(inbox?.items.some(i=>i.mode==='followUp'));await c.abort(ctx);assert.equal((await a.status(ctx)).status,'unanswered');assert.equal((await b.status(ctx)).status,'unanswered');}finally{await rt.close();s.close();}
});
