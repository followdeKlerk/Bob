import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
test('official tool task drives real isolated Chromium against local HTML (deterministic model)',{timeout:60000},async()=>{
 const site=createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end('<html><body><h1>Bob browser fixture</h1><input aria-label="Name"><button onclick="document.querySelector(\'h1\').textContent=\'Clicked\'">Act</button></body></html>');});site.listen(0,'127.0.0.1');await once(site,'listening');const url=`http://127.0.0.1:${(site.address() as any).port}`;
 const s=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-browser-'))),models=createModels(),faux=fauxProvider();models.setProvider(faux.provider);faux.setResponses([fauxAssistantMessage([fauxToolCall('browser',{action:'navigate',url})],{stopReason:'toolUse'}),fauxAssistantMessage('Browser result received')]);const rt=await openRuntime(s,models);
 try{const c=await rt.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);await(await c.submit({type:'input',content:'Open local fixture'},ctx)).wait(ctx);const page=await c.entries({},100,undefined,ctx);assert.ok(page.items.some(e=>e.kind==='pi.tool-result'&&JSON.stringify(e).includes('Bob browser fixture')));}finally{await rt.close();s.close();site.close();}
});
