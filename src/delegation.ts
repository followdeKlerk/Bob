import {readCorePrompt} from '@bob-local/resources';
import {DelegationBudget,authorizeDelegation,checkDelegationDispatch,recordDelegationDispatch,restoreDelegationBudget,stopDelegationHelper} from './delegation-budget.js';
import {DelegationChildTools,DelegationToolProvisioning,provisionLegacyDelegationTools,applyDelegationTools,enforceDelegationTools,snapshotDelegationTools,COORDINATOR_POLICY,readDelegationBehavior,behaviorRevision} from './delegation-behavior.js';
import {Type,type ModelThinkingLevel} from '@earendil-works/pi-ai';
import {getSupportedThinkingLevels,type Models} from '@earendil-works/pi-ai/models';
import {defineDoc,defineExtension,configure,AgentDoc,GenerationTask,hook,wrapTool,wrapSection,section,LiveDoc,InboxDoc,type Agent,type Conversation,type ConversationId,type ConversationRecord,type Cursor,type Extension,type Harness,type Registry,type ToolExecutionApi,type ToolRegistration,type Tx} from '@earendil-works/pi-durable';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';
import {Library} from './documents.js';
import {Subagents,SubagentTools} from './subagents.js';
import type {State} from './state.js';
import {DEFAULT_DELEGATION,DelegationConfig,readDelegationConfig,fingerprint,validateRoute,type DelegationRoute,type DelegationProfile} from './delegation-config.js';
import {createDelegationModels} from './delegation-providers.js';

