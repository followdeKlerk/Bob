import React,{useState} from 'react';
import {MotionSurface} from './motion-surface';

/** Process-local presentation only: never derives eligibility from stored history
 * or retries, and never changes message IDs/admission. Owned by the retained pane. */
export class MessageEntrances {
 private pending=new Set<string>();
 arm(id:string){this.pending.add(id);if(this.pending.size>128)this.pending.delete(this.pending.values().next().value!);}
 claim(id:string|undefined){if(!id||!this.pending.has(id))return false;this.pending.delete(id);return true;}
}
/** Claim once, including virtualized remounts and local-to-server reconciliation.
 * A discarded concurrent render may skip this decoration; it cannot replay it or
 * affect delivery. The shared motion policy still owns all accessibility gates. */
export function MessageEntrance({registry,id,children}:{registry:MessageEntrances;id?:string;children:React.ReactNode}){
 const [enter]=useState(()=>registry.claim(id));
 return <MotionSurface active={enter} distance={5}>{children}</MotionSurface>;
}
