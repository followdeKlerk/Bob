import {createHash,randomUUID} from 'node:crypto';
import {createWriteStream,constants} from 'node:fs';
import {open,mkdir,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {basename,extname,isAbsolute,join} from 'node:path';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {z} from 'zod';
import type {Conversation} from '@earendil-works/pi-durable';
import type {Context} from '@earendil-works/chord/context';
import type {State} from './state.js';
import {Attachment} from './contracts.js';
const Input=z.object({path:z.string().min(1).max(8192).refine(isAbsolute,'Use an absolute backend file path'),name:z.string().min(1).max(255).regex(/^[^/\\\x00-\x1f]+$/).optional()}).strict();
const mimeFor=(name:string)=>({'.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.txt':'text/plain','.md':'text/markdown','.html':'text/html','.csv':'text/csv','.json':'application/json','.zip':'application/zip','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.apk':'application/vnd.android.package-archive'}[extname(name).toLowerCase()]??'application/octet-stream');
/** Snapshot bytes before publishing. Stable task identity makes recovery reuse the same attachment. */
export async function sendFile(state:State,chat:Conversation,taskId:string,input:unknown,context:Context){
 const args=Input.parse(input),name=Input.shape.name.unwrap().parse(args.name??basename(args.path));
 const seed=createHash('sha256').update(`send-file:${chat.id}:${taskId}`).digest('hex');
 const id=`${seed.slice(0,8)}-${seed.slice(8,12)}-4${seed.slice(13,16)}-8${seed.slice(17,20)}-${seed.slice(20,32)}`;
 const fingerprint=createHash('sha256').update(JSON.stringify(args)).digest('hex');
 const dir=join(state.dir,'artifacts',String(chat.id)),dest=join(dir,id),receipt=dest+'.json';
 await mkdir(dir,{recursive:true,mode:0o700});
 let saved:unknown;
 try{saved=JSON.parse(await readFile(receipt,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 let meta:ReturnType<typeof Attachment.parse>;
 if(saved){
  if(await readFile(dest+'.send','utf8')!==fingerprint)throw Error('File operation identity conflict');
  meta=Attachment.parse(saved);
  if(meta.id!==id||meta.conversationId!==chat.id)throw Error('File ownership mismatch');
 }else{
  const limit=state.get<number>('uploadLimit')??25*1024*1024;
  const source=await open(args.path,constants.O_RDONLY|constants.O_NONBLOCK|constants.O_NOFOLLOW);
  const temp=dest+'.'+randomUUID()+'.part';
  try{
   const stat=await source.stat();if(!stat.isFile())throw Error('Only regular files can be sent');
   if(stat.size>limit)throw Error('File exceeds configured attachment limit');
   let size=0;const hash=createHash('sha256');
   const meter=new Transform({transform(chunk:Buffer,_encoding,done){size+=chunk.length;if(size>limit)return done(Error('File exceeds configured attachment limit'));hash.update(chunk);done(null,chunk);}});
   await pipeline(source.createReadStream({autoClose:false}),meter,createWriteStream(temp,{flags:'wx',mode:0o600}));
   meta=Attachment.parse({id,conversationId:chat.id,name,mime:mimeFor(name),size,sha256:hash.digest('hex')});
   await rename(temp,dest);
   await writeFile(dest+'.send',fingerprint,{mode:0o600});
   await writeFile(temp,JSON.stringify(meta),{flag:'wx',mode:0o600});await rename(temp,receipt);
  }finally{await source.close();await rm(temp,{force:true});}
 }
 const requestId=`send-file:${id}`;
 const existing=await chat.commit(tx=>tx.submissionByRequest(chat.id,requestId),context);
 if(!existing)await chat.submit({type:'write',requestId,entry:{kind:'bob.file',data:meta}},context);
 return {attached:true,artifact:meta,message:'File copied to this conversation and attachment publication submitted. The user can open or save it in Bob. This does not confirm a phone download.'};
}
