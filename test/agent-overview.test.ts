import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {InboxDoc,LiveDoc,defineExtension,defineTask,type Conversation,type ConversationId} from '@earendil-works/pi-durable';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {serve} from '../src/server.js';
import {ChatMeta} from '../src/documents.js';
import {Subagents} from '../src/subagents.js';
import {SessionUI} from '../src/session-controls.js';
import {RetiredChat} from '../src/retired-chat-profile.js';
import {encodeCursor} from '../src/pagination.js';
import {AGENT_OVERVIEW_PAGE_SIZE,type AgentOverview,type AgentOverviewFilter} from '../src/agent-overview.js';

const held=defineTask<null,{phase:'hold'},null>({name:'test.agent-overview-held',version:1,initial:()=>({phase:'hold'}),phases:{hold:async()=>{throw Error('Read-only overview must not execute a task');}},abort:async()=>{throw Error('Read-only overview must not abort a task');}});
const missing=defineTask<null,{phase:'hold'},null>({...held.definition,name:'test.agent-overview-missing'});
async function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'bob-agent-overview-')),state=new State(dir),runtime=await openRuntime(state,undefined,undefined,{resume:false});
 runtime.registry.install(defineExtension({name:'test.agent-overview',tasks:[held]}));
 const app=await serve(state,{port:0,runtime}),pair=state.pair(state.invite().token,'Agent overview test');
 const headers={authorization:`Bearer ${pair.credential}`,'x-bob-backend':state.id},base=`http://127.0.0.1:${(app.server.address() as any).port}/v1`;
 const create=(title:string)=>runtime.harness.createConversation({ownership:{kind:'ownerless'},init:async(tx,id)=>{(await tx.doc(ChatMeta,id)).title=title;}},ctx);
 const request=(suffix='',options:RequestInit={})=>fetch(base+'/agent-overview'+suffix,{headers,...options});
 async function overview(cursor?:string,filter?:AgentOverviewFilter){const query=new URLSearchParams();if(cursor)query.set('cursor',cursor);if(filter)query.set('filter',filter);const response=await request('?'+query);assert.equal(response.status,200,await response.clone().text());return await response.json() as AgentOverview;}
 async function child(parent:Conversation,name:string){
  const taskId=await parent.commit(tx=>tx.createTask(held,null,{ownership:{kind:'conversation'},background:true}),ctx);
  const child=await runtime.harness.createConversation({ownership:{kind:'task',taskId}},ctx);
  await parent.commit(async tx=>{(await tx.doc(Subagents,parent.id)).agents[name]={conversationId:child.id,reported:[]};},ctx);
  return child;
 }
 return {dir,state,runtime,app,base,headers,create,child,request,overview,async close(){await app.close();state.close();rmSync(dir,{recursive:true,force:true});}};
}
function durableContents(dir:string){
 const db=new DatabaseSync(join(dir,'durable.sqlite'),{readOnly:true});
 try{return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>[String(row.name),db.prepare(`SELECT * FROM "${String(row.name).replaceAll('"','""')}"`).all()]));}finally{db.close();}
}

