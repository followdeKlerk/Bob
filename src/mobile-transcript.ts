import type {EntryRecord} from '@earendil-works/pi-durable';

const cache=new WeakMap<object,EntryRecord>();
/** Phone presentation only. Encoded tool images can be multi-megabyte strings;
 * never resend them in every live snapshot or render them as JSON text. Stored
 * entries, model context, all text and call identities remain untouched. The
 * authenticated history?entryId= endpoint retrieves the exact original on demand. */
export function mobileTranscriptEntries<T extends EntryRecord>(entries:readonly T[]):T[]{
 return entries.map(entry=>{
  const known=cache.get(entry);if(known)return known as T;
  let changed=false;
  const model=entry.model?.map(message=>{
   if(message.role!=='toolResult'||!Array.isArray(message.content))return message;
   let messageChanged=false;
   const content=message.content.map(block=>{
    if(block.type!=='image'||typeof block.data!=='string')return block;
    messageChanged=true;
    return {type:'text' as const,text:`[Image result: ${block.mimeType}; ${block.data.length} encoded characters. Image bytes are omitted from the phone transcript for performance. The original is retained in stored history (entry ${entry.id}).]`};
   });
   if(!messageChanged)return message;
   changed=true;return {...message,content};
  });
  const presented=changed?{...entry,model,mobilePresentation:{version:1,omittedToolImages:true,originalEntryId:entry.id}}:entry;
  cache.set(entry,presented as EntryRecord);
  return presented as T;
 });
}
