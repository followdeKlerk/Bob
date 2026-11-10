import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {launchTestChromium} from './chromium.js';
import {build} from 'esbuild';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {Interactive} from '../src/interactive.js';
import {createMcpFixture} from './mcp-fixture.js';
import {registerInlineVisualLifecycle} from './inline-visual-lifecycle.js';

test('real MCP Apps handshake and tools: native Durable records, scoped capabilities, idempotency, sandbox', {timeout:90000},async t=>{
 const fixture=await createMcpFixture(),state=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-interactive-')));
 state.set('mcpConnections',[{id:'fixture',endpoint:'http://127.0.0.1:49160/mcp',enabled:true,allowedTools:['show','increment']}]);
 const models=createModels(),faux=fauxProvider();models.setProvider(faux.provider);
 faux.setResponses([
   fauxAssistantMessage([fauxToolCall('render_visual',{title:'Visual fixture',html:'<h1>Native visual fixture</h1><button onclick="this.textContent=\'Clicked\'">Act</button>'})],{stopReason:'toolUse'}),fauxAssistantMessage('DETERMINISTIC MODEL: visual created'),
   fauxAssistantMessage([fauxToolCall('mcp_app',{serverId:'fixture',tool:'show',arguments:{}})],{stopReason:'toolUse'}),fauxAssistantMessage('DETERMINISTIC MODEL: MCP resource created'),
 ]);
 const runtime=await openRuntime(state,models,fixture.transport);
 let browser:Awaited<ReturnType<typeof launchTestChromium>>|undefined,site:ReturnType<typeof createServer>|undefined;
 t.after(async()=>{
   try {await browser?.close();}
   finally {site?.close();await runtime.close();await fixture.close();state.close();}
 });
   const chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);
   const other=await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
   for(const content of ['visual','MCP']){await chat.submit({type:'input',content},ctx);await chat.waitForIdle(ctx);}
   const list=await runtime.interactive.list(runtime.harness,chat);assert.equal(list.length,2);
   const visual=list.find(a=>a.kind==='visual')!,app=list.find(a=>a.kind==='mcp')!;
   assert.deepEqual(app.allowedTools,['increment']);assert.equal('html'in app,false);
   const device=state.pair(state.invite().token,'MCP action test').deviceId,opened=await runtime.interactive.open(runtime.harness,chat,app.id,device);
   const call={capability:opened.capability,requestId:randomUUID(),name:'increment',arguments:{amount:1}};
   await assert.rejects(runtime.interactive.call(runtime.harness,other,app.id,device,call),/scope mismatch/);
   await assert.rejects(runtime.interactive.call(runtime.harness,chat,app.id,randomUUID(),call),/scope mismatch/);
   await assert.rejects(runtime.interactive.call(runtime.harness,chat,app.id,device,{...call,name:'show'}),/not granted/);
   const v=await runtime.interactive.open(runtime.harness,chat,visual.id,device);
   await assert.rejects(runtime.interactive.call(runtime.harness,chat,visual.id,device,{...call,capability:v.capability}),/not granted/);
   const result=await runtime.interactive.call(runtime.harness,chat,app.id,device,call);assert.equal(fixture.counter,1);
   const operation=(await runtime.harness.snapshot(Interactive,chat.id,ctx))!.operations[`${device}:${call.requestId}`];
   assert.ok(operation.taskId);const nativeTask=await runtime.harness.getTask(operation.taskId,ctx);
   assert.equal(nativeTask?.kind,'bob.mcp-ui-action');assert.equal(nativeTask?.conversationId,chat.id);assert.equal(nativeTask?.background,false);assert.equal(nativeTask?.state.status,'terminal');assert.equal(nativeTask?.state.outcome?.status,'completed');
   assert.deepEqual(await runtime.interactive.call(runtime.harness,chat,app.id,device,call),result);assert.equal(fixture.counter,1);
   await assert.rejects(runtime.interactive.call(runtime.harness,chat,app.id,device,{...call,arguments:{amount:2}}),/another action/);
   const unknownId=randomUUID();await chat.commit(async tx=>{(await tx.doc(Interactive,chat.id)).operations[`${device}:${unknownId}`]={appId:app.id,tool:'increment',requestHash:createHash('sha256').update(JSON.stringify({amount:1})).digest('hex'),status:'started'};},ctx);
   await assert.rejects(runtime.interactive.call(runtime.harness,chat,app.id,device,{...call,requestId:unknownId}),/unknown; no automatic resend/);assert.equal(fixture.counter,1);
   const host=(await build({entryPoints:['apps/interactive/host.ts'],bundle:true,write:false,format:'iife',platform:'browser'})).outputFiles[0].text.replaceAll('</script','<\\/script');
   const payload={kind:opened.kind,title:opened.title,html:opened.html,input:opened.input,result:opened.result,allowedTools:opened.allowedTools};
   const html=`<!doctype html><div id="status"></div><div id="surface" style="height:600px"></div><script>${host}</script><script>window.BobNative={request:(raw,nonce)=>window.testNative(raw,nonce).then(value=>window.__bobReply(JSON.parse(raw).id,value))};window.startBobSurface(${JSON.stringify(payload).replaceAll('<','\\u003c')},'fixture-nonce')</script>`;
   site=createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end(html);});site.listen(0,'127.0.0.1');await once(site,'listening');
   browser=await launchTestChromium();const page=await browser.newPage();
   await page.exposeFunction('testNative',async(raw:string,nonce:string)=>{
     assert.equal(nonce,'fixture-nonce');const p=JSON.parse(raw);
     try{return {result:await runtime.interactive.call(runtime.harness,chat,app.id,device,{capability:opened.capability,requestId:p.id,...p.params})};}
     catch(error){return {error:String(error)};}
   });
   const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`http://127.0.0.1:${(site.address() as any).port}`);
   const frame=page.frameLocator('iframe');await frame.getByText('Official MCP Apps handshake connected').waitFor({timeout:15000});
   await frame.getByRole('button',{name:'Increase real MCP counter'}).click();
   await frame.getByText('MCP counter: 2',{exact:true}).waitFor({timeout:15000});assert.equal(fixture.counter,2);
   const child=page.frames().find(f=>f!==page.mainFrame())!;
   assert.deepEqual(await child.evaluate(()=>(window as any).fixtureIsolation),{parentBlocked:true,storageBlocked:true,networkBlocked:true});
   assert.equal(errors.length,0,errors.join('\n'));
   await page.screenshot({path:'docs/mcp-real-browser.png'});
   runtime.interactive.close(opened.capability,device);
   await assert.rejects(runtime.interactive.call(runtime.harness,chat,app.id,device,{...call,requestId:randomUUID()}),/expired/);
   assert.equal(fixture.counter,2);
   const renewed=await runtime.interactive.open(runtime.harness,chat,app.id,device);
   state.set('mcpConnections',[{id:'fixture',endpoint:'http://127.0.0.1:49161/mcp',enabled:true,allowedTools:['show','increment']}]);
   await assert.rejects(runtime.interactive.call(runtime.harness,chat,app.id,device,{...call,capability:renewed.capability,requestId:randomUUID()}),/endpoint changed/);
   assert.equal(fixture.counter,2);
   state.set('mcpConnections',[{id:'fixture',endpoint:'http://127.0.0.1:49160/mcp',enabled:true,allowedTools:['show','increment']}]);
   const held=fixture.holdNextIncrement(),stoppedCall={...call,capability:renewed.capability,requestId:randomUUID()};
   const stopping=runtime.interactive.call(runtime.harness,chat,app.id,device,stoppedCall);
   const rejected=assert.rejects(stopping,/no automatic resend/);
   try {
     await held.started;
     assert.ok((await runtime.harness.inspect(ctx)).tasks.some(t=>t.record.conversationId===chat.id&&t.record.kind==='bob.mcp-ui-action'));
     await chat.abort(ctx);await rejected;
     const stopped=(await runtime.harness.snapshot(Interactive,chat.id,ctx))!.operations[`${device}:${stoppedCall.requestId}`];
     assert.equal(stopped.status,'unknown');assert.equal((await runtime.harness.getTask(stopped.taskId!,ctx))!.state.outcome?.status,'aborted');
     await assert.rejects(runtime.interactive.call(runtime.harness,chat,app.id,device,stoppedCall),/no automatic resend/);
     assert.equal(fixture.counter,2);
   }finally{held.release();}
});
registerInlineVisualLifecycle();

