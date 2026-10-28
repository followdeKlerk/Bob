import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {McpServer,InMemoryTransport} from '@modelcontextprotocol/server';
import {z} from 'zod';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {McpToolOperations,createMcpTool} from '../src/mcp-tools.js';

test('ordinary MCP discovery/calls are allowlisted, distinct from Apps, and persist without surfaces',{timeout:45000},async()=>{
 const state=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-mcp-tools-')));
 state.set('mcpConnections',[{id:'docs',endpoint:'http://127.0.0.1:49160/mcp',enabled:true,allowedTools:['lookup']}]);
 let calls=0;const servers:McpServer[]=[];
 const transport=async()=>{
  const server=new McpServer({name:'Plain docs',version:'1.0.0'});servers.push(server);
  server.registerTool('lookup',{description:'Look up current docs',inputSchema:z.object({query:z.string()})},async({query})=>({content:[{type:'text',text:`Documentation: ${query}`}],structuredContent:{calls:++calls}}));
  server.registerTool('secret',{inputSchema:z.object({})},async()=>{throw Error('must never call');});
  const [client,remote]=InMemoryTransport.createLinkedPair();await server.connect(remote);return client;
 };
 const models=createModels(),faux=fauxProvider();models.setProvider(faux.provider);
 const responses=(args:Record<string,unknown>,tool='mcp_tool')=>[fauxAssistantMessage([fauxToolCall(tool,args)],{stopReason:'toolUse'}),fauxAssistantMessage('fixture complete')];
 faux.setResponses([
  ...responses({action:'list',serverId:'docs'}),
  ...responses({action:'call',serverId:'docs',tool:'lookup',arguments:{query:'React effects'}}),
  ...responses({action:'call',serverId:'docs',tool:'secret'}),
  ...responses({serverId:'docs',tool:'lookup',arguments:{query:'React effects'}},'mcp_app'),
 ]);
 let runtime=await openRuntime(state,models,transport);
 try{
  const chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);
  for(const content of ['list','call','denied','not an App']){await chat.submit({type:'input',content},ctx);await chat.waitForIdle(ctx);}
  assert.equal(calls,1);
  const doc=await runtime.harness.snapshot(McpToolOperations,chat.id,ctx);
  assert.equal(Object.keys(doc!.operations).length,1);
  const op=Object.values(doc!.operations)[0];assert.equal(op.status,'done');assert.equal(op.tool,'lookup');assert.match(JSON.stringify(op.result),/React effects/);
  assert.deepEqual(await runtime.interactive.list(runtime.harness,chat),[]);
  await runtime.close();runtime=await openRuntime(state,models,transport);
  assert.deepEqual(await runtime.harness.snapshot(McpToolOperations,chat.id,ctx),doc);assert.equal(calls,1);
 }finally{await runtime.close();state.close();await Promise.all(servers.map(s=>s.close()));}
});

test('ordinary MCP replay returns saved result or refuses unknown outcome without resend',async()=>{
 const state={get:<T>(key:string):T|undefined=>(key==='mcpConnections'?[{id:'docs',endpoint:'http://127.0.0.1:49160/mcp',enabled:true,allowedTools:['lookup']}]:undefined) as T|undefined};
 let connections=0;const tool=createMcpTool(state,async()=>{connections++;throw Error('must not reconnect');});
 const args={action:'call' as const,serverId:'docs',tool:'lookup',arguments:{}};
 const api={taskId:'existing',conversationId:1,snapshot:async()=>({operations:{existing:{status:'done',result:{content:[{type:'text',text:'saved'}]}}}})};
 const result=await tool.execute!(args,api as any,ctx);assert.match(JSON.stringify(result),/saved/);assert.equal(connections,0);
 api.snapshot=async()=>({operations:{existing:{status:'started'}}}) as any;
 await assert.rejects(tool.execute!(args,api as any,ctx),/unknown/);assert.equal(connections,0);
});

test('burger menu no longer exposes MCP configuration',()=>{
 const source=readFileSync('apps/mobile/App.tsx','utf8');assert.doesNotMatch(source,/\{id:'MCP Apps',icon:/);
});
