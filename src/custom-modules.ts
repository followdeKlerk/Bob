import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,readdirSync,lstatSync,mkdirSync,existsSync,rmSync} from 'node:fs';
import {join,resolve,relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isBuiltin,registerHooks} from 'node:module';
import {z} from 'zod';
import {createRegistry,type Extension,type ConversationDocToken,type JsonObject,type Cursor} from '@earendil-works/pi-durable';
import type {State} from './state.js';
import type {Runtime} from './runtime.js';
import {ctx} from './runtime.js';
const Id=z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),Version=z.string().regex(/^\d+\.\d+\.\d+$/);
const hostDependencies:Record<string,string>={'@earendil-works/pi-durable':'1.4.0','@earendil-works/pi-ai':'1.4.0','@earendil-works/chord':'1.4.0','@bob-local/core':'0.1.0'};
const Manifest=z.object({name:z.string().regex(/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/),version:Version,type:z.literal('module'),exports:z.literal('./dist/index.js'),dependencies:z.record(z.string(),z.string()),bobExtension:z.object({api:z.literal(1),durable:z.literal('1.4.0'),stateVersion:z.number().int().positive(),name:z.string().min(1).max(100),requires:z.array(Id).max(32)}).strict()});
const RecordSchema=z.object({id:Id,manifest:Manifest,hash:z.string().regex(/^[a-f0-9]{64}$/),files:z.record(z.string(),z.string().regex(/^[a-f0-9]{64}$/))}).strict();
type PackageRecord=z.infer<typeof RecordSchema>;
const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
export function customRecords(state:State){return z.array(RecordSchema).max(32).parse(state.get('customModules')??[]);}
export function customCatalog(state:State){return customRecords(state).map(r=>({id:r.id,name:r.manifest.bobExtension.name,packageName:r.manifest.name,version:r.manifest.version,durable:r.manifest.bobExtension.durable,dependencies:r.manifest.dependencies,requires:r.manifest.bobExtension.requires}));}
function packageDirectory(state:State,record:PackageRecord){return join(state.dir,'custom-modules',record.id,`${record.manifest.version}-${record.hash}`);}
function inspectPackage(directory:string){
 const root=resolve(directory),files:Record<string,string>={};let bytes=0;
 if(!lstatSync(root).isDirectory()||lstatSync(root).isSymbolicLink())throw Error('Custom package must be a real directory, not a symlink');
 const walk=(path:string)=>{
  const stat=lstatSync(path);if(stat.isSymbolicLink())throw Error('Custom package refuses symlinks');
  if(stat.isDirectory()){for(const name of readdirSync(path).sort()){if(name.startsWith('.'))throw Error('Hidden files are not supported in a custom package payload');walk(join(path,name));}return;}
  if(!stat.isFile())throw Error('Custom package requires regular files');
  bytes+=stat.size;if(bytes>16*1024*1024||Object.keys(files).length>=256)throw Error('Custom package exceeds bounded payload limit');
  files[relative(root,path)]=hash(readFileSync(path));
 };
 walk(join(root,'package.json'));walk(join(root,'dist'));
 if(!files['dist/index.js'])throw Error('Custom package requires dist/index.js');
 const manifest=Manifest.parse(JSON.parse(readFileSync(join(root,'package.json'),'utf8')));
 if(manifest.dependencies['@earendil-works/pi-durable']!=='1.4.0')throw Error('Declare the exact validated Durable dependency');
 for(const [name,version]of Object.entries(manifest.dependencies))if(hostDependencies[name]!==version)throw Error('Unsupported or unvalidated custom dependency: '+name);
 return {manifest,files,hash:hash(JSON.stringify(files))};
}
async function loadPackage(state:State,record:PackageRecord){
 const directory=packageDirectory(state,record),observed=inspectPackage(directory);
 if(observed.hash!==record.hash||JSON.stringify(observed.files)!==JSON.stringify(record.files)||JSON.stringify(observed.manifest)!==JSON.stringify(record.manifest))throw Error('Custom module integrity mismatch');
 const prefix=pathToFileURL(directory+'/').href;
 // Resolve only this package's declared, exact host dependencies. This is compatibility plumbing, NOT a sandbox.
 const hook=registerHooks({resolve(specifier,context,next){
  if(!context.parentURL?.startsWith(prefix)||specifier.startsWith('.')||specifier.startsWith('/')||specifier.startsWith('file:')||isBuiltin(specifier))return next(specifier,context);
  const name=specifier.startsWith('@')?specifier.split('/').slice(0,2).join('/'):specifier.split('/')[0];
  if(!record.manifest.dependencies[name])throw Error('Undeclared custom module dependency: '+name);
  return {url:import.meta.resolve(specifier),shortCircuit:true};
 }});
 try{
  const exports=await import(pathToFileURL(join(directory,'dist/index.js')).href);
  const extension=exports.default as Extension;
  if(!extension||extension.name!==record.manifest.bobExtension.name)throw Error('Custom extension identity mismatch');
  return {extension,migration:exports.bobMigration,dispose:()=>hook.deregister()};
 }catch(error){hook.deregister();throw error;}
}
export async function loadCustomModules(state:State){
 const records=customRecords(state),selected=state.get<{installed:string[]}>('modules')?.installed??[],instances:Record<string,Extension>={},disposers:(()=>void)[]=[];
 try{for(const record of records)if(selected.includes(record.id)){const loaded=await loadPackage(state,record);instances[record.id]=loaded.extension;disposers.push(loaded.dispose);}return {instances,dispose:()=>disposers.forEach(fn=>fn())};}
 catch(error){disposers.forEach(fn=>fn());throw error;}
}
/** Explicitly trusted backend code; no npm scripts, downloads or hot replacement. */
export async function importCustomModule(state:State,runtime:Runtime,id:string,directory:string,replace?:string,migrate=false){
 Id.parse(id);const inspection=await runtime.harness.inspect(ctx);
 if(inspection.scheduling!=='paused'||inspection.tasks.length||inspection.submissions.length)throw Error('Custom import requires paused, exclusively owned and fully settled Durable state');
 const records=customRecords(state),existing=records.find(r=>r.id===id),observed=inspectPackage(directory);
 if(existing&&replace!==existing.manifest.version)throw Error('Replacing a custom module requires its exact previous version and a verified pre-change backup');
 if(existing&&(existing.manifest.name!==observed.manifest.name||existing.manifest.bobExtension.name!==observed.manifest.bobExtension.name))throw Error('Custom package and extension identities must remain stable across replacement');
 const schemaChanged=!!existing&&existing.manifest.bobExtension.stateVersion!==observed.manifest.bobExtension.stateVersion;
 if(schemaChanged&&!migrate)throw Error('Custom state-schema change refused: use the explicit staged migration command');
 if(migrate&&(!existing||!schemaChanged||observed.manifest.bobExtension.stateVersion!==existing.manifest.bobExtension.stateVersion+1))throw Error('Migration requires an existing module and exactly the next declared schema');
 if(!existing&&replace)throw Error('No installed custom version to replace');
 if(!existing&&runtime.modules[id])throw Error('Module ID collision');
 const available=new Set([...Object.keys(runtime.modules),...records.map(r=>r.id)]);
 if(observed.manifest.bobExtension.requires.some(required=>required===id||!available.has(required)))throw Error('Unknown or self-requiring custom module dependency');
 const graph=new Map([...records.filter(r=>r.id!==id).map(r=>[r.id,r.manifest.bobExtension.requires] as const),[id,observed.manifest.bobExtension.requires] as const]);
 const visit=(name:string,path:Set<string>)=>{if(path.has(name))throw Error('Custom module dependency cycle');const next=new Set([...path,name]);for(const required of graph.get(name)??[])visit(required,next);};
 visit(id,new Set());
 const record={id,...observed},target=packageDirectory(state,record),created=!existsSync(target);
 let dispose:(()=>void)|undefined;
 try{
  for(const parent of [join(state.dir,'custom-modules'),join(state.dir,'custom-modules',id)])if(existsSync(parent)&&(lstatSync(parent).isSymbolicLink()||!lstatSync(parent).isDirectory()))throw Error('Invalid custom archive parent directory');
  if(created){mkdirSync(target,{recursive:true,mode:0o700});for(const name of Object.keys(record.files)){const output=join(target,name);mkdirSync(resolve(output,'..'),{recursive:true,mode:0o700});writeFileSync(output,readFileSync(join(directory,name)),{mode:0o600,flag:'wx'});}}
  const loaded=await loadPackage(state,record);dispose=loaded.dispose;
  let migrationDocuments:ConversationDocToken<JsonObject>[]=[];
  if(migrate){
   const plan=loaded.migration;
   if(!plan||plan.from!==existing!.manifest.bobExtension.stateVersion||plan.to!==record.manifest.bobExtension.stateVersion||!Array.isArray(plan.documents)||plan.documents.length<1||plan.documents.length>32)throw Error('Declare bobMigration with exact from/to and bounded document tokens');
   const kinds=new Set<string>();
   for(const token of plan.documents){const d=token?.definition;
    if(!d||d.scope!=='conversation'||d.family||d.version!==plan.to||typeof d.migrate!=='function'||!(d.kind===loaded.extension.name||d.kind.startsWith(loaded.extension.name+'.'))||kinds.has(d.kind))throw Error('Migration supports unique owned conversation document tokens with native migrate functions only');
    kinds.add(d.kind);
   }
   migrationDocuments=plan.documents;
  }
  const registry=createRegistry(),names=new Set<string>(),tools=new Set<string>();
  for(const [moduleId,extension]of [...Object.entries(runtime.modules).filter(([moduleId])=>moduleId!==id),[id,loaded.extension] as const]){
   if(names.has(extension.name))throw Error('Extension name collision');names.add(extension.name);
   for(const tool of extension.tools??[]){if(tools.has(tool.name))throw Error('Module tool collision: '+tool.name);tools.add(tool.name);}registry.install(extension);
  }
  const current=state.get<{installed:string[];defaults:string[]}>('modules')??{installed:Object.keys(runtime.modules),defaults:Object.keys(runtime.modules)};
  if(new Set([...current.installed,id]).size>32)throw Error('Too many installed modules');
  for(const required of record.manifest.bobExtension.requires)if(!current.installed.includes(required))throw Error('Required module is not installed');
  if(migrate){
   // Native typed document access invokes Durable's version migration. Never rewrite upstream SQL.
   // This mode is exposed by the CLI only on a backed-up staged clone, not the original runtime.
   let cursor:Cursor|undefined;
   do{const page=await runtime.harness.commit(tx=>tx.scanConversations({},100,cursor),ctx);
    for(const conversation of page.items)for(const token of migrationDocuments){
     const value=await runtime.harness.snapshot(token,conversation.id,ctx);
     if(value!==undefined)await runtime.harness.commit(async tx=>{await tx.doc(token,conversation.id);},ctx);
    }
    cursor=page.next;
   }while(cursor);
  }
  state.db.exec('BEGIN IMMEDIATE');
  try{state.set('customModules',[...records.filter(r=>r.id!==id),record]);state.set('modules',{...current,installed:[...new Set([...current.installed,id])]});state.db.exec('COMMIT');}catch(error){state.db.exec('ROLLBACK');throw error;}
  return {id,version:record.manifest.version,hash:record.hash,installed:true,defaultSelected:current.defaults.includes(id),restartRequired:true,migrated:migrate,codeAuthority:'Trusted backend OS account; not sandboxed',coverage:'Built ESM package, exact supported host dependencies only; archive retained for backup/restore. Explicit staged migration supports declared owned conversation document tokens; no automatic migration.'};
 }catch(error){if(created)rmSync(target,{recursive:true,force:true});throw error;}finally{dispose?.();}
}
