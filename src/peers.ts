import {z} from 'zod';
import type {State} from './state.js';
import type {Runtime} from './runtime.js';
import {hash} from './state.js';
import {conversationOperation,ConversationRequest} from './conversation-network.js';
export const PeerGrant=z.object({peerId:z.string().uuid(),name:z.string().min(1).max(100),tokenHash:z.string().length(64),read:z.array(z.number().int().positive()),message:z.array(z.number().int().positive()),revoked:z.boolean(),allConversations:z.boolean().optional(),ownerDeviceId:z.string().uuid().optional()}).strict();
export type PeerGrant=z.infer<typeof PeerGrant>;
export const PeerRequest=ConversationRequest;
export async function peerOperation(state:State,runtime:Runtime,peerId:string,token:string,action:string,raw:unknown){
 const grants=state.get<PeerGrant[]>('peerGrants')??[],grant=grants.find(p=>p.peerId===peerId&&!p.revoked&&p.tokenHash===hash(token));
 if(!grant)throw Error('Peer authorization denied');
 if(grant.ownerDeviceId&&!state.devices().some(d=>d.id===grant.ownerDeviceId&&!d.revoked))throw Error('Authorizing device revoked');
 return conversationOperation(state,runtime,{...grant,originBackendId:peerId},action,raw);
}
