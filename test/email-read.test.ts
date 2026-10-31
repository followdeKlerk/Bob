import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Harness,createRegistry,defineExtension} from '@earendil-works/pi-durable';
import {openNodeSqliteStorage} from '@earendil-works/pi-durable/storage/sqlite/node';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
import {createSchedules,Schedules,scheduleAlerts} from '../src/schedules.js';
import {EmailDelivered} from '../src/email-documents.js';
import {createEmailRead,emailCommand,projectEnvelopes,projectMessage,mailSourceKey,redactMail,type EmailRunner} from '../src/email-read.js';
const now=Date.now(),today=new Date(now).toISOString().slice(0,10),old=new Date(now-91*86400000).toISOString().slice(0,10);
const envelope={id:'123','message-id':'<reply@example.test>',subject:'Re: Your application',from:[{name:'Recruiter',email:'recruiter@example.test'}],date:new Date(now).toISOString(),flags:[{iana:'seen',raw:'\\Seen'}]};
const mime={text_body:[1],html_body:[2],attachments:[3],parts:[
 {headers:[{name:'message_id',value:{Text:'<reply@example.test>'}},{name:{other:'Authentication-Results'},value:{Text:'gmx.net; dkim=pass header.i=@example.test; spf=pass'}}],body:{Multipart:[1,2,3]}},
 {headers:[],body:{Text:'We would like to arrange an interview. Code: 123456. https://example.test/auth/token-secret'}},
 {headers:[],body:{Html:'<p>Interview</p><script>execute()</script><img src="https://tracker.test">'}},
 {headers:[{name:'content_disposition',value:{Text:'attachment'}}],body:{Text:'ATTACHMENT-SECRET'}}
]};
const search={action:'search',mailbox:'Inbox',fromDate:today,toDate:today,query:'subject application',page:1,pageSize:50} as const;
const read={action:'read',mailbox:'Inbox',id:'123'} as const;
const source=mailSourceKey('reply@example.test');
const reply=(name:string,args:object)=>fauxAssistantMessage([fauxToolCall(name,args)],{stopReason:'toolUse'});
async function until<T>(read:()=>Promise<T>,done:(v:T)=>boolean){for(let i=0;i<300;i++){const v=await read();if(done(v))return v;await new Promise(r=>setTimeout(r,20));}throw Error('Timed out');}

test('fixed read-only argument vectors reject every mutation, config override and out-of-window request',()=>{
 assert.deepEqual(emailCommand(read).args,['message','read','--account','gmx','--mailbox','Inbox','--json','123']);
 const command=emailCommand({...search,query:'subject "x; touch /tmp/no"'}).args;
 assert.equal(command[0],'envelope');assert.equal(command.at(-2),'--');assert.ok(command.at(-1)!.includes('touch /tmp/no'));
 assert.ok(!command.includes('--seen'));assert.ok(!command.includes('--raw'));
 for(const input of [{action:'send'},{action:'flag'},{...read,seen:true},{...read,id:'123 --seen'},{...read,account:'other'},{...read,mailbox:'--config'},{...read,mailbox:'Drafts'},{...search,fromDate:old},{...search,fromDate:'2026-02-30'},{...search,page:0},{...search,pageSize:101},{...search,query:'x\n--config'}])assert.throws(()=>emailCommand(input));
});

test('envelopes are date-filtered and full pages never claim completeness',()=>{
 const args=emailCommand({...search,pageSize:1}).input as any;
 const page=projectEnvelopes({envelopes:[envelope]},args);assert.equal(page.complete,false);assert.equal(page.nextPage,2);assert.equal(page.messages[0].messageId,'reply@example.test');assert.deepEqual(page.messages[0].flags,['seen']);
 const after=projectEnvelopes({envelopes:[{...envelope,date:new Date(Date.parse(today)+2*86400000).toISOString()}]},args);assert.equal(after.messages.length,0);assert.equal(after.complete,false,'filtered results do not turn a full raw page into a negative result');
 assert.throws(()=>projectEnvelopes({envelopes:[{...envelope,date:'bad-date'}]},args));
});

