import AsyncStorage from '@react-native-async-storage/async-storage';
import {v4 as uuid} from 'uuid';
import {Note,NoteCategory,NoteMutation,NotesDelta,NotesResult,NoteValue,CategoryValue,type NoteRecord,type CategoryRecord,type NotesMutation} from '../../src/notes-contracts';
export type NotesTransport=(path:string,method?:string,body?:unknown)=>Promise<unknown>;
type Cache={backendId:string;version:number;notes:Record<string,NoteRecord>;categories:Record<string,CategoryRecord>;pending:NotesMutation[]};
export class NotesStore{
 private cache:Cache;
 private listeners=new Set<()=>void>();
 private writes:Promise<unknown>=Promise.resolve();
 private flight?:Promise<void>;
 readonly loaded:Promise<void>;
 ready=false;syncing=false;localError=false;error='';
 constructor(readonly backendId:string,private transport:NotesTransport){
  this.cache={backendId,version:0,notes:{},categories:{},pending:[]};
  this.loaded=AsyncStorage.getItem(this.key).then(raw=>{
   if(raw){
    const saved=JSON.parse(raw);
    if(saved.backendId!==backendId)throw Error('Wrong notes cache identity');
    const parsed=NotesDelta.parse({...saved,notes:Object.values(saved.notes),categories:Object.values(saved.categories)});
    this.cache={backendId,version:parsed.version,notes:Object.fromEntries(parsed.notes.map(note=>[note.id,note])),categories:Object.fromEntries(parsed.categories.map(category=>[category.id,category])),pending:saved.pending.map((item:unknown)=>NoteMutation.parse(item))};
   }
   this.ready=true;this.emit();
  }).catch(()=>{this.error='Local notes could not be loaded. Saved data has not been changed.';this.emit();});
 }
 private get key(){return `notes:v1:${this.backendId}`;}
 subscribe(listener:()=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
 private emit(){for(const listener of this.listeners)listener();}
 private persist(){
  this.writes=this.writes.catch(()=>{}).then(async()=>{try{await AsyncStorage.setItem(this.key,JSON.stringify(this.cache));this.localError=false;}catch(error){this.localError=true;throw error;}});
  return this.writes;
 }
 get pendingCount(){return this.cache.pending.length;}
 get notes():NoteRecord[]{
  const result={...this.cache.notes};
  for(const op of this.cache.pending)if(op.kind==='note')result[op.id]={...result[op.id],...op.value,id:op.id,revision:op.baseRevision,updatedAt:op.editedAt,changeSeq:result[op.id]?.changeSeq??0};
  return Object.values(result);
 }
 get categories():CategoryRecord[]{
  const result={...this.cache.categories};
  for(const op of this.cache.pending)if(op.kind==='category')result[op.id]={...result[op.id],...op.value,id:op.id,revision:op.baseRevision,updatedAt:op.editedAt,changeSeq:result[op.id]?.changeSeq??0};
  return Object.values(result);
 }
 isPending(kind:'note'|'category',id:string){return this.cache.pending.some(op=>op.kind===kind&&op.id===id);}
 async saveNote(value:ReturnType<typeof NoteValue.parse>,id=uuid(),baseRevision?:number){
  const parsed=NoteValue.parse(value),current=this.notes.find(note=>note.id===id);
  await this.enqueue({kind:'note',requestId:uuid(),conflictId:uuid(),id,baseRevision:baseRevision??current?.revision??0,editedAt:Date.now(),value:parsed});
  return id;
 }
 async saveCategory(value:ReturnType<typeof CategoryValue.parse>,id=uuid(),baseRevision?:number){
  const parsed=CategoryValue.parse(value),current=this.categories.find(category=>category.id===id);
  await this.enqueue({kind:'category',requestId:uuid(),conflictId:uuid(),id,baseRevision:baseRevision??current?.revision??0,editedAt:Date.now(),value:parsed});return id;
 }
 private async enqueue(operation:NotesMutation){
  await this.loaded;if(!this.ready)throw Error(this.error||'Notes cache is not ready');
  this.cache.pending=[...this.cache.pending,operation];this.emit();
  try{await this.persist();}catch(error){this.error='Could not save notes on this device. Keep the editor open and try again.';this.emit();throw error;}
  void this.sync();
 }
 sync(){
  if(this.flight)return this.flight;
  this.flight=this.synchronize().finally(()=>{this.flight=undefined;});
  return this.flight;
 }
 private async synchronize(){
  this.syncing=true;this.emit();
  try{
   await this.loaded;if(!this.ready)return;
   // Always save the current local queue before making any network request.
   await this.persist();
   const delta=NotesDelta.parse(await this.transport(`notes?since=${this.cache.version}`));
   if(delta.backendId!==this.backendId)throw Error('Notes server identity mismatch');
   for(const note of delta.notes)if((this.cache.notes[note.id]?.revision??0)<=note.revision)this.cache.notes[note.id]=note;
   for(const category of delta.categories)if((this.cache.categories[category.id]?.revision??0)<=category.revision)this.cache.categories[category.id]=category;
   this.cache.version=delta.version;await this.persist();this.emit();
   while(this.cache.pending.length){
    await this.persist();
    const operation=this.cache.pending[0];
    const result=NotesResult.parse(await this.transport('notes/sync','POST',operation));
    if(result.backendId!==this.backendId||result.requestId!==operation.requestId||result.kind!==operation.kind||result.entity.id!==(result.conflict?operation.conflictId:operation.id)||result.appliedRevision>result.entity.revision)throw Error('Notes receipt identity mismatch');
    if(result.kind==='note'){
     const entity=Note.parse(result.entity);
     if((this.cache.notes[entity.id]?.revision??0)<=entity.revision)this.cache.notes[entity.id]=entity;
     if(result.original&&(this.cache.notes[result.original.id]?.revision??0)<=result.original.revision)this.cache.notes[result.original.id]=result.original;
    }else{
     const entity=NoteCategory.parse(result.entity);
     if((this.cache.categories[entity.id]?.revision??0)<=entity.revision)this.cache.categories[entity.id]=entity;
     if(result.original&&(this.cache.categories[result.original.id]?.revision??0)<=result.original.revision)this.cache.categories[result.original.id]=result.original;
    }
    this.cache.pending=this.cache.pending.filter(op=>op.requestId!==operation.requestId).map(op=>{
     if(op.kind===operation.kind&&op.id===operation.id)return {...op,id:result.entity.id,baseRevision:result.appliedRevision};
     if(operation.kind==='category'&&op.kind==='note'&&result.entity.id!==operation.id)return {...op,value:{...op.value,categoryIds:op.value.categoryIds.map(id=>id===operation.id?result.entity.id:id)}};
     return op;
    });
    await this.persist();this.emit();
   }
   this.error='';
  }catch(error){
   const code=(error as {httpStatus?:number}).httpStatus;
   this.error=this.localError?'Could not save notes on this device. Keep the app open and try again.':String((error as Error).message).includes('identity mismatch')?'Notes identity check failed. Local changes have been kept.':code===401||code===403?'Pair this device again to sync notes.':code&&code>=400&&code<500?'Notes sync was rejected. Your local changes are still saved.':this.cache.pending.length?'Offline — changes saved on this device.':'Offline — showing cached notes.';
  }finally{this.syncing=false;this.emit();}
 }
}
