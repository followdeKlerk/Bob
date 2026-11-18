import {useRef,useState,useSyncExternalStore} from 'react';
import {ToolsMutationOwner} from './tools-mutations';
export type SkillValue={description:string;markdown:string;enabled:boolean};
export type LibraryValue={instructions:string;templates:Record<string,string>;skills:Record<string,SkillValue>};
export type LibraryChange={field:'instructions';expected:string;value:string}|{field:'template';name:string;expected:string|null;value:string|null}|{field:'skill';name:string;expected:SkillValue|null;value:SkillValue|null};
const owners=new Map<string,ToolsMutationOwner>();
function libraryOwner(backendId:string){let owner=owners.get(backendId);if(!owner){owner=new ToolsMutationOwner();owners.set(backendId,owner);}return owner;}
function parseLibrary(value:any):LibraryValue{
 if(!value||typeof value.instructions!=='string'||!value.templates||typeof value.templates!=='object'||Array.isArray(value.templates)||Object.values(value.templates).some(item=>typeof item!=='string')||!value.skills||typeof value.skills!=='object'||Array.isArray(value.skills)||Object.values(value.skills).some((item:any)=>!item||typeof item.description!=='string'||typeof item.markdown!=='string'||typeof item.enabled!=='boolean'))throw Error('Library readback was invalid');
 return value;
}
export function libraryMatches(library:LibraryValue,change:LibraryChange){
 const current=change.field==='instructions'?library.instructions:change.field==='template'?(Object.hasOwn(library.templates,change.name)?library.templates[change.name]:null):(Object.hasOwn(library.skills,change.name)?library.skills[change.name]:null);
 if(change.field!=='skill')return current===change.value;
 const skill=current as SkillValue|null;
 return change.value===null?skill===null:!!skill&&skill.description===change.value.description&&skill.markdown===change.value.markdown&&skill.enabled===change.value.enabled;
}
/** Shared admission survives retained-view switches. Reconciliation always reads
 * after transport settlement, even if the mutation response was lost. */
export function useLibraryOperations(backendId:string,scope:string){
 const owner=libraryOwner(backendId),snapshot=useSyncExternalStore(owner.subscribe,owner.getSnapshot);
 const selected=useRef(scope);selected.current=scope;
 const reads=useRef(new Map<string,number>()),[,refresh]=useState(0);
 const [notice,setNotice]=useState<{scope:string;text:string}>();
 const current=()=>selected.current===scope;
 async function read(load:()=>Promise<unknown>){
  const ticket=owner.beginRead(),value=parseLibrary(await load());
  const fresh=owner.acceptRead(ticket);
  if(fresh){reads.current.set(scope,ticket.revision);if(current()){setNotice(undefined);refresh(value=>value+1);}}
  return {value,fresh};
 }
 const blocked=snapshot.phase!=='idle'||reads.current.get(scope)!==snapshot.revision;
 async function mutate(change:LibraryChange,write:()=>Promise<unknown>,load:()=>Promise<unknown>,observe:(value:LibraryValue)=>void){
  const reservation=owner.reserve(reads.current.get(scope)??-1);if(!reservation)return false;
  if(current())setNotice({scope,text:'Saving…'});
  try{await owner.send(reservation,write);}catch{/* Remote outcome may still be success. Never resend automatically. */}
  if(current())setNotice({scope,text:'Checking saved result…'});
  try{
   const result=await read(load);
   if(current())observe(result.value);
   const confirmed=result.fresh&&libraryMatches(result.value,change);
   if(current())setNotice({scope,text:confirmed?'Saved and checked.':"The saved value does not match this change. Your draft is retained. Review the latest library before saving again."});
   return confirmed;
  }catch{
   if(current())setNotice({scope,text:'Save outcome not confirmed. Your draft is retained. Refresh the library to check before another change; do not assume it failed.'});
   return false;
  }
 }
 return {read,mutate,blocked,pending:['reserved','pending'].includes(snapshot.phase),message:notice?.scope===scope?notice.text:snapshot.phase==='pending'?'A library change is pending.':snapshot.phase==='reconcile'?'Refresh the library to reconcile the last change before saving again.':''};
}

type Draft={instructions:string;instructionsDirty:boolean;instructionBase?:string;skillName:string;skillText:string;skillDescription:string;skillEnabled:boolean;skillEditing:boolean;skillBase?:{name:string;value:SkillValue};templateName:string;templateText:string;templateBase?:{name:string;value:string}};
const empty=():Draft=>({instructions:'',instructionsDirty:false,skillName:'',skillText:'',skillDescription:'',skillEnabled:true,skillEditing:false,templateName:'',templateText:''});
const draftRecords=new Map<string,Draft>(),draftListeners=new Map<string,Set<()=>void>>();
/** In-memory, scope-owned editor recovery. Refresh/readback never clears local
 * text (including retained-view eviction), and a late acknowledgement cannot replace edits typed during a save. */
export function useLibraryDrafts(scope:string){
 if(!draftRecords.has(scope))draftRecords.set(scope,empty());
 const draft=useSyncExternalStore(listener=>{let listeners=draftListeners.get(scope);if(!listeners){listeners=new Set();draftListeners.set(scope,listeners);}listeners.add(listener);return()=>{listeners!.delete(listener);if(!listeners!.size)draftListeners.delete(scope);};},()=>draftRecords.get(scope)!);
 const update=(change:Partial<Draft>)=>{draftRecords.set(scope,{...draftRecords.get(scope)!,...change});for(const listener of draftListeners.get(scope)??[])listener();};
 const setter=<K extends keyof Draft>(key:K)=>(value:Draft[K])=>update({[key]:value});
 function observe(library:LibraryValue){const now=draftRecords.get(scope)!;if(!now.instructionsDirty)update({instructions:library.instructions,instructionBase:library.instructions});}
 function acknowledgeInstructions(value:string){const now=draftRecords.get(scope)!;update({instructionBase:value,instructionsDirty:now.instructions!==value});}
 return {...draft,observe,acknowledgeInstructions,replaceInstructions:(expected:string,value:string)=>{if(draftRecords.get(scope)!.instructions===expected)update({instructions:value,instructionBase:value,instructionsDirty:false});},setInstructions:(instructions:string)=>update({instructions,instructionsDirty:true}),setSkillName:setter('skillName'),setSkillText:setter('skillText'),setSkillDescription:setter('skillDescription'),setSkillEnabled:setter('skillEnabled'),setSkillEditing:setter('skillEditing'),setTemplateName:setter('templateName'),setTemplateText:setter('templateText'),
  editTemplate:(name:string,value:string)=>update({templateName:name,templateText:value,templateBase:{name,value}}),
  editSkill:(name:string,value:SkillValue)=>update({skillName:name,skillText:value.markdown,skillDescription:value.description,skillEnabled:value.enabled,skillEditing:true,skillBase:{name,value}}),
  newSkill:()=>update({skillName:'',skillText:'',skillDescription:'',skillEnabled:true,skillEditing:true,skillBase:undefined}),
  acknowledgeTemplate:(name:string,value:string)=>{if(draftRecords.get(scope)!.templateName===name)update({templateBase:{name,value}});},
  acknowledgeSkill:(name:string,value:SkillValue)=>{if(draftRecords.get(scope)!.skillName===name)update({skillBase:{name,value}});},
  acknowledgeArchive:(name:string)=>{if(draftRecords.get(scope)!.skillBase?.name===name)update({skillBase:undefined});},
 };
}
