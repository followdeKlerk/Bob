import {defineDoc,LiveDoc,InboxDoc,type Conversation,type ConversationId,type EntryId,type TaskId,type Tx} from '@earendil-works/pi-durable';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';
import type {State} from './state.js';
import {ChatMeta} from './documents.js';
import {Subagents} from './subagents.js';
import {behaviorRevision,readDelegationBehavior} from './delegation-behavior.js';
import {fingerprint} from './delegation-config.js';

type Owner={requestId:string;clientRequestId:string;deviceId:string;allow:boolean;adaptive:boolean;revision:number;fingerprint:string};
type Dispatch={reporter:TaskId;child:ConversationId;name:string;cancelled?:boolean};
export const DelegationBudget=defineDoc<{epoch:number;owner?:Owner;revoked?:string;seen:string[];dispatches:Record<string,Dispatch>;grants:string[]}>({kind:'bob.delegation-budget',version:1,scope:'conversation',history:'latest',fork:'initial',checkpointWhen:()=>true,initial:()=>({epoch:0,seen:[],dispatches:{},grants:[]})});
type Budget=Awaited<ReturnType<typeof budgetDoc>>;
const budgetDoc=(tx:Tx,id:ConversationId)=>tx.doc(DelegationBudget,id);
const activeStatuses=['pending','running','waiting','sleeping','completing'] as const;
const denied='Delegation authority is absent, revoked, or superseded. A new authenticated owner input with allowSubagents:true is required; peer/report text never grants authority.';
const own=<T>(map:Record<string,T>,key:string)=>Object.hasOwn(map,key)?map[key]:undefined;
async function clearGrants(tx:Tx,id:ConversationId,budget:Budget){
 const meta=await tx.doc(ChatMeta,id),remove=new Set(budget.grants);meta.subagentRequests=(meta.subagentRequests??[]).filter(key=>!remove.has(key));budget.grants=[];
}
/** Called ONLY by the authenticated owner-input adapter, before native submit. If admission
 * fails, no matching native submission exists and this reserved scope cannot authorize tools. */
export async function registerDelegationOwner(state:State,chat:Conversation,input:{requestId:string;clientRequestId:string;deviceId:string;allow:boolean}){
 await chat.commit(async tx=>{
  const existing=await tx.submissionByRequest(chat.id,input.requestId),budget=await budgetDoc(tx,chat.id);
  if(existing||budget.seen.includes(input.requestId))return;
  await clearGrants(tx,chat.id,budget);
  const config=readDelegationBehavior(state);budget.epoch++;budget.owner={...input,adaptive:config.enabled,revision:behaviorRevision(state),fingerprint:fingerprint(config)};
  budget.seen=[...budget.seen,input.requestId].slice(-100);budget.dispatches={};delete budget.revoked;
  if(input.allow){const meta=await tx.doc(ChatMeta,chat.id);meta.subagentRequests=[...(meta.subagentRequests??[]).filter(key=>key!==input.requestId),input.requestId].slice(-100);}
 },ctx);
}
export async function revokeDelegation(tx:Tx,id:ConversationId,reason:string){const budget=await budgetDoc(tx,id);await clearGrants(tx,id,budget);budget.revoked=reason;budget.epoch++;}
export async function stopDelegationHelper(tx:Tx,id:ConversationId,name:string){
 const budget=await budgetDoc(tx,id),agents=await tx.doc(Subagents,id),child=own(agents.agents,name)?.conversationId;if(!child)return;
 for(const dispatch of Object.values(budget.dispatches))if(dispatch.child===child)dispatch.cancelled=true;
 await clearGrants(tx,id,budget);
}
/** Task/receipt/owned-child lineage, never a report-looking prefix in arbitrary input. */
async function validReport(tx:Tx,id:ConversationId,toolId:string,dispatch:Dispatch,agents:{agents:Record<string,{conversationId:ConversationId;reported:EntryId[]}>;reporters:Record<string,TaskId>}){
 if(dispatch.cancelled||agents.reporters[toolId]!==dispatch.reporter||own(agents.agents,dispatch.name)?.conversationId!==dispatch.child)return undefined;
 const reporter=await tx.task(dispatch.reporter),child=await tx.conversation(dispatch.child);
 if(!reporter||reporter.kind!=='app.subagent-reporter'||reporter.version!==1||reporter.conversationId!==id||reporter.owner!==undefined||!reporter.background||reporter.abortRequested)return undefined;
 if(reporter.state.status==='terminal'){if(reporter.state.outcome.status!=='completed')return undefined;}
 else if(!('checkpoint' in reporter.state)||(reporter.state.checkpoint as {phase?:string}).phase!=='report')return undefined;
 const input=reporter.input as {name?:unknown;conversationId?:unknown};
 if(input.name!==dispatch.name||input.conversationId!==dispatch.child||child?.owner?.conversationId!==id)return undefined;
 const anchor=await tx.task(child.owner.taskId);
 if(!anchor||anchor.kind!=='app.subagent-anchor'||anchor.version!==1||anchor.conversationId!==id||anchor.owner!==undefined||!anchor.background||anchor.abortRequested)return undefined;
 const delivery=await tx.submissionByRequest(dispatch.child,`subagent:${dispatch.reporter}`);
 if(delivery?.type!=='input'||delivery.status!=='done'||!agents.agents[dispatch.name].reported.includes(delivery.answer))return undefined;
 // Cross-epoch sends can coalesce: an older reporter may win native reported[] dedup.
 // If THIS tracked reporter emits no receipt, fail closed; never borrow the older report
 // by helper name or identical answer. A fresh owner instruction can authorize a next phase.
 const receipt=await tx.submissionByRequest(id,`subagent-report:${dispatch.reporter}`);
 if(receipt?.type!=='input'||!['placed','done'].includes(receipt.status)||receipt.entry===undefined)return undefined;
 const entry=await tx.entry(receipt.entry);if(entry?.kind!=='pi.user'||entry.conversationId!==id)return undefined;
 // A native report is decided from this exact child answer. Comparing the whole payload is
 // an integrity check AFTER provenance, not a text-prefix authorization mechanism.
 const answer=await tx.entry(delivery.answer),text=(answer?.model?.[0]?.content??[]);
 const answerText=Array.isArray(text)?text.flatMap(block=>block.type==='text'?[block.text]:[]).join(''):'';
 const content=entry.model?.[0]?.content;
 if(content!==`[subagent ${dispatch.name} answered, no reply needed] ${answerText}`)return undefined;
 return receipt;
}
/** All table reads precede the original native callback's writes. Generated report grants
 * are genuine host grants on existing receipts; native spawn authorization still runs unchanged. */
