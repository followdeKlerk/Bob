import AsyncStorage from '@react-native-async-storage/async-storage';

/** Session views may be evicted only when another conversation takes a retained
 * slot. Their admitted draft writes must still precede a later mount's read.
 * Keep the latest in-process text even if disk storage fails; it is not a cache
 * that transcript cleanup or connection settings may discard. */
export class SessionDrafts {
  private tails=new Map<string,Promise<void>>();
  private latest=new Map<string,{value:string;saved:boolean}>();
  async read(scope:string):Promise<{value:string;saved:boolean}>{
    await this.tails.get(scope)?.catch(()=>{});
    const current=this.latest.get(scope);if(current)return current;
    const value=await AsyncStorage.getItem(`draft:${scope}`);
    // A write admitted while storage was reading is newer than that read.
    await this.tails.get(scope)?.catch(()=>{});
    return this.latest.get(scope)??{value:value??'',saved:true};
  }
  write(scope:string,value:string):Promise<void>{
    const entry={value,saved:false};this.latest.set(scope,entry);
    const job=(this.tails.get(scope)??Promise.resolve()).catch(()=>{}).then(async()=>{
      await AsyncStorage.setItem(`draft:${scope}`,value);entry.saved=true;
    });
    this.tails.set(scope,job);
    void job.finally(()=>{if(this.tails.get(scope)===job)this.tails.delete(scope);}).catch(()=>{});
    return job;
  }
}
