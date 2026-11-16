/** Small, memory-only read reuse. Never cache conversation configuration,
 * credentials, writes, Tools admission evidence or Terminal capabilities.
 * Scope includes backend ID, endpoint and pairing/connection revision. */
export type MenuRead = 'library' | 'models';
type Entry = {value?:unknown; expires:number; pending?:Promise<any>};
export class MenuReadCache {
 private entries=new Map<string,Entry>();
 private mutations=new Map<string,number>();
 constructor(private now=Date.now,private capacity=8){}
 private key(scope:string,resource:MenuRead){return JSON.stringify([scope,resource]);}
 peek<T=any>(scope:string,resource:MenuRead):T|undefined {
  const key=this.key(scope,resource),entry=this.entries.get(key);
  if(!entry||entry.expires<=this.now()||this.mutations.has(key))return undefined;
  return entry.value as T|undefined;
 }
 invalidate(scope:string,resource:MenuRead){this.entries.delete(this.key(scope,resource));}
 /** Invalidate at admission AND settlement, including uncertain failed writes.
  * A read racing a write is neither reusable nor accepted into the cache. */
 beginMutation(scope:string,resource:MenuRead){
  const key=this.key(scope,resource);this.entries.delete(key);
  this.mutations.set(key,(this.mutations.get(key)??0)+1);
  return ()=>{this.entries.delete(key);const count=(this.mutations.get(key)??1)-1;if(count)this.mutations.set(key,count);else this.mutations.delete(key);};
 }
 read<T=any>(scope:string,resource:MenuRead,load:()=>Promise<T>):Promise<T>{
  const key=this.key(scope,resource);
  if(this.mutations.has(key))return load();
  const previous=this.entries.get(key);
  if(previous?.pending)return previous.pending;
  if(previous&&previous.expires>this.now())return Promise.resolve(previous.value as T);
  const entry:Entry={expires:0};
  const pending=Promise.resolve().then(load).then(value=>{
   if(this.entries.get(key)===entry){entry.value=value;entry.expires=this.now()+(resource==='library'?30000:60000);entry.pending=undefined;}
   return value;
  },error=>{if(this.entries.get(key)===entry)this.entries.delete(key);throw error;});
  entry.pending=pending;this.entries.delete(key);this.entries.set(key,entry);
  while(this.entries.size>this.capacity)this.entries.delete(this.entries.keys().next().value!);
  return pending;
 }
}
