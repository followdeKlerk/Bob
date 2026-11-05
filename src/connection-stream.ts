import type {ServerResponse} from 'node:http';

export type ConnectionActivity='idle'|'working'|'waiting';
export function connectionActivity(active:boolean,waiting:boolean):ConnectionActivity{return waiting?'waiting':active?'working':'idle';}
/** Native background readers receive no transcript, tool arguments, phone requests,
 * question text or credentials. Reopening the UI fetches its authoritative snapshot. */
export async function connectionStream(res:ServerResponse,options:{backendId:string;conversationId:number;authorized:()=>boolean;read:()=>Promise<ConnectionActivity>;streams:Set<ServerResponse>;pollMs?:number;heartbeatMs?:number}){
 let closed=false,reading=false,last:ConnectionActivity|undefined,lastSent=0;
 let timer:ReturnType<typeof setInterval>|undefined;
 const cleanup=()=>{closed=true;clearInterval(timer);options.streams.delete(res);};
 const end=()=>{cleanup();res.end();};
 res.once('close',cleanup);
 options.streams.add(res);
 res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store','connection':'keep-alive','x-content-type-options':'nosniff','x-accel-buffering':'no'});
 const emit=async()=>{
  if(closed)return;
  if(!options.authorized()){end();return;}
  if(reading)return;
  reading=true;
  try{
   const state=await options.read(),now=Date.now();
   if(closed||res.destroyed)return;
   if(!options.authorized()){end();return;}
   if(last===state&&now-lastSent<(options.heartbeatMs??10000))return;
   // There is no mutation or native watch to recover/replay on reattachment.
   const frame={backendId:options.backendId,conversationId:options.conversationId,state,observedAt:now};
   last=state;lastSent=now;
   // A slow/stalled reader may reconnect, but cannot grow an unbounded write queue.
   if(!res.write(`event: connection\ndata: ${JSON.stringify(frame)}\n\n`))end();
  }catch{end();}finally{reading=false;}
 };
 timer=setInterval(()=>{void emit();},options.pollMs??1000);
 await emit();
}
