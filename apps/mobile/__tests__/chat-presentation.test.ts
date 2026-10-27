import {hasVisibleChatContent,hasInlineChatContent,isRecordedToolGeneration,inputAttribution,isActiveSubagent} from '../chat-presentation';
import type {ToolEntry} from '../tool-results';
test('owner attribution requires owner entry metadata, never role or report-looking text',()=>{
 const content='[subagent Audit helper answered, no reply needed] report';
 expect(inputAttribution({id:1,kind:'bob.user',data:{text:content}})).toEqual({owner:true});
 expect(inputAttribution({id:2,kind:'pi.user',model:[{role:'user',content}]})).toEqual({owner:false,label:'Input · source not identified'});
 expect(inputAttribution({id:3,kind:'bob.subagent-report',data:{name:'Audit helper'},model:[{role:'user',content}]})).toEqual({owner:false,label:'Agent report · Audit helper'});
 expect(inputAttribution({id:4,kind:'bob.subagent-report'})).toEqual({owner:false,label:'Agent report'});
});
test('only working or stopping agents keep the floating indicator active',()=>{
 for(const status of ['working','stopping'])expect(isActiveSubagent(status)).toBe(true);
 for(const status of ['idle','complete','unknown',undefined])expect(isActiveSubagent(status)).toBe(false);
});
const call={type:'toolCall',id:'shell-1',name:'bash',arguments:{command:'echo hello'}};
const entry:ToolEntry={id:1,kind:'pi.assistant',model:[{role:'assistant',content:[call]}]};
test('tools, hidden reasoning and whitespace do not create transcript rows',()=>{
 expect(hasVisibleChatContent(entry)).toBe(false);
 expect(hasVisibleChatContent({id:2,kind:'pi.tool-result',model:[{role:'toolResult',content:'long recorded output'}]})).toBe(false);
 expect(hasVisibleChatContent({id:3,kind:'pi.assistant',model:[{role:'assistant',content:[{type:'thinking',thinking:'hidden'},{type:'text',text:'  '},call]}]})).toBe(false);
});
test('reply text and user/artifact/admission entries remain visible',()=>{
 expect(hasVisibleChatContent({...entry,model:[{role:'assistant',content:[call,{type:'text',text:'Here is the answer.'}]}]})).toBe(true);
 for(const kind of ['bob.user','bob.artifact','bob.file','bob.peer-admission'])expect(hasVisibleChatContent({id:4,kind})).toBe(true);
});
test('inline mode retains recorded calls and orphan results while filtering reasoning-only rows',()=>{
 expect(hasInlineChatContent(entry)).toBe(true);
 expect(hasInlineChatContent({id:2,kind:'pi.tool-result',model:[{role:'toolResult',toolCallId:'orphan',content:'original output'}]})).toBe(true);
 expect(hasInlineChatContent({id:3,kind:'pi.assistant',model:[{role:'assistant',content:[{type:'thinking',thinking:'hidden'}]}]})).toBe(false);
});
test('pre-tool live text hands off by actual recorded call ID, not tool name or reply text',()=>{
 expect(isRecordedToolGeneration([entry],[{type:'text',text:'Checking'},call])).toBe(true);
 expect(isRecordedToolGeneration([entry],[{...call,id:'another-call'}])).toBe(false);
 expect(isRecordedToolGeneration([entry],[{type:'text',text:'Checking'}])).toBe(false);
 expect(isRecordedToolGeneration([],[call])).toBe(false);
});
