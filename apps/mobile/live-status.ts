export type LiveStatus={key:string;tone:'neutral'|'failure';text:string};
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const failures:Record<string,string>={
 model_error:'Response failed. The model could not complete an answer.',
 no_model:'No answer: the configured model is unavailable.',
 aborted:'Stopped. This run was cancelled before it answered.',
 reset:'Context reset before this run answered.',
 faulted:'Response failed because of an execution error.',
 orphaned:'Response stopped because its execution could not be recovered.',
 interrupted:'Response interrupted before a final answer.',
 restart_limit:'Response stopped after repeated runtime interruptions.',
 nothing_to_answer:'No response requested: there was nothing new to answer.',
 turn_limit:'Tool-turn limit reached before a final answer.',
};
/** Native lifecycle status, not assistant output. Never display raw provider errors or infer success from idleness. */
export function liveStatuses(value:unknown):LiveStatus[]{
 const live=object(value),statuses:LiveStatus[]=[],failure=object(live.runFailure),generation=object(live.generation);
 if(!live.run&&typeof failure.reason==='string'){
  const reason=failure.reason,text=Object.hasOwn(failures,reason)?failures[reason]:'The run ended without an answer.';
  statuses.push({key:'run',tone:['aborted','reset','nothing_to_answer','turn_limit'].includes(reason)?'neutral':'failure',text});
 }
 if(live.run&&generation.retry)statuses.push({key:'generation',tone:'neutral',text:'Retrying the response…'});
 else if(live.run&&generation.deferred)statuses.push({key:'generation',tone:'neutral',text:'Waiting for the model provider’s response…'});
 const compacting=Array.isArray(live.compactions)&&live.compactions.length>0;
 if(compacting)statuses.push({key:'compaction',tone:'neutral',text:(live.compactions as unknown[]).some(item=>object(item).retry)?'Retrying context compaction…':'Compacting conversation context…'});
 else if(live.compactionFailure)statuses.push({key:'compaction',tone:'failure',text:'Context compaction failed. Earlier messages remain in stored history.'});
 return statuses;
}
