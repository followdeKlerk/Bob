import test from 'node:test';
import assert from 'node:assert/strict';
import {notificationReply} from '../src/notification-preview.js';
const entry=(model:unknown)=>({id:42,conversationId:7,kind:'pi.assistant',model}) as any;
test('notification previews include only the settled assistant text, not tools or hidden reasoning',()=>{
 assert.deepEqual(notificationReply(entry([{role:'assistant',content:[{type:'thinking',thinking:'private reasoning'},{type:'toolCall',name:'bash',arguments:{command:'secret token'}},{type:'text',text:'Here is the final reply.'}]},{role:'toolResult',content:[{type:'text',text:'private tool output'}]}]),7),{id:42,text:'Here is the final reply.'});
 assert.equal(notificationReply(entry([{role:'assistant',content:[{type:'thinking',thinking:'private'}]}]),7),null);
 assert.equal(notificationReply(entry([{role:'user',content:'not a reply'}]),7),null);assert.equal(notificationReply(undefined,7),null);
 assert.equal(notificationReply(entry([{role:'assistant',content:'wrong conversation'}]),8),null);
});
test('notification reply previews are bounded, including multi-block and very large answers',()=>{
 const reply=notificationReply(entry([{role:'assistant',content:[{type:'text',text:'First block'},{type:'text',text:'x'.repeat(2200000)}]}]),7)!;
 assert.equal(reply.text.length,4000);assert.ok(reply.text.startsWith('First block\n'));assert.ok(Buffer.byteLength(JSON.stringify(reply))<20000);
 assert.deepEqual(notificationReply(entry([{role:'assistant',content:'Plain text reply'}]),7),{id:42,text:'Plain text reply'});
});
