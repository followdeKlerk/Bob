import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {McpServer,createMcpHandler} from '@modelcontextprotocol/server';
import {RESOURCE_MIME_TYPE} from '@modelcontextprotocol/ext-apps/app-bridge';
import {z} from 'zod';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';

test('authenticated actual MCP HTTP transport preserves unknown outcome without SDK or runtime resend',{timeout:45000},async()=>{
 let counter=0,authorized=0,denied=0,drop=false;
 let acceptedKey=randomUUID();
 const handler=createMcpHandler(()=>{
  const server=new McpServer({name:'Real HTTP fixture',version:'1.0.0'});
  server.registerTool('show',{inputSchema:z.object({}),_meta:{ui:{resourceUri:'ui://http/counter',visibility:['model']}}},async()=>({content:[{type:'text',text:`Counter ${counter}`}],structuredContent:{count:counter}}));
  server.registerTool('increment',{inputSchema:z.object({}),_meta:{ui:{visibility:['app']}}},async()=>({content:[{type:'text',text:`Counter ${++counter}`}],structuredContent:{count:counter}}));
  server.registerResource('counter','ui://http/counter',{mimeType:RESOURCE_MIME_TYPE},async()=>({contents:[{uri:'ui://http/counter',mimeType:RESOURCE_MIME_TYPE,text:'<h1>Actual authenticated HTTP MCP resource</h1>'}]}));
  return server;
 },{responseMode:'json',keepAliveMs:0});
 const http=createServer(async(req,res)=>{
  if(req.headers.authorization!=='Bearer '+acceptedKey){denied++;res.writeHead(401);res.end('Unauthorized');return;}
  authorized++;
  try{
   const chunks:Buffer[]=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>1048576)throw Error('Fixture request too large');chunks.push(chunk);}
   const headers=new Headers();for(const [key,value]of Object.entries(req.headers))if(value!==undefined)for(const item of Array.isArray(value)?value:[value])headers.append(key,item);
   const before=counter;
   const request=new Request(`http://127.0.0.1:${(http.address() as any).port}/mcp`,{method:req.method,headers,...(req.method==='GET'||req.method==='HEAD'?{}:{body:new Uint8Array(Buffer.concat(chunks))})});
   const response=await handler.fetch(request),body=Buffer.from(await response.arrayBuffer());
   if(drop&&counter>before){drop=false;req.socket.destroy();return;}
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(body);
  }catch{req.socket.destroy();}
 });
 http.listen(0,'127.0.0.1');await once(http,'listening');
 const endpoint=`http://127.0.0.1:${(http.address() as any).port}/mcp`;
 const state=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-mcp-http-')));
 state.set('mcpConnections',[{id:'http-fixture',endpoint,enabled:true,allowedTools:['show','increment']}]);state.set('mcpKey:http-fixture',acceptedKey);
 const models=createModels(),faux=fauxProvider();models.setProvider(faux.provider);
 faux.setResponses([fauxAssistantMessage([fauxToolCall('mcp_app',{serverId:'http-fixture',tool:'show',arguments:{}})],{stopReason:'toolUse'}),fauxAssistantMessage('DETERMINISTIC MODEL ONLY: real HTTP resource registered.')]);
 let runtime=await openRuntime(state,models);
 try{
  assert.equal((await fetch(endpoint)).status,401);
  const chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);
  await chat.submit({type:'input',content:'Create actual HTTP MCP fixture'},ctx);await chat.waitForIdle(ctx);
  const surfaces=await runtime.interactive.list(runtime.harness,chat);assert.equal(surfaces.length,1);
  const surface=surfaces[0],device=state.pair(state.invite().token,'HTTP MCP observer').deviceId;
  const opened=await runtime.interactive.open(runtime.harness,chat,surface.id,device);
  const input={capability:opened.capability,requestId:randomUUID(),name:'increment',arguments:{}};
  const result=await runtime.interactive.call(runtime.harness,chat,surface.id,device,input);assert.equal(result.structuredContent?.count,1);assert.equal(counter,1);
  drop=true;const lost={...input,requestId:randomUUID()};
  await assert.rejects(runtime.interactive.call(runtime.harness,chat,surface.id,device,lost),/no automatic resend/);assert.equal(counter,2);
  const requestCount=authorized;
  await assert.rejects(runtime.interactive.call(runtime.harness,chat,surface.id,device,lost),/no automatic resend/);assert.equal(counter,2);assert.equal(authorized,requestCount);
  await runtime.close();runtime=await openRuntime(state,models);
  const restored=(await runtime.harness.conversation(chat.id,ctx))!,reopened=await runtime.interactive.open(runtime.harness,restored,surface.id,device);
  await assert.rejects(runtime.interactive.call(runtime.harness,restored,surface.id,device,{...lost,capability:reopened.capability}),/no automatic resend/);assert.equal(counter,2);assert.equal(authorized,requestCount);
  acceptedKey=randomUUID();
  await assert.rejects(runtime.interactive.call(runtime.harness,restored,surface.id,device,{...input,requestId:randomUUID(),capability:reopened.capability}),/no automatic resend/);assert.equal(counter,2);assert.ok(denied>=2);
 }finally{await runtime.close();state.close();await handler.close();http.closeAllConnections();await new Promise<void>(resolve=>http.close(()=>resolve()));}
});
