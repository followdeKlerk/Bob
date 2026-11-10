export type MediaPhase='connecting'|'loading'|'playing'|'paused'|'seeking'|'buffering'|'ended';
export type MediaState={phase:MediaPhase;positionMs:number;durationMs:number;paused:boolean;receivedBytes:number;videoReady:boolean};
export type MediaProgress={sessionId:string;positionMs:number;durationMs:number;paused:boolean;buffering:boolean;phase?:MediaPhase;receivedBytes?:number;videoReady?:boolean;message?:string};
const phases:readonly string[]=['connecting','loading','playing','paused','seeking','buffering','ended'];
export const initialMediaState=(positionMs=0,paused=false):MediaState=>({phase:'connecting',positionMs,durationMs:0,paused,receivedBytes:0,videoReady:false});
export const mediaBusy=(phase:MediaPhase)=>['connecting','loading','seeking','buffering'].includes(phase);
export function mediaStateFromProgress(data:MediaProgress,previous:MediaState):MediaState|undefined {
 if(!Number.isFinite(data.positionMs)||data.positionMs<0||data.positionMs>2147483647||typeof data.paused!=='boolean')return;
 const duration=Number.isFinite(data.durationMs)&&data.durationMs>=0&&data.durationMs<=2147483647?Math.floor(data.durationMs):previous.durationMs;
 const phase=phases.includes(data.phase??'')?data.phase!:data.buffering?'buffering':data.paused?'paused':'playing';
 const received=Number.isSafeInteger(data.receivedBytes)&&data.receivedBytes!>=0?Math.max(previous.receivedBytes,data.receivedBytes!):previous.receivedBytes;
 return {phase,positionMs:Math.floor(data.positionMs),durationMs:duration,paused:data.paused,receivedBytes:received,videoReady:typeof data.videoReady==='boolean'?data.videoReady:previous.videoReady};
}
export function mediaTime(milliseconds:number):string {
 const seconds=Math.floor(Math.max(0,milliseconds)/1000);
 return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
}
export function mediaBytes(bytes:number):string {
 if(!Number.isFinite(bytes)||bytes<0)return 'Size unknown';
 if(bytes<1024)return `${Math.floor(bytes)} ${bytes===1?'byte':'bytes'}`;
 if(bytes<1024*1024)return `${Math.ceil(bytes/1024)} KB`;
 return `${(bytes/1024/1024).toFixed(1)} MB`;
}
export function mediaStatus(phase:MediaPhase,video:boolean):string {
 switch(phase){
 case 'connecting':return 'Connecting…';
 case 'loading':return `Loading ${video?'video':'audio'}…`;
 case 'seeking':return 'Seeking…';
 case 'buffering':return 'Buffering…';
 case 'playing':return 'Playing';
 case 'paused':return 'Paused';
 case 'ended':return 'Finished';
 }
}
