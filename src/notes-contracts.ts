import {z} from 'zod';
export const NoteValue=z.object({title:z.string().max(200),body:z.string().max(100000),categoryIds:z.array(z.string().uuid()).max(20),pinned:z.boolean(),trashed:z.boolean(),color:z.enum(['neutral','sage','sand','blue','rose'])}).strict();
export const CategoryValue=z.object({name:z.string().trim().min(1).max(60),deleted:z.boolean()}).strict();
const identity={id:z.string().uuid(),revision:z.number().int().positive(),updatedAt:z.number().int().nonnegative(),changeSeq:z.number().int().nonnegative(),conflictOf:z.string().uuid().optional()};
export const Note=NoteValue.extend(identity);
export const NoteCategory=CategoryValue.extend(identity);
const mutation={requestId:z.string().uuid(),id:z.string().uuid(),conflictId:z.string().uuid(),baseRevision:z.number().int().nonnegative(),editedAt:z.number().int().nonnegative()};
export const NoteMutation=z.discriminatedUnion('kind',[
 z.object({...mutation,kind:z.literal('note'),value:NoteValue}).strict(),
 z.object({...mutation,kind:z.literal('category'),value:CategoryValue}).strict(),
]);
export const NotesDelta=z.object({backendId:z.string().uuid(),version:z.number().int().nonnegative(),notes:z.array(Note),categories:z.array(NoteCategory)});
const result={backendId:z.string().uuid(),requestId:z.string().uuid(),appliedRevision:z.number().int().positive(),conflict:z.boolean()};
export const NotesResult=z.discriminatedUnion('kind',[
 z.object({...result,kind:z.literal('note'),entity:Note,original:Note.optional()}),
 z.object({...result,kind:z.literal('category'),entity:NoteCategory,original:NoteCategory.optional()}),
]);
export type NoteRecord=z.infer<typeof Note>;
export type CategoryRecord=z.infer<typeof NoteCategory>;
export type NotesMutation=z.infer<typeof NoteMutation>;
export type NotesSyncResult=z.infer<typeof NotesResult>;
