/** Host adapter only. Hindsight protocol, tools, hooks and persistence live in the removable package. */
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHindsightMemory,type MemoryConfig} from '@bob-local/memory';
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
 return module;
}
