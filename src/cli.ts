#!/usr/bin/env node
import {describeDelegationBehavior,readDelegationBehavior,saveDelegationBehavior} from './delegation-behavior.js';
import {describeDelegation,readDelegationConfig,saveDelegationConfig,setDelegationSecret} from './delegation-config.js';
import { Command } from "commander";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { Server as HttpsServer } from "node:https";
import QRCode from "qrcode";
import { State } from "./state.js";
import { serve } from "./server.js";
import { backupState, restoreState } from "./recovery.js";
import {McpConnection,validateMcpEndpoint,type McpConnectionConfig} from './interactive.js';
import {moduleCatalog,moduleState,changeModule} from './modules.js';
import {openRuntime,createBackendModels} from './runtime.js';
import {importCustomModule} from './custom-modules.js';
import {grantPeer,connectPeer,listPeers,revokePeer} from './peer-config.js';
import {diagnose} from './doctor.js';
import {migrateState,updateRelease} from './update.js';
import {migrateCustomModule} from './custom-migration.js';
import {setProviderKey} from './provider-auth.js';
const configPath = join(homedir(), ".config/bob/cli.json");
const localConfig: { state?: string; endpoint?: string } = existsSync(configPath)
  ? JSON.parse(readFileSync(configPath, "utf8")) : {};
const cli = new Command()
  .name("bob")
  .description("Official Durable backend manager (local development build)")
  .option(
    "--state <directory>",
    "Isolated state directory",
    localConfig.state ?? join(homedir(), ".local/share/bob")
  );
const state = () => new State(resolve(cli.opts().state));
const unitName = (s: State) => `bob-${s.id}.service`;
function systemctl(s: State, verb: string) {
  const r = spawnSync("systemctl", ["--user", verb, unitName(s)], {
    stdio: "inherit",
  });
  if (r.status !== 0) throw new Error(`systemctl ${verb} failed`);
}
cli
  .command("setup")
  .option("--cwd <path>", "Default working folder", process.cwd())
  .action((o) => {
    const cwd=resolve(o.cwd);
    if(!existsSync(cwd)||!statSync(cwd).isDirectory())throw Error('Working directory must be an existing directory');
    const s = state();
    s.set("cwd", cwd);
    console.log(
      JSON.stringify({
        backendId: s.id,
        state: s.dir,
        node: process.version,
        durable: "1.4.0",
        provider: "not configured",
      })
    );
    s.close();
  });
cli
  .command("provider")
  .requiredOption("--model <id>")
  .option("--provider <name>","openai or anthropic","openai")
  .description("Configure provider; read key from stdin, never argv")
  .action(async (o) => {
    let key = "";
    for await (const c of process.stdin) {
      key += c;
      if (key.length > 10000) throw new Error("Credential too long");
    }
    key = key.trim();
    if (!key) throw new Error("No credential supplied on stdin");
    if(!["openai","anthropic"].includes(o.provider))throw Error("Unsupported provider");
    const s = state();
    try{
      if(!createBackendModels(s).getModel(o.provider,o.model))throw Error('Unknown model');
      await setProviderKey(s,o.provider,key);
      s.set("model", { provider: o.provider, modelId: o.model });
    }finally{s.close();}
    console.log("Backend credential stored; live inference not yet verified.");
  });
cli
  .command("serve")
  .option("--host <host>", "Loopback or Tailscale IP", "127.0.0.1")
  .option("--port <port>", "Port", "49158")
  .option("--cert <file>")
  .option("--key <file>")
  .action(async (o) => {
    if ((o.cert !== undefined) !== (o.key !== undefined))
      throw new Error("--cert and --key must be supplied together");
    const s = state();
    const app = await serve(s, {
      host: o.host,
      port: Number(o.port),
      tls: o.cert !== undefined ? { cert: o.cert, key: o.key } : undefined,
    });
    console.log(
      JSON.stringify({
        backendId: s.id,
        listening: app.server.address(),
        encrypted: app.server instanceof HttpsServer,
      })
    );
    let closing = false;
    const close = async () => {
      if (closing) return;
      closing = true;
      await app.close();
      s.close();
    };
    process.on("SIGTERM", () => void close());
    process.on("SIGINT", () => void close());
  });
