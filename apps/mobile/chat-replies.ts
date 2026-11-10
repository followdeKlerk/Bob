import {Attachment} from '../../src/contracts';
import {isRecordedToolGeneration,hasVisibleChatContent} from './chat-presentation';
import {replyText} from './reply-text';
import type {ToolEntry,ToolMessage} from './tool-results';

export type ReplyEntry=ToolEntry&{byTaskId?:number;mobileReply?:unknown;displayKey?:string;liveResponse?:boolean;inlineSurfaceId?:string;inlineSurfaceSource?:number};
type Reply={version:1;first:number;answer:number};
const keyedRows=new WeakMap<ReplyEntry,ReplyEntry>();
const positive=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0;
export function replyAssociation(entry:ReplyEntry):Reply|undefined{
 const value=entry.mobileReply as Partial<Reply>|undefined;
 if(value?.version!==1||!positive(value.first)||!positive(value.answer)||value.first>value.answer||entry.id<value.first||entry.id>value.answer)return;
 return value as Reply;
}
function answerText(entry:ReplyEntry){
 return entry.kind==='pi.assistant'&&entry.model?.some(message=>message.role==='assistant'&&(
  typeof message.content==='string'?!!replyText(message.content):Array.isArray(message.content)&&!message.content.some(block=>block?.type==='toolCall')&&message.content.some(block=>block?.type==='text'&&!!replyText(block.text))));
}
/** Native input->answer metadata supplies the grouping boundary. Unknown legacy
 * outputs retain their source slot. Never infer attachment ownership from text,
 * filename, a nearby message, or whichever answer happens to be newest. */
export function replyOutputPlacement<T extends ReplyEntry>(entries:readonly T[],anchors:Map<string,number>){
 const byId=new Map(entries.map(entry=>[entry.id,entry])),files=new Map<number,T[]>(),hiddenFiles=new Set<number>();
 const answers=entries.flatMap(entry=>{const group=replyAssociation(entry);return group?.answer===entry.id&&answerText(entry)?[group]:[];});
 const target=(source:T|undefined)=>{
  if(!source)return undefined;
  const candidates=answers.filter(group=>source.id>=group.first&&source.id<=group.answer);
  if(candidates.length!==1)return undefined;
  const group=candidates[0],original=replyAssociation(source);
  if(source.mobileReply!==undefined&&(!original||original.first!==group.first||original.answer!==group.answer))return undefined;
  // A long run can push its file out of the current server window. Its native
  // final-answer range also certifies that already-cached source entry.
  return group.answer;
 };
 for(const entry of entries){
  if(entry.kind!=='bob.file'||!Attachment.safeParse(entry.data).success)continue;
  const answer=target(entry);if(answer===undefined)continue;
  files.set(answer,[...(files.get(answer)??[]),entry]);hiddenFiles.add(entry.id);
 }
 const surfaces=new Map<string,number>();
 for(const [id,source] of anchors)surfaces.set(id,target(byId.get(source))??source);
 return {files,hiddenFiles,surfaces};
}
/** A generation's native task ID survives the live->recorded handoff. Keep that
 * identity in the same list cell, rather than moving prose out of its header.
 * Aborted/error partials use ordinary entry keys, so retry attempts cannot collide. */
export function withLiveResponse<T extends ReplyEntry>(entries:readonly T[],raw:readonly ReplyEntry[],live:any):{entries:(T|ReplyEntry)[];legacyLive:boolean}{
 const valid=(entry:ReplyEntry)=>entry.kind==='pi.assistant'&&positive(entry.byTaskId)&&entry.model?.some(message=>message.role==='assistant'&&!['aborted','error'].includes((message as ToolMessage&{stopReason?:string}).stopReason??''));
 const newest=new Map<number,number>();for(const entry of entries)if(valid(entry))newest.set(entry.byTaskId!,entry.id);
 const result:ReplyEntry[]=entries.map(entry=>{
  if(!valid(entry)||newest.get(entry.byTaskId!)!==entry.id)return entry;
  const cached=keyedRows.get(entry);if(cached)return cached;
  const value={...entry,displayKey:`generation:${entry.byTaskId}`};keyedRows.set(entry,value);return value;
 });
 const message=live?.generation?.message,task=live?.run?.taskId;
 if(!message||!live?.run||isRecordedToolGeneration(raw as ToolEntry[],message.content))return {entries:result,legacyLive:false};
 if(!positive(task))return {entries:result,legacyLive:true};
 if(newest.has(task))return {entries:result,legacyLive:false};
 const entry:ReplyEntry={id:-task,byTaskId:task,kind:'bob.live-response',model:[{...message,role:'assistant'}],displayKey:`generation:${task}`,liveResponse:true};
 if(hasVisibleChatContent(entry))result.push(entry);
 return {entries:result,legacyLive:false};
}

/** Rich outputs keep their own FlatList keys when their display position changes.
 * Reparenting a WebView/player into the final-answer cell would destroy local
 * controls or interrupt owner-started playback at precisely that handoff. */
export function replyOutputRows<T extends ReplyEntry>(entries:readonly T[],files:Map<number,readonly ReplyEntry[]>,surfaces:readonly {id:string;source:number;at:number}[]=[],scope=''):ReplyEntry[]{
 const original=new Map(entries.map(entry=>[entry.id,entry])),moved=new Set<number>();
 const following=new Map<number,{source:number;order:number;entry:ReplyEntry}[]>();
 const add=(at:number,value:{source:number;order:number;entry:ReplyEntry})=>following.set(at,[...(following.get(at)??[]),value]);
 for(const [answer,attachments] of files){
  if(!original.has(answer))continue;
  for(const file of attachments){const entry=original.get(file.id);if(entry){moved.add(entry.id);add(answer,{source:entry.id,order:0,entry});}}
 }
 surfaces.forEach((surface,index)=>{if(original.has(surface.at))add(surface.at,{source:surface.source,order:index+1,entry:{id:-Number.MAX_SAFE_INTEGER+index,kind:'bob.inline-surface',inlineSurfaceId:surface.id,inlineSurfaceSource:surface.source,displayKey:`surface:${scope}:${surface.id}`}});});
 const result:ReplyEntry[]=[];
 for(const entry of entries){
  if(moved.has(entry.id))continue;
  const after=following.get(entry.id)??[];
  if(!(entry.kind==='bob.nested-surface'&&!entry.model?.length&&after.length))result.push(entry);
  result.push(...after.sort((a,b)=>a.source-b.source||a.order-b.order).map(value=>value.entry));
 }
 return result;
}
