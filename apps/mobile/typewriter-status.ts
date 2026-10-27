/** Three-second stepped typing/hold/deleting cycle, a quicker version of the reference.
 * At most 32 steps per direction; the UI only wakes at a character/blink boundary. */
export function typewriterFrame(elapsed:number,length:number){
 const time=Math.max(0,elapsed),phase=time%3000,steps=Math.max(1,Math.min(32,length));
 let count=0,next=3000;
 if(phase<180)next=180;
 else if(phase<1540){const step=Math.floor((phase-180)*steps/1360);count=Math.floor(length*step/steps);next=180+(step+1)*1360/steps;}
 else if(phase<2440){count=length;next=2440;}
 else if(phase<2860){const step=Math.floor((phase-2440)*steps/420);count=length-Math.ceil(length*step/steps);next=2440+(step+1)*420/steps;}
 return {count,cursor:time%650<325,delay:Math.max(16,Math.ceil(Math.min(next-phase,325-time%325)))};
}

/** Decorative punctuation only; keep the original label for accessibility. */
export function statusDisplayLabel(text:string){
 const base=text.trimEnd().replace(/(?:\s*[.…])+$/u,'').trimEnd();
 return base?`${base} . . .`:'';
}
