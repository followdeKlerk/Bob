import {defineDoc,type ConversationId,type Tx} from '@earendil-works/pi-durable';
import type {LearningChanges,SkillMutationNotice} from './learning-reporting.js';
/** Set by the host when creating a review child. Never inferred from model text. */
export const LearningWorker=defineDoc<{background?:boolean;reviewMemory?:boolean;sourceId?:number;explicit?:boolean;curator?:boolean;candidateNames?:string[];changes?:LearningChanges}>({kind:'bob.learning-worker',version:1,scope:'conversation',history:'latest',fork:'initial',initial:()=>({}),checkpointWhen:()=>true});
export async function recordLearningChange(tx:Tx,conversationId:ConversationId,kind:'skills'|'memory'|'proposals',name:string,skillChange?:SkillMutationNotice){
 const worker=await tx.doc(LearningWorker,conversationId);if(!worker.background)return;
 worker.changes??={skills:[],memory:[],proposals:[]};if(!worker.changes[kind].includes(name))worker.changes[kind].push(name);
 if(skillChange){worker.changes.skillChanges??=[];if(!worker.changes.skillChanges.some(c=>c.name===skillChange.name&&c.revision===skillChange.revision))worker.changes.skillChanges.push(skillChange);}
}
export type StoredSkill={description:string;markdown:string;enabled:boolean};
export type SkillPackage={skill:StoredSkill;files:Record<string,string>;archived:boolean;stale?:boolean;absorbedInto?:string;pinned:boolean;autoLoad:boolean;category?:string;tags:string[];version?:string;author?:string;platforms:string[]};
export type SkillChange={revision:number;at:number;action:string;actor:'foreground'|'background'|'curator';before?:SkillPackage;afterDigest:string};
export type SkillRecord={revision:number;digest:string;files:Record<string,string>;createdAt:number;updatedAt:number;lastUsedAt?:number;lastPatchedAt?:number;uses:number;createdBy:'foreground'|'background'|'legacy';managed:boolean;archived:boolean;stale:boolean;pinned:boolean;autoLoad:boolean;category?:string;tags:string[];version?:string;author?:string;platforms:string[];absorbedInto?:string;ledger:SkillChange[]};
/** Additive sidecar: bob.library v1 remains unchanged and is still the body authority. */
export const SkillMetadata=defineDoc<{skills:Record<string,SkillRecord>;lastActivityAt?:number;lastCuratedAt?:number}>({kind:'bob.skill-metadata',version:1,scope:'conversation',history:'rewindable',fork:'current',initial:()=>({skills:{}}),checkpointWhen:()=>true});
/** Exact native file read receipts, isolated to each review fork. */
export const SkillReads=defineDoc<{files:Record<string,{revision:number;digest:string}>}>({kind:'bob.skill-reads',version:1,scope:'conversation',history:'latest',fork:'initial',initial:()=>({files:{}}),checkpointWhen:()=>true});
export type CuratedMemoryTarget={entries:string[];revision:number};
export const CuratedMemory=defineDoc<{user:CuratedMemoryTarget;memory:CuratedMemoryTarget}>({kind:'bob.curated-memory',version:1,scope:'conversation',history:'rewindable',fork:'current',initial:()=>({user:{entries:[],revision:0},memory:{entries:[],revision:0}}),checkpointWhen:()=>true});
export const MemoryReads=defineDoc<{user?:number;memory?:number}>({kind:'bob.curated-memory-reads',version:1,scope:'conversation',history:'latest',fork:'initial',initial:()=>({}),checkpointWhen:()=>true});
export type MemoryOperation={action:'add'|'patch'|'remove';content?:string;new_text?:string;old_text?:string;matched_entry?:string};
export type MemoryProposal={id:string;target:'user'|'memory';operations:MemoryOperation[];batch?:boolean;sourceId:number;conversationId:number;createdAt:number;status:'pending'|'approved'|'rejected';resolvedAt?:number};
/** Native equivalent of Hermes's pending memory writes; never put into the model system prompt. */
export const MemoryProposals=defineDoc<{items:Record<string,MemoryProposal>}>({kind:'bob.memory-proposals',version:1,scope:'conversation',history:'latest',fork:'initial',initial:()=>({items:{}}),checkpointWhen:()=>true});
