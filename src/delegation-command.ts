import {handleDelegationBehaviorCommand,recoverDelegationBehaviorCommands} from './delegation-behavior-command.js';
import {describeDelegationBehavior,readDelegationBehavior} from './delegation-behavior.js';
import {randomUUID} from 'node:crypto';
import {QuestionChoices} from '@bob-local/resources';
import {Questions} from './documents.js';
import {defineDoc,type Conversation,type ConversationId,type Cursor,type Harness,type SubmissionRecord,type Tx} from '@earendil-works/pi-durable';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';
import type {State} from './state.js';
import {DelegationSession,requireDelegationSettled,type Delegation} from './delegation.js';
import {delegationVersion,describeDelegation,readDelegationConfig,saveDelegationMode,validateRoute,type DelegationMode,type DelegationConfig} from './delegation-config.js';

/** Advertised by the authenticated library response; not persisted as a skill. */
export const delegationMenuCommand={name:'delegation',description:'Choose subagent routes and opt-in adaptive delegation.'} as const;

type Intent={text:string;clientRequestId:string;mode:DelegationMode;now:boolean;expected:{revision:number;fingerprint:string}};
type Picker={id:string;phase:'mode'|'when';modes:DelegationMode[];mode?:DelegationMode};
export const DelegationCommands=defineDoc<{pending:Record<string,Intent>;picker?:Picker}>({kind:'bob.delegation-commands',version:1,scope:'conversation',history:'latest',fork:'initial',checkpointWhen:()=>true,initial:()=>({pending:{}})});
const aliases:Record<string,DelegationMode>={default:'default','1':'default',off:'default',builtin:'default',model_map:'model_map',models:'model_map',model:'model_map',model_routes:'model_map',routes:'model_map','2':'model_map',profile_routes:'profile_routes',profiles:'profile_routes',profile:'profile_routes','3':'profile_routes'};
export function parseDelegationCommand(text:string){
 if(!/^\/delegation(?:\s|$)/i.test(text.trim()))return undefined;
 const words=text.trim().split(/\s+/).slice(1),now=words.includes('--now'),other=words.filter(w=>w!=='--now');
 if(words.some(w=>w.startsWith('-')&&w!=='--now')||other.length>1||words.filter(w=>w==='--now').length>1)throw Error('Usage: /delegation [show | default | model_map | profile_routes] [--now]');
 const key=other[0]?.toLowerCase();
 if(key==='show'&&now)throw Error('Use /delegation <mode> --now to refresh this chat');
 if(key&&key!=='show'&&!Object.hasOwn(aliases,key))throw Error('Unknown delegation mode. Use default, model_map, or profile_routes');
 return {mode:key&&Object.hasOwn(aliases,key)?aliases[key]:undefined,now,show:key==='show'||(!key&&!now),bare:!key&&!now};
}
async function appendReceipt(tx:Tx,chat:ConversationId,requestId:string,text:string,clientRequestId:string,reply:string):Promise<SubmissionRecord>{
 const timestamp=Date.now();
 const user=await tx.appendEntry(chat,{kind:'bob.user',data:{text,requestId:clientRequestId,allowSubagents:false,command:'delegation'},model:[{role:'user',content:text,timestamp}]});
 const answer=await tx.appendEntry(chat,{kind:'pi.assistant',data:{source:'owner-command',command:'delegation'},model:[{role:'assistant',content:[{type:'text',text:reply}],api:'bob-command',provider:'bob',model:'delegation-command',stopReason:'stop',timestamp,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}}]});
 return tx.createSubmission({conversationId:chat,requestId,type:'input',status:'done',entry:user.id,answer:answer.id});
}
async function validateMode(config:DelegationConfig,delegation:Delegation,state:State){
 const routes=config.mode==='default'?(config.defaultRoute?[config.defaultRoute]:[]):config.mode==='model_map'?config.modelMap.options:config.profileRoutes.profiles.map(p=>{const profile=config.profiles.find(x=>x.name===p.name);if(!profile)throw Error('An allowlisted profile is missing');return profile.route;});
 if(config.mode!=='default'&&!routes.length)throw Error('This mode has nothing configured; use bob delegation config');
 for(const route of routes)await validateRoute(route,delegation.models,state);
}
/** Reconciles one native intent. Control effects use their own atomic revision/CAS receipt;
 * native snapshot + final chat receipt use one DIFFERENT transaction. Never claim cross-store atomicity.
 * A retry of an old intent returns its saved effect, never overwrites newer settings, and refuses
 * to install its now-superseded snapshot. Crashes between either store's commits are recoverable. */
