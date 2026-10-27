export type NetworkBackend={backendId:string;endpoint:string;name:string};
export type NetworkRequest=(path:string,method:string,body:unknown,backend:NetworkBackend,signal?:AbortSignal)=>Promise<any>;
/** Pairing is the owner's authorization. Exchange only dedicated peer credentials, never device tokens. */
export async function syncConnectedNetwork(backends:NetworkBackend[],request:NetworkRequest,signal?:AbortSignal){
 const errors:string[]=[];
 const available=new Map<string,any>();
 await Promise.all(backends.map(async b=>{
  try{available.set(b.backendId,await request('peers','GET',undefined,b,signal));}
  catch{if(!signal?.aborted)errors.push(`${b.name}: offline or backend update required`);}
 }));
 for(const source of backends){
  if(!available.has(source.backendId))continue;
  for(const destination of backends){
   if(signal?.aborted)return {errors};
   if(source.backendId===destination.backendId||!available.has(destination.backendId))continue;
   const existing=available.get(source.backendId).outbound?.find((p:any)=>p.id===destination.backendId);
   const inbound=available.get(destination.backendId).inbound?.find((p:any)=>p.peerId===source.backendId);
   if(existing?.enabled&&existing.allConversations&&!existing.authorizationExpired&&existing.endpoint===destination.endpoint&&inbound?.allConversations&&!inbound.revoked&&!inbound.authorizationExpired)continue;
   if(existing&&!existing.enabled){errors.push(`${source.name} → ${destination.name}: explicitly disconnected`);continue;}
   try{
    // Handoff is transient memory only. Never persist it in AsyncStorage or print it in an error.
    const handoff=await request('network/grant','POST',{peerId:source.backendId,name:source.name,endpoint:destination.endpoint},destination,signal);
    if(handoff.protocol!==2||handoff.originBackendId!==source.backendId||handoff.destinationBackendId!==destination.backendId||handoff.endpoint!==destination.endpoint)throw Error('Identity mismatch');
    const result=await request('network/connect','POST',{handoff,name:destination.name},source,signal);
    if(result.backendId!==source.backendId||result.connection?.id!==destination.backendId||!result.connection.allConversations)throw Error('Identity mismatch');
    const observed=await request('peers','GET',undefined,source,signal);
    if(!observed.outbound?.some((p:any)=>p.id===destination.backendId&&p.enabled&&p.allConversations))throw Error('Link not observed');
    available.set(source.backendId,observed);
   }catch{if(!signal?.aborted)errors.push(`${source.name} → ${destination.name}: link unavailable; both backends need this update and reachable Tailscale addresses`);}
  }
 }
 return {errors};
}
