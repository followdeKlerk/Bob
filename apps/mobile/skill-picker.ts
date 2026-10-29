export type PickerSkill={name:string;description:string;enabled:boolean};
export type PickerEntry=PickerSkill&{kind:'skill'|'command'};
/** A slash command at the start of a draft, not a URL/path or slash in prose. */
export function skillQuery(draft:string):string|null{
 const match=/^\/([a-zA-Z0-9-]*)$/.exec(draft);
 return match?match[1].toLowerCase():null;
}
export function pickerSkills(library:unknown):PickerSkill[]{
 if(!library||typeof library!=='object'||!('skills' in library))throw Error('Invalid skill library response');
 const skills=(library as {skills:unknown}).skills;
 if(!skills||typeof skills!=='object'||Array.isArray(skills))throw Error('Invalid skill library response');
 return Object.entries(skills).flatMap(([name,value])=>{
  if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)||!value||typeof value!=='object')return [];
  const item=value as {description?:unknown;enabled?:unknown};
  return typeof item.description==='string'&&typeof item.enabled==='boolean'?[{name,description:item.description,enabled:item.enabled}]:[];
 }).sort((a,b)=>a.name.localeCompare(b.name));
}
/** Only commands advertised by this backend are shown; legacy backends keep skills alone. */
export function pickerEntries(library:unknown):PickerEntry[]{
 const skills=pickerSkills(library);
 const raw=(library as {commands?:unknown}).commands;
 if(raw!==undefined&&!Array.isArray(raw))throw Error('Invalid command menu response');
 const commands:PickerEntry[]=[],names=new Set<string>();
 for(const item of ((raw as unknown[]|undefined)??[]).slice(0,100)){
  if(!item||typeof item!=='object')continue;
  const {name,description}=item as {name?:unknown;description?:unknown};
  if(typeof name!=='string'||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)||typeof description!=='string'||description.length>500||names.has(name))continue;
  names.add(name);commands.push({kind:'command',name,description,enabled:true});
 }
 // Native commands own their slash spelling; never show an ambiguous duplicate.
 return [...commands,...skills.filter(skill=>!names.has(skill.name)).map(skill=>({...skill,kind:'skill' as const}))].sort((a,b)=>a.name.localeCompare(b.name));
}
export function filterSkills<T extends PickerSkill>(skills:T[],query:string):T[]{
 const needle=query.toLowerCase();
 return skills.filter(skill=>skill.name.includes(needle)||skill.description.toLowerCase().includes(needle));
}
/** A visible, editable request. Selecting never submits or enables anything. */
export function skillRequest(name:string):string{return `Use the skill "${name}". `;}
export function pickerRequest(entry:PickerEntry):string{
 // The space lets owners add arguments and prevents immediately reopening suggestions.
 return entry.kind==='command'?`/${entry.name} `:skillRequest(entry.name);
}
