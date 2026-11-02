export type SettingsValues={instructions:string|null;cwd:string};
type Field=keyof SettingsValues;
type Draft=Partial<Record<Field,{value:string;revision:number}>>;
type Capture=Partial<Record<Field,number>>;
/** In-memory edits are scoped to backend + conversation, never replaced by a menu reload. */
export class ConversationSettingsDrafts {
 private drafts=new Map<string,Draft>();
 private revision=0;
 edit(scope:string,field:Field,value:string){if(scope)this.drafts.set(scope,{...this.drafts.get(scope),[field]:{value,revision:++this.revision}});}
 capture(scope:string):Capture{return Object.fromEntries(Object.entries(this.drafts.get(scope)??{}).map(([field,draft])=>[field,draft.revision]));}
 view(scope:string,saved:SettingsValues):SettingsValues{
  const draft=this.drafts.get(scope);
  return {instructions:draft?.instructions?.value??saved.instructions,cwd:draft?.cwd?.value??saved.cwd};
 }
 acknowledge(scope:string,field:Field,submitted:Capture){
  const current=this.drafts.get(scope);if(!current?.[field]||current[field].revision!==submitted[field])return;
  const next={...current};delete next[field];
  if(Object.keys(next).length)this.drafts.set(scope,next);else this.drafts.delete(scope);
 }
}
