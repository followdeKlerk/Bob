/** Plain HTTP adapter: no Hermes/Python lifecycle or upstream Durable dependencies. */
export type MemoryScoreStage='reranker'|'final'|'semantic'|'keyword';
export type MemoryScores=Partial<Record<MemoryScoreStage,number|null>>;
export type MemoryTagsMatch='any'|'all'|'any_strict'|'all_strict'|'exact';
export type MemoryConfig = {
 enabled:boolean; recallIndicator:boolean; retainIndicator:boolean; baseUrl:string; writeBank:string; recallBanks:string[];
 apiKey?:string; recallTimeoutMs:number; requestTimeoutMs:number; maxTokens:number;
 budget:'low'|'mid'|'high'; types:string[]; minScores?:Partial<Record<MemoryScoreStage,number>>;
 /** Legacy fallback, used only when minScores.reranker is not set. */
 minRerankerScore?:number; maxInputChars:number;
 recallTags:string[]; recallTagsMatch:MemoryTagsMatch; reflectTags:string[]; reflectTagsMatch:MemoryTagsMatch;
 maxTurnChars:number; maxAttempts:number; retryDelayMs:number; pollDelayMs:number;
};
export function memoryConfig(input:Partial<MemoryConfig>={}):MemoryConfig {
 const config:MemoryConfig={enabled:false,recallIndicator:true,retainIndicator:true,baseUrl:'http://127.0.0.1:8888',writeBank:'bob',recallBanks:['bob','hermes'],recallTimeoutMs:10000,requestTimeoutMs:20000,maxTokens:1600,budget:'mid',types:['observation'],maxInputChars:800,recallTags:[],recallTagsMatch:'any',reflectTags:[],reflectTagsMatch:'any',maxTurnChars:24000,maxAttempts:5,retryDelayMs:2000,pollDelayMs:2000,...input};
 const url=new URL(config.baseUrl);
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('Invalid Hindsight API URL');
 if(url.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('Remote Hindsight requires HTTPS');
 config.baseUrl=config.baseUrl.replace(/\/+$/,'');
 if(config.writeBank==='hermes')throw Error('The legacy Hermes bank is recall-only');
 if(!/^[\w.-]{1,128}$/.test(config.writeBank)||!config.recallBanks.length||config.recallBanks.length>8||config.recallBanks.some(b=>!/^[\w.-]{1,128}$/.test(b)))throw Error('Invalid memory banks');
 for(const [key,min,max] of [['recallTimeoutMs',10,60000],['requestTimeoutMs',10,180000],['maxTokens',100,8000],['maxInputChars',1,100000],['maxTurnChars',100,100000],['maxAttempts',1,10],['retryDelayMs',10,60000],['pollDelayMs',10,60000]] as const)if(!Number.isInteger(config[key])||config[key]<min||config[key]>max)throw Error('Invalid memory setting: '+key);
 if(typeof config.enabled!=='boolean'||!['low','mid','high'].includes(config.budget)||!Array.isArray(config.types)||!config.types.length||config.types.some(t=>!['observation','world','experience'].includes(t)))throw Error('Invalid recall configuration');
 if(config.minRerankerScore!==undefined&&(!Number.isFinite(config.minRerankerScore)||config.minRerankerScore<0||config.minRerankerScore>1))throw Error('Invalid relevance floor');
 for(const key of ['recallIndicator','retainIndicator'] as const)if(typeof config[key]!=='boolean')throw Error('Invalid memory setting: '+key);
 if(config.minScores!==undefined){
  if(!config.minScores||typeof config.minScores!=='object'||Array.isArray(config.minScores)||Object.entries(config.minScores).some(([stage,floor])=>!['reranker','final','semantic','keyword'].includes(stage)||!Number.isFinite(floor)))throw Error('Invalid minScores: expected finite reranker, final, semantic or keyword floors');
 }
 // General floors may use any finite range: keyword/final scores are not probabilities.
 // An explicit reranker floor wins; other general floors retain the legacy fallback.
 const floors={...(config.minRerankerScore===undefined?{}:{reranker:config.minRerankerScore}),...config.minScores};
 config.minScores=Object.keys(floors).length?floors:undefined;
 for(const scope of ['recall','reflect'] as const){
  const tags=config[`${scope}Tags`],mode=config[`${scope}TagsMatch`];
  if(!Array.isArray(tags)||tags.some(tag=>typeof tag!=='string'||!tag.trim()))throw Error('Invalid '+scope+' tags');
  if(!['any','all','any_strict','all_strict','exact'].includes(mode))throw Error('Invalid '+scope+' tags match');
  config[`${scope}Tags`]=[...new Set(tags.map(tag=>tag.trim()))];
 }
 return config;
}
export class MemoryHttpError extends Error { constructor(readonly status:number){super(`Hindsight HTTP ${status}`);} get retryable(){return this.status===408||this.status===429||this.status>=500;} }
export type MemoryFact={bank:string;id:string;text:string;type?:string;documentId?:string;mentionedAt?:string;scores?:MemoryScores|null};
/** Stable Hermes semantics: old servers without score metadata remain usable. */
function clearsMinScores(scores:unknown,floors:MemoryConfig['minScores']):boolean {
 if(!floors||scores===undefined||scores===null)return true;
 if(typeof scores!=='object'||Array.isArray(scores))return false;
 return Object.entries(floors).every(([stage,floor])=>{
  const value=(scores as Record<string,unknown>)[stage];
  return typeof value==='number'&&Number.isFinite(value)&&value>=floor;
 });
}
/** Keep the score telemetry bounded and numeric; never echo arbitrary server metadata. */
function reportedScores(value:unknown):MemoryScores|null {
 if(value===null)return null;
 if(!value||typeof value!=='object'||Array.isArray(value))return {};
 return Object.fromEntries(['reranker','final','semantic','keyword'].flatMap(stage=>{
  const score=(value as Record<string,unknown>)[stage];
  return score===null||typeof score==='number'&&Number.isFinite(score)?[[stage,score]]:[];
 }));
}
export class HindsightClient {
 constructor(readonly config:MemoryConfig,readonly transport:typeof fetch=fetch){}
 async request(path:string,body?:unknown,signal?:AbortSignal,timeout=this.config.requestTimeoutMs,method:'GET'|'POST'|'PATCH'=body===undefined?'GET':'POST'):Promise<any>{
  const abort=AbortSignal.timeout(timeout),combined=signal?AbortSignal.any([signal,abort]):abort;
  const response=await this.transport(this.config.baseUrl+path,{method,headers:{accept:'application/json',...(body===undefined?{}:{'content-type':'application/json'}),...(this.config.apiKey?{authorization:'Bearer '+this.config.apiKey}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:combined,redirect:'error'});
  if(!response.ok)throw new MemoryHttpError(response.status);
  // Bound hostile/misconfigured server output, including its metadata.
  const reader=response.body?.getReader();if(!reader)throw Error('Empty Hindsight response');
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024)throw Error('Hindsight response exceeds 2 MiB');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
 }
 bank(bank:string){return '/v1/default/banks/'+encodeURIComponent(bank);}
 /** Independent scopes; exact + empty tags explicitly selects global-only memories. */
 tagScope(scope:'recall'|'reflect'):{tags?:string[];tags_match?:MemoryTagsMatch}{
  const tags=this.config[`${scope}Tags`],mode=this.config[`${scope}TagsMatch`];
  return tags.length||mode==='exact'?{tags:[...tags],tags_match:mode}:{};
 }
 async recall(query:string,banks:readonly string[],signal?:AbortSignal):Promise<{facts:MemoryFact[];unavailable:string[]}>{
  const result=await Promise.all(banks.map(async bank=>{
   try{
    const data=await this.request(this.bank(bank)+'/memories/recall',{query:query.slice(0,this.config.maxInputChars),budget:this.config.budget,max_tokens:this.config.maxTokens,types:this.config.types,prefer_observations:true,...(this.config.minScores?{min_scores:this.config.minScores}:{}),...this.tagScope('recall')},signal,this.config.recallTimeoutMs);
    if(!Array.isArray(data.results))throw Error('Invalid recall response');
    return {bank,facts:data.results.filter((f:any)=>f&&typeof f.id==='string'&&typeof f.text==='string'&&clearsMinScores(f.scores,this.config.minScores)).map((f:any)=>({bank,id:f.id,text:f.text,type:typeof f.type==='string'?f.type:undefined,documentId:typeof f.document_id==='string'?f.document_id:undefined,mentionedAt:typeof f.mentioned_at==='string'?f.mentioned_at:undefined,...(f.scores===undefined?{}:{scores:reportedScores(f.scores)})})) as MemoryFact[]};
   }catch{if(signal?.aborted)throw signal.reason;return {bank,facts:null};}
  }));
  const facts:MemoryFact[]=[],seen=new Set<string>();let chars=0;const limit=this.config.maxTokens*4;
  for(const part of result)for(const fact of part.facts??[]){if(facts.length>=30||chars>=limit)break;const key=fact.text.toLowerCase().replace(/\s+/g,' ').trim();if(seen.has(key))continue;seen.add(key);const text=fact.text.slice(0,Math.min(3000,limit-chars));if(!text)break;facts.push({...fact,text});chars+=text.length;if(facts.length>=30||chars>=limit)break;}
  return {facts,unavailable:result.filter(r=>r.facts===null).map(r=>r.bank)};
 }
}
