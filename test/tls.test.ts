import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import https from 'node:https';
import {State} from '../src/state.js';
import {serve} from '../src/server.js';
test('TLS transport verifies trusted certificate and rejects untrusted certificate; public plaintext bind refused',{timeout:20000},async()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR!,'bob-tls-')),cert=join(dir,'cert.pem'),key=join(dir,'key.pem');const result=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});assert.equal(result.status,0);
 const s=new State(join(dir,'state'));await assert.rejects(()=>serve(s,{port:0,host:'0.0.0.0'}));const app=await serve(s,{port:0,tls:{cert,key}});const port=(app.server.address() as any).port;
 const get=(ca?:Buffer)=>new Promise<number>((resolve,reject)=>{const req=https.get({hostname:'127.0.0.1',port,path:'/v1/status',ca},res=>{res.resume();resolve(res.statusCode!);});req.on('error',reject);});
 try{assert.equal(await get(readFileSync(cert)),401);await assert.rejects(()=>get());}finally{await app.close();s.close();}
});