test('MIME projection exposes only body text and selected evidence; no attachment bytes, links or codes',()=>{
 const candidate=projectEnvelopes({envelopes:[envelope]},emailCommand(search).input as any).messages[0];
 const value=projectMessage(mime,candidate),json=JSON.stringify(value);
 assert.equal(value.sourceKey,source);assert.equal(value.authentication.length,1);assert.ok(json.includes('arrange an interview'));
 for(const secret of ['ATTACHMENT-SECRET','token-secret','123456','execute()'])assert.ok(!json.includes(secret),secret);
 assert.throws(()=>projectMessage(mime,{...candidate,messageId:'swapped@example.test'}),/identity changed/);
 const html=projectMessage({...mime,text_body:[]},candidate);assert.equal(html.body,'Interview');
 assert.ok(!redactMail('password=unsafe verification code: abcdef 123456 https://x.test/token').includes('unsafe'));
 assert.throws(()=>mailSourceKey('no-global-identifier'),/stable Message-ID/);
 assert.equal(mailSourceKey('<reply@example.test>'),mailSourceKey('reply@example.test'),'stable across folder moves and envelope formatting');
});

async function fixture(responses:ReturnType<typeof fauxAssistantMessage>[],runner:EmailRunner){
 let h!:Harness,offset=0;const models=createModels(),faux=fauxProvider({tokensPerSecond:100000});models.setProvider(faux.provider);faux.setResponses(responses);
 const scheduling=createSchedules(()=>h),email=createEmailRead(()=>h,runner),resources=defineExtension({...scheduling.extension,name:'bob.resources',tools:[...scheduling.extension.tools??[],...email.tools??[]],sections:[]}),registry=createRegistry();registry.install(resources);
 const path=join(mkdtempSync(join(process.env.TMPDIR!,'bob-email-test-')),'durable.sqlite');
 const open=async()=>Harness.open(await openNodeSqliteStorage(path),{models,registry,settings:{extensions:[resources]},now:()=>Date.now()+offset,setTimer:(callback,ms)=>{const timer=setTimeout(callback,Math.min(ms,20));return()=>clearTimeout(timer);}},ctx);
 h=await open();
 const chat=await h.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);h.resume();
 return {get h(){return h;},chat,scheduling,restart:async()=>{await h.close(ctx);h=await open();h.resume();await scheduling.recover();},advance:(ms:number)=>{offset+=ms;},close:()=>h.close(ctx)};
}
const goodRunner:EmailRunner=async args=>args[0]==='mailbox'?{mailboxes:[{id:'Inbox',name:'Inbox'},{id:'Spam',name:'Spam'},{id:'Archive',name:'Archive'}]}:args[0]==='envelope'?{envelopes:[envelope]}:mime;
const createInput=(emailAccess:boolean)=>({action:'create',kind:'check',emailAccess,emailMailboxes:['Inbox'],title:'Recruiter follow-ups',text:'Check follow-ups from the last two weeks. No external actions.',timezone:'Europe/Warsaw',firstRunAt:new Date(Date.now()+50).toISOString(),intervalSeconds:60,maxRuns:2,stopOnMatch:false});

