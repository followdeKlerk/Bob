// Adapted from official Pi Durable 1.4.0 example 23 (MIT, Earendil Works).
import { type AssistantMessage, Type } from "@earendil-works/pi-ai";
import {
  AssistantEntry,
  type ConversationId,
  configure,
  defineDoc,
  defineExtension,
  defineTask,
  defineTool,
  type EntryId,
  LiveDoc,
  type TaskId,
} from "@earendil-works/pi-durable";
import { ChatMeta } from "@bob-local/core/documents";
type Subagent = {
  conversationId: ConversationId;
  /** Answers already reported to the main agent: several messages can end in one answer, reported once. */
  reported: EntryId[];
};
export const Subagents = defineDoc<{
  agents: Record<string, Subagent>;
  reporters: Record<string, TaskId>;
}>({
  checkpointWhen: () => false,
  kind: "app.subagents",
  version: 1,
  scope: "conversation",
  history: "latest",
  // A fork of the main conversation starts without subagents.
  fork: "initial",
  initial: () => ({ agents: {}, reporters: {} }),
});

// Every task and conversation has an owner, and that decides what an abort or an idle wait reaches: aborting a task
// aborts what it owns, and waiting for a conversation to be idle waits for its work. A subagent must outlive the main
// agent's turns, so its conversation is owned by an anchor: a background task that finishes at once. A background task
// is a boundary: the main agent's Esc and idle waits stop there, but `abort({ background: true })` still reaches past
// it, so a host can stop everything.
const Anchor = defineTask<null, { phase: "done" }, null>({
  name: "app.subagent-anchor",
  version: 1,
  initial: () => ({ phase: "done" }),
  phases: {
    done: (_anchor, runtime, taskContext) =>
      runtime.commit(
        () => ({
          status: "terminal",
          outcome: { status: "completed", result: null },
        }),
        taskContext
      ),
  },
  abort: (_anchor, runtime, taskContext) =>
    runtime.commit(
      () => ({ status: "terminal", outcome: { status: "aborted" } }),
      taskContext
    ),
});

// A reporter delivers one message to a subagent and reports the answer to the main agent. It is a background task
// too, so the main agent's Esc and idle waits leave it alone. Tasks are durable: each phase ends with a saved
// checkpoint, and after a restart the task continues from the last one. Request IDs make a repeated submission return
// the first one, so the subagent gets the message once and the main agent gets the report once.
type ReporterInput = {
  name: string;
  conversationId: ConversationId;
  message: string;
  followUp: boolean;
};
type ReporterState =
  | { phase: "deliver" }
  | { phase: "report"; report?: string };
const Reporter = defineTask<ReporterInput, ReporterState, null>({
  name: "app.subagent-reporter",
  version: 1,
  initial: () => ({ phase: "deliver" }),
  phases: {
    // Send the message, wait for its answer, and decide what to report.
    deliver: async (reporter, runtime, taskContext) => {
      const { name, conversationId, message, followUp } = reporter.input;
      // While the subagent is busy, a steer reaches it at its next step and a follow-up after its current answer.
      const subagent = (await runtime.conversation(
        conversationId,
        taskContext
      ))!;
      const request = {
        type: "input",
        content: message,
        whenBusy: followUp ? "followUp" : "steer",
      } as const;
      const submission = await subagent.submit(
        { ...request, requestId: `subagent:${reporter.id}` },
        taskContext
      );
      const settled = await submission.wait(taskContext);
      // One commit decides the report and records the answer as delivered, so a restart does not decide again.
      await runtime.commit(async (tx) => {
        const next = (report?: string) =>
          ({
            status: "running",
            checkpoint: { phase: "report", report },
          } as const);
        // `aborted`: stopped, or withdrawn while queued. Nothing to report.
        if (settled.status === "unanswered") {
          return next(
            settled.reason === "aborted"
              ? undefined
              : `[subagent ${name} failed: ${settled.reason}]`
          );
        }
        // Always an answered input here; the check tells TypeScript.
        if (settled.type !== "input") return next();
        const agent = (await tx.doc(Subagents, runtime.conversationId)).agents[
          name
        ]!;
        if (agent.reported.includes(settled.answer)) return next();
        agent.reported.push(settled.answer);
        const answer = (await tx.entry(AssistantEntry, settled.answer))
          ?.model?.[0] as AssistantMessage;
        return next(
          `[subagent ${name} answered, no reply needed] ${textOf(answer)}`
        );
      }, taskContext);
    },
    // Post the report as a follow-up input: it starts a turn when the main agent is idle, or waits for its current
    // answer. If the user presses Esc while it waits in the main agent's queue, it is dropped with the other input; a
    // report that arrives after Esc starts a new turn.
    report: async (reporter, runtime, taskContext) => {
      const report = reporter.state.checkpoint.report;
      if (report !== undefined) {
        const main = (await runtime.conversation(
          runtime.conversationId,
          taskContext
        ))!;
        const input = {
          type: "input",
          content: report,
          whenBusy: "followUp",
        } as const;
        await main.submit(
          { ...input, requestId: `subagent-report:${reporter.id}` },
          taskContext
        );
      }
      await runtime.commit(
        () => ({
          status: "terminal",
          outcome: { status: "completed", result: null },
        }),
        taskContext
      );
    },
  },
  abort: (_reporter, runtime, taskContext) =>
    runtime.commit(
      () => ({ status: "terminal", outcome: { status: "aborted" } }),
      taskContext
    ),
});

