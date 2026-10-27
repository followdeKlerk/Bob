import {createHash} from 'node:crypto';
import {defineDoc,type Conversation} from '@earendil-works/pi-durable';
import {NoteMutation,type NoteRecord,type CategoryRecord,type NotesSyncResult,type NotesMutation} from './notes-contracts.js';
import {ctx} from './runtime.js';
import {HttpError} from './errors.js';
type Receipt={fingerprint:string;kind:'note'|'category';id:string;revision:number;conflict:boolean;sourceId:string;deviceId:string};
export type Notebook={version:number;notes:Record<string,NoteRecord>;categories:Record<string,CategoryRecord>;receipts:Record<string,Receipt>};
/** Additive native document on the existing backend library conversation.
 * No changes to existing document versions, task schemas, or SQLite tables. */
export const Notes=defineDoc<Notebook>({kind:'bob.notes',version:1,scope:'conversation',history:'latest',fork:'initial',initial:()=>({version:0,notes:{},categories:{},receipts:{}}),checkpointWhen:()=>true});
export async function readNotes(library:Conversation,backendId:string,since:number){
 return library.commit(async tx=>{
  const book=await tx.doc(Notes,library.id);
  return JSON.parse(JSON.stringify({backendId,version:book.version,notes:Object.values(book.notes).filter(note=>note.changeSeq>since),categories:Object.values(book.categories).filter(category=>category.changeSeq>since)}));
 },ctx);
}
export async function syncNote(library:Conversation,backendId:string,deviceId:string,input:unknown):Promise<NotesSyncResult>{
 const operation=NoteMutation.parse(input);
 return library.commit(async tx=>applyNoteMutation(await tx.doc(Notes,library.id),backendId,deviceId,operation),ctx);
}
/** Shared mutation logic; caller must hold an official native transaction. */
export function applyNoteMutation(book:Notebook,backendId:string,deviceId:string,operation:NotesMutation):NotesSyncResult{
 const fingerprint=createHash('sha256').update(JSON.stringify(operation)).digest('hex');
  const key=deviceId+':'+operation.requestId;
  const previous=book.receipts[key];
  if(previous&&(previous.kind!==operation.kind||previous.sourceId!==operation.id||previous.fingerprint!==fingerprint))throw new HttpError(409,'Note operation identity conflict');
  const collection=operation.kind==='note'?book.notes:book.categories;
  let receipt=previous;
  if(!receipt){
   const current=collection[operation.id];
   const conflict=(current?.revision??0)!==operation.baseRevision;
   const id=conflict?operation.conflictId:operation.id;
   if(conflict&&collection[id])throw new HttpError(409,'Conflict copy identity is already in use');
   const revision=conflict?1:(current?.revision??0)+1;
   const entity={...operation.value,id,revision,updatedAt:Date.now(),changeSeq:++book.version,
    ...(conflict?{conflictOf:operation.id}:current?.conflictOf?{conflictOf:current.conflictOf}:{})};
   if(operation.kind==='note'){
    book.notes[id]={...entity,...operation.value,...(conflict?{title:(operation.value.title||'Untitled').slice(0,180)+' (conflict copy)'}:{})} as NoteRecord;
   }else{
    book.categories[id]={...entity,...operation.value,...(conflict?{name:operation.value.name.slice(0,45)+' (conflict copy)'}:{})} as CategoryRecord;
   }
   receipt={fingerprint,kind:operation.kind,id,revision,conflict,sourceId:operation.id,deviceId};
   book.receipts[key]=receipt;
  }
  const entity=collection[receipt.id];
  const original=receipt.conflict?collection[receipt.sourceId]:undefined;
  return JSON.parse(JSON.stringify({backendId,requestId:operation.requestId,kind:operation.kind,entity,appliedRevision:receipt.revision,conflict:receipt.conflict,...(original?{original}:{})})) as NotesSyncResult;
}