test('scheduled reads remain read-only and deduplicate only after the alert commit, across restart',{timeout:20000},async()=>{
 const calls:string[][]=[],runner:EmailRunner=async(args,signal)=>{calls.push([...args]);return goodRunner(args,signal);};
 const flow=[reply('email_read',{action:'mailboxes'}),reply('email_read',search),reply('email_read',read),reply('schedule_result',{outcome:'match',message:'An interview follow-up arrived.',emailSources:[source]}),fauxAssistantMessage('Done.'),reply('email_read',{action:'mailboxes'}),reply('email_read',search),reply('email_read',read),reply('schedule_result',{outcome:'match',message:'This duplicate must not be delivered.',emailSources:[source]}),reply('schedule_result',{outcome:'no_change',message:'Only previously reported correspondence.'}),fauxAssistantMessage('Done.')];
 const r=await fixture(flow,runner);
 try{
  const created=await r.scheduling.mutate(createInput(true),randomUUID(),r.chat.id);
  let book=await until(()=>r.h.snapshot(Schedules,ctx),v=>!!v?.jobs[created.id]?.history[0]?.finishedAt);
  assert.equal(book!.jobs[created.id].state,'active');assert.deepEqual((await r.h.snapshot(EmailDelivered,created.id,ctx))!.keys,[source]);assert.equal((await scheduleAlerts(r.h,0)).alerts.length,1);
  const children=await r.h.commit(tx=>tx.scanConversations({},100),ctx),worker=children.items.find(c=>c.owner?.taskId===created.taskId)!;
  const agent=await (await r.h.conversation(worker.id,ctx))!.agent(ctx);assert.ok(agent.callable.some(t=>t.name==='email_read'));assert.ok(!agent.callable.some(t=>['bash','write','browser','mcp_tool','codemode'].includes(t.name)));
  await r.restart();assert.deepEqual((await r.h.snapshot(EmailDelivered,created.id,ctx))!.keys,[source]);
  r.advance(61000);
  book=await until(()=>r.h.snapshot(Schedules,ctx),v=>v?.jobs[created.id]?.state==='finished');
  assert.equal(book!.jobs[created.id].history[1].outcome,'no_change');assert.equal((await scheduleAlerts(r.h,0)).alerts.length,1);
  const all=await r.h.commit(tx=>tx.scanConversations({},100),ctx),second=all.items.filter(c=>c.owner?.taskId===created.taskId).at(-1)!;
  const entries=await (await r.h.conversation(second.id,ctx))!.entries({},100,undefined,ctx);assert.ok(JSON.stringify(entries).includes('alreadyReported\\\":true')||JSON.stringify(entries).includes('alreadyReported\\":true'));
  for(const args of calls){assert.ok(!args.includes('--seen'));assert.ok(['mailbox','envelope','message'].includes(args[0]));}
 }finally{await r.close();}
});

test('existing schedules do not gain email access without explicit opt-in',{timeout:15000},async()=>{
 const r=await fixture([reply('email_read',{action:'mailboxes'}),reply('schedule_result',{outcome:'failed',message:'Email is not authorized here.'}),fauxAssistantMessage('Done')],async()=>{throw Error('Email runner must not be called');});
 try{const created=await r.scheduling.mutate(createInput(false),randomUUID(),r.chat.id);const book=await until(()=>r.h.snapshot(Schedules,ctx),v=>v?.jobs[created.id]?.state==='paused');assert.equal(book!.jobs[created.id].history[0].outcome,'failed');const workers=await r.h.commit(tx=>tx.scanConversations({},100),ctx),worker=workers.items.find(c=>c.owner?.taskId===created.taskId)!;const agent=await (await r.h.conversation(worker.id,ctx))!.agent(ctx);assert.ok(!agent.callable.some(t=>t.name==='email_read'));}finally{await r.close();}
});