function textOf(message: AssistantMessage | undefined): string {
  return (message?.content ?? [])
    .flatMap((c) => (c.type === "text" ? [c.text] : []))
    .join("");
}

const subagentTool = defineTool({
  name: "subagent",
  description:
    "Manage persistent subagents that work in the background. Actions: spawn (name, message), send (name, message; " +
    "followUp: true queues it after the current answer instead of steering), stop (name: aborts its current work), " +
    "status (name, or all subagents without one). Answers are reported back to you when they arrive.",
  parameters: Type.Object({
    action: Type.Union([
      Type.Literal("spawn"),
      Type.Literal("send"),
      Type.Literal("stop"),
      Type.Literal("status"),
    ]),
    name: Type.Optional(Type.String()),
    message: Type.Optional(Type.String()),
    followUp: Type.Optional(Type.Boolean()),
  }),
  // A call interrupted by a crash is not rerun: repeating `stop` could stop newer work. The model sees that the call
  // was interrupted and can check with `status`.
  replay: "unsafe",
  execute: async (args, api, callContext) => {
    const { action, name, message, followUp } = args;
    if(action==='spawn'){
      const live=await api.snapshot(LiveDoc,api.conversationId,callContext);
      const grants=(await api.snapshot(ChatMeta,api.conversationId,callContext))?.subagentRequests??[];
      const authorized=await api.commit(async tx=>{
        for(const requestId of grants){
          const submission=await tx.submissionByRequest(api.conversationId,requestId);
          if(submission&&(live?.run?.inputs??[]).includes(submission.id))return true;
        }
        return false;
      },callContext);
      if(!authorized)throw Error('Subagents require explicit authorization in an input of the current native run');
    }
    const reply = (text: string, conversationId?: ConversationId) => ({
      output: [{ type: "text" as const, text }],
      // A UI can attach to the subagent's conversation through the call's details.
      ...(conversationId === undefined || name === undefined
        ? {}
        : { details: { name, conversationId } }),
    });
    const registry = (await api.snapshot(
      Subagents,
      api.conversationId,
      callContext
    )) ?? {
      agents: {},
      reporters: {},
    };

    if (action === "status") {
      const names = name === undefined ? Object.keys(registry.agents) : [name];
      const lines: string[] = [];
      for (const each of names) {
        const found = Object.hasOwn(registry.agents, each)
          ? registry.agents[each]
          : undefined;
        if (found === undefined) continue;
        // A conversation is busy while it has a run: from an input until its final answer.
        const busy =
          (await api.snapshot(LiveDoc, found.conversationId, callContext))
            ?.run !== undefined;
        lines.push(`${each}: ${busy ? "working" : "idle"}`);
      }
      return reply(lines.length === 0 ? "No subagents." : lines.join("\n"));
    }
    if (name === undefined) return reply(`${action} needs a name.`);
    const agent = Object.hasOwn(registry.agents, name)
      ? registry.agents[name]
      : undefined;
    if (action !== "spawn" && agent === undefined)
      return reply(`No subagent named ${name}.`);

    if (action === "stop") {
      // Aborts the subagent's current answer and tools and drops its queued messages. It stays usable.
      await (await api.conversation(agent!.conversationId, callContext))!.abort(
        callContext
      );
      return reply(`Stopped ${name}.`, agent!.conversationId);
    }
    if (message === undefined) return reply(`${action} needs a message.`);

    // spawn and send: one commit starts a reporter for the message.
    const result = await api.commit(async (tx) => {
      const state = await tx.doc(Subagents, api.conversationId);
      // Both tasks belong to the main conversation and are background: its Esc and idle waits skip them.
      const background = {
        ownership: { kind: "conversation" },
        background: true,
      } as const;
      if (action === "spawn") {
        if (Object.hasOwn(state.agents, name))
          return `${name} already exists; use send.`;
        const anchor = await tx.createTask(Anchor, null, background);
        // Owned by a task of the main conversation: starts as a copy of the main agent.
        const child = await tx.createConversation({
          ownership: { kind: "task", taskId: anchor },
        });
        // Subagents cannot start subagents, and know who they are.
        await configure(tx, child.id, {
          extensions: { remove: [SubagentTools] },
          instructions: `You are the subagent "${name}". Answer the main agent's requests.`,
        });
        state.agents[name] = { conversationId: child.id, reported: [] };
      }
      const conversationId = state.agents[name]!.conversationId;
      const input = {
        name,
        conversationId,
        message,
        followUp: action === "send" && followUp === true,
      };
      state.reporters[api.taskId] = await tx.createTask(
        Reporter,
        input,
        background
      );
      return action === "send" ? `Sent to ${name}.` : `Started ${name}.`;
    }, callContext);
    const current = (
      await api.snapshot(Subagents, api.conversationId, callContext)
    )?.agents[name];
    return reply(result, current?.conversationId);
  },
});

// The task definitions come with the extension, so pending reporters resume after a restart once the host installs
// it again.
export const SubagentTools = defineExtension({
  name: "subagent-tools",
  tasks: [Anchor, Reporter],
  tools: [subagentTool],
});
