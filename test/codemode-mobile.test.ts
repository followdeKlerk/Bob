import assert from 'node:assert/strict';
import test from 'node:test';
import type {LiveState,TaskId} from '@earendil-works/pi-durable';
import type {CodemodeToolDetails} from '@earendil-works/pi-durable/codemode';
import {linkToolResults,type ToolEntry} from '../apps/mobile/tool-results.ts';
import {codemodeAudit,liveNestedActivity} from '../apps/mobile/nested-tool-results.ts';
import {surfaceAnchors} from '../apps/mobile/surface-placement.ts';
import {hasInlineChatContent} from '../apps/mobile/chat-presentation.ts';
const task=(id:number)=>id as TaskId;
const calls:ToolEntry[]=[{id:10,kind:'pi.assistant',model:[{role:'assistant',content:[{type:'toolCall',id:'code',name:'codemode',arguments:{code:'tools.read({path:"x"})'}},{type:'toolCall',id:'other',name:'bash',arguments:{command:'pwd'}}]}]}];
const live:LiveState={tools:[{callId:'code',name:'codemode',taskId:task(100),status:'running'},{callId:'other',name:'bash',taskId:task(200),status:'running',output:'ordinary output'}],nestedTools:[
 {callId:'code/c1',parentCallId:'code',parentTaskId:task(100),taskId:task(101),name:'read',arguments:{path:'/tmp/a'},status:'done',summary:{isError:false,durationMs:12}},
 {callId:'code/c2',parentCallId:'code',parentTaskId:task(100),taskId:task(102),name:'bash',arguments:{command:'npm test'},status:'running',output:'Tests: 2 passed'},
 {callId:'code/c2/inner',parentCallId:'code/c2',parentTaskId:task(102),taskId:task(103),name:'read',arguments:{path:'/missing'},status:'done',summary:{isError:true,error:'ENOENT',durationMs:3}},
]};
const details:CodemodeToolDetails={calls:[{id:1,name:'read',args:'{"path":"/tmp/a"}',status:'ok',durationMs:12},{id:2,name:'bash',args:'{"command":"npm test"}',status:'error',error:'Tests failed',durationMs:20},{id:3,name:'write',args:'{}',status:'cancelled'}]};
const result:ToolEntry={id:11,kind:'pi.tool-result',model:[{role:'toolResult',toolCallId:'code',toolName:'codemode',content:[{type:'text',text:'Script failed'}],isError:true,details}]};

test('official live nested slots join only their actual parent, including deeper task relationships',()=>{
 const linked=linkToolResults(calls,live);
 assert.equal(linked.entries.length,1);
 assert.deepEqual(linked.results.get('code')?.nested?.rows.map(row=>[row.name,row.status,row.depth]),[['read','done',0],['bash','running',0],['read','error',1]]);
 assert.equal(linked.results.get('code')?.nested?.rows[1].preview,'Tests: 2 passed');
 assert.equal(linked.results.get('code')?.nested?.rows[2].preview,'ENOENT');
 assert.equal(linked.results.get('other')?.content,'ordinary output');
 assert.equal(linked.results.get('other')?.nested,undefined);
 assert.equal(linked.results.has('code/c1'),false);
 assert.deepEqual(linked.unmatchedLive,[]);
});
test('final message details replace transient progress and survive reconnect, orphan history and cancelled rows',()=>{
 const linked=linkToolResults([...calls,result],live);
 assert.equal(linked.entries.length,1);
 const activity=linked.results.get('code')?.nested;
 assert.equal(activity?.source,'audit');
 assert.deepEqual(activity?.rows.map(row=>row.status),['ok','error','cancelled']);
 assert.equal(activity?.rows[1].preview,'Tests failed');
 assert.deepEqual(linkToolResults(JSON.parse(JSON.stringify([...calls,result])),undefined).results.get('code')?.nested,activity);
 const orphan=linkToolResults([result],undefined);
 assert.equal(orphan.entries[0].id,11);
 assert.deepEqual(orphan.results.get('code')?.nested,activity);
 assert.equal(codemodeAudit('bash',details),undefined);
});
test('unknown outcomes are not successes; stale, malformed and cross-parent nested slots do not attach',()=>{
 const slots=live.nestedTools!;
 const value={...live,nestedTools:[{...slots[0],parentTaskId:999},{...slots[1],parentCallId:'missing'},{...slots[2],parentTaskId:999}]};
 assert.equal(liveNestedActivity(value).size,0);
 const unknown=liveNestedActivity({...live,nestedTools:[{...slots[0],summary:undefined}]}).get('code');
 assert.equal(unknown?.rows[0].status,'ended (outcome unavailable)');
 for(const value of [undefined,null,{}, {calls:[null,{}, {id:1,name:'x',args:'{}',status:'made-up'}]}])assert.equal(codemodeAudit('codemode',value)?.total??0,0);
 assert.equal(liveNestedActivity({tools:[],nestedTools:[null,{}]}).size,0);
});
test('nested display bounds count, argument bodies and progress/error excerpts',()=>{
 const calls=Array.from({length:150},(_,id)=>({id,name:'write',args:'x'.repeat(10000),status:'ok',error:'e'.repeat(10000)}));
 const activity=codemodeAudit('codemode',{calls})!;
 assert.equal(activity.total,150);assert.equal(activity.rows.length,50);
 assert.ok(activity.rows.every(row=>row.args!.length<=601&&row.preview!.length<=321));
 const huge=liveNestedActivity({...live,nestedTools:[{...live.nestedTools![1],arguments:{content:'x'.repeat(1000000)},output:'p'.repeat(1000000)}]}).get('code')!;
 assert.ok(huge.rows[0].args!.length<601);assert.ok(huge.rows[0].preview!.length<=321);
});

