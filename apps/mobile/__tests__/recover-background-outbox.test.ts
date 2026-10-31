import {recoverBackgroundOutbox,notificationReplyBarriers} from '../recover-background-outbox';
import type {OutgoingMessage} from '../message-outbox';
const item=(id:string,backendId='backend',chat=1):OutgoingMessage=>({id,scope:`${backendId}:${chat}`,backend:{backendId,endpoint:'https://example.test',name:'Test'},chat,localId:-1,files:[],message:{requestId:id,text:'Typed in notification',mode:'followUp',allowSubagents:false}});
function local(items:OutgoingMessage[]=[]){return {ready:Promise.resolve(),items,add:jest.fn(async function(this:{items:OutgoingMessage[]},value:OutgoingMessage){this.items.push(value);})};}
test('recovers a notification reply into its exact backend and conversation without replacing composer queue',async()=>{
 const existing=item('composer'),incoming=item('notification','other-backend',42),box=local([existing]);
 await recoverBackgroundOutbox(box,{recover:async()=>[existing,incoming]});expect(box.items).toEqual([existing,incoming]);expect(box.add).toHaveBeenCalledTimes(1);
});
test('repeated native events/resume do not duplicate a recovered send or overwrite local state',async()=>{
 const existing={...item('notification'),admitted:true},box=local([existing]),native={recover:async()=>[item('notification'),item('new')]};
 await recoverBackgroundOutbox(box,native);await recoverBackgroundOutbox(box,native);expect(box.items).toEqual([existing,item('new')]);expect(box.add).toHaveBeenCalledTimes(1);
});
test('late results after unmount cannot change a different mounted app queue',async()=>{
 let current=true,finish!:(items:OutgoingMessage[])=>void;const box=local(),pending=recoverBackgroundOutbox(box,{recover:()=>new Promise(resolve=>{finish=resolve;})},()=>current);await Promise.resolve();current=false;finish([item('late')]);await pending;expect(box.items).toEqual([]);
});
test('native storage failure is surfaced, never treated as an empty queue',async()=>{
 const box=local([item('preserve')]);await expect(recoverBackgroundOutbox(box,{recover:async()=>{throw Error('encrypted storage unavailable');}})).rejects.toThrow('storage unavailable');expect(box.items).toEqual([item('preserve')]);
});

test('foreground barriers are per backend/chat, include rejected pending files and clear only on admission',()=>{
 const pending={...item('file'),files:[{id:'f',uri:'file:///draft',name:'cv.pdf',mime:'application/pdf'}],rejected:true};
 expect(notificationReplyBarriers([pending,{...item('later'),foregroundOnly:true},item('other','second',4)],'backend')).toEqual([1]);
 expect(notificationReplyBarriers([{...pending,admitted:true}], 'backend')).toEqual([]);
 expect(notificationReplyBarriers([pending], 'second')).toEqual([]);
});
