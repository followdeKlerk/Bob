import test from 'node:test';
import assert from 'node:assert/strict';
import {HindsightClient,memoryConfig,type MemoryConfig,type MemoryTagsMatch} from '../packages/memory/src/client.js';

function fakeHttp(handler:(bank:string,body:any)=>unknown|Promise<unknown>=()=>({results:[]})){
 const calls:{path:string;body:any;init:RequestInit}[]=[];
 const transport:typeof fetch=async(url,init)=>{
  const path=new URL(String(url)).pathname,body=JSON.parse(String(init?.body));
  calls.push({path,body,init:init!});
  const response=await handler(decodeURIComponent(path.split('/')[4]),body);
  return response instanceof Response?response:Response.json(response);
 };
 return {calls,transport};
}
const fact=(id:string,scores?:unknown)=>({id,text:'Memory '+id,...(scores===undefined?{}:{scores})});

test('stable defaults forward observation-only recall and an 800-character query to both banks',async()=>{
 const config=memoryConfig(),http=fakeHttp(),client=new HindsightClient(config,http.transport);
 assert.equal(config.enabled,false);assert.equal(config.recallIndicator,true);assert.equal(config.retainIndicator,true);assert.equal(config.minScores,undefined);assert.deepEqual(config.recallBanks,['bob','hermes']);
 assert.equal(config.maxTokens,1600);assert.equal(config.maxInputChars,800);
 assert.deepEqual(await client.recall('q'.repeat(2000),config.recallBanks),{facts:[],unavailable:[]});
 assert.deepEqual(http.calls.map(c=>c.path),['/v1/default/banks/bob/memories/recall','/v1/default/banks/hermes/memories/recall']);
 for(const {body,init} of http.calls){
  assert.deepEqual(body,{query:'q'.repeat(800),budget:'mid',max_tokens:1600,types:['observation'],prefer_observations:true});
  assert.equal(init.method,'POST');assert.equal(init.redirect,'error');assert.ok(init.signal);
 }
});

test('custom query bound, types, budget, token budget, auth and all score keys are forwarded',async()=>{
 const minScores={reranker:0.4,final:1.2,semantic:-0.1,keyword:3};
 const config=memoryConfig({maxInputChars:2300,maxTokens:321,budget:'high',types:['world','experience','observation'],minScores,apiKey:'test-only'});
 const http=fakeHttp(),client=new HindsightClient(config,http.transport);
 await client.recall('x'.repeat(2500),['bob']);
 assert.deepEqual(http.calls[0].body,{query:'x'.repeat(2300),max_tokens:321,budget:'high',types:config.types,prefer_observations:true,min_scores:minScores});
 assert.equal(new Headers(http.calls[0].init.headers).get('authorization'),'Bearer test-only');
 assert.equal(Object.hasOwn(http.calls[0].body.min_scores,'bm25'),false);
});

test('configuration rejects non-finite or nonnumeric floors and unsupported server score keys',()=>{
 for(const stage of ['reranker','final','semantic','keyword'])for(const floor of [NaN,Infinity,-Infinity,'0.5',true,false,null,undefined]){
  assert.throws(()=>memoryConfig({minScores:{[stage]:floor} as any}),/minScores/);
 }
 for(const minScores of [null,[],[0.5],'{}',1,true,{bm25:0.5},{unknown:0.5}])assert.throws(()=>memoryConfig({minScores} as any),/minScores/);
 assert.deepEqual(memoryConfig({minScores:{reranker:-2,final:2,semantic:0,keyword:123}}).minScores,{reranker:-2,final:2,semantic:0,keyword:123});
 assert.equal(memoryConfig({minScores:{}}).minScores,undefined);
});

test('query/configuration bounds and the legacy read-only bank stay validated',()=>{
 for(const maxInputChars of [0,-1,0.5,NaN,Infinity,100001,'800',null])assert.throws(()=>memoryConfig({maxInputChars} as any),/maxInputChars/);
 for(const maxInputChars of [1,800,100000])assert.equal(memoryConfig({maxInputChars}).maxInputChars,maxInputChars);
 for(const types of [[],null,'observation',['opinion'],['observation',null]])assert.throws(()=>memoryConfig({types} as any),/recall configuration/);
 assert.throws(()=>memoryConfig({writeBank:'hermes'}),/recall-only/);
 assert.throws(()=>memoryConfig({maxTokens:99}),/maxTokens/);assert.throws(()=>memoryConfig({maxTokens:8001}),/maxTokens/);
 assert.throws(()=>memoryConfig({baseUrl:'http://example.com'}),/HTTPS/);
});

