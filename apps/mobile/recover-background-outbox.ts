import type {OutgoingMessage} from './message-outbox';
/** Native notification replies can arrive without a React screen or while it is already mounted. */
export async function recoverBackgroundOutbox(
 outbox:{ready:Promise<void>;items:OutgoingMessage[];add(item:OutgoingMessage):Promise<unknown>},
 native:{recover():Promise<OutgoingMessage[]>},
 current:()=>boolean=()=>true,
){
 await outbox.ready;if(!current())return;
 const items=await native.recover();
 for(const item of items){if(!current())return;if(!outbox.items.some(local=>local.id===item.id))await outbox.add(item);}
}

/** Publish complete metadata-only snapshots; absence/failure stays blocked on Android. */
export function notificationReplyBarriers(items:OutgoingMessage[],backendId:string){
 return [...new Set(items.filter(item=>item.backend.backendId===backendId&&!item.admitted&&(item.files.length>0||item.foregroundOnly)).map(item=>item.chat))];
}
