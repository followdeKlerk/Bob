type ActivityInput={connection:string;hasConversation:boolean;storageError?:boolean;sending?:boolean;waitingForAnswer?:boolean;live?:unknown;work?:unknown};
export type ComposerActivity={phase:'idle'|'connecting'|'connection'|'sending'|'stopping'|'question'|'compaction'|'retry'|'waiting'|'thinking'|'writing'|'working'|'preparing'|'finishing';text:string;animate:boolean};
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const activeTool=(value:unknown)=>['pending','running'].includes(String(object(value).status));
/** A coarse response lifecycle, NOT a second tool feed. Never use tool names,
 * arguments, output, reasoning text or provider errors as a status label. */
export function composerActivity(input:ActivityInput):ComposerActivity{
 const state=(phase:ComposerActivity['phase'],text:string,animate=true):ComposerActivity=>({phase,text,animate});
 const {connection}=input;
 if(input.storageError)return state('connection','Device storage issue • keep Bob open',false);
 if(/pair again|identity|authorization/i.test(connection))return state('connection','Connection needs attention • pair again',false);
 if(/offline|disconnect|interrupted|reconnecting/i.test(connection))return state('connection','Reconnecting…');
 if(/connecting|cached/i.test(connection))return state('connecting','Connecting…');
 if(!input.hasConversation)return state('idle','Select a conversation',false);
 if(input.sending)return state('sending','Sending • automatic retry');
 const live=object(input.live),run=object(live.run),generation=object(live.generation);
 const work=Array.isArray(input.work)?input.work.map(object):[];
 if(work.some(task=>task.background===false&&task.abortRequested===true))return state('stopping','Stopping…');
 if(input.waitingForAnswer)return state('question','Waiting for your answer',false);
 const compactions=Array.isArray(live.compactions)?live.compactions:[];
 const foreground=!!live.run||work.some(task=>task.background===false&&task.kind==='bob.mcp-ui-action');
 if(compactions.length&&(!foreground||compactions.some(item=>object(item).blocking!==false)))return state('compaction',compactions.some(item=>!!object(item).retry)?'Retrying summary…':'Condensing conversation…');
 if(live.run){
  if(run.afterRun)return state('finishing','Finishing up…');
  if(generation.retry)return state('retry','Retrying response…');
  if(generation.deferred)return state('waiting','Waiting for model…');
  // Tool details already live in their exact transcript slots. Include nested
  // activity only to avoid calling an executing script 'Thinking' or 'Writing'.
  if([live.tools,live.nestedTools].some(tools=>Array.isArray(tools)&&tools.some(activeTool)))return state('working','Working…');
  const message=object(generation.message),content=Array.isArray(message.content)?message.content:[],last=object(content.at(-1));
  if(message.stopReason==='toolUse'||last.type==='toolCall')return state('preparing','Preparing response…');
  if(last.type==='text'&&typeof last.text==='string'&&last.text.trim())return state('writing','Writing response…');
  if(last.type==='thinking'&&last.redacted!==true&&typeof last.thinking==='string'&&last.thinking.trim())return state('thinking','Thinking…');
  if(live.generation)return state('waiting','Waiting for model…');
  return state('preparing','Preparing response…');
 }
 if(work.some(task=>task.background===false&&task.kind==='bob.mcp-ui-action'))return state('working','Working…');
 // Retained generation/failure/tool slots and background watchers are not a run.
 return state('idle',connection==='Connected'?'Connected':'Connecting…');
}