test('legacy reranker floor is enforced locally, with explicit general reranker taking precedence',async()=>{
 for(const [input,expected] of [
  [{minRerankerScore:0.7},{reranker:0.7}],
  [{minRerankerScore:0.7,minScores:{}},{reranker:0.7}],
  [{minRerankerScore:0.7,minScores:{semantic:0.2}},{reranker:0.7,semantic:0.2}],
  [{minRerankerScore:0.7,minScores:{reranker:0,semantic:0.2}},{reranker:0,semantic:0.2}],
 ] as [Partial<MemoryConfig>,Record<string,number>][]){
  const config=memoryConfig(input),http=fakeHttp(()=>({results:[fact('low',{reranker:0.6,semantic:0.3}),fact('high',{reranker:0.8,semantic:0.3})]}));
  assert.deepEqual(config.minScores,expected);
  const result=await new HindsightClient(config,http.transport).recall('query',['bob']);
  assert.deepEqual(http.calls[0].body.min_scores,expected);
  assert.deepEqual(result.facts.map(f=>f.id),expected.reranker===0?['low','high']:['high']);
 }
 for(const minRerankerScore of [-0.1,1.1,NaN,Infinity,'0.5',null])assert.throws(()=>memoryConfig({minRerankerScore} as any),/relevance floor/);
});

for(const stage of ['reranker','final','semantic','keyword'] as const)test(`${stage} floors keep equality and absent score metadata, reject low/missing/null stages`,async()=>{
 const http=fakeHttp(()=>({results:[
  fact('absent'),fact('null-metadata',null),fact('equal',{[stage]:0.5}),fact('above',{[stage]:0.6}),
  fact('low',{[stage]:0.49}),fact('missing',{}),fact('null-stage',{[stage]:null}),
  fact('string-stage',{[stage]:'0.9'}),fact('boolean-stage',{[stage]:true}),fact('malformed',[]),fact('scalar',1),
 ]}));
 const result=await new HindsightClient(memoryConfig({minScores:{[stage]:0.5}}),http.transport).recall('query',['bob']);
 assert.deepEqual(result.facts.map(f=>f.id),['absent','null-metadata','equal','above']);
 assert.equal(Object.hasOwn(result.facts[0],'scores'),false);assert.equal(result.facts[1].scores,null);
 assert.deepEqual(result.facts[2].scores,{[stage]:0.5});assert.deepEqual(result.unavailable,[]);
});

test('every configured stage must pass, filtering happens before normalized cross-bank dedupe',async()=>{
 const floors={reranker:0.8,final:0.7,semantic:0.6,keyword:1.5};
 const http=fakeHttp(bank=>({results:bank==='bob'?[
  {...fact('weak',{...floors,semantic:0.5}),text:' Shared   fact '},
  ...Object.keys(floors).map(stage=>fact('missing-'+stage,Object.fromEntries(Object.entries(floors).filter(([key])=>key!==stage)))),
 ]:[{...fact('strong',{...floors,extra:12}),text:'shared fact',type:'observation',document_id:'doc-1',mentioned_at:'2026-07-01'}]}));
 const result=await new HindsightClient(memoryConfig({minScores:floors}),http.transport).recall('query',['bob','hermes']);
 assert.deepEqual(result.facts,[{bank:'hermes',id:'strong',text:'shared fact',type:'observation',documentId:'doc-1',mentionedAt:'2026-07-01',scores:{...floors}}]);
 assert.deepEqual(result.unavailable,[]);
});

test('without floors score metadata is preserved without removing low/missing stages or malformed facts breaking the bank',async()=>{
 const http=fakeHttp(()=>({results:[null,{}, {id:1,text:'bad'}, {id:'bad',text:2},fact('low',{reranker:-1,semantic:null}),fact('empty',{}),fact('absent')]}));
 const result=await new HindsightClient(memoryConfig(),http.transport).recall('query',['bob']);
 assert.deepEqual(result.facts.map(f=>f.id),['low','empty','absent']);
 assert.deepEqual(result.facts[0].scores,{reranker:-1,semantic:null});assert.deepEqual(result.unavailable,[]);
});

test('all results filtered out is a successful empty facts result, not an unavailable bank or reference block',async()=>{
 const http=fakeHttp(()=>({results:[fact('low',{semantic:0.1}),fact('other-arm',{semantic:null}),fact('missing',{})]}));
 const result=await new HindsightClient(memoryConfig({minScores:{semantic:0.8}}),http.transport).recall('query',['bob','hermes']);
 assert.deepEqual(result,{facts:[],unavailable:[]});
});

