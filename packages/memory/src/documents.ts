import {defineDoc,defineDocFamily} from '@earendil-works/pi-durable';
export type Preferences={autoRecall:boolean;autoRetain:boolean};
export const MemoryPreferences=defineDoc<Preferences>({kind:'bob.memory.preferences',version:1,scope:'conversation',history:'latest',fork:'current',initial:()=>({autoRecall:true,autoRetain:true}),checkpointWhen:()=>true});
/** Activation boundary prevents an implicit historical transcript export on installation. */
export const MemoryInstallation=defineDoc<{floor:number;backendId:string;provisioned:boolean}>({kind:'bob.memory.installation',version:1,scope:'session',initial:()=>({floor:0,backendId:'',provisioned:false}),checkpointWhen:()=>true});
export type SaveReceipt={operationId:string;bank:string;documentId:string;taskId:number;status:'queued'|'accepted'|'completed'|'failed'|'cancelled';attempts:number;error?:string;updatedAt:number;retryUnknown?:boolean;processingWarning?:string};
export const MemorySaves=defineDocFamily<SaveReceipt,null>({kind:'bob.memory.saves',version:1,scope:'conversation',history:'latest',fork:'initial',family:true,initial:()=>({operationId:'',bank:'',documentId:'',taskId:0,status:'queued',attempts:0,updatedAt:0}),checkpointWhen:()=>true});
export const MemoryActivity=defineDoc<{lastRecall?:{at:number;count:number;unavailable:string[]};recentSaves:string[];captureError?:string}>({kind:'bob.memory.activity',version:1,scope:'conversation',history:'latest',fork:'initial',initial:()=>({recentSaves:[]}),checkpointWhen:()=>true});
/** Snapshot consent at generation time: later re-enabling cannot export a turn made while saving was off. */
export const MemoryTurnPolicy=defineDocFamily<{autoRetain:boolean},boolean>({kind:'bob.memory.turn-policy',version:1,scope:'conversation',history:'latest',fork:'initial',family:true,initial:autoRetain=>({autoRetain}),checkpointWhen:()=>true});
