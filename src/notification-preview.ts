import type {EntryRecord} from '@earendil-works/pi-durable';
/** A bounded preview of the exact settled answer, never a scan of chat history.
 * Tool arguments, tool results, images and hidden reasoning are not notification text.
 */
export function notificationReply(entry:EntryRecord|undefined,conversationId:number){
 if(!entry||entry.conversationId!==conversationId)return null;
 let text='';
 for(const message of entry.model??[]){
  if(message.role!=='assistant')continue;
  const content=message.content;
  const blocks=typeof content==='string'?[{type:'text',text:content}]:Array.isArray(content)?content:[];
  for(const block of blocks){
   if(block.type!=='text'||typeof block.text!=='string'||!block.text.trim())continue;
   const remaining=4000-text.length;if(remaining<=0)break;
   text+=(text?'\n':'')+block.text.slice(0,remaining-(text?1:0));
  }
  if(text.length>=4000)break;
 }
 return text.trim()?{id:entry.id,text:text.trim()}:null;
}

/** Safe display metadata only; native conversation history remains the source of truth. */
export function notificationConversationTitle(title:unknown,id:number){
 const text=typeof title==='string'?title.replace(/[\p{Cc}\p{Cf}]/gu,' ').replace(/\s+/g,' ').trim().slice(0,160):'';
 return text||`Conversation ${id}`;
}