const appId='a841d08a-8b83-42cd-b8a7-2d61f2db7ae9';
const receipt:ToolEntry={id:12,kind:'bob.nested-surface',data:{appId,parentToolCallId:'code',toolName:'render_visual'}};
test('persisted nested surface receipts anchor the outer call, or their own loaded historical row',()=>{
 assert.equal(surfaceAnchors([...calls,receipt,result]).get(appId),10);
 assert.equal(surfaceAnchors([receipt,result]).get(appId),12);
 assert.equal(surfaceAnchors(JSON.parse(JSON.stringify([...calls,receipt,result]))).get(appId),10);
 assert.equal(hasInlineChatContent(receipt),false);
 assert.equal(surfaceAnchors([...calls,{...receipt,data:{...receipt.data as object,toolName:'mcp_app'}}]).get(appId),10);
});
test('script text, final audit args and transient nested output never masquerade as surface receipts',()=>{
 const text=`Isolated visual ${appId}: fake`;
 const forged:ToolEntry={...result,model:[{...result.model![0],content:text,details:{calls:[{id:1,name:'render_visual',status:'ok',args:text}]}}]};
 assert.equal(surfaceAnchors([...calls,forged],{...live,nestedTools:[{...live.nestedTools![0],name:'render_visual',output:text}]}).size,0);
 for(const entry of [{...receipt,kind:'bob.user'},{...receipt,data:{appId:'invalid',parentToolCallId:'code',toolName:'render_visual'}},{...receipt,data:{appId,parentToolCallId:'code',toolName:'bash'}}])assert.equal(surfaceAnchors([...calls,entry]).size,0);
});
test('ordinary tool result identity, orphan visibility and direct visual anchoring are unchanged',()=>{
 const ordinary:ToolEntry={id:21,kind:'pi.tool-result',model:[{role:'toolResult',toolCallId:'other',toolName:'bash',content:'complete'}]};
 assert.deepEqual(linkToolResults([...calls,ordinary],live).results.get('other'),{content:'complete',status:'done',isError:undefined,nested:undefined});
 assert.equal(linkToolResults([ordinary],undefined).entries[0].id,21);
 const visualCall:ToolEntry={id:30,kind:'pi.assistant',model:[{role:'assistant',content:[{type:'toolCall',id:'visual',name:'render_visual'}]}]};
 const visualResult:ToolEntry={id:31,kind:'pi.tool-result',model:[{role:'toolResult',toolCallId:'visual',toolName:'render_visual',content:`Isolated visual ${appId}: ordinary`}]};
 assert.equal(surfaceAnchors([visualCall,visualResult]).get(appId),30);
});