cli
  .command("connect")
  .alias("pair")
  .description("Show a QR code to connect your phone")
  .option("--endpoint <url>")
  .option(
    "--dev-loopback",
    "Allow loopback HTTP for isolated development only",
    false
  )
  .action(async (o) => {
    const selectedState = resolve(cli.opts().state);
    const endpoint = o.endpoint ?? (localConfig.state && resolve(localConfig.state) === selectedState ? localConfig.endpoint : undefined);
    if (!endpoint) throw new Error("No connection address saved. Run bob connect --endpoint <your Tailscale HTTPS address> once.");
    const u = new URL(endpoint);
    if (u.username || u.password || u.pathname !== "/" || u.search || u.hash)
      throw new Error("Endpoint must be an origin");
    if (
      u.protocol !== "https:" &&
      !(
        o.devLoopback &&
        u.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(u.hostname)
      )
    )
      throw new Error("HTTPS required");
    if (!o.devLoopback && !u.hostname.endsWith(".ts.net"))
      throw new Error("Remote endpoint must be a Tailscale HTTPS name");
    const s = state(),
      i = s.invite();
    const payload = {
      protocol: 1,
      backendId: s.id,
      endpoint: u.origin,
      invitation: i.token,
      expiresAt: i.expiresAt,
    };
    console.log(
      await QRCode.toString(JSON.stringify(payload), {
        type: "terminal",
        small: true,
      })
    );
    console.log("Open Bob on your phone → Scan QR code. This invitation is single-use and expires shortly.");
    s.close();
    if (o.endpoint) {
      mkdirSync(join(homedir(), ".config/bob"), { recursive: true, mode: 0o700 });
      writeFileSync(configPath, JSON.stringify({ state: selectedState, endpoint: u.origin }, null, 2) + "\n", { mode: 0o600 });
    }
  });
cli.command("list").action(() => {
  const s = state();
  console.log(JSON.stringify(s.devices(), null, 2));
  s.close();
});
cli.command("revoke <device>").action((id) => {
  const s = state();
  s.revoke(id);
  console.log(
    JSON.stringify(
      s.devices().find((d) => d.id === id) ?? { error: "not found" }
    )
  );
  s.close();
});
cli
  .command("service-install")
  .option("--host <host>", "Bind address", "127.0.0.1")
  .option("--port <port>", "Port", "49158")
  .action((o) => {
    const s = state();
    const dir = join(homedir(), ".config/systemd/user");
    mkdirSync(dir, { recursive: true });
    const quote = (x: string) =>
      '"' +
      x.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%") +
      '"';
    const unit = `[Unit]\nDescription=Bob isolated Durable backend ${
      s.id
    }\nAfter=network.target\n\n[Service]\nType=simple\nUMask=0077\nExecStart=${[
      process.execPath,
      resolve(process.argv[1]),
      "--state",
      s.dir,
      "serve",
      "--host",
      o.host,
      "--port",
      o.port,
    ]
      .map(quote)
      .join(
        " "
      )}\nRestart=on-failure\nRestartSec=5\n\n[Install]\nWantedBy=default.target\n`;
    const path = join(dir, unitName(s));
    writeFileSync(path, unit, { mode: 0o600 });
    const r = spawnSync("systemctl", ["--user", "daemon-reload"], {
      stdio: "inherit",
    });
    if (r.status !== 0) throw new Error("daemon-reload failed");
    console.log(path);
    console.log(
      "Not enabled automatically. Boot before login needs explicit loginctl enable-linger approval."
    );
    s.close();
  });
for (const verb of ["start", "stop", "status"])
  cli.command(verb).action(() => {
    const s = state();
    try {
      systemctl(s, verb);
    } finally {
      s.close();
    }
  });
