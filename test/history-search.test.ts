import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {fauxProvider} from '@earendil-works/pi-ai/providers/faux';
import {createModels} from '@earendil-works/pi-ai/models';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {searchHistory} from '../src/history-search.js';

test('history discovery returns bounded, relevance-ranked snippets without transcript payloads',async()=>{
 const state=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-history-search-'))),models=createModels();models.setProvider(fauxProvider().provider);
 const runtime=await openRuntime(state,models);
 try{
  const relevant=await runtime.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);
  const unrelated=await runtime.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);
  await relevant.commit(tx=>tx.appendEntry(relevant.id,{kind:'bob.user',data:{text:'Please revise my CV for a senior engineering role. '.repeat(40)}}),ctx);
  await unrelated.commit(tx=>tx.appendEntry(unrelated.id,{kind:'bob.user',data:{text:'Tell me about mountain gardens.'}}),ctx);
  const result=await searchHistory(runtime as any,state,{query:'CV senior engineering'});
  assert.equal(result.results[0].id,relevant.id);assert.equal(result.results.length,1);assert.ok(result.results[0].snippet.length<=240);assert.equal(JSON.stringify(result).includes('repeat(40)'),false);assert.equal(result.mode,'bounded-discovery');
  await assert.rejects(()=>searchHistory(runtime as any,state,{query:' '}),/Provide a short search query/);
 }finally{await runtime.close();state.close();}
});
