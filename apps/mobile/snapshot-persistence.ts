import {writeHistoryCache} from './history-cache';
/** The live view is authoritative. Offline caching is best effort, not part of
 * every token's paint path: retain one latest snapshot and serialize at most one
 * write at a time, with a bounded cadence and an immediate settled-run flush. */
export function snapshotPersistence(key:string,write=writeHistoryCache,intervalMs=1000){
 let pending:unknown,hasPending=false,closed=false,last=0;
 let timer:ReturnType<typeof setTimeout>|undefined,flight:Promise<void>|undefined;
 const later=()=>{if(closed||timer||flight||!hasPending)return;timer=setTimeout(()=>{timer=undefined;void flush();},Math.max(0,intervalMs-(Date.now()-last)));};
 function flush():Promise<void>{
  clearTimeout(timer);timer=undefined;
  if(flight)return flight.then(()=>hasPending?flush():undefined);
  if(!hasPending)return Promise.resolve();
  const value=pending;pending=undefined;hasPending=false;last=Date.now();
  let serialized:string;try{serialized=JSON.stringify(value);}catch{return Promise.resolve();}
  const job=Promise.resolve().then(()=>write(key,serialized)).catch(()=>{}).finally(()=>{if(flight===job)flight=undefined;later();});
  flight=job;return job;
 }
 return {
  push(value:unknown,settled=false){if(closed)return;pending=value;hasPending=true;if(settled)void flush();else later();},
  flush,
  async close(){closed=true;clearTimeout(timer);timer=undefined;await flush();if(hasPending)await flush();},
 };
}
