/** Three-second stepped typing/hold/return cycle. The optional retained prefix
 * is typed once, then stays visible while only the suffix cycles.
 * At most 32 steps per direction; the UI only wakes at a character/blink boundary. */
export function typewriterFrame(elapsed:number,length:number,retainedLength=0){
 const time=Math.max(0,elapsed),phase=time%3000,steps=Math.max(1,Math.min(32,length));
 const retained=Math.max(0,Math.min(length,retainedLength)),eraseLength=length-retained;
 const eraseSteps=retained>0?Math.max(1,Math.min(3,eraseLength)):steps;
 const prefix=time>=3000?retained:0,typingLength=length-prefix;
 const typingSteps=prefix>0?Math.max(1,Math.min(3,typingLength)):steps;
 let count=prefix,next=3000;
 if(phase<180)next=180;
 else if(phase<1540){const step=Math.floor((phase-180)*typingSteps/1360);count=prefix+Math.floor(typingLength*step/typingSteps);next=180+(step+1)*1360/typingSteps;}
 else if(phase<2440){count=length;next=2440;}
 else if(phase<2860){const step=Math.floor((phase-2440)*eraseSteps/420);count=length-Math.ceil(eraseLength*step/eraseSteps);next=2440+(step+1)*420/eraseSteps;}
 else count=retained;
 return {count,cursor:time%650<325,delay:Math.max(16,Math.ceil(Math.min(next-phase,325-time%325)))};
}

/** Decorative punctuation only; keep the original label for accessibility. */
export function statusDisplayLabel(text:string){
 const base=text.trimEnd().replace(/(?:\s*[.…])+$/u,'').trimEnd();
 return base?`${base} . . .`:'';
}
