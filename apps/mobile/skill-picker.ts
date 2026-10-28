export type PickerSkill={name:string;description:string;enabled:boolean};
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
export function filterSkills(skills:PickerSkill[],query:string):PickerSkill[]{
 const needle=query.toLowerCase();
 return skills.filter(skill=>skill.name.includes(needle)||skill.description.toLowerCase().includes(needle));
}
/** A visible, editable request. Selecting never submits or enables anything. */
export function skillRequest(name:string):string{return `Use the skill "${name}". `;}
