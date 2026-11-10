import {Attachment} from '../../src/contracts';
import {attachmentType} from './components/attachment-type';
import type {ReplyEntry} from './chat-replies';

export type ImageArtifact=ReturnType<typeof Attachment.parse>;
export type ImageAttachmentRow=ReplyEntry&{imageAttachments?:readonly ImageArtifact[]};
const cached=new WeakMap<ReplyEntry,{members:readonly ReplyEntry[];row:ImageAttachmentRow}>();
function image(entry:ReplyEntry):ImageArtifact|undefined{
 if(entry.kind!=='bob.artifact'&&entry.kind!=='bob.file')return;
 const parsed=Attachment.safeParse(entry.data);
 return parsed.success&&attachmentType(parsed.data.name,parsed.data.mime).kind==='image'?parsed.data:undefined;
}
/** Display-only decks. Owner uploads must be consecutive in ORIGINAL history;
 * a hidden tool/result or message remains a boundary. Generated images additionally
 * require the existing certified final-answer association. Never group unknown
 * generated files merely because presentation moved them next to each other.
 * Non-image outputs keep their own native list cells and order. */
export function imageAttachmentRows(entries:readonly ReplyEntry[],raw:readonly ReplyEntry[],replyFiles:Map<number,readonly ReplyEntry[]>,windows:readonly (readonly ReplyEntry[])[],previousRows:readonly ImageAttachmentRow[]=[]):ImageAttachmentRow[]{
 // Only original contiguous windows prove adjacency. A sorted page/snapshot
 // union can hide an unloaded middle; numeric ID gaps alone prove nothing.
 const adjacent=new Set(windows.flatMap(window=>window.slice(1).map((entry,i)=>`${window[i].id}:${entry.id}`)));
 const segments=new Map<number,number>();let segment=0;
 raw.forEach((entry,i)=>{if(i&&!adjacent.has(`${raw[i-1].id}:${entry.id}`))segment++;segments.set(entry.id,segment);});
 const previousAnchors=new Set(previousRows.filter(row=>row.imageAttachments?.length).map(row=>row.id));
 const ownerRuns=new Map<number,number>();let previous:{first:number;conversation:number;last:number}|undefined;
 for(const entry of raw){
  const artifact=entry.kind==='bob.artifact'?image(entry):undefined;
  if(!artifact){previous=undefined;continue;}
  const first=previous?.conversation===artifact.conversationId&&adjacent.has(`${previous.last}:${entry.id}`)?previous.first:entry.id;
  ownerRuns.set(entry.id,first);previous={first,conversation:artifact.conversationId,last:entry.id};
 }
 const answers=new Map<number,number|null>();
 for(const [answer,files] of replyFiles)for(const file of files)answers.set(file.id,answers.has(file.id)?null:answer);
 const groups:{members:ReplyEntry[];artifacts?:ImageArtifact[];key?:string}[]=[];
 for(const entry of entries){
  const artifact=image(entry);
  if(!artifact){groups.push({members:[entry]});continue;}
  const owner=ownerRuns.get(entry.id),answer=answers.get(entry.id);
  const key=`${artifact.conversationId}:${entry.kind}:${entry.kind==='bob.artifact'&&owner!==undefined?`owner:${owner}`:entry.kind==='bob.file'&&typeof answer==='number'&&segments.has(entry.id)?`answer:${answer}:window:${segments.get(entry.id)}`:`single:${entry.id}`}`;
  const last=groups[groups.length-1];
  if(last?.key===key&&last.artifacts&&!last.artifacts.some(item=>item.id===artifact.id)){
   last.members.push(entry);last.artifacts.push(artifact);
  }else groups.push({members:[entry],artifacts:[artifact],key});
 }
 return groups.map(group=>{
  // Backward pagination extends an existing deck without replacing its row key.
  const first=group.members.find(member=>previousAnchors.has(member.id))??group.members[0];if(!group.artifacts){
   // This field is a local projection, never authority supplied by history.
   if('imageAttachments' in first){const {imageAttachments:_,...safe}=first as ImageAttachmentRow;return safe;}
   return first;
  }
  const old=cached.get(first);
  if(old&&old.members.length===group.members.length&&old.members.every((member,i)=>member===group.members[i]))return old.row;
  const row={...first,imageAttachments:group.artifacts};cached.set(first,{members:group.members,row});return row;
 });
}
