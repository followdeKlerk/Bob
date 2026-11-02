import {replyText} from './reply-text';
import type {ToolEntry} from './tool-results';

/** Only Bob's explicit owner-entry kind proves a phone-authored message.
 * Native pi.user inputs also carry agent/system deliveries; do not label them
 * as the owner, even in an old offline cache. Never infer provenance from text.
 */
export function inputAttribution(entry:ToolEntry):{owner:boolean;label?:string} {
 if(entry.kind==='bob.user')return {owner:true};
 if(entry.kind==='bob.subagent-report'){
  const name=(entry.data as {name?:unknown}|undefined)?.name;
  return {owner:false,label:typeof name==='string'&&name?`Agent report · ${name}`:'Agent report'};
 }
 return {owner:false,...(entry.kind==='pi.user'?{label:'Input · source not identified'}:{})};
}
export const isActiveSubagent=(status:string|undefined)=>status==='working'||status==='stopping';

/** Passive backend metadata only, never model/tool content. Ignore supplied text:
 * only known phases and nonnegative safe integer counts produce status labels.
 * Undefined deliberately leaves malformed/unknown entries on the normal path. */
export function memoryStatusText(entry:ToolEntry):string|undefined {
 if(entry.kind!=='bob.memory-status'||entry.model?.length)return undefined;
 const data=entry.data;
 if(!data||typeof data!=='object'||Array.isArray(data))return undefined;
 const {phase,count}=data as {phase?:unknown;count?:unknown};
 if(count!==undefined&&(typeof count!=='number'||!Number.isSafeInteger(count)||count<0))return undefined;
 if(phase==='recall'&&typeof count==='number')return `Hindsight — recalled ${count} memories`;
 if(phase==='save-queued')return 'Hindsight — save queued';
 if(phase==='save-processing')return 'Hindsight — saving';
 if(phase==='save-completed')return 'Hindsight — saved';
 if(phase==='save-failed')return 'Hindsight — save failed';
 if(phase==='save-cancelled')return 'Hindsight — save tracking stopped';
 if(phase==='save-warning')return 'Hindsight — saved with warnings';
 return undefined;
}

/** Passive receipts only. Treat supplied text as literal display data, never model
 * content or owner input. Legacy reviews need no origin; foreground skill updates
 * need no taskId. Unknown/malformed events stay on the generic disclosure path. */
export function learningStatusText(entry:ToolEntry):string|undefined {
 if(entry.kind!=='bob.learning-status'||entry.model?.length)return undefined;
 const data=entry.data;
 if(!data||typeof data!=='object'||Array.isArray(data))return undefined;
 const {status,text}=data as {status?:unknown;text?:unknown};
 if(status!=='completed'&&status!=='failed'&&status!=='cancelled')return undefined;
 if(typeof text!=='string'||!text.trim()||text.length>65536)return undefined;
 // Bound UTF-8 bytes without depending on a native TextEncoder/Buffer polyfill.
 let bytes=0;
 for(const character of text){
  const point=character.codePointAt(0)!;
  bytes+=point<=0x7f?1:point<=0x7ff?2:point<=0xffff?3:4;
  if(bytes>65536)return undefined;
 }
 return text;
}

/** Transcript projection only: never delete stored tools or their recorded output. */
export function hasVisibleChatContent(entry:ToolEntry):boolean {
 // Surface receipts are placement metadata; the surface itself owns the row.
 if((entry.kind==='bob.nested-surface'||entry.kind==='bob.schedule-state')&&!entry.model?.length)return false;
 if(!entry.model?.length)return !entry.kind.startsWith('pi.')||entry.kind==='pi.user'||entry.kind==='pi.assistant';
 return entry.model.some(message=>message.role!=='toolResult'&&(Array.isArray(message.content)
  ?message.content.some(block=>block&&block.type!=='toolCall'&&block.type!=='thinking'&&block.type!=='redactedThinking'&&(block.type!=='text'||!!replyText(block.text)))
  :!!replyText(message.content)));
}
/** Recorded calls own their inline slot from first appearance through completion.
 * Results already linked to a loaded call are removed by linkToolResults, not here. */
export function hasInlineChatContent(entry:ToolEntry):boolean {
 return hasVisibleChatContent(entry)||!!entry.model?.some(message=>message.role==='toolResult'||
  Array.isArray(message.content)&&message.content.some(block=>block?.type==='toolCall'));
}
/** Avoid briefly painting the same pre-tool reply in both the live header and
 * its recorded row. Match real call IDs, never text or tool names. */
export function isRecordedToolGeneration(entries:ToolEntry[],content:unknown):boolean {
 if(!Array.isArray(content))return false;
 const ids=content.filter(block=>block?.type==='toolCall'&&typeof block.id==='string'&&block.id).map(block=>block.id);
 if(!ids.length)return false;
 const recorded=new Set<string>();
 for(const entry of entries)for(const message of entry.model??[])if(message.role==='assistant'&&Array.isArray(message.content))for(const block of message.content)if(block?.type==='toolCall')recorded.add(block.id);
 return ids.every(id=>recorded.has(id));
}

/** Display-only: coalesce consecutive identical passive indicators, keeping the
 * newest event. Never move events across messages or discard stored history. */
export function compactMemoryStatuses<T extends ToolEntry>(entries:readonly T[]):T[]{
 const result:T[]=[];
 for(const entry of entries){
  const status=memoryStatusText(entry),last=result[result.length-1];
  if(status!==undefined&&last&&memoryStatusText(last)===status)result[result.length-1]=entry;
  else result.push(entry);
 }
 return result;
}
