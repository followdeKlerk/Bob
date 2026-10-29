import {createHash} from 'node:crypto';
import {isAbsolute} from 'node:path';
import {statSync} from 'node:fs';
import {z} from 'zod';
import {getSupportedThinkingLevels, type Models} from '@earendil-works/pi-ai/models';
import type {State} from './state.js';
import {moduleCatalog,moduleState} from './modules.js';

export const DelegationMode=z.enum(['default','model_map','profile_routes']);
export type DelegationMode=z.infer<typeof DelegationMode>;
const Name=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/);
const Description=z.string().trim().min(1).max(500).refine(s=>!/[\r\n]/.test(s),'Use a one-line description');
export const CredentialReference=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('provider'),provider:Name}).strict(),
  z.object({kind:z.literal('secret'),name:Name}).strict(),
  z.object({kind:z.literal('none')}).strict(),
]);
export const Thinking=z.enum(['off','minimal','low','medium','high','xhigh','max']);
export const Route=z.object({
  provider:Name,model:z.string().trim().min(1).max(200),
  reasoning_effort:Thinking.optional(),service_tier:z.enum(['normal','fast','ultrafast']).optional(),
  credential:CredentialReference.optional(),
  endpoint:z.object({baseUrl:z.string().max(2000),api:z.enum(['openai-completions','openai-responses']),contextWindow:z.number().int().min(1024).max(10000000),maxTokens:z.number().int().min(1).max(1000000),thinkingLevels:z.array(Thinking).min(1).max(7).default(['off'])}).strict().optional(),
}).strict();
export type DelegationRoute=z.infer<typeof Route>;
export const Profile=z.object({name:Name,route:Route,instructions:z.string().max(100000).default(''),skills:z.array(Name).max(100).default([]),cwd:z.string().max(8192),modules:z.array(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)).max(32)}).strict();
export type DelegationProfile=z.infer<typeof Profile>;
const NamedRoute=Route.extend({name:Name,description:Description});
const ModelMap=z.object({options:z.array(NamedRoute).max(100).default([]),default:Name.optional()}).strict();
const ProfileRoutes=z.object({profiles:z.array(z.object({name:Name,description:Description}).strict()).max(100).default([]),default:Name.optional()}).strict();
export const DelegationConfig=z.object({version:z.literal(1).default(1),mode:DelegationMode.default('default'),defaultRoute:Route.nullable().default(null),modelMap:ModelMap.default({options:[]}),profileRoutes:ProfileRoutes.default({profiles:[]}),profiles:z.array(Profile).max(100).default([])}).strict();
export type DelegationConfig=z.infer<typeof DelegationConfig>;
export const DEFAULT_DELEGATION:DelegationConfig=DelegationConfig.parse({});
const KEY='delegation:v1';
export const fingerprint=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** No raw keys are accepted by the config schema, including nested objects. */
export function readDelegationConfig(state:State):DelegationConfig {return DelegationConfig.parse(state.get(KEY)??{});}
export function delegationSecret(state:State,name:string):string|undefined{return state.get<string>('delegationSecret:'+Name.parse(name));}
export function setDelegationSecret(state:State,name:string,key:string){Name.parse(name);if(!key.trim()||key.length>10000)throw Error('Supply a nonempty credential of at most 10000 characters on stdin');state.set('delegationSecret:'+name,key.trim());}
export function routeCredential(route:DelegationRoute){return route.credential??{kind:'provider' as const,provider:route.provider};}
export function validateEndpoint(route:DelegationRoute){
 if(!route.endpoint)return;
 let url:URL;try{url=new URL(route.endpoint.baseUrl);}catch{throw Error('Invalid delegation endpoint URL');}
 if(url.username||url.password||url.search||url.hash||!(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))))throw Error('Delegation endpoints require HTTPS (or loopback HTTP), without user info, query or fragment');
 if(!route.credential||route.credential.kind==='provider')throw Error('Custom endpoints require an explicit dedicated secret reference or keyless credential; backend provider credentials are never forwarded');
 if(route.endpoint.maxTokens>route.endpoint.contextWindow)throw Error('Endpoint maxTokens exceeds contextWindow');
 if(new Set(route.endpoint.thinkingLevels).size!==route.endpoint.thinkingLevels.length)throw Error('Duplicate endpoint thinking level');
}
export async function validateRoute(route:DelegationRoute,models:Models,state:State){
 validateEndpoint(route);
 const model=route.endpoint?undefined:models.getModel(route.provider,route.model);
 if(!route.endpoint&&!model)throw Error('Delegation route names an unknown configured provider or model');
 const levels=route.endpoint?.thinkingLevels??getSupportedThinkingLevels(model!);
 if(route.reasoning_effort&&!levels.includes(route.reasoning_effort))throw Error('Delegation thinking effort is unsupported by this model');
 const credential=routeCredential(route);
 if(credential.kind==='none'&&!route.endpoint)throw Error('Keyless credentials require an explicit custom endpoint');
 if(credential.kind==='secret'&&!delegationSecret(state,credential.name))throw Error('Delegation credential reference is missing; use bob delegation secret');
 let auth;
 if(credential.kind==='provider'){
  if(credential.provider!==route.provider)throw Error('Provider credential reference must match the route provider');
  try{auth=await models.checkAuth(credential.provider);}catch{throw Error('Delegation provider authentication is unavailable');}
  if(!auth)throw Error('Delegation provider authentication is not configured');
  let available;try{available=await models.getAvailable(credential.provider);}catch{throw Error('Delegation provider authentication is unavailable');}
  if(!available.some(m=>m.id===route.model))throw Error('Delegation model is not available for this credential');
 }
 const tier=route.service_tier??'normal';
 if(tier==='ultrafast')throw Error('Ultrafast is not supported by Bob’s configured provider adapters; no route was saved or spawned');
 if(tier==='fast'&&(route.endpoint||route.provider!=='openai'||model?.api!=='openai-responses'||(credential.kind==='provider'&&auth?.type!=='api_key')))throw Error('Fast requires the native OpenAI Responses API with an API key; subscription/custom/Anthropic fast tiers are unsupported');
}
function unique(names:string[],what:string){if(new Set(names).size!==names.length)throw Error('Duplicate '+what);}
export async function validateDelegationConfig(config:DelegationConfig,models:Models,state:State,activeOnly=false){
 unique(config.modelMap.options.map(r=>r.name),'model route');unique(config.profileRoutes.profiles.map(p=>p.name),'profile allowlist entry');unique(config.profiles.map(p=>p.name),'profile');
 if(config.modelMap.default&&!config.modelMap.options.some(r=>r.name===config.modelMap.default))throw Error('Default model route is not allowlisted');
 if(config.profileRoutes.default&&!config.profileRoutes.profiles.some(p=>p.name===config.profileRoutes.default))throw Error('Default profile is not allowlisted');
 if(config.mode==='model_map'&&!config.modelMap.options.length||config.mode==='profile_routes'&&!config.profileRoutes.profiles.length)throw Error('This delegation mode has nothing configured; use bob delegation config');
 for(const listed of config.profileRoutes.profiles)if(!config.profiles.some(p=>p.name===listed.name))throw Error('An allowlisted delegation profile is missing');
 const profiles=activeOnly?(config.mode==='profile_routes'?config.profiles.filter(p=>config.profileRoutes.profiles.some(x=>x.name===p.name)):[]):config.profiles;
 const routes=[...(!activeOnly||config.mode==='default'?(config.defaultRoute?[config.defaultRoute]:[]):[]),...(!activeOnly||config.mode==='model_map'?config.modelMap.options:[]),...profiles.map(p=>p.route)];
 for(const route of routes)await validateRoute(route,models,state);
 const installed=moduleState(state).installed,catalog=moduleCatalog(state);
 for(const profile of profiles){
  if(profile.modules.some(id=>!installed.includes(id)))throw Error('Profile module is not installed on this backend');
  for(const module of catalog)if(profile.modules.includes(module.id)&&module.requires.some(id=>!profile.modules.includes(id)))throw Error('Profile module dependency is not selected');
  if(!profile.route.credential)throw Error('Profiles must explicitly select their own credential reference; implicit parent credentials are forbidden');
  unique(profile.skills,'profile skill');unique(profile.modules,'profile module');
  if(profile.modules.includes('subagents'))throw Error('Profiles cannot enable recursive subagents');
  try{if(!isAbsolute(profile.cwd)||!statSync(profile.cwd).isDirectory())throw Error();}catch{throw Error('Profile cwd must be an existing absolute backend directory');}
 }
}
export async function saveDelegationConfig(state:State,models:Models,patch:unknown){
 let config:DelegationConfig;const before=delegationVersion(state);
 try{const parsed=DelegationConfig.partial().parse(patch);const update=Object.fromEntries(Object.keys(patch as object).map(key=>[key,parsed[key as keyof typeof parsed]]));config=DelegationConfig.parse({...readDelegationConfig(state),...update});}catch{throw Error('Invalid delegation configuration; unknown fields and inline credentials are forbidden');}
 if(fingerprint(config)===before.fingerprint)return config;
 await validateDelegationConfig(config,models,state,Object.keys(patch as object).every(key=>key==='mode'||key==='version'));
 state.db.exec('BEGIN IMMEDIATE');try{
  const current=delegationVersion(state);if(current.revision!==before.revision||current.fingerprint!==before.fingerprint)throw Error('Delegation configuration changed during validation; inspect --show and retry explicitly');
  if(fingerprint(config)!==before.fingerprint){state.set(KEY,config);state.set('delegationRevision',current.revision+1);}
  state.db.exec('COMMIT');
 }catch(error){state.db.exec('ROLLBACK');throw error;}
 return config;
}
/** Only the mode changes; inactive lists/profiles and unrelated settings are retained. */
export function delegationVersion(state:State){return {revision:state.get<number>('delegationRevision')??0,fingerprint:fingerprint(readDelegationConfig(state))};}
export type DelegationModeEffect={config:DelegationConfig;revision:number;superseded:boolean};
export function saveDelegationMode(state:State,mode:DelegationMode,operation?:string,expected?:ReturnType<typeof delegationVersion>):DelegationModeEffect{
 if(!DelegationMode.safeParse(mode).success)throw Error('Unknown delegation mode');
 const receipt=operation?'delegationModeOperation:'+fingerprint(operation):undefined;
 state.db.exec('BEGIN IMMEDIATE');try{
  const previous=receipt?state.get<DelegationModeEffect>(receipt):undefined;
  if(previous){state.db.exec('COMMIT');return previous;}
  const current=readDelegationConfig(state),version=delegationVersion(state);
  if(mode==='model_map'&&!current.modelMap.options.length||mode==='profile_routes'&&!current.profileRoutes.profiles.length)throw Error('This mode has nothing configured; use bob delegation config');
  const superseded=!!expected&&(expected.revision!==version.revision||expected.fingerprint!==version.fingerprint);
  const result:DelegationModeEffect={config:superseded?current:{...current,mode},revision:version.revision+(superseded?0:1),superseded};
  if(!superseded){state.set(KEY,result.config);state.set('delegationRevision',result.revision);}
  if(receipt)state.set(receipt,result);state.db.exec('COMMIT');return result;
 }catch(error){state.db.exec('ROLLBACK');throw error;}
}
export function describeDelegation(config:DelegationConfig){
 const route=(r:DelegationRoute)=>`${r.provider}/${r.model}${r.reasoning_effort?' · effort '+r.reasoning_effort:''} · ${r.service_tier??'normal'}`;
 return [`Saved delegation mode: ${config.mode}`,
  `1. default — ${config.defaultRoute?route(config.defaultRoute):'parent model'}`,
  `2. model_map — ${config.modelMap.options.length?config.modelMap.options.map(r=>`${r.name}: ${r.description} (${route(r)})`).join('; '):'not configured'}; default: ${config.modelMap.default??'parent'}`,
  `3. profile_routes — ${config.profileRoutes.profiles.length?config.profileRoutes.profiles.map(p=>`${p.name}: ${p.description}`).join('; '):'not configured'}; default: ${config.profileRoutes.default??'parent'}`,
  'Switch: /delegation <mode> saves for new chats. /delegation <mode> --now refreshes this settled chat’s tools (may break the prompt cache).',
  'Configure: bob delegation config --set <JSON-file> (or - for stdin); --show lists routes. Profile/modules selection is not a filesystem or tool sandbox.'
 ].join('\n');
}
