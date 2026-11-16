import {defineDoc,defineExtension,defineTask,LiveDoc,type ConversationId,type SubmissionId,type TaskDefinition,type TaskId,type TaskRuntime} from '@earendil-works/pi-durable';
import {SubagentTools as NativeSubagentTools} from '@bob-local/subagents';
export * from '@bob-local/subagents';

export const SUBAGENT_REPORT_KIND='app.subagent-report';
export const subagentReportDisplayRequest=(reporter:TaskId)=>`subagent-report-display:${reporter}`;
/** Host evidence only: never model-authored status or provider error payloads. */
export const SubagentFailures=defineDoc<{reported:Record<string,TaskId>;sources:Record<string,{submissionId:SubmissionId;runTaskId?:TaskId}>}>({kind:'bob.subagent-failures',version:1,scope:'conversation',history:'latest',fork:'initial',checkpointWhen:()=>true,initial:()=>({reported:{},sources:{}})});
export function subagentFailureReport(name:string,reason:string,source:{submissionId:SubmissionId;runTaskId?:TaskId}){
 const known=['model_error','no_model','reset','faulted','orphaned','interrupted','restart_limit','nothing_to_answer','turn_limit','run_failed'];
 const safe=known.includes(reason)?reason:'run_failed';
 const hint=safe==='model_error'?'Check the configured provider/credential; the underlying cause is not established. ':safe==='no_model'?'Check the configured model. ':'';
 return `[subagent ${name} failed: ${safe}] ${source.runTaskId===undefined?'Child input '+source.submissionId:'Native run '+source.runTaskId}. ${hint}Partial work may remain. Inspect the helper transcript and worktree before continuing; do not blindly repeat mutations.`;
}

/** Host-only failure/display integration around the native reporter. Keep its
 * name/version/input/checkpoints, native model submission and abort handler intact.
 * The bundled extension and its persistence fingerprint remain byte-for-byte
 * unchanged; no alias, database migration or second scheduler is introduced.
 */
type ReporterInput={name:string;conversationId:ConversationId;message:string;followUp:boolean};
type ReporterState={phase:'deliver'}|{phase:'report';report?:string};
const tasks=NativeSubagentTools.tasks!.map(task=>{
 if(task.definition.name!=='app.subagent-reporter')return task;
 // The registry erases task generics. Narrow only this pinned, inspected v1 task;
 // do not silently adapt a future reporter protocol with different phases.
 if(task.definition.version!==1||typeof task.definition.phases.report!=='function')throw Error('Unsupported native subagent reporter for display integration');
 const native=task.definition as TaskDefinition<ReporterInput,ReporterState,null,{}>;
 return defineTask({...native,phases:{...native.phases,
  deliver:async(reporter,runtime,context)=>{
   // Keep native delivery, waits, answered-result dedup and checkpointing. Augment
   // only its failure decision on the SAME commit line, before the report phase.
   const commit:TaskRuntime<ReporterInput,ReporterState,null,{}>['commit']=(change,callContext,options)=>runtime.commit(async(tx,current)=>{
    const delivery=await tx.submissionByRequest(reporter.input.conversationId,`subagent:${reporter.id}`);
    const failure=delivery?.status==='unanswered'&&delivery.reason!=='aborted'?(await tx.doc(LiveDoc,reporter.input.conversationId)).runFailure:undefined;
    const next=await change(tx,current);
    if(delivery?.status!=='unanswered'||delivery.reason==='aborted'||next?.status!=='running'||next.checkpoint.phase!=='report'||next.checkpoint.report===undefined)return next;
    const source={submissionId:delivery.id,...(failure?.inputs.includes(delivery.id)&&failure.reason===delivery.reason?{runTaskId:failure.taskId}:{})};
    const evidence=await tx.doc(SubagentFailures,runtime.conversationId),key=source.runTaskId===undefined?`input:${delivery.id}`:`run:${source.runTaskId}`;
    // A second steer may settle with the same native failure. Neither equal text
    // nor helper name is a result identity; a later run must still be reported.
    if(Object.hasOwn(evidence.reported,key)&&evidence.reported[key]!==reporter.id)return {...next,checkpoint:{phase:'report'}};
    evidence.reported[key]=reporter.id;evidence.sources[reporter.id]=source;
    return {...next,checkpoint:{phase:'report',report:subagentFailureReport(reporter.input.name,delivery.reason,source)}};
   },callContext,options);
   await native.phases.deliver!(reporter,new Proxy(runtime,{get(target,key){return key==='commit'?commit:Reflect.get(target,key);}}),context);
  },
  report:async(reporter,runtime,context)=>{
   const report=(reporter.state.checkpoint as {report?:unknown}).report;
   const source=reporter.input as {name?:unknown;conversationId?:unknown};
   if(typeof report==='string'&&typeof source.name==='string'&&typeof source.conversationId==='number'){
    const parent=(await runtime.conversation(runtime.conversationId,context))!;
    // A native kind/data-only write appears mid-turn without starting inference
    // or contributing to model context. Native reset ordering still applies.
    // Replaying this phase returns the same receipt and never creates a new card.
    await parent.submit({type:'write',requestId:subagentReportDisplayRequest(reporter.id),entry:{
     kind:SUBAGENT_REPORT_KIND,data:{reporterTaskId:reporter.id,name:source.name,conversationId:source.conversationId,text:report,receivedAt:Date.now()},
    }},context);
   }
   // Delegate ALL model delivery/terminal-state logic to the original handler.
   await native.phases.report!(reporter,runtime,context);
  },
 }});
});
export const SubagentTools=defineExtension({...NativeSubagentTools,tasks});
