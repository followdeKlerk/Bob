import {MessageOutbox,type OutgoingMessage} from './message-outbox';
import {retryDelay,retryableError} from './network-policy';
type Backend=OutgoingMessage['backend'];
type Port={
 background?(item:OutgoingMessage):Promise<import('./background-outbox').BackgroundReceipt|undefined>;
 backends():Backend[];
 request(path:string,method:string,body:unknown,backend:Backend):Promise<any>;
 upload(item:OutgoingMessage,backend:Backend):Promise<void>;
 cleanup(item:OutgoingMessage):Promise<void>;
 watch(item:OutgoingMessage,backend:Backend):Promise<void>;
};
/** One ordered writer per backend. An unreachable machine cannot stall another.
 * Only this queue owns message retries; unrelated mutations are never replayed. */
export class OutboxDelivery {
 private running=new Map<string,Promise<void>>();
 constructor(private box:MessageOutbox,private port:Port){}
 async drain(options:{forceBackendId?:string;force?:boolean;scope?:string}={}){
  await this.box.saved();
  const ids=[...new Set(this.box.items.filter(item=>!item.rejected&&!(item.admitted&&item.entry!==undefined)).map(item=>item.backend.backendId))];
  await Promise.all(ids.map(id=>{
   const existing=this.running.get(id);if(existing)return existing;
   const backend=this.port.backends().find(value=>value.backendId===id);if(!backend)return;
   const job=this.deliver(backend,options).finally(()=>{this.running.delete(id);});this.running.set(id,job);return job;
  }));
 }
 private async deliver(backend:Backend,options:{forceBackendId?:string;force?:boolean;scope?:string}){
  const blocked=new Set<string>();
  const items=this.box.items.filter(item=>item.backend.backendId===backend.backendId&&!item.rejected&&!(item.admitted&&item.entry!==undefined))
   .sort((a,b)=>Number(b.scope===options.scope)-Number(a.scope===options.scope));
  for(const original of items){
   // A new message may have arrived while another backend was awaiting I/O.
   // Save this iteration too; the initial drain snapshot is not a write barrier
   // for messages added later.
   await this.box.saved();
   const item=this.box.items.find(value=>value.id===original.id);
   if(!item||item.rejected||blocked.has(item.scope)||(item.admitted&&item.entry!==undefined))continue;
   const now=Date.now(),force=options.force||options.forceBackendId===backend.backendId;
   if((item.retryAfterAt??0)>now||(!force&&(item.retryAt??0)>now)){blocked.add(item.scope);continue;}
   try{
    // A timeout is not evidence of rejection. Always recover a receipt before
    // attempting the exact same request identity again.
    const background=this.port.background?await this.port.background(item):undefined;
    if(background?.state==='rejected'){
     await this.box.update(item.id,{rejected:true,uncertain:background.uncertain===true,lastError:background.error??'Message could not be sent',retryAt:undefined});blocked.add(item.scope);continue;
    }
    if(background?.state==='pending'){blocked.add(item.scope);continue;}
    let admission=background?.admission;
    if(!background)admission=(await this.port.request(`chats/${item.chat}/operations/${item.id}`,'GET',undefined,backend)).admission;
    if(!background&&!admission&&!item.admitted){
     if(item.files.length)await this.port.upload(item,backend);
     admission=await this.port.request(`chats/${item.chat}/messages`,'POST',item.message,backend);
    }
    if(admission){
     if(typeof admission!=='object'||typeof admission.status!=='string'||(admission.entry!==undefined&&(!Number.isSafeInteger(admission.entry)||admission.entry<=0)))throw Error('Invalid delivery receipt');
     await this.box.update(item.id,{admitted:true,uncertain:false,entry:admission.entry,attempts:0,retryAt:admission.entry===undefined?Date.now()+5000:undefined,retryAfterAt:undefined,lastError:undefined});
     await this.port.cleanup(item).catch(()=>{});
     if(!item.admitted)await this.port.watch(item,backend).catch(()=>{});
    }else{
     // An admitted request must never be reposted if a receipt is temporarily
     // unavailable. Poll the receipt later without discarding the local bubble.
     await this.defer(item,Error('Waiting for delivery receipt'));
     blocked.add(item.scope);
    }
   }catch(error){
    if(this.box.storageError)throw error;
    if(!retryableError(error))await this.box.update(item.id,{rejected:true,lastError:String((error as Error).message??error),retryAt:undefined,retryAfterAt:undefined});
    else await this.defer(item,error);
    blocked.add(item.scope);
   }
  }
 }
 private async defer(item:OutgoingMessage,error:unknown){
  const attempts=(item.attempts??0)+1;
  const detail=error as {retryAfterMs?:number;userInfo?:{retryAfterMs?:number}};
  const serverDelay=detail?.retryAfterMs??detail?.userInfo?.retryAfterMs??0;
  const retryAfterAt=Number.isFinite(serverDelay)&&serverDelay>0?Date.now()+serverDelay:undefined;
  await this.box.update(item.id,{attempts,retryAt:Math.max(Date.now()+retryDelay(attempts),retryAfterAt??0),retryAfterAt,lastError:String((error as Error).message??error)});
 }
}
