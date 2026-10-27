import {z} from 'zod';
import {writeFileSync,readFileSync,lstatSync} from 'node:fs';
import {State,hash,secret} from './state.js';
import {PeerGrant,type PeerGrant as Grant} from './peers.js';
import {PeerConnection} from './contracts.js';
export {PeerConnection} from './contracts.js';
const Id=z.string().uuid(),Conversations=z.array(z.number().int().positive()).max(1000);
export type PeerConnection=z.infer<typeof PeerConnection>;
const Transfer=z.object({protocol:z.literal(1),originBackendId:Id,destinationBackendId:Id,endpoint:z.string().url(),credential:z.string().min(32).max(128),read:Conversations,message:Conversations}).strict();
export function peerEndpoint(endpoint:string,devLoopback=false) {
 const url=new URL(endpoint);
 if(url.username||url.password||url.pathname!=='/'||url.hash||url.search)throw Error('Peer endpoint must be an origin without credentials');
 if(devLoopback&&url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname))return url.origin;
 if(url.protocol!=='https:'||!url.hostname.endsWith('.ts.net'))throw Error('Remote peer requires verified Tailscale HTTPS');
 return url.origin;
}
export function listPeers(state:State) {
 const active=new Set(state.devices().filter(d=>!d.revoked).map(d=>String(d.id)));
 return {inbound:(state.get<Grant[]>('peerGrants')??[]).map(({tokenHash,ownerDeviceId,...grant})=>({...grant,...(ownerDeviceId?{authorizationExpired:!active.has(ownerDeviceId)}:{})})),outbound:(state.get<PeerConnection[]>('peerConnections')??[]).map(value=>({...PeerConnection.parse(value),...(value.ownerDeviceId?{authorizationExpired:!active.has(value.ownerDeviceId)}:{})}))};
}
export function grantPeer(state:State,raw:{peerId:string;name:string;endpoint:string;read:number[];message:number[];output:string;devLoopback?:boolean}) {
 const endpoint=peerEndpoint(raw.endpoint,raw.devLoopback),credential=secret();
 const grant=PeerGrant.parse({peerId:raw.peerId,name:raw.name,read:raw.read,message:raw.message,tokenHash:hash(credential),revoked:false});
 if(grant.peerId===state.id)throw Error('A backend cannot grant itself peer authority');
 const transfer=Transfer.parse({protocol:1,originBackendId:grant.peerId,destinationBackendId:state.id,endpoint,credential,read:grant.read,message:grant.message});
 // Exclusive creation: never overwrite an existing credential handoff or follow a symlink.
 writeFileSync(raw.output,JSON.stringify(transfer),{mode:0o600,flag:'wx'});
 state.set('peerGrants',[...(state.get<Grant[]>('peerGrants')??[]).filter(g=>g.peerId!==grant.peerId),grant]);
 return {peerId:grant.peerId,output:raw.output,read:grant.read,message:grant.message,warning:'Sensitive one-way credential handoff. Transfer privately; do not paste into chat. Import only on the named origin backend.'};
}
export function connectPeer(state:State,path:string,name:string,devLoopback=false) {
 const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536||(stat.mode&0o077))throw Error('Peer handoff must be a bounded owner-only regular file');
 const transfer=Transfer.parse(JSON.parse(readFileSync(path,'utf8')));
 if(transfer.originBackendId!==state.id||transfer.destinationBackendId===state.id)throw Error('Peer handoff backend identity mismatch');
 const endpoint=peerEndpoint(transfer.endpoint,devLoopback),connection=PeerConnection.parse({id:transfer.destinationBackendId,name,endpoint,read:transfer.read,message:transfer.message,enabled:true,devLoopback});
 state.set(`peerKey:${connection.id}`,transfer.credential);
 state.set('peerConnections',[...(state.get<PeerConnection[]>('peerConnections')??[]).filter(c=>c.id!==connection.id),connection]);
 return connection;
}
export function revokePeer(state:State,id:string,direction:'inbound'|'outbound') {
 Id.parse(id);
 if(direction==='inbound') {
  const grants=state.get<Grant[]>('peerGrants')??[];if(!grants.some(g=>g.peerId===id))throw Error('Unknown inbound peer');
  state.set('peerGrants',grants.map(g=>g.peerId===id?{...g,revoked:true}:g));
 }else{
  const connections=state.get<PeerConnection[]>('peerConnections')??[];if(!connections.some(c=>c.id===id))throw Error('Unknown outbound peer');
  state.set('peerConnections',connections.map(c=>c.id===id?{...c,enabled:false}:c));state.delete(`peerKey:${id}`);
 }
 return {id,direction,revoked:true};
}
export async function requestPeer(state:State,id:string,action:'conversations'|'history'|'message'|'operation',request:Record<string,unknown>,signal?:AbortSignal) {
 const connection=(state.get<PeerConnection[]>('peerConnections')??[]).map(c=>PeerConnection.parse(c)).find(c=>c.id===id&&c.enabled);
 if(!connection)throw Error('Peer is not explicitly connected');
 if(connection.ownerDeviceId&&!state.devices().some(d=>d.id===connection.ownerDeviceId&&!d.revoked))throw Error('Authorizing device revoked');
 const conversationId=action==='conversations'?undefined:z.number().int().positive().parse(request.conversationId);
 if(action!=='conversations'&&!connection.allConversations&&!(action==='history'?connection.read:connection.message).includes(conversationId!))throw Error('Outbound peer scope denied');
 const credential=state.get<string>(`peerKey:${id}`);if(!credential)throw Error('Peer credential missing');
 const timeout=AbortSignal.timeout(20000);
 const response=await fetch(peerEndpoint(connection.endpoint,connection.devLoopback)+'/v1/peer/'+action,{method:'POST',redirect:'error',signal:signal?AbortSignal.any([timeout,signal]):timeout,headers:{authorization:'Bearer '+credential,'x-bob-peer':state.id,'content-type':'application/json'},body:JSON.stringify({...request,destinationBackendId:id})});
 if(!response.ok)throw Error(`Peer HTTP ${response.status}; no automatic resend`);
 let size=0;const chunks:Uint8Array[]=[];
 for await(const chunk of response.body!){size+=chunk.length;if(size>4*1024*1024)throw Error('Peer response exceeds limit');chunks.push(chunk);}
 const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 if(result.backendId!==id||(action!=='conversations'&&result.conversationId!==conversationId))throw Error('Peer response identity mismatch; no automatic resend');
 return result;
}
