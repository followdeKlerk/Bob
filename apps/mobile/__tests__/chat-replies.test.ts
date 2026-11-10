import {replyAssociation,replyOutputPlacement,replyOutputRows,withLiveResponse,type ReplyEntry} from '../chat-replies';
const id='a841d08a-8b83-42cd-b8a7-2d61f2db7ae9';
const association={version:1,first:1,answer:5};
const file=(n=3):ReplyEntry=>({id:n,kind:'bob.file',mobileReply:association,data:{id,conversationId:7,name:'result.txt',mime:'text/plain',size:2,sha256:'a'.repeat(64)}});
const answer=(n=5):ReplyEntry=>({id:n,kind:'pi.assistant',byTaskId:99,mobileReply:association,model:[{role:'assistant',content:[{type:'text',text:'Here is the result.'}]}]});
test('generated files and visuals follow their proven answer, not later replies; owner uploads stay put',()=>{
 const source:ReplyEntry={id:2,kind:'pi.assistant',mobileReply:association,model:[{role:'assistant',content:[{type:'toolCall',id:'visual',name:'render_visual'}]}]};
 const upload={...file(4),kind:'bob.artifact'},entries=[source,file(),upload,answer(),{...answer(9),mobileReply:{version:1,first:8,answer:9}}];
 const before=JSON.stringify(entries),result=replyOutputPlacement(entries,new Map([[id,2]]));
 expect(result.files.get(5)).toEqual([entries[1]]);expect(result.hiddenFiles).toEqual(new Set([3]));
 expect(result.surfaces.get(id)).toBe(5);expect(result.files.has(9)).toBe(false);expect(result.hiddenFiles.has(4)).toBe(false);
 expect(JSON.stringify(entries)).toBe(before);
});
test('unknown, malformed, missing, conflicting and tool-only final associations keep their source slots',()=>{
 for(const entries of [
  [file()],
  [{...file(),mobileReply:undefined},{...answer(),mobileReply:undefined}],
  [file(),{...answer(),mobileReply:{version:1,first:2,answer:5}}],
  [{...file(),data:{name:'broken'}},answer()],
  [file(),{...answer(),model:[{role:'assistant',content:[{type:'toolCall',id:'x',name:'read'}]}]}],
 ]){
  expect(replyOutputPlacement(entries,new Map([[id,3]])).hiddenFiles.size).toBe(0);
 }
 expect(replyAssociation({...file(),mobileReply:{version:1,first:4,answer:5}})).toBeUndefined();
 expect(replyAssociation({...file(),mobileReply:{version:2,first:1,answer:5}})).toBeUndefined();
 expect(replyOutputPlacement([file()],new Map([[id,3]])).surfaces.get(id)).toBe(3);
});
test('several attachments retain their original order under one answer',()=>{
 const entries=[file(2),file(3),answer()];
 expect(replyOutputPlacement(entries,new Map()).files.get(5)?.map(e=>e.id)).toEqual([2,3]);
});
test('live and recorded prose share the native generation key, without duplicate cells',()=>{
 const message={role:'assistant',content:[{type:'text',text:'Here is'}]};
 const live=withLiveResponse([],[],{run:{taskId:99,first:1},generation:{message}});
 expect(live.entries).toHaveLength(1);expect(live.entries[0]).toMatchObject({displayKey:'generation:99',liveResponse:true});
 const final=answer(),done=withLiveResponse([final],[final],{});
 expect(done.entries[0].displayKey).toBe(live.entries[0].displayKey);expect(done.entries[0].liveResponse).toBeUndefined();
 expect(withLiveResponse([final],[final],{run:{taskId:99},generation:{message}}).entries).toHaveLength(1);
});
test('tools stay in recorded slots, failed attempts do not collide, and legacy generations retain fallback',()=>{
 const call:ReplyEntry={id:2,kind:'pi.assistant',byTaskId:99,model:[{role:'assistant',content:[{type:'toolCall',id:'a',name:'read'}]}]};
 expect(withLiveResponse([call],[call],{run:{taskId:99},generation:{message:call.model![0]}}).entries).toHaveLength(1);
 const failed={...answer(3),model:[{role:'assistant',content:'Partial',stopReason:'aborted'}]} as ReplyEntry;
 const pending=withLiveResponse([failed],[failed],{run:{taskId:99},generation:{message:{content:'New attempt'}}});
 expect(pending.entries).toHaveLength(2);expect(pending.entries[0].displayKey).toBeUndefined();expect(pending.entries[1].displayKey).toBe('generation:99');
 expect(withLiveResponse([],[],{run:{},generation:{message:{content:'Legacy'}}}).legacyLive).toBe(true);
 expect(withLiveResponse([],[],{generation:{message:{content:'Retained'}}}).entries).toHaveLength(0);
});

test('a native final-answer range also places older cached files outside the newest snapshot',()=>{
 const old={...file(),mobileReply:undefined};
 expect(replyOutputPlacement([old,answer()],new Map([[id,3]])).files.get(5)).toEqual([old]);
 expect(replyOutputPlacement([old,answer()],new Map([[id,3]])).surfaces.get(id)).toBe(5);
});

test('long histories keep previously keyed row objects while only live prose changes',()=>{
 const history=Array.from({length:2000},(_,i)=>({...answer(i+1),byTaskId:i+1,mobileReply:undefined}));
 const first=withLiveResponse(history,history,{run:{taskId:3000},generation:{message:{content:'Fresh'}}});
 const next=withLiveResponse(history,history,{run:{taskId:3000},generation:{message:{content:'Fresh text'}}});
 expect(next.entries.slice(0,2000).every((entry,i)=>entry===first.entries[i])).toBe(true);expect(next.entries).toHaveLength(2001);
});

test('file and visual cells keep identity while moving beneath their own answer',()=>{
 const source:ReplyEntry={id:2,kind:'pi.assistant',model:[{role:'assistant',content:'Working'}]},artifact=file(),final=answer();
 const before=replyOutputRows([source,artifact],new Map(),[{id,source:2,at:2}],'b:7');
 const after=replyOutputRows([source,artifact,final],new Map([[5,[artifact]]]),[{id,source:2,at:5}],'b:7');
 expect(after.map(e=>e.kind)).toEqual(['pi.assistant','pi.assistant','bob.inline-surface','bob.file']);
 expect(after.find(e=>e.kind==='bob.file')).toBe(artifact);
 expect(after.find(e=>e.inlineSurfaceId===id)?.displayKey).toBe(before.find(e=>e.inlineSurfaceId===id)?.displayKey);
 const later={...answer(10),byTaskId:100};
 expect(replyOutputRows([source,artifact,final,later],new Map([[5,[artifact]]])).map(e=>e.id)).toEqual([2,5,3,10]);
});