test('overview authenticates, scopes same-name children to native parents, and reads without writes or transcript payloads',{timeout:30000},async()=>{
 const f=await fixture();try{
  const first=await f.create('First owner'),second=await f.create('Second owner');
  const a=await f.child(first,'worker'),b=await f.child(second,'worker'),stopping=await f.child(first,'stopping');
  await b.commit(tx=>tx.createTask(held,null,{ownership:{kind:'conversation'},background:true}),ctx);
  const stopTask=await stopping.commit(tx=>tx.createTask(held,null,{ownership:{kind:'conversation'}}),ctx);
  await f.runtime.harness.abortTask(stopTask,ctx);
  await first.commit(async tx=>{
   const registry=await tx.doc(Subagents,first.id);
   registry.agents['other parent']={conversationId:b.id,reported:[]};
   registry.agents['ownerless impostor']={conversationId:second.id,reported:[]};
   registry.agents['missing child']={conversationId:999999 as ConversationId,reported:[]};
   const input=await tx.createSubmission({conversationId:first.id,type:'input',status:'queued'});
   (await tx.doc(InboxDoc,first.id)).items.push({id:input.id,mode:'followUp',content:'PRIVATE QUEUED INPUT'});
   (await tx.doc(SessionUI,first.id)).pinned=true;
   await tx.appendEntry(first.id,{kind:'fixture.private-transcript',data:{text:'PRIVATE TRANSCRIPT CONTENT'}});
  },ctx);
  const before=durableContents(f.dir),control=f.state.db.prepare('SELECT * FROM config ORDER BY key').all();
  const inspection=await f.runtime.harness.inspect(ctx);assert.equal(inspection.scheduling,'paused');
  const originalInspect=f.runtime.harness.inspect.bind(f.runtime.harness);let inspections=0;
  f.runtime.harness.inspect=async context=>{inspections++;return originalInspect(context);};
  assert.equal((await f.request('',{headers:{}})).status,401);
  assert.equal((await f.request('',{headers:{...f.headers,'x-bob-backend':'wrong'}})).status,409);
  assert.equal(inspections,0,'authentication precedes inspection');
  const page=await f.overview();assert.equal(inspections,1,'one point-in-time inspection for all sessions');
  assert.equal(page.backendId,f.state.id);assert.equal(page.next,undefined);
  assert.deepEqual(page.sessions,[
   {conversationId:second.id,title:'Second owner',status:'idle',agents:[{name:'worker',conversationId:b.id,status:'idle'}]},
   {conversationId:first.id,title:'First owner',status:'working',agents:[{name:'worker',conversationId:a.id,status:'idle'},{name:'stopping',conversationId:stopping.id,status:'stopping'}],pinned:true},
  ]);
  assert.doesNotMatch(JSON.stringify(page),/PRIVATE|reported|reporters|entries|messages|generation|timestamp/);
  assert.equal((await f.request('',{method:'POST',body:'{}'})).status,404);
  assert.deepEqual(await originalInspect(ctx),inspection,'neither scheduling nor work changed');
  assert.deepEqual(durableContents(f.dir),before,'every native table, including documents and transcripts, is unchanged');
  assert.deepEqual(f.state.db.prepare('SELECT * FROM config ORDER BY key').all(),control);
  const foreground=await first.commit(tx=>tx.createTask(held,null,{ownership:{kind:'conversation'}}),ctx);
  const background=await second.commit(tx=>tx.createTask(held,null,{ownership:{kind:'conversation'},background:true}),ctx);
  await f.runtime.harness.abortTask(foreground,ctx);await f.runtime.harness.abortTask(background,ctx);
  const updated=(await f.overview()).sessions;
  assert.equal(updated.find(session=>session.conversationId===first.id)?.status,'stopping','foreground parent abort overrides pending input');
  assert.equal(updated.find(session=>session.conversationId===second.id)?.status,'idle','even abort-marked background watchers do not make a parent busy');
 }finally{await f.close();}
});