export const DelegationSession=defineDoc<{config?:DelegationConfig}>({kind:'bob.delegation-session',version:1,scope:'conversation',history:'rewindable',fork:'asOf',checkpointWhen:()=>true,initial:()=>({})});
export type RouteObservation={label:string;provider:string;model:string;reasoning_effort:ModelThinkingLevel;service_tier:string;profile?:string};
type ChildState={route?:DelegationRoute;observation?:RouteObservation;profile?:DelegationProfile;toolPolicyVersion?:1;skills?:{name:string;description:string;markdown:string}[]};
export const DelegationChild=defineDoc<ChildState>({kind:'bob.delegation-child',version:1,scope:'conversation',history:'latest',fork:'current',checkpointWhen:()=>true,initial:()=>({})});
export const delegationSnapshotName=(config:DelegationConfig)=>'bob.delegation.session.'+fingerprint(config);
const childExtensionName='bob.delegation.child';
const isSnapshot=(name:string)=>name.startsWith('bob.delegation.session.');
const refresh='Delegation settings changed or this chat’s tool snapshot is unavailable. Use /delegation <mode> --now in a settled chat, or start a new chat; no alternate route was used.';
const native=SubagentTools.tools![0] as ToolRegistration;
function currentRoute(config:DelegationConfig,args:{option?:string;profile?:string}){
 if(args.option&&config.mode!=='model_map'||args.profile&&config.mode!=='profile_routes'||args.option&&args.profile)throw Error(refresh);
 if(config.mode==='default')return {label:'default',route:config.defaultRoute??undefined};
 if(config.mode==='model_map'){
  const chosen=args.option??config.modelMap.default;
  if(!chosen)return {label:'parent',route:undefined};
  const route=config.modelMap.options.find(r=>r.name===chosen);if(!route)throw Error('Unknown allowlisted option. '+refresh);
  return {label:chosen,route};
 }
 const chosen=args.profile??config.profileRoutes.default;
 if(!chosen)return {label:'parent',route:undefined};
 if(!config.profileRoutes.profiles.some(p=>p.name===chosen))throw Error('Unknown allowlisted profile. '+refresh);
 const profile=config.profiles.find(p=>p.name===chosen);if(!profile)throw Error('Allowlisted profile is missing. '+refresh);
 return {label:chosen,route:profile.route,profile};
}
export function delegationSchema(config:DelegationConfig){
 const field=config.mode==='model_map'?'option':config.mode==='profile_routes'?'profile':undefined;
 const choices=config.mode==='model_map'?config.modelMap.options:config.profileRoutes.profiles;
 return Type.Object({...((native.parameters as {properties:Record<string,any>}).properties),...(field&&choices.length?{[field]:Type.Optional(Type.Union(choices.map(c=>Type.Literal(c.name)),{description:'Spawn only: choose a configured route, or omit for the mode default / parent.\n'+choices.map(c=>`${c.name}: ${c.description}`).join('\n')}))}: {})},{additionalProperties:false});
}
export function formatDelegationRoute(route:RouteObservation){return `${route.label}: ${route.provider}/${route.model} · effort ${route.reasoning_effort} · tier ${route.service_tier}${route.profile?' · profile '+route.profile:''}`;}
/** Native transactional check, called before any table writes. */
export async function requireDelegationSettled(tx:Tx,id:ConversationId){
 const live=await tx.doc(LiveDoc,id),inbox=await tx.doc(InboxDoc,id);
 if(live.run||inbox.items.length)throw Error('Stop and settle this chat and its background work before /delegation --now');
 for(const status of ['pending','running','waiting','sleeping','completing'] as const){
  const tasks=await tx.scanTasks({conversationId:id,status},1);if(tasks.items.length)throw Error('Stop and settle this chat and its background work before /delegation --now');
 }
}
export function createDelegation(state:State,baseModels:Models,registry:Registry,getLibrary:()=>ConversationId,getModules:()=>Record<string,Extension>,corePrompt:()=>string=readCorePrompt){
 const providerRoutes=createDelegationModels(baseModels,state),models=providerRoutes.models;
 const childExtension=defineExtension({name:childExtensionName,
  wraps:[wrapSection('bob-resources',original=>({...original,render:async(input,context)=>{
   const child=await input.read.snapshot(DelegationChild,input.conversationId,context);
   if(!child?.profile)return original.render(input,context);
   return (child.skills??[]).map(s=>`Skill ${s.name}: ${s.description}\n${s.markdown}`).join('\n\n');
  }})),wrapSection('bob-model-identity',original=>({...original,render:async(input,context)=>{
   const child=await input.read.snapshot(DelegationChild,input.conversationId,context);
   return child?.observation?`Configured delegation route: ${formatDelegationRoute(child.observation)}. Use this actual configuration when asked.`:original.render(input,context);
  }}))],
  sections:[...['bob-policy','bob-notes','bob-phone-location','bob-self-update','bob-diagnostics','bob-resources','bob-model-identity'].map(key=>section(key,async(input,context)=>{
   const source=getModules().resources?.sections?.find(s=>s.key===key);
   return source?source.render(input,context):key==='bob-policy'?corePrompt():undefined;
  })),section('bob-delegation-route',async(input,context)=>{const child=await input.read.snapshot(DelegationChild,input.conversationId,context);return child?.observation?`Actual subagent route: ${formatDelegationRoute(child.observation)}. You cannot start subagents. Module and cwd selection is not a sandbox.`:undefined;})],
  hooks:[hook(GenerationTask,{afterResponse:async(message,api,context)=>{
   if(!['stop','length','toolUse'].includes(message.stopReason)||(message.stopReason==='toolUse'&&message.content.some(block=>block.type==='toolCall')))return;
   const child=await api.snapshot(DelegationChild,api.conversationId,context);if(!child?.observation)return;
   // Native reporter copies this exact final answer; its task/input/state and deduplication stay unchanged.
   message.content.push({type:'text',text:`\n\n[Delegation route: ${formatDelegationRoute(child.observation)}]`});
  }})],
 });
 registry.install(childExtension);
 function installSnapshot(config:DelegationConfig){
  const name=delegationSnapshotName(config);let extension=registry.snapshot().extension(name);
  if(!extension){extension=defineExtension({name,wraps:[wrapTool(native,tool=>({...tool,parameters:delegationSchema(config)}))]});registry.install(extension);}
  return extension;
 }
 async function installChild(child:Readonly<ChildState>){if(child.route)providerRoutes.install(child.route);}
 function prepare(config:DelegationConfig,args:{option?:string;profile?:string}){
  const selected=currentRoute(config,args),current=readDelegationConfig(state);
  if(readDelegationBehavior(state).enabled&&current.mode==='profile_routes'&&(config.mode!=='profile_routes'||!selected.profile))throw Error('Adaptive profile delegation requires a profiled snapshot; inherited-parent fallback is blocked. '+refresh);
  if(selected.route||args.option||args.profile){
   if(current.mode!==config.mode)throw Error(refresh);
   const latest=currentRoute(current,args);
   if(fingerprint(selected)!==fingerprint(latest))throw Error(refresh);
  }
  return selected;
 }
 const tool:ToolRegistration={...native,execute:async(raw,api,context)=>{
  const args=raw as {action:string;name?:string;message?:string;option?:string;profile?:string};
  if((args.action==='spawn'||args.action==='send')&&args.name!==undefined&&(!args.name.trim()||['__proto__','prototype','constructor'].includes(args.name)))throw Error('Choose a non-empty, non-reserved helper name');
  if(args.action!=='spawn'&&(args.option!==undefined||args.profile!==undefined))throw Error('option/profile apply to spawn only; existing subagents keep their original route');
  let selected:ReturnType<typeof currentRoute>|undefined,parent:Agent|undefined,effort:ModelThinkingLevel|undefined;
  if(args.action==='spawn'){
   const snapshot=await api.snapshot(DelegationSession,api.conversationId,context);parent=await api.agent(context);
   if(!snapshot?.config||!parent.extensions.some(e=>e.name===delegationSnapshotName(snapshot.config!)))throw Error(refresh);
   selected=prepare(snapshot.config,args);
   if(selected.route)await validateRoute(selected.route,baseModels,state);
   const profile=selected.profile;
   if(profile){
    for(const id of profile.modules){const ext=getModules()[id];if(!ext||!registry.snapshot().extension(ext.name)||ext.name===SubagentTools.name)throw Error('A profile module is unavailable or would enable recursive delegation');}
   }
   const ref=selected.route?providerRoutes.install(selected.route):parent.model;
   const model=ref?models.getModel(ref.provider,ref.modelId):undefined;if(!model)throw Error('No supported model is configured for the subagent');
   effort=selected.route?.reasoning_effort??parent.thinkingLevel;
   if(!getSupportedThinkingLevels(model).includes(effort))throw Error('Inherited thinking effort is unsupported by the chosen route; configure an explicit supported effort');
  }
  const dispatch=args.action==='spawn'||args.action==='send';
  const authority=dispatch?await api.commit(tx=>authorizeDelegation(state,tx,api.conversationId),context):undefined;
  if(args.action==='stop'&&args.name!==undefined)await api.commit(tx=>stopDelegationHelper(tx,api.conversationId,args.name!),context);
  const adapted:ToolExecutionApi={...api,commit:(change,callContext)=>api.commit(async tx=>{
   const agents=await tx.doc(Subagents,api.conversationId),before=args.name&&Object.hasOwn(agents.agents,args.name)?agents.agents[args.name].conversationId:undefined,previous=agents.reporters[api.taskId];
   if(dispatch)await checkDelegationDispatch(state,tx,api.conversationId,api.taskId,args,authority!.epoch);
   if(args.action==='send'&&before){const child=await tx.doc(DelegationChild,before);if(child.profile){const stored=await tx.doc(AgentDoc,before);if(!Array.isArray(stored.extensions))throw Error('Saved child module selection is unavailable');const extensions=stored.extensions.map(name=>registry.snapshot().extension(name));if(extensions.some(extension=>!extension||extension.tools?.some(tool=>tool.name==='subagent')))throw Error('A saved child profile module is unavailable or would enable recursion');await enforceDelegationTools(tx,before,child.profile,extensions as Extension[]);}}
   const value=await change(tx);
   const childId=args.name?agents.agents[args.name]?.conversationId:undefined;
   if(args.action==='spawn'&&selected&&childId&&childId!==before){
    // Runs after original native authorization, creation and reporter scheduling, but BEFORE commit.
    // A throw rolls back child/anchor/reporter together. No reporter can deliver before configuration.
    const snapshot=await tx.doc(DelegationSession,api.conversationId);
    if(!snapshot.config)throw Error(refresh);
    // Recheck after asynchronous auth/validation and native authorization, while creation is atomic.
    const latest=prepare(snapshot.config,args);
    if(fingerprint(latest)!==fingerprint(selected))throw Error(refresh);
    const target=selected.route?providerRoutes.install(selected.route):parent!.model!;
    const profile=selected.profile;
    const extensions=profile?profile.modules.map(id=>getModules()[id]):parent!.extensions.filter(e=>e.name!==SubagentTools.name&&!isSnapshot(e.name)&&e.name!==childExtensionName);
    if(extensions.some(e=>e.tools?.some(t=>t.name==='subagent')))throw Error('Profile or inherited modules would permit recursive delegation');
    await configure(tx,childId,{model:target,thinkingLevel:effort!,extensions:[...extensions,childExtension],...(profile?{instructions:`${profile.instructions}\n\nYou are the subagent ${JSON.stringify(args.name)}. Answer the main agent’s requests.`,cwd:profile.cwd}: {})});
    if(profile)await applyDelegationTools(state,tx,api.conversationId,childId,profile,extensions);
    const child=await tx.doc(DelegationChild,childId);
    const observation:RouteObservation={label:selected.label,provider:selected.route?.provider??parent!.model!.provider,model:selected.route?.model??parent!.model!.modelId,reasoning_effort:effort!,service_tier:selected.route?.service_tier??'normal',...(profile?{profile:profile.name}:{})};
    child.observation=observation;if(selected.route)child.route=selected.route;
    if(profile){child.profile=profile;child.toolPolicyVersion=1;const library=await tx.doc(Library,getLibrary());child.skills=profile.skills.map(name=>{const skill=library.skills[name];if(!skill)throw Error('A selected profile skill is missing');return {name,description:skill.description,markdown:skill.markdown};});}
   }
   if(dispatch&&args.name)await recordDelegationDispatch(state,tx,api.conversationId,api.taskId,args.name,previous,authority!.epoch);
   return value;
  },callContext)};
  // Original native tool object and original task definitions remain the lifecycle authority.
  const result=await native.execute(raw,adapted,context);
  const agents=await api.snapshot(Subagents,api.conversationId,context);
  const names=args.name?[args.name]:args.action==='status'?Object.keys(agents?.agents??{}):[];
  const observations:Record<string,RouteObservation>={};
  for(const name of names){const id=agents?.agents[name]?.conversationId;if(id){const child=await api.snapshot(DelegationChild,id,context);if(child?.observation)observations[name]=child.observation;}}
  if(!Object.keys(observations).length)return result;
  return {...result,output:[...result.output??[],{type:'text',text:Object.entries(observations).map(([name,route])=>`${name} — route ${formatDelegationRoute(route)}`).join('\n')}],details:{...(result.details as Record<string,any>??{}),routes:observations}};
 }};
 const extension=defineExtension({...SubagentTools,tools:[tool],sections:[section('bob-adaptive-delegation',async(input,context)=>{const behavior=readDelegationBehavior(state);if(!behavior.enabled)return;const budget=await input.read.snapshot(DelegationBudget,input.conversationId,context);if(!budget?.owner?.adaptive||!budget.owner.allow||budget.revoked||budget.owner.revision!==behaviorRevision(state)||budget.owner.fingerprint!==fingerprint(behavior))return 'Adaptive delegation is enabled globally, but this chat has no current authorized owner scope. Do not spawn or send helpers; status/stop remain available. A fresh authenticated owner instruction is required.';return `${COORDINATOR_POLICY}\nNative limits: ${behavior.maxActive} active helpers and ${behavior.maxDispatches} spawn/send dispatches per newest authorized owner task. Ordinary newer owner messages supersede earlier report authority, without cancelling helpers. /delegation auto status preserves scope and uses no inference or dispatch budget.`;})]});
 async function selectSnapshot(tx:Tx,id:ConversationId,config:DelegationConfig){
  const snapshot=installSnapshot(config),agent=await tx.doc(AgentDoc,id);
  // Native configure replaces selections: preserve the CURRENT transaction's full array/modifier,
  // not a previously resolved Agent which a concurrent module edit may have superseded.
  const names=(values:readonly string[]|undefined)=>(values??[]).filter(name=>!isSnapshot(name)).map(name=>({name}));
  await configure(tx,id,{extensions:Array.isArray(agent.extensions)?[...names(agent.extensions),snapshot]:{add:[...names(agent.extensions?.add),snapshot],remove:names(agent.extensions?.remove)}});
 }
 async function created(tx:Tx,conversation:ConversationRecord){
  if(conversation.owner)return;
  const session=await tx.doc(DelegationSession,conversation.id);
  // Forks keep the matching as-of snapshot. New sessions select current defaults only once.
  const config=session.config??readDelegationConfig(state);session.config=config;
  await selectSnapshot(tx,conversation.id,config);
  await snapshotDelegationTools(state,tx,conversation.id);
 }
 async function legacyLineage(tx:Tx,record:ConversationRecord,child:Readonly<ChildState>){
  if(!child.profile||child.observation?.profile!==child.profile.name||!child.route||fingerprint(child.route)!==fingerprint(child.profile.route))throw Error('Unverified legacy profile metadata; tool policy migration refused');
  let current:ConversationRecord|undefined=record;
  for(let depth=0;current&&depth<64;depth++){
   if(current.owner){const anchor=await tx.task(current.owner.taskId),agents=await tx.doc(Subagents,current.owner.conversationId);if(anchor?.kind==='app.subagent-anchor'&&anchor.version===1&&anchor.conversationId===current.owner.conversationId&&anchor.background&&anchor.owner===undefined&&Object.values(agents.agents).some(agent=>agent.conversationId===current!.id))return;break;}
   if(!current.parent)break;current=await tx.conversation(current.parent.conversationId);
  }
  throw Error('Unverified legacy child/fork lineage; tool policy migration refused');
 }
 async function restore(harness:Harness){
  // Freeze eligibility once. A crash resumes this same closed range; after completion,
  // a missing policy is corruption/unavailable code, never an invitation to infer permissions.
  const provisioning=await harness.commit(async tx=>{const saved=await tx.doc(DelegationToolProvisioning,getLibrary());if(saved.cutoff===undefined)saved.cutoff=(await tx.scanConversations({order:'descending'},1)).items[0]?.id??getLibrary();return {cutoff:saved.cutoff,complete:saved.complete};},ctx);
  let cursor:Cursor|undefined;
  do{
   const page=await harness.commit(tx=>tx.scanConversations({},100,cursor),ctx);
   for(const conversation of page.items){
    const saved=await harness.snapshot(DelegationSession,conversation.id,ctx);
    if(saved?.config)installSnapshot(DelegationConfig.parse(saved.config));
    else if(!conversation.owner){
     // Legacy sessions keep legacy/default schema; configuration edits apply only to new sessions.
     const chat=(await harness.conversation(conversation.id,ctx))!,agent=await chat.agent(ctx);
     await chat.commit(async tx=>{(await tx.doc(DelegationSession,conversation.id)).config=DEFAULT_DELEGATION;await configure(tx,conversation.id,{extensions:[...agent.extensions,installSnapshot(DEFAULT_DELEGATION)]});},ctx);
    }
    if(!conversation.owner)await harness.commit(async tx=>{await snapshotDelegationTools(state,tx,conversation.id,false,true);await restoreDelegationBudget(tx,conversation.id);},ctx);
    const child=await harness.snapshot(DelegationChild,conversation.id,ctx);if(child){await installChild(child);if(child.profile){const chat=(await harness.conversation(conversation.id,ctx))!,agent=await chat.agent(ctx);await harness.commit(async tx=>{
     const saved=await tx.doc(DelegationChild,conversation.id),policy=await tx.doc(DelegationChildTools,conversation.id);
     if(!policy.policy){if(saved.toolPolicyVersion===1||provisioning.complete||conversation.id>provisioning.cutoff)throw Error('Saved child tool policy is missing; delegation is blocked');await legacyLineage(tx,conversation,saved);if(!agent.extensions.some(extension=>extension.name===childExtensionName))throw Error('Legacy profile extension is missing');await provisionLegacyDelegationTools(tx,conversation.id,saved.profile!,agent.extensions);saved.toolPolicyVersion=1;}
     if(saved.toolPolicyVersion!==1)throw Error('Saved child tool policy marker is missing; delegation is blocked');
     await enforceDelegationTools(tx,conversation.id,child.profile!,agent.extensions,true);
    },ctx);}}
   }
   cursor=page.next;
  }while(cursor);
  if(!provisioning.complete)await harness.commit(async tx=>{(await tx.doc(DelegationToolProvisioning,getLibrary())).complete=true;},ctx);
 }
 async function refreshSession(tx:Tx,id:ConversationId,config:DelegationConfig,_observedExtensions?:readonly Extension[]){
  await requireDelegationSettled(tx,id);
  (await tx.doc(DelegationSession,id)).config=config;
  await selectSnapshot(tx,id,config);
  await snapshotDelegationTools(state,tx,id,true);
 }
 return {models,extension,created,restore,installSnapshot,refreshSession,
  async selectedExtensions(harness:Harness,chat:Conversation,extensions:Extension[]){
   const child=await harness.snapshot(DelegationChild,chat.id,ctx);
   if(child?.observation){if(extensions.some(e=>e.name===SubagentTools.name))throw Error('Subagents cannot enable recursive delegation');if(child.profile)await harness.commit(tx=>enforceDelegationTools(tx,chat.id,child.profile!,extensions),ctx);return [...extensions,childExtension];}
   const saved=await harness.snapshot(DelegationSession,chat.id,ctx);if(!saved?.config)throw Error(refresh);
   return [...extensions,installSnapshot(saved.config)];
  },
 };
}
export type Delegation=ReturnType<typeof createDelegation>;
