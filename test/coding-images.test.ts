import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deflateSync} from 'node:zlib';
import {test,type TestContext} from 'node:test';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';
import {NodeExecutionEnv} from '@earendil-works/pi-durable/env/node';
import {CodingTools as NativeCodingTools,type createReadTool} from '@earendil-works/pi-durable/tools';
import {CodingTools} from '../packages/coding/src/index.js';
type ReadTool=ReturnType<typeof createReadTool>;
const read=CodingTools.tools!.find(t=>t.name==='read')! as ReadTool;
const native=NativeCodingTools.tools!.find(t=>t.name==='read')! as ReadTool;
function chunk(name:string,data:Buffer){
 const bytes=Buffer.concat([Buffer.from(name),data]);let crc=0xffffffff;
 for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
 const size=Buffer.alloc(4),check=Buffer.alloc(4);size.writeUInt32BE(data.length);check.writeUInt32BE((crc^0xffffffff)>>>0);
 return Buffer.concat([size,bytes,check]);
}
function png(width:number,height:number){
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 const rows=Buffer.alloc(height*(width*3+1));
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=y*(width*3+1)+1+x*3;rows[p]=x%256;rows[p+1]=y%256;rows[p+2]=(x+y)%256;}
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
function fixture(t:TestContext,bytes:Buffer,model?:unknown){
 const dir=mkdtempSync(join(tmpdir(),'bob-image-read-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'extensionless-upload');writeFileSync(path,bytes);
 const env=new NodeExecutionEnv({cwd:dir}),writes=t.mock.method(env,'writeFile');
 const api={env,agent:async()=>({model:model?{provider:'fixture',modelId:'vision'}:undefined}),models:{getModel:()=>model}} as unknown as Parameters<ReadTool['execute']>[1];
 return {path,writes,run:(tool=read,args={path})=>tool.execute(args,api,ctx),unchanged:()=>assert.deepEqual(readFileSync(path),bytes)};
}
test('registered read resizes extensionless tall screenshots on its first call and preserves original bytes',async t=>{
 const f=fixture(t,png(1264,2780));
 assert.equal((await f.run(native)).isError,true,'reproduce the unconfigured native-reader regression');
 const result=await f.run();assert.notEqual(result.isError,true);assert.ok(Array.isArray(result.output));
 const blocks=result.output as Array<{type:string;mimeType:string;data:string}>;assert.equal(blocks.length,1);assert.equal(blocks[0].type,'image');
 assert.ok(blocks[0].data.length<=4.5*1024*1024);assert.match(JSON.stringify(result.diagnostics),/Resized from 1264x2780 to \d+x2000/);
 f.unchanged();assert.equal(f.writes.mock.callCount(),0);
});
test('read obeys selected model dimensions and byte budget, including no-vision diagnostics',async t=>{
 const f=fixture(t,png(500,700),{input:['text'],inputLimits:{images:{resize:{maxWidth:300,maxHeight:400,maxBytes:20000}}}});
 const result=await f.run();assert.notEqual(result.isError,true);
 const blocks=result.output as Array<{type:string;data:string}>;assert.equal(blocks[0].type,'image');assert.ok(blocks[0].data.length<=20000);
 assert.match(JSON.stringify(result.diagnostics),/Resized from/);assert.match(JSON.stringify(result.diagnostics),/does not support images/);f.unchanged();
});
test('small images and text pagination still use native read results',async t=>{
 const f=fixture(t,png(40,50));assert.notEqual((await f.run()).isError,true);f.unchanged();
 const text=fixture(t,Buffer.from('one\ntwo\nthree\n'));const args={path:text.path,offset:2,limit:1};
 assert.deepEqual(await read.execute(args,( {env:new NodeExecutionEnv({cwd:tmpdir()})} as unknown as Parameters<ReadTool['execute']>[1]),ctx),await native.execute(args,({env:new NodeExecutionEnv({cwd:tmpdir()})} as unknown as Parameters<ReadTool['execute']>[1]),ctx));text.unchanged();
});
test('malformed image is rejected without writes or a shell fallback',async t=>{
 const f=fixture(t,png(40,50).subarray(0,40));
 const result=await f.run();assert.equal(result.isError,true);assert.deepEqual(result.output,[]);assert.equal(f.writes.mock.callCount(),0);f.unchanged();
});
