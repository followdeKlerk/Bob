import {createModels,createProvider,type Models,type Provider} from '@earendil-works/pi-ai/models';
import type {Api,Model,SimpleStreamOptions,StreamOptions,AssistantMessage} from '@earendil-works/pi-ai';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai/utils/event-stream';
import {openAICompletionsApi} from '@earendil-works/pi-ai/api/openai-completions.lazy';
import {openAIResponsesApi} from '@earendil-works/pi-ai/api/openai-responses.lazy';
import {delegationSecret,fingerprint,routeCredential,type DelegationRoute,validateEndpoint} from './delegation-config.js';
import type {State} from './state.js';

const prefix='bob-ad-';
/** Aliases have their own credential-free Models container. No ambient environment/files,
 * host credential-store lookup for an alias, or fallback to another provider is possible. */
export function createDelegationModels(base:Models,state:State){
 const aliases=createModels({authContext:{env:async()=>undefined,fileExists:async()=>false}});
 const models=new Proxy(base,{get(target,key){
  const value=Reflect.get(target,key);if(typeof value!=='function')return value;
  return (...args:unknown[])=>{
   const first=args[0],id=typeof first==='string'?first:first&&typeof first==='object'&&'provider' in first?first.provider:undefined;
   const destination=typeof id==='string'&&id.startsWith(prefix)?aliases:target;
   const method=Reflect.get(destination,key);return method.apply(destination,args);
  };
 }}) as Models;
 function install(route:DelegationRoute){
  validateEndpoint(route);
  const id=prefix+fingerprint(route).slice(0,32);
  if(aliases.getProvider(id))return {provider:id,modelId:route.model};
  const original=route.endpoint?undefined:base.getProvider(route.provider);
  const known=route.endpoint?undefined:base.getModel(route.provider,route.model);
  if(!route.endpoint&&(!original||!known))throw Error('Delegation provider/model is unavailable; configure a supported route and refresh /delegation --now');
  const endpoint=route.endpoint;
  const template:Model<Api>=known??{
   id:route.model,name:route.model,provider:route.provider,api:endpoint!.api,baseUrl:endpoint!.baseUrl,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},
   reasoning:endpoint!.thinkingLevels.some(level=>level!=='off'),thinkingLevelMap:Object.fromEntries(['off','minimal','low','medium','high','xhigh','max'].map(level=>[level,endpoint!.thinkingLevels.includes(level as never)?level:null])),contextWindow:endpoint!.contextWindow,maxTokens:endpoint!.maxTokens,
  };
  const implementation=original??(endpoint!.api==='openai-responses'?openAIResponsesApi():openAICompletionsApi());
  const credential=routeCredential(route);
  const auth:Provider['auth']={apiKey:{name:'Explicit delegation credential',
   async check(){
    if(credential.kind==='none')return {type:'api_key'};
    if(credential.kind==='secret')return delegationSecret(state,credential.name)?{type:'api_key'}:undefined;
    try{return await base.checkAuth(credential.provider);}catch{throw Error('Delegation credential is unavailable');}
   },
   async resolve(){
    if(credential.kind==='none')return {auth:{apiKey:'bob-keyless-local'}};
    if(credential.kind==='secret'){const key=delegationSecret(state,credential.name);return key?{auth:{apiKey:key}}:undefined;}
    try{
     if(route.service_tier==='fast'&&(await base.checkAuth(credential.provider))?.type!=='api_key')throw Error();
     return await base.getAuth(credential.provider);
    }catch{throw Error('Delegation credential or speed tier is unavailable; no fallback was used');}
   }
  }};
  function invoke(model:Model<Api>,context:Parameters<Provider['streamSimple']>[1],options:SimpleStreamOptions|StreamOptions|undefined,simple:boolean){
   let verifiedTier=route.service_tier!=='fast';
   const opts:SimpleStreamOptions={...options,
    ...(route.service_tier==='fast'?{
     transport:'sse' as const,
     onPayload:async(payload:unknown,m:Model<Api>)=>{
      const transformed=await options?.onPayload?.(payload,m)??payload;
      if(!transformed||typeof transformed!=='object')throw Error('Invalid priority-tier payload');
      return {...transformed,service_tier:'priority'};
     },
     onProviderStreamEvent:async(event:unknown,m:Model<Api>)=>{
      await options?.onProviderStreamEvent?.(event,m);
      const value=event as {type?:string;response?:{service_tier?:string}};
      if(value?.type==='response.completed')verifiedTier=value.response?.service_tier==='priority';
     },
    }:{}),
   };
   // The provider implementation still sees its real identity; only the host's lookup uses the alias.
   const actual={...model,provider:route.provider};
   const output=createAssistantMessageEventStream();
   const clean=(message:AssistantMessage)=>{
    const copy=structuredClone(message);
    if(copy.stopReason==='error')copy.content=[];
    if(copy.errorMessage||copy.stopReason==='error')copy.errorMessage='Delegation provider request failed; check the configured provider/credential. No fallback was used.';
    if(!verifiedTier&&['stop','length','toolUse'].includes(copy.stopReason)){
     copy.stopReason='error';copy.content=[];copy.errorMessage='The provider did not confirm the requested priority tier; the response was refused. No fallback tier was accepted.';
    }
    return copy;
   };
   void(async()=>{try{
    // Adapter construction itself can throw (including credential-bearing SDK errors).
    const stream=simple?implementation.streamSimple(actual,context,opts):implementation.stream(actual,context,opts);
    for await(const event of stream){
     if(event.type==='done'){const message=clean(event.message);output.push(message.stopReason==='error'?{type:'error',reason:'error',error:message}:{...event,message});}
     else if(event.type==='error')output.push({...event,error:clean(event.error)});
     // Error-bearing partials are not model prose: never persist an SDK error body/key.
     // Priority responses likewise stay private until the provider confirms that tier.
     else if(route.service_tier!=='fast'&&!event.partial.errorMessage&&event.partial.stopReason!=='error')output.push(event);
    }
    output.end(clean(await stream.result()));
   }catch{
    const message:AssistantMessage={role:'assistant',content:[],api:template.api,provider:route.provider,model:route.model,stopReason:'error',errorMessage:'Delegation provider request failed; no fallback was used.',timestamp:Date.now(),usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
    output.push({type:'error',reason:'error',error:message});output.end(message);
   }})();
   return output;
  }
  aliases.setProvider(createProvider({id,name:'Delegation route',baseUrl:template.baseUrl,auth,models:[{...template,provider:id}],api:{
   stream:(m,c,o)=>invoke(m,c,o,false),streamSimple:(m,c,o)=>invoke(m,c,o,true),
  }}));
  return {provider:id,modelId:route.model};
 }
 return {models,install};
}
