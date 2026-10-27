import {z} from 'zod';
import {State,hash,secret} from './state.js';
import {PeerGrant} from './peers.js';
import {PeerConnection,peerEndpoint} from './peer-config.js';
const Id=z.string().uuid(),Name=z.string().min(1).max(100);
export const NetworkGrant=z.object({peerId:Id,name:Name,endpoint:z.string().url()}).strict();
export const NetworkHandoff=z.object({protocol:z.literal(2),originBackendId:Id,destinationBackendId:Id,endpoint:z.string().url(),credential:z.string().min(32).max(128),allConversations:z.literal(true)}).strict();
export const NetworkConnect=z.object({name:Name,handoff:NetworkHandoff}).strict();
/** Called only behind the existing device authentication/identity guards. */
export function grantNetwork(state:State,deviceId:string,raw:unknown,devLoopback=false){
 const p=NetworkGrant.parse(raw),endpoint=peerEndpoint(p.endpoint,devLoopback);
 if(p.peerId===state.id)throw Error('Self grant');
 if(!state.devices().some(d=>d.id===deviceId&&!d.revoked))throw Error('Device revoked');
 const grants=state.get<z.infer<typeof PeerGrant>[]>('peerGrants')??[],prior=grants.find(g=>g.peerId===p.peerId);
 if(prior?.revoked)throw Error('Explicitly revoked');
 const key=`networkGrantKey:${deviceId}:${p.peerId}`;
 const credential=state.get<string>(key)??secret();
 state.db.exec('BEGIN IMMEDIATE');
 try{
  state.set(key,credential);
  state.set('peerGrants',[...grants.filter(g=>g.peerId!==p.peerId),PeerGrant.parse({peerId:p.peerId,name:p.name,tokenHash:hash(credential),read:[],message:[],allConversations:true,ownerDeviceId:deviceId,revoked:false})]);
  state.db.exec('COMMIT');
 }catch(e){state.db.exec('ROLLBACK');throw e;}
 return NetworkHandoff.parse({protocol:2,originBackendId:p.peerId,destinationBackendId:state.id,endpoint,credential,allConversations:true});
}
export async function connectNetwork(state:State,raw:unknown,devLoopback=false,stillAuthorized:()=>boolean=()=>true,ownerDeviceId?:string){
 const {handoff:p,name}=NetworkConnect.parse(raw),endpoint=peerEndpoint(p.endpoint,devLoopback);
 if(p.originBackendId!==state.id||p.destinationBackendId===state.id)throw Error('Backend identity mismatch');
 const existing=(state.get<z.infer<typeof PeerConnection>[]>('peerConnections')??[]).find(c=>c.id===p.destinationBackendId);
 if(existing&&!existing.enabled)throw Error('Explicitly disabled');
 // Verify destination via authenticated operation before committing any new trust.
 const response=await fetch(endpoint+'/v1/peer/conversations',{method:'POST',redirect:'error',signal:AbortSignal.timeout(12000),headers:{authorization:'Bearer '+p.credential,'x-bob-peer':state.id,'content-type':'application/json'},body:JSON.stringify({destinationBackendId:p.destinationBackendId,limit:1})});
 if(!response.ok)throw Error('Peer verification failed');
 let length=0;const chunks:Uint8Array[]=[];
 for await(const chunk of response.body!){length+=chunk.length;if(length>100000)throw Error('Peer response too large');chunks.push(chunk);}
 const proof=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 if(proof.backendId!==p.destinationBackendId||!Array.isArray(proof.items))throw Error('Peer identity mismatch');
 if(!stillAuthorized())throw Error('Device revoked');
 const connections=state.get<z.infer<typeof PeerConnection>[]>('peerConnections')??[];
 if(connections.some(c=>c.id===p.destinationBackendId&&!c.enabled))throw Error('Explicitly disabled');
 const connection=PeerConnection.parse({id:p.destinationBackendId,name,endpoint,read:[],message:[],allConversations:true,enabled:true,devLoopback,...(ownerDeviceId?{ownerDeviceId}:{})});
 state.db.exec('BEGIN IMMEDIATE');
 try{state.set(`peerKey:${connection.id}`,p.credential);state.set('peerConnections',[...connections.filter(c=>c.id!==connection.id),connection]);state.db.exec('COMMIT');}
 catch(e){state.db.exec('ROLLBACK');throw e;}
 return {backendId:state.id,connection};
}
