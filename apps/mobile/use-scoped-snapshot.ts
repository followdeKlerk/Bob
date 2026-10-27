import {useRef,useState} from 'react';
type Update<T>=T|undefined|((previous:T|undefined)=>T|undefined);
/** Hide the previous conversation synchronously, before passive effects clear it.
 * Late responses from an old scope cannot replace the newly selected snapshot.
 */
export function useScopedSnapshot<T>(scope:string){
 const selected=useRef(scope);selected.current=scope;
 const [record,setRecord]=useState<{scope:string;value:T}>();
 const value=record?.scope===scope?record.value:undefined;
 const set=(update:Update<T>)=>setRecord(previous=>{
  if(selected.current!==scope)return previous;
  const current=previous?.scope===scope?previous.value:undefined;
  const next=typeof update==='function'?(update as (value:T|undefined)=>T|undefined)(current):update;
  if(next===current&&previous?.scope===scope)return previous;
  return next===undefined?undefined:{scope,value:next};
 });
 return [value,set] as const;
}
