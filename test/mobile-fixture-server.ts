// Isolated emulator acceptance fixture: real HTTP/Harness/SQLite, deterministic MODEL ONLY.
// Never packaged or described as live inference. No real provider credential is loaded.
import {setTimeout as delay} from 'node:timers/promises';
import type {ConversationId} from '@earendil-works/pi-durable';
import {State} from '../src/state.js';
import {serve} from '../src/server.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {ChatMeta} from '../src/documents.js';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
import {createMcpFixture} from './mcp-fixture.js';
const state = new State(process.env.BOB_FIXTURE_STATE??'./docs/mobile-state');
const port=Number(process.env.BOB_FIXTURE_PORT??49158);
if(!Number.isSafeInteger(port)||port<1024||port>65535)throw Error('Invalid disposable fixture port');
state.set('model', {provider:'faux',modelId:'faux-1'});
state.set('mcpConnections',[{id:'fixture',endpoint:'http://127.0.0.1:49160/mcp',enabled:true,allowedTools:['show','increment']}]);
const mcp=await createMcpFixture();
const models=createModels(), faux=fauxProvider({tokensPerSecond:80});models.setProvider(faux.provider);
faux.setResponses(Array.from({length:100},()=>async context=>{
  const last=context.messages.at(-1);
  if(last?.role==='toolResult') return fauxAssistantMessage('DETERMINISTIC MODEL ONLY: a real backend tool completed. Inspect its recorded result.');
  const user=[...context.messages].reverse().find(m=>m.role==='user');
  const text=JSON.stringify(user?.content??'').toLowerCase();
  if(text.includes('long child fixture')||text.includes('long root fixture'))return fauxAssistantMessage('DETERMINISTIC STREAMING WORK FIXTURE '.repeat(3000));
  await delay(10000);
  if(text.includes('custom fixture'))return fauxAssistantMessage(fauxToolCall('native_custom_counter',{}),{stopReason:'toolUse'});
  if(text.includes('spawn fixture'))return fauxAssistantMessage(fauxToolCall('subagent',{action:'spawn',name:'Fixture child',message:'long child fixture'}),{stopReason:'toolUse'});
  if(text.includes('question')) return fauxAssistantMessage(fauxToolCall('ask_user',{question:'DETERMINISTIC TEST: which fixture should run next?'}),{stopReason:'toolUse'});
  if(text.includes('mcp')) return fauxAssistantMessage(fauxToolCall('mcp_app',{serverId:'fixture',tool:'show',arguments:{}}),{stopReason:'toolUse'});
  if(text.includes('visual')) return fauxAssistantMessage(fauxToolCall('render_visual',{title:'Isolated visual fixture',html:'<body style="background:#101916;color:#edf4f0;font:22px sans-serif;padding:24px"><h1>Isolated visual</h1><p>No network, files or backend tools.</p><button style="font-size:22px;padding:16px" onclick="this.textContent=\'Interaction verified\'">Test local interaction</button></body>'}),{stopReason:'toolUse'});
  if(text.includes('failure')) return fauxAssistantMessage('DETERMINISTIC TEST FAILURE',{stopReason:'error',errorMessage:'Explicit fixture failure, not a live provider failure'});
  return fauxAssistantMessage('DETERMINISTIC TEST ONLY: the real Durable admission completed. This is not a live-model response.');
}));
const runtime=await openRuntime(state,models,mcp.transport);
if(process.env.BOB_HISTORY_FIXTURE==='1'&&!state.get('historyFixture')) {
 const history=await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
 await history.commit(async tx=>{for(let index=0;index<235;index++)await tx.appendEntry(history.id,{kind:'bob.history-fixture',data:{text:`DETERMINISTIC HISTORY FIXTURE ${index}`}});},ctx);
 await history.reset(undefined,ctx);
 await history.commit(async tx=>{(await tx.doc(ChatMeta,history.id)).title='History fixture (250 records)';for(let index=235;index<250;index++)await tx.appendEntry(history.id,{kind:'bob.history-fixture',data:{text:`DETERMINISTIC HISTORY FIXTURE ${index}`}});},ctx);
 state.set('historyFixture',history.id);console.log('Native stored-history fixture conversation',history.id);
}
if(process.env.BOB_CHILD_HISTORY_FIXTURE){
 const id=Number(process.env.BOB_CHILD_HISTORY_FIXTURE);if(!Number.isSafeInteger(id)||id<=0)throw Error('Invalid child fixture id');
 if(!state.get(`childHistoryFixture:${id}`)){
  const child=await runtime.harness.conversation(id as ConversationId,ctx);if(!child)throw Error('Existing native child fixture required');
  await child.reset(undefined,ctx);await child.waitForIdle(ctx);
  await child.commit(async tx=>{for(let index=0;index<120;index++)await tx.appendEntry(child.id,{kind:'bob.child-history-fixture',data:{text:`DETERMINISTIC CHILD HISTORY FIXTURE ${String(index).padStart(3,'0')}`}});},ctx);
  state.set(`childHistoryFixture:${id}`,true);
 }
}
const host=process.env.BOB_FIXTURE_HOST??'127.0.0.1';
const tls=process.env.BOB_FIXTURE_CERT&&process.env.BOB_FIXTURE_KEY?{cert:process.env.BOB_FIXTURE_CERT,key:process.env.BOB_FIXTURE_KEY}:undefined;
const app=await serve(state,{port,host,tls,runtime});
if(process.env.BOB_DROP_NEXT_MESSAGE_RESPONSE==='1'){
 let armed=true;
 app.server.on('request',(request,response)=>{
  if(request.method!=='POST'||!/^\/v1\/chats\/\d+\/messages$/.test(request.url??''))return;
  const end=response.end.bind(response);
  response.end=((...args:any[])=>{
   if(armed&&response.statusCode===202){armed=false;state.set('faultDroppedMessageResponses',(state.get<number>('faultDroppedMessageResponses')??0)+1);request.socket.destroy();return response;}
   return (end as any)(...args);
  }) as typeof response.end;
 });
}
console.log('DETERMINISTIC MODEL fixture serving real Bob backend',{host,port,tls:!!tls});
let stopping=false;
async function close(){if(stopping)return;stopping=true;await app.close();await mcp.close();state.close();process.exit(0)}
process.on('SIGTERM',()=>void close());process.on('SIGINT',()=>void close());
