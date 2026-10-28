import {diagnosticView,respondDiagnostics} from './app-diagnostics.js';
import {setTimeout as locationDelay} from 'node:timers/promises';
import {bindLocationDevice,locationAvailability,pollLocations,pendingLocations,respondLocation} from './phone-location.js';
import {readNotes,syncNote} from './notes.js';
import {QuestionChoices} from '@bob-local/resources';
import {
  createServer as httpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer as httpsServer } from "node:https";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { once } from "node:events";
import { z } from "zod";
import {getSupportedThinkingLevels} from "@earendil-works/pi-ai/models";
import type { ConversationId, Cursor, TaskId, EntryRecord } from "@earendil-works/pi-durable";
import {LiveDoc} from '@earendil-works/pi-durable';
import {setProviderKey} from './provider-auth.js';
import { State } from "./state.js";
import {peerOperation} from "./peers.js";
import { receiveArtifact, downloadArtifact } from "./artifacts.js";
import { TransferLimits, NativeWork, ModuleSelection } from "./contracts.js";
import {listModules,selectModules} from './modules.js';
import {encodeCursor,decodeCursor} from './pagination.js';
import {listPeers,revokePeer} from './peer-config.js';
import {grantNetwork,connectNetwork} from './network-pairing.js';
import { ctx, openRuntime, type Runtime } from "./runtime.js";
import {SessionUI} from './session-controls.js';
import { ChatMeta, Library, Questions, Todos } from "./documents.js";
import { Subagents } from "./subagents.js";
import {presentSubagentReports} from './subagent-presentation.js';
import {McpConnection, validateMcpEndpoint, type McpConnectionConfig} from "./interactive.js";
import {
  Configure,
  CreateChat,
  Id,
  Message,
  Pair,
  Skill,
  Stop,
  protocol,
  Model,
} from "./contracts.js";
import {updateStatus,queueUpdate,withMaintenance,downloadUpdate} from './maintenance-port.js';
import {notificationReply} from './notification-preview.js';
import {HttpError} from "./errors.js";
function validateDirectory(cwd: string | undefined) {
  if (cwd === undefined) return;
  try { if (isAbsolute(cwd) && statSync(cwd).isDirectory()) return; } catch { /* reported as a scoped input error below */ }
  throw new HttpError(400, "Working directory must be an existing absolute backend directory");
}
async function body(req: IncomingMessage, maxSize = 300000) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxSize) throw new HttpError(413, "Body too large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}
function send(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(value));
}
export async function serve(
  state: State,
  options: {
    port: number;
    host?: string;
    tls?: { cert: string; key: string };
    runtime?: Runtime;
    devPeerLoopback?: boolean;
  }
) {
  const host = options.host ?? "127.0.0.1";
  if (
    !["127.0.0.1", "::1"].includes(host) &&
    (!/^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) || !options.tls)
  )
    throw new Error(
      "Remote binding requires a Tailscale IPv4 address and verified TLS certificate configuration"
    );
  const runtime = options.runtime ?? (await openRuntime(state)),
    h = runtime.harness;
  const streams = new Set<ServerResponse>();
  let activeNotes=0;
  // Upstream ConversationView deliberately contains BUILT-IN docs only.
  // Add Bob's native document snapshots explicitly; never assume watch exposes them.
  async function present(value: unknown, id: ConversationId, deviceId: string) {
    const view = value as { entries:EntryRecord[]; docs: Record<string, unknown> };
    const [meta, todos, questions, subagents, inspection, questionChoices] = await Promise.all([
      h.snapshot(ChatMeta, id, ctx), h.snapshot(Todos, id, ctx),
      h.snapshot(Questions, id, ctx), h.snapshot(Subagents, id, ctx),
      h.inspect(ctx), h.snapshot(QuestionChoices,id,ctx),
    ]);
    const work=inspection.tasks.filter(t=>t.record.conversationId===id).map(t=>NativeWork.parse({id:t.record.id,kind:t.record.kind,background:t.record.background,abortRequested:t.record.abortRequested,state:t.state.kind}));
    const agents=Object.fromEntries(await Promise.all(Object.entries(subagents?.agents??{}).map(async([name,agent])=>{
      const childWork=inspection.tasks.filter(t=>t.record.conversationId===agent.conversationId),live=await h.snapshot(LiveDoc,agent.conversationId,ctx);
      return [name,{...agent,status:childWork.some(t=>t.record.abortRequested)?'stopping':live?.run||childWork.length?'working':'idle'}];
    })));
    return { ...view, entries:await presentSubagentReports(h,id,view.entries,subagents), work, docs: { ...view.docs, 'bob.chat': {...meta,...await h.snapshot(SessionUI,id,ctx)}, 'bob.diagnostics': await diagnosticView(h,(await h.conversation(id,ctx))!,deviceId), 'bob.todos': todos, 'bob.questions': questions?.pending&&questionChoices?.questionId===questions.pending.id&&questionChoices.options?.length?{...questions,pending:{...questions.pending,options:questionChoices.options,multiple:questionChoices.multiple??false}}:questions, 'app.subagents': subagents?{...subagents,agents}:undefined } };
  }
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? "/", "https://bob.invalid"),
        path = url.pathname;
      if(path==='/internal/update-health'){
        if(!process.env.BOB_HEALTH_TOKEN||req.headers.authorization!=='Bearer '+process.env.BOB_HEALTH_TOKEN)throw new HttpError(401,'Supervisor authorization required');
        const inspection=await h.inspect(ctx);
        return send(res,200,{backendId:state.id,releaseId:process.env.BOB_RELEASE_ID,foreground:inspection.tasks.filter(t=>!t.record.background).length+inspection.submissions.length+activeNotes});
      }
      if(state.get('maintenanceHome')&&req.method!=='GET'&&(path.endsWith('/messages')||path==='/v1/peer/message'||path==='/v1/chats'||path==='/v1/notes/sync')&&withMaintenance(state,store=>store.get('draining')))
        throw new HttpError(503,'Backend update is waiting for active work; retry after reconnect');
      if (req.method === "POST" && path === "/v1/pair") {
        const p = Pair.parse(await body(req));
        if (p.backendId !== state.id)
          throw new HttpError(409, "Backend identity mismatch");
        try {
          return send(res, 201, {
            protocol,
            backendId: state.id,
            ...state.pair(p.invitation, p.name),
          });
        } catch {
          throw new HttpError(401, "Invalid or expired invitation");
        }
      }
      if(req.method==='POST'&&path.startsWith('/v1/peer/')){
        try { const result=await peerOperation(state,runtime,String(req.headers['x-bob-peer']??''),req.headers.authorization?.replace(/^Bearer /,'')??'',path.slice(9),await body(req));return send(res,200,result); }
        catch { throw new HttpError(403,'Peer operation denied'); }
      }
      const token = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
      if (!state.authenticate(token))
        throw new HttpError(401, "Device authorization required");
      if (req.headers["x-bob-backend"] !== state.id)
        throw new HttpError(409, "Backend identity mismatch");
      if(path.startsWith('/v1/location/')){
        const deviceId=String(state.authenticate(token)!.id);
        if(path==='/v1/location/availability'&&req.method==='POST'){
          const p=z.object({enabled:z.boolean()}).strict().parse(await body(req,1024));
          return send(res,200,await locationAvailability(runtime.library,deviceId,p.enabled));
        }
        if(path==='/v1/location/response'&&req.method==='POST')return send(res,200,await respondLocation(runtime.library,deviceId,await body(req,4096)));
        if(path==='/v1/location/poll'&&req.method==='GET'){
          let result=await pollLocations(runtime.library,deviceId);const until=Date.now()+15000;
          while(result.enabled&&!result.requests.length&&Date.now()<until&&!res.destroyed){
            await locationDelay(750);if(res.destroyed)return;
            result=await pendingLocations(runtime.library,deviceId);
          }
          if(!res.destroyed)send(res,200,result);return;
        }
        throw new HttpError(404,'Location endpoint not found');
      }
      if((path==='/v1/notes'&&req.method==='GET')||(path==='/v1/notes/sync'&&req.method==='POST')){
        if(state.get('maintenanceHome')&&withMaintenance(state,store=>store.get('draining')))throw new HttpError(503,'Notes sync is waiting for the backend update; local changes can retry after reconnect');
        activeNotes++;
        try{
          if(req.method==='GET'){
            const since=z.coerce.number().int().nonnegative().safe().parse(url.searchParams.get('since')??0);
            return send(res,200,await readNotes(runtime.library,state.id,since));
          }
          return send(res,200,await syncNote(runtime.library,state.id,String(state.authenticate(token)!.id),await body(req,1000000)));
        }finally{activeNotes--;}
      }
      if(path==='/v1/updates'&&req.method==='GET')return send(res,200,updateStatus(state));
      if(path==='/v1/updates'&&req.method==='POST'){
        const request=z.object({id:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),action:z.enum(['build','update','rollback']),target:z.enum(['android','backend','all'])}).strict().parse(await body(req));
        return send(res,202,queueUpdate(state,request));
      }
      const updateApk=path.match(/^\/v1\/updates\/([A-Za-z0-9_-]{1,128})\/apk$/);
      if(updateApk&&req.method==='GET'){await downloadUpdate(state,updateApk[1]!,res);return;}
      if(path==='/v1/network/grant'&&req.method==='POST'){
        try{return send(res,200,grantNetwork(state,String(state.authenticate(token)!.id),await body(req),options.devPeerLoopback===true));}
        catch{throw new HttpError(400,'Connected-agent link unavailable: check pairing, endpoint or explicit revocation');}
      }
      if(path==='/v1/network/connect'&&req.method==='POST'){
        try{return send(res,200,await connectNetwork(state,await body(req),options.devPeerLoopback===true,()=>!!state.authenticate(token),String(state.authenticate(token)!.id)));}
        catch{throw new HttpError(400,'Connected-agent link could not be verified; no new connection saved');}
      }
      if(path==='/v1/modules'&&req.method==='GET')return send(res,200,await listModules(state,runtime));
      if(path==='/v1/peers') {
        if(req.method==='GET')return send(res,200,listPeers(state));
        if(req.method==='DELETE'){const p=z.object({id:z.string().uuid(),direction:z.enum(['inbound','outbound'])}).strict().parse(await body(req));return send(res,200,revokePeer(state,p.id,p.direction));}
      }
      if (path === "/v1/status" && req.method === "GET")
        return send(res, 200, {
          protocol,
          backendId: state.id,
          durable: "1.4.0",
          connectedAgents: {version:1,automaticHistory:true,automaticLinking:true,replyDelivery:"durable"},
          providerReady: (await runtime.models.getAvailable()).length > 0,
          inspection: await h.inspect(ctx),
        });
      if (path === "/v1/models" && req.method === "GET") {
        const available=new Set((await runtime.models.getAvailable()).map(m=>m.provider+"/"+m.id));
        return send(
          res,
          200,
          runtime.models
            .getModels()
            .map((m) => ({ provider: m.provider, modelId: m.id, name: m.name, thinkingLevels:getSupportedThinkingLevels(m),available:available.has(m.provider+"/"+m.id) }))
        );
      }
      if (path === "/v1/mcp-connections") {
        if (req.method === "GET") return send(res, 200, state.get("mcpConnections") ?? []);
        if (req.method === "PUT") {
          const connection = McpConnection.parse(await body(req)); validateMcpEndpoint(connection.endpoint);
          const entries = state.get<McpConnectionConfig[]>("mcpConnections") ?? [];
          if(entries.some(c=>c.id===connection.id&&c.endpoint!==connection.endpoint))state.delete(`mcpKey:${connection.id}`);
          state.set("mcpConnections", [...entries.filter(c => c.id !== connection.id), connection]);
          return send(res, 200, connection);
        }
        if (req.method === "DELETE") {
          const p=z.object({id:McpConnection.shape.id}).strict().parse(await body(req));
          state.set("mcpConnections",(state.get<McpConnectionConfig[]>("mcpConnections")??[]).filter(c=>c.id!==p.id));
          state.delete(`mcpKey:${p.id}`);
          return send(res,200,{removed:p.id});
        }
      }
      if (path === "/v1/transfer-limits") {
        if (req.method === "GET") return send(res, 200, { uploadLimit: state.get<number>("uploadLimit") ?? 25 * 1024 * 1024 });
        if (req.method === "PUT") {
          const limits = TransferLimits.parse(await body(req)); state.set("uploadLimit", limits.uploadLimit);
          return send(res, 200, limits);
        }
      }
      if (path === "/v1/provider" && req.method === "PUT") {
        const p = z
          .object({
            provider: z.enum(["openai","anthropic"]),
            key: z.string().min(1).max(10000),
            modelId: z.string().min(1).max(160),
          })
          .strict()
          .parse(await body(req));
        if (!runtime.models.getModel(p.provider, p.modelId))
          throw new HttpError(400, "Unknown model");
        await setProviderKey(state,p.provider,p.key);
        state.set("model", { provider: p.provider, modelId: p.modelId });
        return send(res, 200, { configured: true });
      }
      if (path === "/v1/devices" && req.method === "GET")
        return send(res, 200, state.devices());
      if (path.startsWith("/v1/devices/") && req.method === "DELETE") {
        state.revoke(Id.parse(path.split("/")[3]));
        for (const s of streams) s.end();
        return send(res, 200, { revoked: true });
      }
      if (path === "/v1/library") {
        if (req.method === "GET")
          return send(
            res,
            200,
            await h.snapshot(Library, runtime.library.id, ctx)
          );
        if (req.method === "PUT") {
          const value = z
            .object({
              instructions: z.string().max(32000),
              templates: z.record(z.string().max(80), z.string().max(32000)),
            })
            .strict()
            .parse(await body(req));
          await runtime.library.commit(async (tx) => {
            Object.assign(await tx.doc(Library, runtime.library.id), value);
          }, ctx);
          return send(res, 200, { saved: true });
        }
      }
      if (path === "/v1/skills" && req.method === "PUT") {
        const p = Skill.parse(await body(req));
        await runtime.library.commit(async (tx) => {
          (await tx.doc(Library, runtime.library.id)).skills[p.name] = {
            description: p.description,
            markdown: p.markdown,
            enabled: p.enabled,
          };
        }, ctx);
        return send(res, 200, { saved: true });
      }
      if (path.startsWith("/v1/skills/") && req.method === "DELETE") {
        const name = z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
          .parse(path.split("/")[3]);
        await runtime.library.commit(async (tx) => {
          delete (await tx.doc(Library, runtime.library.id)).skills[name];
        }, ctx);
        return send(res, 200, { deleted: true });
      }
      if (path === "/v1/chats") {
        if (req.method === "GET") {
          const page = await h.commit(
            (tx) => tx.scanConversations({order:'descending'}, 100,decodeCursor(state,'chats',url.searchParams.get('cursor'))),
            ctx
          );
          const items = await Promise.all(
            page.items
              .filter((c) => c.id !== runtime.library.id)
              .map(async (c) => ({
                ...c,
                meta: {...await h.snapshot(ChatMeta,c.id,ctx),...await h.snapshot(SessionUI,c.id,ctx)},
              }))
          );
          return send(res, 200, { items, next: encodeCursor(state,'chats',page.next) });
        }
        if (req.method === "POST") {
          const p = CreateChat.parse(await body(req));
          validateDirectory(p.cwd);
          if (p.model && !runtime.models.getModel(p.model.provider, p.model.modelId)) throw new HttpError(400, "Unknown model");
          const chat = await h.createConversation(
            {
              ownership: { kind: "ownerless" },
              agent: {
                model: p.model ?? state.get("model"),
                cwd: p.cwd ?? state.get("cwd"),
                instructions: p.instructions,
              },
              init: async (tx, c) => {
                (await tx.doc(ChatMeta, c)).title = p.title;
              },
            },
            ctx
          );
          return send(res, 201, { id: chat.id });
        }
      }
      const match = /^\/v1\/chats\/([^/]+)(?:\/(.*))?$/.exec(path);
      if (match) {
        const id = z.coerce
            .number()
            .int()
            .positive()
            .safe()
            .parse(match[1]) as ConversationId,
          action = match[2] ?? "";
        if (id === runtime.library.id)
          throw new HttpError(403, "Reserved resource");
        const chat = await h.conversation(id, ctx);
        if (!chat) throw new HttpError(404, "Conversation not found");
        if(action==='diagnostics'&&req.method==='POST')return send(res,200,await respondDiagnostics(state,chat,String(state.authenticate(token)!.id),await body(req,65536)));
        // Additive, versioned UI-only document; the existing ChatMeta and task
        // schemas stay unchanged. Trash never removes Durable history.
        if (action === "metadata" && req.method === "PUT") {
          const patch=z.object({title:z.string().trim().min(1).max(160).optional(),pinned:z.boolean().optional(),archived:z.boolean().optional(),trashed:z.boolean().optional()}).strict().refine(value=>Object.keys(value).length>0).parse(await body(req));
          const meta=await chat.commit(async tx=>{
            const value=await tx.doc(ChatMeta,id);
            if(patch.title!==undefined)value.title=patch.title;
            const flags=await tx.doc(SessionUI,id);
            for(const key of ['pinned','archived','trashed'] as const)if(patch[key]!==undefined)flags[key]=patch[key];
            if(flags.trashed){flags.archived=false;flags.pinned=false;}
            return {...JSON.parse(JSON.stringify(value)),...flags};
          },ctx);
          return send(res,200,{id,meta});
        }
        if (action === "" && req.method === "DELETE") {
          const meta=await chat.commit(async tx=>{
            const value=await tx.doc(ChatMeta,id),flags=await tx.doc(SessionUI,id);
            flags.trashed=true;flags.archived=false;flags.pinned=false;
            return {...JSON.parse(JSON.stringify(value)),...flags};
          },ctx);
          return send(res,200,{id,meta,deleted:true,recoverable:true});
        }
        if (action === "" && req.method === "GET") {
          const view = await chat.viewState(ctx);
          try {
            return send(res, 200, { backendId: state.id, view: await present(view.value, id, String(state.authenticate(token)!.id)) });
          } finally {
            view.dispose();
          }
        }
        if (action === "ui" && req.method === "GET") return send(res, 200, await runtime.interactive.list(h, chat));
        if(action==='history-access')throw new HttpError(410,'History access is automatic; per-conversation grants are no longer used');
        if(action.startsWith('tasks/')&&req.method==='GET') {
          const taskId=z.coerce.number().int().positive().safe().parse(action.slice(6)) as TaskId;
          const task=await h.getTask(taskId,ctx);
          if(!task||task.conversationId!==id)throw new HttpError(404,'Task not found in this conversation');
          return send(res,200,{backendId:state.id,conversationId:id,id:task.id,kind:task.kind,background:task.background,state:task.state});
        }
        const visualData = /^ui\/([^/]+)\/data$/.exec(action);
        if (visualData && req.method === 'GET') {
          const after=url.searchParams.has('after')?z.coerce.number().int().nonnegative().safe().parse(url.searchParams.get('after')):undefined;
          return send(res,200,await runtime.interactive.data(h,chat,visualData[1],after));
        }
        const uiAction = /^ui\/([^/]+)\/(open|call|close)$/.exec(action);
        if (uiAction && req.method === "POST") {
          const deviceId = z.string().uuid().parse(state.authenticate(token)!.id);
          if (uiAction[2] === "open") return send(res, 200, await runtime.interactive.open(h, chat, uiAction[1], deviceId));
          if (uiAction[2] === "call") {
            if(!(await chat.agent(ctx)).extensions.some(e=>e.name==='bob.interactive'))throw new HttpError(403,'Interactive module is not selected in this conversation');
            return send(res, 200, await runtime.interactive.call(h, chat, uiAction[1], deviceId, await body(req)));
          }
          const p = z.object({ capability: z.string().uuid() }).strict().parse(await body(req));
          runtime.interactive.close(p.capability, deviceId); return send(res, 200, { closed: true });
        }
        if (action === "artifacts" && req.method === "POST")
          return send(res, 201, await receiveArtifact(req, state, chat));
        if (action.startsWith("artifacts/") && req.method === "GET") {
          await downloadArtifact(res, state, chat, action.slice(10));
          return;
        }
        if (action === "history" && req.method === "GET") {
          const resource=`history:${id}`,cursor=decodeCursor(state,resource,url.searchParams.get('cursor'));
          const page=await chat.entries({order:'descending'},100,cursor,ctx);
          return send(res,200,{backendId:state.id,conversationId:id,coverage:'stored-entries',items:await presentSubagentReports(h,id,page.items),next:encodeCursor(state,resource,page.next)});
        }
        if (action === "configure" && req.method === "GET") {
          const agent = await chat.agent(ctx);
          return send(res, 200, { model: agent.model, thinkingLevel:agent.thinkingLevel, cwd: agent.cwd ?? state.get("cwd") ?? process.cwd(), instructions: agent.instructions ?? null });
        }
        if(action==='modules') {
          if(req.method==='GET')return send(res,200,await listModules(state,runtime,chat));
          if(req.method==='PUT')return send(res,200,await selectModules(state,runtime,chat,ModuleSelection.parse(await body(req)).ids));
        }
        if (action === "todos" && req.method === "PUT") {
          const todo = z.object({ items: z.array(z.object({ text: z.string().max(4000), done: z.boolean() }).strict()).max(1000) }).strict().parse(await body(req));
          await chat.commit(async tx => { (await tx.doc(Todos, id)).items = todo.items; }, ctx);
          return send(res, 200, todo);
        }
        if (action === "configure" && req.method === "PUT") {
          const configuration = Configure.parse(await body(req)); validateDirectory(configuration.cwd);
          if (configuration.model && !runtime.models.getModel(configuration.model.provider, configuration.model.modelId)) throw new HttpError(400, "Unknown model");
          if(configuration.model||configuration.thinkingLevel){
            const current=await chat.agent(ctx),ref=configuration.model??current.model;
            const model=ref?runtime.models.getModel(ref.provider,ref.modelId):undefined;
            if(!model)throw new HttpError(400,'Select a model first');
            const supported=getSupportedThinkingLevels(model);
            if(configuration.thinkingLevel&&!supported.includes(configuration.thinkingLevel))throw new HttpError(400,'Thinking effort is not supported by this model');
            if(configuration.model&&!configuration.thinkingLevel&&!supported.includes(current.thinkingLevel))configuration.thinkingLevel=supported.includes('medium')?'medium':supported[0];
          }
          await chat.configure(configuration, ctx);
          return send(res, 200, { configured: true });
        }
        if (action === "messages" && req.method === "POST") {
          const p = Message.parse(await body(req)),
            requestId = `device:${state.authenticate(token)!.id}:${
              p.requestId
            }`;
          const existing = await h.commit(
            (tx) => tx.submissionByRequest(id, requestId),
            ctx
          );
          if (existing) return send(res, 200, existing);
          const previousQuestion = (await h.snapshot(Questions, id, ctx))?.pending;
          if (p.questionId && previousQuestion?.id !== p.questionId)
            throw new HttpError(409, 'This question is no longer active. Your answer was not sent; reply to the current question instead.');
          const model = (await chat.agent(ctx)).model;
          if (!model || !(await runtime.models.getAuth(model.provider)))
            throw new HttpError(
              412,
              "Configure a provider credential and model; no inference was admitted"
            );
          if (p.allowSubagents) await chat.commit(async tx => {
            const meta = await tx.doc(ChatMeta, id); meta.subagentRequests = [...(meta.subagentRequests ?? []).filter(k => k !== requestId), requestId].slice(-100);
          }, ctx);
          await bindLocationDevice(chat,String(state.authenticate(token)!.id));
          const submission = await chat.submit(
            { type: "input", content: p.display ? `${p.text}

[Bob display context for this request: CSS-pixel viewports ${JSON.stringify(p.display)}. Inline must fit completely without any internal scrolling; no page headings or introductory prose that consume the visual. Use render_visual presentation=inline only for compact content that fits. Choose presentation=fullscreen for larger diagrams, dense explanations, or uncertain fit. Fullscreen opens on user tap, not automatically. Keep typography readable; never clip or shrink content to force a fit. Use responsive layouts; viewport may change before opening.]` : p.text, whenBusy: p.mode, requestId,
              entry:{kind:'bob.user',data:{text:p.text,allowSubagents:p.allowSubagents,requestId:p.requestId}} },
            ctx
          );
          if (previousQuestion) await chat.commit(async tx => {
            const questions = await tx.doc(Questions, id);
            if (questions.pending?.id === previousQuestion.id) delete questions.pending;
          }, ctx);
          return send(res, 202, await submission.status(ctx));
        }
        if (action.startsWith("operations/") && req.method === "GET") {
          const op = z.string().uuid().parse(action.slice(11)),
            requestId = `device:${state.authenticate(token)!.id}:${op}`;
          const found = await h.commit(
            (tx) => tx.submissionByRequest(id, requestId),
            ctx
          );
          const question=(await h.snapshot(Questions,id,ctx))?.pending;
          const answer=found?.type==='input'&&found.status==='done'?await h.commit(tx=>tx.entry(found.answer),ctx):undefined;
          return send(res, 200, { admission: found ?? null, question:question?{id:question.id,text:question.text.slice(0,1000)}:null, reply:notificationReply(answer,id) });
        }
        if (action === "stop" && req.method === "POST") {
          const p = Stop.parse(await body(req));
          await chat.abort(ctx, { background: p.scope === "tree" });
          return send(res, 200, { status: "settled", scope: p.scope });
        }
        if (action === "events" && req.method === "GET") {
          const watch = await chat.watch(ctx);
          let ended = false;
          res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-store",
            connection: "keep-alive",
          });
          streams.add(res);
          // Reattach always sends authoritative snapshot; Last-Event-ID is not a mutation retry.
          const emit = async (value: unknown) => {
            if (ended) return;
            if (!state.authenticate(token)) {
              res.end();
              return;
            }
            if (
              !res.write(
                `event: snapshot\ndata: ${JSON.stringify({
                  backendId: state.id,
                  conversationId: id,
                  view: await present(value, id, String(state.authenticate(token)!.id)),
                })}\n\n`
              )
            )
              await Promise.race([once(res, "drain"), once(res, "close")]);
          };
          let refreshing = false;
          const timer = setInterval(() => {
            if (!state.authenticate(token)) { res.end(); return; }
            if (refreshing || ended) return;
            refreshing = true;
            void (async () => {
              const current = await chat.viewState(ctx);
              try { await emit(current.value); } finally { current.dispose(); }
            })().catch(() => res.end()).finally(() => { refreshing = false; });
          }, 3000);
          res.on("close", () => {
            ended = true;
            clearInterval(timer);
            streams.delete(res);
            void watch.stop();
          });
          await emit(watch.value);
          watch.start(emit);
          return;
        }
      }
      throw new HttpError(404, "Not found");
    } catch (e) {
      if (res.headersSent) {
        res.end();
        return;
      }
      send(
        res,
        e instanceof HttpError ? e.status : e instanceof z.ZodError ? 400 : 500,
        {
          error:
            e instanceof HttpError
              ? e.message
              : e instanceof z.ZodError
              ? "Invalid request"
              : "Operation failed; inspect backend diagnostics",
        }
      );
      if (!(e instanceof HttpError) && !(e instanceof z.ZodError))
        console.error(e);
    }
  };
  const server = options.tls
    ? httpsServer(
        {
          cert: readFileSync(options.tls.cert),
          key: readFileSync(options.tls.key),
        },
        handler
      )
    : httpServer(handler);
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.listen(options.port, host);
  await once(server, "listening");
  return {
    server,
    runtime,
    async close() {
      for (const s of streams) s.end();
      server.close();
      server.closeAllConnections();
      await runtime.close();
    },
  };
}