cli.command('login').description('Bob-owned ChatGPT subscription OAuth; no unrelated credential import').option('--provider <id>','Supported subscription provider','openai').requiredOption('--model <id>').action(async o=>{
 const s=state();
 try{
  if(o.provider!=='openai')throw Error('Only the supported OpenAI ChatGPT login is enabled');
  const models=createBackendModels(s);if(!models.getModel(o.provider,o.model))throw Error('Unknown model');
  const signal=AbortSignal.timeout(300000);
  try{await models.login(o.provider,'oauth',{
   signal,
   notify:event=>{if(event.type==='auth_url')console.log('Open this URL in your browser on this laptop:\n'+event.url+'\nComplete the browser callback; do not paste credentials into chat.');},
   prompt:prompt=>new Promise((_,reject)=>{const abort=prompt.signal??signal;if(abort.aborted)reject(Error('Login cancelled'));else abort.addEventListener('abort',()=>reject(Error('Login cancelled')),{once:true});}),
  },{getDeviceId:()=>s.id,agentName:'Bob'});}catch{throw Error('Bob ChatGPT login did not complete. Retry on this laptop with port 1455 available; no unrelated credentials were imported.');}
  s.set('model',{provider:o.provider,modelId:o.model});
  console.log('Bob subscription login stored in this backend only; live inference not yet verified.');
 }finally{s.close();}
});
cli.command("doctor")
 .description('Inspect existing local state without initializing it; JSON, no network or repairs')
 .option('--check','Exit 1 for configuration errors (warnings alone exit 0)',false)
 .action(o=>{
  const report=diagnose(resolve(cli.opts().state));
  console.log(JSON.stringify(report,null,2));
  if(o.check&&report.status==='error')process.exitCode=1;
 });
cli.command("backup <destination>").action(async (path) => {
  const s = state();
  try {
    console.log(JSON.stringify(await backupState(s, resolve(path)), null, 2));
  } finally {
    s.close();
  }
});
cli.command("restore <source> <destination>").action((source, destination) => {
  console.log(
    JSON.stringify(restoreState(resolve(source), resolve(destination)), null, 2)
  );
});
cli
  .command("export <destination>")
  .description("Full sensitive backup export; see explicit manifest coverage")
  .action(async (path) => {
    const s = state();
    try {
      console.log(JSON.stringify(await backupState(s, resolve(path)), null, 2));
    } finally {
      s.close();
    }
  });
cli
  .command("update")
  .requiredOption("--version <exact>")
  .requiredOption('--package <archive>','Locally supplied release archive; never downloaded')
  .requiredOption('--sha256 <hash>','Trusted exact archive checksum')
  .requiredOption('--installation <directory>','New side-by-side installation')
  .requiredOption('--destination <directory>','New migrated state; original retained')
  .requiredOption('--backup <directory>','New verified rollback backup')
  .option('--trust-release-code','Explicitly trust the release code',false)
  .action(async (o) => {
    const s=state();try{console.log(JSON.stringify(await updateRelease(s,o),null,2));}finally{s.close();}
  });
cli.command('migrate').description('Explicit control-schema migration; requires settled state and verified backup')
  .requiredOption('--backup <directory>').action(async o=>{const s=state();try{console.log(JSON.stringify(await migrateState(s,resolve(o.backup))));}finally{s.close();}});
