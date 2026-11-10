import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Writable} from 'node:stream';
import type {ServerResponse} from 'node:http';
import {artifactByteRange,downloadArtifact} from '../src/artifacts.js';
import type {State} from '../src/state.js';
import type {Conversation} from '@earendil-works/pi-durable';
class Response extends Writable {
 status=0;headers:Record<string,unknown>={};chunks:Buffer[]=[];
 writeHead(status:number,headers:Record<string,unknown>){this.status=status;this.headers=headers;return this;}
 _write(chunk:Buffer,_encoding:string,callback:()=>void){this.chunks.push(Buffer.from(chunk));callback();}
 get bytes(){return Buffer.concat(this.chunks);}
}
const id='5aaee20e-e260-4403-80da-b97ce80664a1';
function fixture(bytes=Buffer.from('0123456789')){
 const dir=mkdtempSync(join(tmpdir(),'bob-artifact-range-')),folder=join(dir,'artifacts','7');mkdirSync(folder,{recursive:true});
 const meta={id,conversationId:7,name:'recording.mp4',mime:'video/mp4',size:bytes.length,sha256:'a'.repeat(64)};
 const path=join(folder,id);writeFileSync(path,bytes);writeFileSync(path+'.json',JSON.stringify(meta));
 return {dir,path,meta,download:async(request:{range?:string;method?:string}={},chatId=7)=>{const res=new Response();await downloadArtifact(res as unknown as ServerResponse,{dir} as State,{id:chatId} as Conversation,id,request);return res;},close:()=>rmSync(dir,{recursive:true,force:true})};
}
test('single byte-range parser rejects malformed, multipart, unsafe and unsatisfiable ranges',()=>{
 for(const value of ['bytes=','bytes=-','bytes=-0','bytes=10-','bytes=8-2','bytes=1-2,4-5','items=1-2','bytes=1.5-2','bytes=9007199254740993-','bytes=1-9007199254740993','bytes=+1-2'])assert.equal(artifactByteRange(value,10),undefined,value);
 assert.deepEqual(artifactByteRange('bytes=0-0',10),{start:0,end:0});
 assert.deepEqual(artifactByteRange('bytes=3-',10),{start:3,end:9});
 assert.deepEqual(artifactByteRange('bytes=-3',10),{start:7,end:9});
 assert.deepEqual(artifactByteRange('bytes=-30',10),{start:0,end:9});
 assert.deepEqual(artifactByteRange('bytes=8-999',10),{start:8,end:9});
 assert.equal(artifactByteRange('bytes=0-',0),undefined);
});
test('download preserves full GET and delivers exact bounded 206 original bytes with secure headers',async()=>{
 const f=fixture();try{
  const full=await f.download();assert.equal(full.status,200);assert.equal(full.bytes.toString(),'0123456789');assert.equal(full.headers['content-length'],10);
  for(const [range,expected,start,end] of [['bytes=2-5','2345',2,5],['bytes=8-','89',8,9],['bytes=-2','89',8,9],['bytes=0-0','0',0,0]] as const){
   const res=await f.download({range});assert.equal(res.status,206);assert.equal(res.bytes.toString(),expected);assert.equal(res.headers['content-length'],expected.length);assert.equal(res.headers['content-range'],`bytes ${start}-${end}/10`);
   assert.equal(res.headers['accept-ranges'],'bytes');assert.equal(res.headers['cache-control'],'no-store');assert.equal(res.headers['x-content-type-options'],'nosniff');assert.equal(res.headers['content-type'],'video/mp4');assert.match(String(res.headers['content-disposition']),/recording.mp4/);
  }
 }finally{f.close();}
});
test('HEAD advertises the complete representation without reading bytes; invalid GET ranges return bodyless 416',async()=>{
 const f=fixture();try{
  for(const request of [{method:'HEAD'},{method:'HEAD',range:'bytes=2-5'},{method:'HEAD',range:'bytes=999-'}]){
   const res=await f.download(request);assert.equal(res.status,200);assert.equal(res.bytes.length,0);assert.equal(res.headers['content-length'],10);assert.equal(res.headers['content-range'],undefined);
  }
  for(const range of ['bytes=10-','bytes=0-1,3-4','garbage']){
   const res=await f.download({range});assert.equal(res.status,416);assert.equal(res.headers['content-range'],'bytes */10');assert.equal(res.headers['content-length'],0);assert.equal(res.bytes.length,0);
  }
 }finally{f.close();}
 const empty=fixture(Buffer.alloc(0));try{assert.equal((await empty.download()).bytes.length,0);assert.equal((await empty.download({range:'bytes=0-'})).status,416);}finally{empty.close();}
});
test('range and HEAD cannot escape conversation scope or bypass receipt ownership and file-size checks',async()=>{
 const f=fixture();try{
  await assert.rejects(()=>f.download({range:'bytes=0-1'},8),/not found in this conversation/);
  writeFileSync(f.path+'.json',JSON.stringify({...f.meta,conversationId:8}));await assert.rejects(()=>f.download({method:'HEAD'}),/ownership mismatch/);
  writeFileSync(f.path+'.json',JSON.stringify(f.meta));writeFileSync(f.path,'changed');await assert.rejects(()=>f.download({range:'bytes=0-1'}),/size mismatch/);
 }finally{f.close();}
});
test('large-file ranges do not drain the whole attachment or buffer it before responding',async()=>{
 const bytes=Buffer.alloc(2*1024*1024,0x61);bytes.write('tail',bytes.length-4);
 const f=fixture(bytes);try{const res=await f.download({range:'bytes=-4'});assert.equal(res.bytes.toString(),'tail');assert.equal(res.headers['content-length'],4);}finally{f.close();}
});
