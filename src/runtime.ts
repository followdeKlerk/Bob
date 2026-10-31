import {createEmailRead} from './email-read.js';
import {createSchedules} from './schedules.js';
import {withDelegationPeerPolicy} from './peer-policy.js';
import {createDelegation} from './delegation.js';
import {recoverDelegationCommands} from './delegation-command.js';
import {createDiagnosticExtension} from './app-diagnostics.js';
import {defineExtension} from '@earendil-works/pi-durable';
import {sendFile} from './send-file.js';
import {backendMemory} from './memory.js';
import {phoneLocation} from './phone-location.js';
import {notesOperation} from './notes-agent.js';
import {searchHistory} from './history-search.js';
import { join } from "node:path";
import {maintenancePort} from './maintenance-port.js';
import {hostname} from "node:os";
import {conversationOperation} from "./conversation-network.js";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { createModels, type Models } from "@earendil-works/pi-ai/models";
import {bobOpenAIProvider} from "./openai-provider.js";
import {anthropicProvider} from "@earendil-works/pi-ai/providers/anthropic";
import {
  Harness,
  createRegistry,
  type ConversationId,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import {createCodingWithCodemode} from './codemode.js';
import {createResources,createCorePromptReader} from "@bob-local/resources";
import { State } from "./state.js";
import {acquireOwner} from "./ownership.js";
import { ChatMeta, Library, Todos, Questions } from "./documents.js";
import {encodeCursor,decodeCursor} from './pagination.js';
import { SubagentTools } from "./subagents.js";
import {createWebTools} from "./web-tools.js";
import {createInteractive} from "./interactive.js";
import {registerModules} from './modules.js';
import {createPeerTools} from '@bob-local/peers';
import {listPeers,requestPeer} from './peer-config.js';
import {loadCustomModules} from './custom-modules.js';
import {providerCredentials} from './provider-auth.js';
export { ctx };
export function createBackendModels(state:State){
  const models=createModels({credentials:providerCredentials(state),authContext:{
    env:async name=>name==='OPENAI_API_KEY'?state.get<string>('openaiKey'):name==='ANTHROPIC_API_KEY'?state.get<string>('anthropicKey'):undefined,
    fileExists:async()=>false,
  }});
  models.setProvider(bobOpenAIProvider());models.setProvider(anthropicProvider());
  return models;
}
export async function openRuntime(state: State, testModels?: Models, testMcpTransport?: Parameters<typeof createInteractive>[1], options:{resume?:boolean}={}) {
  const releaseOwner=acquireOwner(state.dir);
  let disposeCustom=()=>{};
  let closeMemory=async()=>{};
  let closeCodemode=async()=>{};
  let closeWeb=async()=>{};
  let disposeInteractive=()=>{};
  let openedHarness:import('@earendil-works/pi-durable').Harness|undefined;
  let closing:Promise<void>|undefined;
  const close=()=>closing??=(async()=>{
    const errors:unknown[]=[];
    // Join native invocations before destroying the VM host. Attempt every cleanup,
    // even on startup failure or when another resource's close throws.
    for(const dispose of [disposeInteractive,closeMemory,()=>openedHarness?.close(ctx),closeCodemode,closeWeb,disposeCustom,releaseOwner]){
      try {await dispose();} catch(error){errors.push(error);}
    }
    if(errors.length)throw new AggregateError(errors,'Runtime cleanup failed');
  })();
  try {
    const baseModels = testModels ?? createBackendModels(state);
    const registry = createRegistry();
    const memory=backendMemory(state);
    const web=createWebTools(state.get<string>("browserExecutable")??"/usr/bin/chromium");closeWeb=()=>web.close();
    const interactive = createInteractive(state, testMcpTransport);disposeInteractive=()=>interactive.dispose();
    const coding=await createCodingWithCodemode();closeCodemode=coding.close;
    let libraryId: ConversationId;
    const corePrompt=createCorePromptReader(join(state.dir,'core-prompt.md'));
    const delegation=createDelegation(state,baseModels,registry,()=>libraryId,()=>modules,corePrompt);
    const models=delegation.models;
    const resources = createResources(()=>libraryId,async(source,input,context)=>{
      if(input.mode==='search')return searchHistory({harness,library:{id:libraryId},models} as Runtime,state,input);
      if(input.conversationId===undefined&&!input.cursor&&!input.query){const result=await conversationOperation(state,{harness,models,library:{id:libraryId}},{originBackendId:state.id,name:hostname(),allConversations:true,read:[],message:[]},'conversations',{...input,destinationBackendId:state.id,originConversationId:source});return {...result,readOnly:true};}
      if(input.conversationId===undefined&&!input.cursor&&input.query)return searchHistory({harness,library:{id:libraryId},models} as Runtime,state,input);
      if(input.conversationId===undefined)throw Error('Specify conversationId for page mode. Use search mode to discover matching conversations first.');
      const result=await conversationOperation(state,{harness,models,library:{id:libraryId}},{originBackendId:state.id,name:hostname(),allConversations:true,read:[],message:[]},'history',{...input,destinationBackendId:state.id,originConversationId:source});
      return {...result,readOnly:true};
    },maintenancePort(state),async(input,taskId,source,context)=>{
      const library=await harness.conversation(libraryId,context);if(!library)throw Error('Notes library is unavailable');
      return notesOperation(state,library,source,taskId,input,context);
    },async(input,taskId,source,context)=>{
      const library=await harness.conversation(libraryId,context),chat=await harness.conversation(source,context);
      if(!library||!chat)throw Error('Location conversation is unavailable');
      return phoneLocation(state,library,chat,taskId,input,context);
    },async(input,taskId,source,context)=>{
      const chat=await harness.conversation(source,context);if(!chat)throw Error('File conversation is unavailable');
      return sendFile(state,chat,taskId,input,context);
    },corePrompt);
    const peers=withDelegationPeerPolicy(createPeerTools({list:()=>[{id:state.id,name:hostname(),local:true,allConversations:true,enabled:true},...listPeers(state).outbound],request:(id,action,request,signal)=>id===state.id
      ?conversationOperation(state,{harness,models,library:{id:libraryId}},{originBackendId:state.id,name:hostname(),allConversations:true,read:[],message:[]},action,{...request,destinationBackendId:state.id})
      :requestPeer(state,id,action,request,signal)}));
    const custom=await loadCustomModules(state);disposeCustom=custom.dispose;
    const scheduling=createSchedules(()=>harness);
    const email=createEmailRead(()=>harness);
    const diagnostics=createDiagnosticExtension(state,async(id,context)=>(await harness.conversation(id as ConversationId,context))??undefined);
    // Host-composed custom extension: existing resources selections gain the tool,
    // without changing persisted module identities or any existing task definition.
    const diagnosticResources=defineExtension({...resources,tools:[...resources.tools??[],...diagnostics.tools??[],...scheduling.extension.tools??[],...email.tools??[]],sections:[...resources.sections??[],...diagnostics.sections??[],...scheduling.extension.sections??[],...email.sections??[]],tasks:[...resources.tasks??[],...scheduling.extension.tasks??[]]});
    const modules:Record<string,import('@earendil-works/pi-durable').Extension>={coding:coding.extension,resources:diagnosticResources,subagents:delegation.extension,web:web.extension,interactive:interactive.extension,peers,memory:memory.extension,...custom.instances};
    // An explicit owner-managed config provisions this newly bundled module once.
    if(memory.config.enabled&&!state.get<boolean>('hindsightProvisioned')){
      const selected=state.get<{installed:string[];defaults:string[]}>('modules');
      if(selected)state.set('modules',{installed:[...new Set([...selected.installed,'memory'])],defaults:[...new Set([...selected.defaults,'memory'])]});
      state.set('hindsightProvisioned',true);
    }
    const defaultExtensions=registerModules(state,registry,modules);
    const storage=await openNodeSqliteStorage(join(state.dir, "durable.sqlite"));
    const harness = await Harness.open(
      storage,
      {
        models,
        registry,
        env: ({ cwd }) =>
          new NodeExecutionEnv({
            cwd: cwd ?? state.get<string>("cwd") ?? process.cwd(),
          }),
        settings: { extensions: defaultExtensions },
        conversationCreated: async (tx, c) => {
          await tx.doc(ChatMeta, c.id);
          await tx.doc(Todos, c.id);
          await tx.doc(Questions, c.id);
          await delegation.created(tx,c);
        },
      },
      ctx
    );
    openedHarness=harness;
    chmodSync(join(state.dir, "durable.sqlite"), 0o600);
    const library = await harness.root(ctx);
    libraryId = library.id;
    await library.commit(async (tx) => {
      await tx.doc(Library, library.id);
    }, ctx);
    // Reinstall persisted, immutable schema/provider aliases before any durable task resumes.
    await delegation.restore(harness);
    await recoverDelegationCommands(state,harness,delegation);
    if(options.resume!==false&&registry.snapshot().extension(memory.extension.name)){
      const attached=await memory.attach(harness,storage,state.id,{selectExisting:true});closeMemory=attached.close;
    }
    if(options.resume!==false){await scheduling.recover();harness.resume();}
    return {
      harness,
      scheduling,
      library,
      interactive,
      delegation,
      models,
      registry,
      modules,
      close,
    };
  } catch (e) {
    await close().catch(()=>{}); // Preserve the startup error, after all cleanup was attempted.
    throw e;
  }
}
export type Runtime = Awaited<ReturnType<typeof openRuntime>>;
