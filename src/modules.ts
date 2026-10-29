import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';
import {configure,type Cursor,type Extension,type Registry,type Conversation} from '@earendil-works/pi-durable';
import {z} from 'zod';
import type {State} from './state.js';
import type {Runtime} from './runtime.js';
import {HttpError} from './errors.js';
import {customCatalog} from './custom-modules.js';

const names:Record<string,string>={coding:'coding-tools',resources:'bob.resources',subagents:'subagent-tools',web:'bob.web',interactive:'bob.interactive',peers:'bob.peers',memory:'bob.memory'};
export type ModuleId=keyof typeof names;
export const moduleIds=Object.keys(names) as ModuleId[];
const Selection=z.array(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)).max(32).refine(ids=>new Set(ids).size===ids.length,'Duplicate module selection');
const Manifest=z.object({name:z.string(),version:z.literal('0.1.0'),dependencies:z.record(z.string(),z.string()),bobExtension:z.object({api:z.literal(1),durable:z.literal('1.4.0'),name:z.string(),requires:Selection}).strict()});
export function validateModuleManifest(raw:unknown,id:ModuleId) {
 const manifest=Manifest.parse(raw);
 if(manifest.name!==`@bob-local/${id}`||manifest.bobExtension.name!==names[id])throw Error('Module package or extension identity mismatch');
 if(manifest.dependencies['@earendil-works/pi-durable']!=='1.4.0')throw Error('Module requires the exact validated Durable dependency');
 return manifest;
}
export function moduleCatalog(state?:State) {
 return [...moduleIds.map(id=>{
  const entry=fileURLToPath(import.meta.resolve(`@bob-local/${id}`));
  const manifest=validateModuleManifest(JSON.parse(readFileSync(join(dirname(entry),'../package.json'),'utf8')),id);
  return {id,name:names[id],packageName:manifest.name,version:manifest.version,durable:manifest.bobExtension.durable,dependencies:manifest.dependencies,requires:manifest.bobExtension.requires};
 }),...(state?customCatalog(state):[])];
}
export function moduleState(state:State) {
 const stored=state.get<{installed:ModuleId[];defaults:ModuleId[]}>('modules');
 const installed=Selection.parse(stored?.installed??moduleIds),defaults=Selection.parse(stored?.defaults??moduleIds);
 if(defaults.some(id=>!installed.includes(id)))throw Error('A default module is not installed');
 const catalog=moduleCatalog(state);
 if(installed.some(id=>!catalog.some(module=>module.id===id)))throw Error('Unknown installed module');
 for(const module of catalog)if(installed.includes(module.id)&&module.requires.some(id=>!installed.includes(id)))throw Error('Missing module dependency');
 return {installed,defaults};
}
export function registerModules(state:State,registry:Registry,instances:Record<ModuleId,Extension>) {
 const selection=moduleState(state),tools=new Set<string>();
 for(const id of selection.installed){
  const extension=instances[id];if(!extension||extension.name!==moduleCatalog(state).find(module=>module.id===id)?.name)throw Error('Extension identity collision');
  for(const tool of extension.tools??[]){if(tools.has(tool.name))throw Error('Duplicate module tool: '+tool.name);tools.add(tool.name);}
  registry.install(extension);
 }
 return selection.defaults.map(id=>instances[id]);
}
export async function listModules(state:State,runtime:Runtime,chat?:Conversation) {
 const configuration=moduleState(state),selected=chat?(await chat.agent(ctx)).extensions.map(e=>e.name):undefined;
 return moduleCatalog(state).map(module=>({...module,available:true,installed:configuration.installed.includes(module.id),registered:!!runtime.registry.snapshot().extension(module.name),defaultSelected:configuration.defaults.includes(module.id),...(selected?{selected:selected.includes(module.name)}:{})}));
}
export async function selectModules(state:State,runtime:Runtime,chat:Conversation,raw:unknown) {
 const ids=Selection.parse(raw),installed=moduleState(state).installed;
 if(ids.some(id=>!installed.includes(id)))throw new HttpError(409,'Install the module on this backend first');
 const inspection=await runtime.harness.inspect(ctx);
 if(inspection.tasks.some(t=>t.record.conversationId===chat.id)||inspection.submissions.some(s=>s.conversationId===chat.id))throw new HttpError(409,'Stop and settle this conversation and its background work before changing modules');
 for(const module of moduleCatalog(state))if(ids.includes(module.id)&&module.requires.some(id=>!ids.includes(id)))throw new HttpError(409,'Required module is not selected');
 await chat.configure({extensions:await runtime.delegation.selectedExtensions(runtime.harness,chat,ids.map(id=>runtime.modules[id]))},ctx);
 return listModules(state,runtime,chat);
}
/** Local CLI only, with a paused runtime and exclusive owner lock. No package downloads or hot replacement. */
export async function changeModule(state:State,runtime:Runtime,action:'install'|'remove'|'enable'|'disable',id:string) {
 const catalog=moduleCatalog(state),definition=catalog.find(module=>module.id===id);if(!definition)throw Error('Unknown validated module package');
 const moduleId=id as ModuleId,current=moduleState(state);
 const inspection=await runtime.harness.inspect(ctx);
 if(inspection.scheduling!=='paused')throw Error('Module lifecycle changes require a paused, exclusively owned runtime');
 if(action!=='install'&&(inspection.tasks.length||inspection.submissions.length))throw Error('Unfinished Durable work: settle it before disabling/removing modules');
 if(action==='install') {
  current.installed=Array.from(new Set([...current.installed,moduleId]));
 } else {
  if(!current.installed.includes(moduleId))throw Error('Module not installed');
  if(action==='enable')current.defaults=Array.from(new Set([...current.defaults,moduleId]));
  else current.defaults=current.defaults.filter(item=>item!==moduleId);
  if(action==='remove') {
   if(catalog.some(m=>current.installed.includes(m.id)&&m.requires.includes(moduleId)))throw Error('Another installed module requires this module');
   // Preserve every module document and entry. Remove only explicit agent selections;
   // all tasks must already be terminal, so no recovery definition is discarded.
   let cursor:Cursor|undefined;
   do {
    const page=await runtime.harness.commit(tx=>tx.scanConversations({},100,cursor),ctx);
    for(const record of page.items){const chat=await runtime.harness.conversation(record.id,ctx);if(!chat)continue;const agent=await chat.agent(ctx);await chat.configure({extensions:agent.extensions.filter(e=>e.name!==definition.name)},ctx);}
    cursor=page.next;
   }while(cursor);
   current.installed=current.installed.filter(item=>item!==moduleId);
  }
 }
 state.set('modules',current);
 return {action,id,installed:current.installed.includes(moduleId),defaultSelected:current.defaults.includes(moduleId),restartRequired:true,coverage:'Backend-local module activation; retained package archives remain available for reinstall and recovery. No marketplace. Disable changes host defaults; explicit conversation selections are separate.'};
}