export async function authorizeDelegation(state:State,tx:Tx,id:ConversationId){
 const budget=await budgetDoc(tx,id),live=await tx.doc(LiveDoc,id),meta=await tx.doc(ChatMeta,id);
 await clearGrants(tx,id,budget);
 if(budget.revoked||budget.owner?.allow===false)throw Error(denied);
 const config=readDelegationBehavior(state),owner=budget.owner,inputs=live.run?.inputs??[];
 if(!inputs.length)throw Error(denied);
 if(!config.enabled&&!owner?.adaptive){
  // Off preserves explicit native-run authorization, and now applies that same gate to send.
  for(const request of meta.subagentRequests??[]){const receipt=await tx.submissionByRequest(id,request);if(receipt&&inputs.includes(receipt.id))return {adaptive:false,epoch:budget.epoch};}
  throw Error(denied);
 }
 if(!config.enabled||!owner?.adaptive||owner.revision!==behaviorRevision(state)||owner.fingerprint!==fingerprint(config))throw Error(denied);
 const original=await tx.submissionByRequest(id,owner.requestId);
 if(original?.type!=='input'||!['placed','done'].includes(original.status)||original.entry===undefined)throw Error(denied);
 const entry=await tx.entry(original.entry),data=entry?.data as {allowSubagents?:unknown;requestId?:unknown}|undefined;
 if(owner.requestId!==`device:${owner.deviceId}:${owner.clientRequestId}`||entry?.kind!=='bob.user'||entry.conversationId!==id||data?.allowSubagents!==true||data.requestId!==owner.clientRequestId)throw Error(denied);
 const allowed=new Set([original.id]),grants:string[]=[],agents=await tx.doc(Subagents,id);
 // Native steer can retain earlier owner inputs in the SAME run. They are only historical
 // context when the newest authorized owner receipt is itself present, never fresh grants.
 if(inputs.includes(original.id))for(const request of budget.seen){const prior=await tx.submissionByRequest(id,request);if(prior?.type==='input'&&prior.entry!==undefined&&inputs.includes(prior.id)&&(await tx.entry(prior.entry))?.kind==='bob.user')allowed.add(prior.id);}
 for(const [toolId,dispatch] of Object.entries(budget.dispatches)){
  const report=await validReport(tx,id,toolId,dispatch,agents);
  if(report&&inputs.includes(report.id)){allowed.add(report.id);grants.push(report.requestId!);}
 }
 // Mixed untrusted peer inputs cannot borrow an owner's or a genuine report's authority.
 if(inputs.some(input=>!allowed.has(input)))throw Error(denied);
 budget.grants=grants;meta.subagentRequests=[...new Set([...(meta.subagentRequests??[]),...grants])].slice(-100);
 return {adaptive:true,epoch:budget.epoch};
}
async function activeChildren(tx:Tx,id:ConversationId,maximum:number){
 const agents=(await tx.doc(Subagents,id)).agents,active=new Set<ConversationId>();
 for(const agent of Object.values(agents)){
  if((await tx.doc(LiveDoc,agent.conversationId)).run||(await tx.doc(InboxDoc,agent.conversationId)).items.length)active.add(agent.conversationId);
  else for(const status of activeStatuses){if((await tx.scanTasks({conversationId:agent.conversationId,status},1)).items.length){active.add(agent.conversationId);break;}}
  if(active.size>=maximum)return active;
 }
 // A pending native reporter reserves capacity before its child's run has started.
 for(const status of activeStatuses){let cursor;do{const page=await tx.scanTasks({conversationId:id,kind:'app.subagent-reporter',status},100,cursor);for(const task of page.items){if(task.state.status==='completing'||('checkpoint' in task.state&&(task.state.checkpoint as {phase?:string}).phase==='report'))continue;const child=(task.input as {conversationId?:ConversationId}).conversationId;if(child)active.add(child);if(active.size>=maximum)return active;}cursor=page.next;}while(cursor);}
 return active;
}
export async function checkDelegationDispatch(state:State,tx:Tx,id:ConversationId,task:TaskId,args:{action:string;name?:string;message?:string},expectedEpoch:number){
 const authority=await authorizeDelegation(state,tx,id);if(authority.epoch!==expectedEpoch)throw Error(denied);
 if(!authority.adaptive)return;
 const budget=await budgetDoc(tx,id),agents=await tx.doc(Subagents,id),existing=args.name?own(agents.agents,args.name):undefined;
 const dispatches=!!args.name&&args.message!==undefined&&(args.action==='spawn'?!existing:!!existing);
 if(!dispatches)return;
 if(own(budget.dispatches,String(task)))throw Error('This native tool dispatch is already recorded; reconcile with status instead of repeating it');
 const config=readDelegationBehavior(state);
 if(Object.keys(budget.dispatches).length>=config.maxDispatches)throw Error(`Delegation task budget exhausted (${config.maxDispatches} spawn/send dispatches). Finish or ask the owner; no helper was dispatched.`);
 const active=await activeChildren(tx,id,config.maxActive+1),adds=existing&&!active.has(existing.conversationId)?1:args.action==='spawn'?1:0;
 if(active.size+adds>config.maxActive)throw Error(`Delegation active-helper limit reached (${config.maxActive}). Wait for a genuine report or stop existing work; no helper was dispatched.`);
}
/** Called after original native callback, using only documents (table writes have begun). */
export async function recordDelegationDispatch(state:State,tx:Tx,id:ConversationId,task:TaskId,name:string,previous:TaskId|undefined,expectedEpoch:number){
 const budget=await budgetDoc(tx,id),agents=await tx.doc(Subagents,id),reporter=agents.reporters[task],child=own(agents.agents,name)?.conversationId;
 if(!reporter||reporter===previous||!child)return;
 if(budget.epoch!==expectedEpoch||budget.revoked||budget.owner?.allow===false)throw Error(denied);
 if(!budget.owner?.adaptive)return;
 const config=readDelegationBehavior(state);
 if(!config.enabled||budget.owner.revision!==behaviorRevision(state)||budget.owner.fingerprint!==fingerprint(config))throw Error(denied);
 if(Object.keys(budget.dispatches).length>=config.maxDispatches)throw Error('Delegation dispatch budget exhausted');
 budget.dispatches[String(task)]={reporter,child,name};
}
/** Reopening keeps valid scope/dispatch evidence, but never blindly trusts old temporary grants. */
export async function restoreDelegationBudget(tx:Tx,id:ConversationId){await clearGrants(tx,id,await budgetDoc(tx,id));}