test('overview filters library, trash and retired histories; archived sessions survive only for active work',{timeout:30000},async()=>{
 const f=await fixture();try{
  const idle=await f.create('Idle'),archived=await f.create('Archived idle'),busy=await f.create('Archived active child'),live=await f.create('Live run'),unknown=await f.create('Blocked foreground'),trashed=await f.create('Trashed active'),retired=await f.create('Read-only retired');
  for(const chat of [archived,busy])await chat.commit(async tx=>{(await tx.doc(SessionUI,chat.id)).archived=true;},ctx);
  await trashed.commit(async tx=>{(await tx.doc(SessionUI,trashed.id)).trashed=true;await tx.createTask(held,null,{ownership:{kind:'conversation'}});},ctx);
  await retired.commit(async tx=>{(await tx.doc(RetiredChat,retired.id)).profile='restricted-local';},ctx);
  const worker=await f.child(busy,'active'),hidden=await f.child(idle,'retired'),trashChild=await f.child(idle,'trashed'),archiveChild=await f.child(idle,'archived');
  await hidden.commit(async tx=>{(await tx.doc(RetiredChat,hidden.id)).profile='restricted-local';},ctx);
  await trashChild.commit(async tx=>{(await tx.doc(SessionUI,trashChild.id)).trashed=true;},ctx);
  await archiveChild.commit(async tx=>{(await tx.doc(SessionUI,archiveChild.id)).archived=true;},ctx);
  await worker.commit(tx=>tx.createTask(held,null,{ownership:{kind:'conversation'}}),ctx);
  await unknown.commit(tx=>tx.createTask(missing,null,{ownership:{kind:'conversation'}}),ctx);
  await live.commit(async tx=>{
   const taskId=await tx.createTask(held,null,{ownership:{kind:'conversation'},background:true});
   (await tx.doc(LiveDoc,live.id)).run={taskId,inputs:[],turns:0};
  },ctx);
  const sessions=(await f.overview()).sessions;
  assert.deepEqual(sessions.map(s=>s.conversationId),[unknown.id,live.id,busy.id,idle.id]);
  assert.equal(sessions[0].status,'unknown');assert.equal(sessions[1].status,'working','LiveDoc is authoritative even with no foreground inspection task');
  assert.deepEqual(sessions[2].agents,[{name:'active',conversationId:worker.id,status:'working'}]);
  assert.deepEqual(sessions[3].agents,[]);
 }finally{await f.close();}
});

test('overview pagination never drops overflow roots after owned children; cursors are signed and purpose scoped',{timeout:30000},async()=>{
 const f=await fixture();try{
  const roots:Conversation[]=[];for(let i=0;i<45;i++)roots.push(await f.create(`Root ${i}`));
  // First raw batch: 15 owned children + 15 roots. A fixed-size second
  // batch followed by slice(0,30) would silently discard the oldest 15 roots.
  for(let i=0;i<15;i++)await f.child(roots[0],`child ${i}`);
  const nativeBefore=durableContents(f.dir);
  const first=await f.overview();assert.equal(first.sessions.length,AGENT_OVERVIEW_PAGE_SIZE);assert.ok(first.next);
  const second=await f.overview(first.next);assert.equal(second.sessions.length,15);assert.equal(second.next,undefined);
  assert.deepEqual(durableContents(f.dir),nativeBefore,'pagination is also read-only over all native tables');
  assert.deepEqual([...first.sessions,...second.sessions].map(s=>s.conversationId),roots.map(c=>c.id).toReversed());
  for(const token of [first.next+'x','not-a-cursor',encodeCursor(f.state,'chats',{after:roots[0].id,order:'descending'})!])assert.equal((await f.request('?cursor='+encodeURIComponent(token))).status,400);
  assert.equal((await fetch(f.base+'/chats?cursor='+encodeURIComponent(first.next),{headers:f.headers})).status,400);
  // A bounded sparse request can return no roots, but must still let the
  // caller cross the owned-child gap and eventually reach every root.
  for(let i=0;i<305;i++)await f.child(roots[0],`gap ${i}`);
  let page=await f.overview();assert.deepEqual(page.sessions,[]);assert.ok(page.next);
  const seen:ConversationId[]=[];let pages=1;
  while(page.next){page=await f.overview(page.next);seen.push(...page.sessions.map(s=>s.conversationId));assert.ok(page.sessions.length<=30);assert.ok(++pages<10);}
  assert.deepEqual(seen,roots.map(c=>c.id).toReversed());
 }finally{await f.close();}
});

