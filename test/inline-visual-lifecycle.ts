import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {chromium,type Page} from 'playwright';

// The actual Android host document/CSP, host bundle and measurement asset. The
// emulator harness additionally checks native construction, bridge and layout.
const native=readFileSync('apps/mobile/android/app/src/main/java/com/bobmobile/BobInteractive.kt','utf8');
const template=/val html = """([\s\S]*?)"""/.exec(native)![1];
const measurement=readFileSync('apps/mobile/android/app/src/main/assets/inline-measure.js','utf8');
const nativeNonce='native-authority-test-only';
const compact='<style>*{box-sizing:border-box}body{margin:0;padding:16px;font:16px sans-serif;color:white;background:#176b45}p{margin:0}button{display:block;margin-top:16px;padding:12px;font:inherit}input{width:100%;font:inherit}</style><p>Compact inline check</p><button onclick="this.textContent=\'Clicked\'">Tap to test</button>';
function documentHtml(bundle:string,html:string,measure:string,inline:boolean,visualData?:unknown){
 const payload=JSON.stringify({kind:'visual',title:'Inline check',html,allowedTools:[],visualData}).replaceAll('<','\\u003c');
 return template.replace('$bundle',()=>bundle.replaceAll('</script','<\\/script')).replace('$safePayload',()=>payload)
  .replace('${JSONObject.quote(nonce)}',()=>JSON.stringify(nativeNonce))
  .replace('${if (inline) "true" else "false"}',()=>String(inline))
  .replace('${JSONObject.quote(inlineMeasure)}',()=>JSON.stringify(measure));
}
const state=(page:Page)=>page.evaluate(()=>{
 const frame=document.querySelector('iframe')!;
 return {opacity:frame.style.opacity,visibility:frame.style.visibility,pointerEvents:frame.style.pointerEvents,
  reason:frame.dataset.bobLayoutReason,status:document.querySelector('#status')!.textContent,
  requests:(window as any).__requests as Array<{payload:{method:string;reason?:string;height?:number};nonce:string}>,
  reports:(window as any).__reports as Array<{bobLayout:string;fits:boolean;contentHeight:number}>,srcdoc:frame.srcdoc,height:innerHeight};
});
const overflows=async(page:Page)=>(await state(page)).requests.filter(request=>request.payload.method==='overflow');
const waitFit=(page:Page)=>page.waitForFunction(()=>document.querySelector('iframe')?.style.opacity==='1');
const waitFallback=(page:Page)=>page.waitForFunction(()=>document.querySelector('iframe')?.style.visibility==='hidden');
export function registerInlineVisualLifecycle(){
test('inline visual size and data lifecycle in the actual isolated host document',{timeout:120000},async t=>{
 const bundle=(await build({entryPoints:['apps/interactive/host.ts'],bundle:true,write:false,format:'iife',platform:'browser'})).outputFiles[0].text;
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true}),scriptErrors:string[]=[];
 t.after(async()=>{await browser.close();assert.deepEqual(scriptErrors,[],'host/fixture scripts must not fail silently');});
 async function open(html=compact,options:{measure?:string;inline?:boolean;resize?:boolean;visualData?:unknown}={}){
  const page=await browser.newPage({viewport:{width:313,height:420}});
  page.on('pageerror',error=>scriptErrors.push(error.message));
  page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(30000);
  await page.exposeFunction('testResize',async(height:number)=>{if(options.resize!==false)await page.setViewportSize({width:313,height});});
  // String form avoids tsx function-name helpers leaking into the browser.
  await page.addInitScript(`
   window.__requests=[];window.__reports=[];
   window.BobNative={request(raw,nonce){
    if(nonce!==${JSON.stringify(nativeNonce)})return;
    const payload=JSON.parse(raw);window.__requests.push({payload,nonce});
    if(payload.method==='layout')window.testResize(payload.height);
   }};
   window.addEventListener('message',event=>{if(event.data?.bobLayout)window.__reports.push(event.data);});
  `);
  await page.route('https://bob.invalid/',route=>route.fulfill({contentType:'text/html',body:documentHtml(bundle,html,options.measure??measurement,options.inline??true,options.visualData)}));
  await page.goto('https://bob.invalid/');return page;
 }
 await t.test('compact content shrinks, stays interactive past timeout, and late real overflow promotes once',async()=>{
  const page=await open();
  try{
   await waitFit(page);
   const first=await state(page);assert.ok(first.height>80&&first.height<200,`Natural height: ${first.height}`);
   assert.ok(first.reports.some(report=>report.fits));assert.ok(first.reports.every(report=>report.bobLayout!==nativeNonce));
   assert.ok(!first.srcdoc.includes(nativeNonce),'native authority must never enter the opaque child');
   const child=page.frames().find(frame=>frame!==page.mainFrame())!;
   const bounds=await child.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight}));
   assert.equal(bounds.width,313);assert.equal(bounds.height,first.height);assert.equal(bounds.scrollWidth,313);assert.equal(bounds.scrollHeight,first.height);
   await page.frameLocator('iframe').getByRole('button').click();assert.equal(await page.frameLocator('iframe').getByRole('button').textContent(),'Clicked');
   await page.waitForTimeout(3300);
   const stable=await state(page);assert.equal(stable.opacity,'1');assert.notEqual(stable.visibility,'hidden');assert.equal(stable.pointerEvents,'auto');assert.equal(stable.status,'');assert.deepEqual(await overflows(page),[]);
   await child.evaluate(()=>{document.body.style.height='650px';});await waitFallback(page);
   assert.deepEqual(await overflows(page),[{payload:{method:'overflow',reason:'content-overflow'},nonce:nativeNonce}]);
   await child.evaluate(()=>{document.body.style.height='100px';});await page.waitForTimeout(400);
   assert.equal((await state(page)).visibility,'hidden');assert.equal((await overflows(page)).length,1);
  }finally{await page.close();}
 });
 await t.test('within-limit content grows and shrinks without remount or clipping',async()=>{
  const page=await open();
  try{
   await waitFit(page);const child=page.frames().find(frame=>frame!==page.mainFrame())!;
   await child.evaluate(()=>{(window as any).localState='retained';document.body.style.height='320px';});
   await page.waitForFunction(()=>innerHeight===320&&document.querySelector('iframe')?.style.opacity==='1');
   await child.evaluate(()=>{document.body.style.height='180px';});
   await page.waitForFunction(()=>innerHeight===180&&document.querySelector('iframe')?.style.opacity==='1');
   assert.equal(await child.evaluate(()=>(window as any).localState),'retained');assert.deepEqual(await overflows(page),[]);
  }finally{await page.close();}
 });
 await t.test('exact viewport fits; oversized, internally scrolling or clipped content does not',async()=>{
  for(const [extra,fits] of [
   ['<style>body{height:420px}</style>',true],['<style>body{height:650px}</style>',false],
   ['<div style="height:30px;overflow:auto"><div style="height:150px">Too tall</div></div>',false],
   ['<div style="height:30px;overflow:hidden"><div style="height:150px">Clipped</div></div>',false],
  ] as const){
   const page=await open(compact+extra);
   try{if(fits){await waitFit(page);assert.equal((await state(page)).height,420);assert.deepEqual(await overflows(page),[]);}
    else{await waitFallback(page);assert.equal((await overflows(page))[0]?.payload.reason,'content-overflow');}}
   finally{await page.close();}
  }
 });
 await t.test('missing measurement, wrong key, or missing native resize acknowledgement times out',async()=>{
  for(const options of [{measure:''},{measure:measurement.replace('__BOB_INLINE_LAYOUT_KEY__',JSON.stringify(nativeNonce))},{resize:false}]){
   const page=await open(compact,options);
   try{
    const key=/const key\s*=\s*"([^"]+)"/.exec((await state(page)).srcdoc)?.[1];
    await page.evaluate(key=>window.dispatchEvent(new MessageEvent('message',{source:window,data:{bobLayout:key,fits:true,contentHeight:1,viewportWidth:313,viewportHeight:420,viewportFits:true}})),key);
    assert.equal((await state(page)).opacity,'0');await waitFallback(page);
    assert.deepEqual(await overflows(page),[{payload:{method:'overflow',reason:'measurement-timeout'},nonce:nativeNonce}]);
   }finally{await page.close();}
  }
 });
 await t.test('revisioned data updates preserve controls, resize, reject stale data and remain isolated',async()=>{
  const html=compact+'<input aria-label="Local input"><p id="live">Waiting</p><div id="extra"></div><script>window.initializations=(window.initializations||0)+1;bobVisual.subscribe(({data})=>{if(data){document.getElementById("live").textContent=data.text;document.getElementById("extra").style.height=data.height+"px";}});</script>';
  const page=await open(html,{visualData:{revision:1,data:{text:'Initial saved data',height:0},updatedAt:1}});
  try{
   await waitFit(page);const frame=page.frameLocator('iframe'),child=page.frames().find(frame=>frame!==page.mainFrame())!;
   assert.equal(await frame.locator('#live').textContent(),'Initial saved data');
   await frame.getByRole('textbox').fill('keep this');const initialHeight=(await state(page)).height;
   await page.evaluate(()=>window.__bobVisualData!({revision:2,data:{text:'Live update',height:110},updatedAt:2}));
   await page.waitForFunction(height=>innerHeight>height&&document.querySelector('iframe')?.style.opacity==='1',initialHeight);
   assert.equal(await frame.locator('#live').textContent(),'Live update');assert.equal(await frame.getByRole('textbox').inputValue(),'keep this');
   assert.equal(await child.evaluate(()=>(window as any).initializations),1);
   await page.evaluate(()=>window.__bobVisualData!({revision:3,data:{text:'</script><img src=x onerror=alert(1)>',height:0},updatedAt:3}));
   await page.waitForFunction(height=>innerHeight<height+100&&document.querySelector('iframe')?.style.opacity==='1',initialHeight);
   await page.evaluate(()=>{window.__bobVisualData!({revision:2,data:{text:'stale',height:200},updatedAt:2});window.__bobVisualData!({revision:3,data:{text:'duplicate',height:200},updatedAt:3});});
   assert.equal(await frame.locator('#live').textContent(),'</script><img src=x onerror=alert(1)>');
   // Other message sources cannot spoof the trusted parent data channel.
   await child.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{source:window,data:{bobVisual:'wrong-key',value:{revision:99,data:{text:'spoofed'}}}})));
   assert.equal(await child.evaluate(()=>(window as any).bobVisual.current.revision),3);
   assert.equal(await child.evaluate(()=>{try{parent.document.body;return false;}catch{return true;}}),true);
   assert.equal(await child.evaluate(async()=>{try{await fetch('https://example.com/');return false;}catch{return true;}}),true);
   assert.deepEqual(await overflows(page),[]);
   await page.evaluate(()=>window.__bobVisualData!({revision:4,data:{text:'Too tall',height:650},updatedAt:4}));await waitFallback(page);
   assert.equal((await overflows(page))[0]?.payload.reason,'content-overflow');
  }finally{await page.close();}
 });
 await t.test('fullscreen receives data without an inline measurement gate',async()=>{
  const page=await open(compact+'<div style="height:700px">Large content</div>',{measure:'',inline:false});
  try{
   await page.evaluate(()=>window.__bobVisualData!({revision:1,data:{message:'Fresh'},updatedAt:1}));
   const child=page.frames().find(frame=>frame!==page.mainFrame())!;
   await child.waitForFunction(()=>(window as any).bobVisual.current.revision===1);
   const shown=await state(page);assert.notEqual(shown.opacity,'0');assert.notEqual(shown.visibility,'hidden');assert.deepEqual(shown.requests,[]);
  }finally{await page.close();}
 });
});
}
