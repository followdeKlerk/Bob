import { defineDoc } from "@earendil-works/pi-durable";
export const LocalHistoryAccess=defineDoc<{read:number[]}>({kind:'bob.local-history-access',version:1,scope:'conversation',history:'latest',fork:'initial',initial:()=>({read:[]}),checkpointWhen:()=>true});
export const ChatMeta = defineDoc<{ title: string; allowSubagents: boolean; subagentRequests?: string[] }>({
  kind: "bob.chat",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ title: "New chat", allowSubagents: false }),
  checkpointWhen: () => true,
});
export const Library = defineDoc<{
  skills: Record<
    string,
    { description: string; markdown: string; enabled: boolean }
  >;
  templates: Record<string, string>;
  instructions: string;
}>({
  kind: "bob.library",
  version: 1,
  scope: "conversation",
  history: "rewindable",
  fork: "current",
  initial: () => ({ skills: {}, templates: {}, instructions: "" }),
  checkpointWhen: () => true,
});
export const Todos = defineDoc<{ items: { text: string; done: boolean }[] }>({
  kind: "bob.todos",
  version: 1,
  scope: "conversation",
  history: "rewindable",
  fork: "current",
  initial: () => ({ items: [] }),
  checkpointWhen: () => true,
});
export const Questions = defineDoc<{ pending?: { id: string; text: string } }>({
  kind: "bob.questions", version: 1, scope: "conversation", history: "latest", fork: "initial",
  initial: () => ({}), checkpointWhen: () => true,
});