test('bundled Nunito covers owned host UI without overriding authored HTML; MCP retains opt-in mono',{timeout:60000},async t=>{
 const bundle=(await build({entryPoints:['apps/interactive/host.ts'],bundle:true,write:false,format:'iife',platform:'browser'})).outputFiles[0].text;
 const monoCss=[['Regular','400','normal'],['Bold','500 900','normal'],['Italic','400','italic'],['BoldItalic','500 900','italic']].map(([file,weight,style])=>
  `@font-face{font-family:'Nordwand Mono';src:url(data:font/woff2;base64,${readFileSync(`apps/mobile/android/app/src/main/assets/fonts/NordwandMono-${file}.woff2`).toString('base64')}) format('woff2');font-weight:${weight};font-style:${style};font-display:swap}`
 ).join('');
 const provenance=JSON.parse(readFileSync('apps/mobile/android/app/src/main/assets/fonts/nunito/provenance.json','utf8'));
 const uiCss=provenance.fonts.map((font:{file:string;weight:number;style:string})=>
  `@font-face{font-family:'Nunito';src:url(data:font/ttf;base64,${readFileSync(`apps/mobile/android/app/src/main/res/font/${font.file}`).toString('base64')}) format('truetype');font-weight:${font.weight===700?'700 1000':font.weight};font-style:${font.style};font-display:swap}`
 ).join('');
 const fontCss=uiCss+monoCss;
 const native=readFileSync('apps/mobile/android/app/src/main/java/com/bobmobile/BobInteractive.kt','utf8');
 const template=/val html = """([\s\S]*?)"""/.exec(native)![1];
 let cleanupBrowser:Awaited<ReturnType<typeof launchTestChromium>>|undefined;
 t.after(async()=>{await cleanupBrowser?.close();});
 const browser=cleanupBrowser=await launchTestChromium();
 const errors:string[]=[],requests:string[]=[];
 async function open(kind:'visual'|'mcp',html:string,fonts=fontCss){
  const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push(request.url()));
  const document=template.replace('$bundle',()=>bundle.replaceAll('</script','<\\/script'))
   .replace('$fontFaceCss',()=>fonts).replace('$safePayload',()=>JSON.stringify({kind,title:'Typography',html,allowedTools:[]}).replaceAll('<','\\u003c'))
   .replace('${JSONObject.quote(nonce)}',()=>JSON.stringify('private-native-nonce'))
   .replace('${if (inline) "true" else "false"}','false').replace('${JSONObject.quote(inlineMeasure)}','""');
  await page.route('https://bob.invalid/',route=>route.fulfill({contentType:'text/html',body:document}));
  await page.goto('https://bob.invalid/');await page.waitForSelector('iframe');
  return {page,child:page.frames().find(frame=>frame!==page.mainFrame())!};
 }
 const visual='<style>body{font:16px serif}input,button,select,textarea,code,pre{font-family:serif}#medium{font-weight:500}#semibold{font-weight:600}</style><p>Plain</p><input placeholder="Input"><textarea>Text</textarea><button>Button</button><select><option>Choice</option></select><pre>Pre</pre><code style="font-family:serif">Code</code><span id="medium">Medium</span><span id="semibold">Semibold</span><b>Bold</b><i>Italic</i><b><i>Bold italic</i></b><svg><text x="0" y="20">SVG text</text></svg>';
 await t.test('authored visual fonts and sandbox remain unchanged while host UI loads local Nunito',async()=>{
  const {page,child}=await open('visual',visual);
  try {
   const fonts=await child.evaluate(async()=>{
    await document.fonts.ready;
    return {families:Array.from(document.querySelectorAll('p,input,textarea,button,select,option,pre,code,span,b,i,text')).map(element=>getComputedStyle(element).fontFamily),
     faces:Array.from(document.fonts).map(font=>({status:font.status,weight:font.weight,style:font.style})),
     parentBlocked:(()=>{try{void parent.document;return false;}catch{return true;}})()};
   });
   assert.ok(fonts.families.length>=15);assert.ok(fonts.families.every(family=>family==='serif'),JSON.stringify(fonts));
   assert.equal(fonts.faces.length,12); // Definitions do not force author content to use them.
   assert.ok(fonts.faces.every(font=>font.status==='unloaded'));
   assert.equal(fonts.parentBlocked,true);
   assert.equal(await page.locator('#status').evaluate(element=>getComputedStyle(element).fontFamily),'Nunito, sans-serif');
   assert.equal(await page.locator('iframe').getAttribute('sandbox'),'allow-scripts');
   const srcdoc=await page.locator('iframe').getAttribute('srcdoc');
   assert.ok(srcdoc?.includes(visual),'stored HTML is inserted unchanged');assert.ok(!srcdoc?.includes('private-native-nonce'));
   assert.match(srcdoc!,/font-src data:; connect-src 'none'/);
   assert.equal(await child.evaluate(async()=>{try{await fetch('https://example.invalid/blocked');return false;}catch{return true;}}),true);
   await page.locator('#status').evaluate(element=>element.textContent='Interactive app error: fixture');
   const hostFaces=await page.evaluate(async()=>{
    for(const weight of [400,500,600,700])for(const style of ['normal','italic'])await document.fonts.load(`${style} ${weight} 16px Nunito`,'Zażółć Привет ệ');
    return Array.from(document.fonts).filter(font=>font.family==='Nunito'&&font.status==='loaded').map(font=>[font.weight,font.style].join(':'));
   });
   assert.equal(new Set(hostFaces).size,8);
   await page.evaluate(()=>document.fonts.ready); // The host status has its own data-URL font face.
   assert.equal(await page.evaluate(()=>Array.from(document.fonts).some(font=>font.family==='Nunito'&&font.weight==='400'&&font.style==='normal'&&font.status==='loaded')),true);
  } finally {await page.close();}
 });
 await t.test('missing font assets retain readable host sans fallback and authored visual fonts',async()=>{
  const {page,child}=await open('visual',visual,'');
  try {assert.equal(await child.locator('input').evaluate(element=>getComputedStyle(element).fontFamily),'serif');assert.equal(await child.evaluate(()=>document.fonts.size),0);assert.equal(await page.locator('#status').evaluate(element=>getComputedStyle(element).fontFamily),'Nunito, sans-serif');}
  finally {await page.close();}
 });
 await t.test('MCP SDK exposes font variables and local CSS; third-party author fonts remain their choice',async()=>{
  const app=(await build({stdin:{contents:`import {App,applyHostStyleVariables,applyHostFonts} from '@modelcontextprotocol/ext-apps';
   const app=new App({name:'Font fixture',version:'1'},{});app.connect().then(()=>{const styles=app.getHostContext().styles;window.fontContext=styles;applyHostStyleVariables(styles.variables);applyHostFonts(styles.css.fonts);});`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'})).outputFiles[0].text;
  const {page,child}=await open('mcp',`<p style="font-family:var(--font-sans)">Opt in</p><code style="font-family:var(--font-mono)">Code</code><p id="owned" style="font-family:serif">App owned</p><script>${app.replaceAll('</script','<\\/script')}</script>`);
  try {
   await child.waitForFunction(()=>Boolean((window as any).fontContext));
   assert.deepEqual(await child.evaluate(()=>JSON.parse(JSON.stringify((window as any).fontContext.variables))),{'--font-sans':'"Nunito", sans-serif','--font-mono':'"Nordwand Mono", monospace'});
   assert.equal(await child.evaluate(()=>(window as any).fontContext.css.fonts),fontCss);
   await child.evaluate(()=>document.fonts.ready);
   assert.equal(await child.locator('p').first().evaluate(element=>getComputedStyle(element).fontFamily),'Nunito, sans-serif');
   assert.equal(await child.locator('code').evaluate(element=>getComputedStyle(element).fontFamily),'"Nordwand Mono", monospace');
   assert.equal(await child.locator('#owned').evaluate(element=>getComputedStyle(element).fontFamily),'serif');
   assert.equal(await child.evaluate(()=>Array.from(document.fonts).some(font=>font.family==='Nunito'&&font.weight==='400'&&font.style==='normal'&&font.status==='loaded')),true);
  } finally {await page.close();}
 });
 assert.deepEqual(errors,[]);
 assert.ok(requests.every(url=>url==='https://bob.invalid/'),'font loading must not request a network origin: '+requests.join(', '));
});