test('live HTTP and SSE subagent statuses match overview for background watchers, pending inputs and foreground aborts',{timeout:30000},async()=>{
 const f=await fixture();try{
  const parent=await f.create('Live status parent');
  const watcher=await f.child(parent,'watcher'),queued=await f.child(parent,'queued'),placed=await f.child(parent,'placed'),continued=await f.child(parent,'continue'),passive=await f.child(parent,'passive'),stopping=await f.child(parent,'stopping');
  const background=await watcher.commit(tx=>tx.createTask(held,null,{ownership:{kind:'conversation'},background:true}),ctx);
  await f.runtime.harness.abortTask(background,ctx);
  await queued.commit(async tx=>{
   const input=await tx.createSubmission({conversationId:queued.id,type:'input',status:'queued'});
   (await tx.doc(InboxDoc,queued.id)).items.push({id:input.id,mode:'followUp',content:'Queued fixture'});
  },ctx);
  await placed.commit(async tx=>{
   const entry=await tx.appendEntry(placed.id,{kind:'pi.user',data:{content:'Placed fixture'}});
   await tx.createSubmission({conversationId:placed.id,type:'input',status:'placed',entry:entry.id});
  },ctx);
  await continued.commit(tx=>tx.createSubmission({conversationId:continued.id,type:'continue',status:'placed'}),ctx);
  await passive.commit(tx=>tx.createSubmission({conversationId:passive.id,type:'write',status:'queued'}),ctx);
  const foreground=await stopping.commit(tx=>tx.createTask(held,null,{ownership:{kind:'conversation'}}),ctx);
  await f.runtime.harness.abortTask(foreground,ctx);
  await stopping.commit(tx=>tx.createSubmission({conversationId:stopping.id,type:'input',status:'queued'}),ctx);
  const before=durableContents(f.dir),expected={watcher:'idle',queued:'working',placed:'working',continue:'working',passive:'idle',stopping:'stopping'};
  const statuses=(agents:Record<string,{status:string}>)=>Object.fromEntries(Object.entries(agents).map(([name,agent])=>[name,agent.status]));
  const overview=(await f.overview()).sessions.find(session=>session.conversationId===parent.id)!;
  assert.deepEqual(Object.fromEntries(overview.agents.map(agent=>[agent.name,agent.status])),expected);
  const endpoint=f.base+`/chats/${parent.id}`,response=await fetch(endpoint,{headers:f.headers});
  assert.equal(response.status,200);const snapshot=await response.json();
  assert.deepEqual(statuses(snapshot.view.docs['app.subagents'].agents),expected);
  const controller=new AbortController();
  try{
   const stream=await fetch(endpoint+'/events',{headers:f.headers,signal:controller.signal});assert.equal(stream.status,200);
   const reader=stream.body!.getReader(),decoder=new TextDecoder();let packet='';
   while(!packet.includes('\n\n')){const chunk=await reader.read();assert.equal(chunk.done,false);packet+=decoder.decode(chunk.value,{stream:true});}
   const frame=JSON.parse(packet.slice(0,packet.indexOf('\n\n')).split('\n').find(line=>line.startsWith('data: '))!.slice(6));
   assert.deepEqual(statuses(frame.view.docs['app.subagents'].agents),expected);
  }finally{controller.abort();}
  assert.equal((await f.runtime.harness.inspect(ctx)).scheduling,'paused');
  assert.deepEqual(durableContents(f.dir),before,'overview and live presentations remain read-only');
 }finally{await f.close();}
});

