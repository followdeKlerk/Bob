import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import https from 'node:https';
import {State} from '../src/state.js';
import {serve} from '../src/server.js';
const bindError = /Remote binding requires a Tailscale IPv4 address and verified TLS certificate configuration/;
const startup = new Error('binding validation passed');
// Stop at runtime access: these policy tests must not resolve DNS, bind, or initialize state.
const probe = (host: string, tls?: {cert: string; key: string}) => serve({} as State, {
 port: 0, host, tls, get runtime(): never { throw startup; },
});
const tls = {cert: 'unused-cert.pem', key: 'unused-key.pem'};
for (const host of [
 '100.64.attacker.example', '100.64.1.2.example', 'localhost',
 '100.64.', '100.64.1', '100.64.256.1', '100.64.1.256', '100.64.01.2', '100.64.1.2:443',
 '8.8.8.8', '192.168.1.2', '100.63.255.255', '100.128.0.0', '0.0.0.0', '::',
]) test(`TLS bind rejects non-CGNAT literal ${host} before startup`, async () => {
 await assert.rejects(() => probe(host, tls), bindError);
});
for (const host of ['100.64.0.0', '100.100.1.2', '100.127.255.255']) {
 test(`CGNAT literal ${host} requires TLS`, async () => {
  await assert.rejects(() => probe(host), bindError);
  await assert.rejects(() => probe(host, tls), error => error === startup);
 });
}
for (const host of ['127.0.0.1', '::1']) test(`loopback literal ${host} permits HTTP and HTTPS`, async () => {
 await assert.rejects(() => probe(host), error => error === startup);
 await assert.rejects(() => probe(host, tls), error => error === startup);
});
test('TLS transport verifies trusted certificate and rejects untrusted certificate; public plaintext bind refused',{timeout:20000},async()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR!,'bob-tls-')),cert=join(dir,'cert.pem'),key=join(dir,'key.pem');const result=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});assert.equal(result.status,0);
 const s=new State(join(dir,'state'));await assert.rejects(()=>serve(s,{port:0,host:'0.0.0.0'}));const app=await serve(s,{port:0,tls:{cert,key}});const port=(app.server.address() as any).port;
 const get=(ca?:Buffer)=>new Promise<number>((resolve,reject)=>{const req=https.get({hostname:'127.0.0.1',port,path:'/v1/status',ca},res=>{res.resume();resolve(res.statusCode!);});req.on('error',reject);});
 try{assert.equal(await get(readFileSync(cert)),401);await assert.rejects(()=>get());}finally{await app.close();s.close();}
});