for(const mode of ['any','all','any_strict','all_strict','exact'] as MemoryTagsMatch[])test(`tag payloads support ${mode}, with independent recall/reflect scopes`,async()=>{
 const config=memoryConfig({recallTags:[' project:a ','project:a','source:bob'],recallTagsMatch:mode,reflectTags:['project:b'],reflectTagsMatch:mode});
 const http=fakeHttp(),client=new HindsightClient(config,http.transport);
 await client.recall('query',config.recallBanks);
 await client.request(client.bank('bob')+'/reflect',{query:'reflection',...client.tagScope('reflect')});
 for(const call of http.calls.slice(0,2)){
  assert.deepEqual(call.body.tags,['project:a','source:bob']);assert.equal(call.body.tags_match,mode);
 }
 assert.deepEqual(http.calls[2].body,{query:'reflection',tags:['project:b'],tags_match:mode});
});

test('empty tag scopes omit both fields; reflection never inherits recall tags',async()=>{
 for(const input of [{},{recallTags:['recall-only'],recallTagsMatch:'all_strict' as const},{reflectTags:['reflect-only'],reflectTagsMatch:'exact' as const}]){
  const config=memoryConfig(input),http=fakeHttp(),client=new HindsightClient(config,http.transport);
  await client.recall('query',['bob']);
  await client.request(client.bank('bob')+'/reflect',{query:'reflection',...client.tagScope('reflect')});
  assert.deepEqual(http.calls[0].body.tags,config.recallTags.length?config.recallTags:undefined);
  assert.deepEqual(http.calls[1].body.tags,config.reflectTags.length?config.reflectTags:undefined);
  for(const [index,tags] of [config.recallTags,config.reflectTags].entries())if(!tags.length){
   assert.equal(Object.hasOwn(http.calls[index].body,'tags'),false);assert.equal(Object.hasOwn(http.calls[index].body,'tags_match'),false);
  }
 }
});

test('tag settings validate actual supported modes and nonempty string lists, without mutating caller config',()=>{
 for(const scope of ['recall','reflect']){
  for(const mode of ['and','or','none','ANY','',null,0])assert.throws(()=>memoryConfig({[scope+'TagsMatch']:mode}),/tags match/);
  for(const tags of ['project:a',null,{},[1],[''],['  '],['ok',false]])assert.throws(()=>memoryConfig({[scope+'Tags']:tags}),/tags/);
 }
 const input={recallTags:[' project:a ','project:a'],minScores:{semantic:0.5}},config=memoryConfig(input);
 assert.deepEqual(input.recallTags,[' project:a ','project:a']);assert.deepEqual(config.recallTags,['project:a']);
 config.minScores!.semantic=0.9;assert.equal(input.minScores.semantic,0.5);
 const client=new HindsightClient(config);client.tagScope('recall').tags!.push('other');assert.deepEqual(config.recallTags,['project:a']);
});

test('banks run concurrently and still merge in configured order, deduplicating normalized text',async()=>{
 let release!:()=>void;const firstWaiting=new Promise<void>(resolve=>release=resolve);
 const http=fakeHttp(async bank=>{
  if(bank==='bob')await firstWaiting;else release();
  return {results:bank==='bob'?[{...fact('primary'),text:' Shared\n fact '}]:[{...fact('duplicate'),text:'shared fact'},fact('legacy')]};
 });
 const result=await new HindsightClient(memoryConfig(),http.transport).recall('query',['bob','hermes']);
 assert.deepEqual(result.facts.map(f=>[f.bank,f.id]),[['bob','primary'],['hermes','legacy']]);
 assert.ok(http.calls.every(c=>c.path.endsWith('/memories/recall')),'the legacy bank is searched, never written');
});

test('global token-character, per-fact and 30-result bounds survive multi-bank score filtering',async()=>{
 for(const [maxTokens,length,count] of [[100,5000,1],[1600,5000,3],[8000,100,30]]){
  const http=fakeHttp(bank=>({results:Array.from({length:40},(_,i)=>({...fact(bank+i,{reranker:1}),text:(bank+i+':').padEnd(length,'x')}))}));
  const result=await new HindsightClient(memoryConfig({maxTokens,minScores:{reranker:0.5}}),http.transport).recall('query',['bob','hermes']);
  assert.equal(result.facts.length,count);assert.ok(result.facts.every(f=>f.text.length<=3000));
  assert.ok(result.facts.reduce((n,f)=>n+f.text.length,0)<=maxTokens*4);
  if(maxTokens<=1600)assert.equal(result.facts.reduce((n,f)=>n+f.text.length,0),maxTokens*4);
  assert.ok(result.facts.every(f=>f.scores?.reranker===1));
 }
});

