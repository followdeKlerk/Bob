/** Plain HTTP adapter: no Hermes/Python lifecycle or upstream Durable dependencies. */
export type MemoryConfig = {
 enabled:boolean; baseUrl:string; writeBank:string; recallBanks:string[];
 apiKey?:string; recallTimeoutMs:number; requestTimeoutMs:number; maxTokens:number;
 budget:'low'|'mid'|'high'; types:string[]; minRerankerScore?:number;
 maxTurnChars:number; maxAttempts:number; retryDelayMs:number; pollDelayMs:number;
};
export function memoryConfig(input:Partial<MemoryConfig>={}):MemoryConfig {
 const config:MemoryConfig={enabled:false,baseUrl:'http://127.0.0.1:8888',writeBank:'bob',recallBanks:['bob','hermes'],recallTimeoutMs:10000,requestTimeoutMs:20000,maxTokens:1600,budget:'mid',types:['observation','world','experience'],maxTurnChars:24000,maxAttempts:5,retryDelayMs:2000,pollDelayMs:2000,...input};
 const url=new URL(config.baseUrl);
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('Invalid Hindsight API URL');
 if(url.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('Remote Hindsight requires HTTPS');
 config.baseUrl=config.baseUrl.replace(/\/+$/,'');
 if(config.writeBank==='hermes')throw Error('The legacy Hermes bank is recall-only');
 if(!/^[\w.-]{1,128}$/.test(config.writeBank)||!config.recallBanks.length||config.recallBanks.length>8||config.recallBanks.some(b=>!/^[\w.-]{1,128}$/.test(b)))throw Error('Invalid memory banks');
 for(const [key,min,max] of [['recallTimeoutMs',10,60000],['requestTimeoutMs',10,180000],['maxTokens',100,8000],['maxTurnChars',100,100000],['maxAttempts',1,10],['retryDelayMs',10,60000],['pollDelayMs',10,60000]] as const)if(!Number.isInteger(config[key])||config[key]<min||config[key]>max)throw Error('Invalid memory setting: '+key);
 if(typeof config.enabled!=='boolean'||!['low','mid','high'].includes(config.budget)||!config.types.length||config.types.some(t=>!['observation','world','experience'].includes(t)))throw Error('Invalid recall configuration');
 if(config.minRerankerScore!==undefined&&(!Number.isFinite(config.minRerankerScore)||config.minRerankerScore<0||config.minRerankerScore>1))throw Error('Invalid relevance floor');
 return config;
}
export class MemoryHttpError extends Error { constructor(readonly status:number){super(`Hindsight HTTP ${status}`);} get retryable(){return this.status===408||this.status===429||this.status>=500;} }
export type MemoryFact={bank:string;id:string;text:string;type?:string;documentId?:string;mentionedAt?:string};
export class HindsightClient {
 constructor(readonly config:MemoryConfig,readonly transport:typeof fetch=fetch){}
 async request(path:string,body?:unknown,signal?:AbortSignal,timeout=this.config.requestTimeoutMs):Promise<any>{
  const abort=AbortSignal.timeout(timeout),combined=signal?AbortSignal.any([signal,abort]):abort;
  const response=await this.transport(this.config.baseUrl+path,{method:body===undefined?'GET':'POST',headers:{accept:'application/json',...(body===undefined?{}:{'content-type':'application/json'}),...(this.config.apiKey?{authorization:'Bearer '+this.config.apiKey}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:combined,redirect:'error'});
  if(!response.ok)throw new MemoryHttpError(response.status);
  // Bound hostile/misconfigured server output, including its metadata.
  const reader=response.body?.getReader();if(!reader)throw Error('Empty Hindsight response');
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024)throw Error('Hindsight response exceeds 2 MiB');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
 }
 bank(bank:string){return '/v1/default/banks/'+encodeURIComponent(bank);}
 async recall(query:string,banks:readonly string[],signal?:AbortSignal):Promise<{facts:MemoryFact[];unavailable:string[]}>{
  const result=await Promise.all(banks.map(async bank=>{
   try{
    const data=await this.request(this.bank(bank)+'/memories/recall',{query:query.slice(0,1600),budget:this.config.budget,max_tokens:this.config.maxTokens,types:this.config.types,prefer_observations:true,...(this.config.minRerankerScore===undefined?{}:{min_scores:{reranker:this.config.minRerankerScore}})},signal,this.config.recallTimeoutMs);
    if(!Array.isArray(data.results))throw Error('Invalid recall response');
    return {bank,facts:data.results.filter((f:any)=>typeof f.id==='string'&&typeof f.text==='string').map((f:any)=>({bank,id:f.id,text:f.text,type:typeof f.type==='string'?f.type:undefined,documentId:typeof f.document_id==='string'?f.document_id:undefined,mentionedAt:typeof f.mentioned_at==='string'?f.mentioned_at:undefined})) as MemoryFact[]};
   }catch{if(signal?.aborted)throw signal.reason;return {bank,facts:null};}
  }));
  const facts:MemoryFact[]=[],seen=new Set<string>();let chars=0;const limit=this.config.maxTokens*4;
  for(const part of result)for(const fact of part.facts??[]){if(facts.length>=30||chars>=limit)break;const key=fact.text.toLowerCase().replace(/\s+/g,' ').trim();if(seen.has(key))continue;seen.add(key);const text=fact.text.slice(0,Math.min(3000,limit-chars));if(!text)break;facts.push({...fact,text});chars+=text.length;if(facts.length>=30||chars>=limit)break;}
  return {facts,unavailable:result.filter(r=>r.facts===null).map(r=>r.bank)};
 }
}
