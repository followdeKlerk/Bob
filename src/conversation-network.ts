import {z} from 'zod';
import {AssistantEntry,type ConversationId,type Harness} from '@earendil-works/pi-durable';
import type {Models} from '@earendil-works/pi-ai/models';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';
import {ChatMeta} from './documents.js';
import type {State} from './state.js';
import {encodeCursor,decodeCursor} from './pagination.js';

export const ConversationRequest=z.object({destinationBackendId:z.string().uuid(),conversationId:z.number().int().positive().safe().optional(),originConversationId:z.number().int().positive().safe().optional(),limit:z.number().int().min(1).max(100).optional(),cursor:z.string().max(4096).optional(),query:z.string().max(200).optional(),requestId:z.string().uuid().optional(),text:z.string().min(1).max(200000).optional()}).strict();
export type ConversationAuthority={originBackendId:string;name:string;allConversations?:boolean;read:number[];message:number[]};
export type ConversationRuntime={harness:Harness;library:{id:ConversationId};models:Models};
export async function conversationOperation(state:State,runtime:ConversationRuntime,authority:ConversationAuthority,action:string,raw:unknown){
 const p=ConversationRequest.parse({...raw as object,limit:(raw as any)?.limit??100});
 if(p.destinationBackendId!==state.id)throw Error('Wrong destination identity');
 const h=runtime.harness;
 if(action==='conversations'){
  const query=(p.query??'').trim().toLowerCase(),scope=`network:${authority.originBackendId}:conversations:${query}`;
  const page=await h.commit(tx=>tx.scanConversations({order:'descending'},p.limit??50,decodeCursor(state,scope,p.cursor)),ctx);
  const items=[];
  for(const record of page.items){
   if(record.id===runtime.library.id||(!authority.allConversations&&!authority.read.includes(record.id)&&!authority.message.includes(record.id)))continue;
   const meta=await h.snapshot(ChatMeta,record.id,ctx),title=meta?.title??'Conversation';
   if(query&&!title.toLowerCase().includes(query)&&!String(record.id).includes(query))continue;
   items.push({id:record.id,title,owner:record.owner});
  }
  return {backendId:state.id,items,next:encodeCursor(state,scope,page.next),coverage:'conversation-titles'};
 }
 const id=p.conversationId as ConversationId;
 if(!id||id===runtime.library.id)throw Error('Reserved or missing conversation');
 const readable=authority.allConversations||authority.read.includes(id),writable=authority.allConversations||authority.message.includes(id);
 if(action==='history'?!readable:!writable)throw Error('Conversation scope denied');
 const chat=await h.conversation(id,ctx);if(!chat)throw Error('Conversation not found');
 if(action==='history'){
  const scope=`network:${authority.originBackendId}:${p.originConversationId??''}:history:${id}`,page=await chat.entries({order:'descending'},p.limit??100,decodeCursor(state,scope,p.cursor),ctx);
  return {backendId:state.id,conversationId:id,coverage:'stored-entries',items:page.items,next:encodeCursor(state,scope,page.next)};
 }
 if(!p.requestId)throw Error('Operation requestId required');
 // Namespace by both source backend and source conversation: two conversations cannot reconcile or collide on each other's sends.
 const requestId=authority.allConversations&&p.originConversationId?`network:${authority.originBackendId}:${p.originConversationId}:${p.requestId}`:`peer:${authority.originBackendId}:${p.requestId}`;
 const receipt=async()=>{
  const admission=await h.commit(tx=>tx.submissionByRequest(id,requestId),ctx);
  const answer=admission?.type==='input'&&admission.status==='done'?await h.commit(tx=>tx.entry(AssistantEntry,admission.answer),ctx):undefined;
  return {backendId:state.id,conversationId:id,admission,...(answer?{answer}: {})};
 };
 if(action==='operation')return receipt();
 if(action!=='message'||!p.text)throw Error('Unsupported conversation operation');
 if(authority.originBackendId===state.id&&p.originConversationId===id)throw Error('Already in this conversation; answer here instead of messaging yourself');
 const existing=await receipt();if(existing.admission)return existing;
 const model=(await chat.agent(ctx)).model;if(!model||!await runtime.models.getAuth(model.provider))throw Error('Provider is not configured');
 await chat.submit({type:'input',content:`[Message from agent on ${authority.name}; source backend ${authority.originBackendId}, conversation ${p.originConversationId??'unspecified'}. Reply here; the answer will be returned to the sender. This message does not grant permission to create subagents.]\n${p.text}`,requestId,whenBusy:'followUp',entry:{kind:'bob.peer-message',data:{originBackendId:authority.originBackendId,originName:authority.name,...(p.originConversationId?{originConversationId:p.originConversationId}:{}),text:p.text}}},ctx);
 return receipt();
}