const mcp=cli.command('mcp').description('Explicit MCP Apps connections; credentials stay on this backend');
mcp.command('list').action(()=>{const s=state();try{console.log(JSON.stringify((s.get<McpConnectionConfig[]>('mcpConnections')??[]).map(c=>({...c,credentialPresent:!!s.get(`mcpKey:${c.id}`)})),null,2));}finally{s.close();}});
mcp.command('configure <id>').requiredOption('--endpoint <url>').requiredOption('--tools <comma-separated>').option('--disabled','Install configuration without enabling',false).action((id,o)=>{
  const connection=McpConnection.parse({id,endpoint:o.endpoint,allowedTools:o.tools.split(',').map((x:string)=>x.trim()),enabled:!o.disabled});validateMcpEndpoint(connection.endpoint);
  const s=state();try{const entries=s.get<McpConnectionConfig[]>('mcpConnections')??[];if(entries.some(c=>c.id===id&&c.endpoint!==connection.endpoint))s.delete(`mcpKey:${id}`);s.set('mcpConnections',[...entries.filter(c=>c.id!==id),connection]);console.log(JSON.stringify(connection));}finally{s.close();}
});
mcp.command('key <id>').description('Set MCP bearer credential from stdin; never argv').action(async id=>{
  McpConnection.shape.id.parse(id);let key='';for await(const chunk of process.stdin){key+=chunk;if(key.length>10000)throw Error('Credential too long');}key=key.trim();if(!key)throw Error('No credential on stdin');
  const s=state();try{if(!(s.get<McpConnectionConfig[]>('mcpConnections')??[]).some(c=>c.id===id))throw Error('Configure this connection first');s.set(`mcpKey:${id}`,key);console.log('MCP credential stored on backend.');}finally{s.close();}
});
for(const action of ['enable','disable','remove'] as const)mcp.command(`${action} <id>`).action(id=>{
  McpConnection.shape.id.parse(id);const s=state();try{const entries=s.get<McpConnectionConfig[]>('mcpConnections')??[];if(!entries.some(c=>c.id===id))throw Error('Unknown MCP connection');s.set('mcpConnections',action==='remove'?entries.filter(c=>c.id!==id):entries.map(c=>c.id===id?{...c,enabled:action==='enable'}:c));if(action==='remove')s.delete(`mcpKey:${id}`);console.log(`${action}: ${id}`);}finally{s.close();}
});
const modules=cli.command('module').description('Validated separate Durable packages; installation, defaults and conversation selections are distinct');
modules.command('migrate <id> <directory>').description('Explicit native document migration on a new staged state; original and backup retained').requiredOption('--replace <exact-previous-version>').requiredOption('--backup <new-directory>').requiredOption('--destination <new-directory>').option('--trust-backend-code','Explicitly trust unrestricted backend-account code',false).action(async(id,directory,o)=>{
 if(!o.trustBackendCode)throw Error('Explicit --trust-backend-code is required');
 const s=state();try{console.log(JSON.stringify(await migrateCustomModule(s,id,directory,o.replace,o.backup,o.destination)));}finally{s.close();}
});
modules.command('list').action(()=>{const s=state();try{const configured=moduleState(s);console.log(JSON.stringify(moduleCatalog(s).map(m=>({...m,available:true,installed:configured.installed.includes(m.id),defaultSelected:configured.defaults.includes(m.id),registration:'Inspect through the paired client; CLI configuration is not proof of a running service.'})),null,2));}finally{s.close();}});
modules.command('import <id> <directory>').description('Import explicitly trusted built ESM code; no scripts/downloads. Exact host dependencies only. Replacement does not imply a schema migration.').requiredOption('--backup <new-directory>','Verified quiescent pre-change backup, including custom package code').option('--trust-backend-code','Explicitly trust unrestricted backend-account code').option('--replace <exact-previous-version>','Replace this exact existing custom version; restore backup for rollback').action(async(id,directory,o)=>{
 if(!o.trustBackendCode)throw Error('Explicit --trust-backend-code is required; custom modules are not sandboxed');
 const s=state();try{await backupState(s,o.backup);const runtime=await openRuntime(s,undefined,undefined,{resume:false});try{console.log(JSON.stringify(await importCustomModule(s,runtime,id,directory,o.replace)));}finally{await runtime.close();}}finally{s.close();}
});
for(const action of ['install','remove','enable','disable'] as const)modules.command(`${action} <id>`).option('--version <exact>','Validated package version','0.1.0').action(async(id,o)=>{
 const s=state();try{if(moduleCatalog(s).find(m=>m.id===id)?.version!==o.version)throw Error('Unvalidated module version; no change made');const runtime=await openRuntime(s,undefined,undefined,{resume:false});try{console.log(JSON.stringify(await changeModule(s,runtime,action,id)));}finally{await runtime.close();}}finally{s.close();}
});
const peers=cli.command('peer').description('Explicit one-way backend trust; unrelated to device pairing or native child ownership');
peers.command('list').action(()=>{const s=state();try{console.log(JSON.stringify(listPeers(s),null,2));}finally{s.close();}});
peers.command('grant <origin-backend-id>').requiredOption('--name <name>').requiredOption('--endpoint <origin>','This destination backend HTTPS origin').requiredOption('--output <file>','New owner-only credential handoff file').option('--read <ids>','Comma-separated readable conversation IDs','').option('--message <ids>','Comma-separated writable conversation IDs','').option('--dev-loopback','Isolated loopback test only',false).action((peerId,o)=>{
 const ids=(value:string)=>value?value.split(',').map(v=>Number(v.trim())):[];
 const s=state();try{console.log(JSON.stringify(grantPeer(s,{peerId,name:o.name,endpoint:o.endpoint,read:ids(o.read),message:ids(o.message),output:resolve(o.output),devLoopback:o.devLoopback})));}finally{s.close();}
});
peers.command('connect <handoff-file>').requiredOption('--name <name>').option('--dev-loopback','Isolated loopback test only',false).action((file,o)=>{const s=state();try{console.log(JSON.stringify(connectPeer(s,resolve(file),o.name,o.devLoopback)));}finally{s.close();}});
peers.command('revoke <id>').requiredOption('--direction <direction>','inbound or outbound').action((id,o)=>{if(!['inbound','outbound'].includes(o.direction))throw Error('Specify inbound or outbound');const s=state();try{console.log(JSON.stringify(revokePeer(s,id,o.direction)));}finally{s.close();}});
const delegation=cli.command('delegation').description('Bob-native Advanced Delegation; validated settings apply to new chats');
delegation.command('config').option('--show','Show configured mode/routes, never credentials').option('--set <file>','Merge a validated JSON configuration patch; - reads stdin').option('--mode <mode>','default, model_map or profile_routes').action(async o=>{
 const s=state();try{
  if(o.show&&(o.set||o.mode))throw Error('Use --show separately from edits');
  if(!o.set&&!o.mode){console.log(describeDelegation(readDelegationConfig(s)));return;}
  let patch:unknown={};
  if(o.set){let input='';if(o.set==='-'){for await(const chunk of process.stdin){input+=chunk;if(input.length>500000)throw Error('Delegation configuration too large');}}else{if(statSync(resolve(o.set)).size>500000)throw Error('Delegation configuration too large');input=readFileSync(resolve(o.set),'utf8');}try{patch=JSON.parse(input);}catch{throw Error('Invalid delegation JSON; credential values must be supplied separately with delegation secret');}}
  if(!patch||typeof patch!=='object'||Array.isArray(patch))throw Error('Delegation patch must be a JSON object');
  if(o.mode)patch={...patch,mode:o.mode};
  const saved=await saveDelegationConfig(s,createBackendModels(s),patch);console.log(describeDelegation(saved));console.log('Saved for new chats; live inference not verified. Existing chat schemas were not changed.');
 }finally{s.close();}
});
delegation.command('behavior').description('Owner opt-in and deterministic helper bounds; off by default').option('--show','Show behavior and profile tool filters').option('--set <file>','Validated JSON patch; - reads stdin').option('--enabled <on|off>','Standing owner opt-in; never overrides allowSubagents:false').action(async o=>{
 const s=state();try{
  if(o.show&&(o.set||o.enabled))throw Error('Use --show separately from edits');
  let patch:Record<string,unknown>={};
  if(o.set){let input='';if(o.set==='-'){for await(const chunk of process.stdin){input+=chunk;if(input.length>50000)throw Error('Behavior configuration too large');}}else{if(statSync(resolve(o.set)).size>50000)throw Error('Behavior configuration too large');input=readFileSync(resolve(o.set),'utf8');}try{patch=JSON.parse(input);}catch{throw Error('Invalid behavior JSON');}if(!patch||typeof patch!=='object'||Array.isArray(patch))throw Error('Behavior patch must be an object');}
  if(o.enabled){if(!['on','off'].includes(o.enabled))throw Error('Use --enabled on or off');patch.enabled=o.enabled==='on';}
  const config=o.set||o.enabled?saveDelegationBehavior(s,patch).config:readDelegationBehavior(s);
  console.log(describeDelegationBehavior(config));console.log(JSON.stringify({profileTools:config.profileTools}));
 }finally{s.close();}
});
delegation.command('secret <name>').description('Store a dedicated profile/endpoint API key from stdin, never argv or configuration JSON').action(async name=>{
 let key='';for await(const chunk of process.stdin){key+=chunk;if(key.length>10000)throw Error('Credential too long');}
 const s=state();try{setDelegationSecret(s,name,key);console.log('Dedicated delegation credential stored; live inference not verified.');}finally{s.close();}
});
await cli.parseAsync();