for(const failure of ['partial','provider','unverified-source'] as const)test(`email checks fail closed: ${failure}`,{timeout:15000},async()=>{
 const input=failure==='partial'?{...search,pageSize:1}:search;
 const flow=[reply('email_read',{action:'mailboxes'}),reply('email_read',input),...(failure==='unverified-source'?[reply('schedule_result',{outcome:'match',message:'Do not deliver this unverified claim',emailSources:['a'.repeat(64)]})]:[reply('schedule_result',{outcome:'no_change',message:'Do not silently accept an incomplete search'})]),fauxAssistantMessage('Done')];
 const runner:EmailRunner=async(args,signal)=>{if(failure==='provider'&&args[0]==='envelope')throw Error('password=provider-secret');return goodRunner(args,signal);};
 const r=await fixture(flow,runner);
 try{const created=await r.scheduling.mutate(createInput(true),randomUUID(),r.chat.id);const book=await until(()=>r.h.snapshot(Schedules,ctx),v=>v?.jobs[created.id]?.state==='paused');assert.equal(book!.jobs[created.id].history[0].outcome,'failed');assert.deepEqual((await r.h.snapshot(EmailDelivered,created.id,ctx))?.keys??[],[]);assert.equal((await scheduleAlerts(r.h,0)).alerts.length,1);const all=await r.h.commit(tx=>tx.scanConversations({},100),ctx);for(const worker of all.items.filter(c=>c.owner?.taskId===created.taskId)){const entries=await (await r.h.conversation(worker.id,ctx))!.entries({},100,undefined,ctx);assert.ok(!JSON.stringify(entries).includes('provider-secret'));}}finally{await r.close();}
});

test('default email scope requires Inbox, Spam and Archive, not just an Inbox negative result',{timeout:15000},async()=>{
 const r=await fixture([reply('email_read',{action:'mailboxes'}),reply('email_read',search),reply('schedule_result',{outcome:'no_change',message:'Must not hide unsearched Spam/Archive'}),fauxAssistantMessage('Done')],goodRunner);
 try{const {emailMailboxes,...input}=createInput(true);const created=await r.scheduling.mutate(input,randomUUID(),r.chat.id);const book=await until(()=>r.h.snapshot(Schedules,ctx),v=>v?.jobs[created.id]?.state==='paused');assert.equal(book!.jobs[created.id].history[0].outcome,'failed');}finally{await r.close();}
});

test('scheduled folder scope is enforced before the email subprocess is called',{timeout:15000},async()=>{
 let searches=0;const runner:EmailRunner=async(args,signal)=>{if(args[0]==='envelope')searches++;return goodRunner(args,signal);};
 const r=await fixture([reply('email_read',{action:'mailboxes'}),reply('email_read',{...search,mailbox:'Sent'}),reply('schedule_result',{outcome:'no_change',message:'Must not silently accept denied access'}),fauxAssistantMessage('Done')],runner);
 try{const created=await r.scheduling.mutate(createInput(true),randomUUID(),r.chat.id);const book=await until(()=>r.h.snapshot(Schedules,ctx),v=>v?.jobs[created.id]?.state==='paused');assert.equal(book!.jobs[created.id].history[0].outcome,'failed');assert.equal(searches,0);}finally{await r.close();}
});

test('cancellation after a recorded result does not mark mail delivered before its alert commit',{timeout:15000},async()=>{
 let reads=0,parked=false;const runner:EmailRunner=async(args,signal)=>{
  if(args[0]==='message'&&++reads===2)return new Promise((_,reject)=>{parked=true;signal?.addEventListener('abort',()=>reject(Error('cancelled')),{once:true});});
  return goodRunner(args,signal);
 };
 const r=await fixture([reply('email_read',{action:'mailboxes'}),reply('email_read',search),reply('email_read',read),reply('schedule_result',{outcome:'match',message:'Do not deliver a cancelled result.',emailSources:[source]}),reply('email_read',read),fauxAssistantMessage('Done')],runner);
 try{const created=await r.scheduling.mutate(createInput(true),randomUUID(),r.chat.id);await until(async()=>parked,v=>v);const book=await r.h.snapshot(Schedules,ctx);assert.equal(book!.jobs[created.id].result?.outcome,'match');assert.deepEqual((await r.h.snapshot(EmailDelivered,created.id,ctx))?.keys??[],[]);await r.scheduling.mutate({action:'pause',id:created.id,expectedRevision:book!.jobs[created.id].revision},randomUUID(),r.chat.id);await new Promise(resolve=>setTimeout(resolve,100));assert.deepEqual((await r.h.snapshot(EmailDelivered,created.id,ctx))?.keys??[],[]);assert.equal((await scheduleAlerts(r.h,0)).alerts.length,0);}finally{await r.close();}
});
