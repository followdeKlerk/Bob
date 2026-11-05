export type MascotActivity='idle'|'working'|'attention';
export type MascotSignals={activity:MascotActivity;answerId:number;runKey?:string};
type Entry={id:number;kind?:string;model?:readonly unknown[]};
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
/** Presentation only: no idle-to-success inference, provider text, or changes to send/stop state. */
export function mascotSignals({live,entries=[],busy=false,activeAgents=0,sending=false,status='',storageError=false}:{live:unknown;entries?:readonly Entry[];busy?:boolean;activeAgents?:number;sending?:boolean;status?:string;storageError?:boolean}):MascotSignals{
 const value=object(live),run=object(value.run);
 const runKey=value.run&&status==='Connected'?(typeof run.first==='number'?`first:${run.first}`:typeof run.taskId==='number'?`task:${run.taskId}`:'active'):undefined;
 const compacting=Array.isArray(value.compactions)&&value.compactions.length>0;
 const working=!!value.run||busy||activeAgents>0||sending||compacting;
 const connectionProblem=storageError||/offline|disconnect|interrupted|reconnecting|pair again|identity|authorization|cached/i.test(status);
 const failed=!working&&(!!value.runFailure||!!value.compactionFailure);
 let answerId=0;
 for(const entry of entries){
  if(entry.kind!=='pi.assistant'||!Number.isSafeInteger(entry.id)||entry.id<=answerId)continue;
  if(entry.model?.some(raw=>{
   const message=object(raw);if(message.role!=='assistant'||['error','aborted','deferred'].includes(String(message.stopReason)))return false;
   if(typeof message.content==='string')return !!message.content.trim();
   if(!Array.isArray(message.content)||message.content.some(part=>object(part).type==='toolCall'))return false;
   return message.content.some(part=>object(part).type==='text'&&typeof object(part).text==='string'&&String(object(part).text).trim().length>0);
  }))answerId=entry.id;
 }
 return {activity:connectionProblem||failed?'attention':working?'working':'idle',answerId,runKey};
}
export type MascotObservation={scope:string;runKey?:string;answerAtStart:number;completionKey?:string};
/** Celebrate only a locally observed native run ending with a newer committed answer, never cached/history hydration. */
export function observeMascot(previous:MascotObservation|undefined,scope:string,signals:MascotSignals):MascotObservation{
 if(!previous||previous.scope!==scope)return {scope,runKey:signals.runKey,answerAtStart:signals.answerId};
 if(signals.runKey)return {scope,runKey:signals.runKey,answerAtStart:previous.runKey===signals.runKey?previous.answerAtStart:signals.answerId};
 if(previous.runKey){
  const first=previous.runKey.startsWith('first:')?Number(previous.runKey.slice(6)):0;
  const answered=signals.activity==='idle'&&signals.answerId>previous.answerAtStart&&signals.answerId>=first;
  return {scope,answerAtStart:signals.answerId,...(answered?{completionKey:`${scope}:${signals.answerId}`}:{})};
 }
 return previous;
}
