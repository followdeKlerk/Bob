import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import type {CreateModelsOptions} from '@earendil-works/pi-ai/models';
import type {State} from './state.js';
import {acquireOwner} from './ownership.js';
type Store=NonNullable<CreateModelsOptions['credentials']>;
type Credential=Exclude<Awaited<ReturnType<Store['read']>>,undefined>;
const providers=['openai','anthropic'];
const name=(id:string)=>{if(!providers.includes(id))throw Error('Unsupported provider');return `providerCredential:${id}`;};
async function locked<T>(state:State,id:string,fn:()=>Promise<T>,signal?:AbortSignal):Promise<T>{
 name(id);const directory=join(state.dir,'provider-locks',id);mkdirSync(directory,{recursive:true,mode:0o700});
 const deadline=Date.now()+60000;let release:(()=>void)|undefined;
 while(!release){signal?.throwIfAborted();try{release=acquireOwner(directory);}catch(error){const code=(error as {cause?:{errcode?:number}}).cause?.errcode;if(![5,6].includes(code??0)||Date.now()>deadline)throw Error('Provider credential storage is busy or unavailable');await delay(50,undefined,{signal});}}
 try{return await fn();}finally{release();}
}
export function providerCredentials(state:State):Store{
 return {
  async read(id){return state.get<Credential>(name(id));},
  async list(){return providers.flatMap(providerId=>{const c=state.get<Credential>(name(providerId));return c?[{providerId,type:c.type}]:[];});},
  async modify(id,fn,options){return locked(state,id,async()=>{const current=state.get<Credential>(name(id)),next=await fn(current);if(next){state.db.exec('BEGIN IMMEDIATE');try{state.set(name(id),next);state.delete(`${id}Key`);state.db.exec('COMMIT');}catch(error){state.db.exec('ROLLBACK');throw error;}}return next??current;},options?.signal);},
  async delete(id,options){await locked(state,id,async()=>{state.db.exec('BEGIN IMMEDIATE');try{state.delete(name(id));state.delete(`${id}Key`);state.db.exec('COMMIT');}catch(error){state.db.exec('ROLLBACK');throw error;}},options?.signal);},
 };
}
export function hasProviderCredential(state:State,id:string){return !!state.get(name(id))||!!state.get(`${id}Key`);}
export async function setProviderKey(state:State,id:string,key:string){
 await locked(state,id,async()=>{state.db.exec('BEGIN IMMEDIATE');try{state.delete(name(id));state.set(`${id}Key`,key);state.db.exec('COMMIT');}catch(error){state.db.exec('ROLLBACK');throw error;}});
}
