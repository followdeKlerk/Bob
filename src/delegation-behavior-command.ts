import {defineDoc,type Conversation,type ConversationId,type Harness,type SubmissionRecord,type Tx} from '@earendil-works/pi-durable';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';
import type {State} from './state.js';
import {behaviorRevision,describeDelegationBehavior,readDelegationBehavior,saveDelegationBehavior} from './delegation-behavior.js';
import {DelegationBudget,revokeDelegation} from './delegation-budget.js';
type Append=(tx:Tx,id:ConversationId,request:string,text:string,client:string,reply:string)=>Promise<SubmissionRecord>;
type Intent={text:string;client:string;enabled:boolean;revision:number};
export const DelegationBehaviorCommands=defineDoc<{pending:Record<string,Intent>}>({kind:'bob.delegation-behavior-commands',version:1,scope:'conversation',history:'latest',fork:'initial',checkpointWhen:()=>true,initial:()=>({pending:{}})});
async function finish(state:State,harness:Harness,chat:Conversation,request:string,intent:Intent,append:Append){
 const existing=await harness.commit(tx=>tx.submissionByRequest(chat.id,request),ctx);if(existing)return existing;
 // Separate native intent/revocation and control-store CAS; never a cross-store transaction.
 let reply:string;try{const effect=saveDelegationBehavior(state,{enabled:intent.enabled},`${chat.id}:${request}`,intent.revision);reply=effect.superseded?'Superseded by newer delegation settings; no old setting was reapplied.':`Adaptive delegation ${intent.enabled?'enabled for subsequent authenticated owner tasks':'disabled'}. This chat’s previous task authority is revoked. Running helpers were not cancelled; use Stop tree to cancel native owned work.`;}catch{reply='Could not save adaptive delegation settings. This chat’s previous authority remains revoked; inspect bob delegation behavior --show.';}
 return chat.commit(async tx=>{const prior=await tx.submissionByRequest(chat.id,request);if(prior)return prior;const receipt=await append(tx,chat.id,request,intent.text,intent.client,reply);delete (await tx.doc(DelegationBehaviorCommands,chat.id)).pending[request];return receipt;},ctx);
}
export async function handleDelegationBehaviorCommand(state:State,harness:Harness,chat:Conversation,text:string,request:string,client:string,append:Append){
 if(!/^\/delegation\s+auto(?:\s|$)/i.test(text.trim()))return undefined;
 const existing=await harness.commit(tx=>tx.submissionByRequest(chat.id,request),ctx);if(existing)return existing;
 const pending=(await harness.snapshot(DelegationBehaviorCommands,chat.id,ctx))?.pending[request];if(pending)return finish(state,harness,chat,request,pending,append);
 const words=text.trim().toLowerCase().split(/\s+/),action=words[2]??'status';
 if(words.length>3||!['on','off','status','revoke'].includes(action))return chat.commit(async tx=>(await tx.submissionByRequest(chat.id,request))??append(tx,chat.id,request,text,client,'Usage: /delegation auto on | off | status | revoke'),ctx);
 if(action==='status'||action==='revoke')return chat.commit(async tx=>{
  const prior=await tx.submissionByRequest(chat.id,request);if(prior)return prior;
  if(action==='revoke')await revokeDelegation(tx,chat.id,'Owner revoked this task');
  const budget=await tx.doc(DelegationBudget,chat.id),config=readDelegationBehavior(state);
  const valid=config.enabled&&budget.owner?.adaptive&&budget.owner.allow&&!budget.revoked&&budget.owner.revision===behaviorRevision(state);
  const reply=action==='revoke'?'Current task’s delegation authority revoked. Running helpers were not cancelled; use Stop tree to cancel native owned work.':`${describeDelegationBehavior(config)}\nCurrent chat: ${valid?'authorized owner scope':'no current adaptive authority'}; ${Object.keys(budget.dispatches).length} dispatches recorded in scope ${budget.epoch}.\nThis exact status command preserves the current scope. Ordinary owner messages (including plain “Status”) replace it and invalidate earlier report chains. No inference was used.`;
  return append(tx,chat.id,request,text,client,reply);
 },ctx);
 const intent:Intent={text,client,enabled:action==='on',revision:behaviorRevision(state)};
 await chat.commit(async tx=>{if(await tx.submissionByRequest(chat.id,request))return;const commands=await tx.doc(DelegationBehaviorCommands,chat.id);if(!commands.pending[request]){await revokeDelegation(tx,chat.id,'Owner changed adaptive delegation');commands.pending[request]=intent;}},ctx);
 const winner=(await harness.snapshot(DelegationBehaviorCommands,chat.id,ctx))?.pending[request];return winner?finish(state,harness,chat,request,winner,append):harness.commit(tx=>tx.submissionByRequest(chat.id,request),ctx);
}
export async function recoverDelegationBehaviorCommands(state:State,harness:Harness,id:ConversationId,append:Append){const pending=(await harness.snapshot(DelegationBehaviorCommands,id,ctx))?.pending??{};for(const [request,intent] of Object.entries(pending))await finish(state,harness,(await harness.conversation(id,ctx))!,request,intent,append);}
