import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {State,hash,secret} from '../src/state.js';
import {serve} from '../src/server.js';
import {ctx} from '../src/runtime.js';
test('artifact original bytes, cross-chat ownership, MIME/traversal; explicit peer read trust is separate from pairing',{timeout:20000},async()=>{
 const s=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-authority-'))),app=await serve(s,{port:0});const base=`http://127.0.0.1:${(app.server.address() as any).port}`;
 const invitation=s.invite(),device=s.pair(invitation.token,'fixture'),headers={authorization:`Bearer ${device.credential}`,'x-bob-backend':s.id};
 try{const a=await app.runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx),b=await app.runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
 const bytes=Buffer.from('Original Markdown\n# Résumé\n');let r=await fetch(`${base}/v1/chats/${a.id}/artifacts`,{method:'POST',headers:{...headers,'content-type':'text/markdown','x-file-name':'test.md'},body:bytes});assert.equal(r.status,201);const meta=await r.json() as any;
 r=await fetch(`${base}/v1/chats/${a.id}/artifacts/${meta.id}`,{headers});assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes);
 r=await fetch(`${base}/v1/chats/${b.id}/artifacts/${meta.id}`,{headers});assert.notEqual(r.status,200);
 const uploadId=randomUUID();
 const upload=()=>fetch(`${base}/v1/chats/${a.id}/artifacts?uploadId=${uploadId}`,{method:'POST',headers:{...headers,'content-type':'text/markdown','x-file-name':'queued.md'},body:bytes});
 const first=await upload();assert.equal(first.status,201);assert.equal((await first.json() as any).id,uploadId);
 const replay=await upload();assert.equal(replay.status,201);assert.equal((await replay.json() as any).id,uploadId);
 const history=await (await fetch(`${base}/v1/chats/${a.id}/history`,{headers})).json() as any;
 assert.equal(history.items.filter((entry:any)=>entry.kind==='bob.artifact'&&entry.data.id===uploadId).length,1,'attachment replay must not duplicate the transcript');

 r=await fetch(`${base}/v1/chats/${a.id}/artifacts`,{method:'POST',headers:{...headers,'content-type':'image/png','x-file-name':'false.png'},body:bytes});assert.notEqual(r.status,201);
 r=await fetch(`${base}/v1/chats/${a.id}/artifacts`,{method:'POST',headers:{...headers,'x-file-name':'..%2Fescape'},body:bytes});assert.equal(r.status,400);
 r=await fetch(base+'/v1/transfer-limits',{headers});assert.equal((await r.json() as any).uploadLimit,25*1024*1024);
 r=await fetch(base+'/v1/transfer-limits',{method:'PUT',headers,body:JSON.stringify({uploadLimit:1024})});assert.equal(r.status,200);
 r=await fetch(base+'/v1/transfer-limits',{headers});assert.equal((await r.json() as any).uploadLimit,1024);
 r=await fetch(`${base}/v1/chats/${a.id}/artifacts`,{method:'POST',headers,body:Buffer.alloc(1025)});assert.equal(r.status,413);
 r=await fetch(base+'/v1/transfer-limits',{method:'PUT',headers,body:JSON.stringify({uploadLimit:-1})});assert.equal(r.status,400);
 const peerId=randomUUID(),token=secret(),payload={destinationBackendId:s.id,conversationId:a.id};
 const peer=(bearer:string,body=payload)=>fetch(base+'/v1/peer/history',{method:'POST',headers:{authorization:`Bearer ${bearer}`,'x-bob-peer':peerId},body:JSON.stringify(body)});
 assert.equal((await peer(device.credential)).status,403);s.set('peerGrants',[{peerId,name:'Explicit peer',tokenHash:hash(token),read:[a.id],message:[],revoked:false}]);assert.equal((await peer(token)).status,200);assert.equal((await peer(token,{...payload,conversationId:b.id})).status,403);assert.equal((await peer(token,{...payload,destinationBackendId:randomUUID()})).status,403);
 s.revoke(device.deviceId);assert.equal((await fetch(base+'/v1/status',{headers})).status,401);
 }finally{await app.close();s.close();}
});
