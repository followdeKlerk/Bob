import {surfaceAnchors} from '../surface-placement';
import {linkToolResults,type ToolEntry} from '../tool-results';
const id='a841d08a-8b83-42cd-b8a7-2d61f2db7ae9',other='b841d08a-8b83-42cd-b8a7-2d61f2db7ae9';
const call=(entry:number,callId='visual-call',name='render_visual'):ToolEntry=>({id:entry,kind:'pi.assistant',model:[{role:'assistant',content:[{type:'toolCall',id:callId,name,arguments:{title:'Solar system'}}]}]});
const result=(entry:number,appId=id,callId='visual-call',name='render_visual'):ToolEntry=>({id:entry,kind:'pi.tool-result',model:[{role:'toolResult',toolCallId:callId,toolName:name,content:[{type:'text',text:name==='mcp_app'?`MCP Apps surface ${appId}. Original tool result: {}`:`Isolated visual ${appId}: Solar system. Open from the conversation's interactive surfaces.`}]}]});
test('illustration stays at its producing call, not the latest message, as more replies arrive',()=>{
 const entries=[call(10),result(11),{id:12,kind:'pi.assistant'},{id:13,kind:'bob.user'},{id:14,kind:'pi.assistant'}];
 expect(surfaceAnchors(entries).get(id)).toBe(10);expect(linkToolResults(entries,undefined).entries.map(entry=>entry.id)).not.toContain(11);
 expect(surfaceAnchors([...entries,{id:15,kind:'pi.assistant'}]).get(id)).toBe(10);
 expect(surfaceAnchors(JSON.parse(JSON.stringify(entries))).get(id)).toBe(10);
});
test('an orphan result stays at its own historical row until pagination loads the real call',()=>{
 expect(surfaceAnchors([result(11),{id:20,kind:'pi.assistant'}]).get(id)).toBe(11);
 expect(surfaceAnchors([call(10),result(11),{id:20,kind:'pi.assistant'}]).get(id)).toBe(10);
 expect(surfaceAnchors([{id:20,kind:'pi.assistant'}]).size).toBe(0);
});
test('several visuals and MCP surfaces bind by real call identity, never list order',()=>{
 const entries=[call(10),call(12,'mcp-call','mcp_app'),result(13,other,'mcp-call','mcp_app'),result(14)];
 expect([...surfaceAnchors(entries)]).toEqual([[other,12],[id,10]]);
});
test('user text, unrelated tools, failed results, and malformed receipts cannot relocate a visual',()=>{
 const fake=result(2);fake.model![0].toolName='bash';const failed=result(3);failed.model![0].isError=true;
 const user={id:4,kind:'bob.user',model:[{role:'user',content:`Isolated visual ${id}: not a receipt`}]};
 const malformed=result(5,'not-a-uuid');expect(surfaceAnchors([fake,failed,user,malformed]).size).toBe(0);
});
test('live result can attach early only to an already recorded producing call',()=>{
 const tools=[{callId:'visual-call',name:'render_visual',status:'done',output:[{type:'text',text:`Isolated visual ${id}: Solar system.`}]}];
 expect(surfaceAnchors([call(10)],{tools}).get(id)).toBe(10);expect(surfaceAnchors([],{tools}).size).toBe(0);
});
