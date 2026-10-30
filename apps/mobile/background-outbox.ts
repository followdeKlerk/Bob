import type {OutgoingMessage} from './message-outbox';
export type BackgroundReceipt={state:'pending'|'admitted'|'rejected';admission?:{status:string;entry?:number};error?:string;uncertain?:boolean};
export type BackgroundPort={
 enqueue(endpoint:string,backendId:string,credential:string,chat:number,requestId:string,message:string,files:string,item:string,retry:boolean):Promise<unknown>;
 status(requestId:string):Promise<string|null>;
 list():Promise<string[]>;
 remove(requestId:string):Promise<unknown>;
};
/** Invoke native persistence in the Send event, not after a JS storage/network await. */
export class BackgroundOutbox {
 private credentials=new Map<string,string>();
 private handoffs=new Map<string,Promise<unknown>>();
 constructor(private native:BackgroundPort,private credential:(id:string)=>Promise<string|undefined>){}
 ready(id:string){return this.credentials.has(id);}
 async prepare(id:string){const token=await this.credential(id);if(token)this.credentials.set(id,token);else this.credentials.delete(id);}
 enqueue(item:OutgoingMessage,retry=false):Promise<unknown>{
  // Native v1 deliberately does not own attachment staging/upload. Do not create
  // a second sender for those messages; retain the existing foreground pipeline.
  if(item.files.length||item.foregroundOnly)return Promise.resolve();
  const existing=this.handoffs.get(item.id);if(existing)return existing;
  const invoke=(token:string)=>this.native.enqueue(item.backend.endpoint,item.backend.backendId,token,item.chat,item.id,JSON.stringify(item.message),JSON.stringify(item.files),JSON.stringify(item),retry);
  const token=this.credentials.get(item.backend.backendId);
  const job=(token?invoke(token):this.prepare(item.backend.backendId).then(()=>{const value=this.credentials.get(item.backend.backendId);if(!value)throw Object.assign(Error('Pair again: device credential missing'),{httpStatus:401});return invoke(value);}));
  this.handoffs.set(item.id,job);void job.finally(()=>{if(this.handoffs.get(item.id)===job)this.handoffs.delete(item.id);}).catch(()=>{});return job;
 }
 async deliver(item:OutgoingMessage,retry=false):Promise<BackgroundReceipt|undefined>{
  if(item.files.length||item.foregroundOnly)return undefined;
  await this.enqueue(item,retry);
  const raw=await this.native.status(item.id);
  return raw?JSON.parse(raw):{state:'pending'};
 }
 async recover():Promise<OutgoingMessage[]>{return (await this.native.list()).map(raw=>JSON.parse(raw));}
 async remove(id:string){await this.native.remove(id);}
}
