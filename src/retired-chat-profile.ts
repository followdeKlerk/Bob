/** Inert compatibility fence: preserve removed local-chat history without granting Bob's normal capabilities. */
import {AgentDoc,CompactionTask,GenerationTask,ToolTask,configure,defineDoc,defineExtension,hook,type AgentState,type JsonObject,type ConversationId,type ConversationRecord,type Cursor,type Harness,type Registry,type TaskId,type Tx} from '@earendil-works/pi-durable';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';
import type {Models} from '@earendil-works/pi-ai/models';
import {MemoryPreferences} from '@bob-local/memory';
import {HttpError} from './errors.js';
import type {State} from './state.js';

export const RETIRED_LOCAL_PROFILE='restricted-local' as const;
const extensionName='bob.restricted-local';
const removedModel={provider:'bob-retired-local',modelId:'removed'};
export const retiredMessage='This local-model integration was removed. History is read-only. Start a new Bob conversation.';
export const isRetiredProvider=(provider:string)=>provider.startsWith('bob-rc-')||provider==='bob-restricted-unconfigured'||provider===removedModel.provider;
// Keep the exact original document identity and fork semantics. Historical route data
// is not interpreted or installed; the current copy is cleared during retirement.
export const RetiredChat=defineDoc<{profile?:typeof RETIRED_LOCAL_PROFILE;route?:JsonObject}>({kind:'bob.restricted-chat',version:1,scope:'conversation',history:'latest',fork:'current',initial:()=>({}),checkpointWhen:()=>true});
function retiredAgent(agent:Readonly<AgentState>|undefined){return !!agent&&(!!agent.model&&isRetiredProvider(agent.model.provider)||!!(Array.isArray(agent.extensions)?agent.extensions:agent.extensions?.add)?.includes(extensionName));}
export async function isRetired(h:Harness,id:ConversationId){
 const pending=[id],seen=new Set<ConversationId>();
 while(pending.length){const current=pending.pop()!;if(seen.has(current))continue;seen.add(current);if(seen.size>1000)throw Error('Conversation ancestry cannot be verified');
  if((await h.snapshot(RetiredChat,current,ctx))?.profile===RETIRED_LOCAL_PROFILE||retiredAgent(await h.snapshot(AgentDoc,current,ctx)))return true;
  const record=await h.commit(tx=>tx.conversation(current),ctx);if(record?.parent)pending.push(record.parent.conversationId);if(record?.owner)pending.push(record.owner.conversationId);
 }
 return false;
}
export async function retiredInTransaction(tx:Tx,id:ConversationId,ancestors:ConversationId[]=[]){
 // Creation hooks run after table writes: only native document reads are legal.
 // Restored ancestors are already stamped; current parent/owner evidence also
 // covers a direct fork whose as-of agent predates the legacy alias.
 for(const current of [id,...ancestors])if((await tx.doc(RetiredChat,current)).profile===RETIRED_LOCAL_PROFILE||retiredAgent(await tx.doc(AgentDoc,current)))return true;
 return false;
}
export async function requireActiveConversation(h:Harness,id:ConversationId){if(await isRetired(h,id))throw new HttpError(410,retiredMessage);}
export function retiredMetadata(saved:{profile?:string}){return saved.profile===RETIRED_LOCAL_PROFILE?{id:RETIRED_LOCAL_PROFILE,label:'Retired local chat',retired:true,readOnly:true,restricted:true,immutable:true,configured:false,tools:[],automaticMemory:false,automaticLearning:false,automaticCompaction:false}:undefined;}

