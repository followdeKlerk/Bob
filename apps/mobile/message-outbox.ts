import type {Message} from '../../src/contracts';
import {readOutbox,writeOutbox} from './outbox-storage';
import type {DraftAttachment} from './components/attachment-thumbnail';
export type OutgoingMessage={
  id:string; scope:string; foregroundOnly?:boolean; backend:{backendId:string;endpoint:string;name:string}; chat:number;
  localId:number; afterEntryId?:number; createdAt?:number; message:ReturnType<typeof Message.parse>; files:DraftAttachment[]; admitted?:boolean; entry?:number; rejected?:boolean; uncertain?:boolean; attempts?:number; retryAt?:number; retryAfterAt?:number; lastError?:string;
};
/** Local presentation is synchronous; storage and transport are deliberately separate. */
export class MessageOutbox {
  items:OutgoingMessage[]=[];
  storageError?:string;
  private writes:Promise<unknown>=Promise.resolve();
  private listeners=new Set<()=>void>();
  private loaded=false;
  private loading?:Promise<void>;
  private revision=0;
  private savedRevision=0;
  private removed=new Set<string>();
  readonly ready:Promise<void>;
  constructor(){this.ready=this.load();void this.ready.catch(()=>{});}
  private load():Promise<void>{
    if(this.loaded)return Promise.resolve();
    if(this.loading)return this.loading;
    this.loading=(async()=>{
      const saved=await readOutbox() as OutgoingMessage[];
      // An unreadable queue is not an empty queue. Never overwrite it on error.
      if(!Array.isArray(saved)||saved.some(item=>!item||typeof item.id!=='string'||typeof item.scope!=='string'||!item.backend||!item.message||!Array.isArray(item.files)))throw Error('Saved message queue is unreadable');
      this.items=[...saved.filter(item=>!this.removed.has(item.id)&&!this.items.some(local=>local.id===item.id)),...this.items];
      this.loaded=true;this.removed.clear();this.setStorageError(undefined);this.emit();
    })().catch(error=>{this.setStorageError(String(error.message??error));throw error;}).finally(()=>{this.loading=undefined;});
    return this.loading;
  }
  subscribe(listener:()=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
  private emit(){for(const listener of this.listeners)listener();}
  private setStorageError(value:string|undefined){if(this.storageError!==value){this.storageError=value;this.emit();}}
  private persist(){
    const job=this.writes.catch(()=>{}).then(async()=>{
      await this.load();
      if(this.savedRevision===this.revision)return;
      const revision=this.revision;
      await writeOutbox(this.items);
      this.savedRevision=revision;this.setStorageError(undefined);
    }).catch(error=>{this.setStorageError(String(error.message??error));throw error;});
    this.writes=job;return job;
  }
  add(item:OutgoingMessage){this.removed.delete(item.id);this.items=[...this.items,item];this.revision++;this.emit();return this.persist();}
  update(id:string,patch:Partial<OutgoingMessage>){this.items=this.items.map(item=>item.id===id?{...item,...patch}:item);this.revision++;this.emit();return this.persist();}
  remove(id:string){if(!this.loaded)this.removed.add(id);this.items=this.items.filter(item=>item.id!==id);this.revision++;this.emit();return this.persist();}
  // A failed disk write is retried, not a permanently poisoned Promise. Transport
  // may proceed only once the complete current queue is durably saved.
  async saved(){await this.persist();}
}
export function visibleOutgoing(items:OutgoingMessage[],scope:string,entries:{id:number;data?:unknown}[]){
  return items.filter(item=>item.scope===scope&&!entries.some(entry=>entry.id===item.entry||(entry.data as {requestId?:string}|undefined)?.requestId===item.id));
}

type PositionedEntry={id:number;kind?:string;data?:unknown;model?:unknown[]};
/** Older app versions did not save a transcript anchor. Recover from available
 * model timestamps when possible; without evidence use the oldest boundary,
 * never repeatedly attach an old failed message to the newest reply. */
export function outgoingAnchor(item:OutgoingMessage,entries:PositionedEntry[]):number {
  if(item.afterEntryId!==undefined)return item.afterEntryId;
  const created=item.createdAt??Math.abs(item.localId);
  const ordered=[...entries].sort((a,b)=>a.id-b.id);
  let before=0,dated=false;
  for(const entry of ordered){
    const timestamps=(entry.model??[]).map(message=>(message as {timestamp?:number}|null)?.timestamp).filter((value):value is number=>typeof value==='number'&&Number.isFinite(value));
    if(timestamps.length){dated=true;if(Math.min(...timestamps)>created)return before;}
    before=entry.id;
  }
  return dated?before:0;
}
/** Input/output are newest-first, matching the inverted native list. Anchors
 * refer to real server entry IDs, not array indexes or the moving chat bottom. */
export function mergeOutgoing<T extends PositionedEntry>(entries:T[],items:OutgoingMessage[],scope:string,makeEntry:(item:OutgoingMessage)=>T):T[]{
  const ordered=[...entries].sort((a,b)=>a.id-b.id);
  const local=visibleOutgoing(items,scope,entries).map(item=>({item,anchor:outgoingAnchor(item,entries)})).sort((a,b)=>a.anchor-b.anchor);
  const merged:T[]=[];let index=0;
  for(const entry of ordered){
    while(index<local.length&&local[index].anchor<entry.id)merged.push(makeEntry(local[index++].item));
    merged.push(entry);
  }
  while(index<local.length)merged.push(makeEntry(local[index++].item));
  return merged.reverse();
}
export function outgoingLabel(item:OutgoingMessage):string {
  return item.admitted?'Queued':item.rejected?(item.uncertain?'Delivery unconfirmed':'Not sent'):item.attempts?'Retrying automatically':'Waiting to send';
}

/** Keep the same native cell when a local bubble becomes a stored message. */
export function transcriptKey(entry:PositionedEntry):string {
 const requestId=(entry.data as {requestId?:unknown}|undefined)?.requestId;
 return entry.kind==='bob.user'&&typeof requestId==='string'&&requestId?`message:${requestId}`:`entry:${entry.id}`;
}
