import {defineExtension,defineTask,type ConversationId,type TaskDefinition,type TaskId} from '@earendil-works/pi-durable';
import {SubagentTools as NativeSubagentTools} from '@bob-local/subagents';
export * from '@bob-local/subagents';

export const SUBAGENT_REPORT_KIND='app.subagent-report';
export const subagentReportDisplayRequest=(reporter:TaskId)=>`subagent-report-display:${reporter}`;

/** Host-only display integration around the unchanged native reporter. Keep its
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
