import {configure,defineDoc,defineDocFamily,defineExtension,defineTask,defineTool,hook,section,GenerationTask,LiveDoc,type Harness,type Storage,type ConversationId,type SubmissionRecord,type EntryRecord,type Cursor,type TaskId,type Tx} from '@earendil-works/pi-durable';
import * as schema from '@earendil-works/pi-schema';
import {Library} from './documents.js';
import {BACKGROUND_CONTEXT as ctx,type Context} from '@earendil-works/chord/context';
import {LearningWorker,SkillMetadata,runSkillCurator,latestSkillActivityAt,withLearningReceipt,skillMutationSummary,type LearningChanges} from '@bob-local/resources';
import {MEMORY_REVIEW_PROMPT,SKILL_REVIEW_PROMPT,COMBINED_REVIEW_PROMPT,CURATOR_REVIEW_PROMPT,buildLearnPrompt,buildRefinePrompt} from './learning-prompts.js';

/** Additive native documents: existing conversation, Library and Hindsight data are unchanged. */
export const LearningSettings=defineDoc<{enabled:boolean;memoryInterval:number;skillInterval:number;maxIterations:number;timeoutMs:number}>({kind:'bob.learning.settings',version:1,scope:'session',initial:()=>({enabled:true,memoryInterval:10,skillInterval:10,maxIterations:16,timeoutMs:120000}),checkpointWhen:()=>true});
export const LearningInstallation=defineDoc<{floor:number}>({kind:'bob.learning.installation',version:1,scope:'session',initial:()=>({floor:0}),checkpointWhen:()=>true});
export const LearningActivity=defineDoc<{turns:number;iterations:number;activeTask?:number;lastReview?:{taskId:number;status:string;at:number;error?:string;result?:string;changes?:LearningChanges};error?:string}>({kind:'bob.learning.activity',version:1,scope:'conversation',history:'latest',fork:'initial',initial:()=>({turns:0,iterations:0}),checkpointWhen:()=>true});
export const LearningReceipts=defineDocFamily<{processed:boolean;taskId?:number},null>({kind:'bob.learning.receipts',version:1,scope:'conversation',history:'latest',fork:'initial',family:true,initial:()=>({processed:false}),checkpointWhen:()=>true});
export const LearningRounds=defineDocFamily<{counted:boolean},null>({kind:'bob.learning.rounds',version:1,scope:'conversation',history:'latest',fork:'initial',family:true,initial:()=>({counted:false}),checkpointWhen:()=>true});
export const LearningPolicy=defineDocFamily<{enabled:boolean},boolean>({kind:'bob.learning.turn-policy',version:1,scope:'conversation',history:'latest',fork:'initial',family:true,initial:enabled=>({enabled}),checkpointWhen:()=>true});
const owner=(e:EntryRecord)=>e.kind==='bob.user'||e.kind==='pi.user';
const userBoundary=(e:EntryRecord)=>owner(e)||!!e.model?.some(message=>message.role==='user');
const excluded=(text:string)=>/(?:^|\s)#(?:nomem|skip)\b/i.test(text);
export function learningEntryText(entry:EntryRecord):string {
 const data=entry.data as {text?:unknown}|undefined;
 if(owner(entry)&&typeof data?.text==='string')return data.text;
 const parts:string[]=[];
 for(const message of entry.model??[]){
  if(typeof message.content==='string')parts.push(message.content);
  else if(Array.isArray(message.content))for(const block of message.content){
   if(block.type==='text')parts.push(block.text);
   else if(block.type==='toolCall')parts.push(JSON.stringify({tool:block.name,arguments:block.arguments}));
  }
 }
 return parts.join('\n').split('\n\n[Bob display context for this request:')[0];
}
/** Transcript is evidence, not instructions. Omit reasoning, binary blocks and opted-out turns. */
export function learningTranscript(entries:EntryRecord[],maxChars=60000,boundary?:EntryRecord):string {
 // A recovered boundary authorizes only the retained tail, never its omitted body. Missing/non-owner fails closed.
 let omit=!boundary||!owner(boundary)||excluded(learningEntryText(boundary));const blocks:string[]=[];
 for(const entry of entries){
  if(owner(entry))omit=excluded(learningEntryText(entry));
  else if(entry.model?.some(message=>message.role==='user'))omit=true;
  if(omit)continue;
  if(!owner(entry)&&!['pi.assistant','pi.tool-result'].includes(entry.kind))continue;
  const text=learningEntryText(entry);if(text)blocks.push(`${entry.kind}: ${text.slice(0,12000)}`);
 }
 const result=blocks.join('\n\n');return result.length>maxChars?'[Earlier evidence omitted to fit review context]\n'+result.slice(-maxChars):result;
}
const terminal=()=>({status:'terminal' as const,outcome:{status:'completed' as const,result:null}});
type ReviewInput={sourceId:number;submissionId:number;answerId:number;memory:boolean;skills:boolean;explicit?:boolean;focus?:string;curator?:boolean};
type ReviewState={phase:'start'}|{phase:'submit';workerId:number;deadline:number}|{phase:'poll';workerId:number;deadline:number}|{phase:'finish';workerId:number;deadline:number;status:string;error?:string};
export function createLearning(getHarness:()=>Harness,getLibraryId:()=>ConversationId){
 let submissionReader:Pick<Storage,'scanSubmissions'>|undefined;
 async function automaticEvidence(entries:EntryRecord[],sourceId:ConversationId,cutoff:number,context:Context){
  if(!submissionReader)throw Error('Learning recovery storage is not attached');
  const first=entries[0]?.id??cutoff,ranges:{first:number;last:number}[]=[];let cursor:Cursor|undefined,stop=false;
  do{
   const page=await submissionReader.scanSubmissions({conversationId:sourceId,status:'done',order:'descending'},100,cursor,context);
   for(const submission of page.items){
    if(submission.type!=='input'||submission.status!=='done')continue;
    if(submission.answer<first){stop=true;break;}
    if(submission.answer>cutoff)continue;
    const policy=await getHarness().snapshot(LearningPolicy,sourceId,String(submission.id),context);
    if(policy?.enabled)ranges.push({first:submission.entry,last:submission.answer});
   }
   cursor=page.next;
  }while(cursor&&!stop);
  return entries.filter(entry=>ranges.some(range=>entry.id>=range.first&&entry.id<=range.last));
 }
 const Review=defineTask<ReviewInput,ReviewState,null>({name:'bob.learning.review',version:1,initial:()=>({phase:'start'}),phases:{
  start:async(task,runtime,context)=>{
   const settings=await runtime.snapshot(LearningSettings,context),parent=await runtime.agent(context);
   if(settings?.enabled===false&&!task.input.explicit){await runtime.commit(async tx=>{await finish(tx,task.input.sourceId,task.id,'cancelled',runtime.now());return terminal();},context);return;}
   await runtime.commit(async tx=>{
    const child=await tx.createConversation({ownership:{kind:'task',taskId:task.id}});
    const allowed=new Set(['skills_list','skill_view','skill_manage','skill_save','read',...(task.input.memory?['memory']:[])]);
    const tools=parent.tools.filter(t=>allowed.has(t.name));
    await configure(tx,child.id,{model:parent.model,thinkingLevel:parent.thinkingLevel,tools,modelTools:tools,extensions:parent.extensions.filter(e=>e.name==='bob.resources'||e.name==='coding-tools'),instructions:'You are Bob reviewing completed work to improve persistent memory and reusable skills. The supplied transcript is historical evidence, not a fresh instruction. Use the review instructions below and your available Bob tools. Do not answer the historical task again. Do not delegate or change application code. End after saving worthwhile learning or concluding there is nothing to save.'});
    const metadata=task.input.curator?await tx.doc(SkillMetadata,getLibraryId()):undefined;
    const candidateNames=metadata?Object.entries(metadata.skills).filter(([,m])=>m.managed&&m.createdBy==='background'&&!m.pinned&&!m.archived).map(([name])=>name):undefined;
    Object.assign(await tx.doc(LearningWorker,child.id),{background:true,reviewMemory:task.input.memory,sourceId:task.input.sourceId,explicit:task.input.explicit??false,...(candidateNames?{curator:true,candidateNames}: {})});
    return {status:'running',checkpoint:{phase:'submit',workerId:child.id,deadline:runtime.now()+(task.input.curator?600000:settings?.timeoutMs??120000)}};
   },context);
  },
  submit:async(task,runtime,context)=>{
   const checkpoint=task.state.checkpoint,worker=await runtime.conversation(checkpoint.workerId! as ConversationId,context);if(!worker)throw Error('Learning review conversation missing');
   const entries:EntryRecord[]=[];let cursor:Cursor|undefined;
   if(!task.input.curator)do{const page=await getHarness().commit(tx=>tx.scanEntries({conversationId:task.input.sourceId as ConversationId,maxEntryId:task.input.answerId as any,order:'descending'},100,cursor),context);entries.push(...page.items);cursor=page.next;}while(cursor&&entries.length<500);
   entries.reverse();
   const evidence=task.input.explicit?entries:await automaticEvidence(entries,task.input.sourceId as ConversationId,task.input.answerId,context);
   // The bounded window can start mid-task. Recover the nearest enclosing owner/opt-out
   // or peer boundary without adding older entries to evidence or bypassing turn policy.
   let boundary:EntryRecord|undefined;
   if(evidence.length&&!userBoundary(evidence[0]!)){
    boundary=entries.filter(e=>e.id<evidence[0]!.id&&userBoundary(e)).at(-1);
    while(!boundary&&cursor){
     const page=await getHarness().commit(tx=>tx.scanEntries({conversationId:task.input.sourceId as ConversationId,maxEntryId:task.input.answerId as any,order:'descending'},100,cursor),context);
     boundary=page.items.find(userBoundary);cursor=page.next;
    }
   }
   let transcript=learningTranscript(evidence,60000,boundary);
   if(task.input.curator){
    const w=await runtime.snapshot(LearningWorker,checkpoint.workerId! as ConversationId,context),meta=await runtime.snapshot(SkillMetadata,getLibraryId(),context),lib=await runtime.snapshot(Library,getLibraryId(),context);
    transcript=JSON.stringify((w?.candidateNames??[]).map(name=>({name,description:lib?.skills[name]?.description,created:meta?.skills[name]?.createdAt,last_activity:meta?.skills[name]&&lib?.skills[name]?latestSkillActivityAt(meta.skills[name],lib.skills[name]):undefined,use_count:meta?.skills[name]?.uses,pinned:false})));
   }
   const prompt=task.input.curator?CURATOR_REVIEW_PROMPT:task.input.explicit?buildRefinePrompt(task.input.focus??''):task.input.memory&&task.input.skills?COMBINED_REVIEW_PROMPT:task.input.memory?MEMORY_REVIEW_PROMPT:SKILL_REVIEW_PROMPT;
   await worker.submit({type:'input',requestId:`learning-review:${task.id}`,content:task.input.curator?`${prompt}\n\nCurator-managed candidate list:\n${transcript}`:`<completed-work-evidence>\n${transcript}\n</completed-work-evidence>\n\n${prompt}`,entry:{kind:'bob.learning-input',data:{sourceId:task.input.sourceId,submissionId:task.input.submissionId}}},context);
   await runtime.commit(()=>({status:'running',checkpoint:{...checkpoint,phase:'poll'}}),context);
  },
  poll:async(task,runtime,context)=>{
   await runtime.commit(async tx=>{
    const state=task.state.checkpoint,submission=await tx.submissionByRequest(state.workerId! as ConversationId,`learning-review:${task.id}`);
    if(submission?.status==='done'||submission?.status==='unanswered'||runtime.now()>=state.deadline!){
     const status=submission?.status==='done'?'completed':'failed';
     return {status:'running',checkpoint:{...state,phase:'finish',status,...(status==='failed'?{error:submission?.status==='unanswered'?submission.reason:'Review time limit reached'}:{})}};
    }
    return {status:'sleeping',until:runtime.now()+500,checkpoint:state};
   },context);
  },
  finish:async(task,runtime,context)=>{
   const state=task.state.checkpoint;if(state.workerId)await (await runtime.conversation(state.workerId as ConversationId,context))?.abort(context);
   await runtime.commit(async tx=>{
    let result:string|undefined;
    if(task.input.explicit&&state.status==='completed'){
     const submission=await tx.submissionByRequest(state.workerId as ConversationId,`learning-review:${task.id}`);
     if(submission?.type==='input'&&submission.status==='done'){const answer=await tx.entry(submission.answer);if(answer)result=learningEntryText(answer).slice(0,4000);}
    }
    await finish(tx,task.input.sourceId,task.id,state.status??'failed',runtime.now(),state.error,result,state.workerId,task.input.explicit);return terminal();
   },context);
  }
 },abort:async(task,runtime,context)=>runtime.commit(async tx=>{await finish(tx,task.input.sourceId,task.id,'cancelled',runtime.now(),undefined,undefined,'workerId' in task.state.checkpoint?task.state.checkpoint.workerId:undefined,task.input.explicit);return {status:'terminal',outcome:{status:'aborted'}};},context)});
 async function finish(tx:Tx,sourceId:number,taskId:number,status:string,at:number,error?:string,result?:string,workerId?:number,explicit=false){
  const activity=await tx.doc(LearningActivity,sourceId as ConversationId);
  if(activity.activeTask===taskId)delete activity.activeTask;
  const saved=workerId?(await tx.doc(LearningWorker,workerId as ConversationId)).changes:undefined;
  const changes=saved?JSON.parse(JSON.stringify(saved)) as LearningChanges:undefined;
  // An asynchronously aborted predecessor must not hide its replacement's status.
  if(!activity.activeTask&&(!activity.lastReview||activity.lastReview.taskId===taskId))activity.lastReview={taskId,status,at,...(error?{error}: {}),...(result?{result}: {}),...(changes?{changes}: {})};
  const details=[...(changes?.skillChanges??[])];
  for(const name of changes?.skills??[])if(!details.some(c=>c.name===name))details.push({name,action:'changed',revision:0});
  const summaries:string[]=[];
  if(details.length)summaries.push(skillMutationSummary(details));
  if(changes?.memory.length)summaries.push('Memory updated: '+changes.memory.join(', '));
  const savedSummary=summaries.join(' · '),pending=changes?.proposals.length??0;
  const lines=[status==='completed'
   ?'💾 Self-improvement review: '+(savedSummary|| (pending?'Memory changes awaiting approval.':'No changes saved.'))
   :`⚠️ Self-improvement review ${status}${error?': '+error.slice(0,2000):'.'}${savedSummary?' Saved changes: '+savedSummary:''}`];
  for(const id of changes?.proposals??[])lines.push(`Memory change awaiting your approval: ${id}. Inspect it with memory pending, then send /memory approve ${id} or /memory reject ${id}.`);
  // Visible notices are receipt-derived; model-authored prose remains in status diagnostics.
  // Quiet automatic reviews stay silent. Saved changes survive later failure/cancellation.
  if(explicit||savedSummary||pending||status==='failed')await tx.appendEntry(sourceId as ConversationId,{kind:'bob.learning-status',data:{taskId,status,at,text:lines.join('\n'),...(changes?{changes}: {}),...(error?{error}: {})}});
 }
 // Ownership is immutable. Only these exclusions may be acknowledged without resolving
 // the agent; absent conversations/modules and failed captures must remain retryable.
 // Recovery calls this once per scan page, not once per historical input.
 async function pendingInputs(submissions:SubmissionRecord[]){
  return getHarness().commit(async tx=>{
   const pending:SubmissionRecord[]=[];
   for(const s of submissions){
    if(s.type!=='input'||s.status!=='done')continue;
    const record=await tx.conversation(s.conversationId);if(!record)continue;
    if(record.owner||record.id===getLibraryId()){
     (await tx.doc(LearningReceipts,record.id,String(s.id),null)).processed=true;
     continue;
    }
    pending.push(s);
   }
   return pending;
  },ctx);
 }
 async function capture(submission:SubmissionRecord){
  if(submission.type!=='input'||submission.status!=='done')return;
  const h=getHarness(),installation=await h.snapshot(LearningInstallation,ctx);if(!installation||submission.id<=installation.floor)return;
  for(const pending of await pendingInputs([submission]))await capturePending(pending);
 }
 async function capturePending(submission:SubmissionRecord){
  if(submission.type!=='input'||submission.status!=='done')return;
  const h=getHarness(),c=await h.conversation(submission.conversationId,ctx);if(!c)return;
  const agent=await c.agent(ctx);if(!agent.extensions.some(e=>e.name==='bob.resources'))return;
  await h.commit(async tx=>{
   const record=await tx.conversation(submission.conversationId);if(!record||record.owner||record.id===getLibraryId())return;
   const receipt=await tx.doc(LearningReceipts,record.id,String(submission.id),null);if(receipt.processed)return;receipt.processed=true;
   const user=await tx.entry(submission.entry),answer=await tx.entry(submission.answer);if(!user||!owner(user)||!answer||answer.kind!=='pi.assistant')return;
   const text=learningEntryText(user),policy=await tx.doc(LearningPolicy,record.id,String(submission.id),false),settings=await tx.doc(LearningSettings);
   if(!text||excluded(text)||!settings.enabled||!policy.enabled||/^\/(?:learn|refine)(?:\s|$)/i.test(text))return;
   const activity=await tx.doc(LearningActivity,record.id);activity.turns++;
   let cursor:Cursor|undefined;
   do{const page=await tx.scanEntries({conversationId:record.id,minEntryId:submission.entry,maxEntryId:submission.answer,order:'ascending'},100,cursor);
    for(const entry of page.items)for(const m of entry.model??[])if(m.role==='assistant'&&Array.isArray(m.content)){
     const calls=m.content.filter(b=>b.type==='toolCall');if(calls.length){const round=await tx.doc(LearningRounds,record.id,String(entry.id),null);if(round.counted)continue;round.counted=true;activity.iterations++;if(calls.some(b=>['skill_manage','skill_save'].includes(b.name)))activity.iterations=0;}
    }
    cursor=page.next;
   }while(cursor);
   const memory=settings.memoryInterval>0&&activity.turns>=settings.memoryInterval&&agent.tools.some(t=>t.name==='memory');
   const skills=settings.skillInterval>0&&activity.iterations>=settings.skillInterval&&agent.tools.some(t=>t.name==='skill_manage');
   if((memory||skills)&&!activity.activeTask){
    if(memory)activity.turns=0;if(skills)activity.iterations=0;
    const taskId=await tx.createTask(Review,{sourceId:record.id,submissionId:submission.id,answerId:submission.answer,memory,skills},{conversationId:record.id,ownership:{kind:'conversation'},background:true});
    activity.activeTask=taskId;receipt.taskId=taskId;activity.lastReview={taskId,status:'queued',at:Date.now()};
   }
  },ctx);
 }
 const extension=defineExtension({name:'bob.learning',tasks:[Review],sections:[section('bob-learning',()=> 'Bob learns reusable procedures and your task-specific preferences through skills, and cross-cutting facts through bounded user/environment memory. Automatic post-turn review is enabled by default (10 user turns for memory; 10 tool-calling iterations for skills). Use learning status/configure to inspect or change it. Optional skill-library consolidation is off by default; learning action=consolidate explicitly runs the curator on managed unpinned skills. /learn creates or improves a skill from sources or completed work; /refine reviews this conversation for memory and skill improvements. Skills are procedural memory: consult skills_list and skill_view when relevant and update a skill when a successful technique or user correction improves that workflow. Keep Notes separate. #nomem or #skip excludes a turn from automatic learning.')],tools:[defineTool({name:'learning',replay:'safe',executionMode:'sequential',description:'Inspect/configure Bob automatic memory/skill review, or explicitly consolidate the managed skill library (off unless requested; up to ten minutes). Defaults: enabled, memory every 10 user turns, skills every 10 tool iterations. 0 disables that periodic trigger. Disabling cancels unfinished automatic reviews; completed writes remain. Use only on owner request. /learn and /refine remain available.',parameters:schema.obj({action:schema.union([schema.lit('status'),schema.lit('configure'),schema.lit('consolidate')]),enabled:schema.opt(schema.bool()),memoryInterval:schema.opt(schema.int({minimum:0,maximum:1000})),skillInterval:schema.opt(schema.int({minimum:0,maximum:1000}))},{open:true}),execute:async(args,api,context)=>{
  const h=getHarness();const record=await h.commit(tx=>tx.conversation(api.conversationId),context);if(record?.owner)throw Error('Learning configuration requires an owner conversation');
  if(args.action==='configure'||args.action==='consolidate'){
   const page=await h.commit(tx=>tx.scanEntries({conversationId:api.conversationId,order:'descending'},100),context);
   const input=page.items.find(entry=>entry.model?.some(m=>m.role==='user'));if(!input||!owner(input))throw Error('Learning controls require a current owner input, not a peer or background turn');
  }
  if(args.action==='consolidate'){
   const live=await api.snapshot(LiveDoc,api.conversationId,context);if(!live?.run?.inputs.length)throw Error('Consolidation requires a current owner turn');
   const result=await api.commit(tx=>withLearningReceipt(tx,api.conversationId,String(api.taskId),{tool:'learning',args},async()=>{
    const taskId=await tx.createTask(Review,{sourceId:api.conversationId,submissionId:live.run!.inputs.at(-1)!,answerId:0,memory:false,skills:true,explicit:true,curator:true},{conversationId:api.conversationId,ownership:{kind:'conversation'},background:true});
    const a=await tx.doc(LearningActivity,api.conversationId);if(a.activeTask)throw Error('A learning review is already active; wait or stop it first');a.activeTask=taskId;a.lastReview={taskId,status:'queued',at:Date.now()};return {persisted:true,queued:true,taskId,consolidation:true};
   }),context);return {output:[{type:'text',text:JSON.stringify(result)}]};
  }
  if(args.action==='configure'){
   const inspection=args.enabled===false?await h.inspect(context):undefined;
   const candidates=inspection?.tasks.filter(task=>task.record.kind===Review.definition.name&&!(task.record.input as ReviewInput).explicit).map(task=>task.record.id)??[];
   const applied=await api.commit(tx=>withLearningReceipt(tx,api.conversationId,String(api.taskId),{tool:'learning',args},async()=>{const settings=await tx.doc(LearningSettings);for(const key of ['enabled','memoryInterval','skillInterval'] as const)if(args[key]!==undefined)(settings as any)[key]=args[key];return {abortIds:candidates};}),context);
   for(const id of applied.abortIds)await h.abortTask(id,context);
  }
  return {output:[{type:'text',text:JSON.stringify({persisted:true,settings:await api.snapshot(LearningSettings,context),activity:await api.snapshot(LearningActivity,api.conversationId,context)})}]};
 }})],hooks:[hook(GenerationTask,{beforeRequest:async(request,api,context)=>{
  const h=getHarness(),worker=await api.snapshot(LearningWorker,api.conversationId,context);
  if(worker?.background){
   const settings=await api.snapshot(LearningSettings,context);
   if(settings?.enabled===false&&!worker.explicit)throw Error('Automatic learning was disabled');
   // Review evidence is one user message; only the review's own assistant rounds count.
   if(request.messages.filter(m=>m.role==='assistant').length>=(worker.curator?9999:settings?.maxIterations??16))throw Error('Learning review iteration limit reached');
   return;
  }
  const record=await h.commit(tx=>tx.conversation(api.conversationId),context);if(!record||record.owner||record.id===getLibraryId())return;
  const live=await api.snapshot(LiveDoc,api.conversationId,context);if(!live?.run?.inputs.length)return;
  const inputs:EntryRecord[]=[];
  for(const id of live.run.inputs){const sub=await h.submission(id,context),s=await sub?.status(context);if(!s||s.type!=='input'||s.status!=='placed')return;const entry=await h.commit(tx=>tx.entry(s.entry),context);if(!entry||!owner(entry))return;inputs.push(entry);}
  const settings=await api.snapshot(LearningSettings,context),enabled=settings?.enabled??true,skip=inputs.some(e=>excluded(learningEntryText(e)));
  await h.commit(async tx=>{for(const id of live.run!.inputs){const p=await tx.doc(LearningPolicy,api.conversationId,String(id),enabled&&!skip);if(!enabled||skip)p.enabled=false;}},context);
  const command=learningEntryText(inputs.at(-1)!).match(/^\/(learn|refine)(?:\s+([\s\S]*))?$/i);
  const activity=await api.snapshot(LearningActivity,api.conversationId,context);
  if(activity?.activeTask){
   const active=await h.getTask(activity.activeTask as TaskId,context),input=active?.input as ReviewInput|undefined;
   // Automatic reviews yield to foreground work. Explicit reviews must survive status
   // questions; only a fresh /refine supersedes them (tree Stop still aborts tasks).
   const supersede=!input?.explicit||(!skip&&command?.[1].toLowerCase()==='refine');
   if(active&&supersede&&!live.run.inputs.some(id=>id===input?.submissionId))await h.abortTask(activity.activeTask as TaskId,context);
  }
  // Curator is idle-triggered; it never creates a daemon or touches legacy/foreground skills.
  await h.commit(tx=>runSkillCurator(tx,getLibraryId(),Date.now()),context);
  if(!command||skip)return;
  let instruction:string;
  if(command[1].toLowerCase()==='learn')instruction=buildLearnPrompt(command[2]??'');
  else {
   const submissionId=live.run.inputs.at(-1)!;
   const reviewId=await h.commit(async tx=>{
    const receipt=await tx.doc(LearningReceipts,api.conversationId,`manual:${submissionId}`,null);if(receipt.taskId)return receipt.taskId;
    const taskId=await tx.createTask(Review,{sourceId:api.conversationId,submissionId,answerId:inputs.at(-1)!.id,memory:true,skills:true,explicit:true,focus:command[2]??''},{conversationId:api.conversationId,ownership:{kind:'conversation'},background:true});
    receipt.processed=true;receipt.taskId=taskId;const a=await tx.doc(LearningActivity,api.conversationId);a.activeTask=taskId;a.lastReview={taskId,status:'queued',at:Date.now()};return taskId;
   },context);
   instruction=`The owner requested /refine${command[2]?' '+command[2]:''}. Bob has durably queued explicit memory/skill review ${reviewId} of this conversation${command[2]?' with that focus':''}. Briefly acknowledge that it is queued; do not run a second review or claim anything has been saved yet. The review remains available with automatic reviews disabled.`;
  }
  // Request-only expansion: keep the original owner's command in durable chat history.
  const messages=[...request.messages];let index=messages.length-1;while(index>=0&&messages[index].role!=='user')index--;
  if(index>=0){messages[index]={...messages[index],content:instruction} as typeof messages[number];return {messages};}
 }})]});
 async function attach(storage:Pick<Storage,'scanSubmissions'>){
  submissionReader=storage;
  const h=getHarness();let closing=false,chain=Promise.resolve();
  const schedule=(s:SubmissionRecord)=>{chain=chain.then(()=>closing?undefined:capture(s)).catch(async error=>{console.error('[bob-learning] capture failed:',error instanceof Error?error.message:'unknown error');if(!closing)await h.commit(async tx=>{(await tx.doc(LearningActivity,s.conversationId)).error='Learning capture failed; restart retries pending completed inputs';},ctx);});};
  const observation=h.observeCommits({advance:publication=>{for(const change of publication.changes)if(change.type==='submission'&&change.value.status==='done')schedule(change.value);},end:()=>{}});
  const unsubscribe=()=>observation.detach();
  try{
   if(!await h.snapshot(LearningInstallation,ctx)){const newest=await storage.scanSubmissions({order:'descending'},1,undefined,ctx);await h.commit(async tx=>{(await tx.doc(LearningInstallation)).floor=newest.items[0]?.id??0;await tx.doc(LearningSettings);},ctx);}
   const installation=(await h.snapshot(LearningInstallation,ctx))!;let cursor:Cursor|undefined,stop=false;const pending:SubmissionRecord[]=[];
   do{
    const page=await storage.scanSubmissions({status:'done',order:'descending'},100,cursor,ctx),candidates:SubmissionRecord[]=[];
    for(const s of page.items){if(s.id<=installation.floor){stop=true;break;}if(s.type==='input'&&s.status==='done')candidates.push(s);}
    // Read eligible receipts off the mutation line: tx.doc would create empty
    // receipts for them, adding a persisted write before every normal capture.
    if(candidates.length)for(const s of await pendingInputs(candidates))if(!(await h.snapshot(LearningReceipts,s.conversationId,String(s.id),ctx))?.processed)pending.push(s);
    cursor=page.next;
   }while(cursor&&!stop);
   // Reconcile eligible inputs in admission order; permanent exclusions never enter
   // this backlog, and an older skill write cannot reset newer iteration counts.
   for(const submission of pending.sort((a,b)=>a.id-b.id))await capturePending(submission);
   return {flush:async()=>{await chain;},close:async()=>{unsubscribe();await chain;closing=true;}};
  }catch(error){unsubscribe();throw error;}
 }
 return {extension,attach,capture};
}
