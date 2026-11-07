import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {testChromiumExecutable} from './chromium.js';
test('official tool task drives real isolated Chromium against local HTML (deterministic model)',{timeout:60000},async t=>{
 const site=createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end('<html><body><h1>Bob browser fixture</h1><input aria-label="Name"><button onclick="document.querySelector(\'h1\').textContent=\'Clicked\'">Act</button></body></html>');});
 let state:State|undefined,runtime:Awaited<ReturnType<typeof openRuntime>>|undefined;
 t.after(async()=>{
  try {await runtime?.close();}
  finally {try {state?.close();}finally {site.close();}}
 });
 site.listen(0,'127.0.0.1');await once(site,'listening');const url=`http://127.0.0.1:${(site.address() as any).port}`;
 const s=state=new State(mkdtempSync(join(tmpdir(),'bob-browser-')));
 s.set('browserExecutable',testChromiumExecutable());
 const models=createModels(),faux=fauxProvider();models.setProvider(faux.provider);faux.setResponses([fauxAssistantMessage([fauxToolCall('browser',{action:'navigate',url})],{stopReason:'toolUse'}),fauxAssistantMessage('Browser result received')]);
 const rt=runtime=await openRuntime(s,models);
 const c=await rt.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);await(await c.submit({type:'input',content:'Open local fixture'},ctx)).wait(ctx);const page=await c.entries({},100,undefined,ctx);assert.ok(page.items.some(e=>e.kind==='pi.tool-result'&&JSON.stringify(e).includes('Bob browser fixture')));
});
