import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sendFile} from '../src/send-file.js';
import {ctx} from '../src/runtime.js';
import type {State} from '../src/state.js';
import type {Conversation} from '@earendil-works/pi-durable';

test('send_file assigns audio/video MIME from a case-insensitive extension without changing attachment publication',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bob-media-mime-')),source=join(dir,'source');writeFileSync(source,'fixture');
 const submitted:any[]=[];
 const state={dir,get:()=>25*1024*1024} as unknown as State;
 const chat={id:7,commit:async()=>undefined,submit:async(request:unknown)=>submitted.push(request)} as unknown as Conversation;
 try {
  for(const [extension,mime] of Object.entries({mp3:'audio/mpeg',m4a:'audio/mp4',aac:'audio/aac',wav:'audio/wav',ogg:'audio/ogg',opus:'audio/ogg',flac:'audio/flac',mp4:'video/mp4',m4v:'video/mp4',webm:'video/webm',mov:'video/quicktime',mkv:'video/x-matroska'})){
   const name=`recording.${extension.toUpperCase()}`;
   const result=await sendFile(state,chat,extension,{path:source,name},ctx);
   assert.equal(result.artifact.mime,mime);assert.equal(result.artifact.name,name);assert.equal(result.artifact.conversationId,7);
   assert.equal(submitted.at(-1).entry.kind,'bob.file');assert.deepEqual(submitted.at(-1).entry.data,result.artifact);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