/** Reject even old checkpoint model objects; never hand them to a provider or credential resolver. */
export function excludeRetiredModels(base:Models):Models{
 return new Proxy(base,{get(target,key){
  const value=Reflect.get(target,key);if(typeof value!=='function')return value;
  return (...args:unknown[])=>{
   const first=args[0],provider=typeof first==='string'?first:first&&typeof first==='object'&&'provider'in first?first.provider:key==='setProvider'&&first&&typeof first==='object'&&'id'in first?first.id:undefined;
   const secondProvider=['getModelsOfType','getModelOfType','getAvailableOfType'].includes(String(key))?args[1]:undefined;
   if(typeof provider==='string'&&isRetiredProvider(provider)||typeof secondProvider==='string'&&isRetiredProvider(secondProvider)){
    if(key==='getAuth'||key==='checkAuth')return Promise.resolve(undefined);
    if(key==='getProvider'||key==='getModel'||key==='getModelOfType')return undefined;
    if(key==='getModels'||key==='getAllModels'||key==='getModelsOfType')return [];
    if(key==='getAvailable'||key==='getAllAvailable'||key==='getAvailableOfType')return Promise.resolve([]);
    throw new HttpError(410,retiredMessage);
   }
   const filter=(result:unknown)=>Array.isArray(result)?result.filter(item=>!(item&&typeof item==='object'&&(typeof item.provider==='string'&&isRetiredProvider(item.provider)||typeof item.id==='string'&&isRetiredProvider(item.id)))):result;
   const result=value.apply(target,args);return result instanceof Promise?result.then(filter):filter(result);
  };
 }});
}

export function createRetiredChatFence(state:State,registry:Registry){
 // No route reader, model adapter, search/page reader, attachment tool or setup API remains.
 state.delete('restrictedLocalRoute:v1');
 const extension=defineExtension({name:extensionName,tools:[],hooks:[
  hook(ToolTask,{beforeTool:()=>({block:retiredMessage})}),
  hook(GenerationTask,{beforeRequest:()=>({messages:[]})}),
  hook(CompactionTask,{beforeCompact:()=>({decline:true})}),
 ]});
 registry.install(extension);
 async function apply(tx:Tx,id:ConversationId){
  const saved=await tx.doc(RetiredChat,id);saved.profile=RETIRED_LOCAL_PROFILE;delete saved.route;
  await configure(tx,id,{model:removedModel,extensions:[extension],tools:[],modelTools:[],instructions:null,cwd:null,thinkingLevel:'off',maxTurns:1});
  Object.assign(await tx.doc(MemoryPreferences,id),{autoRecall:false,autoRetain:false});
 }
 return {
  async created(tx:Tx,record:ConversationRecord){const ancestors=[record.parent?.conversationId,record.owner?.conversationId].filter((id):id is ConversationId=>id!==undefined);if(!await retiredInTransaction(tx,record.id,ancestors))return false;await apply(tx,record.id);return true;},
  async restore(h:Harness,forced:ConversationId[]=[]){
   for(const id of forced)if(await h.conversation(id,ctx))await h.commit(tx=>apply(tx,id),ctx);
   const retired:ConversationId[]=[];let cursor:Cursor|undefined;
   do{const page=await h.commit(tx=>tx.scanConversations({},100,cursor),ctx);for(const record of page.items){if(await isRetired(h,record.id)){await h.commit(tx=>apply(tx,record.id),ctx);retired.push(record.id);}}cursor=page.next;}while(cursor);
   return retired;
  },
  async abortPending(h:Harness,retired:ReadonlySet<ConversationId>){
   // Conversation.abort() implicitly resumes the entire scheduler. Use only the
   // public mark-only APIs until EVERY retired ownership tree is fenced/marked.
   const inspection=await h.inspect(ctx),tasks=new Set<TaskId>();let changed=true;
   while(changed){changed=false;for(const {record} of inspection.tasks)if(!tasks.has(record.id)&&(retired.has(record.conversationId)||record.owner!==undefined&&tasks.has(record.owner))){tasks.add(record.id);changed=true;}}
   for(const submission of inspection.submissions)if(retired.has(submission.conversationId))await h.abortSubmission(submission.id,ctx,submission.conversationId);
   for(const id of tasks)await h.abortTask(id,ctx);
   return [...tasks];
  },
 };
}