test('explicit Sessions filters partition root flags, preserve native helper ownership, and include inert retired histories',{timeout:30000},async()=>{
 const f=await fixture();try{
  const normal=await f.create('Normal'),archived=await f.create('Archived working'),trash=await f.create('Trashed working');
  const retired=await f.create('Retired'),retiredArchived=await f.create('Retired archive'),retiredTrash=await f.create('Retired trash');
  for(const chat of [archived,retiredArchived])await chat.commit(async tx=>{(await tx.doc(SessionUI,chat.id)).archived=true;},ctx);
  for(const chat of [trash,retiredTrash])await chat.commit(async tx=>{Object.assign(await tx.doc(SessionUI,chat.id),{archived:true,trashed:true});},ctx);
  for(const chat of [archived,trash,retired])await chat.commit(tx=>tx.createTask(held,null,{ownership:{kind:'conversation'}}),ctx);
  const worker=await f.child(normal,'worker'),other=await f.child(archived,'other'),trashWorker=await f.child(trash,'trash worker');
  await f.child(retired,'inert');
  await worker.commit(tx=>tx.createSubmission({conversationId:worker.id,type:'continue',status:'queued'}),ctx);
  // Matching flags must never promote owned children into Sessions roots.
  await other.commit(async tx=>{(await tx.doc(SessionUI,other.id)).archived=true;},ctx);
  await trashWorker.commit(async tx=>{(await tx.doc(SessionUI,trashWorker.id)).trashed=true;},ctx);
  await normal.commit(async tx=>{
   const registry=await tx.doc(Subagents,normal.id);
   for(const [name,id] of [['foreign',other.id],['ownerless',archived.id],['library',f.runtime.library.id],['missing',999999 as ConversationId]] as const)registry.agents[name]={conversationId:id,reported:[]};
   (await tx.doc(SessionUI,normal.id)).pinned=true;
  },ctx);
  // A retired parent's stale registry must not surface even a real native child.
  for(const chat of [retired,retiredArchived,retiredTrash])await chat.commit(async tx=>{(await tx.doc(RetiredChat,chat.id)).profile='restricted-local';},ctx);
  const before=durableContents(f.dir);
  assert.deepEqual((await f.overview(undefined,'all')).sessions,[
   {conversationId:retired.id,title:'Retired',status:'working',agents:[],pinned:false,archived:false,trashed:false,readOnly:true},
   {conversationId:normal.id,title:'Normal',status:'idle',agents:[{name:'worker',conversationId:worker.id,status:'working'}],pinned:true,archived:false,trashed:false,readOnly:false},
  ]);
  assert.deepEqual((await f.overview(undefined,'archived')).sessions,[
   {conversationId:retiredArchived.id,title:'Retired archive',status:'idle',agents:[],pinned:false,archived:true,trashed:false,readOnly:true},
   {conversationId:archived.id,title:'Archived working',status:'working',agents:[],pinned:false,archived:true,trashed:false,readOnly:false},
  ]);
  assert.deepEqual((await f.overview(undefined,'trash')).sessions,[
   {conversationId:retiredTrash.id,title:'Retired trash',status:'idle',agents:[],pinned:false,archived:true,trashed:true,readOnly:true},
   {conversationId:trash.id,title:'Trashed working',status:'working',agents:[],pinned:false,archived:true,trashed:true,readOnly:false},
  ]);
  assert.deepEqual(durableContents(f.dir),before,'explicit filtered summaries perform no native writes');
  for(const chat of [retired,retiredArchived,retiredTrash])assert.equal((await fetch(f.base+`/chats/${chat.id}`,{headers:f.headers})).status,200,'retired histories remain openable');
  for(const filter of ['all','archived','trash'] as const){
   await f.runtime.library.commit(async tx=>{Object.assign(await tx.doc(SessionUI,f.runtime.library.id),{archived:filter==='archived',trashed:filter==='trash'});},ctx);
   assert.ok(!(await f.overview(undefined,filter)).sessions.some(session=>session.conversationId===f.runtime.library.id),'library is hidden even with matching flags');
  }
  for(const filter of ['','invalid','ALL','trashed'])assert.equal((await f.request('?filter='+filter)).status,400);
  assert.equal((await f.request('?filter=trash',{headers:{}})).status,401);
 }finally{await f.close();}
});

