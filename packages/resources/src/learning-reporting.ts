/** Persisted mutation facts, not model-authored claims of success. */
export type SkillMutationNotice={name:string;action:string;revision:number;file_path?:string};
export type LearningChanges={skills:string[];memory:string[];proposals:string[];skillChanges?:SkillMutationNotice[]};

export function skillMutationText(change:SkillMutationNotice):string {
 return `Skill '${change.name}' ${change.action}${change.file_path&&change.file_path!=='SKILL.md'?` (${change.file_path})`:''}`;
}
/** Bound display text at action boundaries; full structured receipts stay available. */
export function skillMutationSummary(changes:readonly SkillMutationNotice[],maxBytes=16000):string {
 const parts:string[]=[];let length=0;
 for(const change of changes){const part=skillMutationText(change),bytes=Buffer.byteLength(part);if(length+bytes+4>maxBytes-80)break;parts.push(part);length+=bytes+4;}
 if(parts.length<changes.length)parts.push(`… ${changes.length-parts.length} additional saved skill changes`);
 return parts.join(' · ');
}
