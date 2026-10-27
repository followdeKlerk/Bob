import {replyText} from './reply-text';
import type {ToolEntry} from './tool-results';

/** Transcript projection only: never delete stored tools or their recorded output. */
export function hasVisibleChatContent(entry:ToolEntry):boolean {
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
