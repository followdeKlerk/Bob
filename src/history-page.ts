import type {EntryRecord} from '@earendil-works/pi-durable';

// Leave room for the response envelope, a signed cursor, and local readOnly metadata
// below Durable's 50 KiB text-output cap. Do not raise that global safeguard.
export const HISTORY_ITEMS_MAX_BYTES=35*1024;
export function historyPage(entries:readonly EntryRecord[],query=''){
 const items:unknown[]=[];
 let bytes=2,consumed=0;
 const needle=query.trim().toLocaleLowerCase();
 for(const entry of entries){
  const serialized=JSON.stringify(entry);
  if(needle&&!serialized.toLocaleLowerCase().includes(needle)){consumed++;continue;}
  const originalBytes=Buffer.byteLength(serialized);
  // A single oversized entry must not block paging forever. Return an explicit
  // preview, never something that can be mistaken for the complete stored record.
  const item=originalBytes>HISTORY_ITEMS_MAX_BYTES-2?{
   id:entry.id,conversationId:entry.conversationId,kind:entry.kind.slice(0,128),
   omitted:true,originalBytes,preview:serialized.slice(0,2048),
   detail:'Oversized entry: preview only. Full record remains in the original conversation history.',
  }:entry;
  const size=Buffer.byteLength(JSON.stringify(item))+(items.length?1:0);
  if(bytes+size>HISTORY_ITEMS_MAX_BYTES)break;
  items.push(item);bytes+=size;consumed++;
 }
 return {items,consumed};
}
