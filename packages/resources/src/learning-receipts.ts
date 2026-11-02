import {createHash} from 'node:crypto';
import type {JsonValue} from '@earendil-works/chord';
import {defineDocFamily,type ConversationId,type Tx} from '@earendil-works/pi-durable';
/** Atomic operation receipts close the commit -> ToolTask-settlement crash window. */
export const LearningToolReceipts=defineDocFamily<{fingerprint?:string;result?:JsonValue},null>({kind:'bob.learning.tool-receipts',version:1,scope:'conversation',history:'latest',fork:'initial',family:true,initial:()=>({}),checkpointWhen:()=>true});
export async function withLearningReceipt<T>(tx:Tx,conversationId:ConversationId,taskId:string,operation:unknown,run:()=>Promise<T>):Promise<T>{
 const fingerprint=createHash('sha256').update(JSON.stringify(operation)).digest('hex');
 const receipt=await tx.doc(LearningToolReceipts,conversationId,taskId,null);
 if(receipt.fingerprint){if(receipt.fingerprint!==fingerprint)throw Error('Learning operation identity conflict');return JSON.parse(JSON.stringify(receipt.result)) as T;}
 const result=await run();
 // Tool responses use JSON too: omit optional undefined properties before storing strict native state.
 const json=JSON.parse(JSON.stringify(result));receipt.fingerprint=fingerprint;receipt.result=json;
 return json as T;
}
