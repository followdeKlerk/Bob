// Numbers only. No snapshot retention, serialization, message IDs or backend identity.
let updates=0,lastChars=0,maxChars=0,maxCallbackMs=0,loadedEntries=0;
const bounded=(value:number,max:number)=>Number.isFinite(value)?Math.max(0,Math.min(max,Math.floor(value))):0;
export function noteSnapshot(chars:number,callbackMs:number){
 updates=Math.min(updates+1,1000000);lastChars=bounded(chars,100000000);maxChars=Math.max(maxChars,lastChars);
 maxCallbackMs=Math.max(maxCallbackMs,bounded(callbackMs,600000));
}
export function noteLoadedEntries(count:number){loadedEntries=bounded(count,1000000);}
export function takeStreamDiagnostics(){
 const data={updates,lastChars,maxChars,maxCallbackMs,loadedEntries};
 updates=0;maxChars=lastChars;maxCallbackMs=0;
 return data;
}