async function finishIntent(state:State,harness:Harness,delegation:Delegation,chat:Conversation,requestId:string,intent:Intent){
 const existing=await harness.commit(tx=>tx.submissionByRequest(chat.id,requestId),ctx);if(existing)return existing;
 let effect:ReturnType<typeof saveDelegationMode>|undefined,problem:string|undefined;
 try{effect=saveDelegationMode(state,intent.mode,`${chat.id}:${requestId}`,intent.expected);}catch{problem='Delegation settings could not be saved. Configuration is unavailable; use bob delegation config --show.';}
 const agent=await chat.agent(ctx);
 return chat.commit(async tx=>{
  const previous=await tx.submissionByRequest(chat.id,requestId);if(previous)return previous;
  let reply=problem??`Delegation mode: ${intent.mode}, saved for new chats. This chat keeps its existing tool snapshot; use /delegation ${intent.mode} --now to refresh it (may break the prompt cache).`;
  if(effect?.superseded)reply='This delegation command was superseded by newer settings; no old choices were reapplied. Use /delegation show, then issue a new command if needed.';
  else if(effect&&intent.now){
   const current=delegationVersion(state);
   if(current.revision!==effect.revision)reply='The requested mode was saved, but newer settings superseded it before this chat could refresh. No old snapshot was applied; use /delegation show and a new --now command.';
   else{
    let settled=true;try{await requireDelegationSettled(tx,chat.id);}catch{settled=false;}
    if(settled){await delegation.refreshSession(tx,chat.id,effect.config,agent.extensions);reply=`Delegation mode: ${intent.mode}, saved and applied to this settled chat. Its tool snapshot is refreshed (may break the prompt cache). No inference was used.`;}
    else reply='The mode was saved for new chats, but this chat became busy before its tool snapshot could refresh. Stop and settle its background work, then issue a new /delegation <mode> --now command.';
   }
  }
  const result=await appendReceipt(tx,chat.id,requestId,intent.text,intent.clientRequestId,reply);
  delete (await tx.doc(DelegationCommands,chat.id)).pending[requestId];return result;
 },ctx);
}
const modeLabels:Record<DelegationMode,string>={default:'Default',model_map:'Model routes',profile_routes:'Profile routes'};
async function clearPicker(tx:Tx,id:ConversationId,questionId?:string){
 const commands=await tx.doc(DelegationCommands,id),questions=await tx.doc(Questions,id);
 if(commands.picker&&(!questionId||commands.picker.id===questionId)){
  if(questions.pending?.id===commands.picker.id)delete questions.pending;
  delete commands.picker;
 }
}
async function putPicker(tx:Tx,id:ConversationId,phase:'mode'|'when',modes:DelegationMode[],mode?:DelegationMode){
 const questionId=randomUUID(),question=phase==='mode'?'Choose a delegation mode. No settings change until you choose when.':`Use ${modeLabels[mode!]} from when? Now refreshes this chat’s tools and may break its prompt cache.`;
 (await tx.doc(DelegationCommands,id)).picker={id:questionId,phase,modes,...(mode?{mode}:{})};
 (await tx.doc(Questions,id)).pending={id:questionId,text:question};
 const choices=await tx.doc(QuestionChoices,id);choices.questionId=questionId;choices.options=phase==='mode'?[...modes.map(m=>modeLabels[m]),'Cancel']:['Next session (recommended)','Now (refresh tools)','Cancel'];choices.multiple=false;
}
export async function handleDelegationCommand(state:State,harness:Harness,delegation:Delegation,chat:Conversation,text:string,requestId:string,clientRequestId:string,questionId?:string):Promise<SubmissionRecord|undefined>{
 const behavior=await handleDelegationBehaviorCommand(state,harness,chat,text,requestId,clientRequestId,appendReceipt);if(behavior)return behavior;
 const command=/^\/delegation(?:\s|$)/i.test(text.trim());
 const picker=questionId?(await harness.snapshot(DelegationCommands,chat.id,ctx))?.picker:undefined;
 const answer=!!picker&&picker.id===questionId&&(await harness.snapshot(Questions,chat.id,ctx))?.pending?.id===questionId;
 if(!command&&!answer)return undefined;
 let parsed:ReturnType<typeof parseDelegationCommand>,problem:string|undefined;
 if(command)try{parsed=parseDelegationCommand(text);}catch(error){problem=(error as Error).message;}
 const existing=await harness.commit(tx=>tx.submissionByRequest(chat.id,requestId),ctx);if(existing)return existing;
 if(answer&&!command){
  const word=text.trim().toLowerCase(),selected=picker!.modes.find(mode=>word===modeLabels[mode].toLowerCase()||aliases[word]===mode);
  if(picker!.phase==='when'&&word!=='cancel'&&['next session (recommended)','next','now (refresh tools)','now'].includes(word))parsed={mode:picker!.mode,now:word.startsWith('now'),show:false,bare:false};
  else return chat.commit(async tx=>{
   const previous=await tx.submissionByRequest(chat.id,requestId);if(previous)return previous;
   const current=(await tx.doc(DelegationCommands,chat.id)).picker,questions=await tx.doc(Questions,chat.id);
   if(current?.id!==questionId||questions.pending?.id!==questionId)return appendReceipt(tx,chat.id,requestId,text,clientRequestId,'This delegation question is no longer active. Send /delegation to choose again.');
   let reply='Choose one of the displayed options; no settings changed.';
   if(word==='cancel'){await clearPicker(tx,chat.id,questionId);reply='Delegation mode unchanged.';}
   else if(picker!.phase==='mode'&&selected){await putPicker(tx,chat.id,'when',picker!.modes,selected);reply=`Selected ${modeLabels[selected]}. Choose when to apply it; no settings have changed yet.`;}
   else await putPicker(tx,chat.id,picker!.phase,picker!.modes,picker!.mode);
   return appendReceipt(tx,chat.id,requestId,text,clientRequestId,reply);
  },ctx);
 }
 const pending=(await harness.snapshot(DelegationCommands,chat.id,ctx))?.pending[requestId];
 if(pending)return finishIntent(state,harness,delegation,chat,requestId,pending);
 const config=readDelegationConfig(state),mode=parsed?.mode??config.mode;
 if(!problem&&!parsed?.show){try{await validateMode({...config,mode},delegation,state);}catch(error){problem=(error as Error).message;}}
 if(problem||parsed?.show){
  const session=await harness.snapshot(DelegationSession,chat.id,ctx);
  const reply=problem??`${describeDelegation(config)}\n${describeDelegationBehavior(readDelegationBehavior(state))}\nCurrent chat snapshot: ${session?.config?.mode??'legacy default'}. No inference was used.\nSend one of the commands above to choose a mode.`;
  return chat.commit(async tx=>{
   const found=await tx.submissionByRequest(chat.id,requestId);if(found)return found;
   let response=reply;
   if(answer&&problem)await clearPicker(tx,chat.id,questionId);
   if(parsed?.bare&&!problem){
    const commands=await tx.doc(DelegationCommands,chat.id),questions=await tx.doc(Questions,chat.id);
    if(questions.pending&&questions.pending.id!==commands.picker?.id)response+='\nAn unrelated question is already active; it was left unchanged. Use an explicit /delegation <mode> command instead.';
    else{const modes:DelegationMode[]=['default',...(config.modelMap.options.length?['model_map' as const]:[]),...(config.profileRoutes.profiles.length?['profile_routes' as const]:[])];await putPicker(tx,chat.id,'mode',modes);response+='\nChoose an available mode in the question card, then choose Next session or Now.';}
   }
   return appendReceipt(tx,chat.id,requestId,text,clientRequestId,response);
  },ctx);
 }
 const intent:Intent={text,clientRequestId,mode,now:parsed!.now,expected:delegationVersion(state)};
 try{
  await chat.commit(async tx=>{
   const found=await tx.submissionByRequest(chat.id,requestId);if(found)return;
   if(intent.now)await requireDelegationSettled(tx,chat.id);
   if(answer){const current=(await tx.doc(DelegationCommands,chat.id)).picker;if(current?.id!==questionId||(await tx.doc(Questions,chat.id)).pending?.id!==questionId)throw Error('Delegation question was superseded');}
   await clearPicker(tx,chat.id,answer?questionId:undefined);
   const commands=await tx.doc(DelegationCommands,chat.id);if(!commands.pending[requestId])commands.pending[requestId]=intent;
  },ctx);
 }catch{
  return chat.commit(async tx=>{const found=await tx.submissionByRequest(chat.id,requestId);if(found)return found;await clearPicker(tx,chat.id,answer?questionId:undefined);return appendReceipt(tx,chat.id,requestId,text,clientRequestId,'No settings changed. The question was superseded or this chat is not settled. Use /delegation again, or stop and settle background work before --now.');},ctx);
 }
 // Re-read the winner if two identical device requests reached admission together.
 const admitted=(await harness.snapshot(DelegationCommands,chat.id,ctx))?.pending[requestId];
 if(!admitted)return harness.commit(async tx=>(await tx.submissionByRequest(chat.id,requestId))!,ctx);
 return finishIntent(state,harness,delegation,chat,requestId,admitted);
}
export async function recoverDelegationCommands(state:State,harness:Harness,delegation:Delegation){
 let cursor:Cursor|undefined;
 do{const page=await harness.commit(tx=>tx.scanConversations({},100,cursor),ctx);
  for(const record of page.items){await recoverDelegationBehaviorCommands(state,harness,record.id,appendReceipt);const pending=(await harness.snapshot(DelegationCommands,record.id,ctx))?.pending??{};for(const [id,intent] of Object.entries(pending)){const chat=(await harness.conversation(record.id,ctx))!;await finishIntent(state,harness,delegation,chat,id,intent);}}
  cursor=page.next;
 }while(cursor);
}
