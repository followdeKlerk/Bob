/** Process-local admission only, not a server receipt or an exactly-once promise.
 * A transport rejection (including requestBackend's deadline) may leave a remote
 * outcome unknown. After transport settlement we require a new ordered GET.
 * No timeout, view lifetime, credential epoch, TTL or eviction releases a write.
 */
export type ToolsMutationSnapshot={phase:'idle'|'reserved'|'pending'|'reconcile';revision:number};
type Reservation={revision:number};
export type ToolsReadTicket=ToolsMutationSnapshot;
export class ToolsMutationOwner {
 private snapshot:ToolsMutationSnapshot={phase:'idle',revision:0};
 private listeners=new Set<()=>void>();
 private reservation?:Reservation;
 getSnapshot=()=>this.snapshot;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 private publish(phase:ToolsMutationSnapshot['phase'],revision=this.snapshot.revision){
  this.snapshot={phase,revision};for(const listener of this.listeners)listener();
 }
 reserve(expectedRevision:number):Reservation|undefined{
  if(this.snapshot.phase!=='idle'||this.snapshot.revision!==expectedRevision)return undefined;
  const reservation={revision:this.snapshot.revision+1};this.reservation=reservation;
  this.publish('reserved',reservation.revision);return reservation;
 }
 /** Only an unsent preflight can release a reservation. */
 cancel(reservation:Reservation){
  if(this.reservation!==reservation||this.snapshot.phase!=='reserved')return;
  this.reservation=undefined;this.publish('idle');
 }
 send(reservation:Reservation,request:()=>Promise<unknown>):Promise<unknown>{
  if(this.reservation!==reservation||this.snapshot.phase!=='reserved')return Promise.reject(Error('Write reservation is no longer valid.'));
  this.publish('pending');
  let raw:Promise<unknown>;
  try{raw=request();}catch(error){raw=Promise.reject(error);}
  // Observe the actual supplied transport promise, never the UI's timed race.
  const settled=()=>{if(this.reservation===reservation){this.reservation=undefined;this.publish('reconcile');}};
  return raw.then(value=>{settled();return value;},error=>{settled();throw error;});
 }
 beginRead():ToolsReadTicket{return this.snapshot;}
 /** A GET started pending/reserved cannot reconcile, even if it ends later.
  * A newer reservation also invalidates every earlier read and view snapshot. */
 acceptRead(ticket:ToolsReadTicket):boolean{
  if(ticket.revision!==this.snapshot.revision||!['idle','reconcile'].includes(ticket.phase)||!['idle','reconcile'].includes(this.snapshot.phase))return false;
  if(this.snapshot.phase==='reconcile')this.publish('idle');
  return true;
 }
}
// Intentionally no eviction: unresolved ownership must survive all view owners.
const owners=new Map<string,ToolsMutationOwner>();
export function toolsMutationOwner(backendId:string,kind:'modules'|'connections',conversationId?:number){
 const key=JSON.stringify([backendId,kind,kind==='modules'?conversationId??null:null]);
 let owner=owners.get(key);if(!owner){owner=new ToolsMutationOwner();owners.set(key,owner);}return owner;
}
