/** Host adapter only. Hindsight protocol, tools, hooks and persistence live in the removable package. */
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHindsightMemory,MemoryInstallation,type MemoryConfig} from '@bob-local/memory';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';
import type {Cursor} from '@earendil-works/pi-durable';
import {isRetired} from './retired-chat-profile.js';
import type {State} from './state.js';
export function backendMemory(state:State){
 const file=join(state.dir,'hindsight.json');
 const saved=state.get<Partial<MemoryConfig>>('hindsightConfig');
 const config:Partial<MemoryConfig>=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):(saved??{});
 if(!config||typeof config!=='object'||Array.isArray(config))throw Error('Invalid hindsight.json');
 // App messages use bob.user; native CLI inputs use pi.user. Peer/custom entries remain excluded.
 const module=createHindsightMemory({...config,apiKey:process.env.BOB_HINDSIGHT_API_KEY??config.apiKey},fetch,{ownerInputKinds:['pi.user','bob.user']});
 // Preserve owner configuration in the already-backed-up control store; environment secrets stay in the environment.
 if(existsSync(file)&&JSON.stringify(saved)!==JSON.stringify(config))state.set('hindsightConfig',config);
 return {...module,attach:async(...args:Parameters<typeof module.attach>)=>{
  const [h,storage,identity,options]=args;
  // Provision through public native documents, excluding retired
  // chats BEFORE automatic capture reconciliation or any scheduler resume.
  if(module.config.enabled&&options?.selectExisting){
   let install=await h.snapshot(MemoryInstallation,ctx);
   if(!install){const latest=await storage.scanSubmissions({order:'descending'},1,undefined,ctx);await h.commit(async tx=>{Object.assign(await tx.doc(MemoryInstallation),{floor:latest.items[0]?.id??0,backendId:identity});},ctx);install=await h.snapshot(MemoryInstallation,ctx);}
   if(install!.backendId!==identity)throw Error('Hindsight backend identity mismatch');
   if(!install!.provisioned){
    let cursor:Cursor|undefined;
    do{const page=await h.commit(tx=>tx.scanConversations({},100,cursor),ctx);for(const record of page.items){if(record.owner||record.id===1||await isRetired(h,record.id))continue;const chat=await h.conversation(record.id,ctx);if(chat)await chat.configure({extensions:{add:[module.extension]}},ctx);}cursor=page.next;}while(cursor);
    await h.commit(async tx=>{(await tx.doc(MemoryInstallation)).provisioned=true;},ctx);
   }
  }
  return module.attach(h,storage,identity,{...options,selectExisting:false});
 }};
}