test('Sessions archive, trash and restore metadata moves history between explicit filters without deleting it',{timeout:30000},async()=>{
 const f=await fixture();try{
  const chat=await f.create('Recoverable');
  await chat.commit(tx=>tx.appendEntry(chat.id,{kind:'fixture.history',data:{text:'Retained history'}}),ctx);
  const metadata=async(patch:object)=>{
   const response=await fetch(f.base+`/chats/${chat.id}/metadata`,{method:'PUT',headers:f.headers,body:JSON.stringify(patch)});
   assert.equal(response.status,200);return (await response.json()).meta;
  };
  const listed=async(filter:AgentOverviewFilter)=>(await f.overview(undefined,filter)).sessions;
  assert.deepEqual((await listed('all'))[0],{conversationId:chat.id,title:'Recoverable',status:'idle',agents:[],pinned:false,archived:false,trashed:false,readOnly:false});
  await metadata({pinned:true,archived:true});assert.deepEqual(await listed('all'),[]);
  assert.equal((await listed('archived'))[0].pinned,true);
  const deleted=await fetch(f.base+`/chats/${chat.id}`,{method:'DELETE',headers:f.headers});assert.equal(deleted.status,200);assert.equal((await deleted.json()).recoverable,true);
  assert.deepEqual(await listed('archived'),[]);
  assert.deepEqual((await listed('trash'))[0],{conversationId:chat.id,title:'Recoverable',status:'idle',agents:[],pinned:false,archived:false,trashed:true,readOnly:false});
  await metadata({trashed:false});assert.deepEqual(await listed('trash'),[]);
  assert.equal((await listed('all'))[0].trashed,false);
  await metadata({archived:true});assert.deepEqual(await listed('all'),[]);
  await metadata({archived:false,pinned:true});assert.deepEqual(await listed('archived'),[]);
  assert.equal((await listed('all'))[0].pinned,true);
  const response=await fetch(f.base+`/chats/${chat.id}`,{headers:f.headers});assert.equal(response.status,200);
  assert.match(JSON.stringify(await response.json()),/Retained history/);
 }finally{await f.close();}
});

test('explicit Sessions pagination is signed and rejects cursors from every other filter and legacy overview',{timeout:30000},async()=>{
 const f=await fixture();try{
  const filters=['all','archived','trash'] as const,roots=new Map<AgentOverviewFilter,ConversationId[]>();
  for(const filter of filters){
   const ids:ConversationId[]=[];
   for(let i=0;i<AGENT_OVERVIEW_PAGE_SIZE+1;i++){
    const chat=await f.create(`${filter} ${i}`);ids.push(chat.id);
    if(filter!=='all')await chat.commit(async tx=>{(await tx.doc(SessionUI,chat.id))[filter==='trash'?'trashed':'archived']=true;},ctx);
   }
   roots.set(filter,ids.toReversed());
  }
  const legacy=await f.overview();assert.ok(legacy.next);
  const before=durableContents(f.dir);
  for(const filter of filters){
   const first=await f.overview(undefined,filter);assert.equal(first.sessions.length,AGENT_OVERVIEW_PAGE_SIZE);assert.ok(first.next);
   const second=await f.overview(first.next,filter);assert.equal(second.sessions.length,1);assert.equal(second.next,undefined);
   assert.deepEqual([...first.sessions,...second.sessions].map(session=>session.conversationId),roots.get(filter));
   for(const other of filters.filter(value=>value!==filter))assert.equal((await f.request(`?filter=${other}&cursor=${encodeURIComponent(first.next)}`)).status,400);
   assert.equal((await f.request('?cursor='+encodeURIComponent(first.next))).status,400);
   assert.equal((await f.request(`?filter=${filter}&cursor=${encodeURIComponent(legacy.next)}`)).status,400);
   assert.equal((await f.request(`?filter=${filter}&cursor=${encodeURIComponent(first.next+'x')}`)).status,400);
   assert.equal((await fetch(f.base+'/chats?cursor='+encodeURIComponent(first.next),{headers:f.headers})).status,400);
  }
  assert.deepEqual(durableContents(f.dir),before,'filtered pagination is read-only');
 }finally{await f.close();}
});
