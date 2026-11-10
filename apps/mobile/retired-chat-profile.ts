import {useEffect,useRef} from 'react';
import {useScopedSnapshot} from './use-scoped-snapshot';

// Legacy wire identifier: retained only to recognize stored history, never a route.
const REMOVED_LOCAL_PROFILE='restricted-local';
export type ChatProfile={id:string;label?:string;restricted?:boolean;immutable?:boolean;configured?:boolean;retired?:boolean;readOnly?:boolean};
export type ProfileRecord={profile?:ChatProfile};
export const LOCAL_CHAT_REMOVED='This local-model integration was removed. History is read-only. Start a new Bob conversation.';
const UNKNOWN_PROFILE='This conversation’s profile is unavailable or unsupported. History is read-only. Start a new Bob conversation.';

/** Absence is the ordinary Bob profile. Unknown/malformed profiles never gain
 * normal-agent capabilities, even if old cached metadata says configured:true. */
export function readOnlyProfile(profile:unknown):boolean {
 if(profile===undefined)return false;
 if(!profile||typeof profile!=='object')return true;
 const value=profile as ChatProfile;
 return value.id!=='normal'||value.retired===true||value.readOnly===true||value.restricted===true||value.immutable===true;
}
export function conversationReadOnlyMessage(profile:unknown):string {
 return (profile as ChatProfile|undefined)?.id===REMOVED_LOCAL_PROFILE?LOCAL_CHAT_REMOVED:UNKNOWN_PROFILE;
}
/** Restrictive evidence wins over older ordinary metadata from another source. */
export function conversationProfileRecord(...records:(ProfileRecord|undefined)[]):ProfileRecord|undefined {
 return records.find(record=>record&&readOnlyProfile(record.profile))??records.find(record=>record!==undefined);
}

/** Notification targets may not be in the loaded Sessions page. While their
 * metadata loads (or fails), no composer/configuration controls are enabled.
 * A read-only marker cannot be erased by an incomplete refresh in this scope. */
export function useConversationProfile(scope:string,known:ProfileRecord|undefined,load:()=>Promise<ProfileRecord>){
 const [read,setRead]=useScopedSnapshot<ProfileRecord&{error?:string}>(scope);
 const retired=useRef<{scope:string;record?:ProfileRecord}>({scope});
 if(retired.current.scope!==scope)retired.current={scope};
 const result=conversationProfileRecord(known,read);
 if(result&&readOnlyProfile(result.profile))retired.current.record=result;
 useEffect(()=>{
  if(!scope||known)return;
  let active=true;
  void load().then(value=>{
   if(active){
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid conversation metadata');
    setRead({profile:value.profile});
   }
  }).catch(()=>{if(active)setRead({error:'Conversation capabilities unavailable. History is read-only until metadata can be restored.'});});
  return()=>{active=false;};
 },[scope,!!known]);
 const resolved=retired.current.record??result;
 return {profile:resolved?.profile,known:!!retired.current.record||!!known||!!read&&!read.error,error:known?undefined:read?.error};
}