test('one unavailable or malformed bank does not remove the other bank results',async()=>{
 for(const bad of [Response.json({}, {status:503}),{results:{}},null]){
  const http=fakeHttp(bank=>bank==='bob'?bad:{results:[fact('legacy',{semantic:0.8})]});
  const result=await new HindsightClient(memoryConfig({minScores:{semantic:0.5}}),http.transport).recall('query',['bob','hermes']);
  assert.deepEqual(result.unavailable,['bob']);assert.equal(result.facts[0].bank,'hermes');
 }
});

test('response size bound and caller cancellation are retained',async()=>{
 const huge=fakeHttp(()=>new Response(JSON.stringify({results:[fact('x')],metadata:'x'.repeat(2*1024*1024)})));
 assert.deepEqual(await new HindsightClient(memoryConfig(),huge.transport).recall('query',['bob']),{facts:[],unavailable:['bob']});
 const controller=new AbortController(),reason=Error('owner cancelled');controller.abort(reason);
 const transport:typeof fetch=async(_url,init)=>{init?.signal?.throwIfAborted();throw Error('Expected cancellation');};
 await assert.rejects(new HindsightClient(memoryConfig(),transport).recall('query',['bob','hermes'],controller.signal),error=>error===reason);
});

test('passive recall/retain indicators default on and accept only booleans',()=>{
 for(const key of ['recallIndicator','retainIndicator'] as const){
  assert.equal(memoryConfig()[key],true);assert.equal(memoryConfig({[key]:false})[key],false);
  for(const value of [0,1,'true','false',null,undefined,[],{}])assert.throws(()=>memoryConfig({[key]:value}),new RegExp(key));
 }
});

test('request forwards explicit PATCH unchanged, preserves GET/POST defaults and never retries',async()=>{
 const calls:{url:string;init:RequestInit}[]=[],config=memoryConfig({apiKey:'test-only'});
 let fail=false;
 const transport:typeof fetch=async(url,init)=>{calls.push({url:String(url),init:init!});return Response.json({ok:!fail},{status:fail?503:200});};
 const client=new HindsightClient(config,transport),path=client.bank('bob')+'/config',body={updates:{mission:'Test mission'}};
 const controller=new AbortController();
 assert.deepEqual(await client.request(path,body,controller.signal,config.requestTimeoutMs,'PATCH'),{ok:true});
 assert.equal(calls[0].url,config.baseUrl+path);assert.equal(calls[0].init.method,'PATCH');
 assert.deepEqual(JSON.parse(String(calls[0].init.body)),body);
 assert.equal(new Headers(calls[0].init.headers).get('content-type'),'application/json');
 assert.equal(new Headers(calls[0].init.headers).get('authorization'),'Bearer test-only');
 assert.equal(calls[0].init.redirect,'error');controller.abort();assert.equal(calls[0].init.signal?.aborted,true);
 await client.request(path);await client.request(path,body);
 assert.deepEqual(calls.map(c=>c.init.method),['PATCH','GET','POST']);
 assert.equal(calls[1].init.body,undefined);assert.equal(new Headers(calls[1].init.headers).has('content-type'),false);
 fail=true;await assert.rejects(client.request(path,body,undefined,config.requestTimeoutMs,'PATCH'),/Hindsight HTTP 503/);
 assert.equal(calls.length,4,'a failed PATCH must not be retried');
});

test('exact with empty tags forwards an explicit global-only scope independently for recall and reflect',async()=>{
 for(const scope of ['recall','reflect'] as const){
  const config=memoryConfig({[`${scope}TagsMatch`]:'exact'}),http=fakeHttp(),client=new HindsightClient(config,http.transport);
  await client.recall('query',config.recallBanks);
  await client.request(client.bank('bob')+'/reflect',{query:'reflection',...client.tagScope('reflect')});
  for(const [index,{body}] of http.calls.entries()){
   const exact=scope==='recall'?index<2:index===2;
   if(exact){assert.deepEqual(body.tags,[]);assert.equal(body.tags_match,'exact');}
   else{assert.equal(Object.hasOwn(body,'tags'),false);assert.equal(Object.hasOwn(body,'tags_match'),false);}
  }
 }
});

test('preserved score telemetry never echoes arbitrary server metadata into tool context',async()=>{
 const http=fakeHttp(()=>({results:[{...fact('safe'),scores:{reranker:0.8,semantic:null,keyword:2,final:1.1,unexpected:'DO_NOT_ECHO'.repeat(1000),nested:{secret:'NO'}}}]}));
 const result=await new HindsightClient(memoryConfig(),http.transport).recall('query',['bob']);
 assert.deepEqual(result.facts[0].scores,{reranker:0.8,semantic:null,keyword:2,final:1.1});
 assert.doesNotMatch(JSON.stringify(result),/DO_NOT_ECHO|nested|secret/);
});
