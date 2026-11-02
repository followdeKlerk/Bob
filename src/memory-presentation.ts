import type {ConversationId,EntryRecord,Harness} from '@earendil-works/pi-durable';
import {MemorySaves} from '@bob-local/memory';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';

const phases={queued:'save-queued',accepted:'save-processing',completed:'save-completed',failed:'save-failed',cancelled:'save-cancelled'} as const;
const labels={'save-queued':'Hindsight — save queued','save-processing':'Hindsight — saving','save-completed':'Hindsight — saved','save-failed':'Hindsight — save failed','save-cancelled':'Hindsight — save tracking stopped','save-warning':'Hindsight — saved with warnings'} as const;
/** Read-only HTTP presentation. Stored queue acknowledgements remain immutable;
 * only the exact conversation-scoped durable receipt can advance their display.
 * Never expose extracted text, provider errors or operation/account identifiers. */
export async function presentMemoryStatuses(h:Harness,id:ConversationId,entries:readonly EntryRecord[]):Promise<EntryRecord[]>{
 const keys=new Map<EntryRecord,string>();
 for(const entry of entries){
  if(entry.kind!=='bob.memory-status'||entry.model?.length||entry.conversationId!==id)continue;
  const data=entry.data;
  if(!data||typeof data!=='object'||Array.isArray(data)||data.phase!=='save-queued')continue;
  if(typeof data.receiptKey==='string'&&data.receiptKey.length>0&&data.receiptKey.length<=256)keys.set(entry,data.receiptKey);
 }
 const receipts=new Map(await Promise.all([...new Set(keys.values())].map(async key=>[key,await h.snapshot(MemorySaves,id,key,ctx)] as const)));
 return entries.map(entry=>{
  const key=keys.get(entry),receipt=key===undefined?undefined:receipts.get(key);
  if(!receipt?.operationId||!Object.hasOwn(phases,receipt.status))return entry;
  const phase=receipt.status==='completed'&&receipt.processingWarning?'save-warning':phases[receipt.status];
  return {...entry,data:{...entry.data as Record<string,unknown>,phase,text:labels[phase]}} as EntryRecord;
 });
}
