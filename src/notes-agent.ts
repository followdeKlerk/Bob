import {createHash} from 'node:crypto';
import {z} from 'zod';
import {defineDoc,type Conversation,type ConversationId,type JsonObject} from '@earendil-works/pi-durable';
import type {Context} from '@earendil-works/chord/context';
import {Notes,applyNoteMutation} from './notes.js';
import {NoteMutation,NoteValue,type NoteRecord,type CategoryRecord} from './notes-contracts.js';
import {encodeCursor,decodeCursor} from './pagination.js';
import type {State} from './state.js';
import {HttpError} from './errors.js';
const Input=z.object({
 action:z.enum(['list','get','create','update','trash','restore','categories','create_category','update_category','remove_category']),
 id:z.string().uuid().optional(),title:z.string().max(200).optional(),body:z.string().max(100000).optional(),
 categories:z.array(z.string().trim().min(1).max(60)).max(20).optional(),categoryIds:z.array(z.string().uuid()).max(20).optional(),
 category:z.string().trim().min(1).max(60).optional(),name:z.string().trim().min(1).max(60).optional(),
 pinned:z.boolean().optional(),color:NoteValue.shape.color.optional(),expectedRevision:z.number().int().positive().optional(),
 query:z.string().max(200).optional(),includeTrash:z.boolean().optional(),limit:z.number().int().min(1).max(100).optional(),cursor:z.string().max(4096).optional(),
}).strict();
/** Task-scoped receipts make chat writes replay-safe without changing the existing notebook schema. */
export const NotesToolReceipts=defineDoc<{receipts:Record<string,{fingerprint:string;result:JsonObject}>}>({kind:'bob.notes-tool-receipts',version:1,scope:'conversation',history:'latest',fork:'initial',initial:()=>({receipts:{}}),checkpointWhen:()=>true});
function stableId(seed:string){const hex=createHash('sha256').update(seed).digest('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;}
const summary=(note:NoteRecord,categories:CategoryRecord[])=>({id:note.id,title:note.title,preview:note.body.slice(0,240),revision:note.revision,categoryIds:note.categoryIds,categories:note.categoryIds.map(id=>categories.find(category=>category.id===id&&!category.deleted)?.name).filter((name):name is string=>name!==undefined),pinned:note.pinned,trashed:note.trashed,color:note.color,updatedAt:note.updatedAt,...(note.conflictOf?{conflictOf:note.conflictOf}:{})});
export async function notesOperation(state:State,library:Conversation,source:ConversationId,taskId:string,input:unknown,context:Context):Promise<unknown>{
 const p=Input.parse(input),taskKey=`agent:${source}:${taskId}`;
 const fingerprint=createHash('sha256').update(JSON.stringify(p)).digest('hex');
 const idFor=(purpose:string)=>stableId(`${state.id}:${taskKey}:${purpose}`);
 return library.commit(async tx=>{
  const book=await tx.doc(Notes,library.id);
  const labels=()=>Object.values(book.categories);
  if(p.action==='list'||p.action==='categories'){
   const resource='notes-tool:'+createHash('sha256').update(JSON.stringify({action:p.action,query:p.query??'',category:p.category??'',includeTrash:p.includeTrash??false,pinned:p.pinned})).digest('hex');
   const cursor=decodeCursor(state,resource,p.cursor);
   const offset=cursor?z.number().int().nonnegative().parse(cursor.offset):0;
   if(cursor&&cursor.version!==book.version)throw new HttpError(409,'Notes changed during this listing. Restart without a cursor.');
   const query=(p.query??'').toLocaleLowerCase();
   const matchingCategories=labels().filter(category=>!category.deleted&&category.name.toLocaleLowerCase()===(p.category??'').toLocaleLowerCase()).map(category=>category.id);
   const rows=p.action==='categories'?labels().filter(category=>(p.includeTrash||!category.deleted)&&category.name.toLocaleLowerCase().includes(query)).sort((a,b)=>a.id.localeCompare(b.id)):
    Object.values(book.notes).filter(note=>(p.includeTrash||!note.trashed)&&(!p.category||note.categoryIds.some(id=>matchingCategories.includes(id)))&&(p.pinned===undefined||note.pinned===p.pinned)&&`${note.title}\n${note.body}`.toLocaleLowerCase().includes(query)).sort((a,b)=>a.id.localeCompare(b.id)).map(note=>summary(note,labels()));
   const end=Math.min(rows.length,offset+(p.limit??30));
   return JSON.parse(JSON.stringify({backendId:state.id,items:rows.slice(offset,end),total:rows.length,next:end<rows.length?encodeCursor(state,resource,{offset:end,version:book.version}):undefined,readOnly:true}));
  }
  if(p.action==='get'){
   const note=p.id?book.notes[p.id]:undefined;if(!note)throw new HttpError(404,'Note not found. Use list to find its ID.');
   return JSON.parse(JSON.stringify({backendId:state.id,note:{...note,categories:summary(note,labels()).categories},readOnly:true}));
  }
  const receipts=await tx.doc(NotesToolReceipts,library.id),previous=receipts.receipts[taskKey];
  if(previous){if(previous.fingerprint!==fingerprint)throw new HttpError(409,'Notes tool operation identity conflict');return JSON.parse(JSON.stringify(previous.result));}
  const categoryAction=['create_category','update_category','remove_category'].includes(p.action);
  if(p.categories&&p.categoryIds)throw new HttpError(400,'Choose categories by name or by ID, not both.');
  if((p.action==='trash'||p.action==='restore')&&[p.title,p.body,p.categories,p.categoryIds,p.pinned,p.color].some(value=>value!==undefined))throw new HttpError(400,'Trash and restore only change the trash flag. Use update for other edits.');
  const current=categoryAction?(p.id?book.categories[p.id]:undefined):(p.id?book.notes[p.id]:undefined);
  const create=p.action==='create'||p.action==='create_category';
  if(create&&p.id)throw new HttpError(400,'Do not supply an ID when creating a new note or category.');
  if(!create&&!current)throw new HttpError(404,'Note or category not found. List notes/categories before editing.');
  if(!create&&p.expectedRevision===undefined)throw new HttpError(400,'expectedRevision is required. Read the current note/category before changing it.');
  const mutate=(kind:'note'|'category',id:string,baseRevision:number,value:unknown,purpose:string)=>applyNoteMutation(book,state.id,`agent:${source}`,NoteMutation.parse({kind,id,baseRevision,value,requestId:idFor('request:'+purpose),conflictId:idFor('conflict:'+purpose),editedAt:0}));
  let result:JsonObject;
  if(categoryAction){
   if(p.action!=='remove_category'&&!p.name)throw new HttpError(400,'Category name is required.');
   const duplicate=labels().find(category=>!category.deleted&&category.id!==p.id&&category.name.toLocaleLowerCase()===p.name?.toLocaleLowerCase());
   if(duplicate&&p.action==='create_category')result={backendId:state.id,persisted:true,created:false,category:JSON.parse(JSON.stringify(duplicate))};
   else{
    if(duplicate)throw new HttpError(409,'Another active category already has that name. Use its ID or choose another name.');
    const updated=mutate('category',create?idFor('entity'):p.id!,create?0:p.expectedRevision!,{name:p.name??(current as CategoryRecord).name,deleted:p.action==='remove_category'},'main');
    result={backendId:state.id,persisted:true,conflict:updated.conflict,category:updated.entity,...(updated.original?{original:updated.original}:{})};
   }
  }else{
   let categoryIds=p.categoryIds;
   if(p.categories){
    categoryIds=[];
    for(const name of [...new Set(p.categories.map(name=>name.toLocaleLowerCase()))]){
     const candidates=labels().filter(category=>!category.deleted&&category.name.toLocaleLowerCase()===name);
     if(candidates.length>1)throw new HttpError(409,`Category name is ambiguous: ${name}. List categories and use categoryIds.`);
     const category=candidates[0]??mutate('category',idFor('category:'+name),0,{name:p.categories.find(value=>value.toLocaleLowerCase()===name)!,deleted:false},'category:'+name).entity;
     categoryIds.push(category.id);
    }
   }
   if(categoryIds?.some(id=>!book.categories[id]||book.categories[id].deleted))throw new HttpError(400,'Unknown or removed category ID. List categories first.');
   const note=current as NoteRecord|undefined;
   const value=NoteValue.parse({title:p.title??note?.title??'',body:p.body??note?.body??'',categoryIds:categoryIds??note?.categoryIds??[],pinned:p.pinned??note?.pinned??false,color:p.color??note?.color??'neutral',trashed:p.action==='trash'?true:p.action==='restore'?false:note?.trashed??false});
   if(!value.title.trim()&&!value.body.trim())throw new HttpError(400,'A note needs a title or body.');
   const updated=mutate('note',create?idFor('entity'):p.id!,create?0:p.expectedRevision!,value,'main');
   result={backendId:state.id,persisted:true,conflict:updated.conflict,note:summary(updated.entity as NoteRecord,labels()),...(updated.original?{original:summary(updated.original as NoteRecord,labels())}:{}),...(updated.conflict?{message:'A concurrent edit was preserved in a separate conflict copy. Do not overwrite the original to resolve this without asking the user.'}:{})};
  }
  // Snapshot inside the transaction: native draft overlays cannot escape commit.
  const plain=JSON.parse(JSON.stringify(result));receipts.receipts[taskKey]={fingerprint,result:plain};return plain;
 },context);
}
